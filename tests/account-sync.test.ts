import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { accountServer } from '../server/app';
import { AccountStore } from '../server/store';
import { AccountApi, SyncError } from '../src/account/api';
import { AccountSync, compareCheckpoint, scopeFor, type SyncHost } from '../src/account/sync';
import {
  fingerprint,
  readRecovery,
  readBase,
  rememberPlayer,
  writeBase,
} from '../src/account/cache';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';
import {
  emptySave,
  saveGame,
  parseGame,
  readRawSave,
  type SaveScope,
  type SaveV3,
} from '../src/persistence/storage';

const CLIENT = '12345678-test.apps.googleusercontent.com',
  ORIGIN = 'http://localhost:5173';
let server: Server, store: AccountStore, directory: string, address: string;
const controllers: AccountSync[] = [];
async function resetDBs() {
  for (const name of ['last-spire', 'last-spire-account-cache'])
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = r.onblocked = () => reject(new Error('database blocked'));
    });
}
beforeEach(async () => {
  await resetDBs();
  directory = mkdtempSync(join(tmpdir(), 'last-spire-sync-test-'));
  store = new AccountStore(directory);
  server = accountServer(
    store,
    { origin: ORIGIN, clientId: CLIENT, development: true },
    async (credential) => ({ subject: credential, name: 'Spirekeeper' }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  address = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
afterEach(async () => {
  controllers.splice(0).forEach((c) => c.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
function connection() {
  let cookie = '',
    loseNextWrite = false,
    disconnected = false;
  const requests: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    requests.push({ path: String(path), init });
    if (disconnected) throw new Error('offline');
    const res = await fetch(address + path, {
      ...init,
      headers: { ...init?.headers, Origin: ORIGIN, Cookie: cookie },
    });
    const next = res.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    if (loseNextWrite && init?.method === 'PUT') {
      loseNextWrite = false;
      await res.arrayBuffer();
      throw new Error('response lost');
    }
    return res;
  };
  return {
    api: new AccountApi(fetcher),
    requests,
    loseWrite: () => {
      loseNextWrite = true;
    },
    offline: (value: boolean) => {
      disconnected = value;
    },
  };
}
function host(initial = emptySave()) {
  let data = parseGame(initial),
    scope: SaveScope = 'guest';
  const changed = vi.fn();
  const h: SyncHost = {
    save: () => data,
    scope: () => scope,
    persist: async () => {
      await saveGame(data, false, scope);
    },
    activate: async (next, target) => {
      await saveGame(data, false, scope);
      data = parseGame({ ...next, settings: data.settings });
      scope = target;
      await saveGame(data, true, scope);
    },
    changed,
  };
  return h;
}
async function signedIn(subject = 'google-test-player', initial = emptySave()) {
  const c = connection(),
    h = host(initial),
    release = vi.fn();
  const sync = new AccountSync(h, c.api, async () => release);
  controllers.push(sync);
  await sync.initialize();
  await sync.signIn(subject);
  expect(sync.view.phase).toBe('choice');
  return { c, h, sync, release };
}
describe('Google account / cloud checkpoint flow', () => {
  it('resumes this tab’s writer reservation after refresh without an unnecessary takeover', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    });
    const { c, sync } = await signedIn();
    await sync.choose('guest');
    sync.dispose();
    const nextHost = host();
    const next = new AccountSync(nextHost, c.api, async () => () => {});
    controllers.push(next);
    await next.initialize();
    expect(next.view.phase).toBe('synced');
    expect(next.active).toBe(true);
    await next.returnToGuest(true);
    expect(values.size).toBe(0);
  });
  it('does not queue uploads or flash pending for presentation-only saves', async () => {
    const { h, sync } = await signedIn();
    await sync.choose('guest');
    h.save().settings.effects = 'low';
    h.save().settings.uiScale = 150;
    await sync.onLocalSave(h.scope());
    expect(sync.view.phase).toBe('synced');
  });
  it('does not adopt guest data on sign-in and preserves it when explicitly copied', async () => {
    const guest = emptySave();
    guest.profile.credits = 80;
    guest.settings.effects = 'low';
    const { c, h, sync } = await signedIn(undefined, guest);
    expect(h.scope()).toBe('guest');
    expect((await c.api.read()).snapshot).toBeNull();
    await sync.choose('guest');
    expect(sync.view.phase).toBe('synced');
    expect(sync.active).toBe(true);
    expect((await c.api.read()).snapshot?.profile.credits).toBe(80);
    expect(((await readRawSave()) as SaveV3).profile.credits).toBe(80);
    h.save().profile.credits = 101;
    await sync.sync();
    expect((await c.api.read()).snapshot?.profile.credits).toBe(101);
    expect(((await readRawSave()) as SaveV3).profile.credits).toBe(80);
    await sync.returnToGuest(true);
    expect(h.scope()).toBe('guest');
    expect(h.save().profile.credits).toBe(80);
    expect(sync.view.player).toBeNull();
    expect((await c.api.bootstrap()).player).toBeNull();
  });
  it('uses a stable queue deadline despite five-second local autosaves', async () => {
    const { h, sync } = await signedIn();
    await sync.choose('guest');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const action = vi.spyOn(sync, 'sync').mockResolvedValue();
    for (let i = 0; i < 3; i++) {
      h.save().profile.credits++;
      await sync.onLocalSave(h.scope());
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(action).toHaveBeenCalledTimes(1);
  });
  it('keeps offline changes, detects a two-device conflict, and never merges currencies', async () => {
    const first = await signedIn();
    await first.sync.choose('guest');
    first.h.save().profile.credits = 40;
    first.c.offline(true);
    await first.sync.sync();
    expect(first.sync.view.phase).toBe('offline');
    // Model a second browser: it has no remembered active-account pointer.
    await rememberPlayer(null);
    const second = await signedIn();
    await second.sync.choose('cloud');
    expect(second.sync.view.phase).toBe('lease');
    await second.sync.choose('cloud', true);
    expect(second.sync.view.phase).toBe('synced');
    second.h.save().profile.credits = 90;
    await second.sync.sync();
    first.c.offline(false);
    await first.sync.refresh();
    expect(first.sync.view.phase).toBe('conflict');
    expect(first.h.save().profile.credits).toBe(40);
    expect((await first.c.api.read()).snapshot?.profile.credits).toBe(90);
    await first.sync.choose('local', true);
    expect((await first.c.api.read()).snapshot?.profile.credits).toBe(40);
    expect((await readRecovery(first.sync.view.player!.id)).length).toBeGreaterThan(0);
  });
  it('recognizes an accepted write after a lost response and retains newer local progress', async () => {
    const { c, h, sync } = await signedIn();
    await sync.choose('guest');
    h.save().profile.credits = 60;
    c.loseWrite();
    await sync.sync();
    expect(sync.view.phase).toBe('offline');
    expect((await c.api.read()).revision).toBe(2);
    h.save().profile.credits = 61;
    await sync.sync();
    expect(sync.view.phase).toBe('synced');
    const remote = await c.api.read();
    expect(remote.revision).toBe(3);
    expect(remote.snapshot?.profile.credits).toBe(61);
    expect((await c.api.history()).map((r) => r.revision)).toEqual([2, 1]);
  });
  it('refuses to replace a checkpoint if the reviewed source changed', async () => {
    const { h, sync, c } = await signedIn();
    const hash = await fingerprint(snapshotFromSave(h.save()));
    h.save().profile.credits = 12;
    await sync.choose('guest', false, hash);
    expect(sync.view.phase).toBe('error');
    expect((await c.api.read()).snapshot).toBeNull();
    expect(h.scope()).toBe('guest');
  });
  it('restores an account cache offline and keeps presentation settings on the device', async () => {
    const { h, sync, c } = await signedIn();
    await sync.choose('guest');
    h.save().profile.credits = 82;
    await h.persist();
    const player = sync.view.player!;
    sync.dispose();
    const nextHost = host();
    nextHost.save().settings.effects = 'low';
    c.offline(true);
    const resumed = new AccountSync(nextHost, c.api, async () => () => {});
    controllers.push(resumed);
    await resumed.initialize();
    expect(resumed.view.phase).toBe('offline');
    expect(nextHost.scope()).toBe(scopeFor(player));
    expect(nextHost.save().profile.credits).toBe(82);
    expect(nextHost.save().settings.effects).toBe('low');
  });
  it('requires a comparison after database-generation changes even if content matches', async () => {
    const { sync, c, h } = await signedIn();
    await sync.choose('guest');
    store.db.prepare("UPDATE metadata SET value=? WHERE key='generation'").run('z'.repeat(43));
    await sync.refresh();
    expect(sync.view.phase).toBe('conflict');
    expect(h.save().profile.credits).toBe(0);
    await sync.choose('cloud', true);
    expect(sync.view.phase).toBe('synced');
    expect((await readBase(sync.view.player!.id))?.generation).toBe(
      (await c.api.read()).generation,
    );
  });
  it('fails closed when another tab reserves the account cache', async () => {
    const { c, h, sync } = await signedIn();
    const other = new AccountSync(h, c.api, async () => {
      throw new Error('Account already open in another tab.');
    });
    controllers.push(other);
    await other.initialize();
    await other.choose('guest');
    expect(other.view.phase).toBe('error');
    expect(h.scope()).toBe('guest');
    expect((await c.api.read()).snapshot).toBeNull();
    expect(sync.view.phase).toBe('choice');
  });
  it('does not assign another cookie account’s data to the active account', async () => {
    const { c, h, sync } = await signedIn();
    await sync.choose('guest');
    const originalId = sync.view.player!.id;
    await c.api.bootstrap();
    await c.api.login('different-google-player');
    await sync.refresh();
    expect(sync.view.phase).toBe('reauth');
    expect(h.scope()).toBe(`account:${originalId}`);
    await expect(c.api.request('save', 'GET')).resolves.toBeDefined();
    c.api.session!.player = { id: originalId, name: 'old session' };
    await expect(c.api.read()).rejects.toMatchObject({ code: 'session_changed' });
  });
  it('deletes only the signed-in account and returns to the untouched guest profile', async () => {
    const guest = emptySave();
    guest.profile.credits = 45;
    const { c, h, sync } = await signedIn(undefined, guest);
    await sync.choose('guest');
    const id = sync.view.player!.id;
    h.save().profile.credits = 99;
    await sync.sync();
    await sync.deleteAccount();
    expect(sync.view.phase).toBe('guest');
    expect(h.save().profile.credits).toBe(45);
    expect(await readRawSave(`account:${id}`)).toBeUndefined();
    expect(await readRecovery(id)).toEqual([]);
    expect((await c.api.bootstrap()).player).toBeNull();
  });
});
describe('recovery from a rejected first checkpoint', () => {
  it('retries a rejected checkpoint after the service is repaired without choosing progress again', async () => {
    const { c, h, sync } = await signedIn();
    h.save().profile.credits = 125;
    const write = vi
      .spyOn(c.api, 'write')
      .mockRejectedValueOnce(new SyncError('invalid_checkpoint', 400));
    await sync.choose('guest');
    expect(sync.active).toBe(true);
    expect(sync.view.phase).toBe('error');
    expect(sync.view.message).toContain('matching cloud service update');
    expect(h.save().profile.credits).toBe(125);
    expect((await c.api.read()).snapshot).toBeNull();
    await sync.sync();
    expect(write).toHaveBeenCalledTimes(2);
    expect(sync.view.phase).toBe('synced');
    expect((await c.api.read()).snapshot?.profile.credits).toBe(125);
    expect(h.save().profile.credits).toBe(125);
  });
  it('resumes the reviewed local branch after reload while the cloud remains empty', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const { c, h, sync } = await signedIn();
    h.save().profile.credits = 87;
    vi.spyOn(c.api, 'write').mockRejectedValueOnce(new SyncError('invalid_checkpoint', 400));
    await sync.choose('guest');
    expect(sync.view.phase).toBe('error');
    sync.dispose();
    const nextHost = host();
    const resumed = new AccountSync(nextHost, c.api, async () => () => {});
    controllers.push(resumed);
    await resumed.initialize();
    expect(resumed.view.phase).toBe('local');
    expect(nextHost.save().profile.credits).toBe(87);
    await resumed.sync();
    expect(resumed.view.phase).toBe('synced');
    expect((await c.api.read()).snapshot?.profile.credits).toBe(87);
  });
});

describe('browser transport rejects unsafe or invalid responses', () => {
  it('does not call the browser’s native fetch with an AccountApi receiver', async () => {
    let receiver: unknown;
    vi.stubGlobal('fetch', function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        new Response('not configured', { headers: { 'Content-Type': 'text/html' } }),
      );
    });
    await expect(new AccountApi().bootstrap()).rejects.toMatchObject({
      code: 'service_unavailable',
    });
    expect(receiver).not.toBeInstanceOf(AccountApi);
  });
  it('keeps credentials same-origin and binds save requests to the verified account', async () => {
    const { c, sync } = await signedIn();
    await sync.choose('guest');
    const request = c.requests.find((r) => r.init?.method === 'PUT')!;
    expect(request.init?.credentials).toBe('same-origin');
    expect(request.init?.redirect).toBe('error');
    expect((request.init?.headers as Record<string, string>)['X-Last-Spire-Player']).toBe(
      sync.view.player!.id,
    );
    expect(JSON.parse(String(request.init?.body))).not.toHaveProperty('accountId');
  });
  it('refuses HTML fallbacks and unvalidated session values', async () => {
    const html = new AccountApi(
      async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(html.bootstrap()).rejects.toMatchObject({ code: 'service_unavailable' });
    const bad = new AccountApi(async () =>
      Response.json({ clientId: CLIENT, player: { id: '__proto__' } }),
    );
    await expect(bad.bootstrap()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
