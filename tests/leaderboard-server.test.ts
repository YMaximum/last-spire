import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/store';
import { accountServer } from '../server/app';
import { createBackup, restoreBackup } from '../server/backups';
import { parseBoard } from '../server/leaderboard';
import { emptySave } from '../src/persistence/storage';
import { createRun } from '../src/game/engine';
import type { RunV3 } from '../src/game/types';
import { snapshotRunes } from '../src/game/controls';
import { snapshotFromSave } from '../src/account/snapshot';
import { BALANCE_EDITION, type BoardKey } from '../src/model/leaderboard';

const roots: string[] = [],
  stores: AccountStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const board: BoardKey = {
  stage: 0,
  difficulty: 0,
  balanceEdition: BALANCE_EDITION,
  division: 'standard',
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spire-board-'));
  roots.push(root);
  const store = new AccountStore(root);
  stores.push(store);
  const login = (subject: string) =>
    store.login(store.bootstrap().session, { subject, name: 'Private Google Name' });
  return { root, store, login };
}
function completed(waves = 10, seconds = 30, division: 'standard' | 'quick' = 'standard') {
  const save = emptySave();
  const run = createRun(save.profile, 'bastion', 0, 0, 123, {
    mode: division === 'quick' ? 'quick' : 'normal',
    runes: snapshotRunes(save.progression.runes),
  });
  run.id = `synthetic-${randomUUID()}`;
  run.endless = true;
  run.phase = 'ended';
  run.wave = waves + 1;
  run.time = seconds + 1;
  run.leaderboard = {
    version: 1,
    balanceEdition: BALANCE_EDITION,
    eligible: true,
    lastClearedWave: waves,
    lastClearedSeconds: seconds,
  };
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: structuredClone(save.progression.autocast),
  };
  return save;
}
function upload(store: AccountStore, userId: string, save = completed()) {
  const current = store.read(userId),
    lease = store.acquireLease(userId, store.generation, current.revision, true);
  store.write(
    userId,
    store.generation,
    current.revision,
    lease.leaseToken,
    randomUUID(),
    snapshotFromSave(save),
  );
  return save.run?.id ?? '';
}
function publish(store: AccountStore, userId: string, runId: string) {
  return store.leaderboard.publish(userId, runId, store.leaderboard.profile(userId).username!);
}

describe('casual leaderboard storage', () => {
  it('keeps profile reads bounded while preserving withdrawal access to older published entries', () => {
    const { store, login } = fixture(),
      actor = login('bounded-profile');
    store.leaderboard.setUsername(actor.player.id, 'OldChampion');
    const original = upload(store, actor.player.id);
    publish(store, actor.player.id, original);
    store.transaction(() => {
      for (let i = 0; i < 501; i++) {
        const save = completed(1, 30);
        store.leaderboard.retain(actor.player.id, snapshotFromSave(save));
      }
    });
    const profile = store.leaderboard.profile(actor.player.id);
    expect(profile.results).toHaveLength(500);
    expect(profile.results[0]).toMatchObject({ runId: original, published: true });
    store.leaderboard.withdraw(actor.player.id, original);
    expect(store.leaderboard.board(board).entries).toEqual([]);
  });
  it('requires an explicit unique username and an owned receipt; retains retries across settlement writes', () => {
    const { store, login } = fixture(),
      a = login('a'),
      b = login('b');
    expect(store.leaderboard.profile(a.player.id)).toEqual({ username: null, results: [] });
    for (const name of ['admin', 'AA', 'a b', '<script>', 'Ａbc'])
      expect(() => store.leaderboard.setUsername(a.player.id, name)).toThrow();
    store.leaderboard.setUsername(a.player.id, 'Player_One');
    expect(() => store.leaderboard.setUsername(b.player.id, 'player_one')).toThrow(
      'username_taken',
    );
    store.leaderboard.setUsername(b.player.id, 'Player_Two');
    const runId = upload(store, a.player.id);
    expect(() => store.leaderboard.publish(a.player.id, runId, 'OldUsername')).toThrow(
      'username_changed',
    );
    expect(store.leaderboard.board(board).entries).toEqual([]);
    expect(() => publish(store, b.player.id, runId)).toThrow('result_not_found');
    upload(store, a.player.id, emptySave());
    expect(publish(store, a.player.id, runId)).toEqual({ published: true });
    expect(publish(store, a.player.id, runId)).toEqual({ published: true });
    const entry = store.leaderboard.board(board, a.player.id);
    expect(entry.entries).toHaveLength(1);
    expect(entry.own).toEqual(entry.entries[0]);
    expect(entry.entries[0]).toMatchObject({ username: 'Player_One', score: 1000, rank: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/Private Google Name|userId|runId|subject/);
    store.leaderboard.withdraw(a.player.id, runId);
    expect(store.leaderboard.board(board).entries).toEqual([]);
    expect(store.leaderboard.profile(a.player.id).results[0].published).toBe(false);
  });
  it('ranks ties equally, uses checkpoint time, replaces only stronger scores and separates pace boards', () => {
    const { store, login } = fixture();
    const a = login('a'),
      b = login('b'),
      c = login('c');
    for (const [user, name] of [
      [a, 'PlayerA'],
      [b, 'PlayerB'],
      [c, 'PlayerC'],
    ] as const)
      store.leaderboard.setUsername(user.player.id, name);
    const first = upload(store, a.player.id, completed(12, 40));
    publish(store, a.player.id, first);
    publish(store, b.player.id, upload(store, b.player.id, completed(12, 40)));
    publish(store, c.player.id, upload(store, c.player.id, completed(11, 1)));
    expect(store.leaderboard.board(board).entries.map((e) => e.rank)).toEqual([1, 1, 3]);
    expect(publish(store, a.player.id, upload(store, a.player.id, completed(11, 1)))).toEqual({
      published: false,
    });
    const faster = upload(store, a.player.id, completed(12, 30));
    publish(store, a.player.id, faster);
    expect(store.leaderboard.board(board).entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    store.leaderboard.withdraw(a.player.id, first);
    expect(store.leaderboard.board(board).entries).toHaveLength(3);
    publish(store, a.player.id, upload(store, a.player.id, completed(20, 30, 'quick')));
    expect(store.leaderboard.board({ ...board, division: 'quick' }).entries).toHaveLength(1);
    expect(store.leaderboard.board({ ...board, stage: 1 }).entries).toEqual([]);
    expect(store.leaderboard.board({ ...board, balanceEdition: 'previous' }).entries).toEqual([]);
  });
  it('caps public results at 100 while returning own rank outside that window', () => {
    const { store, login } = fixture();
    let last = '';
    for (let i = 0; i < 102; i++) {
      const a = login('user' + i);
      last = a.player.id;
      store.leaderboard.setUsername(last, 'Player' + i);
      publish(store, last, upload(store, last, completed(102 - i, 30)));
    }
    const result = store.leaderboard.board(board, last);
    expect(result.entries).toHaveLength(100);
    expect(result.own?.rank).toBe(102);
  });
  it('migrates old databases and preserves deletion intent through backup recovery', async () => {
    const { store, root, login } = fixture(),
      a = login('a'),
      b = login('b');
    for (const [u, name] of [
      [a, 'PlayerA'],
      [b, 'PlayerB'],
    ] as const) {
      store.leaderboard.setUsername(u.player.id, name);
      publish(store, u.player.id, upload(store, u.player.id));
    }
    const backup = await createBackup(store);
    store.deleteAccount(a.session);
    for (const table of ['leaderboard_profiles', 'leaderboard_results', 'leaderboard_entries'])
      expect(
        store.db.prepare(`SELECT count(*) n FROM ${table} WHERE userId=?`).get(a.player.id)!.n,
      ).toBe(0);
    const target = join(root, 'restore');
    await restoreBackup(backup, target, store.deletionJournal);
    const restored = new AccountStore(target, Date.now, undefined, store.deletionJournal);
    stores.push(restored);
    expect(restored.leaderboard.board(board).entries.map((e) => e.username)).toEqual(['PlayerB']);
    expect(restored.session(b.raw)).toBeNull();
    expect(restored.generation).not.toBe(store.generation);
  });
  it('upgrades a schema-one database without losing existing account saves', () => {
    const { store, root, login } = fixture(),
      a = login('a');
    upload(store, a.player.id);
    store.db.exec(
      'DROP TABLE leaderboard_entries; DROP TABLE leaderboard_results; DROP TABLE leaderboard_profiles; PRAGMA user_version=1;',
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const migrated = new AccountStore(root);
    stores.push(migrated);
    expect(migrated.db.prepare('PRAGMA user_version').get()!.user_version).toBe(2);
    expect(migrated.read(a.player.id).revision).toBe(1);
    expect(migrated.leaderboard.profile(a.player.id)).toEqual({ username: null, results: [] });
  });
  it('never publishes or retains an active, historical or normal run as an Endless result', () => {
    const { store, login } = fixture(),
      a = login('a');
    const active = completed();
    active.run!.phase = 'combat';
    upload(store, a.player.id, active);
    const old = completed();
    (old.run as RunV3).leaderboard!.eligible = false;
    upload(store, a.player.id, old);
    const normal = completed();
    normal.run!.endless = false;
    upload(store, a.player.id, normal);
    expect(store.leaderboard.profile(a.player.id).results).toEqual([]);
  });
  it('rejects duplicate, unknown, malformed and out of range board parameters', () => {
    expect(
      parseBoard(
        new URLSearchParams('stage=2&difficulty=5&balanceEdition=spire-e1&division=quick'),
      ),
    ).toMatchObject({ stage: 2, difficulty: 5 });
    for (const query of [
      'stage=0&difficulty=0',
      'stage=0&stage=1&difficulty=0&balanceEdition=spire-e1&division=standard',
      'stage=3&difficulty=0&balanceEdition=spire-e1&division=standard',
      'stage=0&difficulty=11&balanceEdition=spire-e1&division=standard',
    ])
      expect(() => parseBoard(new URLSearchParams(query))).toThrow('invalid_board');
  });
});

describe('leaderboard API guards', () => {
  it('keeps guest reads session-free and protects identity, CSRF, confirmation and caller-selected result fields', async () => {
    const { store, login } = fixture(),
      a = login('a');
    const server = accountServer(
      store,
      {
        origin: 'https://game.example.test',
        clientId: '123456789-test.apps.googleusercontent.com',
      },
      async () => ({ subject: 'a', name: 'Private' }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port,
      url = `http://127.0.0.1:${port}`;
    const headers = {
      'content-type': 'application/json',
      origin: 'https://game.example.test',
      cookie: `__Host-last-spire=${a.raw}`,
      'x-csrf-token': a.session.csrf,
      'x-last-spire-player': a.player.id,
    };
    const request = (
      path: string,
      method = 'GET',
      body?: unknown,
      extra: Record<string, string> = {},
    ) =>
      fetch(url + path, {
        method,
        headers: { ...headers, ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      const count = store.db.prepare('SELECT count(*) n FROM sessions').get()!.n;
      const publicReply = await fetch(
        url + '/api/leaderboard?stage=0&difficulty=0&balanceEdition=spire-e1&division=standard',
      );
      expect(publicReply.status).toBe(200);
      expect(publicReply.headers.has('set-cookie')).toBe(false);
      expect(store.db.prepare('SELECT count(*) n FROM sessions').get()!.n).toBe(count);
      expect(
        (
          await request('/api/leaderboard/profile', 'GET', undefined, {
            'x-last-spire-player': 'another',
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await request(
            '/api/leaderboard/profile',
            'PUT',
            { username: 'PlayerA' },
            { origin: 'https://wrong.test' },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            '/api/leaderboard/profile',
            'PUT',
            { username: 'PlayerA' },
            { 'x-csrf-token': 'wrong' },
          )
        ).status,
      ).toBe(403);
      expect(
        (await request('/api/leaderboard/profile', 'PUT', { username: 'PlayerA' })).status,
      ).toBe(200);
      const runId = upload(store, a.player.id);
      expect(
        (
          await request('/api/leaderboard/publish', 'POST', {
            runId,
            expectedUsername: 'PlayerA',
            confirmation: 'no',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request('/api/leaderboard/publish', 'POST', {
            runId,
            expectedUsername: 'PlayerA',
            confirmation: 'PUBLISH',
            score: 99999,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request('/api/leaderboard/publish', 'POST', {
            runId,
            expectedUsername: 'PreviousName',
            confirmation: 'PUBLISH',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request('/api/leaderboard/publish', 'POST', {
            runId,
            expectedUsername: 'PlayerA',
            confirmation: 'PUBLISH',
          })
        ).status,
      ).toBe(200);
      expect((await request('/api/leaderboard/profile', 'GET')).status).toBe(200);
      expect((await request('/api/leaderboard/entry', 'DELETE', { runId })).status).toBe(200);
      expect(
        (await request('/api/leaderboard/profile', 'PUT', { username: 'x'.repeat(1100) })).status,
      ).toBe(413);
      let response: Response | undefined;
      for (let i = 0; i < 21; i++)
        response = await request('/api/leaderboard/profile', 'PUT', { username: 'PlayerA' });
      expect(response!.status).toBe(429);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
