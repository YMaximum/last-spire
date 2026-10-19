import {
  defaultSettings as settingsV2,
  emptySave as emptyV2,
  parseGame as parseV2,
  SaveError,
} from '../legacy/runeforged/storage';
import type { SaveV2, SettingsV2 } from '../model/arsenal';
import type { SaveData } from '../model/shared';
import { CARDS as LEGACY_CARDS, WEAPONS as LEGACY_WEAPONS } from '../content/base-catalog';
import {
  CARDS,
  WEAPONS,
  TOWERS,
  FUSIONS,
  isFusedKind,
  EXPANSION_CARD_IDS,
  EXPANSION_FUSION_IDS,
} from '../content/catalog';
import { rewardForRun } from '../game/engine';
import type { RunV3 } from '../game/types';
import {
  freshStageProgress,
  migrateStageProgress,
  recordStageClear,
  type StageProgress,
  STAGE_COUNT,
} from '../game/stage-progress';
import {
  RUNE_CAPS,
  defaultRuneLoadout,
  defaultAutocastConfig,
  normalizeAutocastConfig,
  type RuneId,
  type RuneLoadout,
  type AutocastRules,
} from '../game/controls';

import { ENEMY_BY_ID, type BestiaryRecords } from '../content/enemies';
import { mergeDiscoveries } from '../game/bestiary';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import type { EvolutionPathId } from '../model/evolution';
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
export interface GameSave extends Omit<SaveV2, 'version'> {
  version: 7;
  progression: {
    runes: RuneLoadout;
    autocast: AutocastRules;
    active: ActiveRunConfig | null;
    records: ModeRecord[];
    stages: StageProgress[];
    bestiary: BestiaryRecords;
  };
}
/** Compatibility type name for callers of the existing save API. */
export type SaveV3 = GameSave;
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
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
    invalid('metadata contains unsupported values');
  if (Array.isArray(value)) {
    if (value.length > 50_000) invalid('array has too many entries');
    for (let i = 0; i < value.length; i++) {
      if (!(i in value) || value[i] === undefined) invalid('arrays cannot contain holes');
      finiteTree(value[i], depth + 1);
    }
    return;
  }
  if (value && typeof value === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      invalid('save contains non-JSON objects');
    const entries = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(entries).length > 20_000) invalid('metadata has too many entries');
    for (const [key, descriptor] of Object.entries(entries)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        invalid('metadata contains an unsafe key');
      if (!('value' in descriptor)) invalid('save contains accessor properties');
      // Engine-generated optional object fields may be undefined; JSON omits them.
      if (descriptor.value !== undefined) finiteTree(descriptor.value, depth + 1);
    }
  }
}
function runeSnapshot(value: unknown, label: string): Record<RuneId, number> {
  const ids = Object.keys(RUNE_CAPS) as RuneId[];
  const result = shape(value, label, ids);
  for (const id of ids)
    numeric(
      result[id],
      `${label}.${id}`,
      0,
      ['power', 'vitality', 'fortune'].includes(id) ? 1000 : RUNE_CAPS[id],
    );
  return result as Record<RuneId, number>;
}
function loadout(value: unknown): RuneLoadout {
  const result = shape(value, 'runes', ['owned', 'selected']);
  const owned = runeSnapshot(result.owned, 'owned runes');
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
    version: 7,
    settings: defaultSettings(),
    progression: {
      runes: defaultRuneLoadout(base.profile.upgrades),
      autocast: defaultAutocastConfig(),
      active: null,
      records: [],
      stages: freshStageProgress(),
      bestiary: {},
    },
  };
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    invalid(`${label} must contain at most ${max} entries`);
  return value;
}
function parseStages(value: unknown): StageProgress[] {
  const entries = list(value, 'stage progression', STAGE_COUNT);
  if (entries.length !== STAGE_COUNT) invalid('each stage requires a progression record');
  return entries.map((value, stage) => {
    const entry = shape(value, `stage ${stage}`, [
      'unlockedDifficulty',
      'clearedDifficulties',
      'legacyClear',
    ]);
    const unlockedDifficulty = numeric(entry.unlockedDifficulty, 'stage difficulty', 0, 5);
    const clearedDifficulties = list(entry.clearedDifficulties, 'stage clears', 6).map((d) =>
      numeric(d, 'cleared difficulty', 0, 5),
    );
    if (new Set(clearedDifficulties).size !== clearedDifficulties.length)
      invalid('duplicate cleared difficulty');
    if (clearedDifficulties.some((d) => Math.min(5, d + 1) > unlockedDifficulty))
      invalid('clear exceeds stage access');
    if (typeof entry.legacyClear !== 'boolean') invalid('legacy clear must be boolean');
    return {
      unlockedDifficulty,
      clearedDifficulties: clearedDifficulties.sort((a, b) => a - b),
      legacyClear: entry.legacyClear,
    };
  });
}
function parseDiscoveries(value: unknown): BestiaryRecords {
  const result = object(value, 'bestiary records');
  if (Object.keys(result).length > Object.keys(ENEMY_BY_ID).length)
    invalid('too many bestiary entries');
  for (const [id, value] of Object.entries(result)) {
    if (!Object.hasOwn(ENEMY_BY_ID, id)) invalid('unknown bestiary entry');
    const record = shape(value, 'discovery', ['encountered', 'defeated']);
    numeric(record.encountered, 'encounter count', 0, 1e12);
    numeric(record.defeated, 'defeat count', 0, record.encountered as number);
  }
  return structuredClone(result) as BestiaryRecords;
}
function equipment(value: unknown, time: number, ingredient = false): Obj {
  const w = shape(
    value,
    ingredient ? 'fusion ingredient' : 'equipment',
    [
      'id',
      'kind',
      'cooldown',
      'shotCycle',
      'lifetimeShots',
      'mastery',
      'rarity',
      'infusions',
      'angle',
    ],
    [
      'masteryRank',
      'masteryProgress',
      'masteryRequired',
      'fusionReady',
      ...(ingredient ? [] : ['fusion']),
    ],
  );
  identifier(w.id, 'equipment ID');
  if (!WEAPONS.some((def) => def.id === w.kind)) invalid('equipment kind is unknown');
  for (const field of ['cooldown', 'angle'])
    numeric(w[field], `equipment ${field}`, -1e12, 1e12, false);
  for (const field of ['shotCycle', 'lifetimeShots'])
    numeric(w[field], `equipment ${field}`, 0, Number.MAX_SAFE_INTEGER);
  numeric(w.mastery, 'equipment investment', 0, 1e12, false);
  const rarities = ['normal', 'rare', 'epic', 'legendary', 'mythic'];
  if (!rarities.includes(w.rarity as string)) invalid('equipment rarity is invalid');
  const infusions = list(w.infusions, 'equipment infusions', 6);
  if (
    infusions.some(
      (e) => !['fire', 'frost', 'lightning', 'poison', 'solar', 'void'].includes(e as string),
    ) ||
    new Set(infusions).size !== infusions.length
  )
    invalid('equipment infusions are invalid');
  if (w.masteryRank !== undefined) numeric(w.masteryRank, 'mastery rank', 1, 6);
  if (w.masteryProgress !== undefined)
    numeric(w.masteryProgress, 'mastery progress', 0, 900, false);
  if (w.masteryRequired !== undefined)
    numeric(w.masteryRequired, 'mastery requirement', 0, 900, false);
  if (w.fusionReady !== undefined && typeof w.fusionReady !== 'boolean')
    invalid('fusion readiness must be boolean');
  if (w.fusionReady === true && w.masteryRank !== 6)
    invalid('fusion readiness requires mastery six');
  if (ingredient) {
    if (isFusedKind(w.kind as string)) invalid('fused cores cannot be fusion ingredients');
    if (w.masteryRank !== 6 || w.masteryProgress !== 900 || w.masteryRequired !== 900)
      invalid('fusion ingredient must have complete mastery');
    return w;
  }
  if (isFusedKind(w.kind as string)) {
    const f = shape(
      w.fusion,
      'fusion provenance',
      ['recipeId', 'createdAt', 'ingredients'],
      ['overflowPower'],
    );
    const recipe = FUSIONS.find((recipe) => recipe.id === f.recipeId);
    if (!recipe || recipe.kind !== w.kind) invalid('fusion recipe does not match its core');
    numeric(f.createdAt, 'fusion creation time', 0, time, false);
    if (f.overflowPower !== undefined)
      numeric(f.overflowPower, 'fusion overflow conversion', 0, 0.15, false);
    const inputs = list(f.ingredients, 'fusion ingredients', 2);
    if (inputs.length !== 2) invalid('fusion requires exactly two ingredients');
    const [a, b] = inputs.map((input) => equipment(input, time, true));
    if (a.id === b.id || a.id === w.id || b.id === w.id)
      invalid('fusion ingredients must have distinct original IDs');
    if (
      ![a.kind, b.kind].every((kind) => recipe.ingredients.includes(kind as never)) ||
      a.kind === b.kind
    )
      invalid('fusion ingredients do not match the recipe');
    if (
      w.masteryRank !== 6 ||
      w.masteryProgress !== 900 ||
      w.masteryRequired !== 900 ||
      w.fusionReady !== false
    )
      invalid('fused core mastery metadata is invalid');
    if (
      [...(a.infusions as unknown[]), ...(b.infusions as unknown[])].some(
        (e) => !infusions.includes(e),
      )
    )
      invalid('fusion dropped an inherited infusion');
    if (
      rarities.indexOf(w.rarity as string) <
      Math.max(rarities.indexOf(a.rarity as string), rarities.indexOf(b.rarity as string))
    )
      invalid('fusion rarity cannot downgrade its ingredients');
  } else if (w.fusion !== undefined) invalid('ordinary core cannot contain fusion provenance');
  return w;
}
function validateEvolution(run: Obj): void {
  if (run.evolution === undefined) return;
  if (run.arsenalVersion !== 2 || run.rulesVersion !== 3)
    invalid('evolution requires expanded arsenal and modern rules');
  const state = shape(
    run.evolution,
    'evolution',
    ['version', 'coreId', 'tier', 'pending'],
    ['path'],
  );
  if (state.version !== 1) invalid('evolution version unsupported');
  const coreId = identifier(state.coreId, 'evolution core ID');
  const tier = numeric(state.tier, 'evolution tier', 0, 3);
  const pending = numeric(state.pending, 'evolution pending tier', 0, 3);
  if (pending !== 0 && pending !== tier + 1) invalid('evolution pending tier is out of order');
  if (tier === 0) {
    if ('path' in state) invalid('evolution path requires an unlocked tier');
  } else {
    const pathId = identifier(state.path, 'evolution path');
    const path = EVOLUTION_BY_ID[pathId as EvolutionPathId];
    if (!path || path.tower !== run.tower) invalid('evolution path does not belong to tower');
  }
  const milestones = run.mode === 'quick' ? [12, 25, 37] : [25, 50, 75];
  const clearedWave = numeric(run.wave, 'evolution wave', 1, 1_000_000) - 1;
  if (
    (tier > 0 && clearedWave < milestones[tier - 1]) ||
    (pending > 0 && clearedWave < milestones[pending - 1])
  )
    invalid('evolution tier requires its cleared wave milestone');
  // A replaced core may be absent. Fusion descendants retain the original ID.
  const owners = (run.weapons as Obj[]).filter(
    (weapon) =>
      weapon.id === coreId ||
      (weapon.fusion as { ingredients: Obj[] } | undefined)?.ingredients.some(
        (part) => part.id === coreId,
      ),
  );
  if (owners.length > 1) invalid('evolution core has multiple equipped descendants');
  if (owners.length) {
    const owner = owners[0],
      fusion = owner.fusion as { ingredients: Obj[] } | undefined;
    const origin = fusion ? fusion.ingredients.find((part) => part.id === coreId) : owner;
    const kind =
      run.tower === 'monolith' ? 'core-mirror' : TOWERS.find((t) => t.id === run.tower)?.pattern;
    if (!origin || origin.kind !== kind)
      invalid('evolution lineage must originate from the starting core');
  }
}
/** Project modern additions only for the established validator, then restore the validated original. */
function modernProjection(value: unknown): { original: RunV3; projection: Obj } {
  const original = object(value, 'run');
  for (const field of [
    'rulesVersion',
    'mode',
    'level',
    'xp',
    'xpRequired',
    'offerRng',
    'runeSnapshot',
  ])
    if (!(field in original)) invalid(`run.${field} is missing`);
  if (original.rulesVersion !== 3) invalid('modern rules version is unsupported');
  if (!['quick', 'normal', 'endless'].includes(original.mode as string))
    invalid('run mode is invalid');
  numeric(original.level, 'level', 1, 100_000);
  numeric(original.xp, 'XP', 0, 1e12, false);
  numeric(original.xpRequired, 'XP requirement', 1, 1e12);
  numeric(original.offerRng, 'offer RNG', 1, 0xffff_ffff);
  runeSnapshot(original.runeSnapshot, 'run rune snapshot');
  if (!TOWERS.some((t) => t.id === original.tower)) invalid('modern tower is unknown');
  if (original.shopVersion !== undefined && original.shopVersion !== 2)
    invalid('shop rules are unsupported');
  if (original.encounterVersion !== undefined && original.encounterVersion !== 2)
    invalid('encounter rules are unsupported');
  if (original.arsenalVersion !== undefined && original.arsenalVersion !== 2)
    invalid('arsenal rules are unsupported');
  const expandedArsenal = original.arsenalVersion === 2;
  const expansionFusions = new Set<string>(EXPANSION_FUSION_IDS);
  const expansionKinds = new Set(
    FUSIONS.filter((recipe) => expansionFusions.has(recipe.id)).map((recipe) => recipe.kind),
  );
  if (original.encounterVersion === 2) parseDiscoveries(original.discoveries);
  else if (original.discoveries !== undefined)
    invalid('legacy encounter rules cannot track new discoveries');
  const projection = structuredClone(original);
  delete projection.encounterVersion;
  delete projection.discoveries;
  delete projection.shopVersion;
  delete projection.arsenalVersion;
  delete projection.evolution;
  for (const field of [
    'rulesVersion',
    'mode',
    'level',
    'xp',
    'xpRequired',
    'offerRng',
    'runeSnapshot',
  ])
    delete projection[field];
  if (projection.tower === 'monolith') projection.tower = 'bastion';
  const kinds = new Set(WEAPONS.map((w) => w.id));
  const oldKinds = new Set(LEGACY_WEAPONS.map((w) => w.id));
  const oldCards = new Set(LEGACY_CARDS.map((c) => c.id));
  const ids = new Set<string>();
  const consumed = new Set<string>();
  for (const item of list(projection.weapons, 'arsenal', 6)) {
    const w = equipment(item, original.time as number);
    if (!expandedArsenal && expansionKinds.has(w.kind as never))
      invalid('expanded fusion requires arsenal rules');
    const id = identifier(w.id, 'equipment ID');
    if (ids.has(id)) invalid('duplicate equipment ID');
    ids.add(id);
    if (w.fusion)
      for (const input of (w.fusion as Obj).ingredients as Obj[]) {
        const inputId = input.id as string;
        if (consumed.has(inputId)) invalid('fusion provenance reuses an ingredient');
        consumed.add(inputId);
      }
    if (!kinds.has(w.kind as never)) invalid('equipment kind is unknown');
    if (w.masteryRank !== undefined) numeric(w.masteryRank, 'mastery rank', 1, 6);
    if (w.masteryProgress !== undefined)
      numeric(w.masteryProgress, 'mastery progress', 0, 900, false);
    if (w.masteryRequired !== undefined)
      numeric(w.masteryRequired, 'mastery requirement', 0, 900, false);
    if (w.fusionReady !== undefined && typeof w.fusionReady !== 'boolean')
      invalid('fusion readiness must be boolean');
    if (w.fusionReady === true && w.masteryRank !== 6)
      invalid('fusion readiness requires mastery six');
    for (const field of [
      'masteryRank',
      'masteryProgress',
      'masteryRequired',
      'fusionReady',
      'fusion',
    ])
      delete w[field];
    if (!oldKinds.has(w.kind as never)) w.kind = 'bolt';
  }
  if ([...consumed].some((id) => ids.has(id)))
    invalid('consumed fusion ingredient is still equipped');
  if (!ids.size) invalid('run requires an arsenal core');
  validateEvolution(original);
  const card = (item: unknown, offer: boolean): void => {
    const c = object(item, offer ? 'offer' : 'card');
    const def = CARDS.find((def) => def.id === c.cardId);
    if (!def) invalid('card family is unknown');
    if (!expandedArsenal && EXPANSION_CARD_IDS.includes(def.id))
      invalid('expanded card requires arsenal rules');
    if (!offer) numeric(c.stacks, 'card stacks', 1, def.maxStacks);
    if (c.targetId !== undefined && !ids.has(identifier(c.targetId, 'card target')))
      invalid('card targets an unknown core');
    const targeted = def.group === 'infusion' || def.id === 'utility-apprenticeship';
    if (!offer && targeted && c.targetId === undefined)
      invalid('chosen-core investment needs a target');
    if (!targeted && c.targetId !== undefined) invalid('global card cannot target one core');
    if (!oldCards.has(def.id)) c.cardId = 'weapon-bolt';
  };
  const stacks = list(projection.cards, 'cards', 800);
  const seenCards = new Set<string>();
  for (const item of stacks) {
    const c = object(item, 'card');
    const key = `${c.cardId}:${c.targetId ?? ''}`;
    if (seenCards.has(key)) invalid('duplicate card investment');
    seenCards.add(key);
    card(c, false);
  }
  for (const item of list(projection.enemies, 'enemies', 20_000)) {
    const enemy = object(item, 'enemy');
    if (enemy.xpBudget !== undefined) numeric(enemy.xpBudget, 'enemy XP budget', 0, 25, false);
    if (enemy.archetypeId !== undefined) {
      const def = ENEMY_BY_ID[enemy.archetypeId as keyof typeof ENEMY_BY_ID];
      if (
        original.encounterVersion !== 2 ||
        !def ||
        def.role !== enemy.kind ||
        (def.stage !== undefined && def.stage !== original.stage)
      )
        invalid('enemy archetype does not belong to this encounter');
      delete enemy.archetypeId;
    } else if (original.encounterVersion === 2) invalid('new encounter requires an archetype');
    delete enemy.xpBudget;
  }
  for (const item of list(projection.projectiles, 'projectiles', 20_000)) {
    const p = object(item, 'projectile');
    if (p.fusionId !== undefined && !FUSIONS.some((f) => f.id === p.fusionId))
      invalid('projectile fusion recipe is unknown');
    if (
      !expandedArsenal &&
      (expansionFusions.has(p.fusionId as string) || expansionKinds.has(p.kind as never))
    )
      invalid('expanded projectile requires arsenal rules');
    delete p.fusionId;
    if (!kinds.has(p.kind as never)) invalid('projectile kind is unknown');
    if (!oldKinds.has(p.kind as never)) p.kind = 'bolt';
  }
  const rewards = new Set<string>();
  for (const item of list(projection.pendingRewards, 'pending rewards', 2000)) {
    const reward = object(item, 'reward');
    const id = identifier(reward.id, 'reward ID');
    if (rewards.has(id)) invalid('duplicate reward ID');
    rewards.add(id);
    if (reward.level !== undefined) numeric(reward.level, 'reward level', 2, 100_000);
    delete reward.level;
    const offers = new Set<string>();
    for (const item of list(reward.offers, 'offers', 5)) {
      const offer = object(item, 'offer');
      const id = identifier(offer.id, 'offer ID');
      if (offers.has(id)) invalid('duplicate offer ID');
      offers.add(id);
      card(offer, true);
    }
  }
  return { original: original as unknown as RunV3, projection };
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
    if (![1, 2, 3, 4, 5, 6, 7].includes(version as number))
      invalid(
        'This checkpoint requires a newer Last Spire client. Reload or update before continuing.',
      );
    if ((version as number) < 7 && root.run && 'evolution' in object(root.run, 'run'))
      invalid('evolution requires save schema seven');
    const expanded = (version as number) >= 3;
    const sourceSettings = object(root.settings, 'settings');
    const settings = { ...defaultSettings(), ...sourceSettings };
    const profile = expanded ? structuredClone(object(root.profile, 'profile')) : root.profile;
    if (expanded) {
      const ownedTowers = list((profile as Obj).unlocked, 'unlocked towers', 7);
      if (
        ownedTowers.some((t) => !TOWERS.some((def) => def.id === t)) ||
        new Set(ownedTowers).size !== ownedTowers.length
      )
        invalid('unlocked towers are invalid');
      (profile as Obj).unlocked = ownedTowers.filter((t) => t !== 'monolith');
    }
    const modern =
      expanded && root.run && object(root.run, 'run').rulesVersion !== undefined
        ? modernProjection(root.run)
        : null;
    const base = parseV2(
      expanded
        ? { version: 2, profile, run: modern?.projection ?? root.run, settings }
        : { ...root, settings: version === 1 ? sourceSettings : settings },
    );
    if (expanded) {
      base.profile.unlocked = [
        ...(object(root.profile, 'profile').unlocked as SaveV2['profile']['unlocked']),
      ];
      if (modern) base.run = structuredClone(modern.original);
    }
    if (!expanded) {
      const stages = migrateStageProgress(base.profile);
      if (base.run?.cleared) recordStageClear(base.profile, stages, base.run);
      return {
        ...base,
        version: 7,
        settings: { ...defaultSettings(), ...sourceSettings } as SettingsV2,
        progression: {
          runes: legacyRunes(base.profile.upgrades),
          autocast: defaultAutocastConfig(),
          active: null,
          records: [],
          stages,
          bestiary: {},
        },
      };
    }
    shape(root, 'save', ['version', 'profile', 'run', 'settings', 'progression']);
    const p = shape(root.progression, 'progression', [
      'runes',
      'autocast',
      'active',
      'records',
      ...((version as number) >= 4 ? ['stages'] : []),
      ...((version as number) >= 5 ? ['bestiary'] : []),
    ]);
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
      for (const [slot, rune] of [
        ['signature', 'autoSignature'],
        ['secondary', 'autoSecondary'],
      ] as const)
        if (active.autocast[slot].enabled && active.runes[rune] === 0)
          invalid(`${slot} autocast is not unlocked for this run`);
    }
    if (modern) {
      if (!active || active.rulesVersion !== 3)
        invalid('modern expedition requires an active rules snapshot');
      for (const id of Object.keys(RUNE_CAPS) as RuneId[])
        if (active.runes[id] !== modern.original.runeSnapshot[id])
          invalid('run rune snapshots disagree');
      if (active.gameplay !== undefined)
        invalid('modern progression belongs to the explicit run schema');
    } else if (active?.rulesVersion === 3) invalid('legacy expedition cannot use modern rules');
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
      if (!TOWERS.some((t) => t.id === r.tower)) invalid('record tower is unknown');
      if (!['quick', 'normal', 'endless'].includes(r.mode as string))
        invalid('record mode is invalid');
      numeric(r.stage, 'record stage', 0, 2);
      numeric(r.difficulty, 'record difficulty', 0, 10);
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
    const stages =
      (version as number) >= 4
        ? parseStages(p.stages)
        : migrateStageProgress(base.profile, records);
    if (base.run?.cleared) recordStageClear(base.profile, stages, base.run);
    const result: SaveV3 = {
      ...base,
      version: 7,
      progression: {
        runes,
        autocast: rules,
        active,
        records,
        stages,
        bestiary: (version as number) >= 5 ? parseDiscoveries(p.bestiary) : {},
      },
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
export type SaveScope = 'guest' | `account:${string}`;
export function saveKey(scope: SaveScope = 'guest'): string {
  if (scope === 'guest') return ROOT;
  if (!/^account:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(scope))
    throw new SaveError('Invalid account save context', 'invalid');
  return scope;
}
async function backupLegacy(store: IDBObjectStore, raw: unknown, scope: SaveScope): Promise<void> {
  const evolutionBackup = `backup-before-evolution:${saveKey(scope)}`;
  if (
    raw &&
    [1, 2, 3, 4, 5, 6].includes((raw as { version?: number }).version ?? 0) &&
    (await request(store.get(evolutionBackup))) === undefined
  )
    store.put(raw, evolutionBackup);
  const arsenalBackup = `backup-before-arsenal:${saveKey(scope)}`;
  if (
    raw &&
    [1, 2, 3, 4, 5].includes((raw as { version?: number }).version ?? 0) &&
    (await request(store.get(arsenalBackup))) === undefined
  )
    store.put(raw, arsenalBackup);
  const encounterBackup = `backup-before-encounters:${saveKey(scope)}`;
  if (
    raw &&
    [1, 2, 3, 4].includes((raw as { version?: number }).version ?? 0) &&
    (await request(store.get(encounterBackup))) === undefined
  )
    store.put(raw, encounterBackup);
  const migrationKey = `backup-before-stage-progression:${saveKey(scope)}`;
  if (
    raw &&
    [1, 2, 3].includes((raw as { version?: number }).version ?? 0) &&
    (await request(store.get(migrationKey))) === undefined
  )
    store.put(raw, migrationKey);
  if (scope !== 'guest') return;
  if (
    raw &&
    [1, 2].includes((raw as { version?: number }).version ?? 0) &&
    (await request(store.get(BACKUP))) === undefined
  )
    store.put(raw, BACKUP);
}
export async function readRawSave(scope: SaveScope = 'guest'): Promise<unknown> {
  const key = saveKey(scope);
  return transact('readonly', (store) => request(store.get(key)));
}
export async function readLegacyBackup(scope: SaveScope = 'guest'): Promise<unknown> {
  saveKey(scope);
  return transact('readonly', async (store) => {
    const evolution = await request(store.get(`backup-before-evolution:${saveKey(scope)}`));
    if (evolution !== undefined) return evolution;
    const arsenal = await request(store.get(`backup-before-arsenal:${saveKey(scope)}`));
    if (arsenal !== undefined) return arsenal;
    const encountered = await request(store.get(`backup-before-encounters:${saveKey(scope)}`));
    if (encountered !== undefined) return encountered;
    const migrated = await request(store.get(`backup-before-stage-progression:${saveKey(scope)}`));
    if (migrated !== undefined || scope !== 'guest') return migrated;
    return (
      (await request(store.get(BACKUP))) ??
      (await request(store.get('backup-v1'))) ??
      (await request(store.get('backup-before-v2')))
    );
  });
}
export async function loadGame(scope: SaveScope = 'guest'): Promise<SaveV3> {
  const key = saveKey(scope);
  return transact('readwrite', async (store) => {
    const raw = await request(store.get(key));
    if (raw === undefined) return emptySave();
    const result = parseGame(raw);
    await backupLegacy(store, raw, scope);
    return result;
  });
}
function settleProfile(data: SaveV3, profile = data.profile): SaveV3 {
  const run = data.run;
  if (!run) return data;
  const duplicate = profile.settledRuns.includes(run.id);
  const next = structuredClone(profile);
  next.settledRuns = [...new Set([...profile.settledRuns, run.id])].slice(-20_000);
  next.seenSynergies = [...new Set([...profile.seenSynergies, ...run.synergies])];
  if (!duplicate) {
    next.credits += run.version === 2 ? rewardForRun(run) : run.earned;
    next.runs += 1;
    next.bestWave = Math.max(next.bestWave, run.wave);
    next.totalKills += run.kills;
  }
  const progression = structuredClone(data.progression);
  if (!duplicate && run.version === 2 && 'encounterVersion' in run && run.encounterVersion === 2)
    progression.bestiary = mergeDiscoveries(progression.bestiary, (run as RunV3).discoveries || {});
  recordStageClear(next, progression.stages, run);
  if (!duplicate && run.version === 2 && 'rulesVersion' in run && run.rulesVersion === 3) {
    const modern = run as RunV3;
    if (!progression.records.some((r) => r.runId === run.id))
      progression.records.push({
        runId: run.id,
        mode: modern.mode,
        stage: run.stage,
        difficulty: run.difficulty,
        tower: run.tower,
        runes: { ...modern.runeSnapshot },
        wave: run.wave,
        cleared: run.cleared,
        seconds: run.time,
        credits: rewardForRun(run),
      });
    progression.records = progression.records.slice(-500);
  }
  return { ...data, profile: next, run: { ...run, settled: true }, progression };
}
export function settleInMemory(data: SaveV3): SaveV3 {
  return parseGame(settleProfile(parseGame(data)));
}
export async function saveGame(
  data: SaveV3,
  replace = false,
  scope: SaveScope = 'guest',
): Promise<void> {
  const key = saveKey(scope);
  const incoming = parseGame(data);
  await transact('readwrite', async (store) => {
    const raw = await request(store.get(key));
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
    await backupLegacy(store, raw, scope);
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
    store.put(parseGame(incoming), key);
    store.put(incoming.settings, 'device-settings');
  });
}
export async function replaceGame(data: SaveV3, scope: SaveScope = 'guest'): Promise<void> {
  return saveGame(data, true, scope);
}
export async function settleGame(data: SaveV3, scope: SaveScope = 'guest'): Promise<SaveV3> {
  const key = saveKey(scope);
  const incoming = parseGame(data);
  if (!incoming.run) return incoming;
  return transact('readwrite', async (store) => {
    const raw = await request(store.get(key));
    const current = raw === undefined ? null : parseGame(raw);
    await backupLegacy(store, raw, scope);
    const run = incoming.run!;
    if (current?.profile.settledRuns.includes(run.id)) return current;
    const progression = current?.progression ?? incoming.progression;
    const settled = settleProfile(
      { ...incoming, progression },
      current?.profile ?? incoming.profile,
    );
    const nextRun = current?.run && current.run.id !== run.id ? current.run : settled.run;
    const result = parseGame({
      ...settled,
      run: nextRun,
      settings: current?.settings ?? incoming.settings,
    });
    store.put(result, key);
    return result;
  });
}
/** Presentation preferences stay on this device, including across account switches. */
export async function loadDeviceSettings(): Promise<SaveV3['settings'] | null> {
  return transact('readonly', async (store) => {
    const settings = await request(store.get('device-settings'));
    return settings === undefined ? null : parseGame({ ...emptySave(), settings }).settings;
  });
}
export async function deleteAccountCache(scope: SaveScope): Promise<void> {
  if (scope === 'guest')
    throw new SaveError('Guest saves cannot be removed by account deletion.', 'invalid');
  const key = saveKey(scope);
  await transact('readwrite', async (store) => {
    await request(store.delete(key));
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
