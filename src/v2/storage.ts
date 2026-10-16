import {
  defaultProfile,
  defaultSettings as legacySettings,
  parseSave as parseLegacy,
} from '../storage';
import { CARDS, WEAPONS } from './catalog';
import { rewardForRun } from './engine';
import type { Profile, RunV2, SaveV2, SettingsV2 } from './types';
import type { SaveData, Settings as LegacySettings } from '../types';

const DB = 'last-spire',
  STORE = 'save',
  ROOT = 'root',
  BACKUP = 'backup-v1';
const MAX_BYTES = 8 * 1024 * 1024,
  MAX_LEDGER = 20_000;
const RARITIES = ['normal', 'rare', 'epic', 'legendary', 'mythic'];
const ELEMENTS = ['fire', 'frost', 'lightning', 'poison', 'solar', 'void'];
const TOWERS = ['bastion', 'pyre', 'tempest', 'glacier', 'verdant', 'null'];
const ENEMIES = ['swarmer', 'runner', 'armored', 'ranged', 'support', 'splitter', 'elite', 'boss'];
const STATS = [
  'spent',
  'shopsVisited',
  'shopPurchases',
  'procCount',
  'peakEnemies',
  'peakProjectiles',
  'damageTaken',
  'skillsUsed',
];
type Obj = Record<string, unknown>;

export class SaveError extends Error {
  constructor(
    message: string,
    public code: 'invalid' | 'unavailable',
  ) {
    super(message);
    this.name = 'SaveError';
  }
}
export function defaultSettings(): SettingsV2 {
  return {
    ...legacySettings(),
    uiScale: 100,
    intensity: 'balanced',
    shake: false,
    autoPauseChoices: true,
    windows: {},
  };
}
export function emptySave(): SaveV2 {
  return { version: 2, profile: defaultProfile(), run: null, settings: defaultSettings() };
}
function oldSettings(s: SettingsV2): LegacySettings {
  return { sound: s.sound, effects: s.effects, reducedMotion: s.reducedMotion, speed: s.speed };
}
function fail(message: string): never {
  throw new SaveError(`Invalid save: ${message}`, 'invalid');
}
function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as Obj;
}
function shape(value: unknown, label: string, required: string[], optional: string[] = []): Obj {
  const v = object(value, label);
  for (const key of required) if (!Object.hasOwn(v, key)) fail(`${label}.${key} is missing`);
  for (const key of Object.keys(v))
    if (!required.includes(key) && !optional.includes(key)) fail(`${label}.${key} is unknown`);
  return v;
}
function list(value: unknown, label: string, max = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} has an invalid length`);
  return value;
}
function number(
  value: unknown,
  label: string,
  min = -Number.MAX_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    fail(`${label} is outside its valid range`);
  return value;
}
function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be text`);
  return value;
}
function id(value: unknown, label: string, max = 128): string {
  const s = text(value, label, max);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s)) fail(`${label} is not a valid identifier`);
  return s;
}
function bool(value: unknown, label: string): void {
  if (typeof value !== 'boolean') fail(`${label} must be true or false`);
}
function one(value: unknown, label: string, choices: readonly unknown[]): void {
  if (!choices.includes(value)) fail(`${label} has an unsupported value`);
}
function nums(
  v: Obj,
  keys: string[],
  label: string,
  min = -Number.MAX_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  integer = false,
): void {
  for (const k of keys) number(v[k], `${label}.${k}`, min, max, integer);
}
function strings(value: unknown, label: string, max: number, identifiers = false): void {
  for (const v of list(value, label, max)) (identifiers ? id : text)(v, label, 500);
}
function numericMap(value: unknown, label: string, min = 0): void {
  for (const [key, v] of Object.entries(object(value, label))) {
    id(key, label);
    number(v, `${label}.${key}`, min);
  }
}
function color(value: unknown, label: string): void {
  if (!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(text(value, label, 9)))
    fail(`${label} must be a hex color`);
}
// Reject prototype keys even in unused nested data, cycles, non-JSON values,
// accessors and custom objects before copying anything into live game state.
function tree(value: unknown, depth = 0): void {
  if (depth > 18) fail('nested data is too deep');
  if (typeof value === 'number') {
    number(value, 'number');
    return;
  }
  if (typeof value === 'string') {
    text(value, 'text', 8000);
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > 50_000) fail('array is too large');
    for (const v of value) tree(v, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail('objects must contain plain JSON data');
    const entries = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(entries).length > MAX_LEDGER) fail('object is too large');
    for (const [key, d] of Object.entries(entries)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('unsafe object key');
      if (!('value' in d)) fail('accessor properties are not JSON data');
      if (d.value !== undefined) tree(d.value, depth + 1);
    }
    return;
  }
  // Optional properties can be undefined on engine-created in-memory snapshots.
  if (value === undefined) return;
  fail('unsupported data');
}
function settings(value: unknown): SettingsV2 {
  const v = shape(
    value,
    'settings',
    ['sound', 'effects', 'reducedMotion', 'speed'],
    ['uiScale', 'intensity', 'shake', 'autoPauseChoices', 'windows'],
  );
  const legacy = parseLegacy(
    JSON.stringify({
      version: 1,
      profile: defaultProfile(),
      run: null,
      settings: {
        sound: v.sound,
        effects: v.effects,
        reducedMotion: v.reducedMotion,
        speed: v.speed,
      },
    }),
  ).settings;
  const result = {
    ...defaultSettings(),
    ...legacy,
    uiScale: v.uiScale ?? 100,
    intensity: v.intensity ?? 'balanced',
    shake: v.shake ?? false,
    autoPauseChoices: v.autoPauseChoices ?? true,
    windows: v.windows ?? {},
  } as SettingsV2;
  number(result.uiScale, 'UI scale', 85, 160);
  one(result.intensity, 'intensity', ['subtle', 'balanced', 'spectacular']);
  bool(result.shake, 'shake');
  bool(result.autoPauseChoices, 'autoPauseChoices');
  const positions = object(result.windows, 'window layouts');
  if (Object.keys(positions).length > 30) fail('too many window layouts');
  for (const [key, raw] of Object.entries(positions)) {
    id(key, 'window ID', 60);
    const w = shape(raw, 'window', [
      'x',
      'y',
      'width',
      'height',
      'minimized',
      'maximized',
      'docked',
    ]);
    nums(w, ['x', 'y'], 'window', -20_000, 20_000);
    nums(w, ['width', 'height'], 'window', 1, 20_000);
    for (const k of ['minimized', 'maximized', 'docked']) bool(w[k], `window.${k}`);
  }
  return result;
}
function validRun(value: unknown): RunV2 {
  const r = shape(value, 'run', [
    'version',
    'id',
    'tower',
    'stage',
    'difficulty',
    'seed',
    'rng',
    'time',
    'wave',
    'waveTime',
    'spawned',
    'spawnTotal',
    'spawnTimer',
    'phase',
    'hp',
    'maxHp',
    'shield',
    'scrap',
    'kills',
    'earned',
    'weapons',
    'cards',
    'enemies',
    'projectiles',
    'areas',
    'visuals',
    'buffs',
    'pendingRewards',
    'nextId',
    'targeting',
    'skillCd',
    'secondaryCd',
    'secondary',
    'synergies',
    'notices',
    'endless',
    'cleared',
    'settled',
    'damageByWeapon',
    'damageByElement',
    'counters',
    'stats',
    'tutorialStep',
  ]);
  one(r.version, 'run version', [2]);
  id(r.id, 'run ID');
  one(r.tower, 'tower', TOWERS);
  number(r.stage, 'stage', 0, 2, true);
  number(r.difficulty, 'difficulty', 0, 10, true);
  number(r.seed, 'seed', 0, 0xffff_ffff, true);
  number(r.rng, 'random state', 1, 0xffff_ffff, true);
  number(r.wave, 'wave', 1, 100_000, true);
  number(r.time, 'time', 0, 1e12);
  one(r.phase, 'phase', ['combat', 'victory', 'ended']);
  one(r.targeting, 'targeting', ['nearest', 'strongest', 'weakest']);
  nums(r, ['hp'], 'run', -1e12, 1e12);
  number(r.maxHp, 'maximum health', 1, 1e12);
  nums(r, ['shield', 'scrap', 'earned'], 'run', 0, 1e12);
  nums(r, ['waveTime', 'spawnTimer', 'skillCd', 'secondaryCd'], 'run', -1e8, 1e12);
  nums(
    r,
    ['kills', 'spawned', 'spawnTotal', 'nextId', 'tutorialStep'],
    'run',
    0,
    Number.MAX_SAFE_INTEGER,
    true,
  );
  for (const k of ['cleared', 'endless', 'settled']) bool(r[k], k);
  id(r.secondary, 'secondary', 80);
  const weapons = list(r.weapons, 'weapons', 6),
    ids = new Set<string>();
  if (!weapons.length) fail('run must have a weapon');
  for (const raw of weapons) {
    const w = shape(raw, 'weapon', [
      'id',
      'kind',
      'cooldown',
      'shotCycle',
      'lifetimeShots',
      'mastery',
      'rarity',
      'infusions',
      'angle',
    ]);
    const key = id(w.id, 'weapon ID');
    if (ids.has(key)) fail('duplicate weapon ID');
    ids.add(key);
    one(
      w.kind,
      'weapon kind',
      WEAPONS.map((w) => w.id),
    );
    one(w.rarity, 'weapon rarity', RARITIES);
    nums(w, ['cooldown', 'angle'], 'weapon');
    nums(w, ['shotCycle', 'lifetimeShots'], 'weapon', 0, Number.MAX_SAFE_INTEGER, true);
    number(w.mastery, 'weapon mastery', 0);
    for (const e of list(w.infusions, 'infusions', 6)) one(e, 'infusion', ELEMENTS);
  }
  const target = (v: unknown, label: string) => {
    if (v !== undefined && !ids.has(id(v, label))) fail(`${label} targets an unknown weapon`);
  };
  for (const raw of list(r.cards, 'cards', 800)) {
    const c = shape(raw, 'card', ['cardId', 'stacks', 'mastery', 'rarity'], ['targetId']);
    one(
      c.cardId,
      'card ID',
      CARDS.map((c) => c.id),
    );
    one(c.rarity, 'card rarity', RARITIES);
    number(c.stacks, 'card stacks', 1, 10_000, true);
    number(c.mastery, 'card mastery', 0);
    target(c.targetId, 'card target');
  }
  for (const raw of list(r.enemies, 'enemies', 20_000)) {
    const e = shape(raw, 'enemy', [
      'id',
      'kind',
      'x',
      'y',
      'hp',
      'maxHp',
      'speed',
      'damage',
      'radius',
      'armor',
      'attackCd',
      'burn',
      'poison',
      'chill',
      'mark',
      'stun',
      'vx',
      'vy',
      'reward',
      'damageType',
      'bounty',
      'bossPhase',
      'spawnWave',
    ]);
    one(e.kind, 'enemy kind', ENEMIES);
    one(e.damageType, 'enemy damage type', [...ELEMENTS, 'physical']);
    nums(e, ['id', 'bossPhase', 'spawnWave'], 'enemy', 0, Number.MAX_SAFE_INTEGER, true);
    nums(
      e,
      [
        'x',
        'y',
        'hp',
        'vx',
        'vy',
        'speed',
        'armor',
        'attackCd',
        'burn',
        'poison',
        'chill',
        'mark',
        'stun',
      ],
      'enemy',
    );
    nums(e, ['maxHp', 'damage', 'radius', 'reward', 'bounty'], 'enemy', 0);
  }
  for (const raw of list(r.projectiles, 'projectiles', 50_000)) {
    const p = shape(raw, 'projectile', [
      'id',
      'weaponId',
      'kind',
      'x',
      'y',
      'vx',
      'vy',
      'life',
      'maxLife',
      'damage',
      'radius',
      'elements',
      'pierce',
      'bounces',
      'homing',
      'split',
      'hit',
      'pulseTimer',
      'pulseInterval',
      'returning',
      'originX',
      'originY',
      'critical',
      'depth',
      'seed',
      'previousX',
      'previousY',
    ]);
    id(p.weaponId, 'projectile weapon');
    one(
      p.kind,
      'projectile kind',
      WEAPONS.map((w) => w.id),
    );
    nums(p, ['id', 'bounces', 'split', 'depth'], 'projectile', 0, Number.MAX_SAFE_INTEGER, true);
    // A direct beam decrements its exhausted pierce budget before its short
    // visual projectile expires on the following tick.
    number(p.pierce, 'projectile.pierce', -1, Number.MAX_SAFE_INTEGER, true);
    nums(
      p,
      [
        'x',
        'y',
        'vx',
        'vy',
        'life',
        'pulseTimer',
        'originX',
        'originY',
        'seed',
        'previousX',
        'previousY',
      ],
      'projectile',
    );
    nums(p, ['damage', 'radius', 'homing', 'pulseInterval'], 'projectile', 0);
    number(p.maxLife, 'projectile maximum life', 0.000001);
    bool(p.returning, 'projectile returning');
    bool(p.critical, 'projectile critical');
    for (const e of list(p.elements, 'projectile elements', 6))
      one(e, 'projectile element', ELEMENTS);
    for (const hit of list(p.hit, 'projectile hits', 20_000))
      number(hit, 'projectile hit', 0, Number.MAX_SAFE_INTEGER, true);
  }
  for (const raw of list(r.areas, 'areas')) {
    const a = shape(raw, 'area', [
      'id',
      'kind',
      'x',
      'y',
      'radius',
      'life',
      'maxLife',
      'tickTimer',
      'damage',
      'element',
      'weaponId',
      'delay',
      'depth',
    ]);
    one(a.kind, 'area kind', [
      'fire',
      'poison',
      'frost',
      'void',
      'meteor',
      'storm',
      'rune',
      'solar',
    ]);
    one(a.element, 'area element', ELEMENTS);
    id(a.weaponId, 'area weapon');
    nums(a, ['id', 'depth'], 'area', 0, Number.MAX_SAFE_INTEGER, true);
    nums(a, ['x', 'y', 'life', 'tickTimer', 'delay'], 'area');
    nums(a, ['radius', 'damage'], 'area', 0);
    number(a.maxLife, 'area maximum life', 0.000001);
  }
  for (const raw of list(r.visuals, 'visuals')) {
    const v = shape(
      raw,
      'visual',
      ['kind', 'x', 'y', 'color', 'size', 'life', 'maxLife'],
      ['x2', 'y2', 'secondaryColor', 'text', 'seed'],
    );
    id(v.kind, 'visual kind', 80);
    nums(v, ['x', 'y', 'life'], 'visual');
    number(v.size, 'visual size', 0);
    number(v.maxLife, 'visual maximum life', 0.000001);
    color(v.color, 'visual color');
    if (v.secondaryColor !== undefined) color(v.secondaryColor, 'visual secondary color');
    for (const k of ['x2', 'y2', 'seed']) if (v[k] !== undefined) number(v[k], `visual.${k}`);
    if (v.text !== undefined) text(v.text, 'visual text', 500);
  }
  for (const raw of list(r.buffs, 'buffs')) {
    const b = shape(raw, 'buff', ['id', 'source', 'stat', 'value', 'expires', 'stacks']);
    for (const k of ['id', 'source', 'stat']) id(b[k], `buff.${k}`);
    nums(b, ['value', 'expires'], 'buff');
    number(b.stacks, 'buff stacks', 1, Number.MAX_SAFE_INTEGER, true);
  }
  for (const raw of list(r.pendingRewards, 'pending rewards', 2000)) {
    const p = shape(raw, 'reward', ['id', 'kind', 'wave', 'offers', 'rerolls', 'repairStock']);
    id(p.id, 'reward ID');
    one(p.kind, 'reward kind', ['draft', 'shop']);
    nums(p, ['wave', 'rerolls', 'repairStock'], 'reward', 0, Number.MAX_SAFE_INTEGER, true);
    for (const raw of list(p.offers, 'offers', 8)) {
      const o = shape(raw, 'offer', ['id', 'cardId', 'rarity', 'price'], ['targetId']);
      id(o.id, 'offer ID');
      one(
        o.cardId,
        'offered card',
        CARDS.map((c) => c.id),
      );
      one(o.rarity, 'offer rarity', RARITIES);
      number(o.price, 'offer price', 0, 1e12);
      target(o.targetId, 'offer target');
    }
  }
  numericMap(r.damageByWeapon, 'weapon damage');
  numericMap(r.counters, 'counters', -Number.MAX_SAFE_INTEGER);
  const damage = shape(r.damageByElement, 'element damage', [...ELEMENTS, 'physical']);
  nums(damage, [...ELEMENTS, 'physical'], 'element damage', 0);
  const stats = shape(r.stats, 'statistics', STATS);
  nums(stats, STATS, 'statistics', 0);
  strings(r.synergies, 'synergies', 1000, true);
  strings(r.notices, 'notices', 1000);
  return r as unknown as RunV2;
}
export function parseGame(raw: string | unknown): SaveV2 {
  try {
    if (typeof raw === 'string') {
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) fail('file exceeds 8 MB');
      try {
        raw = JSON.parse(raw);
      } catch {
        fail('file is not valid JSON');
      }
    }
    tree(raw);
    const root = shape(raw, 'save', ['version', 'profile', 'run', 'settings']);
    if (root.version === 1) {
      const old = parseLegacy(JSON.stringify(raw));
      return {
        version: 2,
        profile: old.profile,
        run: old.run,
        settings: { ...defaultSettings(), ...old.settings },
      };
    }
    if (root.version !== 2) fail('unsupported version');
    const profile = parseLegacy(
      JSON.stringify({ version: 1, profile: root.profile, run: null, settings: legacySettings() }),
    ).profile;
    const opts = settings(root.settings);
    let run: SaveV2['run'] = null;
    if (root.run !== null) {
      const r = object(root.run, 'run');
      run =
        r.version === 1
          ? parseLegacy(
              JSON.stringify({ version: 1, profile, run: r, settings: oldSettings(opts) }),
            ).run
          : validRun(r);
    }
    const json = JSON.stringify({ version: 2, profile, run, settings: opts });
    if (new TextEncoder().encode(json).byteLength > MAX_BYTES) fail('file exceeds 8 MB');
    return JSON.parse(json) as SaveV2;
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(
      error instanceof Error ? error.message : 'Save could not be read',
      'invalid',
    );
  }
}
export function exportGame(data: SaveV2): string {
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
    (raw as { version?: unknown }).version === 1 &&
    (await request(store.get(BACKUP))) === undefined
  )
    store.put(raw, BACKUP);
}
export async function readRawSave(): Promise<unknown> {
  return transact('readonly', (store) => request(store.get(ROOT)));
}
export async function loadGame(): Promise<SaveV2> {
  return transact('readwrite', async (store) => {
    const raw = await request(store.get(ROOT));
    if (raw === undefined) return emptySave();
    await backupLegacy(store, raw);
    return parseGame(raw);
  });
}
export async function readLegacyBackup(): Promise<unknown> {
  return transact(
    'readonly',
    async (store) =>
      (await request(store.get(BACKUP))) ?? (await request(store.get('backup-before-v2'))),
  );
}
function settledProfile(
  profile: Profile,
  run: NonNullable<SaveV2['run']>,
  ledger: string[],
): Profile {
  const next = {
    ...profile,
    settledRuns: [...new Set([...profile.settledRuns, ...ledger, run.id])].slice(-MAX_LEDGER),
    seenSynergies: [...new Set([...profile.seenSynergies, ...run.synergies])],
  };
  if (ledger.includes(run.id)) return next;
  next.credits += run.version === 2 ? rewardForRun(run) : run.earned;
  next.runs += 1;
  next.bestWave = Math.max(next.bestWave, run.wave);
  next.totalKills += run.kills;
  if (run.cleared) {
    next.clears = [...new Set([...profile.clears, run.stage])].sort((a, b) => a - b);
    next.stageUnlocked = Math.max(profile.stageUnlocked, Math.min(3, run.stage + 2));
    next.difficultyUnlocked = Math.max(profile.difficultyUnlocked, Math.min(5, run.difficulty + 1));
  }
  return next;
}
export function settleInMemory(data: SaveV2): SaveV2 {
  const incoming = parseGame(data);
  if (!incoming.run) return incoming;
  incoming.profile = settledProfile(incoming.profile, incoming.run, incoming.profile.settledRuns);
  incoming.run.settled = true;
  return parseGame(incoming);
}
export async function saveGame(data: SaveV2, replace = false): Promise<void> {
  const incoming = parseGame(data);
  await transact('readwrite', async (store) => {
    const raw = await request(store.get(ROOT));
    let current: SaveV2 | null = null;
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
      // The settled run stays in data while the hangar is open. Its ledger
      // permits later purchases/preferences, while queued combat snapshots
      // cannot reopen it or erase the awarded credits.
      if (!incoming.run.settled || !incoming.profile.settledRuns.includes(incoming.run.id)) return;
      incoming.run = current.run;
    }
    if (!replace && current) {
      const stale = current.profile.settledRuns.some(
        (id) => !incoming.profile.settledRuns.includes(id),
      );
      if (stale) {
        incoming.profile = current.profile;
        if (!incoming.run) incoming.run = current.run;
      } else
        incoming.profile.settledRuns = [
          ...new Set([...incoming.profile.settledRuns, ...current.profile.settledRuns]),
        ].slice(-MAX_LEDGER);
    }
    store.put(parseGame(incoming), ROOT);
  });
}
/** Explicit imports bypass stale-autosave protection, including matching run IDs. */
export async function replaceGame(data: SaveV2): Promise<void> {
  return saveGame(data, true);
}
export async function settleGame(data: SaveV2): Promise<SaveV2> {
  const incoming = parseGame(data);
  if (!incoming.run) return incoming;
  return transact('readwrite', async (store) => {
    const raw = await request(store.get(ROOT));
    const current = raw === undefined ? null : parseGame(raw);
    await backupLegacy(store, raw);
    const run = incoming.run!;
    if (current?.profile.settledRuns.includes(run.id)) return current;
    const profile = settledProfile(
      current?.profile ?? incoming.profile,
      run,
      current?.profile.settledRuns ?? incoming.profile.settledRuns,
    );
    // A delayed settlement for an older run cannot reopen it over a newer run.
    const nextRun =
      current?.run && current.run.id !== run.id ? current.run : { ...run, settled: true };
    const result = parseGame({
      ...incoming,
      profile,
      run: nextRun,
      settings: current?.settings ?? incoming.settings,
    });
    store.put(result, ROOT);
    return result;
  });
}
export function legacySave(data: SaveV2): SaveData {
  if (data.run?.version !== 1) throw new Error('Not a legacy expedition');
  return { version: 1, profile: data.profile, run: data.run, settings: oldSettings(data.settings) };
}
