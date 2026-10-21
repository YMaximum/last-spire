import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun } from '../src/legacy/runeforged/engine';
import { createRun as currentRun } from '../src/game/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import {
  LocalTelemetry,
  MAX_TELEMETRY_EVENTS,
  MAX_TELEMETRY_SAMPLES,
  MAX_TELEMETRY_PAYLOAD_BYTES,
} from '../src/telemetry/local';

const meta = { build: '3.0.0-test', mode: 'normal', runes: { power: 0, experience: 1 } };
beforeEach(async () => {
  // A fresh factory isolates open analytics connections without touching progression storage.
  const { IDBFactory } = await import('fake-indexeddb');
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function run(id = 'synthetic-run') {
  const result = createRun(defaultProfile(), 'bastion', 0, 0, 987);
  result.id = id;
  return result;
}
async function exported(logger: LocalTelemetry) {
  return JSON.parse(await logger.exportLogs());
}
describe('private local telemetry', () => {
  it('records current rules, evolution, load, and performance context without mutating combat', async () => {
    const logger = new LocalTelemetry();
    const current = currentRun(defaultProfile(), 'bastion', 0, 0, 123);
    const before = JSON.stringify(current);
    await logger.begin(current, { ...meta, build: 'a'.repeat(40) });
    logger.sample(current, {
      status: 'foreground',
      fps: 42,
      simulationMs: 9,
      renderMs: 7,
      frameP95Ms: 31,
      measuredSeconds: 4,
      catchupSeconds: 2,
      speed: 3,
      effects: 'high',
      spectacle: 'spectacular',
    });
    const log = (await exported(logger)).runs[0];
    expect(log.samples[0].data).toMatchObject({
      maxHealth: current.maxHp,
      waveTime: 0,
      entities: { enemies: current.enemies.length, projectiles: current.projectiles.length },
      rules: {
        combat: 3,
        arsenal: 2,
        encounters: 2,
        shops: 2,
        evolution: 1,
        balanceEdition: 'spire-e1',
      },
      performance: {
        status: 'foreground',
        fps: 42,
        simulationMs: 9,
        frameP95Ms: 31,
        catchupSeconds: 2,
        speed: 3,
      },
    });
    expect(log.events[0].data.clientBuild).toBe('a'.repeat(40));
    expect(JSON.stringify(current)).toBe(before);
  });
  it('records background context without presenting throttled callbacks as measured FPS', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    logger.sample(current, { status: 'background', catchupSeconds: 20, speed: 2 });
    const perf = (await exported(logger)).runs[0].samples[0].data.performance;
    expect(perf).toEqual({ status: 'background', catchupSeconds: 20, speed: 2 });
  });
  it('records evolution using a content identifier while filesystem path fields stay forbidden', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    logger.event(current.id, 10, 'evolution', { pathId: 'citadel', tier: 1 });
    logger.event(current.id, 11, 'evolution', { path: 'citadel', tier: 1 });
    const events = (await exported(logger)).runs[0].events;
    expect(events.filter((e: { type: string }) => e.type === 'evolution')).toEqual([
      { at: 10, type: 'evolution', data: { pathId: 'citadel', tier: 1 } },
    ]);
  });
  it('retains the original run build while noting the client build on resume', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    const otherBuild = 'b'.repeat(40);
    await logger.begin(current, { ...meta, build: otherBuild });
    const log = (await exported(logger)).runs[0];
    expect(log.build).toBe(meta.build);
    expect(log.events.at(-1).data.clientBuild).toBe(otherBuild);
  });
  it('records build, seed, run choices, bounded snapshots and completed outcomes', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    logger.event(current.id, 0, 'choice', { cardId: 'mod-size', priorStacks: 0, nextStacks: 1 });
    current.time = 10;
    logger.sample(current, { fps: 59.3, renderMs: 1.2 });
    current.time = 20;
    current.wave = 2;
    logger.sample(current);
    current.phase = 'ended';
    await logger.finish(current);
    const data = await exported(logger),
      log = data.runs[0];
    expect(data.version).toBe(1);
    expect(log).toMatchObject({
      id: current.id,
      build: meta.build,
      seed: 987,
      tower: 'bastion',
      mode: 'normal',
      runes: meta.runes,
      completed: true,
    });
    expect(log.events.map((e: { type: string }) => e.type)).toEqual(['begin', 'choice', 'finish']);
    expect(log.samples).toHaveLength(2);
    expect(log.samples[0].data.performance.fps).toBe(59.3);
    expect(log.outcome).toMatchObject({ phase: 'ended', wave: 2, cleared: false });
    expect(logger.status()).toMatchObject({ enabled: true, available: true, runs: 1 });
    expect(JSON.stringify(data)).not.toMatch(/email|ipAddress|userId|profile|\/home\//);
  });
  it('keeps sampling tied to combat time, not render calls or paused wall time', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    for (let i = 0; i < 100; i++) logger.sample(current);
    current.time = 9.9;
    logger.sample(current);
    current.time = 10;
    logger.sample(current);
    current.time = 20;
    current.phase = 'ended';
    logger.sample(current);
    expect((await exported(logger)).runs[0].samples.map((s: { at: number }) => s.at)).toEqual([
      0, 10,
    ]);
  });
  it('persists disabled preference, retains old logs, and resumes only after enabling', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    await logger.setEnabled(false);
    logger.event(current.id, 1, 'ignored', {});
    await logger.begin(run('ignored-run'), meta);
    const second = new LocalTelemetry();
    await second.init();
    expect(second.enabled).toBe(false);
    expect((await exported(second)).runs).toHaveLength(1);
    await second.setEnabled(true);
    await second.begin(current, meta);
    second.event(current.id, 2, 'enabled-choice', { card: 'mod-speed' });
    await second.finish(current);
    expect(
      (await exported(second)).runs[0].events.some(
        (e: { type: string }) => e.type === 'enabled-choice',
      ),
    ).toBe(true);
  });
  it('deletes analytics while retaining disabled preference and progression database', async () => {
    const logger = new LocalTelemetry();
    await logger.begin(run(), meta);
    await logger.setEnabled(false);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('last-spire', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('save');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('save', 'readwrite');
      tx.objectStore('save').put({ credits: 750 }, 'root');
      tx.oncomplete = () => resolve();
    });
    await logger.clear();
    expect((await exported(logger)).runs).toEqual([]);
    const fresh = new LocalTelemetry();
    await fresh.init();
    expect(fresh.enabled).toBe(false);
    const saved = await new Promise((resolve) => {
      const req = db.transaction('save').objectStore('save').get('root');
      req.onsuccess = () => resolve(req.result);
    });
    expect(saved).toEqual({ credits: 750 });
    db.close();
  });
  it('evicts oldest logs at thirty retained runs', async () => {
    const logger = new LocalTelemetry();
    for (let i = 0; i < 33; i++) {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000 + i)
        .mockReturnValueOnce(1000 + i)
        .mockReturnValueOnce(1000 + i);
      await logger.begin(run(`run-${i.toString().padStart(2, '0')}`), meta);
    }
    vi.restoreAllMocks();
    const logs = (await exported(logger)).runs;
    expect(logs).toHaveLength(30);
    expect(logs.some((r: { id: string }) => r.id === 'run-00')).toBe(false);
    expect(logs.some((r: { id: string }) => r.id === 'run-32')).toBe(true);
    expect(logger.status().runs).toBe(30);
  });
  it('enforces the byte budget and configurable smaller bounds', async () => {
    const logger = new LocalTelemetry({ maxBytes: 8000, maxRuns: 3 });
    for (let i = 0; i < 8; i++) {
      const current = run(`bytes-${i}`);
      await logger.begin(current, meta);
      logger.event(current.id, 1, 'payload', { data: 'x'.repeat(1000) });
      await logger.finish(current);
    }
    const logs = (await exported(logger)).runs;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.length).toBeLessThanOrEqual(3);
    expect(logger.status().bytes).toBeLessThanOrEqual(8000);
    expect(logs.some((r: { id: string }) => r.id === 'bytes-0')).toBe(false);
  });
  it('caps event and sample arrays, exposing dropped counts', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    for (let i = 0; i < MAX_TELEMETRY_EVENTS + 10; i++)
      logger.event(current.id, i, 'kill', { count: i });
    for (let i = 0; i < MAX_TELEMETRY_SAMPLES + 5; i++) {
      current.time = i * 10;
      logger.sample(current);
    }
    const log = (await exported(logger)).runs[0];
    expect(log.events).toHaveLength(MAX_TELEMETRY_EVENTS);
    expect(log.droppedEvents).toBe(11);
    expect(log.samples).toHaveLength(MAX_TELEMETRY_SAMPLES);
    expect(log.droppedSamples).toBe(5);
  });
  it('rejects nonfinite values, sparse arrays, accessors and oversized payloads without stopping capture', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    logger.event(current.id, 1, 'bad', { value: NaN });
    logger.event(current.id, 1, 'bad', { holes: new Array(1) });
    const getter = Object.defineProperty({}, 'secret', { get: () => 'never', enumerable: true });
    logger.event(current.id, 1, 'bad', getter);
    logger.event(current.id, 1, 'bad', { text: 'x'.repeat(MAX_TELEMETRY_PAYLOAD_BYTES) });
    logger.event(current.id, 2, 'good', { finite: 4, optional: undefined });
    const log = (await exported(logger)).runs[0];
    expect(log.events.map((e: { type: string }) => e.type)).toEqual(['begin', 'good']);
    expect(logger.status().available).toBe(true);
  });
  it('rejects invalid metadata instead of persisting malformed or path-shaped identifiers', async () => {
    const logger = new LocalTelemetry();
    await logger.begin(run(), { ...meta, build: '/private/build' });
    await logger.begin(run('bad-runes'), { ...meta, runes: { experience: Infinity } });
    expect((await exported(logger)).runs).toEqual([]);
    expect(logger.status().available).toBe(true);
  });
  it('excludes personal fields, local paths, and oversized composite event payloads', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    logger.event(current.id, 1, 'bad', { email: 'someone@example.invalid' });
    logger.event(current.id, 1, 'bad', { address: '/private/example' });
    logger.event(current.id, 1, 'bad', { value: '127.0.0.1' });
    logger.event(
      current.id,
      1,
      'bad',
      Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`field${i}`, 'x'.repeat(1000)])),
    );
    expect((await exported(logger)).runs[0].events.map((e: { type: string }) => e.type)).toEqual([
      'begin',
    ]);
  });
  it('contains storage write failures and leaves capture unavailable without rejecting gameplay calls', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('Storage quota exhausted');
    });
    logger.event(current.id, 1, 'choice', { card: 'mod-size' });
    await expect(logger.finish(current)).resolves.toBeUndefined();
    write.mockRestore();
    expect(logger.status()).toMatchObject({ available: false });
    expect((await exported(logger)).unavailable).toBe(true);
  });
  it('swallows unavailable storage and returns a useful status/export', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const logger = new LocalTelemetry();
    await logger.init();
    await expect(logger.begin(run(), meta)).resolves.toBeUndefined();
    expect(() => logger.event('run', 0, 'test', {})).not.toThrow();
    await expect(logger.finish(run())).resolves.toBeUndefined();
    await expect(logger.clear()).resolves.toBeUndefined();
    expect(logger.status()).toMatchObject({ available: false });
    expect((await exported(logger)).unavailable).toBe(true);
  });
  it('serializes rapid event/export operations without losing committed choices', async () => {
    const logger = new LocalTelemetry(),
      current = run();
    await logger.begin(current, meta);
    logger.event(current.id, 1, 'first', {});
    const first = logger.exportLogs();
    logger.event(current.id, 2, 'second', {});
    const second = logger.exportLogs();
    await Promise.all([first, second]);
    expect((await exported(logger)).runs[0].events.map((e: { type: string }) => e.type)).toEqual([
      'begin',
      'first',
      'second',
    ]);
  });
});
