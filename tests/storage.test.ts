import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun, shopChoices, step } from '../src/legacy/classic/engine';
import {
  defaultProfile,
  defaultSettings,
  exportSave,
  loadSave,
  parseSave,
  replaceSave,
  saveGame,
  settleInMemory,
  settleRun,
} from '../src/legacy/classic/storage';
import type { RunState, SaveData } from '../src/model/shared';

function makeRun(overrides: Partial<RunState> = {}): RunState {
  return {
    version: 1,
    id: 'run-42',
    tower: 'bastion',
    stage: 1,
    difficulty: 0,
    seed: 123456,
    rng: 987654321,
    time: 42.5,
    wave: 3,
    waveTime: 2,
    spawned: 2,
    spawnTotal: 4,
    spawnTimer: 0.5,
    phase: 'combat',
    hp: 80,
    maxHp: 100,
    shield: 5,
    scrap: 12,
    kills: 2,
    earned: 7,
    attacks: [
      { pattern: 'bolt', element: 'fire', modifier: 'echo', rank: 2, cooldown: 0.75, shots: 1 },
    ],
    enemies: [
      {
        id: 8,
        kind: 'runner',
        x: 30,
        y: 40,
        hp: 4,
        maxHp: 10,
        speed: 1,
        damage: 2,
        radius: 5,
        armor: 0,
        attackCd: 1,
        burn: 0,
        poison: 0,
        chill: 0,
        mark: 0,
        stun: 0,
        vx: 1,
        vy: 0,
        reward: 1,
      },
    ],
    projectiles: [
      {
        id: 9,
        x: 3,
        y: 4,
        vx: 2,
        vy: 1,
        life: 0.5,
        damage: 4,
        radius: 2,
        element: 'fire',
        modifier: 'echo',
        pattern: 'bolt',
        pierce: 0,
        hit: [],
        surge: false,
        targetId: 8,
      },
    ],
    visuals: [
      { kind: 'text', x: 0, y: 0, color: '#fff', life: 1, maxLife: 1, size: 12, text: 'transient' },
    ],
    nextId: 10,
    targeting: 'nearest',
    skillCd: 0,
    secondaryCd: 0,
    secondary: 'repair',
    buff: 0,
    stasis: 0,
    rerolls: 0,
    pendingShop: false,
    endless: false,
    cleared: false,
    settled: false,
    damageByElement: { fire: 10, frost: 0, lightning: 0, poison: 0, solar: 0, void: 0 },
    synergies: ['burning-core'],
    notices: [],
    perks: { damage: 0, rate: 0, armor: 0, regen: 0, fortune: 0 },
    choices: [],
    tutorialStep: 0,
    ...overrides,
  };
}

function makeSave(run: RunState | null = makeRun()): SaveData {
  return { version: 1, profile: defaultProfile(), run, settings: defaultSettings() };
}

async function clearDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('last-spire');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion blocked'));
  });
}

describe('save storage', () => {
  beforeEach(clearDatabase);
  afterEach(clearDatabase);

  it('provides fresh v1 defaults when no save exists', async () => {
    expect(defaultProfile()).toMatchObject({
      version: 1,
      credits: 0,
      unlocked: ['bastion'],
      stageUnlocked: 1,
      runs: 0,
    });
    expect(defaultSettings()).toEqual({
      sound: true,
      effects: 'high',
      reducedMotion: false,
      speed: 1,
    });
    expect(await loadSave()).toEqual(makeSave(null));
  });

  it('round-trips progress and exact combat snapshot data, including RNG state', async () => {
    const source = makeSave();
    await saveGame(source);
    const stored = await loadSave();
    expect(stored.run?.rng).toBe(987654321);
    expect(stored.run?.seed).toBe(123456);
    expect(stored.run?.attacks).toEqual(source.run?.attacks);
    expect(stored.run?.enemies).toEqual(source.run?.enemies);
    expect(stored.run?.projectiles).toEqual(source.run?.projectiles);
    expect(stored.run?.visuals).toEqual([]);
    expect(parseSave(exportSave(source))).toEqual(stored);
  });

  it('round-trips fresh and evolved snapshots produced by the game engine', async () => {
    const fresh = createRun(defaultProfile(), 'bastion', 0, 0);
    const evolved = structuredClone(fresh);
    step(evolved, 1);
    for (const run of [fresh, evolved]) {
      const source = {
        version: 1 as const,
        profile: defaultProfile(),
        run,
        settings: defaultSettings(),
      };
      await saveGame(source);
      const stored = await loadSave();
      expect(stored.run?.seed).toBe(run.seed);
      expect(stored.run?.rng).toBe(run.rng);
      expect(stored.run?.attacks).toEqual(run.attacks);
      expect(stored.run?.enemies).toEqual(run.enemies);
      expect(stored.run?.projectiles).toEqual(run.projectiles);
    }
  });

  it('accepts every zero-based stage index from the engine', async () => {
    for (const stage of [0, 1, 2]) {
      const run = createRun(defaultProfile(), 'bastion', stage, 0);
      await saveGame({ version: 1, profile: defaultProfile(), run, settings: defaultSettings() });
      expect((await loadSave()).run?.stage).toBe(stage);
    }
  });

  it('round-trips legitimate draft and shop choices from the engine', () => {
    const run = createRun(defaultProfile(), 'bastion', 0, 0, 88);
    run.choices = shopChoices(run);
    const source = makeSave(run);
    expect(parseSave(exportSave(source)).run?.choices).toEqual(run.choices);
  });

  it('settles rewards atomically and applies stage and difficulty unlocks', async () => {
    const source = makeSave(
      makeRun({
        cleared: true,
        stage: 0,
        difficulty: 1,
        wave: 8,
        kills: 12,
        earned: 30,
        synergies: ['burning-core', 'storm-loop'],
      }),
    );
    const result = await settleRun(source);
    expect(result.run?.settled).toBe(true);
    expect(result.profile).toMatchObject({
      credits: 30,
      runs: 1,
      bestWave: 8,
      totalKills: 12,
      stageUnlocked: 2,
      difficultyUnlocked: 2,
      clears: [0],
    });
    expect(result.profile.seenSynergies).toEqual(['burning-core', 'storm-loop']);
    expect(await loadSave()).toEqual(result);
  });

  it('settles once in memory without IndexedDB and unlocks the next stage from stage zero', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    try {
      const source = makeSave(
        makeRun({ id: 'memory-run', stage: 0, difficulty: 1, cleared: true, earned: 12, kills: 4 }),
      );
      const first = settleInMemory(source);
      const second = settleInMemory(first);
      expect(first.run?.settled).toBe(true);
      expect(first.profile).toMatchObject({
        credits: 12,
        runs: 1,
        totalKills: 4,
        clears: [0],
        stageUnlocked: 2,
        difficultyUnlocked: 2,
      });
      expect(second.profile.credits).toBe(12);
      expect(second.profile.runs).toBe(1);
      expect(second.profile.totalKills).toBe(4);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    }
  });

  it('deduplicates concurrent settlements for the same run id', async () => {
    const source = makeSave(makeRun({ earned: 11, kills: 3 }));
    const results = await Promise.all([settleRun(source), settleRun(source), settleRun(source)]);
    expect(results.map((result) => result.profile.credits)).toEqual([11, 11, 11]);
    expect(results.map((result) => result.profile.runs)).toEqual([1, 1, 1]);
    expect((await loadSave()).profile).toMatchObject({ credits: 11, runs: 1, totalKills: 3 });
  });

  it('ignores a stale same-run autosave after settlement and carries the dedup ledger forward', async () => {
    const source = makeSave(makeRun({ earned: 11, kills: 3 }));
    await saveGame(source);
    const settled = await settleRun(source);

    const stale = makeSave(makeRun({ earned: 0, settled: false }));
    await saveGame(stale);
    expect(await loadSave()).toEqual(settled);

    const nextRunSave = makeSave(makeRun({ id: 'run-43', wave: 1 }));
    nextRunSave.profile.credits = settled.profile.credits;
    nextRunSave.profile.runs = settled.profile.runs;
    await saveGame(nextRunSave);
    expect((await loadSave()).profile.settledRuns).toContain('run-42');
  });

  it('allows explicit save replacement for imports that match an already settled run', async () => {
    const source = makeSave(makeRun({ earned: 11 }));
    await settleRun(source);
    const imported = makeSave(makeRun({ id: 'run-42', earned: 0, settled: false }));
    imported.profile.credits = 99;
    await replaceSave(imported);
    expect(await loadSave()).toMatchObject({
      profile: { credits: 99 },
      run: { id: 'run-42', settled: false },
    });
  });

  it('preserves current profile purchases when a new settlement arrives', async () => {
    const bought = makeSave(null);
    bought.profile.credits = 4;
    bought.profile.upgrades.power = 2;
    await saveGame(bought);
    const incoming = makeSave(makeRun({ earned: 5 }));
    incoming.profile.credits = 4;
    incoming.profile.upgrades.power = 2;
    const result = await settleRun(incoming);
    expect(result.profile.credits).toBe(9);
    expect(result.profile.upgrades.power).toBe(2);
  });

  it('rejects malformed, oversized, unknown-version, and out-of-range saves', () => {
    const good = JSON.parse(exportSave(makeSave())) as SaveData;
    expect(() => parseSave(JSON.stringify({ ...good, version: 2 }))).toThrow(
      /unsupported save version/,
    );

    const badEntity = structuredClone(good);
    badEntity.run!.enemies[0]!.speed = 'fast' as unknown as number;
    expect(() => parseSave(JSON.stringify(badEntity))).toThrow(/enemies\[0\]\.speed/);

    const badRng = structuredClone(good);
    badRng.run!.rng = 0x1_0000_0000;
    expect(() => parseSave(JSON.stringify(badRng))).toThrow(/run\.rng/);

    const choiceRun = createRun(defaultProfile(), 'bastion', 0, 0, 89);
    const validChoice = shopChoices(choiceRun)[0]!;
    const badColor = structuredClone(good);
    badColor.run!.choices = [{ ...validChoice, color: 'url(javascript:alert(1))' }];
    expect(() => parseSave(JSON.stringify(badColor))).toThrow(/choices\[0\]\.color/);

    const badPerk = structuredClone(good);
    badPerk.run!.choices = [{ ...validChoice, kind: 'perk', value: '__proto__' }];
    expect(() => parseSave(JSON.stringify(badPerk))).toThrow(/choices\[0\]\.value/);

    const polluted = JSON.stringify(good).replace(
      '"version":1',
      '"__proto__":{"polluted":true},"version":1',
    );
    expect(() => parseSave(polluted)).toThrow(/unknown field/);
    expect(() => parseSave('x'.repeat(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
  });

  it('surfaces IndexedDB unavailability instead of silently succeeding', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    try {
      await expect(loadSave()).rejects.toThrow(/IndexedDB is unavailable/);
      await expect(saveGame(makeSave())).rejects.toThrow(/IndexedDB is unavailable/);
      await expect(settleRun(makeSave())).rejects.toThrow(/IndexedDB is unavailable/);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    }
  });
});
