import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, rewardForRun } from '../src/legacy/runeforged/engine';
import { emptySave as emptyV2 } from '../src/legacy/runeforged/storage';
import { defaultProfile, defaultSettings as legacySettings } from '../src/legacy/classic/storage';
import { createRun as legacyRun } from '../src/legacy/classic/engine';
import {
  emptySave,
  defaultSettings,
  parseGame,
  exportGame,
  loadGame,
  saveGame,
  replaceGame,
  settleGame,
  settleInMemory,
  readRawSave,
  readLegacyBackup,
  legacySave,
  SaveError,
  type SaveV3,
} from '../src/persistence/storage';
import { snapshotRunes } from '../src/game/controls';
import { NEW_CARDS, DEFENSIVE_KINDS, FUSIONS, EXPANSION_FUSION_IDS } from '../src/content/catalog';
import { createRun as createModernRun, rewardForRun as modernReward } from '../src/game/engine';
import type { RunV3 } from '../src/game/types';

async function reset() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('last-spire');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked'));
  });
}
async function rawPut(value: unknown, key = 'root') {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('last-spire', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('save');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('save', 'readwrite');
    tx.objectStore('save').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
function runSave(): SaveV3 {
  const save = emptySave();
  save.run = {
    ...createRun(save.profile, 'bastion', 0, 0, 917),
    id: 'v3-storage-test',
    phase: 'ended',
    wave: 24,
    kills: 150,
    earned: 39.6,
  };
  save.progression.active = {
    runId: save.run.id,
    rulesVersion: 2,
    runes: snapshotRunes(save.progression.runes),
    autocast: save.progression.autocast,
  };
  return save;
}
function modernSave(): SaveV3 {
  const save = runSave();
  Object.assign(save.run!, {
    rulesVersion: 3,
    mode: 'quick',
    level: 12,
    xp: 3.5,
    xpRequired: 22,
    offerRng: 919,
    runeSnapshot: snapshotRunes(save.progression.runes),
  });
  save.progression.active!.rulesVersion = 3;
  return save;
}
function fusionSave(index = 0): SaveV3 {
  const save = modernSave(),
    run = save.run as RunV3,
    recipe = FUSIONS[index];
  if (EXPANSION_FUSION_IDS.includes(recipe.id)) run.arsenalVersion = 2;
  run.time = 1000;
  const original = run.weapons[0];
  const a = {
    ...structuredClone(original),
    id: 'consumed-a',
    kind: recipe.ingredients[0],
    rarity: 'rare' as const,
    masteryRank: 6,
    masteryProgress: 900,
    masteryRequired: 900,
    fusionReady: true,
    infusions: ['solar' as const],
  };
  const b = {
    ...structuredClone(original),
    id: 'consumed-b',
    kind: recipe.ingredients[1],
    rarity: 'epic' as const,
    masteryRank: 6,
    masteryProgress: 900,
    masteryRequired: 900,
    fusionReady: true,
    infusions: ['void' as const],
  };
  run.weapons[0] = {
    ...original,
    kind: recipe.kind,
    rarity: 'epic',
    masteryRank: 6,
    masteryProgress: 900,
    masteryRequired: 900,
    fusionReady: false,
    infusions: ['solar', 'void'],
    fusion: { recipeId: recipe.id, createdAt: 900, ingredients: [a, b], overflowPower: 0.1 },
  };
  run.cards.push({
    cardId: 'utility-apprenticeship',
    targetId: original.id,
    stacks: 2,
    mastery: 2,
    rarity: 'rare',
  });
  return save;
}
beforeEach(reset);
describe('v3 persistence and migration', () => {
  it('provides spectacular high-detail defaults without writing a root', async () => {
    expect(defaultSettings()).toMatchObject({ effects: 'high', intensity: 'spectacular' });
    expect(await loadGame()).toEqual(emptySave());
    expect(await readRawSave()).toBeUndefined();
  });
  it('round-trips owned, selected, active rules and finite metadata without changing the RNG', () => {
    const save = runSave();
    save.progression.runes.owned.power = 3;
    save.progression.runes.selected.power = 1;
    save.progression.active!.runes.power = 1;
    save.progression.active!.gameplay = { elapsed: 20, options: ['quick', 2] };
    const result = parseGame(exportGame(save));
    expect(result.progression).toEqual(save.progression);
    expect(result.run).toEqual(save.run);
    expect(result.profile.upgrades.power).toBe(3);
  });
  it('migrates and backs up exact v2 source while leaving active rules legacy', async () => {
    const old = emptyV2();
    old.profile.credits = 257;
    old.profile.upgrades = { power: 3, vitality: 4, fortune: 1 };
    old.run = createRun(old.profile, 'bastion', 0, 0, 473);
    old.run.weapons[0].lifetimeShots = 15001;
    await rawPut(old);
    const next = await loadGame();
    expect(next.profile).toEqual(old.profile);
    expect(next.run).toEqual(old.run);
    expect(next.progression.active).toBeNull();
    expect(next.progression.runes.owned.power).toBe(3);
    expect(next.progression.runes.selected.power).toBe(3);
    expect(next.settings.intensity).toBe('balanced');
    expect(await readRawSave()).toEqual(old);
    expect(await readLegacyBackup()).toEqual(old);
    await saveGame(next);
    expect((await loadGame()).version).toBe(8);
    expect(await readLegacyBackup()).toEqual(old);
  });
  it('preserves v1 long runs, explicit preferences and ownership above current purchase caps', async () => {
    const profile = defaultProfile();
    profile.upgrades.power = 6;
    profile.credits = 873;
    const run = legacyRun(profile, 'bastion', 0, 0, 29);
    run.attacks[0].shots = 15001;
    const old = {
      version: 1,
      profile,
      run,
      settings: { ...legacySettings(), effects: 'low', reducedMotion: true },
    };
    await rawPut(old);
    const next = await loadGame();
    expect(legacySave(next).run).toEqual(run);
    expect(next.profile).toEqual(profile);
    expect(next.progression.runes.owned.power).toBe(6);
    expect(next.progression.runes.selected.power).toBe(6);
    expect(next.settings).toMatchObject({
      effects: 'low',
      intensity: 'spectacular',
      reducedMotion: true,
    });
    await saveGame(next);
    expect((await loadGame()).profile.upgrades.power).toBe(6);
    expect(await readLegacyBackup()).toEqual(old);
  });
  it('defaults only missing v2 settings and preserves explicit low/subtle choices', () => {
    const old = emptyV2() as unknown as Record<string, unknown>;
    old.settings = { sound: false, reducedMotion: true, speed: 2 };
    expect(parseGame(old).settings).toMatchObject({
      effects: 'high',
      intensity: 'spectacular',
      sound: false,
      reducedMotion: true,
      speed: 2,
    });
    old.settings = { ...defaultSettings(), effects: 'low', intensity: 'subtle' };
    expect(parseGame(old).settings).toMatchObject({ effects: 'low', intensity: 'subtle' });
  });
  it('falls back to earlier backup keys', async () => {
    const backup = { historical: true };
    await rawPut(backup, 'backup-v1');
    expect(await readLegacyBackup()).toEqual(backup);
  });
  it.each([
    [
      'selection above ownership',
      (s: SaveV3) => {
        s.progression.runes.selected.power = 1;
      },
    ],
    [
      'new rune above cap',
      (s: SaveV3) => {
        s.progression.runes.owned.choices = 3;
      },
    ],
    [
      'selected legacy rune exceeds ownership',
      (s: SaveV3) => {
        s.progression.runes.owned.power = 6;
        s.progression.runes.selected.power = 7;
      },
    ],
    [
      'negative ownership',
      (s: SaveV3) => {
        s.progression.runes.owned.power = -1;
      },
    ],
    [
      'active mismatch',
      (s: SaveV3) => {
        s.progression.active!.runId = 'other';
      },
    ],
    [
      'nonfinite metadata',
      (s: SaveV3) => {
        s.progression.active!.gameplay = { bad: Infinity };
      },
    ],
    [
      'unknown rules',
      (s: SaveV3) => {
        (s.progression.active as unknown as Record<string, unknown>).rulesVersion = 4;
      },
    ],
    [
      'bad autocast condition',
      (s: SaveV3) => {
        s.progression.autocast.signature.conditions = [{ kind: 'health', value: 101 }];
      },
    ],
    [
      'extra autocast field',
      (s: SaveV3) => {
        Object.assign(s.progression.autocast.signature, { secret: true });
      },
    ],
  ] as const)('rejects %s', (_name, change) => {
    const save = runSave();
    change(save);
    expect(() => parseGame(save)).toThrow(SaveError);
  });
  it('accepts a valid advanced ALL rule and rejects a radius on non-nearby conditions', () => {
    const save = runSave();
    save.progression.runes.owned.autoSignature = 1;
    save.progression.runes.selected.autoSignature = 1;
    save.progression.active!.runes.autoSignature = 1;
    save.progression.autocast.signature = {
      enabled: true,
      preset: 'advanced',
      match: 'all',
      conditions: [
        { kind: 'health', value: 30 },
        { kind: 'nearby', value: 8, radius: 180 },
        { kind: 'boss', value: 1 },
      ],
    };
    expect(parseGame(save).progression.autocast).toEqual(save.progression.autocast);
    Object.assign(save.progression.autocast.signature.conditions[0], { radius: 50 });
    expect(() => parseGame(save)).toThrow(SaveError);
  });
  it('validates bounded unique mode records', () => {
    const save = runSave();
    const record = {
      runId: 'prior',
      mode: 'quick' as const,
      stage: 1,
      difficulty: 2,
      tower: 'bastion',
      runes: snapshotRunes(save.progression.runes),
      wave: 50,
      cleared: true,
      seconds: 1220.5,
      credits: 231,
    };
    save.progression.records = [record];
    expect(parseGame(save).progression.records).toEqual([record]);
    save.progression.records.push(record);
    expect(() => parseGame(save)).toThrow(/duplicate/);
    save.progression.records = Array.from({ length: 501 }, (_, i) => ({
      ...record,
      runId: `run-${i}`,
    }));
    expect(() => parseGame(save)).toThrow(/500/);
  });
  it('blocks malformed stored data until explicit reviewed replacement', async () => {
    const bad = { version: 3, broken: true };
    await rawPut(bad);
    await expect(loadGame()).rejects.toMatchObject({ code: 'invalid' });
    await expect(saveGame(emptySave())).rejects.toMatchObject({ code: 'invalid' });
    expect(await readRawSave()).toEqual(bad);
    await replaceGame(emptySave());
    expect(await loadGame()).toEqual(emptySave());
  });
  it('does not save malformed incoming state or replace a valid checkpoint', async () => {
    const current = runSave();
    await saveGame(current);
    const invalid = runSave();
    invalid.progression.runes.selected.power = 2;
    await expect(saveGame(invalid)).rejects.toMatchObject({ code: 'invalid' });
    expect(await loadGame()).toEqual(parseGame(current));
  });
  it('reports unavailable storage and supports memory-only settlement', async () => {
    const save = runSave();
    const replacement = vi
      .spyOn(globalThis, 'indexedDB', 'get')
      .mockReturnValue(undefined as unknown as IDBFactory);
    try {
      await expect(loadGame()).rejects.toMatchObject({ code: 'unavailable' });
      await expect(saveGame(save)).rejects.toMatchObject({ code: 'unavailable' });
      const settled = settleInMemory(save);
      expect(settled.run?.settled).toBe(true);
      expect(settled.profile.credits).toBe(
        rewardForRun(save.run as Parameters<typeof rewardForRun>[0]),
      );
      expect(settleInMemory(settled)).toEqual(settled);
    } finally {
      replacement.mockRestore();
    }
  });
  it('settles concurrent and reloaded snapshots once, preserving runes and queued rewards', async () => {
    const save = runSave();
    save.progression.runes.owned.power = 2;
    save.progression.runes.selected.power = 1;
    await saveGame(save);
    const results = await Promise.all([settleGame(save), settleGame(save)]);
    const final = await loadGame();
    expect(results[0].profile.credits).toBe(results[1].profile.credits);
    expect(final.profile.runs).toBe(1);
    expect(final.profile.settledRuns).toEqual(['v3-storage-test']);
    expect(final.progression).toEqual(save.progression);
    expect(final.run?.version === 2 && final.run.pendingRewards).toEqual(
      save.run?.version === 2 && save.run.pendingRewards,
    );
    expect(await settleGame(save)).toEqual(final);
    await saveGame(save);
    expect(await loadGame()).toEqual(final);
  });
  it('uses persisted wallet and purchases when delayed settlement comes from an older snapshot', async () => {
    const old = runSave();
    await saveGame(old);
    const current = parseGame(old);
    current.profile.credits = 100;
    current.progression.runes.owned.vitality = 3;
    current.progression.runes.selected.vitality = 2;
    await saveGame(current);
    const settled = await settleGame(old);
    expect(settled.profile.credits).toBe(
      100 + rewardForRun(old.run as Parameters<typeof rewardForRun>[0]),
    );
    expect(settled.progression.runes).toEqual(current.progression.runes);
    expect(settled.profile.upgrades.vitality).toBe(3);
  });
  it('settlement failure leaves prior checkpoint intact and retry awards once', async () => {
    const save = runSave();
    await saveGame(save);
    const unavailable = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('Interrupted');
    });
    await expect(settleGame(save)).rejects.toMatchObject({ code: 'unavailable' });
    unavailable.mockRestore();
    expect((await loadGame()).run?.settled).toBe(false);
    const settled = await settleGame(save);
    expect(settled.profile.runs).toBe(1);
    expect((await settleGame(save)).profile.credits).toBe(settled.profile.credits);
  });
  it('aborts an interrupted write atomically without advancing the settlement ledger', async () => {
    const save = runSave();
    await saveGame(save);
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('Write interrupted');
    });
    await expect(settleGame(save)).rejects.toMatchObject({ code: 'unavailable' });
    write.mockRestore();
    expect(await loadGame()).toEqual(parseGame(save));
    const settled = await settleGame(save);
    expect(settled.profile.runs).toBe(1);
    expect(settled.profile.settledRuns).toEqual([save.run!.id]);
  });
  it('credits an older expedition without reopening it over the newer active snapshot', async () => {
    const old = runSave();
    const next = runSave();
    next.run!.id = 'new-expedition';
    next.run!.settled = false;
    next.progression.active!.runId = next.run!.id;
    next.progression.active!.gameplay = { marker: 'new-rules' };
    await saveGame(next);
    const settled = await settleGame(old);
    expect(settled.run?.id).toBe('new-expedition');
    expect(settled.run?.settled).toBe(false);
    expect(settled.progression.active).toEqual(next.progression.active);
    expect(settled.profile.settledRuns).toContain(old.run!.id);
  });
  it('round-trips every new family and defensive core without losing modern progression', () => {
    for (const kind of DEFENSIVE_KINDS) {
      const save = modernSave();
      const run = save.run as RunV3;
      run.tower = 'monolith';
      save.profile.unlocked.push('monolith');
      Object.assign(run.weapons[0], {
        kind,
        masteryRank: 4,
        masteryProgress: 400,
        masteryRequired: 600,
        fusionReady: false,
      });
      run.cards = NEW_CARDS.map((card) => ({
        cardId: card.id,
        stacks: 2,
        mastery: 2,
        rarity: 'rare',
        ...(card.id === 'utility-apprenticeship' ? { targetId: run.weapons[0].id } : {}),
      }));
      run.pendingRewards = [
        {
          id: 'xp-choice',
          kind: 'draft',
          wave: 20,
          level: 12,
          offers: [{ id: 'new-offer', cardId: 'mod-insight', rarity: 'rare', price: 0 }],
          rerolls: 0,
          repairStock: 0,
        },
      ];
      const parsed = parseGame(exportGame(save));
      expect(parsed.run).toEqual(run);
      expect(parsed.profile.unlocked).toContain('monolith');
      expect(parsed.progression.active?.rulesVersion).toBe(3);
    }
  });
  it('persists real new-run snapshots for all modes, including Monolith ownership and selected runes', async () => {
    for (const mode of ['quick', 'normal', 'endless'] as const) {
      const save = emptySave();
      save.profile.unlocked.push('monolith');
      save.progression.runes.owned.vitality = 3;
      save.progression.runes.selected.vitality = 1;
      save.profile.upgrades.vitality = 3;
      const runes = snapshotRunes(save.progression.runes);
      save.run = createModernRun(save.profile, 'monolith', 0, 0, 123, { mode, runes });
      save.progression.active = {
        runId: save.run.id,
        rulesVersion: 3,
        runes,
        autocast: save.progression.autocast,
      };
      await replaceGame(save);
      const parsed = await loadGame();
      expect(parsed.run).toEqual(save.run);
      expect(parsed.run?.tower).toBe('monolith');
      expect(parsed.profile.upgrades.vitality).toBe(3);
      expect(parsed.progression.active?.runes.vitality).toBe(1);
    }
  });
  it.each([
    ['unknown run field', (r: RunV3) => Object.assign(r, { hiddenRule: 9 })],
    ['unknown core field', (r: RunV3) => Object.assign(r.weapons[0], { hiddenRule: 9 })],
    ['unknown equipment', (r: RunV3) => Object.assign(r.weapons[0], { kind: 'core-invented' })],
    ['seventh mastery', (r: RunV3) => Object.assign(r.weapons[0], { masteryRank: 7 })],
    ['mastery overflow', (r: RunV3) => Object.assign(r.weapons[0], { masteryProgress: 901 })],
    [
      'unknown card',
      (r: RunV3) => r.cards.push({ cardId: 'unknown', stacks: 1, mastery: 1, rarity: 'normal' }),
    ],
    [
      'card cap overflow',
      (r: RunV3) =>
        r.cards.push({ cardId: 'mod-insight', stacks: 13, mastery: 1, rarity: 'normal' }),
    ],
    [
      'missing chosen core',
      (r: RunV3) =>
        r.cards.push({ cardId: 'utility-apprenticeship', stacks: 1, mastery: 1, rarity: 'normal' }),
    ],
    [
      'unexpected global target',
      (r: RunV3) =>
        r.cards.push({
          cardId: 'mod-insight',
          stacks: 1,
          mastery: 1,
          rarity: 'normal',
          targetId: r.weapons[0].id,
        }),
    ],
    [
      'unknown chosen core',
      (r: RunV3) =>
        r.cards.push({
          cardId: 'utility-apprenticeship',
          stacks: 1,
          mastery: 1,
          rarity: 'normal',
          targetId: 'gone',
        }),
    ],
    [
      'negative XP',
      (r: RunV3) => {
        r.xp = -1;
      },
    ],
    [
      'invalid offer RNG',
      (r: RunV3) => {
        r.offerRng = 0;
      },
    ],
    ['invalid mode', (r: RunV3) => Object.assign(r, { mode: 'invented' })],
  ] as const)('strictly rejects modern %s', (_label, alter) => {
    const save = modernSave();
    alter(save.run as RunV3);
    expect(() => parseGame(save)).toThrow(SaveError);
  });
  it('does not grant autocast from an enabled configuration without the run unlock', () => {
    const save = modernSave();
    save.progression.active!.autocast.signature.enabled = true;
    expect(() => parseGame(save)).toThrow(/not unlocked/);
  });
  it('requires matching explicit modern rune snapshots', () => {
    const save = modernSave();
    (save.run as RunV3).runeSnapshot.power = 1;
    expect(() => parseGame(save)).toThrow(/disagree/);
    save.progression.active = null;
    expect(() => parseGame(save)).toThrow(/snapshot/);
  });
  it('settles Quick once and records mode-specific rune investment transactionally', async () => {
    const save = modernSave();
    const run = save.run as RunV3;
    run.cleared = true;
    run.wave = 50;
    run.time = 1100;
    run.earned = 500;
    await saveGame(save);
    const results = await Promise.all([settleGame(save), settleGame(save)]);
    const settled = await loadGame();
    expect(settled.profile.runs).toBe(1);
    expect(results[0].profile.credits).toBe(results[1].profile.credits);
    expect(settled.profile.credits).toBe(modernReward(run));
    expect(settled.profile.clears).toEqual([0]);
    expect(settled.profile.stageUnlocked).toBe(2);
    expect(settled.progression.records).toEqual([
      {
        runId: run.id,
        mode: 'quick',
        stage: 0,
        difficulty: 0,
        tower: 'bastion',
        runes: run.runeSnapshot,
        wave: 50,
        cleared: true,
        seconds: 1100,
        credits: modernReward(run),
      },
    ]);
    expect((await settleGame(save)).progression.records).toHaveLength(1);
  });
  it('keeps completed legacy modes out of invented modern records and rejects legacy extension fields', () => {
    const save = runSave();
    expect(settleInMemory(save).progression.records).toEqual([]);
    Object.assign(save.run!, { xp: 5 });
    expect(() => parseGame(save)).toThrow(SaveError);
  });
  it('keeps optional engine visual fields but rejects sparse nested arrays and accessor data', () => {
    const save = modernSave();
    const run = save.run as RunV3;
    run.visuals.push({
      kind: 'pulse',
      x: 500,
      y: 400,
      color: '#fff',
      size: 20,
      life: 0.3,
      maxLife: 0.3,
      x2: undefined,
    });
    expect(parseGame(save).run?.visuals[0]).not.toHaveProperty('x2');
    run.weapons[0].infusions = new Array(1);
    expect(() => parseGame(save)).toThrow(/holes/);
    run.weapons[0].infusions = [];
    Object.defineProperty(run, 'level', { get: () => 1 });
    expect(() => parseGame(save)).toThrow(/accessor/);
  });
  it.each(FUSIONS.map((recipe, index) => [recipe.id, index] as const))(
    'round-trips %s with mastered provenance and inherited investments',
    (_id, index) => {
      const save = fusionSave(index);
      const parsed = parseGame(exportGame(save));
      expect(parsed.run).toEqual(save.run);
      expect(parsed.progression).toEqual(save.progression);
    },
  );
  it.each([
    [
      'wrong recipe',
      (r: RunV3) => {
        r.weapons[0].fusion!.recipeId = FUSIONS[1].id;
      },
    ],
    [
      'unknown recipe',
      (r: RunV3) => {
        r.weapons[0].fusion!.recipeId = 'fusion-invented';
      },
    ],
    [
      'recursive provenance',
      (r: RunV3) => {
        r.weapons[0].fusion!.ingredients[0].fusion = structuredClone(r.weapons[0].fusion!);
      },
    ],
    [
      'duplicate ingredient ID',
      (r: RunV3) => {
        r.weapons[0].fusion!.ingredients[1].id = r.weapons[0].fusion!.ingredients[0].id;
      },
    ],
    [
      'wrong ingredient',
      (r: RunV3) => {
        r.weapons[0].fusion!.ingredients[0].kind = 'mine';
      },
    ],
    [
      'unmastered ingredient',
      (r: RunV3) => {
        r.weapons[0].fusion!.ingredients[0].masteryRank = 5;
      },
    ],
    [
      'incomplete ingredient progress',
      (r: RunV3) => {
        r.weapons[0].fusion!.ingredients[0].masteryProgress = 899;
      },
    ],
    [
      'future creation time',
      (r: RunV3) => {
        r.weapons[0].fusion!.createdAt = r.time + 1;
      },
    ],
    [
      'nonfinite creation time',
      (r: RunV3) => {
        r.weapons[0].fusion!.createdAt = Infinity;
      },
    ],
    [
      'overflow beyond cap',
      (r: RunV3) => {
        r.weapons[0].fusion!.overflowPower = 0.16;
      },
    ],
    [
      'unknown provenance field',
      (r: RunV3) => {
        Object.assign(r.weapons[0].fusion!, { unknown: 1 });
      },
    ],
    [
      'lost infusion',
      (r: RunV3) => {
        r.weapons[0].infusions = ['solar'];
      },
    ],
    [
      'rarity downgrade',
      (r: RunV3) => {
        r.weapons[0].rarity = 'normal';
      },
    ],
    [
      'fusion input re-equipped',
      (r: RunV3) => {
        r.weapons.push(structuredClone(r.weapons[0].fusion!.ingredients[0]));
      },
    ],
    [
      'output offered for new fusion',
      (r: RunV3) => {
        r.weapons[0].fusionReady = true;
      },
    ],
  ] as const)('rejects fusion %s', (_label, alter) => {
    const save = fusionSave();
    alter(save.run as RunV3);
    expect(() => parseGame(save)).toThrow(SaveError);
  });
  it('requires provenance on fused cores and excludes it from ordinary equipment', () => {
    const save = fusionSave();
    delete (save.run as RunV3).weapons[0].fusion;
    expect(() => parseGame(save)).toThrow(/provenance/);
    const ordinary = fusionSave();
    (ordinary.run as RunV3).weapons[0].kind = 'bolt';
    expect(() => parseGame(ordinary)).toThrow(/ordinary/);
  });
  it('preserves primitive projectile physics with a known authored fusion appearance tag', () => {
    const save = fusionSave(),
      run = save.run as RunV3;
    run.projectiles.push({
      id: 891,
      weaponId: run.weapons[0].id,
      kind: 'rail',
      fusionId: FUSIONS[0].id,
      x: 500,
      y: 400,
      vx: 100,
      vy: 0,
      life: 1,
      maxLife: 1,
      damage: 15,
      radius: 4,
      elements: ['solar'],
      pierce: 2,
      bounces: 0,
      homing: 0,
      split: 0,
      hit: [],
      pulseTimer: 0,
      pulseInterval: 0,
      returning: false,
      originX: 500,
      originY: 400,
      critical: false,
      depth: 0,
      seed: 1,
      previousX: 500,
      previousY: 400,
    });
    expect(
      parseGame(save).run?.version === 2 && (parseGame(save).run as RunV3).projectiles,
    ).toEqual(run.projectiles);
    run.projectiles[0].fusionId = 'fusion-invented';
    expect(() => parseGame(save)).toThrow(/projectile fusion/);
  });
  it('settles a fused checkpoint once and retains provenance after stale autosaves and reloads', async () => {
    const save = fusionSave();
    await saveGame(save);
    const settled = await settleGame(save);
    await saveGame(save);
    const loaded = await loadGame();
    expect(loaded).toEqual(settled);
    expect(loaded.progression.records).toHaveLength(1);
    expect((loaded.run as RunV3).weapons[0].fusion).toEqual((save.run as RunV3).weapons[0].fusion);
    expect((await settleGame(save)).profile.credits).toBe(settled.profile.credits);
  });
});
