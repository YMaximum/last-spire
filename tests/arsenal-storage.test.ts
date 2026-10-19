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
import type { RunV3 } from '../src/game/types';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';
import { EXPANSION_CARD_IDS, EXPANSION_FUSION_IDS, FUSIONS } from '../src/content/catalog';

function checkpoint() {
  const save = emptySave();
  const run = createRun(save.profile, 'bastion', 0, 0, 484, { arsenalVersion: 2 });
  run.arsenalVersion = 2;
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: structuredClone(save.progression.autocast),
  };
  return { save, run };
}

async function rawPut(value: unknown, scope: SaveScope) {
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
    req.onerror = req.onblocked = () => reject(new Error('Database unavailable'));
  });
});

describe('expanded arsenal save compatibility', () => {
  it('round trips all expansion cards, pending offers and mechanic counters locally and through cloud', () => {
    const { save, run } = checkpoint();
    run.cards = EXPANSION_CARD_IDS.map((cardId) => ({
      cardId,
      stacks: 1,
      mastery: 1,
      rarity: 'normal' as const,
    }));
    run.pendingRewards = [
      {
        id: 'arsenal-choice',
        kind: 'draft',
        wave: 1,
        level: 2,
        offers: [{ id: 'new-offer', cardId: EXPANSION_CARD_IDS[0], rarity: 'rare', price: 0 }],
        rerolls: 0,
        repairStock: 0,
      },
    ];
    run.counters['arsenal:absorption'] = 4.5;
    run.counters['arsenal:crossfire'] = 3;
    const restored = parseGame(exportGame(save));
    expect(restored.version).toBe(6);
    expect(restored.run).toEqual(run);
    expect(saveFromSnapshot(snapshotFromSave(save), save.settings)).toEqual(restored);
    run.counters['arsenal:absorption'] = Infinity;
    expect(() => parseGame(save)).toThrow();
  });

  it.each([1, 3, 0, '2', null])('rejects unsupported explicit arsenal version %s', (version) => {
    const { save, run } = checkpoint();
    Object.assign(run, { arsenalVersion: version });
    expect(() => parseGame(save)).toThrow(/arsenal rules/);
  });

  it.each(EXPANSION_CARD_IDS)(
    'rejects %s investments and offers without expanded rules',
    (cardId) => {
      const { save, run } = checkpoint();
      delete run.arsenalVersion;
      run.cards.push({ cardId, stacks: 1, mastery: 1, rarity: 'normal' });
      expect(() => parseGame(save)).toThrow(/expanded card/);
      run.cards = [];
      run.pendingRewards = [
        {
          id: 'new-choice',
          kind: 'draft',
          wave: 1,
          offers: [{ id: 'new-offer', cardId, rarity: 'normal', price: 0 }],
          rerolls: 0,
          repairStock: 0,
        },
      ];
      expect(() => parseGame(save)).toThrow(/expanded card/);
    },
  );

  it.each(EXPANSION_FUSION_IDS)(
    'requires expanded rules for %s equipment and projectile provenance',
    (recipeId) => {
      const { save, run } = checkpoint();
      const recipe = FUSIONS.find((recipe) => recipe.id === recipeId)!;
      const core = run.weapons[0];
      const ingredients = recipe.ingredients.map((kind, i) => ({
        ...structuredClone(core),
        id: `consumed-${i}`,
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
        fusion: { recipeId, createdAt: 0, ingredients },
      });
      expect(parseGame(save).run).toEqual(run);
      delete run.arsenalVersion;
      expect(() => parseGame(save)).toThrow(/expanded fusion/);
      run.weapons = [ingredients[0]];
      // Validation checks the expansion tag before projecting primitive projectile fields.
      run.projectiles = [{ kind: 'bolt', fusionId: recipeId } as RunV3['projectiles'][number]];
      expect(() => parseGame(save)).toThrow(/expanded projectile/);
      run.projectiles = [{ kind: recipe.kind } as RunV3['projectiles'][number]];
      expect(() => parseGame(save)).toThrow(/expanded projectile/);
    },
  );

  it('migrates schema five unchanged and resumes identically with the original arsenal', () => {
    const { save, run } = checkpoint();
    delete run.arsenalVersion;
    for (let i = 0; i < 120; i++) step(run);
    save.profile.credits = 191;
    save.profile.unlocked.push('monolith');
    save.progression.bestiary.swarmer = { encountered: 5, defeated: 3 };
    const old = { ...save, version: 5 };
    const migrated = parseGame(old);
    expect(migrated).toEqual({ ...old, version: 6 });
    const resumed = migrated.run as RunV3;
    expect(resumed).not.toHaveProperty('arsenalVersion');
    for (let i = 0; i < 180; i++) {
      step(run);
      step(resumed);
    }
    expect(resumed).toEqual(run);
  });

  it.each(['guest', 'account:11111111-1111-4111-8111-111111111111'] as const)(
    'keeps a write-once schema-five backup and settles once in %s scope',
    async (scope) => {
      const { save, run } = checkpoint();
      delete run.arsenalVersion;
      save.profile.credits = 81;
      run.earned = 47;
      retire(run);
      const old = { ...save, version: 5 };
      await rawPut(old, scope);
      const migrated = await loadGame(scope);
      expect(await readRawSave(scope)).toEqual(old);
      expect(await readLegacyBackup(scope)).toEqual(old);
      await saveGame(migrated, false, scope);
      const settled = await settleGame(migrated, scope);
      await saveGame(migrated, false, scope);
      expect(await settleGame(migrated, scope)).toEqual(settled);
      expect(settled.profile.credits).toBeGreaterThan(81);
      expect(settled.profile.settledRuns).toEqual([run.id]);
      expect((settled.run as RunV3).rng).toBe(run.rng);
      expect((settled.run as RunV3).pendingRewards).toEqual(run.pendingRewards);
      expect(await readLegacyBackup(scope)).toEqual(old);
      if (scope !== 'guest') expect(await readLegacyBackup()).toBeUndefined();
    },
  );
});
