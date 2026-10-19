import type { Element, EnemyKind } from '../model/shared';
import { ELEMENTS } from './world';
export type EnemyArchetypeId =
  | 'swarmer'
  | 'runner'
  | 'armored'
  | 'ranged'
  | 'support'
  | 'splitter'
  | 'elite'
  | 'guardian'
  | 'thorn-retaliator'
  | 'spore-shepherd'
  | 'burrower'
  | 'plated-crawler'
  | 'furnace-artillery'
  | 'forge-carrier'
  | 'rift-skirmisher'
  | 'pulse-caster'
  | 'echo-attacker'
  | 'elder-root'
  | 'forge-colossus'
  | 'last-eclipse';
export type EnemyMechanic =
  | 'shared'
  | 'thorns'
  | 'mend'
  | 'burrow'
  | 'plates'
  | 'artillery'
  | 'barrier'
  | 'rift'
  | 'pulse'
  | 'echo'
  | 'root-boss'
  | 'forge-boss'
  | 'eclipse-boss';
export interface Discovery {
  encountered: number;
  defeated: number;
}
export type BestiaryRecords = Partial<Record<EnemyArchetypeId, Discovery>>;
export interface EnemyDefinition {
  id: EnemyArchetypeId;
  name: string;
  role: EnemyKind;
  stage?: number;
  firstWave: number;
  mechanic: EnemyMechanic;
  health: number;
  damage: number;
  speed?: number;
  armor?: number;
  radius?: number;
  color: string;
  attack: string;
  telegraph: string;
  strength: string;
  weakness: string;
  limits: string;
  resistance?: Partial<Record<Element | 'physical', number>>;
}
const shared = (
  id: EnemyArchetypeId,
  name: string,
  role: EnemyKind,
  health: number,
  attack: string,
  weakness: string,
): EnemyDefinition => ({
  id,
  name,
  role,
  health,
  damage: 1,
  firstWave: role === 'swarmer' ? 1 : 4,
  mechanic: 'shared',
  color: '#b6c9aa',
  attack,
  telegraph:
    role === 'ranged'
      ? 'A 0.7-second aiming line precedes each shot.'
      : role === 'boss'
        ? 'A 1.1-second furnace ring precedes each strike.'
        : 'Closing distance shows the attack lane.',
  strength: 'Coordinates with the surrounding formation.',
  weakness,
  limits:
    role === 'boss'
      ? 'Boss control is 35% strength; phase summons grant no scrap or XP.'
      : 'No elemental immunity.',
});
export const ENEMIES: EnemyDefinition[] = [
  shared(
    'swarmer',
    'Cinder Mite',
    'swarmer',
    1,
    'Closes in and bites every 1.4 seconds.',
    'Area damage and slow fields punish tightly packed mites.',
  ),
  shared(
    'runner',
    'Needle Runner',
    'runner',
    0.65,
    'Rushes through a lane to strike the spire.',
    'Low health; prioritize the nearest runner or slow its advance.',
  ),
  {
    ...shared(
      'armored',
      'Iron Husk',
      'armored',
      2.4,
      'Slow armored advance and close strikes.',
      'Damage over time bypasses part of ordinary armor; focus or pierce the escort.',
    ),
    armor: 0.3,
  },
  shared(
    'ranged',
    'Rune Slinger',
    'ranged',
    1.2,
    'Stops at range and fires telegraphed shots every 2.7 seconds.',
    'Range, seeking attacks and well-timed barriers answer the back line.',
  ),
  shared(
    'support',
    'Lantern Keeper',
    'support',
    1.7,
    'Restores nearby allies and telegraphs pressure pulses. Healing stops after six pulses per keeper.',
    'Focus the keeper before the escort; avoid spreading damage across its whole group.',
  ),
  shared(
    'splitter',
    'Seamed Vessel',
    'splitter',
    1.5,
    'Breaks into two smaller mites on defeat.',
    'Area damage catches its children; splitting never creates extra scrap.',
  ),
  {
    ...shared(
      'elite',
      'Brass Executioner',
      'elite',
      7,
      'Heavy close attacks with an armored escort every ten waves.',
      'Sustained damage, focused targeting and saved skills.',
    ),
    firstWave: 10,
    radius: 19,
  },
  {
    ...shared(
      'guardian',
      'Boundary Warden',
      'boss',
      24,
      'Alternates telegraphed strikes and bounded phase reinforcements.',
      'Prepare barriers during the warning; bosses retain only 35% of normal control.',
    ),
    firstWave: 25,
    armor: 0.15,
    radius: 29,
  },
  {
    id: 'thorn-retaliator',
    name: 'Thorn Retaliator',
    role: 'armored',
    stage: 0,
    firstWave: 4,
    mechanic: 'thorns',
    health: 1.65,
    damage: 0.9,
    color: '#91b875',
    attack: 'Surviving a primary hit releases a short barbed retaliation toward the spire.',
    telegraph: 'The barbed crown identifies retaliation; reaching the spire enables close strikes.',
    strength: 'Punishes many small primary hits.',
    weakness:
      'Damage over time does not trigger its thorns. Burst kills prevent retaliation; fire deals 15% more damage.',
    limits:
      'Thorns have a 1.4-second internal cooldown and never respond to retaliation or proc damage.',
    resistance: { fire: -0.15 },
  },
  {
    id: 'spore-shepherd',
    name: 'Spore Shepherd',
    role: 'support',
    stage: 0,
    firstWave: 7,
    mechanic: 'mend',
    health: 1.8,
    damage: 0.7,
    color: '#b2d18c',
    attack: 'Stops behind the front line, warns, then restores up to three nearby allies.',
    telegraph: 'A green lattice charges for 0.9 seconds before healing.',
    strength: 'Keeps an escort alive when damage is spread thin.',
    weakness:
      'Stun cancels the pulse. Recovery takes 25% extra damage; poison deals 15% more damage.',
    limits: 'Six healing pulses per shepherd, 2.5% ally max HP per pulse; no self-healing.',
    resistance: { poison: -0.15 },
  },
  {
    id: 'burrower',
    name: 'Gravel Burrower',
    role: 'runner',
    stage: 0,
    firstWave: 11,
    mechanic: 'burrow',
    health: 1.35,
    damage: 1.05,
    color: '#c7ab79',
    attack: 'Marks a tunnel lane, then emerges up to 70 units closer to the spire.',
    telegraph: 'A dirt trail warns for 1.1 seconds before the leap.',
    strength: 'Crosses a defensive perimeter quickly, taking 35% less damage during its dive.',
    weakness:
      'Always targetable. Stun interrupts the dive; emergence takes 25% extra damage. Frost deals 15% more damage.',
    limits: 'One dive per seven seconds; no untargetable phase.',
    resistance: { frost: -0.15 },
  },
  {
    id: 'plated-crawler',
    name: 'Cycling Crawler',
    role: 'armored',
    stage: 1,
    firstWave: 4,
    mechanic: 'plates',
    health: 2.3,
    armor: 0.45,
    damage: 1.05,
    speed: 17,
    color: '#d5a26f',
    attack: 'Advances with rotating plates: three seconds covered, then two seconds exposed.',
    telegraph: 'Brass plates open to reveal a luminous vent.',
    strength: '45% ordinary armor while covered.',
    weakness:
      'Open plates leave only 5% armor. Lightning deals 10% more damage; damage over time still works through plates.',
    limits: 'Armor never exceeds 45%; no elemental immunity.',
    resistance: { lightning: -0.1 },
  },
  {
    id: 'furnace-artillery',
    name: 'Furnace Artillery',
    role: 'ranged',
    stage: 1,
    firstWave: 7,
    mechanic: 'artillery',
    health: 1.6,
    damage: 1.2,
    speed: 17,
    color: '#f4a76d',
    attack: 'Holds a distant firing lane. Two cannon shots overheat its machinery.',
    telegraph: 'A 1.2-second amber aiming line precedes each shot.',
    strength: 'Pressures builds whose range cannot reach the back line.',
    weakness:
      'Stun interrupts the cannon. After every second shot it exposes its vent for 2.3 seconds, taking 35% extra damage. Frost deals 15% more damage.',
    limits: 'One shot per 3.8 seconds; all cannon pressure is telegraphed.',
    resistance: { frost: -0.15, fire: 0.15 },
  },
  {
    id: 'forge-carrier',
    name: 'Formation Carrier',
    role: 'support',
    stage: 1,
    firstWave: 11,
    mechanic: 'barrier',
    health: 2.1,
    damage: 0.8,
    color: '#e4bd7b',
    attack: 'Warns, then grants a bounded barrier to three nearby escort units.',
    telegraph: 'A faceted gold lattice charges for one second.',
    strength: 'Protects a concentrated formation.',
    weakness:
      'Kill or stun the carrier before the cast; barriers expire. Void deals 15% more damage.',
    limits:
      'Three casts per carrier; barrier cap 15% of each ally’s max HP, duration six seconds; repeated casts do not stack.',
    resistance: { void: -0.15 },
  },
  {
    id: 'rift-skirmisher',
    name: 'Rift Skirmisher',
    role: 'runner',
    stage: 2,
    firstWave: 4,
    mechanic: 'rift',
    health: 1.15,
    damage: 1.15,
    color: '#bd9be2',
    attack: 'Marks a lateral rift, then dashes inward and sideways.',
    telegraph: 'A violet destination sigil warns for one second.',
    strength: 'Changes lanes to pressure a focused build.',
    weakness:
      'Stun cancels the dash; recovery takes 20% extra damage. Solar deals 15% more damage.',
    limits: 'One dash per 5.5 seconds; remains targetable throughout.',
    resistance: { solar: -0.15, void: 0.15 },
  },
  {
    id: 'pulse-caster',
    name: 'Concord Caster',
    role: 'ranged',
    stage: 2,
    firstWave: 7,
    mechanic: 'pulse',
    health: 1.5,
    damage: 1.1,
    color: '#c5a5ee',
    attack: 'Nearby casters coordinate delayed pulses toward the spire.',
    telegraph: 'Linked violet rings charge for 1.1 seconds.',
    strength: 'Coordinated ranged pressure demands timely defenses.',
    weakness: 'Stun breaks a cast; focus the group. Physical damage deals 15% more damage.',
    limits:
      'At most three caster pulses can damage the tower in each six-second coordination window.',
    resistance: { physical: -0.15 },
  },
  {
    id: 'echo-attacker',
    name: 'Hollow Echo',
    role: 'ranged',
    stage: 2,
    firstWave: 11,
    mechanic: 'echo',
    health: 1.6,
    damage: 1.05,
    color: '#a8b0ed',
    attack: 'A telegraphed shot is followed by one weaker delayed echo.',
    telegraph: 'A 0.9-second first warning; a second outline persists for 1.4 seconds.',
    strength: 'Punishes defenses spent entirely on the first shot.',
    weakness:
      'Defeat or stun the attacker to cancel its pending echo. Solar deals 15% more damage.',
    limits: 'One echo per attack; 45% damage; echoes cannot generate echoes.',
    resistance: { solar: -0.15 },
  },
  {
    id: 'elder-root',
    name: 'The Elder Root',
    role: 'boss',
    stage: 0,
    firstWave: 100,
    mechanic: 'root-boss',
    health: 25,
    damage: 1,
    armor: 0.15,
    radius: 33,
    color: '#adc77d',
    attack: 'Root pulses, limited regeneration and reinforcements at 70% and 35% health.',
    telegraph: 'A root lattice warns for 1.3 seconds before the pulse.',
    strength: 'Sustained phases support the surrounding forest.',
    weakness:
      'Two-second recovery takes 35% extra damage; fire deals 15% more damage. Stun interrupts pending attacks at boss resistance.',
    limits:
      'Four lifetime summons with no scrap/XP; six 1% regeneration pulses; boss control strength 35%.',
    resistance: { fire: -0.15, poison: 0.15 },
  },
  {
    id: 'forge-colossus',
    name: 'Forge Colossus',
    role: 'boss',
    stage: 1,
    firstWave: 100,
    mechanic: 'forge-boss',
    health: 26,
    damage: 1.05,
    armor: 0.45,
    radius: 35,
    color: '#efb76f',
    attack: 'Cycles armor, furnace strikes and exposed-vent recovery; two bounded escort waves.',
    telegraph: 'A 1.5-second furnace warning precedes the strike.',
    strength: '45% armor while its furnace is closed.',
    weakness:
      'A 2.5-second open vent has 5% armor and takes 35% extra damage. Lightning deals 10% more damage.',
    limits:
      'Four lifetime summons with no scrap/XP; no elemental immunity; boss control strength 35%.',
    resistance: { lightning: -0.1, fire: 0.2 },
  },
  {
    id: 'last-eclipse',
    name: 'The Last Eclipse',
    role: 'boss',
    stage: 2,
    firstWave: 100,
    mechanic: 'eclipse-boss',
    health: 27,
    damage: 1.1,
    armor: 0.15,
    radius: 34,
    color: '#d6b5fa',
    attack: 'Spatial anchor hazards, paired delayed bursts and limited rift escorts.',
    telegraph: 'An anchor warns for 1.7 seconds, then a second burst warns for 0.8 seconds.',
    strength: 'Two distinct hits test the timing of shield and healing skills.',
    weakness:
      'Three-second anchor recovery takes 40% extra damage. Stun or defeat cancels pending bursts; solar deals 15% more damage.',
    limits:
      'Only one follow-up burst per cast; four lifetime summons with no scrap/XP; boss control strength 35%.',
    resistance: { solar: -0.15, void: 0.2 },
  },
];
export const ENEMY_BY_ID = Object.fromEntries(ENEMIES.map((e) => [e.id, e])) as Record<
  EnemyArchetypeId,
  EnemyDefinition
>;
export const STAGE_EXCLUSIVES: EnemyArchetypeId[][] = [
  ['thorn-retaliator', 'spore-shepherd', 'burrower'],
  ['plated-crawler', 'furnace-artillery', 'forge-carrier'],
  ['rift-skirmisher', 'pulse-caster', 'echo-attacker'],
];
export const FINAL_BOSSES: EnemyArchetypeId[] = ['elder-root', 'forge-colossus', 'last-eclipse'];
export interface EncounterContext {
  stage: number;
  wave: number;
  difficulty: number;
  mode: 'quick' | 'normal' | 'endless';
  endless?: boolean;
}
/** New expedition tuning; recovered encounters retain their original engine constants. */
export const ENCOUNTER_TUNING = {
  normalHealth: 0.85,
  quickHealth: 0.2,
  normalDamage: 1.14,
  quickDamage: 1.9,
  bossHealth: 0.8,
  stageHealth: [1, 1.16, 1.34],
  stageDamage: [1, 1.12, 1.26],
  endlessHealthPerWave: 0.055,
} as const;
export function enemyDamageType(
  id: EnemyArchetypeId,
  context: EncounterContext,
): Element | 'physical' {
  const def = ENEMY_BY_ID[id];
  if (def.role === 'armored' || def.role === 'runner') return 'physical';
  if (def.stage !== undefined) return (['poison', 'fire', 'void'] as const)[def.stage];
  return def.role === 'ranged' || def.role === 'boss'
    ? ELEMENTS[(context.stage + Math.floor(context.wave / 10)) % 6].id
    : 'physical';
}
export function enemyStats(id: EnemyArchetypeId, context: EncounterContext) {
  const d = ENEMY_BY_ID[id],
    w = context.wave,
    equivalent = context.mode === 'quick' ? w * 2 : w;
  const healthScale =
    (1 + equivalent * 0.075 + Math.pow(equivalent / 13, 2)) *
    (context.mode === 'quick' ? ENCOUNTER_TUNING.quickHealth : ENCOUNTER_TUNING.normalHealth) *
    ENCOUNTER_TUNING.stageHealth[context.stage] *
    (1 + context.difficulty * 0.2) *
    (1 +
      Math.max(0, w - (context.mode === 'quick' ? 50 : 100)) *
        ENCOUNTER_TUNING.endlessHealthPerWave);
  const boss = d.role === 'boss';
  return {
    hp: 19 * healthScale * d.health * (boss ? ENCOUNTER_TUNING.bossHealth : 1),
    damage:
      (boss ? 12.5 : d.role === 'ranged' ? 5 : 3.8) *
      (1 + equivalent * 0.03) *
      (context.mode === 'quick' ? ENCOUNTER_TUNING.quickDamage : ENCOUNTER_TUNING.normalDamage) *
      ENCOUNTER_TUNING.stageDamage[context.stage] *
      d.damage,
    speed:
      d.speed ??
      (d.role === 'runner' ? 43 : boss ? 8 : d.role === 'armored' ? 14 + w * 0.12 : 21 + w * 0.16),
    armor: d.armor ?? (d.role === 'armored' ? 0.3 : boss ? 0.15 : 0),
    radius: d.radius ?? (boss ? 29 : d.role === 'elite' ? 19 : d.role === 'armored' ? 13 : 9),
    control: boss ? 0.35 : d.role === 'elite' ? 0.65 : 1,
  };
}
export function isEncounterBoss(context: EncounterContext, wave = context.wave) {
  return context.mode === 'quick'
    ? [12, 25, 37, 50].includes(wave) || (!!context.endless && wave > 50 && wave % 12 === 0)
    : wave % 25 === 0;
}
export function waveRoster(context: EncounterContext): EnemyArchetypeId[] {
  const endpoint = context.mode === 'quick' ? 50 : 100;
  if (isEncounterBoss(context))
    return [
      context.wave === endpoint ||
      (context.endless && context.wave > endpoint && context.wave % endpoint === 0)
        ? FINAL_BOSSES[context.stage]
        : 'guardian',
      'swarmer',
      'ranged',
      ...STAGE_EXCLUSIVES[context.stage].filter(
        (id) =>
          ENEMY_BY_ID[id].firstWave <= (context.mode === 'quick' ? context.wave * 2 : context.wave),
      ),
    ];
  if (context.wave % 10 === 0)
    return [
      'elite',
      ...STAGE_EXCLUSIVES[context.stage].filter(
        (id) =>
          ENEMY_BY_ID[id].firstWave <= (context.mode === 'quick' ? context.wave * 2 : context.wave),
      ),
    ];
  return [
    ...(context.wave < 4
      ? ['swarmer' as const]
      : (['swarmer', 'runner', 'armored', 'ranged', 'support', 'splitter'] as EnemyArchetypeId[])),
    ...STAGE_EXCLUSIVES[context.stage].filter(
      (id) =>
        ENEMY_BY_ID[id].firstWave <= (context.mode === 'quick' ? context.wave * 2 : context.wave),
    ),
  ];
}
export function formationName(wave: number): string {
  return ['Encirclement', 'Encirclement', 'Pincer advance', 'Escort column'][wave % 4];
}

/** Preview the next formation; finite final waves retain their current final boss. */
export function nextEncounter(context: EncounterContext) {
  const end = context.mode === 'quick' ? 50 : 100;
  const wave = context.wave < end || context.endless ? context.wave + 1 : context.wave;
  return { wave, roster: waveRoster({ ...context, wave }) };
}
