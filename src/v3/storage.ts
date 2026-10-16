import {
  defaultSettings as settingsV2,
  emptySave as emptyV2,
  parseGame as parseV2,
  settleInMemory as settleV2,
  SaveError,
} from '../v2/storage';
import type { SaveV2, SettingsV2 } from '../v2/types';
import type { SaveData } from '../types';
import {
  RUNE_CAPS,
  defaultRuneLoadout,
  defaultAutocastConfig,
  normalizeAutocastConfig,
  type RuneId,
  type RuneLoadout,
  type AutocastRules,
} from './controls';

export { SaveError };
export type RunMode = 'quick' | 'normal' | 'endless';
export interface ActiveRunConfig {
  runId: string;
  rulesVersion: 2 | 3;
  runes: Record<RuneId, number>;
  autocast: AutocastRules;
  gameplay?: Record<string, unknown>;
}
export interface ModeRecord {
  runId: string;
  mode: RunMode;
  stage: number;
  difficulty: number;
  tower: string;
  runes: Record<RuneId, number>;
  wave: number;
  cleared: boolean;
  seconds: number;
  credits: number;
}
export interface SaveV3 extends Omit<SaveV2, 'version'> {
  version: 3;
  progression: {
    runes: RuneLoadout;
    autocast: AutocastRules;
    active: ActiveRunConfig | null;
    records: ModeRecord[];
  };
}
const DB = 'last-spire',
  STORE = 'save',
  ROOT = 'root',
  BACKUP = 'backup-v2';
const MAX_BYTES = 8 * 1024 * 1024;
type Obj = Record<string, unknown>;
function invalid(message: string): never {
  throw new SaveError(`Invalid save: ${message}`, 'invalid');
}
function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(`${label} must be an object`);
  return value as Obj;
}
function shape(value: unknown, label: string, required: string[], optional: string[] = []): Obj {
  const result = object(value, label);
  if (
    required.some((k) => !(k in result)) ||
    Object.keys(result).some((k) => !required.includes(k) && !optional.includes(k))
  )
    invalid(`${label} has unsupported or missing fields`);
  return result;
}
function numeric(value: unknown, label: string, min: number, max: number, integer = true): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid(`${label} must be ${integer ? 'an integer' : 'finite'} from ${min} to ${max}`);
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    invalid(`${label} must be an identifier`);
  return value;
}
function finiteTree(value: unknown, depth = 0): void {
  if (depth > 24) invalid('metadata nesting exceeds 24 levels');
  if (typeof value === 'number' && !Number.isFinite(value))
    invalid('metadata contains nonfinite numbers');
  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  )
    invalid('metadata contains unsupported values');
  if (value && typeof value === 'object') {
    if (Object.keys(value).length > 20_000) invalid('metadata has too many entries');
    for (const [key, entry] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        invalid('metadata contains an unsafe key');
      finiteTree(entry, depth + 1);
    }
  }
}
function runeSnapshot(value: unknown, label: string, ownership = false): Record<RuneId, number> {
  const ids = Object.keys(RUNE_CAPS) as RuneId[];
  const result = shape(value, label, ids);
  for (const id of ids)
    numeric(
      result[id],
      `${label}.${id}`,
      0,
      ownership && ['power', 'vitality', 'fortune'].includes(id) ? 1000 : RUNE_CAPS[id],
    );
  return result as Record<RuneId, number>;
}
function loadout(value: unknown): RuneLoadout {
  const result = shape(value, 'runes', ['owned', 'selected']);
  const owned = runeSnapshot(result.owned, 'owned runes', true);
  const selected = runeSnapshot(result.selected, 'selected runes');
  for (const id of Object.keys(RUNE_CAPS) as RuneId[])
    if (selected[id] > owned[id]) invalid(`selected ${id} exceeds ownership`);
  return { owned, selected };
}
function autocast(value: unknown): AutocastRules {
  const normalized = normalizeAutocastConfig(value);
  // Normalization supplies UI defaults; persistence rejects malformed rules instead of silently changing strategy.
  if (JSON.stringify(value) !== JSON.stringify(normalized)) {
    const canonical = (entry: unknown): unknown =>
      Array.isArray(entry)
        ? entry.map(canonical)
        : entry && typeof entry === 'object'
          ? Object.fromEntries(
              Object.entries(entry)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, canonical(v)]),
            )
          : entry;
    if (JSON.stringify(canonical(value)) !== JSON.stringify(canonical(normalized)))
      invalid('autocast configuration is invalid');
  }
  return normalized;
}
export function defaultSettings(): SettingsV2 {
  return { ...settingsV2(), effects: 'high', intensity: 'spectacular' };
}
function legacyRunes(upgrades: SaveV2['profile']['upgrades']): RuneLoadout {
  const result = defaultRuneLoadout(upgrades);
  // Older save validators allowed ownership above today's purchase caps. Preserve that investment.
  for (const id of ['power', 'vitality', 'fortune'] as const) result.owned[id] = upgrades[id];
  return result;
}
export function emptySave(): SaveV3 {
  const base = emptyV2();
  return {
    ...base,
    version: 3,
    settings: defaultSettings(),
    progression: {
      runes: defaultRuneLoadout(base.profile.upgrades),
      autocast: defaultAutocastConfig(),
      active: null,
      records: [],
    },
  };
}
export function parseGame(raw: string | unknown): SaveV3 {
  try {
    if (typeof raw === 'string') {
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) invalid('file exceeds 8 MB');
      raw = JSON.parse(raw);
    }
    finiteTree(raw);
    const root = object(raw, 'save');
    const version = root.version;
    if (![1, 2, 3].includes(version as number)) invalid('unsupported version');
    const sourceSettings = object(root.settings, 'settings');
    const settings = { ...defaultSettings(), ...sourceSettings };
    const base = parseV2(
      version === 3
        ? { version: 2, profile: root.profile, run: root.run, settings }
        : { ...root, settings: version === 1 ? sourceSettings : settings },
    );
    if (version !== 3)
      return {
        ...base,
        version: 3,
        settings: { ...defaultSettings(), ...sourceSettings } as SettingsV2,
        progression: {
          runes: legacyRunes(base.profile.upgrades),
          autocast: defaultAutocastConfig(),
          active: null,
          records: [],
        },
      };
    shape(root, 'save', ['version', 'profile', 'run', 'settings', 'progression']);
    const p = shape(root.progression, 'progression', ['runes', 'autocast', 'active', 'records']);
    const runes = loadout(p.runes);
    const rules = autocast(p.autocast);
    let active: ActiveRunConfig | null = null;
    if (p.active !== null) {
      const a = shape(
        p.active,
        'active run',
        ['runId', 'rulesVersion', 'runes', 'autocast'],
        ['gameplay'],
      );
      identifier(a.runId, 'active run ID');
      if (![2, 3].includes(a.rulesVersion as number))
        invalid('active rules version is unsupported');
      if (!base.run || base.run.id !== a.runId) invalid('active run ID does not match expedition');
      if (a.gameplay !== undefined) object(a.gameplay, 'gameplay');
      active = {
        runId: a.runId as string,
        rulesVersion: a.rulesVersion as 2 | 3,
        runes: runeSnapshot(a.runes, 'active runes'),
        autocast: autocast(a.autocast),
        ...(a.gameplay !== undefined ? { gameplay: a.gameplay as Obj } : {}),
      };
    }
    if (!Array.isArray(p.records) || p.records.length > 500)
      invalid('records must contain at most 500 entries');
    const records = p.records.map((entry, i) => {
      const r = shape(entry, `record ${i}`, [
        'runId',
        'mode',
        'stage',
        'difficulty',
        'tower',
        'runes',
        'wave',
        'cleared',
        'seconds',
        'credits',
      ]);
      identifier(r.runId, 'record run ID');
      identifier(r.tower, 'record tower');
      if (!['quick', 'normal', 'endless'].includes(r.mode as string))
        invalid('record mode is invalid');
      numeric(r.stage, 'record stage', 0, 2);
      numeric(r.difficulty, 'record difficulty', 0, 5);
      numeric(r.wave, 'record wave', 1, Number.MAX_SAFE_INTEGER);
      numeric(r.seconds, 'record seconds', 0, Number.MAX_SAFE_INTEGER, false);
      numeric(r.credits, 'record credits', 0, Number.MAX_SAFE_INTEGER);
      if (typeof r.cleared !== 'boolean') invalid('record clear flag is invalid');
      runeSnapshot(r.runes, 'record runes');
      return r as unknown as ModeRecord;
    });
    if (new Set(records.map((r) => r.runId)).size !== records.length)
      invalid('duplicate record IDs');
    // Legacy ownership stays synchronized; selected levels are only applied to new-run snapshots.
    base.profile.upgrades = {
      power: runes.owned.power,
      vitality: runes.owned.vitality,
      fortune: runes.owned.fortune,
    };
    const result: SaveV3 = {
      ...base,
      version: 3,
      progression: { runes, autocast: rules, active, records },
    };
    const json = JSON.stringify(result);
    if (new TextEncoder().encode(json).byteLength > MAX_BYTES) invalid('file exceeds 8 MB');
    return JSON.parse(json) as SaveV3;
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(
      error instanceof Error ? error.message : 'Save could not be read',
      'invalid',
    );
  }
}
export function exportGame(data: SaveV3): string {
  return JSON.stringify(parseGame(data), null, 2);
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new SaveError('Browser storage is unavailable', 'unavailable'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(
        new SaveError(e instanceof Error ? e.message : 'Could not open storage', 'unavailable'),
      );
      return;
    }
    let blocked = false;
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      if (blocked) req.result.close();
      else resolve(req.result);
    };
    req.onerror = () =>
      reject(new SaveError(req.error?.message ?? 'Could not open storage', 'unavailable'));
    req.onblocked = () => {
      blocked = true;
      reject(new SaveError('Opening browser storage is blocked', 'unavailable'));
    };
  });
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'));
  });
  // The request may reject first; the transaction rejection is still awaited by
  // transact, but must not become an unhandled rejection in the interim.
  void promise.catch(() => undefined);
  return promise;
}
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const connection = await db();
  try {
    const tx = connection.transaction(STORE, mode),
      finished = done(tx);
    try {
      const result = await work(tx.objectStore(STORE));
      await finished;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* transaction may have already completed */
      }
      await finished.catch(() => undefined);
      if (error instanceof SaveError) throw error;
      throw new SaveError(
        error instanceof Error ? error.message : 'Browser storage failed',
        'unavailable',
      );
    }
  } finally {
    connection.close();
  }
}
async function backupLegacy(store: IDBObjectStore, raw: unknown): Promise<void> {
  if (
    raw &&
    [1, 2].includes((raw as { version?: number }).version ?? 0) &&
    (await request(store.get(BACKUP))) === undefined
  )
    store.put(raw, BACKUP);
}
export async function readRawSave(): Promise<unknown> {
  return transact('readonly', (store) => request(store.get(ROOT)));
}
export async function readLegacyBackup(): Promise<unknown> {
  return transact(
    'readonly',
    async (store) =>
      (await request(store.get(BACKUP))) ??
      (await request(store.get('backup-v1'))) ??
      (await request(store.get('backup-before-v2'))),
  );
}
export async function loadGame(): Promise<SaveV3> {
  return transact('readwrite', async (store) => {
    const raw = await request(store.get(ROOT));
    if (raw === undefined) return emptySave();
    const result = parseGame(raw);
    await backupLegacy(store, raw);
    return result;
  });
}
function settleProfile(data: SaveV3, profile = data.profile): SaveV3 {
  const legacy = settleV2({ version: 2, profile, run: data.run, settings: data.settings });
  return parseGame({ ...data, profile: legacy.profile, run: legacy.run });
}
export function settleInMemory(data: SaveV3): SaveV3 {
  return settleProfile(parseGame(data));
}
export async function saveGame(data: SaveV3, replace = false): Promise<void> {
  const incoming = parseGame(data);
  await transact('readwrite', async (store) => {
    const raw = await request(store.get(ROOT));
    let current: SaveV3 | null = null;
    if (raw !== undefined && !replace) {
      try {
        current = parseGame(raw);
      } catch {
        throw new SaveError(
          'Existing save could not be read. Export it before replacing it.',
          'invalid',
        );
      }
    }
    await backupLegacy(store, raw);
    if (!replace && incoming.run && current?.profile.settledRuns.includes(incoming.run.id)) {
      if (!incoming.run.settled || !incoming.profile.settledRuns.includes(incoming.run.id)) return;
      incoming.run = current.run;
      incoming.progression.active = current.progression.active;
    }
    if (!replace && current) {
      const stale = current.profile.settledRuns.some(
        (id) => !incoming.profile.settledRuns.includes(id),
      );
      if (stale) {
        incoming.profile = current.profile;
        incoming.progression = current.progression;
        incoming.run = current.run;
      } else
        incoming.profile.settledRuns = [
          ...new Set([...incoming.profile.settledRuns, ...current.profile.settledRuns]),
        ].slice(-20_000);
    }
    store.put(parseGame(incoming), ROOT);
  });
}
export async function replaceGame(data: SaveV3): Promise<void> {
  return saveGame(data, true);
}
export async function settleGame(data: SaveV3): Promise<SaveV3> {
  const incoming = parseGame(data);
  if (!incoming.run) return incoming;
  return transact('readwrite', async (store) => {
    const raw = await request(store.get(ROOT));
    const current = raw === undefined ? null : parseGame(raw);
    await backupLegacy(store, raw);
    const run = incoming.run!;
    if (current?.profile.settledRuns.includes(run.id)) return current;
    const progression = current?.progression ?? incoming.progression;
    const settled = settleV2({
      version: 2,
      profile: current?.profile ?? incoming.profile,
      run,
      settings: incoming.settings,
    });
    const nextRun = current?.run && current.run.id !== run.id ? current.run : settled.run;
    const result = parseGame({
      ...incoming,
      profile: settled.profile,
      run: nextRun,
      settings: current?.settings ?? incoming.settings,
      progression,
    });
    store.put(result, ROOT);
    return result;
  });
}
export function legacySave(data: SaveV3): SaveData {
  if (data.run?.version !== 1) throw new Error('Not a legacy expedition');
  const s = data.settings;
  return {
    version: 1,
    profile: data.profile,
    run: data.run,
    settings: {
      sound: s.sound,
      effects: s.effects,
      reducedMotion: s.reducedMotion,
      speed: s.speed,
    },
  };
}
