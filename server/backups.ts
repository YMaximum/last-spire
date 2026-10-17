import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  constants,
  existsSync,
  lstatSync,
  openSync,
  closeSync,
  writeFileSync,
  renameSync,
  readdirSync,
  unlinkSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { requireApi } from './errors';
import { AccountStore, MAX_DATABASE_BYTES, privateDirectory, privateFile, token } from './store';

const NAME = /^snapshot-([0-9]+)-[a-f0-9-]{36}\.sqlite$/;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
async function checksum(path: string) {
  privateFile(path);
  requireApi(lstatSync(path).size <= MAX_DATABASE_BYTES, 503, 'backup_too_large');
  const digest = createHash('sha256');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  for await (const bytes of createReadStream(path, { fd, autoClose: true })) digest.update(bytes);
  return digest.digest('hex');
}

export async function verifyBackup(path: string) {
  privateDirectory(dirname(path));
  privateFile(path + '.sha256');
  requireApi(lstatSync(path + '.sha256').size === 65, 503, 'invalid_backup');
  const { readFileSync } = await import('node:fs');
  const expected = readFileSync(path + '.sha256', 'utf8');
  requireApi(
    /^[a-f0-9]{64}\n$/.test(expected) && expected.trim() === (await checksum(path)),
    503,
    'backup_checksum_mismatch',
  );
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    requireApi(
      db.prepare('PRAGMA quick_check').get()!.quick_check === 'ok' &&
        db.prepare('PRAGMA user_version').get()!.user_version === 1 &&
        typeof db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value ===
          'string',
      503,
      'invalid_backup',
    );
  } finally {
    db.close();
  }
}

export async function createBackup(store: AccountStore): Promise<string> {
  const pages = Number(store.db.prepare('PRAGMA page_count').get()!.page_count);
  const pageSize = Number(store.db.prepare('PRAGMA page_size').get()!.page_size);
  store.ensureSpace(pages * pageSize + 4096);
  const directory = privateDirectory(join(store.directory, 'backups'));
  const name = `snapshot-${store.now()}-${randomUUID()}.sqlite`;
  const destination = join(directory, name),
    temporary = destination + '.pending';
  closeSync(
    openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    ),
  );
  try {
    await backup(store.db, temporary);
    const sum = await checksum(temporary);
    writeFileSync(destination + '.sha256', sum + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, destination);
    await verifyBackup(destination);
    // Seven snapshots at most, never advertised as protection against loss of this VPS.
    const files = readdirSync(directory)
      .filter((name) => NAME.test(name))
      .sort((a, b) =>
        a === name ? -1 : b === name ? 1 : Number(NAME.exec(b)![1]) - Number(NAME.exec(a)![1]),
      );
    for (const [index, file] of files.entries()) {
      if (index < 7 && store.now() - Number(NAME.exec(file)![1]) < RETENTION_MS) continue;
      for (const suffix of ['', '.sha256']) {
        const path = join(directory, file + suffix);
        if (existsSync(path)) {
          privateFile(path);
          unlinkSync(path);
        }
      }
    }
    return destination;
  } catch (error) {
    for (const path of [temporary, destination, destination + '.sha256']) {
      if (existsSync(path)) {
        privateFile(path);
        unlinkSync(path);
      }
    }
    throw error;
  }
}

/** Restore into a NEW directory. It cannot overwrite an active database. */
export async function restoreBackup(source: string, target: string) {
  await verifyBackup(source);
  const directory = privateDirectory(target),
    destination = join(directory, 'accounts.sqlite');
  requireApi(!existsSync(destination), 409, 'restore_target_exists');
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  const store = new AccountStore(directory);
  try {
    store.transaction(() => {
      store.db.prepare('DELETE FROM sessions').run();
      store.db.prepare('UPDATE saves SET leaseHash=NULL,leaseExpiresAt=0').run();
      store.db.prepare("UPDATE metadata SET value=? WHERE key='generation'").run(token());
    });
  } finally {
    store.close();
  }
}
