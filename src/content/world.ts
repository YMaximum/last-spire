import type {
  Element,
  Modifier,
  Pattern,
  StageDefinition,
  SynergyDefinition,
  TowerDefinition,
  TowerId,
} from '../model/shared';

export const PATTERNS: { id: Pattern; name: string; description: string }[] = [
  { id: 'bolt', name: 'Bolt', description: 'A fast, focused shot that favors a single target.' },
  { id: 'volley', name: 'Volley', description: 'A short fan of shots that covers a broad lane.' },
  {
    id: 'spiral',
    name: 'Spiral',
    description: 'Eight outward shots rotate their firing direction over time.',
  },
  {
    id: 'beam',
    name: 'Beam',
    description: 'A piercing line of energy cuts through targets in its path.',
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'Sweeping blades strike enemies within 290 units of the spire.',
  },
  {
    id: 'pulse',
    name: 'Pulse',
    description: 'A burst radiates in every direction from the tower.',
  },
  {
    id: 'swarm',
    name: 'Swarm',
    description: 'Three homing bolts pursue the priority target and retarget when it falls.',
  },
  {
    id: 'mine',
    name: 'Mine',
    description: 'A lingering charge waits in the lane, then bursts on contact.',
  },
];

export const ELEMENT_COLORS: Record<Element, string> = {
  fire: '#ff7048',
  frost: '#79d9ff',
  lightning: '#f6d85b',
  poison: '#8ee36d',
  solar: '#ffbf55',
  void: '#bd8cff',
};

export const ELEMENTS: { id: Element; name: string; color: string; description: string }[] = [
  {
    id: 'fire',
    name: 'Ember',
    color: ELEMENT_COLORS.fire,
    description: 'Burns enemies over time; burning intensity decays gradually.',
  },
  {
    id: 'frost',
    name: 'Rime',
    color: ELEMENT_COLORS.frost,
    description: 'Chills enemies, slowing their advance and setting up brittle targets.',
  },
  {
    id: 'lightning',
    name: 'Storm',
    color: ELEMENT_COLORS.lightning,
    description: 'Arcs between nearby enemies to spread a strike across a pack.',
  },
  {
    id: 'poison',
    name: 'Venom',
    color: ELEMENT_COLORS.poison,
    description: 'Poisons durable foes with damage that lingers after impact.',
  },
  {
    id: 'solar',
    name: 'Dawn',
    color: ELEMENT_COLORS.solar,
    description: 'Marks enemies for three seconds; marked targets take 22% more damage.',
  },
  {
    id: 'void',
    name: 'Abyss',
    color: ELEMENT_COLORS.void,
    description: 'Pulls struck enemies toward the spire. Bosses resist the pull.',
  },
];

export const MODIFIERS: { id: Modifier; name: string; description: string }[] = [
  {
    id: 'echo',
    name: 'Echo',
    description: 'Repeats the attack at 56% damage, or 68% for Tempest.',
  },
  {
    id: 'rupture',
    name: 'Rupture',
    description: 'Every primary hit splashes 28% damage within 48 units. Splashes cannot proc.',
  },
  {
    id: 'mark',
    name: 'Mark',
    description: 'Marks targets for five seconds, increasing subsequent damage by 22%.',
  },
  {
    id: 'surge',
    name: 'Surge',
    description: 'Every fourth attack deals double damage and glows with stored charge.',
  },
];

export const TOWERS: TowerDefinition[] = [
  {
    id: 'bastion',
    name: 'Bastion',
    subtitle: 'The Steadfast',
    description: 'A reliable sentinel that marks threats and holds the center of the line.',
    color: '#e8c879',
    cost: 0,
    hp: 320,
    damage: 1,
    rate: 1,
    pattern: 'bolt',
    element: 'solar',
    passive: 'Reduces incoming damage by 10%; Mark attacks also grant shield.',
    skill: 'Bulwark',
    skillDescription: 'Gain a shield equal to 45% of max health.',
  },
  {
    id: 'pyre',
    name: 'Pyre',
    subtitle: 'The Cinderheart',
    description: 'A furnace tower that turns tight enemy formations into spreading flame.',
    color: '#ff7048',
    cost: 100,
    hp: 290,
    damage: 1.1,
    rate: 0.92,
    pattern: 'volley',
    element: 'fire',
    passive: 'Fire hits deal 20% more damage and apply stronger burn.',
    skill: 'Wildfire',
    skillDescription:
      'Gain an 8-second damage and attack-speed boost, and blast nearby enemies with fire.',
  },
  {
    id: 'tempest',
    name: 'Tempest',
    subtitle: 'The Stormcaller',
    description: 'A quick-striking coil that chains lightning through crowded lanes.',
    color: '#f6d85b',
    cost: 180,
    hp: 285,
    damage: 0.9,
    rate: 1.16,
    pattern: 'spiral',
    element: 'lightning',
    passive: 'Lightning chains jump three times; Echo repeats deal 68% damage.',
    skill: 'Chainstorm',
    skillDescription:
      'Gain a 7-second damage and attack-speed boost, and strike every enemy with lightning.',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    subtitle: 'The Quiet Wall',
    description: 'A patient frost engine that buys time by slowing whole enemy waves.',
    color: '#79d9ff',
    cost: 260,
    hp: 340,
    damage: 0.95,
    rate: 0.88,
    pattern: 'beam',
    element: 'frost',
    passive: 'Frost hits build chill slightly faster and to a higher maximum.',
    skill: 'Whiteout',
    skillDescription: 'Stall enemies for 6 seconds and gain a shield equal to 20% of max health.',
  },
  {
    id: 'verdant',
    name: 'Verdant',
    subtitle: 'The Deep Root',
    description: 'A living turret that seeds venom and thrives during drawn-out sieges.',
    color: '#8ee36d',
    cost: 350,
    hp: 310,
    damage: 1.05,
    rate: 0.96,
    pattern: 'swarm',
    element: 'poison',
    passive: 'Poison hits restore health equal to 1.2% of their damage.',
    skill: 'Overgrowth',
    skillDescription: 'Restore 25% of max health and poison every enemy on the field.',
  },
  {
    id: 'null',
    name: 'Null',
    subtitle: 'The Unmaking',
    description: 'A void projector that strips strength from the hardest target in range.',
    color: '#bd8cff',
    cost: 450,
    hp: 300,
    damage: 1.2,
    rate: 0.9,
    pattern: 'pulse',
    element: 'void',
    passive: 'Void hits deal 30% more damage near the spire; Null takes 12% more incoming damage.',
    skill: 'Event Horizon',
    skillDescription: 'Pull every enemy toward the spire and damage them with void.',
  },
];

export const STAGES: StageDefinition[] = [
  {
    id: 0,
    name: 'Verdant Wilds',
    subtitle: 'Where the old roots stir',
    description: 'A forgotten woodland whose paths tighten beneath the advance.',
    color: '#78be72',
    background: 'wilds',
    hazard: 'Every 18 seconds, enemies surge 6% faster.',
    bosses: ['The Briar King', 'Mossback Colossus', 'Thorn Oracle', 'The Elder Root'],
  },
  {
    id: 1,
    name: 'Ember Foundry',
    subtitle: 'Fires beneath the mountain',
    description: 'A buried works of iron channels and furnaces, still hot from its last shift.',
    color: '#df8057',
    background: 'foundry',
    hazard: 'Every 15 seconds, the furnace deals 8 damage plus 0.08 per wave to the spire.',
    bosses: ['The Iron Warden', 'Kilnheart', 'The Slag Herald', 'Forge Colossus'],
  },
  {
    id: 2,
    name: 'Void Ruins',
    subtitle: 'Beyond the last horizon',
    description: 'A fracture in the dark where distance folds and the spire loses its bearings.',
    color: '#aa83e8',
    background: 'void',
    hazard: 'Every 20 seconds, ranged enemies charge their next attack faster.',
    bosses: ['The Hollow Star', 'Null Regent', 'Rift Oracle', 'The Last Eclipse'],
  },
];

const ELEMENTAL_SYNERGIES: SynergyDefinition[] = [
  {
    id: 'fire-frost',
    name: 'Thermal Shock',
    elements: ['fire', 'frost'],
    description: 'Fire hits deal 30% more damage to chilled enemies.',
    color: '#ff9a62',
  },
  {
    id: 'fire-lightning',
    name: 'Firestorm',
    elements: ['fire', 'lightning'],
    description: 'Lightning hits deal 32% extra fire damage to burning targets.',
    color: '#ffc45d',
  },
  {
    id: 'fire-poison',
    name: 'Wildfire Bloom',
    elements: ['fire', 'poison'],
    description: 'Fire hitting a poisoned target splashes fire damage to enemies within 65 units.',
    color: '#c8d956',
  },
  {
    id: 'fire-solar',
    name: 'Corona',
    elements: ['fire', 'solar'],
    description:
      'Solar hits on burning targets deal 15% extra solar damage and extend burn by 15%.',
    color: '#ffb34f',
  },
  {
    id: 'fire-void',
    name: 'Ashen Rift',
    elements: ['fire', 'void'],
    description: 'Void hits on burning targets splash fire damage to enemies within 72 units.',
    color: '#c183a0',
  },
  {
    id: 'frost-lightning',
    name: 'Shattercurrent',
    elements: ['frost', 'lightning'],
    description: 'Lightning chain targets are stunned for 0.22 seconds (0.077 seconds for bosses).',
    color: '#a9d9e9',
  },
  {
    id: 'frost-poison',
    name: 'Cold Venom',
    elements: ['frost', 'poison'],
    description: 'Poison hits on chilled targets add poison equal to 20% of hit damage.',
    color: '#9cdda2',
  },
  {
    id: 'frost-solar',
    name: 'Prism Break',
    elements: ['frost', 'solar'],
    description: 'Solar hits on chilled targets grant 1.5 shield, up to 35% of max health.',
    color: '#c5e9a7',
  },
  {
    id: 'frost-void',
    name: 'Deep Freeze',
    elements: ['frost', 'void'],
    description: 'Void hits stun chilled targets for 0.3 seconds (0.105 seconds for bosses).',
    color: '#a6b8ea',
  },
  {
    id: 'lightning-poison',
    name: 'Toxic Circuit',
    elements: ['lightning', 'poison'],
    description: 'Each lightning chain target gains poison equal to 12% of the hit damage.',
    color: '#b8d85b',
  },
  {
    id: 'lightning-solar',
    name: 'Sunstrike',
    elements: ['lightning', 'solar'],
    description: 'Lightning hits deal 28% extra solar damage to marked targets.',
    color: '#f4d56b',
  },
  {
    id: 'lightning-void',
    name: 'Rift Current',
    elements: ['lightning', 'void'],
    description:
      'Lightning chains reach 160 instead of 105 units; defeated enemies pull nearby foes slightly inward.',
    color: '#c0a7e8',
  },
  {
    id: 'poison-solar',
    name: 'Verdant Dawn',
    elements: ['poison', 'solar'],
    description: 'Solar hits on poisoned targets restore health equal to 1.5% of hit damage.',
    color: '#b8d779',
  },
  {
    id: 'poison-void',
    name: 'Abyssal Rot',
    elements: ['poison', 'void'],
    description: 'Void hits deal 25% more damage to poisoned targets.',
    color: '#9bca92',
  },
  {
    id: 'solar-void',
    name: 'Eclipse',
    elements: ['solar', 'void'],
    description: 'Void hits deal 35% more damage to marked targets.',
    color: '#c59edc',
  },
];

export const SYNERGIES: SynergyDefinition[] = [
  ...ELEMENTAL_SYNERGIES,
  {
    id: 'bastion-mark',
    name: 'Marked Ground',
    tower: 'bastion',
    modifiers: ['mark'],
    description:
      'Bastion attacks with Mark grant shield equal to 1.2% of hit damage, up to 35% of max health.',
    color: '#e8c879',
  },
  {
    id: 'tempest-echo',
    name: 'Aftershock',
    tower: 'tempest',
    modifiers: ['echo'],
    description: 'Tempest Echo repeats deal 68% damage instead of the usual 56%.',
    color: '#f6d85b',
  },
  {
    id: 'null-surge',
    name: 'Singularity',
    tower: 'null',
    modifiers: ['surge'],
    description: 'Null Surge attacks deal 30% more damage when their charge releases.',
    color: '#bd8cff',
  },
];

export const RECIPES: { pattern: Pattern; element: Element; modifier: Modifier; id: string }[] =
  PATTERNS.flatMap(({ id: pattern }) =>
    ELEMENTS.flatMap(({ id: element }) =>
      MODIFIERS.map(({ id: modifier }) => ({
        pattern,
        element,
        modifier,
        id: `${pattern}-${element}-${modifier}`,
      })),
    ),
  );
