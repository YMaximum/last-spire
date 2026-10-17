import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, rewardForRun } from '../src/v2/engine';
import { emptySave as emptyV2 } from '../src/v2/storage';
import { defaultProfile, defaultSettings as legacySettings } from '../src/storage';
import { createRun as legacyRun } from '../src/engine';
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
} from '../src/v3/storage';
import { snapshotRunes } from '../src/v3/controls';

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
    expect((await loadGame()).version).toBe(3);
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
    expect(next.progression.runes.selected.power).toBe(5);
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
      'selected legacy rune above cap',
      (s: SaveV3) => {
        s.progression.runes.owned.power = 6;
        s.progression.runes.selected.power = 6;
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
});
