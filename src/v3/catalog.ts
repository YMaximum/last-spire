import type { TowerDefinition } from '../types';
import type { CardDefinition, WeaponDefinition, WeaponKind } from '../v2/types';
import { TOWERS as LEGACY_TOWERS } from '../content';
import { CARDS as BASE_CARDS, WEAPONS as BASE_WEAPONS } from '../v2/catalog';
export { RARITIES, RARITY_COLORS, rarityLabel, SYNERGIES } from '../v2/catalog';

export const DEFENSIVE_KINDS = [
  'core-mirror', 'core-thorn', 'core-capacitor', 'core-cinder',
  'core-frost', 'core-mending', 'core-gravitic', 'core-echo',
] as const;
export type DefensiveKind = (typeof DEFENSIVE_KINDS)[number];
export function isDefensiveKind(kind: string): kind is DefensiveKind {
  return (DEFENSIVE_KINDS as readonly string[]).includes(kind);
}

const defensiveDefinitions: Array<[DefensiveKind, string, string, number, number, number, string[]]> = [
  ['core-mirror', 'Mirror', 'Reflects incoming strikes as faceted return shots. Defensive participation builds mastery even without a weapon.', 12, 1.1, 330, ['reflection', 'mirror']],
  ['core-thorn', 'Thorn', 'Releases barbed retaliation when the tower takes damage. A bounded retaliatory volley reaches nearby attackers.', 16, 1.4, 300, ['thorns', 'retaliation']],
  ['core-capacitor', 'Capacitor', 'Stores absorbed damage and discharges it in a controlled pulse. Shield protection counts as active participation.', 24, 2.2, 280, ['shield', 'absorption']],
  ['core-cinder', 'Cinder', 'Returns incoming pressure as burning retaliation. Its heat applies fire damage over time without recursive retaliation.', 12, 1.5, 300, ['fire', 'retaliation']],
  ['core-frost', 'Frost', 'Builds a defensive frost ward and chills nearby threats when struck. Bosses resist crowd control rather than becoming immune.', 12, 1.8, 270, ['frost', 'shield']],
  ['core-mending', 'Mending', 'Converts recovery into defensive strikes. Effective healing and protection build mastery independently of attack frequency.', 16, 2, 300, ['healing', 'recovery']],
  ['core-gravitic', 'Gravitic', 'Maintains a gravitational protection field that restrains approaching enemies and converts pressure into void retaliation.', 14, 2.1, 260, ['void', 'gravity']],
  ['core-echo', 'Echo', 'Repeats eligible defensive strikes after a short delay. Echoes have an internal cooldown and cannot recursively echo.', 12, 1.6, 330, ['echo', 'retaliation']],
];
export const DEFENSIVE_CORES: WeaponDefinition[] = defensiveDefinitions.map(([id, name, description, damage, cooldown, range, tags]) => ({
  id: id as WeaponKind, name, description, damage, cooldown, range, speed: 300,
  tags: ['defensive-core', ...tags], color: '#a6d7c5',
}));

const cardEntries: Array<Omit<CardDefinition, 'iconId' | 'maxStacks'> & Partial<Pick<CardDefinition, 'iconId' | 'maxStacks'>>> = [
  ...DEFENSIVE_CORES.map((core): CardDefinition => ({
    id: `weapon-${core.id}`, name: core.name, group: 'weapon', scope: 'defense',
    effect: core.id, description: `Arsenal core · occupies one of six sockets. ${core.description} Duplicate picks improve this core and accelerate mastery.`,
    iconId: `weapon-${core.id}`, value: 1, tags: [...core.tags], weapon: core.id, maxStacks: 12,
  })),
  { id: 'mod-insight', name: "Scholar's Lens", group: 'modifier', scope: 'tower', effect: 'xp-gain', value: 0.1, description: 'Gain 10% more XP from legitimate enemy defeats. Summons grant none; split enemies share their parent’s XP budget. Combined card XP bonuses cap at +50%.', tags: ['xp', 'learning'] },
  { id: 'mod-trophy-lore', name: 'Trophy Archive', group: 'modifier', scope: 'tower', effect: 'xp-elite', value: 0.25, description: 'Gain 25% more XP from elites and bosses. Applies to their original XP budget once; summoned or split descendants cannot multiply rewards.', tags: ['xp', 'elite'] },
  { id: 'on-learning-chain', name: 'Learning Cascade', group: 'trigger', scope: 'tower', effect: 'xp-chain', value: 0.02, description: 'Rapid legitimate defeats build a short learning chain: +2% XP per step, up to +10% before investment. Chain bonuses cannot trigger additional kills or XP.', tags: ['xp', 'kill', 'chain'] },
  { id: 'on-last-lesson', name: 'Last Lesson', group: 'trigger', scope: 'tower', effect: 'xp-low-health', value: 0.15, description: 'Gain 15% more XP while below 40% health. Evaluated when an eligible enemy falls; healing above the threshold immediately ends the bonus.', tags: ['xp', 'low-health'] },
  { id: 'utility-apprenticeship', name: "Apprentice's Seal", group: 'utility', scope: 'weapon', effect: 'mastery-focus', value: 0.25, description: 'Chosen core gains 25% more mastery from active combat participation, capped at +50%. Applies equally to attack, protection, and recovery; attack frequency grants no extra progress.', tags: ['mastery', 'targeted'] },
  { id: 'utility-shared-study', name: 'Shared Study', group: 'utility', scope: 'tower', effect: 'mastery-investment', value: 20, description: 'Support-card investments grant equipped cores 20 active seconds of mastery progress. Only a real acquired support pick counts; mastery rewards do not trigger further rewards.', tags: ['mastery', 'support'] },
  { id: 'mod-rebound-coating', name: 'Rebound Plating', group: 'modifier', scope: 'defense', effect: 'reflect-bounce', value: 1, description: 'Reflected shots gain one bounce, capped at four. Return shots remain defensive damage and obey the shared proc-depth limit; bouncing does not reflect another shot.', tags: ['reflection', 'bounce'] },
  { id: 'on-serrated-refraction', name: 'Serrated Refraction', group: 'trigger', scope: 'defense', effect: 'reflect-barbs', value: 8, description: 'A reflected strike can release 8-damage barbs once per 0.5 seconds. Reflected barbs cannot trigger another refraction; proc depth remains bounded.', tags: ['reflection', 'thorns', 'retaliation'] },
  { id: 'def-mending-conversion', name: 'Overflow Dynamo', group: 'defense', scope: 'defense', effect: 'overheal-discharge', value: 12, description: 'Excess healing can fuel a 12-damage discharge once per second. Recovery is consumed once; recovery and retaliation cannot form a recursive loop.', tags: ['healing', 'overheal', 'retaliation'] },
  { id: 'on-aegis-siphon', name: 'Aegis Siphon', group: 'trigger', scope: 'defense', effect: 'hit-shield', value: 0.4, description: 'Eligible weapon hits charge 0.4 shield, at most once per 0.25 seconds. Existing shield capacity still applies, and shield gains cannot trigger weapon hits.', tags: ['shield', 'hit'] },
  { id: 'on-pain-reserve', name: 'Pain Reserve', group: 'trigger', scope: 'tower', effect: 'hurt-charge', value: 0.15, description: 'Incoming damage temporarily charges attacks by 15%. Charges have an internal cooldown, a bounded duration, and the shared temporary-bonus cap.', tags: ['hurt', 'damage', 'charge'] },
  { id: 'mod-ward-reach', name: 'Ward Reach', group: 'modifier', scope: 'defense', effect: 'defense-range', value: 0.12, description: 'Defensive cores and eligible retaliation gain 12% effect range, capped at +50%. This does not replace projectile range and cannot extend an effect beyond its lifetime.', tags: ['range', 'defense'] },
  { id: 'mod-mass-driver', name: 'Mass Driver', group: 'modifier', scope: 'projectiles', effect: 'mass-knockback', value: 10, description: 'Projectile mass adds 10 knockback, scaling with projectile size and capped at 80. Bosses retain their crowd-control resistance.', tags: ['size', 'knockback'] },
  { id: 'mod-long-flight', name: 'Long Flight', group: 'modifier', scope: 'projectiles', effect: 'flight-damage', value: 0.1, description: 'Projectiles gain 10% damage per second in flight, capped at +35% before further investment. Growth uses combat time, not rendering frames, and applies once per hit.', tags: ['lifetime', 'damage'] },
  { id: 'mod-accelerant', name: 'Accelerant', group: 'modifier', scope: 'projectiles', effect: 'flight-acceleration', value: 0.15, description: 'Projectiles accelerate by 15% of launch speed per combat second, capped at twice their launch speed. Existing projectile lifetime still limits travel.', tags: ['speed', 'lifetime'] },
  { id: 'mod-wake-condenser', name: 'Wake Condenser', group: 'modifier', scope: 'projectiles', effect: 'distance-pulse', value: 10, description: 'Traveling projectiles release a 10-damage pulse every 180 distance. An internal cooldown bounds emission; pulses do not emit new pulses.', tags: ['pulse', 'distance'] },
];
export const NEW_CARDS: CardDefinition[] = cardEntries.map(card => ({ ...card, iconId: card.iconId || card.id, maxStacks: card.maxStacks || 12 }));

export const CARDS: CardDefinition[] = [...BASE_CARDS, ...NEW_CARDS];
export const CARD_BY_ID: Record<string, CardDefinition> = Object.fromEntries(CARDS.map(card => [card.id, card]));
export const WEAPONS: WeaponDefinition[] = [...BASE_WEAPONS, ...DEFENSIVE_CORES];
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(core => [core.id, core])) as Record<WeaponKind, WeaponDefinition>;
export const TOWERS: TowerDefinition[] = [...LEGACY_TOWERS, {
  id: 'monolith' as TowerDefinition['id'], name: 'Monolith', subtitle: 'The Unbroken Mirror',
  description: 'A weathered bastion of white mirror and brass. It begins with a Mirror core and no weapon; incoming pressure becomes its offense.',
  color: '#d6ddcd', cost: 300, hp: 640, damage: 1, rate: 1, pattern: 'pulse', element: 'solar',
  passive: 'Reduces incoming damage by 20%. Starts with Mirror; defensive retaliation remains useful against ranged enemies and bosses.',
  skill: 'Reprisal', skillDescription: 'Temporarily strengthens defensive retaliation. Manual and conditional autocast share its cooldown.',
}];
