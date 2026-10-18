import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  statfsSync,
  readFileSync,
  writeSync,
  fsyncSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_CLOUD_BYTES, validateSnapshot, type CloudSnapshot } from '../src/account/snapshot';
import { ApiError, requireApi } from './errors';
import type { GoogleIdentity } from './identity';

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_MS = 10 * 60 * 1000;
export const LEASE_MS = 90_000;
export const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
export const MIN_FREE_BYTES = 256 * 1024 * 1024;
export const MAX_DELETION_BYTES = 1024 * 1024;
export function readDeletions(path: string): Set<string> {
  privateDirectory(dirname(path));
  privateFile(path);
  requireApi(lstatSync(path).size <= MAX_DELETION_BYTES, 503, 'invalid_deletion_journal');
  const lines = readFileSync(path, 'utf8');
  requireApi(!lines || lines.endsWith('\n'), 503, 'invalid_deletion_journal');
  const ids = lines ? lines.slice(0, -1).split('\n') : [];
  requireApi(
    ids.every((id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)),
    503,
    'invalid_deletion_journal',
  );
  return new Set(ids);
}
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface Player {
  id: string;
  name: string;
}
export interface Session {
  hash: string;
  userId: string | null;
  csrf: string;
  nonce: string;
  expiresAt: number;
  authenticatedAt: number;
}
interface SaveRow {
  revision: number;
  payload: string | null;
  updatedAt: number;
  leaseHash: string | null;
  leaseExpiresAt: number;
  writeId: string | null;
  payloadHash: string | null;
}

export function privateDirectory(path: string): string {
  path = resolve(path);
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  requireApi(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      (process.getuid === undefined || stat.uid === process.getuid()),
    503,
    'unsafe_data_directory',
  );
  return path;
}

export function privateFile(path: string): void {
  const stat = lstatSync(path);
  requireApi(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      (stat.mode & 0o077) === 0 &&
      (process.getuid === undefined || stat.uid === process.getuid()),
    503,
    'unsafe_data_file',
  );
}

export class AccountStore {
  readonly db: DatabaseSync;
  readonly directory: string;
  readonly path: string;
  readonly deletionJournal: string;
  constructor(
    directory: string,
    readonly now = Date.now,
    private freeBytes?: () => number,
    deletionJournal?: string,
  ) {
    this.directory = privateDirectory(directory);
    this.deletionJournal = resolve(deletionJournal ?? join(this.directory, 'deletions.jsonl'));
    privateDirectory(dirname(this.deletionJournal));
    if (!existsSync(this.deletionJournal)) {
      requireApi(deletionJournal === undefined, 503, 'deletion_journal_required');
      const fd = openSync(
        this.deletionJournal,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const parent = openSync(
        dirname(this.deletionJournal),
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    }
    const deleted = readDeletions(this.deletionJournal);
    this.path = join(this.directory, 'accounts.sqlite');
    if (!existsSync(this.path)) {
      closeSync(
        openSync(
          this.path,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        ),
      );
    }
    privateFile(this.path);
    requireApi(lstatSync(this.path).size <= MAX_DATABASE_BYTES, 503, 'database_too_large');
    for (const suffix of ['-wal', '-shm'])
      if (existsSync(this.path + suffix)) privateFile(this.path + suffix);
    this.db = new DatabaseSync(this.path);
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      requireApi(version === 0 || version === 1, 503, 'unsupported_database_version');
      if (version === 0) {
        const tables = Number(
          this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n,
        );
        requireApi(tables === 0, 503, 'unsupported_database_version');
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE players (id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, name TEXT NOT NULL) STRICT;
          CREATE TABLE sessions (hash TEXT PRIMARY KEY, userId TEXT REFERENCES players(id) ON DELETE CASCADE,
            csrf TEXT NOT NULL, nonce TEXT NOT NULL, expiresAt INTEGER NOT NULL, authenticatedAt INTEGER NOT NULL) STRICT;
          CREATE INDEX sessions_user ON sessions(userId);
          CREATE TABLE saves (userId TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL DEFAULT 0, payload TEXT, updatedAt INTEGER NOT NULL DEFAULT 0,
            leaseHash TEXT, leaseExpiresAt INTEGER NOT NULL DEFAULT 0, writeId TEXT, payloadHash TEXT) STRICT;
          CREATE TABLE history (userId TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL, payload TEXT NOT NULL, updatedAt INTEGER NOT NULL,
            PRIMARY KEY (userId, revision)) STRICT;
          CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
          PRAGMA user_version=1;`);
        this.db.prepare('INSERT INTO metadata VALUES (?,?)').run('generation', token());
        this.db.exec('COMMIT');
      }
      this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        PRAGMA busy_timeout=1500; PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON;
        PRAGMA max_page_count=${Math.floor(MAX_DATABASE_BYTES / Number(this.db.prepare('PRAGMA page_size').get()!.page_size))};`);
      // SQLite sidecars inherit the database's private permissions; verify any already present.
      for (const suffix of ['-wal', '-shm'])
        if (existsSync(this.path + suffix)) privateFile(this.path + suffix);
      if (deleted.size)
        this.transaction(() => {
          const remove = this.db.prepare('DELETE FROM players WHERE id=?');
          for (const id of deleted) remove.run(id);
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }
  get generation() {
    return String(
      this.db.prepare("SELECT value FROM metadata WHERE key='generation'").get()!.value,
    );
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  ensureSpace(extraBytes = 0) {
    const disk = this.freeBytes ? null : statfsSync(this.directory);
    const available = this.freeBytes ? this.freeBytes() : disk!.bavail * disk!.bsize;
    requireApi(available >= MIN_FREE_BYTES + extraBytes, 503, 'storage_full');
  }
  session(raw: string | undefined): Session | null {
    if (!raw || !/^[\w-]{43}$/.test(raw)) return null;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE hash=? AND expiresAt>?')
      .get(hash(raw), this.now());
    return row ? (row as unknown as Session) : null;
  }
  player(id: string): Player {
    const row = this.db.prepare('SELECT id,name FROM players WHERE id=?').get(id);
    requireApi(row, 401, 'unauthenticated');
    return row as unknown as Player;
  }
  bootstrap(raw?: string) {
    const current = this.session(raw);
    if (current) return { raw: raw!, session: current };
    this.ensureSpace();
    this.db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(this.now());
    requireApi(
      Number(this.db.prepare('SELECT count(*) AS n FROM sessions').get()!.n) < 5000,
      503,
      'session_capacity',
    );
    const secret = token();
    const session: Session = {
      hash: hash(secret),
      userId: null,
      csrf: token(),
      nonce: token(),
      expiresAt: this.now() + LOGIN_MS,
      authenticatedAt: 0,
    };
    this.db
      .prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
      .run(session.hash, null, session.csrf, session.nonce, session.expiresAt, 0);
    return { raw: secret, session };
  }
  login(session: Session, identity: GoogleIdentity) {
    this.ensureSpace();
    return this.transaction(() => {
      // A successful login consumes the nonce/session once, even if two requests verified concurrently.
      requireApi(
        this.db
          .prepare('SELECT hash FROM sessions WHERE hash=? AND expiresAt>?')
          .get(session.hash, this.now()),
        401,
        'auth_failed',
      );
      let player = this.db
        .prepare('SELECT id,name FROM players WHERE subject=?')
        .get(identity.subject) as unknown as Player | undefined;
      if (!player) {
        player = { id: randomUUID(), name: identity.name };
        this.db
          .prepare('INSERT INTO players VALUES (?,?,?)')
          .run(player.id, identity.subject, player.name);
        this.db.prepare('INSERT INTO saves (userId) VALUES (?)').run(player.id);
      } else {
        player.name = identity.name;
        this.db.prepare('UPDATE players SET name=? WHERE id=?').run(player.name, player.id);
      }
      this.db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
      const raw = token();
      const next: Session = {
        hash: hash(raw),
        userId: player.id,
        csrf: token(),
        nonce: token(),
        expiresAt: this.now() + SESSION_MS,
        authenticatedAt: this.now(),
      };
      this.db
        .prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
        .run(next.hash, next.userId, next.csrf, next.nonce, next.expiresAt, next.authenticatedAt);
      this.db
        .prepare(
          `DELETE FROM sessions WHERE userId=? AND hash NOT IN
        (SELECT hash FROM sessions WHERE userId=? ORDER BY authenticatedAt DESC,rowid DESC LIMIT 10)`,
        )
        .run(player.id, player.id);
      return { player, raw, session: next };
    });
  }
  logout(session: Session) {
    this.db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
  }
  private row(userId: string): SaveRow {
    const row = this.db.prepare('SELECT * FROM saves WHERE userId=?').get(userId);
    requireApi(row, 401, 'unauthenticated');
    return row as unknown as SaveRow;
  }
  read(userId: string) {
    const row = this.row(userId);
    return {
      generation: this.generation,
      revision: row.revision,
      updatedAt: row.updatedAt,
      snapshot: row.payload === null ? null : validateSnapshot(JSON.parse(row.payload)),
      leaseHeld: !!row.leaseHash && row.leaseExpiresAt > this.now(),
      leaseExpiresAt: row.leaseExpiresAt,
    };
  }
  acquireLease(
    userId: string,
    generation: string,
    revision: number,
    takeover: boolean,
    previous?: string,
  ) {
    return this.transaction(() => {
      requireApi(generation === this.generation, 409, 'restored_database');
      const row = this.row(userId);
      requireApi(row.revision === revision, 409, 'stale_revision');
      const same = !!previous && hash(previous) === row.leaseHash;
      requireApi(
        takeover || same || !row.leaseHash || row.leaseExpiresAt <= this.now(),
        409,
        'lease_held',
      );
      const leaseToken = same ? previous! : token();
      this.db
        .prepare('UPDATE saves SET leaseHash=?,leaseExpiresAt=? WHERE userId=?')
        .run(hash(leaseToken), this.now() + LEASE_MS, userId);
      return { revision: row.revision, leaseToken, leaseExpiresAt: this.now() + LEASE_MS };
    });
  }
  write(
    userId: string,
    generation: string,
    baseRevision: number,
    leaseToken: string,
    writeId: string,
    value: unknown,
  ) {
    let snapshot: CloudSnapshot;
    try {
      snapshot = validateSnapshot(value);
    } catch {
      throw new ApiError(400, 'invalid_checkpoint');
    }
    const payload = JSON.stringify(snapshot);
    requireApi(Buffer.byteLength(payload) <= MAX_CLOUD_BYTES, 413, 'payload_too_large');
    const payloadHash = hash(payload);
    this.ensureSpace(4 * MAX_CLOUD_BYTES);
    return this.transaction(() => {
      requireApi(generation === this.generation, 409, 'restored_database');
      const row = this.row(userId);
      requireApi(
        row.leaseHash === hash(leaseToken) && row.leaseExpiresAt > this.now(),
        409,
        'lease_lost',
      );
      // Retrying a request whose response was lost does not create another revision or reward.
      if (row.writeId === writeId) {
        requireApi(
          row.payloadHash === payloadHash && baseRevision === row.revision - 1,
          409,
          'write_id_reused',
        );
        return { revision: row.revision, updatedAt: row.updatedAt };
      }
      requireApi(
        row.revision === baseRevision && row.revision < Number.MAX_SAFE_INTEGER,
        409,
        'stale_revision',
      );
      if (row.payload !== null)
        this.db
          .prepare('INSERT INTO history VALUES (?,?,?,?)')
          .run(userId, row.revision, row.payload, row.updatedAt);
      this.db
        .prepare(
          `DELETE FROM history WHERE userId=? AND revision NOT IN
        (SELECT revision FROM history WHERE userId=? ORDER BY revision DESC LIMIT 5)`,
        )
        .run(userId, userId);
      const updatedAt = this.now(),
        revision = row.revision + 1;
      this.db
        .prepare(
          'UPDATE saves SET revision=?,payload=?,updatedAt=?,leaseExpiresAt=?,writeId=?,payloadHash=? WHERE userId=?',
        )
        .run(revision, payload, updatedAt, updatedAt + LEASE_MS, writeId, payloadHash, userId);
      return { revision, updatedAt };
    });
  }
  history(userId: string) {
    return this.db
      .prepare('SELECT revision,updatedAt FROM history WHERE userId=? ORDER BY revision DESC')
      .all(userId);
  }
  historical(userId: string, revision: number) {
    const row = this.db
      .prepare('SELECT payload,updatedAt FROM history WHERE userId=? AND revision=?')
      .get(userId, revision);
    requireApi(row, 404, 'not_found');
    return {
      revision,
      updatedAt: Number(row.updatedAt),
      snapshot: validateSnapshot(JSON.parse(String(row.payload))),
    };
  }
  deleteAccount(session: Session) {
    requireApi(session.userId, 401, 'unauthenticated');
    requireApi(this.now() - session.authenticatedAt <= LOGIN_MS, 403, 'recent_sign_in_required');
    this.player(session.userId);
    const line = session.userId + '\n';
    const recorded = readDeletions(this.deletionJournal).has(session.userId);
    requireApi(
      recorded ||
        lstatSync(this.deletionJournal).size + Buffer.byteLength(line) <= MAX_DELETION_BYTES,
      503,
      'deletion_journal_full',
    );
    const fd = openSync(
      this.deletionJournal,
      constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      requireApi(
        recorded || writeSync(fd, line) === Buffer.byteLength(line),
        503,
        'deletion_journal_unavailable',
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.transaction(() => this.db.prepare('DELETE FROM players WHERE id=?').run(session.userId!));
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}
