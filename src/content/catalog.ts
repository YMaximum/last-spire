import type { TowerDefinition } from '../model/shared';
import type { CardDefinition, WeaponDefinition, WeaponKind } from '../model/arsenal';
import { TOWERS as LEGACY_TOWERS } from './world';
import { CARDS as BASE_CARDS, WEAPONS as BASE_WEAPONS } from './base-catalog';
export { RARITIES, RARITY_COLORS, rarityLabel, SYNERGIES } from './base-catalog';

export const DEFENSIVE_KINDS = [
  'core-mirror',
  'core-thorn',
  'core-capacitor',
  'core-cinder',
  'core-frost',
  'core-mending',
  'core-gravitic',
  'core-echo',
] as const;
export type DefensiveKind = (typeof DEFENSIVE_KINDS)[number];
const DEFENSIVE_FUSION_KINDS = [
  'fused-cathedral',
  'fused-briar',
  'fused-dynamo',
  'fused-crucible',
] as const;
export type DefensiveFusionKind = (typeof DEFENSIVE_FUSION_KINDS)[number];
export function isDefensiveKind(kind: string): kind is DefensiveKind | DefensiveFusionKind {
  return (
    (DEFENSIVE_KINDS as readonly string[]).includes(kind) ||
    (DEFENSIVE_FUSION_KINDS as readonly string[]).includes(kind)
  );
}

export interface FusionDefinition {
  id: string;
  name: string;
  ingredients: [WeaponKind, WeaponKind];
  kind: WeaponKind;
  iconId: string;
  description: string;
  color: string;
  mechanic: string;
}

/** Manual mastery-six recipes. Fused equipment is never an ingredient or a card offer. */
export const FUSIONS: FusionDefinition[] = [
  {
    id: 'fusion-lance',
    kind: 'fused-lance',
    name: 'Aether Lance',
    ingredients: ['bolt', 'rail'],
    iconId: 'fusion-lance',
    color: '#d8e3ab',
    mechanic: 'charged-lance',
    description:
      'A charged piercing lance releases secondary runebolts. The central rail and its satellites share one inherited damage budget; secondary hits obey proc limits.',
  },
  {
    id: 'fusion-prism',
    kind: 'fused-prism',
    name: 'Prism Foundry',
    ingredients: ['volley', 'ricochet'],
    iconId: 'fusion-prism',
    color: '#b5dce0',
    mechanic: 'prism-barrage',
    description:
      'A faceted barrage refracts into bounded ricochets. Shot count, infusion payload, and inherited bounces form one combined volley rather than recursively multiplying projectiles.',
  },
  {
    id: 'fusion-orrery',
    kind: 'fused-orrery',
    name: 'Astral Orrery',
    ingredients: ['spiral', 'chakram'],
    iconId: 'fusion-orrery',
    color: '#c6b3ed',
    mechanic: 'returning-orrery',
    description:
      'Returning spiral blades trace engraved arcs and release traveling pulses. Outbound and returning passes retain the same core identity and bounded pulse cadence.',
  },
  {
    id: 'fusion-conduit',
    kind: 'fused-conduit',
    name: 'Storm Conduit',
    ingredients: ['beam', 'tesla'],
    iconId: 'fusion-conduit',
    color: '#e7d488',
    mechanic: 'storm-conduit',
    description:
      'Sustained lances establish a branching electrical connection between nearby enemies. Beam pressure and electrical branches use a shared budget with bounded chain depth.',
  },
  {
    id: 'fusion-citadel',
    kind: 'fused-citadel',
    name: 'Scarab Citadel',
    ingredients: ['swarm', 'drone'],
    iconId: 'fusion-citadel',
    color: '#a7d9bd',
    mechanic: 'carrier-swarm',
    description:
      'Persistent clockwork carriers launch seeking scarabs. The carrier and its swarms share the fused core’s targeting, infusions, and damage attribution; launch counts remain bounded.',
  },
  {
    id: 'fusion-cataclysm',
    kind: 'fused-cataclysm',
    name: 'Cataclysm Anvil',
    ingredients: ['mine', 'meteor'],
    iconId: 'fusion-cataclysm',
    color: '#efa278',
    mechanic: 'meteor-mines',
    description:
      'Buried targeting sigils call descending meteor strikes. Telegraphs precede impact, and the scar remains as a lingering damaging field. Strikes and fields share their inherited infusion allocation.',
  },
  {
    id: 'fusion-cathedral',
    kind: 'fused-cathedral',
    name: 'Mirror Cathedral',
    ingredients: ['core-mirror', 'core-echo'],
    iconId: 'fusion-cathedral',
    color: '#d5e1d1',
    mechanic: 'mirror-network',
    description:
      'A faceted reflection network turns incoming pressure into coordinated return shots and delayed echoes. Return effects retain cooldowns and cannot recursively reflect or echo.',
  },
  {
    id: 'fusion-briar',
    kind: 'fused-briar',
    name: 'Briar Heart',
    ingredients: ['core-thorn', 'core-mending'],
    iconId: 'fusion-briar',
    color: '#b8dca7',
    mechanic: 'recovery-barbs',
    description:
      'Recovery powers a barbed heart that answers incoming damage with thorn volleys. Effective healing and retaliation remain separately attributed, and recovery cannot produce an unbounded feedback loop.',
  },
  {
    id: 'fusion-dynamo',
    kind: 'fused-dynamo',
    name: 'Cryo Dynamo',
    ingredients: ['core-capacitor', 'core-frost'],
    iconId: 'fusion-dynamo',
    color: '#a9dfe9',
    mechanic: 'frost-discharge',
    description:
      'Shield absorption charges a defensive frost dynamo, releasing controlled icy discharges. Stored protection is counted once; repeated crowd control has diminishing strength against bosses.',
  },
  {
    id: 'fusion-crucible',
    kind: 'fused-crucible',
    name: 'Gravitic Crucible',
    ingredients: ['core-cinder', 'core-gravitic'],
    iconId: 'fusion-crucible',
    color: '#d8b0d7',
    mechanic: 'gravitic-burn',
    description:
      'A gravitational defense gathers threats into a burning retaliation field. Attraction and lingering heat remain readable and bounded, with boss resistance preserving counterplay.',
  },
  {
    id: 'fusion-barbed',
    kind: 'fused-barbed',
    name: 'Barbed Orrery',
    ingredients: ['orbit', 'core-thorn'],
    iconId: 'fusion-barbed',
    color: '#c6d49b',
    mechanic: 'guarding-barbs',
    description:
      'Guarding blades orbit the tower and release retaliatory barbs when it is struck. Offensive passes and defensive volleys inherit the same core investments without applying global bonuses twice.',
  },
  {
    id: 'fusion-thunder',
    kind: 'fused-thunder',
    name: 'Thunder Heart',
    ingredients: ['pulse', 'core-capacitor'],
    iconId: 'fusion-thunder',
    color: '#dce2a7',
    mechanic: 'shield-pulse',
    description:
      'Absorbed shield damage empowers expanding offensive pulses. Protection charge is consumed once, and the discharge does not create recursive shield-to-pulse triggers.',
  },
];
export const FUSION_BY_ID: Record<string, FusionDefinition> = Object.fromEntries(
  FUSIONS.map((fusion) => [fusion.id, fusion]),
);
export function isFusedKind(kind: string): boolean {
  return FUSIONS.some((fusion) => fusion.kind === kind);
}

const fusionStats: Array<[number, number, number, number]> = [
  [48, 1.2, 420, 500],
  [24, 0.85, 390, 330],
  [28, 0.9, 380, 270],
  [50, 1.1, 400, 360],
  [24, 1.6, 400, 330],
  [64, 2.4, 440, 280],
  [28, 1.3, 360, 330],
  [36, 1.7, 330, 300],
  [48, 2, 320, 300],
  [32, 2, 320, 290],
  [38, 1.1, 340, 320],
  [52, 1.65, 350, 330],
];
/** Display defaults; combat derives the fused budget from preserved ingredient investments. */
export const FUSION_WEAPONS: WeaponDefinition[] = FUSIONS.map((fusion, index) => ({
  id: fusion.kind,
  name: fusion.name,
  description: fusion.description,
  damage: fusionStats[index][0],
  cooldown: fusionStats[index][1],
  range: fusionStats[index][2],
  speed: fusionStats[index][3],
  tags: [
    'fusion',
    fusion.mechanic,
    ...(isDefensiveKind(fusion.kind) ? ['defensive-core'] : ['offensive-core']),
  ],
  color: fusion.color,
}));

const defensiveDefinitions: Array<
  [DefensiveKind, string, string, number, number, number, string[]]
> = [
  [
    'core-mirror',
    'Mirror',
    'Reflects incoming strikes as faceted return shots. Defensive participation builds mastery even without a weapon.',
    12,
    1.1,
    330,
    ['reflection', 'mirror'],
  ],
  [
    'core-thorn',
    'Thorn',
    'Releases barbed retaliation when the tower takes damage. A bounded retaliatory volley reaches nearby attackers.',
    16,
    1.4,
    300,
    ['thorns', 'retaliation'],
  ],
  [
    'core-capacitor',
    'Capacitor',
    'Stores absorbed damage and discharges it in a controlled pulse. Shield protection counts as active participation.',
    24,
    2.2,
    280,
    ['shield', 'absorption'],
  ],
  [
    'core-cinder',
    'Cinder',
    'Returns incoming pressure as burning retaliation. Its heat applies fire damage over time without recursive retaliation.',
    12,
    1.5,
    300,
    ['fire', 'retaliation'],
  ],
  [
    'core-frost',
    'Frost',
    'Builds a defensive frost ward and chills nearby threats when struck. Bosses resist crowd control rather than becoming immune.',
    12,
    1.8,
    270,
    ['frost', 'shield'],
  ],
  [
    'core-mending',
    'Mending',
    'Converts recovery into defensive strikes. Effective healing and protection build mastery independently of attack frequency.',
    16,
    2,
    300,
    ['healing', 'recovery'],
  ],
  [
    'core-gravitic',
    'Gravitic',
    'Maintains a gravitational protection field that restrains approaching enemies and converts pressure into void retaliation.',
    14,
    2.1,
    260,
    ['void', 'gravity'],
  ],
  [
    'core-echo',
    'Echo',
    'Repeats eligible defensive strikes after a short delay. Echoes have an internal cooldown and cannot recursively echo.',
    12,
    1.6,
    330,
    ['echo', 'retaliation'],
  ],
];
export const DEFENSIVE_CORES: WeaponDefinition[] = defensiveDefinitions.map(
  ([id, name, description, damage, cooldown, range, tags]) => ({
    id: id as WeaponKind,
    name,
    description,
    damage,
    cooldown,
    range,
    speed: 300,
    tags: ['defensive-core', ...tags],
    color: '#a6d7c5',
  }),
);

const cardEntries: Array<
  Omit<CardDefinition, 'iconId' | 'maxStacks'> &
    Partial<Pick<CardDefinition, 'iconId' | 'maxStacks'>>
> = [
  ...DEFENSIVE_CORES.map((core): CardDefinition => ({
    id: `weapon-${core.id}`,
    name: core.name,
    group: 'weapon',
    scope: 'defense',
    effect: core.id,
    description: `Arsenal core · occupies one of six sockets. ${core.description} Duplicate picks improve this core and accelerate mastery.`,
    iconId: `weapon-${core.id}`,
    value: 1,
    tags: [...core.tags],
    weapon: core.id,
    maxStacks: 12,
  })),
  {
    id: 'mod-insight',
    name: "Scholar's Lens",
    group: 'modifier',
    scope: 'tower',
    effect: 'xp-gain',
    value: 0.1,
    description:
      'Gain 10% more XP from legitimate enemy defeats. Summons grant none; split enemies share their parent’s XP budget. Combined card XP bonuses cap at +50%.',
    tags: ['xp', 'learning'],
  },
  {
    id: 'mod-trophy-lore',
    name: 'Trophy Archive',
    group: 'modifier',
    scope: 'tower',
    effect: 'xp-elite',
    value: 0.25,
    description:
      'Gain 25% more XP from elites and bosses. Applies to their original XP budget once; summoned or split descendants cannot multiply rewards.',
    tags: ['xp', 'elite'],
  },
  {
    id: 'on-learning-chain',
    name: 'Learning Cascade',
    group: 'trigger',
    scope: 'tower',
    effect: 'xp-chain',
    value: 0.02,
    description:
      'Rapid legitimate defeats build a short learning chain: +2% XP per step, up to +10% before investment. Chain bonuses cannot trigger additional kills or XP.',
    tags: ['xp', 'kill', 'chain'],
  },
  {
    id: 'on-last-lesson',
    name: 'Last Lesson',
    group: 'trigger',
    scope: 'tower',
    effect: 'xp-low-health',
    value: 0.15,
    description:
      'Gain 15% more XP while below 40% health. Evaluated when an eligible enemy falls; healing above the threshold immediately ends the bonus.',
    tags: ['xp', 'low-health'],
  },
  {
    id: 'utility-apprenticeship',
    name: "Apprentice's Seal",
    group: 'utility',
    scope: 'weapon',
    effect: 'mastery-focus',
    value: 0.25,
    description:
      'Chosen core gains 25% more mastery from active combat participation, capped at +50%. Applies equally to attack, protection, and recovery; attack frequency grants no extra progress.',
    tags: ['mastery', 'targeted'],
  },
  {
    id: 'utility-shared-study',
    name: 'Shared Study',
    group: 'utility',
    scope: 'tower',
    effect: 'mastery-investment',
    value: 20,
    description:
      'Support-card investments grant equipped cores 20 active seconds of mastery progress. Only a real acquired support pick counts; mastery rewards do not trigger further rewards.',
    tags: ['mastery', 'support'],
  },
  {
    id: 'mod-rebound-coating',
    name: 'Rebound Plating',
    group: 'modifier',
    scope: 'defense',
    effect: 'reflect-bounce',
    value: 1,
    description:
      'Reflected shots gain one bounce, capped at four. Return shots remain defensive damage and obey the shared proc-depth limit; bouncing does not reflect another shot.',
    tags: ['reflection', 'bounce'],
  },
  {
    id: 'on-serrated-refraction',
    name: 'Serrated Refraction',
    group: 'trigger',
    scope: 'defense',
    effect: 'reflect-barbs',
    value: 8,
    description:
      'A reflected strike can release 8-damage barbs once per 0.5 seconds. Reflected barbs cannot trigger another refraction; proc depth remains bounded.',
    tags: ['reflection', 'thorns', 'retaliation'],
  },
  {
    id: 'def-mending-conversion',
    name: 'Overflow Dynamo',
    group: 'defense',
    scope: 'defense',
    effect: 'overheal-discharge',
    value: 12,
    description:
      'Excess healing can fuel a 12-damage discharge once per second. Recovery is consumed once; recovery and retaliation cannot form a recursive loop.',
    tags: ['healing', 'overheal', 'retaliation'],
  },
  {
    id: 'on-aegis-siphon',
    name: 'Aegis Siphon',
    group: 'trigger',
    scope: 'defense',
    effect: 'hit-shield',
    value: 0.4,
    description:
      'Eligible weapon hits charge 0.4 shield, at most once per 0.25 seconds. Existing shield capacity still applies, and shield gains cannot trigger weapon hits.',
    tags: ['shield', 'hit'],
  },
  {
    id: 'on-pain-reserve',
    name: 'Pain Reserve',
    group: 'trigger',
    scope: 'tower',
    effect: 'hurt-charge',
    value: 0.15,
    description:
      'Incoming damage temporarily charges attacks by 15%. Charges have an internal cooldown, a bounded duration, and the shared temporary-bonus cap.',
    tags: ['hurt', 'damage', 'charge'],
  },
  {
    id: 'mod-ward-reach',
    name: 'Ward Reach',
    group: 'modifier',
    scope: 'defense',
    effect: 'defense-range',
    value: 0.12,
    description:
      'Defensive cores and eligible retaliation gain 12% effect range, capped at +50%. This does not replace projectile range and cannot extend an effect beyond its lifetime.',
    tags: ['range', 'defense'],
  },
  {
    id: 'mod-mass-driver',
    name: 'Mass Driver',
    group: 'modifier',
    scope: 'projectiles',
    effect: 'mass-knockback',
    value: 10,
    description:
      'Projectile mass adds 10 knockback, scaling with projectile size and capped at 80. Bosses retain their crowd-control resistance.',
    tags: ['size', 'knockback'],
  },
  {
    id: 'mod-long-flight',
    name: 'Long Flight',
    group: 'modifier',
    scope: 'projectiles',
    effect: 'flight-damage',
    value: 0.1,
    description:
      'Projectiles gain 10% damage per second in flight, capped at +35% before further investment. Growth uses combat time, not rendering frames, and applies once per hit.',
    tags: ['lifetime', 'damage'],
  },
  {
    id: 'mod-accelerant',
    name: 'Accelerant',
    group: 'modifier',
    scope: 'projectiles',
    effect: 'flight-acceleration',
    value: 0.15,
    description:
      'Projectiles accelerate by 15% of launch speed per combat second, capped at twice their launch speed. Existing projectile lifetime still limits travel.',
    tags: ['speed', 'lifetime'],
  },
  {
    id: 'mod-wake-condenser',
    name: 'Wake Condenser',
    group: 'modifier',
    scope: 'projectiles',
    effect: 'distance-pulse',
    value: 10,
    description:
      'Traveling projectiles release a 10-damage pulse every 180 distance. An internal cooldown bounds emission; pulses do not emit new pulses.',
    tags: ['pulse', 'distance'],
  },
];
export const NEW_CARDS: CardDefinition[] = cardEntries.map((card) => ({
  ...card,
  iconId: card.iconId || card.id,
  maxStacks: card.maxStacks || 12,
}));

export const CARDS: CardDefinition[] = [...BASE_CARDS, ...NEW_CARDS];
export const CARD_BY_ID: Record<string, CardDefinition> = Object.fromEntries(
  CARDS.map((card) => [card.id, card]),
);
export const WEAPONS: WeaponDefinition[] = [...BASE_WEAPONS, ...DEFENSIVE_CORES, ...FUSION_WEAPONS];
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((core) => [core.id, core])) as Record<
  WeaponKind,
  WeaponDefinition
>;
export const TOWERS: TowerDefinition[] = [
  ...LEGACY_TOWERS,
  {
    id: 'monolith' as TowerDefinition['id'],
    name: 'Monolith',
    subtitle: 'The Unbroken Mirror',
    description:
      'A weathered bastion of white mirror and brass. It begins with a Mirror core and no weapon; incoming pressure becomes its offense.',
    color: '#d6ddcd',
    cost: 300,
    hp: 640,
    damage: 1,
    rate: 1,
    pattern: 'pulse',
    element: 'solar',
    passive:
      'Reduces incoming damage by 20%. Defensive core power is increased by 50%. Starts with Mirror; defensive retaliation remains useful against ranged enemies and bosses.',
    skill: 'Reprisal',
    skillDescription:
      'Temporarily strengthens defensive retaliation. Manual and conditional autocast share its cooldown.',
  },
];
