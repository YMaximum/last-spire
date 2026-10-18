import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { emptySave, parseGame } from '../src/v3/storage';
import { emptySave as emptyV2 } from '../src/v2/storage';
import { createRun as legacyRun } from '../src/v2/engine';
import { createRun } from '../src/v3/engine';
import { snapshotRunes } from '../src/v3/controls';
import { snapshotFromSave, saveFromSnapshot, validateSnapshot } from '../src/account/snapshot';
import {
  AccountStore,
  hash,
  LEASE_MS,
  LOGIN_MS,
  MIN_FREE_BYTES,
  SESSION_MS,
} from '../server/store';
import { accountServer, RateLimiter, validateConfig } from '../server/app';
import { ApiError } from '../server/errors';
import { googleVerifier } from '../server/identity';
import { createBackup, restoreBackup, verifyBackup } from '../server/backups';

const CLIENT = '123456789-test.apps.googleusercontent.com';
const ORIGIN = 'https://game.example.test';
function activeSave() {
  const save = emptySave();
  const run = createRun(save.profile, 'bastion', 0, 0, 84731, {
    mode: 'normal',
    runes: snapshotRunes(save.progression.runes),
  });
  save.run = run;
  run.weapons[0].lifetimeShots = 15001;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: structuredClone(save.progression.autocast),
  };
  return save;
}

describe('cloud checkpoint contract', () => {
  it('round trips active run/RNG, pending choices and credits without copying device settings', () => {
    const save = activeSave();
    save.settings.sound = false;
    save.settings.uiScale = 150;
    save.profile.credits = 123;
    const snapshot = snapshotFromSave(save);
    expect(snapshot).not.toHaveProperty('settings');
    const settings = { ...emptySave().settings, effects: 'low' as const };
    const restored = saveFromSnapshot(snapshot, settings);
    expect(restored.run).toEqual(save.run);
    expect(restored.progression).toEqual(save.progression);
    expect(restored.profile.credits).toBe(123);
    expect(restored.settings).toEqual(settings);
    expect(save.settings.sound).toBe(false);
  });
  it('preserves a resumable legacy run using the existing migration/validation rules', () => {
    const old = emptyV2();
    old.run = legacyRun(old.profile, 'bastion', 0, 0, 19);
    const migrated = parseGame(old);
    expect(saveFromSnapshot(snapshotFromSave(migrated), migrated.settings)).toEqual(migrated);
  });
  it('rejects unknown fields, prototype keys and invalid saves', () => {
    const snapshot = snapshotFromSave(emptySave());
    for (const value of [
      null,
      [],
      {},
      { ...snapshot, settings: {} },
      { ...snapshot, userId: 'victim' },
      JSON.parse('{"__proto__":{"polluted":true}}'),
      { ...snapshot, profile: { credits: Infinity } },
    ])
      expect(() => validateSnapshot(value)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects deeply nested input before serializing it', () => {
    let nested: unknown = null;
    for (let i = 0; i < 100; i++) nested = { next: nested };
    expect(() => validateSnapshot({ ...snapshotFromSave(emptySave()), profile: nested })).toThrow(
      /save/i,
    );
  });
});

describe('real Google token verification with local test signing keys', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const seconds = () => Math.floor(Date.now() / 1000);
  function jwt(patch = {}, key = privateKey) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'local-test' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: CLIENT,
        sub: 'google-subject-a',
        nonce: 'expected-nonce',
        iat: seconds(),
        exp: seconds() + 600,
        name: 'Name\nFrom Google',
        email: 'not-stored@example.test',
        ...patch,
      }),
    ).toString('base64url');
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
  }
  function verifier() {
    const client = new OAuth2Client(CLIENT);
    vi.spyOn(client, 'getFederatedSignonCertsAsync').mockResolvedValue({
      certs: { 'local-test': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      format: 'PEM',
    } as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>);
    return googleVerifier(CLIENT, client);
  }
  it('accepts signed audience/issuer/expiry/nonce and retains only subject and display name', async () => {
    await expect(verifier()(jwt(), 'expected-nonce')).resolves.toEqual({
      subject: 'google-subject-a',
      name: 'NameFrom Google',
    });
  });
  it.each([
    { aud: 'another-app' },
    { iss: 'https://attacker.example.test' },
    { exp: seconds() - 1000, iat: seconds() - 2000 },
    { nonce: 'wrong-nonce' },
    { nonce: undefined },
    { sub: '' },
    { iat: seconds() - 700 },
  ])('rejects invalid Google token claims without exposing the token: %j', async (patch) => {
    await expect(verifier()(jwt(patch), 'expected-nonce')).rejects.toMatchObject({
      status: 401,
      code: 'auth_failed',
    });
  });
  it('rejects tampered signatures and malformed tokens', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const credential of [jwt({}, other), 'not-a-jwt'])
      await expect(verifier()(credential, 'expected-nonce')).rejects.toMatchObject({
        code: 'auth_failed',
      });
  });
});

describe('persistent account checkpoints', () => {
  let directory: string, store: AccountStore, clock: number;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'last-spire-account-test-'));
    clock = 1_800_000_000_000;
    store = new AccountStore(directory, () => clock);
  });
  afterEach(() => {
    if (store.db.isOpen) store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function login(subject = 'google-a') {
    return store.login(store.bootstrap().session, { subject, name: 'Spirekeeper' });
  }
  function write(
    userId: string,
    revision: number,
    lease: string,
    snapshot = snapshotFromSave(activeSave()),
    writeId = randomUUID(),
  ) {
    return store.write(userId, store.generation, revision, lease, writeId, snapshot);
  }
  it('hashes session secrets, rotates login credentials, consumes nonce once and expires sessions', () => {
    const pre = store.bootstrap();
    expect(store.session(pre.raw)?.hash).toBe(hash(pre.raw));
    expect(store.db.prepare('SELECT hash FROM sessions').get()!.hash).not.toBe(pre.raw);
    const actor = store.login(pre.session, { subject: 'a', name: 'A' });
    expect(actor.raw).not.toBe(pre.raw);
    expect(store.session(pre.raw)).toBeNull();
    expect(() => store.login(pre.session, { subject: 'a', name: 'A' })).toThrow('auth_failed');
    expect(store.session(actor.raw)?.userId).toBe(actor.player.id);
    clock += SESSION_MS + 1;
    expect(store.session(actor.raw)).toBeNull();
  });
  it('expires abandoned sign-in sessions and bounds sessions per account', () => {
    const pre = store.bootstrap();
    clock += LOGIN_MS + 1;
    expect(store.bootstrap(pre.raw).raw).not.toBe(pre.raw);
    for (let i = 0; i < 12; i++) login();
    expect(
      store.db.prepare('SELECT count(*) AS n FROM sessions WHERE userId IS NOT NULL').get()!.n,
    ).toBe(10);
  });
  it('uses Google subject independently of display name and keeps accounts isolated', () => {
    const a = login('a'),
      again = login('a'),
      b = login('b');
    expect(a.player.id).toBe(again.player.id);
    expect(b.player.id).not.toBe(a.player.id);
    const lease = store.acquireLease(a.player.id, store.generation, 0, false);
    write(a.player.id, 0, lease.leaseToken);
    expect(store.read(b.player.id).snapshot).toBeNull();
    expect(() => write(b.player.id, 0, lease.leaseToken)).toThrow('lease_lost');
    expect(store.history(b.player.id)).toEqual([]);
  });
  it('keeps a checkpoint through close/reopen and preserves large lifetime statistics', () => {
    const a = login(),
      snapshot = snapshotFromSave(activeSave());
    const lease = store.acquireLease(a.player.id, store.generation, 0, false);
    write(a.player.id, 0, lease.leaseToken, snapshot);
    store.close();
    store = new AccountStore(directory, () => clock);
    expect(store.read(a.player.id).snapshot).toEqual(snapshot);
  });
  it('requires explicit takeover and rejects the previous device after takeover', () => {
    const a = login(),
      generation = store.generation;
    const lease = store.acquireLease(a.player.id, generation, 0, false);
    expect(() => store.acquireLease(a.player.id, generation, 0, false)).toThrow('lease_held');
    const second = store.acquireLease(a.player.id, generation, 0, true);
    expect(second.leaseToken).not.toBe(lease.leaseToken);
    expect(() => write(a.player.id, 0, lease.leaseToken)).toThrow('lease_lost');
    write(a.player.id, 0, second.leaseToken);
    expect(() => store.acquireLease(a.player.id, generation, 0, true)).toThrow('stale_revision');
  });
  it('expires leases, supports heartbeats and refuses stale save revisions', () => {
    const a = login(),
      generation = store.generation;
    const lease = store.acquireLease(a.player.id, generation, 0, false);
    clock += 20_000;
    expect(store.acquireLease(a.player.id, generation, 0, false, lease.leaseToken).leaseToken).toBe(
      lease.leaseToken,
    );
    write(a.player.id, 0, lease.leaseToken);
    expect(() => write(a.player.id, 0, lease.leaseToken)).toThrow('stale_revision');
    clock += LEASE_MS + 1;
    expect(() => write(a.player.id, 1, lease.leaseToken)).toThrow('lease_lost');
    const next = store.acquireLease(a.player.id, generation, 1, false);
    write(a.player.id, 1, next.leaseToken);
  });
  it('makes a lost-response retry idempotent without merging/incrementing credits', () => {
    const a = login(),
      lease = store.acquireLease(a.player.id, store.generation, 0, false),
      id = randomUUID();
    const snapshot = snapshotFromSave(emptySave());
    snapshot.profile.credits = 124;
    const result = write(a.player.id, 0, lease.leaseToken, snapshot, id);
    expect(write(a.player.id, 0, lease.leaseToken, snapshot, id)).toEqual(result);
    expect(store.read(a.player.id).snapshot!.profile.credits).toBe(124);
    expect(store.history(a.player.id)).toHaveLength(0);
    snapshot.profile.credits = 248;
    expect(() => write(a.player.id, 0, lease.leaseToken, snapshot, id)).toThrow('write_id_reused');
  });
  it('keeps five previous revisions and requires a new conditional write to restore one', () => {
    const a = login(),
      lease = store.acquireLease(a.player.id, store.generation, 0, false);
    for (let i = 0; i < 8; i++) {
      const snapshot = snapshotFromSave(emptySave());
      snapshot.profile.credits = i;
      write(a.player.id, i, lease.leaseToken, snapshot);
    }
    expect(store.history(a.player.id).map((r) => r.revision)).toEqual([7, 6, 5, 4, 3]);
    expect(() => store.historical(a.player.id, 1)).toThrow('not_found');
    const old = store.historical(a.player.id, 3).snapshot;
    write(a.player.id, 8, lease.leaseToken, old);
    expect(store.read(a.player.id).snapshot).toEqual(old);
    expect(store.read(a.player.id).revision).toBe(9);
  });
  it('rejects invalid checkpoints and low disk space without replacing the prior save', () => {
    const a = login(),
      lease = store.acquireLease(a.player.id, store.generation, 0, false);
    write(a.player.id, 0, lease.leaseToken);
    expect(() =>
      store.write(a.player.id, store.generation, 1, lease.leaseToken, randomUUID(), {}),
    ).toThrow();
    store.close();
    store = new AccountStore(
      directory,
      () => clock,
      () => MIN_FREE_BYTES - 1,
    );
    expect(() => write(a.player.id, 1, lease.leaseToken)).toThrow('storage_full');
    expect(store.read(a.player.id).revision).toBe(1);
  });
  it('reserves backup growth space and refuses unknown schema versions', async () => {
    store.close();
    store = new AccountStore(
      directory,
      () => clock,
      () => MIN_FREE_BYTES,
    );
    await expect(createBackup(store)).rejects.toThrow('storage_full');
    store.db.exec('PRAGMA user_version=99');
    store.close();
    expect(() => new AccountStore(directory)).toThrow('unsupported_database_version');
  });
  it('deletes only the freshly authenticated account, its history and all of its sessions', () => {
    const a = login('a'),
      a2 = login('a'),
      b = login('b');
    const lease = store.acquireLease(a.player.id, store.generation, 0, false);
    write(a.player.id, 0, lease.leaseToken);
    write(a.player.id, 1, lease.leaseToken);
    clock += LOGIN_MS + 1;
    expect(() => store.deleteAccount(a.session)).toThrow('recent_sign_in_required');
    const refreshed = login('a');
    store.deleteAccount(refreshed.session);
    expect(store.session(a.raw)).toBeNull();
    expect(store.session(a2.raw)).toBeNull();
    expect(() => store.player(a.player.id)).toThrow('unauthenticated');
    expect(store.history(a.player.id)).toEqual([]);
    expect(store.player(b.player.id)).toEqual(b.player);
  });
  it('creates private files and rejects linked/shared database files or directories', () => {
    expect(lstatSync(store.path).mode & 0o077).toBe(0);
    const linked = join(directory, 'linked');
    symlinkSync(directory, linked);
    expect(() => new AccountStore(linked)).toThrow('unsafe_data_directory');
    store.close();
    chmodSync(join(directory, 'accounts.sqlite'), 0o644);
    expect(() => new AccountStore(directory)).toThrow('unsafe_data_file');
  });
  it('backs up live WAL data, restores to a new directory and revokes old sessions/leases/generation', async () => {
    const a = login(),
      generation = store.generation;
    const lease = store.acquireLease(a.player.id, generation, 0, false),
      snapshot = snapshotFromSave(activeSave());
    write(a.player.id, 0, lease.leaseToken, snapshot);
    const path = await createBackup(store);
    await verifyBackup(path);
    const restoredDir = join(directory, 'restored');
    await restoreBackup(path, restoredDir);
    const restored = new AccountStore(restoredDir, () => clock);
    try {
      expect(restored.read(a.player.id).snapshot).toEqual(snapshot);
      expect(restored.read(a.player.id).leaseHeld).toBe(false);
      expect(restored.session(a.raw)).toBeNull();
      expect(restored.generation).not.toBe(generation);
      expect(() => restored.acquireLease(a.player.id, generation, 1, true)).toThrow(
        'restored_database',
      );
    } finally {
      restored.close();
    }
    await expect(restoreBackup(path, directory)).rejects.toThrow('restore_target_exists');
  });
  it('detects tampered backups and bounds backup retention', async () => {
    let path = '';
    for (let i = 0; i < 9; i++) {
      path = await createBackup(store);
      clock += 24 * 60 * 60 * 1000;
    }
    const files = readdirSync(join(directory, 'backups')).filter((x) => x.endsWith('.sqlite'));
    expect(files).toHaveLength(7);
    expect(lstatSync(path).mode & 0o077).toBe(0);
    const contents = readFileSync(path);
    contents[100] ^= 1;
    writeFileSync(path, contents);
    await expect(verifyBackup(path)).rejects.toThrow('backup_checksum_mismatch');
  });
});

describe('account HTTP boundary', () => {
  let directory: string, store: AccountStore, server: Server, base: string, clock: number;
  const verify = vi.fn(async (credential: string, _nonce: string) => {
    if (!credential.startsWith('valid:')) throw new ApiError(401, 'auth_failed');
    return { subject: credential.slice(6), name: 'Spirekeeper' };
  });
  const verifyCode = vi.fn(async (code: string) => {
    if (code !== 'fixture-code') throw new ApiError(401, 'auth_failed');
    return { subject: 'code-subject', name: 'Spirekeeper' };
  });
  beforeEach(async () => {
    verify.mockClear();
    verifyCode.mockClear();
    clock = 1_800_000_000_000;
    directory = mkdtempSync(join(tmpdir(), 'last-spire-http-test-'));
    store = new AccountStore(directory, () => clock);
    server = accountServer(store, { origin: ORIGIN, clientId: CLIENT }, verify, verifyCode);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function request(
    path: string,
    method = 'GET',
    data?: unknown,
    cookie?: string,
    csrf?: string,
    origin = ORIGIN,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function actor(subject = 'a') {
    const boot = await request('/api/session');
    const initial = boot.headers.get('set-cookie')!.split(';')[0];
    const result = await request(
      '/api/auth/google',
      'POST',
      { credential: `valid:${subject}` },
      initial,
      boot.body.csrf,
    );
    return {
      cookie: result.headers.get('set-cookie')!.split(';')[0],
      csrf: result.body.csrf,
      id: result.body.player.id,
    };
  }
  it('uses private no-store responses and secure host-only HttpOnly cookies', async () => {
    const boot = await request('/api/session');
    expect(boot.status).toBe(200);
    expect(boot.headers.get('set-cookie')).toContain('__Host-last-spire=');
    expect(boot.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(boot.headers.get('set-cookie')).toContain('; Secure');
    expect(boot.headers.get('set-cookie')).not.toContain('Domain=');
    expect(boot.headers.get('cache-control')).toBe('no-store');
    expect(boot.body.player).toBeNull();
    expect(boot.body.clientId).toBe(CLIENT);
    expect(boot.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('protects the code-popup route with session, exact origin and CSRF before exchange', async () => {
    const boot = await request('/api/session');
    const initial = boot.headers.get('set-cookie')!.split(';')[0];
    expect(boot.body.codeSignIn).toBe(true);
    for (const [csrf, origin] of [
      [undefined, ORIGIN],
      ['wrong', ORIGIN],
      [boot.body.csrf, 'https://foreign.example.test'],
    ]) {
      expect(
        (
          await request(
            '/api/auth/google/code',
            'POST',
            { code: 'fixture-code' },
            initial,
            csrf,
            origin,
          )
        ).status,
      ).toBe(403);
    }
    expect(verifyCode).not.toHaveBeenCalled();
    expect(
      (
        await request(
          '/api/auth/google/code',
          'POST',
          { code: 'fixture-code', credential: 'extra' },
          initial,
          boot.body.csrf,
        )
      ).status,
    ).toBe(400);
    const ok = await request(
      '/api/auth/google/code',
      'POST',
      { code: 'fixture-code' },
      initial,
      boot.body.csrf,
    );
    expect(ok.status).toBe(200);
    expect(verifyCode).toHaveBeenCalledExactlyOnceWith('fixture-code');
    expect(ok.body.player.name).toBe('Spirekeeper');
    expect(ok.headers.get('set-cookie')!.split(';')[0]).not.toBe(initial);
    expect((await request('/api/save', 'GET', undefined, initial)).status).toBe(401);
    expect(
      (
        await request(
          '/api/auth/google/code',
          'POST',
          { code: 'fixture-code' },
          initial,
          boot.body.csrf,
        )
      ).status,
    ).toBe(401);
    expect(JSON.stringify(ok.body)).not.toContain('fixture-code');
  });
  it('disables code sign-in without server-only configuration while retaining guest health/session access', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = accountServer(store, { origin: ORIGIN, clientId: CLIENT }, verify);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener');
    base = `http://127.0.0.1:${address.port}`;
    const boot = await request('/api/session');
    expect(boot.body.codeSignIn).toBe(false);
    const cookie = boot.headers.get('set-cookie')!.split(';')[0];
    const response = await request(
      '/api/auth/google/code',
      'POST',
      { code: 'fixture-code' },
      cookie,
      boot.body.csrf,
    );
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'sign_in_not_configured' });
    expect(verifyCode).not.toHaveBeenCalled();
    expect((await request('/api/healthz')).status).toBe(200);
  });
  it('rejects missing sessions, duplicate cookies, origin mismatch and missing/wrong CSRF before verification', async () => {
    const boot = await request('/api/session'),
      cookie = boot.headers.get('set-cookie')!.split(';')[0];
    expect((await request('/api/save')).status).toBe(401);
    expect(
      (await request('/api/auth/google', 'POST', { credential: 'valid:a' }, cookie)).status,
    ).toBe(403);
    expect(
      (await request('/api/auth/google', 'POST', { credential: 'valid:a' }, cookie, 'wrong'))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/auth/google',
          'POST',
          { credential: 'valid:a' },
          cookie,
          boot.body.csrf,
          'https://evil.example.test',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/auth/google',
          'POST',
          { credential: 'valid:a' },
          cookie + '; ' + cookie,
          boot.body.csrf,
        )
      ).status,
    ).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });
  it('rotates login cookies and refuses invalid credentials', async () => {
    const boot = await request('/api/session'),
      initial = boot.headers.get('set-cookie')!.split(';')[0];
    const fail = await request(
      '/api/auth/google',
      'POST',
      { credential: 'invalid' },
      initial,
      boot.body.csrf,
    );
    expect(fail.status).toBe(401);
    expect(fail.body).toEqual({ error: 'auth_failed' });
    const ok = await request(
      '/api/auth/google',
      'POST',
      { credential: 'valid:a' },
      initial,
      boot.body.csrf,
    );
    expect(verify).toHaveBeenLastCalledWith('valid:a', boot.body.nonce);
    expect(ok.headers.get('set-cookie')!.split(';')[0]).not.toBe(initial);
    expect(ok.body.player).toEqual({ id: expect.any(String), name: 'Spirekeeper' });
    expect(ok.body).not.toHaveProperty('email');
    expect((await request('/api/save', 'GET', undefined, initial)).status).toBe(401);
  });
  it('requires authenticated ownership, explicit leases and exact revisions for cloud writes', async () => {
    const a = await actor('a'),
      b = await actor('b');
    const generation = store.generation;
    const lease = await request(
      '/api/save/lease',
      'POST',
      { generation, revision: 0, takeover: false },
      a.cookie,
      a.csrf,
    );
    const data = {
      generation,
      revision: 0,
      leaseToken: lease.body.leaseToken,
      writeId: randomUUID(),
      snapshot: snapshotFromSave(activeSave()),
    };
    expect((await request('/api/save', 'PUT', data, a.cookie, a.csrf)).status).toBe(200);
    expect((await request('/api/save', 'PUT', data, a.cookie, a.csrf)).body.revision).toBe(1);
    expect(
      (await request('/api/save', 'PUT', { ...data, writeId: randomUUID() }, a.cookie, a.csrf)).body
        .error,
    ).toBe('stale_revision');
    expect((await request('/api/save', 'PUT', data, b.cookie, b.csrf)).body.error).toBe(
      'lease_lost',
    );
    expect((await request('/api/save', 'GET', undefined, b.cookie)).body.snapshot).toBeNull();
    expect((await request('/api/save?userId=' + a.id, 'GET', undefined, b.cookie)).status).toBe(
      404,
    );
    expect(
      (await request('/api/save', 'PUT', { ...data, userId: a.id }, b.cookie, b.csrf)).status,
    ).toBe(400);
    expect(
      (
        await request(
          '/api/save/lease',
          'POST',
          { generation, revision: 1, takeover: false },
          a.cookie,
          a.csrf,
        )
      ).body.error,
    ).toBe('lease_held');
    expect(
      (
        await request(
          '/api/save/lease',
          'POST',
          { generation, revision: 1, takeover: true },
          a.cookie,
          a.csrf,
        )
      ).status,
    ).toBe(200);
  });
  it('rejects malformed saves with fixed public errors and no stored mutation', async () => {
    const a = await actor(),
      generation = store.generation;
    const lease = await request(
      '/api/save/lease',
      'POST',
      { generation, revision: 0, takeover: false },
      a.cookie,
      a.csrf,
    );
    const result = await request(
      '/api/save',
      'PUT',
      {
        generation,
        revision: 0,
        leaseToken: lease.body.leaseToken,
        writeId: randomUUID(),
        snapshot: { privateValue: 'do-not-echo' },
      },
      a.cookie,
      a.csrf,
    );
    expect(result.body).toEqual({ error: 'invalid_checkpoint' });
    expect(store.read(a.id).revision).toBe(0);
  });
  it('revokes logout and account deletion sessions, requires recent sign-in and deliberate deletion', async () => {
    const a = await actor('a');
    expect(
      (await request('/api/account', 'DELETE', { confirmation: 'no' }, a.cookie, a.csrf)).status,
    ).toBe(400);
    clock += LOGIN_MS + 1;
    expect(
      (await request('/api/account', 'DELETE', { confirmation: 'DELETE' }, a.cookie, a.csrf)).body
        .error,
    ).toBe('recent_sign_in_required');
    const fresh = await actor('a');
    expect(
      (
        await request(
          '/api/account',
          'DELETE',
          { confirmation: 'DELETE' },
          fresh.cookie,
          fresh.csrf,
        )
      ).body,
    ).toEqual({ deleted: true, backupRetentionDays: 7 });
    expect((await request('/api/save', 'GET', undefined, a.cookie)).status).toBe(401);
    const b = await actor('b');
    expect(
      (await request('/api/auth/logout', 'POST', {}, b.cookie, b.csrf)).headers.get('set-cookie'),
    ).toContain('Max-Age=0');
    expect((await request('/api/save', 'GET', undefined, b.cookie)).status).toBe(401);
  });
  it('limits authentication attempts and rejects oversized declared bodies before reading them', async () => {
    const boot = await request('/api/session'),
      cookie = boot.headers.get('set-cookie')!.split(';')[0];
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        base + '/api/auth/google',
        {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            Cookie: cookie,
            'X-CSRF-Token': boot.body.csrf,
            'Content-Type': 'application/json',
            'Content-Length': 20_000,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(413);
    let last;
    for (let i = 0; i < 21; i++)
      last = await request(
        '/api/auth/google',
        'POST',
        { credential: 'invalid' },
        cookie,
        boot.body.csrf,
      );
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBe('60');
  });
  it('returns a controlled size error for a chunked body and bounds simultaneous uploads', async () => {
    const boot = await request('/api/session');
    const cookie = boot.headers.get('set-cookie')!.split(';')[0];
    const headers = {
      Origin: ORIGIN,
      Cookie: cookie,
      'X-CSRF-Token': boot.body.csrf,
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
    };
    const oversized = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpRequest(base + '/api/auth/google', { method: 'POST', headers }, (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, text }));
      });
      req.on('error', reject);
      req.write('x'.repeat(9000));
      req.end('x'.repeat(9000));
    });
    expect(oversized).toEqual({
      status: 413,
      text: JSON.stringify({ error: 'payload_too_large' }),
    });
    const open = [] as ReturnType<typeof httpRequest>[];
    for (let i = 0; i < 2; i++) {
      await new Promise<void>((resolve) => {
        server.once('request', () => resolve());
        const req = httpRequest(base + '/api/auth/google', { method: 'POST', headers });
        req.on('error', () => undefined);
        req.write('{"credential":"');
        open.push(req);
      });
    }
    try {
      expect(
        (
          await request(
            '/api/auth/google',
            'POST',
            { credential: 'invalid' },
            cookie,
            boot.body.csrf,
          )
        ).body.error,
      ).toBe('service_busy');
      expect(server.maxConnections).toBe(32);
    } finally {
      for (const req of open) req.destroy();
    }
  });
  it('rejects cross-site bootstrap and non-JSON write bodies', async () => {
    const cross = await fetch(base + '/api/session', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(cross.status).toBe(403);
    await cross.arrayBuffer();
    const boot = await request('/api/session');
    const response = await fetch(base + '/api/auth/google', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: boot.headers.get('set-cookie')!.split(';')[0],
        'X-CSRF-Token': boot.body.csrf,
        'Content-Type': 'text/plain',
      },
      body: '{}',
    });
    expect(response.status).toBe(415);
    await response.arrayBuffer();
  });
  it('does not leak internal verification errors', async () => {
    verify.mockRejectedValueOnce(new Error('sensitive-provider-detail'));
    const boot = await request('/api/session');
    const result = await request(
      '/api/auth/google',
      'POST',
      { credential: 'valid:a' },
      boot.headers.get('set-cookie')!.split(';')[0],
      boot.body.csrf,
    );
    expect(result.body).toEqual({ error: 'service_unavailable' });
  });
});

describe('service configuration and resource limits', () => {
  it('requires HTTPS except explicit loopback development', () => {
    expect(() => validateConfig({ origin: ORIGIN, clientId: CLIENT })).not.toThrow();
    for (const origin of [
      'http://game.example.test',
      'https://game.example.test/',
      'https://user@game.example.test',
      'file:///tmp/test',
    ])
      expect(() => validateConfig({ origin, clientId: CLIENT })).toThrow();
    expect(() =>
      validateConfig({ origin: 'http://localhost:5173', clientId: CLIENT, development: true }),
    ).not.toThrow();
    expect(() =>
      validateConfig({ origin: 'http://example.test', clientId: CLIENT, development: true }),
    ).toThrow();
  });
  it('bounds rate buckets, expires them and keeps limits per key', () => {
    let clock = 0;
    const limiter = new RateLimiter(() => clock);
    expect(limiter.allow('a', 1, 100)).toBe(true);
    expect(limiter.allow('a', 1, 100)).toBe(false);
    expect(limiter.allow('b', 1, 100)).toBe(true);
    for (let i = 0; i < 10_000; i++) limiter.allow('user-' + i, 1, 100);
    expect(limiter.allow('another', 1, 100)).toBe(false);
    clock = 101;
    expect(limiter.allow('another', 1, 100)).toBe(true);
  });
});
