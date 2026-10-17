import type { Profile, RunV2, WeaponStats } from '../v2/types';
import { effectPower, getWeaponStats, getDefenseStats, useSkill } from './engine';
import { CARDS, SYNERGIES } from './catalog';

export const RUNE_IDS = [
  'power',
  'vitality',
  'fortune',
  'experience',
  'choices',
  'autoSignature',
  'autoSecondary',
] as const;
export type RuneId = (typeof RUNE_IDS)[number];
export interface RuneLoadout {
  owned: Record<RuneId, number>;
  selected: Record<RuneId, number>;
}
export const RUNE_CAPS: Record<RuneId, number> = {
  power: 5,
  vitality: 5,
  fortune: 5,
  experience: 10,
  choices: 2,
  autoSignature: 1,
  autoSecondary: 1,
};
// Purchase caps do not revoke historical purchases from imported profiles.
export const runeOwnershipLimit = (id: RuneId): number =>
  ['power', 'vitality', 'fortune'].includes(id) ? 1000 : RUNE_CAPS[id];
const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const integer = (value: unknown, min: number, max: number, fallback = min): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;

/** Ownership is permanent; selected levels may be lowered freely. */
export function defaultRuneLoadout(upgrades?: Profile['upgrades']): RuneLoadout {
  const owned = Object.fromEntries(
    RUNE_IDS.map((id) => [id, integer(object(upgrades)[id], 0, runeOwnershipLimit(id))]),
  ) as Record<RuneId, number>;
  return { owned, selected: { ...owned } };
}
export function normalizeRuneLoadout(value: unknown, upgrades?: Profile['upgrades']): RuneLoadout {
  const input = object(value),
    fallback = defaultRuneLoadout(upgrades);
  const ownedInput = object(input.owned),
    selectedInput = object(input.selected);
  const owned = { ...fallback.owned },
    selected = { ...fallback.selected };
  for (const id of RUNE_IDS) {
    // Old profile purchases remain authoritative if a stale selection is imported.
    owned[id] = Math.max(fallback.owned[id], integer(ownedInput[id], 0, runeOwnershipLimit(id)));
    selected[id] = integer(selectedInput[id], 0, owned[id], owned[id]);
  }
  return { owned, selected };
}
export function snapshotRunes(loadout: RuneLoadout): Record<RuneId, number> {
  return { ...normalizeRuneLoadout(loadout).selected };
}
/** nextLevel is one-based. A capped rune has no further purchasable level. */
export function runePrice(id: RuneId, nextLevel: number): number {
  if (!Number.isInteger(nextLevel) || nextLevel < 1 || nextLevel > RUNE_CAPS[id]) return Infinity;
  return id === 'choices' ? 250 * nextLevel : id.startsWith('auto') ? 150 : 50 * nextLevel;
}

export type SkillSlot = 'signature' | 'secondary';
export interface AutocastCondition {
  kind: 'health' | 'shield' | 'nearby' | 'boss';
  /** Health/shield: at or below percent. Nearby: at least count. Boss: 1 present, 0 absent. */
  value: number;
  radius?: number;
}
export interface AutocastConfig {
  enabled: boolean;
  preset: 'always' | 'boss' | 'emergency' | 'advanced';
  match: 'all' | 'any';
  conditions: AutocastCondition[];
}
export type AutocastRules = Record<SkillSlot, AutocastConfig>;
export type AutocastResult = Record<SkillSlot, boolean>;
export function defaultAutocastConfig(): AutocastRules {
  const rule = (): AutocastConfig => ({
    enabled: false,
    preset: 'always',
    match: 'all',
    conditions: [],
  });
  return { signature: rule(), secondary: rule() };
}
export function normalizeAutocastConfig(value: unknown): AutocastRules {
  const input = object(value),
    rules = defaultAutocastConfig();
  for (const slot of ['signature', 'secondary'] as const) {
    const raw = object(input[slot]);
    rules[slot] = {
      enabled: raw.enabled === true,
      preset: ['always', 'boss', 'emergency', 'advanced'].includes(String(raw.preset))
        ? (raw.preset as AutocastConfig['preset'])
        : 'always',
      match: raw.match === 'any' ? 'any' : 'all',
      conditions: Array.isArray(raw.conditions)
        ? raw.conditions.slice(0, 4).flatMap((value) => {
            const c = object(value);
            if (!['health', 'shield', 'nearby', 'boss'].includes(String(c.kind))) return [];
            const kind = c.kind as AutocastCondition['kind'];
            return [
              {
                kind,
                value: integer(
                  c.value,
                  kind === 'nearby' ? 1 : 0,
                  kind === 'nearby' ? 96 : kind === 'boss' ? 1 : 100,
                ),
                ...(kind === 'nearby' ? { radius: integer(c.radius, 50, 500, 200) } : {}),
              },
            ];
          })
        : [],
    };
  }
  return rules;
}
const living = (s: RunV2) => s.enemies.filter((e) => e.hp > 0);
const shieldCapacity = (s: RunV2) => s.maxHp * 0.45 + effectPower(s, 'shield');
function useful(s: RunV2, slot: SkillSlot): boolean {
  const enemies = living(s),
    spell = slot === 'signature' ? s.tower : s.secondary;
  if (spell === 'repair') return s.hp < s.maxHp;
  if (spell === 'bastion') return enemies.length > 0 && s.shield < shieldCapacity(s);
  if (spell === 'verdant') return s.hp < s.maxHp || enemies.length > 0;
  const selectedEffect = CARDS.find((c) => c.id === spell)?.effect;
  if (selectedEffect === 'healing-field') return s.hp < s.maxHp;
  if (selectedEffect === 'shield-field') return enemies.length > 0 && s.shield < shieldCapacity(s);
  return enemies.length > 0;
}
function matches(s: RunV2, rule: AutocastConfig): boolean {
  const enemies = living(s),
    boss = enemies.some((e) => e.kind === 'boss');
  if (rule.preset === 'always') return true;
  if (rule.preset === 'boss') return boss;
  if (rule.preset === 'emergency') return s.hp <= s.maxHp * 0.35;
  if (!rule.conditions.length) return false;
  const check = (c: AutocastCondition) =>
    c.kind === 'health'
      ? s.hp <= (s.maxHp * c.value) / 100
      : c.kind === 'shield'
        ? s.shield <= (shieldCapacity(s) * c.value) / 100
        : c.kind === 'boss'
          ? boss === (c.value === 1)
          : enemies.filter((e) => Math.hypot(e.x - 500, e.y - 400) <= (c.radius ?? 200)).length >=
            c.value;
  return rule.match === 'all' ? rule.conditions.every(check) : rule.conditions.some(check);
}
/** Pure evaluation. The caller only invokes tickAutocast inside unpaused simulation ticks. */
export function evaluateAutocast(s: RunV2, config: AutocastRules): AutocastResult {
  const result: AutocastResult = { signature: false, secondary: false };
  if (s.phase !== 'combat') return result;
  for (const slot of ['signature', 'secondary'] as const) {
    result[slot] =
      config[slot].enabled &&
      (slot === 'signature' ? s.skillCd : s.secondaryCd) <= 0 &&
      useful(s, slot) &&
      matches(s, config[slot]);
  }
  return result;
}
export function tickAutocast(s: RunV2, config: AutocastRules): AutocastResult {
  const casts: AutocastResult = { signature: false, secondary: false };
  // Re-evaluate after the first skill: it may heal, fill shields, or eliminate targets.
  for (const slot of ['signature', 'secondary'] as const)
    if (evaluateAutocast(s, config)[slot]) casts[slot] = useSkill(s, slot);
  return casts;
}

interface DamageSample {
  time: number;
  damage: number;
}
const damageWindows = new WeakMap<RunV2, DamageSample[]>();
const totalDamage = (s: RunV2) =>
  Object.values(s.damageByWeapon).reduce((sum, damage) => sum + damage, 0);
/** Call once at start/resume, then after each combat tick. No wall-clock time is used. */
export function recordDamageSample(s: RunV2): void {
  let samples = damageWindows.get(s);
  const sample = { time: s.time, damage: totalDamage(s) };
  if (
    !samples ||
    (samples.at(-1)?.time ?? 0) > s.time ||
    (samples.at(-1)?.damage ?? 0) > sample.damage
  ) {
    samples = [];
    damageWindows.set(s, samples);
  }
  if (samples.at(-1)?.time === s.time) samples[samples.length - 1] = sample;
  else samples.push(sample);
  while (samples.length > 2 && samples[1].time <= s.time - 10) samples.shift();
  if (samples.length > 1202) samples.splice(0, samples.length - 1202);
}
export function getRecentDps(s: RunV2): number {
  const samples = damageWindows.get(s);
  if (!samples || samples.length < 2) return 0;
  const end = samples[samples.length - 1],
    start = samples[0];
  const cutoff = Math.max(start.time, end.time - 10);
  let baseline = start.damage;
  if (start.time < cutoff && samples[1].time > start.time)
    baseline +=
      ((samples[1].damage - start.damage) * (cutoff - start.time)) / (samples[1].time - start.time);
  return end.time > cutoff ? Math.max(0, end.damage - baseline) / (end.time - cutoff) : 0;
}
export interface TowerStatsSnapshot {
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  healthRegen: number;
  shieldRegen: number;
  mitigation: Record<
    'physical' | 'fire' | 'frost' | 'lightning' | 'poison' | 'solar' | 'void',
    number
  >;
  reflectMultiplier: number;
  retaliationDamage: number;
  signatureCooldown: number;
  secondaryCooldown: number;
  signatureCooldownDuration: number;
  secondaryCooldownDuration: number;
  xpMultiplier: number;
  masteryMultiplier: number;
  recentDps: number;
  runAverageDps: number;
  totalDamage: number;
  equipment: ({ id: string; kind: RunV2['weapons'][number]['kind'] } & WeaponStats)[];
}
export function getTowerStats(s: RunV2): TowerStatsSnapshot {
  const p = (effect: string) => effectPower(s, effect);
  const has = (effect: string) =>
    SYNERGIES.some((y) => y.effect === effect && s.synergies.includes(y.id));
  const defense = getDefenseStats(s);
  const damage = totalDamage(s);
  return {
    health: s.hp,
    maxHealth: s.maxHp,
    shield: s.shield,
    maxShield: defense.maxShield,
    healthRegen: defense.healthRegen,
    shieldRegen: defense.shieldRegen,
    mitigation: defense.mitigation,
    reflectMultiplier: defense.reflectMultiplier,
    retaliationDamage: defense.retaliationDamage,
    signatureCooldown: s.skillCd,
    secondaryCooldown: s.secondaryCd,
    signatureCooldownDuration: 30 / (1 + p('skill-cooldown')),
    secondaryCooldownDuration: 38 / (1 + p('skill-cooldown')),
    xpMultiplier:
      ((s as RunV2 & { mode?: string }).mode === 'quick' ? 0.75 : 1) *
      (1 +
        Math.min(
          0.5,
          (s.counters.profileExperience || 0) +
            p('xp-gain') +
            (s.counters.learningChain || 0) * p('xp-chain') +
            (s.hp <= s.maxHp * 0.35 ? p('xp-low-health') : 0),
        )),
    masteryMultiplier:
      ((s as RunV2 & { mode?: string }).mode === 'quick' ? 1.5 : 1) *
      (1 + Math.min(0.5, s.counters.profileMastery || 0)),
    recentDps: getRecentDps(s),
    runAverageDps: s.time > 0 ? damage / s.time : 0,
    totalDamage: damage,
    equipment: s.weapons.map((w) => ({ id: w.id, kind: w.kind, ...getWeaponStats(s, w) })),
  };
}
