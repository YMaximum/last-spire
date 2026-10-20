import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRun, continueEndless, retire, step, TICK } from '../src/game/engine';
import type { RunMode, RunV3 } from '../src/game/types';
import {
  emptySave,
  parseGame,
  settleInMemory,
  disqualifyImportedLeaderboard,
  saveGame,
  loadGame,
  readLegacyBackup,
} from '../src/persistence/storage';
import {
  BALANCE_EDITION,
  deriveLeaderboardResult,
  isLeaderboardResult,
  leaderboardScore,
} from '../src/model/leaderboard';
import { saveFromSnapshot, snapshotFromSave } from '../src/account/snapshot';
function checkpoint(mode: RunMode = 'endless') {
  const save = emptySave();
  const run = createRun(save.profile, 'bastion', 0, 0, 2468, { mode });
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: save.progression.autocast,
  };
  return { save, run };
}
function clearWave(run: RunV3) {
  run.spawned = run.spawnTotal;
  run.enemies = [];
  run.waveTime = 18;
  step(run);
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('last-spire');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});
describe('leaderboard completion checkpoints', () => {
  it('does not change current combat, offers, or RNG when tracking is enabled', () => {
    const { run } = checkpoint();
    const untracked = structuredClone(run);
    delete untracked.leaderboard;
    for (let tick = 0; tick < 900; tick++) {
      step(run);
      step(untracked);
    }
    const { leaderboard: _tracking, ...combat } = run;
    expect(combat).toEqual(untracked);
  });
  it('cannot turn kills or progress within an uncleared wave into points', () => {
    const { run } = checkpoint();
    clearWave(run);
    const clearSeconds = run.leaderboard!.lastClearedSeconds;
    run.kills += 100_000;
    run.time += 200;
    run.waveTime += 200;
    retire(run);
    const result = deriveLeaderboardResult(run)!;
    expect(leaderboardScore(result)).toBe(100);
    expect(result.checkpointSeconds).toBe(clearSeconds);
  });
  it('scores fully cleared waves and freezes time at the last clear', () => {
    const { run } = checkpoint();
    expect(run.leaderboard).toEqual({
      version: 1,
      balanceEdition: BALANCE_EDITION,
      eligible: true,
      lastClearedWave: 0,
      lastClearedSeconds: 0,
    });
    clearWave(run);
    expect(run.leaderboard?.lastClearedWave).toBe(1);
    const seconds = run.time;
    run.spawnTimer = 999;
    step(run, 0.5);
    const paused = run.time;
    run.phase = 'victory';
    step(run, 1);
    expect(run.time).toBe(paused);
    run.phase = 'combat';
    retire(run);
    const result = deriveLeaderboardResult(run)!;
    expect(result).toMatchObject({
      clearedWaves: 1,
      checkpointSeconds: seconds,
      division: 'standard',
    });
    expect(leaderboardScore(result)).toBe(100);
    expect(result.checkpointSeconds).toBe(TICK);
  });
  it.each(['normal', 'quick'] as const)('places %s continuation in its origin division', (mode) => {
    const { run } = checkpoint(mode);
    run.wave = mode === 'quick' ? 50 : 100;
    clearWave(run);
    expect(run.phase).toBe('victory');
    expect(deriveLeaderboardResult(run)).toBeNull();
    retire(run);
    expect(deriveLeaderboardResult(run)).toBeNull();
    run.phase = 'victory';
    continueEndless(run);
    retire(run);
    expect(deriveLeaderboardResult(run)?.division).toBe(mode === 'quick' ? 'quick' : 'standard');
    expect(deriveLeaderboardResult(run)?.clearedWaves).toBe(mode === 'quick' ? 50 : 100);
  });
  it('never promotes historical, imported, unfinished or zero-clear runs', () => {
    const { save, run } = checkpoint();
    retire(run);
    expect(deriveLeaderboardResult(run)).toBeNull();
    run.phase = 'combat';
    clearWave(run);
    expect(deriveLeaderboardResult(run)).toBeNull();
    retire(run);
    const imported = disqualifyImportedLeaderboard(save);
    expect(deriveLeaderboardResult(imported.run as RunV3)).toBeNull();
    expect(run.leaderboard?.eligible).toBe(true);
    delete run.leaderboard;
    expect(deriveLeaderboardResult(run)).toBeNull();
  });
  it('uses the same simulation clear time for individual and batched ticks', () => {
    const { run } = checkpoint();
    run.waveTime = 17.9;
    run.spawned = run.spawnTotal;
    const batched = structuredClone(run);
    for (let i = 0; i < 60; i++) step(run);
    step(batched, 1);
    expect(batched.leaderboard).toEqual(run.leaderboard);
  });
});
describe('leaderboard save receipts', () => {
  it('retains an idempotent receipt after settlement, clearing, reload and cloud validation', async () => {
    const { save, run } = checkpoint();
    clearWave(run);
    retire(run);
    const settled = settleInMemory(save);
    expect(settled.progression.leaderboardResults).toEqual([deriveLeaderboardResult(run)]);
    expect(settleInMemory(settled)).toEqual(settled);
    settled.run = null;
    settled.progression.active = null;
    await saveGame(settled);
    expect((await loadGame()).progression.leaderboardResults).toEqual(
      settled.progression.leaderboardResults,
    );
    expect(saveFromSnapshot(snapshotFromSave(settled), settled.settings)).toEqual(settled);
    const imported = disqualifyImportedLeaderboard(settled);
    expect(imported.progression.records).toEqual(settled.progression.records);
    expect(imported.progression.leaderboardResults).toEqual([]);
  });
  it('rejects malformed tracking, receipts, mismatched history and premature schema fields', () => {
    const { save, run } = checkpoint();
    clearWave(run);
    retire(run);
    const settled = settleInMemory(save);
    const bad = structuredClone(settled);
    bad.progression.leaderboardResults[0].clearedWaves = 2;
    expect(() => parseGame(bad)).toThrow(/settled record/);
    bad.progression.leaderboardResults = [
      ...settled.progression.leaderboardResults,
      ...settled.progression.leaderboardResults,
    ];
    expect(() => parseGame(bad)).toThrow(/duplicate leaderboard/);
    expect(
      isLeaderboardResult({
        ...settled.progression.leaderboardResults[0],
        checkpointSeconds: Infinity,
      }),
    ).toBe(false);
    expect(
      isLeaderboardResult({ ...settled.progression.leaderboardResults[0], tower: 'unknown' }),
    ).toBe(false);
    expect(() => parseGame({ ...save, version: 7 })).toThrow(/schema eight/);
    run.leaderboard!.lastClearedSeconds = run.time + 1;
    expect(() => parseGame(save)).toThrow(/exceeds run/);
  });
  it('migrates schema seven without eligibility and saves its original checkpoint once', async () => {
    const { save, run } = checkpoint();
    delete run.leaderboard;
    const old = structuredClone(save) as any;
    old.version = 7;
    delete old.progression.leaderboardResults;
    const migrated = parseGame(old);
    expect(migrated.version).toBe(8);
    expect(migrated.run).not.toHaveProperty('leaderboard');
    expect(migrated.progression.leaderboardResults).toEqual([]);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('last-spire', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('save');
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('save', 'readwrite');
      tx.objectStore('save').put(old, 'root');
      tx.oncomplete = () => resolve();
    });
    db.close();
    await saveGame(migrated);
    expect(await readLegacyBackup()).toEqual(old);
    expect(() => parseGame({ ...save, version: 9 })).toThrow(/newer Last Spire/);
  });
});
