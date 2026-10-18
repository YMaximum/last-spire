import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptySave,
  loadGame,
  saveGame,
  settleGame,
  readRawSave,
  readLegacyBackup,
  loadDeviceSettings,
  deleteAccountCache,
  type SaveScope,
} from '../src/v3/storage';
import { createRun, rewardForRun } from '../src/v3/engine';
import { snapshotRunes } from '../src/v3/controls';
import {
  archiveSave,
  fingerprint,
  readBase,
  readRecovery,
  rememberPlayer,
  rememberedPlayer,
  writeBase,
} from '../src/account/cache';
import { snapshotFromSave } from '../src/account/snapshot';
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const a: SaveScope = `account:${A}`,
  b: SaveScope = `account:${B}`;
export async function resetAccountDatabases() {
  for (const name of ['last-spire', 'last-spire-account-cache'])
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = req.onblocked = () => reject(new Error('database blocked'));
    });
}
beforeEach(resetAccountDatabases);
describe('account-local save isolation', () => {
  it('preserves the original guest root and separates both account profiles', async () => {
    for (const [scope, credits] of [
      ['guest', 84],
      [a, 120],
      [b, 30],
    ] as const) {
      const save = emptySave();
      save.profile.credits = credits;
      await saveGame(save, false, scope);
    }
    expect((await loadGame()).profile.credits).toBe(84);
    expect((await loadGame(a)).profile.credits).toBe(120);
    expect((await loadGame(b)).profile.credits).toBe(30);
    expect(await readRawSave('account:33333333-3333-4333-8333-333333333333')).toBeUndefined();
  });
  it('captures the requested scope before an asynchronous write; no mutable account pointer', async () => {
    let selected: SaveScope = a;
    const first = emptySave();
    first.profile.credits = 81;
    const queued = saveGame(first, false, selected);
    selected = b;
    const second = emptySave();
    second.profile.credits = 19;
    await Promise.all([queued, saveGame(second, false, selected)]);
    expect((await loadGame(a)).profile.credits).toBe(81);
    expect((await loadGame(b)).profile.credits).toBe(19);
    expect(await readRawSave()).toBeUndefined();
    expect(await readLegacyBackup(a)).toBeUndefined();
  });
  it('settles once within an account without mixing guest or another account ledger', async () => {
    const save = emptySave();
    save.run = createRun(save.profile, 'bastion', 0, 0, 423, {
      mode: 'normal',
      runes: snapshotRunes(save.progression.runes),
    });
    save.run.phase = 'ended';
    save.run.wave = 35;
    save.run.kills = 150;
    save.progression.active = {
      runId: save.run.id,
      rulesVersion: 3,
      runes: snapshotRunes(save.progression.runes),
      autocast: save.progression.autocast,
    };
    const reward = rewardForRun(save.run);
    await saveGame(save, false, a);
    await Promise.all([settleGame(save, a), settleGame(save, a)]);
    await saveGame(save, false, a); // stale autosave must not reopen rewards
    expect((await loadGame(a)).profile.credits).toBe(reward);
    expect((await loadGame(a)).run?.settled).toBe(true);
    expect((await loadGame(b)).profile.credits).toBe(0);
    expect((await loadGame()).profile.settledRuns).toHaveLength(0);
  });
  it('keeps device preferences outside synchronized progress', async () => {
    const save = emptySave();
    save.settings.effects = 'low';
    save.settings.uiScale = 130;
    await saveGame(save, false, a);
    expect((await loadDeviceSettings())?.uiScale).toBe(130);
    expect(snapshotFromSave(save)).not.toHaveProperty('settings');
    await deleteAccountCache(a);
    expect(await readRawSave(a)).toBeUndefined();
    expect((await loadDeviceSettings())?.effects).toBe('low');
    await expect(deleteAccountCache('guest')).rejects.toThrow('Guest');
  });
  it('rejects arbitrary storage keys and protects an invalid account checkpoint', async () => {
    await expect(loadGame('root' as SaveScope)).rejects.toThrow('context');
    await expect(saveGame(emptySave(), false, 'account:__proto__')).rejects.toThrow('context');
    expect(await readRawSave()).toBeUndefined();
  });
});
describe('account recovery cache', () => {
  it('bounds recovery to five complete checkpoints, isolated by account', async () => {
    for (let i = 0; i < 7; i++) {
      const s = emptySave();
      s.profile.credits = i;
      await archiveSave(A, s, 'Before replacement');
    }
    expect((await readRecovery(A)).map((r) => r.save.profile.credits)).toEqual([6, 5, 4, 3, 2]);
    expect(await readRecovery(B)).toEqual([]);
  });
  it('records a verified account pointer and comparison base without session or lease tokens', async () => {
    await rememberPlayer({ id: A, name: 'Spirekeeper' });
    expect((await rememberedPlayer())?.id).toBe(A);
    const base = {
      generation: 'a'.repeat(43),
      revision: 2,
      hash: await fingerprint(snapshotFromSave(emptySave())),
    };
    await writeBase(A, base);
    expect(await readBase(A)).toEqual(base);
    expect(await readBase(B)).toBeNull();
    await rememberPlayer(null);
    expect(await rememberedPlayer()).toBeNull();
  });
});
