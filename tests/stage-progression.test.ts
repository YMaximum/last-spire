import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptySave,
  parseGame,
  exportGame,
  saveGame,
  loadGame,
  readLegacyBackup,
  readRawSave,
  settleInMemory,
  settleGame,
  type SaveScope,
} from '../src/persistence/storage';
import { emptySave as emptyV2 } from '../src/legacy/runeforged/storage';
import { defaultProfile, defaultSettings } from '../src/legacy/classic/storage';
const emptyV1 = () => ({
  version: 1 as const,
  profile: defaultProfile(),
  run: null,
  settings: defaultSettings(),
});
import { createRun, step, continueEndless, retire } from '../src/game/engine';
import { recordStageClear } from '../src/game/stage-progress';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';
import type { RunMode } from '../src/game/types';

function checkpoint(mode: RunMode = 'normal', stage = 0, difficulty = 0) {
  const save = emptySave();
  const run = createRun(save.profile, 'bastion', stage, difficulty, 701, {
    mode,
    evolutionVersion: 0,
  });
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: save.progression.autocast,
  };
  return { save, run };
}
function oldEnvelope() {
  const { save, run } = checkpoint();
  delete run.shopVersion;
  delete run.encounterVersion;
  delete run.discoveries;
  const { stages: _, bestiary: __, ...progression } = save.progression;
  return { ...save, version: 3, progression };
}
async function putRaw(value: unknown, scope: SaveScope) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('last-spire', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('save');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('save', 'readwrite');
    tx.objectStore('save').put(value, scope === 'guest' ? 'root' : scope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('last-spire');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

describe('independent stage difficulty access', () => {
  it('preserves settlement of older saves using internal difficulty tiers above the launch catalog', () => {
    const { save, run } = checkpoint('normal', 0, 7);
    run.cleared = true;
    retire(run);
    const settled = settleInMemory(save);
    expect(settled.progression.stages[0]).toEqual({
      unlockedDifficulty: 5,
      clearedDifficulties: [],
      legacyClear: true,
    });
    expect(settled.progression.records[0].difficulty).toBe(7);
    expect(parseGame(exportGame(settled)).run).toEqual(settled.run);
  });
  it('starts every stage at Normal, and clearing one stage changes only that stage', () => {
    const { save, run } = checkpoint();
    run.cleared = true;
    recordStageClear(save.profile, save.progression.stages, run);
    expect(save.profile.stageUnlocked).toBe(2);
    expect(save.progression.stages.map((s) => s.unlockedDifficulty)).toEqual([1, 0, 0]);
    expect(save.progression.stages.map((s) => s.clearedDifficulties)).toEqual([[0], [], []]);
    recordStageClear(save.profile, save.progression.stages, run);
    expect(save.progression.stages[0].clearedDifficulties).toEqual([0]);
    run.stage = 1;
    recordStageClear(save.profile, save.progression.stages, run);
    expect(save.progression.stages.map((s) => s.unlockedDifficulty)).toEqual([1, 1, 0]);
    expect(save.profile.stageUnlocked).toBe(3);
    run.stage = 0;
    run.difficulty = 5;
    recordStageClear(save.profile, save.progression.stages, run);
    expect(save.progression.stages[0].unlockedDifficulty).toBe(5);
    expect(save.progression.stages[1].unlockedDifficulty).toBe(1);
  });
  it.each(['quick', 'normal', 'endless'] as const)(
    '%s campaign clear is secured before extraction and survives duplicate settlement',
    async (mode) => {
      const { save, run } = checkpoint(mode);
      run.wave = mode === 'quick' ? 50 : 100;
      run.waveTime = 18;
      run.spawned = run.spawnTotal;
      run.enemies = [];
      step(run);
      expect(run.cleared).toBe(true);
      const secured = parseGame(exportGame(save));
      expect(secured.progression.stages[0].clearedDifficulties).toEqual([0]);
      expect(secured.profile.stageUnlocked).toBe(2);
      expect(secured.progression.stages[1].unlockedDifficulty).toBe(0);
      if (mode === 'normal') {
        continueEndless(run);
        expect(run.phase).toBe('combat');
        expect(run.endless).toBe(true);
      }
      retire(run);
      await saveGame(save);
      const settled = await settleGame(save);
      const duplicate = await settleGame(save);
      expect(duplicate.profile).toEqual(settled.profile);
      expect(duplicate.progression).toEqual(settled.progression);
      expect(settled.progression.stages[0].clearedDifficulties).toEqual([0]);
      expect(settled.profile.runs).toBe(1);
      expect(settleInMemory(settled).profile.credits).toBe(settled.profile.credits);
    },
  );
  it('defeat, retirement before clear, and partial waves do not unlock an Ascension', () => {
    const { save, run } = checkpoint();
    run.wave = 99;
    retire(run);
    const settled = settleInMemory(save);
    expect(
      settled.progression.stages.every(
        (s) => !s.unlockedDifficulty && !s.clearedDifficulties.length,
      ),
    ).toBe(true);
    expect(settled.profile.stageUnlocked).toBe(1);
  });
  it.each([1, 2, 3])(
    'migrates schema %i global access only onto already-open stages',
    (version) => {
      const old = version === 1 ? emptyV1() : version === 2 ? emptyV2() : oldEnvelope();
      old.profile.stageUnlocked = 2;
      old.profile.difficultyUnlocked = 4;
      old.profile.clears = [0];
      old.profile.credits = 357;
      const migrated = parseGame(old);
      expect(migrated.version).toBe(7);
      expect(migrated.profile).toEqual(old.profile);
      expect(migrated.progression.stages.map((s) => s.unlockedDifficulty)).toEqual([4, 4, 0]);
      expect(migrated.progression.stages[0]).toMatchObject({
        legacyClear: true,
        clearedDifficulties: [],
      });
      const run = { cleared: true, stage: 1, difficulty: 4 };
      recordStageClear(migrated.profile, migrated.progression.stages, run);
      expect(migrated.progression.stages.map((s) => s.unlockedDifficulty)).toEqual([4, 5, 0]);
      expect(migrated.profile.stageUnlocked).toBe(3);
      expect(parseGame(exportGame(migrated)).progression).toEqual(migrated.progression);
      expect(saveFromSnapshot(snapshotFromSave(migrated), migrated.settings).progression).toEqual(
        migrated.progression,
      );
    },
  );
  it('preserves a cleared but unsettled legacy checkpoint and its exact combat state', () => {
    const old = oldEnvelope();
    old.run!.cleared = true;
    old.run!.phase = 'victory';
    if (old.run?.version === 2) old.run.weapons[0].lifetimeShots = 23000;
    const migrated = parseGame(old);
    expect(migrated.run).toEqual(old.run);
    expect(migrated.progression.stages[0].clearedDifficulties).toEqual([0]);
    expect(migrated.progression.stages[1].unlockedDifficulty).toBe(0);
    expect(migrated.profile.settledRuns).toEqual([]);
  });
  it.each(['guest', 'account:00000000-0000-4000-8000-000000000004'] as SaveScope[])(
    'keeps a write-once migration backup for %s',
    async (scope) => {
      const old = oldEnvelope();
      old.profile.credits = 432;
      await putRaw(old, scope);
      const migrated = await loadGame(scope);
      expect(await readLegacyBackup(scope)).toEqual(old);
      expect(await readRawSave(scope)).toEqual(old);
      await saveGame(migrated, false, scope);
      expect((await loadGame(scope)).version).toBe(7);
      expect(await readLegacyBackup(scope)).toEqual(old);
      expect((await loadGame(scope)).run).toEqual(old.run);
      expect(
        await readLegacyBackup(
          scope === 'guest' ? 'account:00000000-0000-4000-8000-000000000004' : 'guest',
        ),
      ).toBeUndefined();
    },
  );
  it('rejects unsupported future versions and malformed stage metadata without overwriting a checkpoint', async () => {
    const save = emptySave();
    await saveGame(save);
    for (const bad of [
      { ...save, version: 8 },
      { ...save, progression: { ...save.progression, stages: [] } },
      {
        ...save,
        progression: {
          ...save.progression,
          stages: [
            { unlockedDifficulty: 6, clearedDifficulties: [], legacyClear: false },
            ...save.progression.stages.slice(1),
          ],
        },
      },
      {
        ...save,
        progression: {
          ...save.progression,
          stages: [
            { unlockedDifficulty: 1, clearedDifficulties: [0, 0], legacyClear: false },
            ...save.progression.stages.slice(1),
          ],
        },
      },
    ]) {
      expect(() => parseGame(bad)).toThrow();
      await expect(saveGame(bad as never)).rejects.toThrow();
      expect(await loadGame()).toEqual(save);
    }
  });
});
