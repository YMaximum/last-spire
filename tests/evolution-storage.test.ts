import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptySave,
  parseGame,
  exportGame,
  loadGame,
  saveGame,
  settleGame,
  readRawSave,
  readLegacyBackup,
  type SaveScope,
} from '../src/persistence/storage';
import { createRun, step, retire } from '../src/game/engine';
import type { RunMode, RunV3 } from '../src/game/types';
import type { TowerId } from '../src/model/shared';
import { EVOLUTION_PATHS } from '../src/content/evolutions';
import { FUSIONS } from '../src/content/catalog';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';

function checkpoint(mode: RunMode = 'normal', tower: TowerId = 'bastion') {
  const save = emptySave();
  const run = createRun(save.profile, tower, 0, 0, 2194, { mode });
  run.evolution = { version: 1, coreId: run.weapons[0].id, tier: 0, pending: 0 };
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: structuredClone(save.progression.autocast),
  };
  return { save, run };
}
async function rawPut(value: unknown, scope: SaveScope, key?: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('last-spire', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('save');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('save', 'readwrite');
    tx.objectStore('save').put(value, key ?? (scope === 'guest' ? 'root' : scope));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('last-spire');
    req.onsuccess = () => resolve();
    req.onerror = req.onblocked = () => reject(new Error('Database reset failed'));
  });
});

describe('evolution checkpoint validation', () => {
  it.each(EVOLUTION_PATHS)('round trips $id with exact local/cloud state and RNG', (path) => {
    const { save, run } = checkpoint('normal', path.tower);
    run.wave = 76;
    run.evolution = { version: 1, coreId: run.weapons[0].id, path: path.id, tier: 3, pending: 0 };
    const restored = parseGame(exportGame(save));
    expect(restored.version).toBe(7);
    expect(restored.run).toEqual(run);
    expect(saveFromSnapshot(snapshotFromSave(save), save.settings)).toEqual(restored);
  });
  it.each(['normal', 'endless', 'quick'] as const)('requires cleared milestones for %s', (mode) => {
    const { save, run } = checkpoint(mode);
    const milestones = mode === 'quick' ? [12, 25, 37] : [25, 50, 75];
    for (const [index, milestone] of milestones.entries()) {
      const pending = (index + 1) as 1 | 2 | 3;
      run.evolution = {
        version: 1,
        coreId: run.weapons[0].id,
        tier: index as 0 | 1 | 2,
        pending,
        ...(index ? { path: 'citadel' as const } : {}),
      };
      run.wave = milestone;
      expect(() => parseGame(save)).toThrow(/milestone/);
      run.wave = milestone + 1;
      expect(parseGame(save).run).toEqual(run);
      run.evolution = { ...run.evolution, tier: pending, pending: 0, path: 'citadel' };
      expect(parseGame(save).run).toEqual(run);
      run.wave = milestone;
      expect(() => parseGame(save)).toThrow(/milestone/);
    }
  });
  it.each([
    { version: 2 },
    { version: '1' },
    { coreId: '' },
    { coreId: 'not an id' },
    { tier: -1 },
    { tier: 4 },
    { tier: 1.5 },
    { tier: NaN },
    { pending: Infinity },
    { pending: 4 },
    { pending: 2 },
    { pending: '1' },
    { path: 'citadel' },
    { tier: 1 },
    { tier: 1, path: 'invented' },
    { tier: 1, path: 'furnace' },
    { tier: 1, path: 'citadel', pending: 1 },
    { tier: 3, path: 'citadel', pending: 3 },
    { extra: true },
  ])('rejects malformed or contradictory state %j', (patch) => {
    const { save, run } = checkpoint();
    run.wave = 100;
    Object.assign(run.evolution!, patch);
    expect(() => parseGame(save)).toThrow();
  });
  it('requires modern expanded rules and schema seven', () => {
    const { save, run } = checkpoint();
    for (const version of [1, 2, 3, 4, 5, 6]) {
      expect(() => parseGame({ ...save, version })).toThrow(/schema seven/);
    }
    expect(() => parseGame({ ...save, version: 8 })).toThrow(/newer Last Spire client/);
    delete run.arsenalVersion;
    expect(() => parseGame(save)).toThrow(/evolution requires/);
    run.arsenalVersion = 2;
    run.rulesVersion = 2 as never;
    expect(() => parseGame(save)).toThrow(/modern rules/);
  });
  it('retains lost lineage and accepts one fused descendant without duplicate ownership', () => {
    const { save, run } = checkpoint();
    const core = run.weapons[0];
    run.evolution!.coreId = 'replaced-core';
    expect(parseGame(save).run).toEqual(run);
    const recipe = FUSIONS[0];
    const ingredients = recipe.ingredients.map((kind, index) => ({
      ...structuredClone(core),
      id: index ? 'other-core' : 'replaced-core',
      kind,
      masteryRank: 6,
      masteryProgress: 900,
      masteryRequired: 900,
      fusionReady: true,
    })) as [typeof core, typeof core];
    Object.assign(core, {
      kind: recipe.kind,
      masteryRank: 6,
      masteryProgress: 900,
      masteryRequired: 900,
      fusionReady: false,
      fusion: { recipeId: recipe.id, createdAt: 0, ingredients },
    });
    expect(parseGame(save).run).toEqual(run);
    run.weapons.push({ ...structuredClone(core), id: 'duplicate-descendant' });
    expect(() => parseGame(save)).toThrow(/provenance|descendants/);
  });
  it('rejects a lineage that points to another kind of core', () => {
    const { save, run } = checkpoint();
    run.weapons[0].kind = 'rail';
    expect(() => parseGame(save)).toThrow(/starting core/);
  });
});

describe('evolution migration and scoped recovery', () => {
  it.each([5, 6])(
    'migrates schema %i without grafting evolution or changing active state/RNG',
    (version) => {
      const { save, run } = checkpoint();
      delete run.evolution;
      if (version === 5) delete run.arsenalVersion;
      for (let tick = 0; tick < 80; tick++) step(run);
      save.profile.credits = 249;
      save.profile.unlocked.push('monolith');
      const old = structuredClone({ ...save, version });
      const migrated = parseGame(old);
      expect(migrated).toEqual({ ...old, version: 7 });
      expect(migrated.run).not.toHaveProperty('evolution');
      const resumed = migrated.run as RunV3;
      for (let tick = 0; tick < 120; tick++) {
        step(run);
        step(resumed);
      }
      expect(resumed).toEqual(run);
    },
  );
  it.each(['guest', 'account:11111111-1111-4111-8111-111111111111'] as const)(
    'backs up schema six once and settles once in %s',
    async (scope) => {
      const { save, run } = checkpoint();
      delete run.evolution;
      save.profile.credits = 71;
      run.earned = 53;
      retire(run);
      const old = structuredClone({ ...save, version: 6 });
      const oldArsenal = { ...old, version: 5 };
      const key = scope === 'guest' ? 'root' : scope;
      await rawPut(oldArsenal, scope, `backup-before-arsenal:${key}`);
      await rawPut(old, scope);
      const migrated = await loadGame(scope);
      expect(await readRawSave(scope)).toEqual(old);
      expect(await readLegacyBackup(scope)).toEqual(old);
      await saveGame(migrated, false, scope);
      const settled = await settleGame(migrated, scope);
      await saveGame(migrated, false, scope);
      expect(await settleGame(migrated, scope)).toEqual(settled);
      expect(settled.profile.credits).toBeGreaterThan(71);
      expect(settled.profile.settledRuns).toEqual([run.id]);
      expect((settled.run as RunV3).rng).toBe(run.rng);
      expect((settled.run as RunV3).pendingRewards).toEqual(run.pendingRewards);
      expect(await readLegacyBackup(scope)).toEqual(old);
      const unrelated: SaveScope =
        scope === 'guest' ? 'account:22222222-2222-4222-8222-222222222222' : 'guest';
      expect(await readLegacyBackup(unrelated)).toBeUndefined();
      expect(await readRawSave(unrelated)).toBeUndefined();
    },
  );
  it('refuses to overwrite an unsupported future local checkpoint', async () => {
    const { save } = checkpoint();
    const future = { ...save, version: 8 };
    await rawPut(future, 'guest');
    await expect(loadGame()).rejects.toThrow(/newer Last Spire client/);
    await expect(saveGame(save)).rejects.toThrow(/Existing save could not be read/);
    expect(await readRawSave()).toEqual(future);
  });
});
