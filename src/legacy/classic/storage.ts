import type {
  Attack,
  Element,
  Enemy,
  EnemyKind,
  Modifier,
  Pattern,
  Profile,
  Projectile,
  RunState,
  SaveData,
  Settings,
  TowerId,
  Upgrade,
} from '../../model/shared';
import { STAGES } from '../../content/world';

const DB_NAME = 'last-spire';
const DB_VERSION = 1;
const STORE_NAME = 'save';
const ROOT_KEY = 'root';
const MAX_SAVE_BYTES = 5 * 1024 * 1024;
const MAX_SETTLED_RUNS = 20_000;

const PATTERNS: readonly Pattern[] = [
  'bolt',
  'volley',
  'spiral',
  'beam',
  'orbit',
  'pulse',
  'swarm',
  'mine',
];
const ELEMENTS: readonly Element[] = ['fire', 'frost', 'lightning', 'poison', 'solar', 'void'];
const MODIFIERS: readonly Modifier[] = ['echo', 'rupture', 'mark', 'surge'];
const TOWERS: readonly TowerId[] = ['bastion', 'pyre', 'tempest', 'glacier', 'verdant', 'null'];
const ENEMY_KINDS: readonly EnemyKind[] = [
  'swarmer',
  'runner',
  'armored',
  'ranged',
  'support',
  'splitter',
  'elite',
  'boss',
];
const TARGETINGS = ['nearest', 'strongest', 'weakest'] as const;
const SECONDARIES = ['repair', 'nova', 'stasis'] as const;
const PHASES = ['combat', 'draft', 'shop', 'victory', 'ended'] as const;
const UPGRADE_KINDS = ['pattern', 'element', 'modifier', 'rank', 'perk', 'secondary'] as const;
const ELEMENT_RECORD_KEYS: readonly Element[] = ELEMENTS;

type JsonRecord = Record<string, unknown>;

export function defaultProfile(): Profile {
  return {
    version: 1,
    credits: 0,
    unlocked: ['bastion'],
    stageUnlocked: 1,
    clears: [],
    difficultyUnlocked: 0,
    upgrades: { power: 0, vitality: 0, fortune: 0 },
    runs: 0,
    bestWave: 0,
    totalKills: 0,
    settledRuns: [],
    seenSynergies: [],
    tutorialDone: false,
  };
}

export function defaultSettings(): Settings {
  return { sound: true, effects: 'high', reducedMotion: false, speed: 1 };
}

function defaultSave(): SaveData {
  return { version: 1, profile: defaultProfile(), run: null, settings: defaultSettings() };
}

function fail(path: string, reason: string): never {
  throw new Error(`Invalid save at ${path}: ${reason}`);
}

function record(value: unknown, path: string, keys: readonly string[]): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'expected an object');
  const obj = value as JsonRecord;
  for (const key of Object.keys(obj))
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of keys) if (!(key in obj)) fail(`${path}.${key}`, 'missing field');
  return obj;
}

function optionalRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'expected an object');
  const obj = value as JsonRecord;
  for (const key of Object.keys(obj))
    if (![...required, ...optional].includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of required) if (!(key in obj)) fail(`${path}.${key}`, 'missing field');
  return obj;
}

function finite(value: unknown, path: string, min = -1_000_000_000, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(path, `expected a finite number from ${min} to ${max}`);
  return value;
}

function integer(value: unknown, path: string, min = 0, max = 1_000_000_000): number {
  const n = finite(value, path, min, max);
  if (!Number.isSafeInteger(n)) fail(path, 'expected a safe integer');
  return n;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function enumValue<T extends string | number>(
  value: unknown,
  path: string,
  options: readonly T[],
): T {
  if ((typeof value !== 'string' && typeof value !== 'number') || !options.includes(value as T))
    fail(path, 'unsupported value');
  return value as T;
}

function identifier(value: unknown, path: string, maxLength = 128): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)
  ) {
    fail(path, 'expected a valid identifier');
  }
  return value;
}

function text(value: unknown, path: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.length > maxLength)
    fail(path, `expected text of at most ${maxLength} characters`);
  return value;
}

function array<T>(
  value: unknown,
  path: string,
  maxLength: number,
  parse: (item: unknown, itemPath: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length > maxLength)
    fail(path, `expected an array of at most ${maxLength} entries`);
  return value.map((item, index) => parse(item, `${path}[${index}]`));
}

function numericRecord(value: unknown, path: string): Record<Element, number> {
  const obj = record(value, path, ELEMENT_RECORD_KEYS);
  return Object.fromEntries(
    ELEMENT_RECORD_KEYS.map((key) => [key, finite(obj[key], `${path}.${key}`, 0, 1e12)]),
  ) as Record<Element, number>;
}

function parseAttack(value: unknown, path: string): Attack {
  const obj = record(value, path, ['pattern', 'element', 'modifier', 'rank', 'cooldown', 'shots']);
  return {
    pattern: enumValue(obj.pattern, `${path}.pattern`, PATTERNS),
    element: enumValue(obj.element, `${path}.element`, ELEMENTS),
    modifier: enumValue(obj.modifier, `${path}.modifier`, MODIFIERS),
    rank: integer(obj.rank, `${path}.rank`, 1, 100),
    cooldown: finite(obj.cooldown, `${path}.cooldown`, 0, 1e7),
    shots: integer(obj.shots, `${path}.shots`, 0, Number.MAX_SAFE_INTEGER),
  };
}

function parseEnemy(value: unknown, path: string): Enemy {
  const fields = [
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
  ];
  const obj = record(value, path, fields);
  return {
    id: integer(obj.id, `${path}.id`, 0, 2_147_483_647),
    kind: enumValue(obj.kind, `${path}.kind`, ENEMY_KINDS),
    x: finite(obj.x, `${path}.x`, -100_000, 100_000),
    y: finite(obj.y, `${path}.y`, -100_000, 100_000),
    hp: finite(obj.hp, `${path}.hp`, -1e7, 1e9),
    maxHp: finite(obj.maxHp, `${path}.maxHp`, 0, 1e9),
    speed: finite(obj.speed, `${path}.speed`, -1e5, 1e5),
    damage: finite(obj.damage, `${path}.damage`, 0, 1e8),
    radius: finite(obj.radius, `${path}.radius`, 0, 10_000),
    armor: finite(obj.armor, `${path}.armor`, -1e6, 1e6),
    attackCd: finite(obj.attackCd, `${path}.attackCd`, -1e7, 1e7),
    burn: finite(obj.burn, `${path}.burn`, -1e7, 1e7),
    poison: finite(obj.poison, `${path}.poison`, -1e7, 1e7),
    chill: finite(obj.chill, `${path}.chill`, -1e7, 1e7),
    mark: finite(obj.mark, `${path}.mark`, -1e7, 1e7),
    stun: finite(obj.stun, `${path}.stun`, -1e7, 1e7),
    vx: finite(obj.vx, `${path}.vx`, -1e5, 1e5),
    vy: finite(obj.vy, `${path}.vy`, -1e5, 1e5),
    reward: finite(obj.reward, `${path}.reward`, 0, 1e8),
  };
}

function parseProjectile(value: unknown, path: string): Projectile {
  const required = [
    'id',
    'x',
    'y',
    'vx',
    'vy',
    'life',
    'damage',
    'radius',
    'element',
    'modifier',
    'pattern',
    'pierce',
    'hit',
    'surge',
  ];
  const obj = optionalRecord(value, path, required, ['targetId']);
  const projectile: Projectile = {
    id: integer(obj.id, `${path}.id`, 0, 2_147_483_647),
    x: finite(obj.x, `${path}.x`, -100_000, 100_000),
    y: finite(obj.y, `${path}.y`, -100_000, 100_000),
    vx: finite(obj.vx, `${path}.vx`, -1e6, 1e6),
    vy: finite(obj.vy, `${path}.vy`, -1e6, 1e6),
    life: finite(obj.life, `${path}.life`, -1e7, 1e7),
    damage: finite(obj.damage, `${path}.damage`, 0, 1e9),
    radius: finite(obj.radius, `${path}.radius`, 0, 10_000),
    element: enumValue(obj.element, `${path}.element`, ELEMENTS),
    modifier: enumValue(obj.modifier, `${path}.modifier`, MODIFIERS),
    pattern: enumValue(obj.pattern, `${path}.pattern`, PATTERNS),
    pierce: integer(obj.pierce, `${path}.pierce`, 0, 100_000),
    hit: array(obj.hit, `${path}.hit`, 10_000, (item, p) => integer(item, p, 0, 2_147_483_647)),
    surge: boolean(obj.surge, `${path}.surge`),
  };
  if ('targetId' in obj)
    projectile.targetId = integer(obj.targetId, `${path}.targetId`, 0, 2_147_483_647);
  return projectile;
}

function parseUpgrade(value: unknown, path: string): Upgrade {
  const obj = optionalRecord(
    value,
    path,
    ['id', 'kind', 'name', 'description', 'color', 'value', 'price'],
    ['slot'],
  );
  const kind = enumValue(obj.kind, `${path}.kind`, UPGRADE_KINDS);
  const color = text(obj.color, `${path}.color`, 100);
  if (!/^#[\da-f]{6}$/i.test(color)) fail(`${path}.color`, 'expected a six-digit hex color');

  let upgradeValue: string;
  switch (kind) {
    case 'pattern':
      upgradeValue = enumValue(obj.value, `${path}.value`, PATTERNS);
      break;
    case 'element':
      upgradeValue = enumValue(obj.value, `${path}.value`, ELEMENTS);
      break;
    case 'modifier':
      upgradeValue = enumValue(obj.value, `${path}.value`, MODIFIERS);
      break;
    case 'rank':
      if (obj.value !== 'rank') fail(`${path}.value`, 'unsupported rank upgrade value');
      upgradeValue = 'rank';
      break;
    case 'perk':
      upgradeValue = enumValue(obj.value, `${path}.value`, [
        'damage',
        'rate',
        'armor',
        'regen',
        'fortune',
      ] as const);
      break;
    case 'secondary':
      upgradeValue = enumValue(obj.value, `${path}.value`, SECONDARIES);
      break;
  }

  const result: Upgrade = {
    id: identifier(obj.id, `${path}.id`),
    kind,
    name: text(obj.name, `${path}.name`, 100),
    description: text(obj.description, `${path}.description`, 1000),
    color,
    value: upgradeValue,
    price: integer(obj.price, `${path}.price`, 0, 1_000_000_000),
  };
  if ('slot' in obj) result.slot = integer(obj.slot, `${path}.slot`, 0, 1000);
  return result;
}

function parseProfile(value: unknown, path: string): Profile {
  const obj = record(value, path, [
    'version',
    'credits',
    'unlocked',
    'stageUnlocked',
    'clears',
    'difficultyUnlocked',
    'upgrades',
    'runs',
    'bestWave',
    'totalKills',
    'settledRuns',
    'seenSynergies',
    'tutorialDone',
  ]);
  if (obj.version !== 1) fail(`${path}.version`, 'unsupported profile version');
  const upgrades = record(obj.upgrades, `${path}.upgrades`, ['power', 'vitality', 'fortune']);
  return {
    version: 1,
    credits: integer(obj.credits, `${path}.credits`, 0, 1e12),
    unlocked: array(obj.unlocked, `${path}.unlocked`, TOWERS.length, (item, p) =>
      enumValue(item, p, TOWERS),
    ),
    stageUnlocked: integer(obj.stageUnlocked, `${path}.stageUnlocked`, 1, STAGES.length),
    clears: array(obj.clears, `${path}.clears`, STAGES.length, (item, p) =>
      integer(item, p, 0, STAGES.length - 1),
    ),
    difficultyUnlocked: integer(obj.difficultyUnlocked, `${path}.difficultyUnlocked`, 0, 5),
    upgrades: {
      power: integer(upgrades.power, `${path}.upgrades.power`, 0, 1000),
      vitality: integer(upgrades.vitality, `${path}.upgrades.vitality`, 0, 1000),
      fortune: integer(upgrades.fortune, `${path}.upgrades.fortune`, 0, 1000),
    },
    runs: integer(obj.runs, `${path}.runs`, 0, 1e12),
    bestWave: integer(obj.bestWave, `${path}.bestWave`, 0, 100_000),
    totalKills: integer(obj.totalKills, `${path}.totalKills`, 0, 1e12),
    settledRuns: array(obj.settledRuns, `${path}.settledRuns`, MAX_SETTLED_RUNS, (item, p) =>
      identifier(item, p),
    ),
    seenSynergies: array(obj.seenSynergies, `${path}.seenSynergies`, 10_000, (item, p) =>
      identifier(item, p, 100),
    ),
    tutorialDone: boolean(obj.tutorialDone, `${path}.tutorialDone`),
  };
}

function parseRun(value: unknown, path: string): RunState {
  const fields = [
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
    'attacks',
    'enemies',
    'projectiles',
    'visuals',
    'nextId',
    'targeting',
    'skillCd',
    'secondaryCd',
    'secondary',
    'buff',
    'stasis',
    'rerolls',
    'pendingShop',
    'endless',
    'cleared',
    'settled',
    'damageByElement',
    'synergies',
    'notices',
    'perks',
    'choices',
    'tutorialStep',
  ];
  const obj = record(value, path, fields);
  if (obj.version !== 1) fail(`${path}.version`, 'unsupported run version');
  const perks = record(obj.perks, `${path}.perks`, ['damage', 'rate', 'armor', 'regen', 'fortune']);
  return {
    version: 1,
    id: identifier(obj.id, `${path}.id`),
    tower: enumValue(obj.tower, `${path}.tower`, TOWERS),
    stage: integer(obj.stage, `${path}.stage`, 0, STAGES.length - 1),
    difficulty: integer(obj.difficulty, `${path}.difficulty`, 0, 5),
    seed: integer(obj.seed, `${path}.seed`, 0, 0xffff_ffff),
    rng: integer(obj.rng, `${path}.rng`, 1, 0xffff_ffff),
    time: finite(obj.time, `${path}.time`, 0, 1e12),
    wave: integer(obj.wave, `${path}.wave`, 0, 100_000),
    waveTime: finite(obj.waveTime, `${path}.waveTime`, -1e7, 1e7),
    spawned: integer(obj.spawned, `${path}.spawned`, 0, 1e7),
    spawnTotal: integer(obj.spawnTotal, `${path}.spawnTotal`, 0, 1e7),
    spawnTimer: finite(obj.spawnTimer, `${path}.spawnTimer`, -1e7, 1e7),
    phase: enumValue(obj.phase, `${path}.phase`, PHASES),
    hp: finite(obj.hp, `${path}.hp`, -1e8, 1e9),
    maxHp: finite(obj.maxHp, `${path}.maxHp`, 0, 1e9),
    shield: finite(obj.shield, `${path}.shield`, -1e8, 1e9),
    scrap: finite(obj.scrap, `${path}.scrap`, -1e8, 1e9),
    kills: integer(obj.kills, `${path}.kills`, 0, 1e9),
    earned: integer(obj.earned, `${path}.earned`, 0, 1e9),
    attacks: array(obj.attacks, `${path}.attacks`, 200, parseAttack),
    enemies: array(obj.enemies, `${path}.enemies`, 20_000, parseEnemy),
    projectiles: array(obj.projectiles, `${path}.projectiles`, 50_000, parseProjectile),
    visuals: [],
    nextId: integer(obj.nextId, `${path}.nextId`, 0, 2_147_483_647),
    targeting: enumValue(obj.targeting, `${path}.targeting`, TARGETINGS),
    skillCd: finite(obj.skillCd, `${path}.skillCd`, -1e7, 1e7),
    secondaryCd: finite(obj.secondaryCd, `${path}.secondaryCd`, -1e7, 1e7),
    secondary: enumValue(obj.secondary, `${path}.secondary`, SECONDARIES),
    buff: finite(obj.buff, `${path}.buff`, -1e7, 1e7),
    stasis: finite(obj.stasis, `${path}.stasis`, -1e7, 1e7),
    rerolls: integer(obj.rerolls, `${path}.rerolls`, 0, 1e6),
    pendingShop: boolean(obj.pendingShop, `${path}.pendingShop`),
    endless: boolean(obj.endless, `${path}.endless`),
    cleared: boolean(obj.cleared, `${path}.cleared`),
    settled: boolean(obj.settled, `${path}.settled`),
    damageByElement: numericRecord(obj.damageByElement, `${path}.damageByElement`),
    synergies: array(obj.synergies, `${path}.synergies`, 1000, (item, p) =>
      identifier(item, p, 100),
    ),
    notices: array(obj.notices, `${path}.notices`, 1000, (item, p) => text(item, p, 500)),
    perks: {
      damage: finite(perks.damage, `${path}.perks.damage`, -1e6, 1e6),
      rate: finite(perks.rate, `${path}.perks.rate`, -1e6, 1e6),
      armor: finite(perks.armor, `${path}.perks.armor`, -1e6, 1e6),
      regen: finite(perks.regen, `${path}.perks.regen`, -1e6, 1e6),
      fortune: finite(perks.fortune, `${path}.perks.fortune`, -1e6, 1e6),
    },
    choices: array(obj.choices, `${path}.choices`, 1000, parseUpgrade),
    tutorialStep: integer(obj.tutorialStep, `${path}.tutorialStep`, 0, 1000),
  };
}

function parseSettings(value: unknown, path: string): Settings {
  const obj = record(value, path, ['sound', 'effects', 'reducedMotion', 'speed']);
  return {
    sound: boolean(obj.sound, `${path}.sound`),
    effects: enumValue(obj.effects, `${path}.effects`, ['high', 'low'] as const),
    reducedMotion: boolean(obj.reducedMotion, `${path}.reducedMotion`),
    speed: enumValue(obj.speed, `${path}.speed`, [1, 2, 3] as const),
  };
}

function parseSaveObject(value: unknown): SaveData {
  const obj = record(value, 'save', ['version', 'profile', 'run', 'settings']);
  if (obj.version !== 1) fail('save.version', 'unsupported save version');
  return {
    version: 1,
    profile: parseProfile(obj.profile, 'save.profile'),
    run: obj.run === null ? null : parseRun(obj.run, 'save.run'),
    settings: parseSettings(obj.settings, 'save.settings'),
  };
}

function normalizeSave(data: SaveData): SaveData {
  const text = JSON.stringify(data);
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES)
    throw new Error('Save exceeds the 5 MB limit');
  return parseSaveObject(JSON.parse(text));
}

export function exportSave(data: SaveData): string {
  return JSON.stringify(normalizeSave(data));
}

export function parseSave(textValue: string): SaveData {
  if (typeof textValue !== 'string') throw new Error('Save import must be text');
  if (new TextEncoder().encode(textValue).byteLength > MAX_SAVE_BYTES)
    throw new Error('Save exceeds the 5 MB limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    throw new Error('Save import is not valid JSON');
  }
  return parseSaveObject(parsed);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open save database'));
    request.onblocked = () => reject(new Error('Opening the save database was blocked'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Save transaction was aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Save transaction failed'));
  });
}

async function getRoot(db: IDBDatabase): Promise<SaveData | null> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(tx);
  try {
    const raw = await idbRequest(tx.objectStore(STORE_NAME).get(ROOT_KEY));
    await done;
    return raw === undefined ? null : parseSaveObject(raw);
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

async function writeRoot(data: SaveData): Promise<void> {
  const normalized = normalizeSave(data);
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE_NAME).put(normalized, ROOT_KEY);
    await done;
  } finally {
    db.close();
  }
}

export async function loadSave(): Promise<SaveData> {
  const db = await openDatabase();
  try {
    return (await getRoot(db)) ?? defaultSave();
  } finally {
    db.close();
  }
}

export async function saveGame(data: SaveData): Promise<void> {
  const incoming = normalizeSave(data);
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    let current: SaveData | null;
    try {
      const raw = await idbRequest(store.get(ROOT_KEY));
      current = raw === undefined ? null : parseSaveObject(raw);
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }

    // A queued autosave can arrive after settlement with an older copy of the same run.
    // Leave the settled root intact so it cannot erase rewards or reopen settlement.
    if (incoming.run && current?.profile.settledRuns.includes(incoming.run.id)) {
      await done;
      return;
    }

    const persistedLedger = current?.profile.settledRuns ?? [];
    const next = {
      ...incoming,
      profile: {
        ...incoming.profile,
        settledRuns: [...new Set([...incoming.profile.settledRuns, ...persistedLedger])].slice(
          -MAX_SETTLED_RUNS,
        ),
      },
    };
    store.put(normalizeSave(next), ROOT_KEY);
    await done;
  } finally {
    db.close();
  }
}

/** Replace the complete local save, for an explicit import or restore operation. */
export async function replaceSave(data: SaveData): Promise<void> {
  await writeRoot(data);
}

function applyRunSettlement(
  profile: Profile,
  run: RunState,
  dedupLedger: readonly string[],
): Profile {
  const alreadySettled = dedupLedger.includes(run.id);
  const nextProfile: Profile = {
    ...profile,
    settledRuns: [...new Set([...profile.settledRuns, ...dedupLedger, run.id])].slice(
      -MAX_SETTLED_RUNS,
    ),
    seenSynergies: [...new Set([...profile.seenSynergies, ...run.synergies])],
  };
  if (alreadySettled) return nextProfile;

  nextProfile.credits += run.earned;
  nextProfile.runs += 1;
  nextProfile.bestWave = Math.max(nextProfile.bestWave, run.wave);
  nextProfile.totalKills += run.kills;
  if (run.cleared) {
    nextProfile.clears = [...new Set([...nextProfile.clears, run.stage])].sort((a, b) => a - b);
    nextProfile.stageUnlocked = Math.max(
        nextProfile.stageUnlocked,
        Math.min(STAGES.length, run.stage + 2),
      );
    nextProfile.difficultyUnlocked = Math.max(
      nextProfile.difficultyUnlocked,
      Math.min(5, run.difficulty + 1),
    );
  }
  return nextProfile;
}

/** Settle rewards in the returned save when persistent storage is unavailable. */
export function settleInMemory(data: SaveData): SaveData {
  const incoming = normalizeSave(data);
  if (!incoming.run) throw new Error('Cannot settle a save without an active run');
  return {
    ...incoming,
    profile: applyRunSettlement(incoming.profile, incoming.run, incoming.profile.settledRuns),
    run: { ...incoming.run, settled: true },
  };
}

export async function settleRun(data: SaveData): Promise<SaveData> {
  const incoming = normalizeSave(data);
  if (!incoming.run) throw new Error('Cannot settle a save without an active run');
  const run = { ...incoming.run, settled: true };
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    let current: SaveData | null;
    try {
      const raw = await idbRequest(store.get(ROOT_KEY));
      current = raw === undefined ? null : parseSaveObject(raw);
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
    const alreadySettled = current?.profile.settledRuns.includes(run.id) ?? false;

    // A duplicate transaction must not replace a newer profile, settings, or run with stale input.
    if (alreadySettled && current) {
      await done;
      return current;
    }

    const profile = applyRunSettlement(incoming.profile, run, current?.profile.settledRuns ?? []);
    const result = { ...incoming, profile, run };
    const normalized = normalizeSave(result);
    store.put(normalized, ROOT_KEY);
    await done;
    return normalized;
  } finally {
    db.close();
  }
}
