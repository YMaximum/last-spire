import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun as createLegacyRun } from '../src/legacy/classic/engine';
import { defaultProfile, defaultSettings as legacySettings } from '../src/legacy/classic/storage';
import { createRun, spawnEnemy, step, useSkill, rewardForRun } from '../src/legacy/runeforged/engine';
import { CARDS, WEAPONS } from '../src/content/base-catalog';
import {
  defaultSettings,
  emptySave,
  exportGame,
  legacySave,
  loadGame,
  parseGame,
  readLegacyBackup,
  readRawSave,
  replaceGame,
  SaveError,
  saveGame,
  settleGame,
  settleInMemory,
} from '../src/legacy/runeforged/storage';
import type { SaveData } from '../src/model/shared';
import type { RunV2, SaveV2 } from '../src/model/arsenal';

function makeSave(overrides: Partial<RunV2> = {}): SaveV2 {
  const profile = defaultProfile();
  return {
    version: 2,
    profile,
    settings: defaultSettings(),
    run: { ...createRun(profile, 'bastion', 0, 1, 42), id: 'run-v2-test', ...overrides },
  };
}
function oldSave(): SaveData {
  const profile = defaultProfile();
  Object.assign(profile, {
    credits: 125,
    unlocked: ['bastion', 'pyre', 'tempest', 'glacier', 'verdant', 'null'],
    stageUnlocked: 3,
    clears: [0, 1, 2],
    difficultyUnlocked: 5,
    upgrades: { power: 6, vitality: 5, fortune: 4 },
    runs: 18,
    bestWave: 140,
    totalKills: 9001,
    settledRuns: ['run-before'],
    seenSynergies: ['burning-core'],
    tutorialDone: true,
  });
  const run = createLegacyRun(profile, 'pyre', 0, 1, 93);
  Object.assign(run, {
    id: 'legacy-long-run',
    phase: 'ended',
    cleared: true,
    endless: true,
    earned: 22,
    kills: 39,
    wave: 102,
  });
  run.attacks[0].shots = 15_000;
  run.visuals = [
    {
      kind: 'text',
      x: 500,
      y: 400,
      color: '#fff',
      size: 10,
      life: 0.2,
      maxLife: 0.4,
      text: 'raw backup',
    },
  ];
  return {
    version: 1,
    profile,
    run,
    settings: { ...legacySettings(), sound: false, reducedMotion: true, speed: 2 },
  };
}
async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('last-spire');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database deletion blocked'));
  });
}
async function rawPut(raw: unknown, key = 'root'): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('last-spire', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('save');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('save', 'readwrite');
      tx.objectStore('save').put(raw, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(deleteDb);
afterEach(deleteDb);

describe('v2 save continuity', () => {
  it('uses the existing database and makes fresh v2 defaults without a root', async () => {
    expect(await loadGame()).toEqual(emptySave());
    expect(await readRawSave()).toBeUndefined();
  });
  it('backs up exact raw v1 data, preserves all profile progress and resumes a 15000-shot v1 run', async () => {
    const source = oldSave();
    await rawPut(source);
    const loaded = await loadGame();
    expect(loaded.version).toBe(2);
    expect(loaded.profile).toEqual(source.profile);
    expect(loaded.settings).toMatchObject(source.settings);
    expect(loaded.run?.version).toBe(1);
    expect(legacySave(loaded).run?.attacks[0].shots).toBe(15_000);
    expect(await readLegacyBackup()).toEqual(source);
    expect(await readRawSave()).toEqual(source);
    await saveGame(loaded);
    expect(((await readRawSave()) as SaveV2).version).toBe(2);
    expect((await loadGame()).run?.version).toBe(1);
    expect(await readLegacyBackup()).toEqual(source);
    await replaceGame(emptySave());
    expect(await readLegacyBackup()).toEqual(source);
  });
  it('settles a migrated legacy expedition once, including stage zero after endless', async () => {
    await rawPut(oldSave());
    const source = await loadGame();
    const first = await settleGame(source),
      second = await settleGame(source);
    expect(first.profile.credits).toBe(147);
    expect(first.profile.runs).toBe(19);
    expect(first.profile.totalKills).toBe(9040);
    expect(first.profile.clears).toEqual([0, 1, 2]);
    expect(first.run?.settled).toBe(true);
    expect(second).toEqual(first);
    await saveGame(source);
    expect(await loadGame()).toEqual(first);
  });
  it('accepts exact fresh and simulated v2 snapshots for every weapon, with RNG and timers intact', async () => {
    for (const definition of WEAPONS) {
      const source = makeSave(),
        run = source.run as RunV2;
      run.weapons[0].kind = definition.id;
      run.weapons[0].lifetimeShots = 25_000;
      run.weapons[0].cooldown = -0.25;
      spawnEnemy(run, 'boss', 580, 400);
      useSkill(run, 'signature');
      for (let tick = 0; tick < 25; tick++) step(run, 1 / 30);
      expect(parseGame(exportGame(source))).toEqual(parseGame(source));
      await saveGame(source, true);
      const loaded = await loadGame();
      expect(loaded.run).toEqual(parseGame(source).run);
      expect(loaded.run?.rng).toBe(run.rng);
    }
  });
});

describe('v2 settlement ledger', () => {
  it('accepts a live beam snapshot whose direct ray exhausted its pierce budget', () => {
    const source = makeSave();
    const run = source.run as RunV2;
    run.weapons[0].kind = 'beam';
    for (let i = 0; i < 12; i++) spawnEnemy(run, 'boss', 580 + i, 400);
    step(run, 1 / 30);
    expect(run.projectiles.some((p) => p.pierce === -1)).toBe(true);
    expect(parseGame(source).run).toEqual(JSON.parse(JSON.stringify(run)));
  });
  it('deduplicates repeated and concurrent transactions and blocks stale autosaves', async () => {
    const source = makeSave({
      phase: 'ended',
      cleared: true,
      endless: true,
      wave: 101,
      earned: 31,
      kills: 15,
    });
    await saveGame(source);
    const results = await Promise.all([settleGame(source), settleGame(source), settleGame(source)]);
    for (const result of results)
      expect(result.profile).toMatchObject({
        credits: rewardForRun(source.run as RunV2),
        runs: 1,
        totalKills: 15,
        bestWave: 101,
        clears: [0],
        stageUnlocked: 2,
        difficultyUnlocked: 2,
        settledRuns: ['run-v2-test'],
      });
    await saveGame(source);
    expect(await loadGame()).toEqual(results[0]);
    const next = makeSave({ id: 'next-run' });
    await saveGame(next);
    expect((await loadGame()).profile.credits).toBe(rewardForRun(source.run as RunV2));
    expect((await loadGame()).profile.settledRuns).toContain('run-v2-test');
    expect((await loadGame()).run?.id).toBe('next-run');
  });
  it('adds distinct concurrent run rewards to the persisted profile without undoing purchases', async () => {
    const base = emptySave();
    base.profile.credits = 4;
    base.profile.upgrades.power = 2;
    base.settings.sound = false;
    await saveGame(base);
    await Promise.all([
      settleGame(makeSave({ id: 'first-run', earned: 11, kills: 3 })),
      settleGame(makeSave({ id: 'second-run', earned: 7, kills: 5 })),
    ]);
    const loaded = await loadGame();
    expect(loaded.profile).toMatchObject({
      credits: 6,
      runs: 2,
      totalKills: 8,
      upgrades: { power: 2 },
    });
    expect(loaded.profile.settledRuns).toEqual(['first-run', 'second-run']);
    expect(loaded.settings.sound).toBe(false);
  });
  it('persists hangar purchases and preferences while the last settled run remains present', async () => {
    const settled = await settleGame(makeSave({ earned: 500 }));
    settled.profile.credits -= 50;
    settled.profile.upgrades.power += 1;
    settled.settings.sound = false;
    await saveGame(settled);
    expect((await loadGame()).profile).toMatchObject({
      credits: 30,
      runs: 1,
      upgrades: { power: 1 },
    });
    expect((await loadGame()).settings.sound).toBe(false);
    await saveGame(makeSave({ earned: 500 }));
    expect((await loadGame()).profile.credits).toBe(30);
  });
  it('allows an explicit imported replacement even with a settled matching ID or corrupt root', async () => {
    await settleGame(makeSave({ earned: 9 }));
    const imported = makeSave();
    imported.profile.credits = 71;
    await saveGame(imported, true);
    expect(await loadGame()).toEqual(parseGame(imported));
    await rawPut({ version: 'broken' });
    await expect(saveGame(imported)).rejects.toMatchObject({ code: 'invalid' });
    await replaceGame(imported);
    expect((await loadGame()).profile.credits).toBe(71);
  });
  it('provides an idempotent in-memory settlement when IndexedDB is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    try {
      const source = makeSave({ earned: 13, kills: 4, cleared: true, endless: true });
      const first = settleInMemory(source),
        second = settleInMemory(first);
      expect(first.profile).toMatchObject({
        credits: rewardForRun(source.run as RunV2),
        runs: 1,
        totalKills: 4,
        clears: [0],
        stageUnlocked: 2,
      });
      expect(second).toEqual(first);
      await expect(loadGame()).rejects.toMatchObject({ code: 'unavailable' });
      await expect(saveGame(source)).rejects.toMatchObject({ code: 'unavailable' });
      await expect(settleGame(source)).rejects.toMatchObject({ code: 'unavailable' });
      expect(source.run?.settled).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    }
  });
});

describe('v2 structural validation', () => {
  function populated(): SaveV2 {
    const source = makeSave(),
      run = source.run as RunV2;
    const weaponId = run.weapons[0].id;
    spawnEnemy(run, 'runner', 540, 400);
    run.projectiles.push({
      id: 21,
      weaponId,
      kind: 'pulse',
      x: 500,
      y: 400,
      vx: 20,
      vy: 0,
      life: 2,
      maxLife: 3,
      damage: 4,
      radius: 30,
      elements: ['fire', 'frost'],
      pierce: 2,
      bounces: 1,
      homing: 0,
      split: 0,
      hit: [1],
      pulseTimer: 0.3,
      pulseInterval: 0.6,
      returning: false,
      originX: 500,
      originY: 400,
      critical: true,
      depth: 1,
      seed: 12,
      previousX: 499,
      previousY: 400,
    });
    run.areas.push({
      id: 22,
      kind: 'meteor',
      x: 540,
      y: 400,
      radius: 70,
      life: 3,
      maxLife: 3,
      tickTimer: 0,
      damage: 4,
      element: 'fire',
      weaponId,
      delay: 0.8,
      depth: 0,
    });
    run.visuals.push({
      kind: 'beam',
      x: 500,
      y: 400,
      x2: 540,
      y2: 400,
      color: '#ff995e',
      secondaryColor: '#fff',
      size: 5,
      life: 0.3,
      maxLife: 0.35,
    });
    run.buffs.push({
      id: 'buff-23',
      source: 'kill',
      stat: 'damage',
      value: 0.2,
      expires: 2,
      stacks: 1,
    });
    run.pendingRewards.push({
      id: 'reward-24',
      kind: 'shop',
      wave: 1,
      rerolls: 0,
      repairStock: 1,
      offers: [{ id: 'offer-25', cardId: CARDS[0].id, rarity: 'rare', price: 12 }],
    });
    run.cards.push({ cardId: CARDS[0].id, stacks: 1, mastery: 1, rarity: 'normal' });
    return source;
  }
  it('preserves all entity and queued reward fields on round trip', () => {
    const source = populated();
    expect(parseGame(exportGame(source))).toEqual(source);
  });
  it('rejects malformed fields throughout the nested v2 schema', () => {
    const invalid: ((run: RunV2) => void)[] = [
      (r) => {
        r.projectiles[0].originX = undefined as unknown as number;
      },
      (r) => {
        r.projectiles[0].returning = 'yes' as unknown as boolean;
      },
      (r) => {
        r.projectiles[0].elements = ['bogus'] as unknown as RunV2['projectiles'][0]['elements'];
      },
      (r) => {
        r.projectiles[0].hit = ['one'] as unknown as number[];
      },
      (r) => {
        r.projectiles[0].seed = NaN;
      },
      (r) => {
        r.enemies[0].damageType = 'bogus' as RunV2['enemies'][0]['damageType'];
      },
      (r) => {
        delete (r.enemies[0] as unknown as Record<string, unknown>).armor;
      },
      (r) => {
        r.areas[0].delay = 'soon' as unknown as number;
      },
      (r) => {
        r.areas[0].kind = 'bogus' as RunV2['areas'][0]['kind'];
      },
      (r) => {
        r.buffs[0].expires = Infinity;
      },
      (r) => {
        r.visuals[0].color = 'url(javascript:alert(1))';
      },
      (r) => {
        r.visuals[0].x2 = [] as unknown as number;
      },
      (r) => {
        r.pendingRewards[0].offers[0].targetId = 'unknown-weapon';
      },
      (r) => {
        r.stats.skillsUsed = undefined as unknown as number;
      },
      (r) => {
        r.counters.clock = 'later' as unknown as number;
      },
      (r) => {
        r.damageByElement.physical = undefined as unknown as number;
      },
      (r) => {
        r.notices = [{}] as unknown as string[];
      },
      (r) => {
        r.secondary = undefined as unknown as string;
      },
    ];
    for (const mutate of invalid) {
      const source = populated();
      mutate(source.run as RunV2);
      expect(() => parseGame(source)).toThrow(SaveError);
    }
  });
  it('rejects dangerous keys, unknown fields, prototype objects, invalid RNG, and oversized JSON', () => {
    const json = exportGame(populated());
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => parseGame(json.replace('"version": 2', `"${key}": {}, "version": 2`))).toThrow(
        /unsafe object key/,
      );
    }
    const source = populated();
    (source.run as RunV2).rng = 0x1_0000_0000;
    expect(() => parseGame(source)).toThrow(/random state/);
    expect(() => parseGame({ ...emptySave(), unexpected: true })).toThrow(/unknown/);
    expect(() => parseGame({ ...emptySave(), settings: new Date() })).toThrow(/plain JSON/);
    expect(() => parseGame('x'.repeat(8 * 1024 * 1024 + 1))).toThrow(/8 MB/);
    expect(() => parseGame('{')).toThrow(/valid JSON/);
    expect({}.toString()).toBe('[object Object]');
  });
});

it('saves fractional battle earnings after economy tuning', async () => {
  const save = makeSave({ scrap: 1.2, earned: 1.2 });
  await saveGame(save);
  expect((await loadGame()).run?.earned).toBe(1.2);
  expect(parseGame(exportGame(save)).run?.earned).toBe(1.2);
});

it('settles fractional v2 earnings as the displayed integer credit reward', async () => {
  const save = makeSave({ phase: 'ended', wave: 46, earned: 148.4 });
  const expected = rewardForRun(save.run as RunV2);
  const first = await settleGame(save);
  expect(first.profile.credits).toBe(expected);
  expect((await settleGame(save)).profile.credits).toBe(expected);
  expect(settleInMemory(save).profile.credits).toBe(expected);
});
