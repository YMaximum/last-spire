import type { RunV2 } from '../model/arsenal';
import type { RunV3 } from '../game/types';

export interface TelemetryPerformance {
  fps?: number;
  renderMs?: number;
  simulationMs?: number;
  frameP95Ms?: number;
  measuredSeconds?: number;
  catchupSeconds?: number;
  speed?: number;
  status?: 'foreground' | 'background' | 'warming-up';
  effects?: 'high' | 'low';
  spectacle?: 'subtle' | 'balanced' | 'spectacular';
}

export const MAX_TELEMETRY_RUNS = 30;
export const MAX_TELEMETRY_BYTES = 30 * 1024 * 1024;
export const MAX_TELEMETRY_EVENTS = 5000;
export const MAX_TELEMETRY_SAMPLES = 1000;
export const MAX_TELEMETRY_PAYLOAD_BYTES = 8192;
const DB = 'last-spire-analytics';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Event = { at: number; type: string; data: Record<string, Json> };
type Sample = { at: number; data: Record<string, Json> };
export interface TelemetryRun {
  version: 1;
  id: string;
  build: string;
  seed: number;
  tower: string;
  stage: number;
  difficulty: number;
  mode: string;
  runes: Record<string, number>;
  startedAt: number;
  updatedAt: number;
  completed: boolean;
  droppedEvents: number;
  droppedSamples: number;
  events: Event[];
  samples: Sample[];
  outcome?: Record<string, Json>;
}
function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function json(value: unknown, depth = 0): Json {
  if (depth > 8) throw new Error('Telemetry payload is too deeply nested');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 1000) {
    if (
      /^(?:\/|[a-zA-Z]:\\|https?:\/\/)/.test(value) ||
      /^\S+@\S+\.\S+$/.test(value) ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
    )
      throw new Error('Personal or location data is excluded from gameplay logs');
    return value;
  }
  if (Array.isArray(value) && value.length <= 100) {
    const result: Json[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new Error('Telemetry array has holes');
      result.push(json(value[i], depth + 1));
    }
    return result;
  }
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const entries = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(entries).length > 100) throw new Error('Telemetry object is too large');
    const result: Record<string, Json> = {};
    for (const [key, field] of Object.entries(entries)) {
      if (
        !/^[a-zA-Z0-9_.:-]{1,100}$/.test(key) ||
        /^(?:password|secret|authorization|accessToken|apiKey|email|userId|ipAddress|path|url|profile)$/i.test(
          key,
        ) ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !('value' in field)
      )
        throw new Error('Invalid telemetry field');
      if (field.value !== undefined) result[key] = json(field.value, depth + 1);
    }
    return result;
  }
  throw new Error('Telemetry accepts finite JSON data only');
}
function payload(value: Record<string, unknown>): Record<string, Json> {
  const result = json(value);
  if (
    !result ||
    Array.isArray(result) ||
    typeof result !== 'object' ||
    bytes(result) > MAX_TELEMETRY_PAYLOAD_BYTES
  )
    throw new Error('Telemetry payload exceeds its limit');
  return result;
}
function token(value: unknown, max = 100): string {
  if (typeof value !== 'string' || value.length > max || !/^[a-zA-Z0-9_.:+-]+$/.test(value))
    throw new Error('Invalid telemetry identifier');
  return value;
}
function validRecord(value: unknown): value is TelemetryRun {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const r = value as TelemetryRun;
    const keys = [
      'version',
      'id',
      'build',
      'seed',
      'tower',
      'stage',
      'difficulty',
      'mode',
      'runes',
      'startedAt',
      'updatedAt',
      'completed',
      'droppedEvents',
      'droppedSamples',
      'events',
      'samples',
      'outcome',
    ];
    if (
      Object.keys(r).some((key) => !keys.includes(key)) ||
      r.version !== 1 ||
      typeof r.completed !== 'boolean'
    )
      return false;
    token(r.id, 128);
    token(r.build, 80);
    token(r.tower);
    token(r.mode, 20);
    if (!['quick', 'normal', 'endless', 'legacy'].includes(r.mode)) return false;
    for (const field of [
      'seed',
      'stage',
      'difficulty',
      'startedAt',
      'updatedAt',
      'droppedEvents',
      'droppedSamples',
    ] as const)
      if (!Number.isSafeInteger(r[field]) || r[field] < 0) return false;
    const runes = payload(r.runes);
    if (
      Object.values(runes).some((v) => typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    )
      return false;
    if (
      !Array.isArray(r.events) ||
      r.events.length > MAX_TELEMETRY_EVENTS ||
      !Array.isArray(r.samples) ||
      r.samples.length > MAX_TELEMETRY_SAMPLES
    )
      return false;
    for (const event of r.events) {
      if (
        Object.keys(event).sort().join() !== 'at,data,type' ||
        !Number.isFinite(event.at) ||
        event.at < 0
      )
        return false;
      token(event.type, 64);
      payload(event.data);
    }
    for (const sample of r.samples) {
      if (
        Object.keys(sample).sort().join() !== 'at,data' ||
        !Number.isFinite(sample.at) ||
        sample.at < 0
      )
        return false;
      payload(sample.data);
    }
    if (r.outcome !== undefined) payload(r.outcome);
    return true;
  } catch {
    return false;
  }
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function completion(tx: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Telemetry write aborted'));
  });
  void result.catch(() => undefined);
  return result;
}
function snapshot(run: RunV2): Record<string, Json> {
  const modern = run as RunV3;
  const protection = Object.fromEntries(
    Object.entries(run.counters)
      .filter(([key]) =>
        /heal|regen|reflect|absorb|shield|thorn|retaliat|protect|mitigat/.test(key),
      )
      .slice(0, 40),
  );
  return payload({
    wave: run.wave,
    waveTime: run.waveTime,
    maxHealth: run.maxHp,
    health: run.hp,
    shield: run.shield,
    kills: run.kills,
    scrap: run.scrap,
    earned: run.earned,
    level: modern.level,
    xp: modern.xp,
    xpRequired: modern.xpRequired,
    rules: {
      combat: run.rulesVersion ?? 2,
      arsenal: modern.arsenalVersion ?? 1,
      encounters: modern.encounterVersion ?? 1,
      shops: modern.shopVersion ?? 1,
      evolution: modern.evolution?.version ?? 0,
      balanceEdition: modern.leaderboard?.balanceEdition ?? 'unranked',
    },
    evolution: modern.evolution
      ? {
          pathId: modern.evolution.path,
          tier: modern.evolution.tier,
          pending: modern.evolution.pending,
        }
      : undefined,
    entities: { enemies: run.enemies.length, projectiles: run.projectiles.length },
    cleared: run.cleared,
    endless: run.endless,
    stats: run.stats,
    damageByWeapon: run.damageByWeapon,
    damageByElement: run.damageByElement,
    protection,
    equipment: run.weapons.map((w) => ({
      id: w.id,
      kind: w.kind,
      rarity: w.rarity,
      masteryRank: w.masteryRank,
      masteryProgress: w.masteryProgress,
      investment: w.mastery,
      infusions: w.infusions,
    })),
    cards: run.cards
      .slice(0, 50)
      .map((c) => ({ id: c.cardId, stacks: c.stacks, rarity: c.rarity, targetId: c.targetId })),
    cardsOmitted: Math.max(0, run.cards.length - 50),
    synergies: run.synergies.slice(0, 40),
  });
}
/** Private, bounded local diagnostics. This module never contacts a network endpoint. */
export class LocalTelemetry {
  enabled = true;
  private available = true;
  private error?: string;
  private initialized?: Promise<void>;
  private connection?: IDBDatabase;
  private queue: Promise<void> = Promise.resolve();
  private records = new Map<string, TelemetryRun>();
  private dirty = new Set<string>();
  private lastSample = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private runs = 0;
  private totalBytes = 0;
  private readonly maxRuns: number;
  private readonly maxBytes: number;
  constructor(options: { maxRuns?: number; maxBytes?: number } = {}) {
    this.maxRuns = Math.max(
      1,
      Math.min(
        MAX_TELEMETRY_RUNS,
        Math.floor(Number.isFinite(options.maxRuns) ? options.maxRuns! : MAX_TELEMETRY_RUNS),
      ),
    );
    this.maxBytes = Math.max(
      256,
      Math.min(
        MAX_TELEMETRY_BYTES,
        Math.floor(Number.isFinite(options.maxBytes) ? options.maxBytes! : MAX_TELEMETRY_BYTES),
      ),
    );
  }
  status(): { enabled: boolean; available: boolean; error?: string; runs: number; bytes: number } {
    return {
      enabled: this.enabled,
      available: this.available,
      ...(this.error ? { error: this.error } : {}),
      runs: this.runs,
      bytes: this.totalBytes,
    };
  }
  private failed(error: unknown): void {
    this.available = false;
    this.error =
      error instanceof Error ? error.message.slice(0, 160) : 'Local logging is unavailable';
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.connection?.close();
    this.connection = undefined;
  }
  init(): Promise<void> {
    return (this.initialized ??= (async () => {
      try {
        if (!globalThis.indexedDB) throw new Error('Browser storage is unavailable');
        this.connection = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(DB, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('runs'))
              db.createObjectStore('runs', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('Local logging storage is blocked'));
        });
        this.connection.onversionchange = () => {
          this.connection?.close();
          this.failed(new Error('Local logging storage changed'));
        };
        const tx = this.connection.transaction(['runs', 'settings'], 'readonly'),
          done = completion(tx);
        const [enabled, logs] = await Promise.all([
          request(tx.objectStore('settings').get('enabled')),
          request(tx.objectStore('runs').getAll()),
        ]);
        await done;
        this.enabled = typeof enabled === 'boolean' ? enabled : true;
        const ordered = (logs as unknown[])
          .filter(validRecord)
          .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
        let size = ordered.reduce((sum, log) => sum + bytes(log), 0);
        while (ordered.length > this.maxRuns || size > this.maxBytes)
          size -= bytes(ordered.shift()!);
        const keep = new Set(ordered.map((r) => r.id));
        const cleanup = this.connection.transaction('runs', 'readwrite'),
          cleaned = completion(cleanup);
        for (const raw of logs) if (!keep.has(raw.id)) cleanup.objectStore('runs').delete(raw.id);
        await cleaned;
        this.runs = ordered.length;
        this.totalBytes = size;
      } catch (error) {
        this.failed(error);
      }
    })());
  }
  private serialize(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.available) {
        try {
          await work();
        } catch (error) {
          this.failed(error);
        }
      }
    });
    return this.queue;
  }
  async setEnabled(enabled: boolean): Promise<void> {
    await this.init();
    this.enabled = enabled;
    if (!enabled && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
    await this.serialize(async () => {
      const tx = this.connection!.transaction('settings', 'readwrite'),
        done = completion(tx);
      tx.objectStore('settings').put(enabled, 'enabled');
      await done;
    });
  }
  async begin(
    run: RunV2,
    meta: { build: string; mode: string; runes: Record<string, number> },
  ): Promise<void> {
    await this.init();
    if (!this.enabled || !this.available) return;
    try {
      const id = token(run.id, 128),
        build = token(meta.build, 80),
        mode = token(meta.mode, 20);
      if (!['quick', 'normal', 'endless', 'legacy'].includes(mode))
        throw new Error('Unknown run mode');
      if (
        !Number.isSafeInteger(run.seed) ||
        run.seed < 0 ||
        run.seed > 0xffff_ffff ||
        !Number.isSafeInteger(run.stage) ||
        run.stage < 0 ||
        run.stage > 2 ||
        !Number.isSafeInteger(run.difficulty) ||
        run.difficulty < 0 ||
        run.difficulty > 10
      )
        throw new Error('Invalid run metadata');
      const runes = payload(meta.runes);
      if (
        Object.values(runes).some((v) => typeof v !== 'number' || v < 0 || !Number.isSafeInteger(v))
      )
        throw new Error('Rune levels must be nonnegative integers');
      const existing = await this.read(id);
      const record: TelemetryRun = existing ?? {
        version: 1,
        id,
        build,
        seed: run.seed,
        tower: token(run.tower),
        stage: run.stage,
        difficulty: run.difficulty,
        mode,
        runes: runes as Record<string, number>,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        completed: false,
        droppedEvents: 0,
        droppedSamples: 0,
        events: [],
        samples: [],
      };
      this.records.set(id, record);
      if (record.samples.length)
        this.lastSample.set(id, record.samples[record.samples.length - 1].at);
      this.event(id, run.time, existing ? 'resume' : 'begin', {
        clientBuild: build,
        state: snapshot(run),
        pending: run.pendingRewards
          .map((r) => ({
            id: r.id,
            kind: r.kind,
            wave: r.wave,
            offers: r.offers.map((o) => ({
              id: o.id,
              card: o.cardId,
              rarity: o.rarity,
              price: o.price,
            })),
          }))
          .slice(0, 10),
      });
      await this.flush();
    } catch (error) {
      this.error = error instanceof Error ? error.message.slice(0, 160) : 'Invalid logging data';
    }
  }
  event(runId: string, at: number, type: string, data: Record<string, unknown>): void {
    if (!this.enabled || !this.available) return;
    const record = this.records.get(runId);
    if (!record) return;
    try {
      if (!Number.isFinite(at) || at < 0) throw new Error('Invalid event time');
      record.events.push({ at, type: token(type, 64), data: payload(data) });
      if (record.events.length > MAX_TELEMETRY_EVENTS) {
        record.events.shift();
        record.droppedEvents++;
      }
      record.updatedAt = Date.now();
      this.dirty.add(runId);
      this.schedule();
    } catch (error) {
      this.error = error instanceof Error ? error.message.slice(0, 160) : 'Invalid logging event';
    }
  }
  sample(run: RunV2, perf?: TelemetryPerformance): void {
    if (!this.enabled || !this.available || run.phase !== 'combat') return;
    const record = this.records.get(run.id);
    if (!record || run.time - (this.lastSample.get(run.id) ?? -10) < 10) return;
    try {
      const data = snapshot(run);
      if (perf) {
        if (
          Object.values(perf).some(
            (value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0),
          )
        )
          throw new Error('Invalid performance measurement');
        data.performance = payload({ ...perf });
      }
      payload(data);
      record.samples.push({ at: run.time, data });
      if (record.samples.length > MAX_TELEMETRY_SAMPLES) {
        record.samples.shift();
        record.droppedSamples++;
      }
      this.lastSample.set(run.id, run.time);
      record.updatedAt = Date.now();
      this.dirty.add(run.id);
      this.schedule();
    } catch (error) {
      this.error =
        error instanceof Error ? error.message.slice(0, 160) : 'Invalid performance sample';
    }
  }
  async finish(run: RunV2): Promise<void> {
    if (!this.enabled || !this.available) return;
    const record = this.records.get(run.id);
    if (!record) return;
    try {
      record.completed = true;
      record.outcome = payload({ phase: run.phase, cleared: run.cleared, ...snapshot(run) });
      this.event(run.id, run.time, 'finish', { phase: run.phase, cleared: run.cleared });
      await this.flush();
    } catch (error) {
      this.error = error instanceof Error ? error.message.slice(0, 160) : 'Invalid outcome';
    }
  }
  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 5000);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }
  private async read(id: string): Promise<TelemetryRun | undefined> {
    if (!this.available || !this.connection) return undefined;
    const tx = this.connection.transaction('runs', 'readonly'),
      done = completion(tx);
    const result = await request(tx.objectStore('runs').get(id));
    await done;
    return validRecord(result) ? result : undefined;
  }
  private flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const changed = [...this.dirty].map((id) => this.records.get(id)!).filter(Boolean);
    this.dirty.clear();
    if (!changed.length) return this.queue;
    return this.serialize(async () => {
      const tx = this.connection!.transaction('runs', 'readwrite'),
        done = completion(tx),
        store = tx.objectStore('runs');
      try {
        const stored = (await request(store.getAll())) as Array<unknown>;
        const all = new Map<string, TelemetryRun>();
        for (const log of stored) {
          if (validRecord(log)) all.set(log.id, log);
          else if (log && typeof log === 'object' && 'id' in log)
            store.delete(log.id as IDBValidKey);
        }
        for (const log of changed) all.set(log.id, structuredClone(log));
        const logs = [...all.values()].sort(
          (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
        );
        let size = logs.reduce((sum, log) => sum + bytes(log), 0);
        while (logs.length > this.maxRuns || size > this.maxBytes) {
          const removed = logs.shift();
          if (!removed) break;
          size -= bytes(removed);
          all.delete(removed.id);
          store.delete(removed.id);
          this.records.delete(removed.id);
          this.lastSample.delete(removed.id);
        }
        for (const log of changed) if (all.has(log.id)) store.put(all.get(log.id)!);
        await done;
        this.runs = logs.length;
        this.totalBytes = size;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* transaction already ended */
        }
        await done.catch(() => undefined);
        throw error;
      }
    });
  }
  async exportLogs(): Promise<string> {
    await this.init();
    await this.flush();
    if (!this.available)
      return JSON.stringify({ version: 1, enabled: this.enabled, runs: [], unavailable: true });
    try {
      const tx = this.connection!.transaction('runs', 'readonly'),
        done = completion(tx);
      const raw = await request(tx.objectStore('runs').getAll());
      await done;
      const runs = (raw as unknown[]).filter(validRecord);
      return JSON.stringify(
        { version: 1, exportedAt: Date.now(), enabled: this.enabled, runs },
        null,
        2,
      );
    } catch (error) {
      this.failed(error);
      return JSON.stringify({ version: 1, enabled: this.enabled, runs: [], unavailable: true });
    }
  }
  async clear(): Promise<void> {
    await this.init();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.records.clear();
    this.dirty.clear();
    this.lastSample.clear();
    await this.serialize(async () => {
      const tx = this.connection!.transaction('runs', 'readwrite'),
        done = completion(tx);
      tx.objectStore('runs').clear();
      await done;
      this.runs = 0;
      this.totalBytes = 0;
    });
  }
}
