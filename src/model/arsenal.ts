import type {
  Element,
  TowerId,
  Enemy,
  Profile,
  RunState as LegacyRun,
  Settings as LegacySettings,
  Targeting,
} from './shared';
export type { Element, TowerId, Profile, Targeting };
export type WeaponKind =
  | 'bolt'
  | 'volley'
  | 'spiral'
  | 'beam'
  | 'orbit'
  | 'pulse'
  | 'swarm'
  | 'mine'
  | 'ricochet'
  | 'chakram'
  | 'rail'
  | 'flame'
  | 'tesla'
  | 'drone'
  | 'meteor'
  | 'singularity'
  | 'core-mirror'
  | 'core-thorn'
  | 'core-capacitor'
  | 'core-cinder'
  | 'core-frost'
  | 'core-mending'
  | 'core-gravitic'
  | 'core-echo'
  | 'fused-lance'
  | 'fused-prism'
  | 'fused-orrery'
  | 'fused-conduit'
  | 'fused-citadel'
  | 'fused-cataclysm'
  | 'fused-cathedral'
  | 'fused-briar'
  | 'fused-dynamo'
  | 'fused-crucible'
  | 'fused-barbed'
  | 'fused-thunder'
  | 'fused-pyroclasm'
  | 'fused-tempest'
  | 'fused-reliquary'
  | 'fused-impact-well'
  | 'fused-sanctuary'
  | 'fused-hoarfrost'
  | 'fused-parallax'
  | 'fused-rimechoir';
export type Rarity = 'normal' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type CardGroup =
  'weapon' | 'infusion' | 'modifier' | 'defense' | 'trigger' | 'skill' | 'utility';
export type CardScope = 'projectiles' | 'defense' | 'weapon' | 'tower' | 'skill';
export interface CardDefinition {
  id: string;
  name: string;
  group: CardGroup;
  scope: CardScope;
  effect: string;
  description: string;
  iconId: string;
  value: number;
  tags: string[];
  weapon?: WeaponKind;
  element?: Element;
  maxStacks: number;
}
export interface WeaponDefinition {
  id: WeaponKind;
  name: string;
  description: string;
  damage: number;
  cooldown: number;
  range: number;
  speed: number;
  tags: string[];
  color: string;
}
export interface SynergyDefinition {
  id: string;
  name: string;
  description: string;
  requires: string[];
  effect: string;
  color: string;
  weapon?: WeaponKind;
}
export interface CardStack {
  cardId: string;
  stacks: number;
  mastery: number;
  rarity: Rarity;
  targetId?: string;
}
export interface CardOffer {
  id: string;
  cardId: string;
  rarity: Rarity;
  price: number;
  targetId?: string;
}
export interface WeaponInstance {
  id: string;
  kind: WeaponKind;
  cooldown: number;
  shotCycle: number;
  lifetimeShots: number;
  mastery: number;
  rarity: Rarity;
  infusions: Element[];
  angle: number;
  masteryRank?: number;
  masteryProgress?: number;
  masteryRequired?: number;
  fusionReady?: boolean;
  fusion?: {
    recipeId: string;
    createdAt: number;
    ingredients: [WeaponInstance, WeaponInstance];
    overflowPower?: number;
  };
}
export interface EnemyV2 extends Enemy {
  archetypeId?: import('../content/enemies').EnemyArchetypeId;
  xpBudget?: number;
  damageType: Element | 'physical';
  bounty: number;
  bossPhase: number;
  spawnWave: number;
}
export interface ProjectileV2 {
  fusionId?: string;
  id: number;
  weaponId: string;
  kind: WeaponKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  damage: number;
  radius: number;
  elements: Element[];
  pierce: number;
  bounces: number;
  homing: number;
  split: number;
  hit: number[];
  pulseTimer: number;
  pulseInterval: number;
  returning: boolean;
  originX: number;
  originY: number;
  critical: boolean;
  depth: number;
  seed: number;
  previousX: number;
  previousY: number;
}
export interface AreaEffect {
  id: number;
  kind: 'fire' | 'poison' | 'frost' | 'void' | 'meteor' | 'storm' | 'rune' | 'solar';
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  tickTimer: number;
  damage: number;
  element: Element;
  weaponId: string;
  delay: number;
  depth: number;
}
export interface VisualV2 {
  kind: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color: string;
  secondaryColor?: string;
  size: number;
  life: number;
  maxLife: number;
  text?: string;
  seed?: number;
}
export interface TimedBuff {
  id: string;
  source: string;
  stat: string;
  value: number;
  expires: number;
  stacks: number;
}
export interface DamageEvent {
  critical?: boolean;
  rootId: number;
  source: 'primary' | 'proc' | 'retaliation' | 'dot';
  depth: number;
  weaponId: string;
  damage: number;
  element: Element | 'physical';
}
export interface PendingReward {
  level?: number;
  id: string;
  kind: 'draft' | 'shop';
  wave: number;
  offers: CardOffer[];
  rerolls: number;
  repairStock: number;
}
export interface WeaponStats {
  damage: number;
  cooldown: number;
  range: number;
  speed: number;
  size: number;
  count: number;
  pierce: number;
  bounces: number;
  homing: number;
  split: number;
  life: number;
  pulse: number;
  trail: number;
  crit: number;
  critDamage: number;
  knockback: number;
  returning: boolean;
  elements: Element[];
}
export interface RunV2 {
  rulesVersion?: 3;
  mode?: 'quick' | 'normal' | 'endless';
  level?: number;
  xp?: number;
  xpRequired?: number;
  offerRng?: number;
  runeSnapshot?: Record<string, number>;
  version: 2;
  id: string;
  tower: TowerId;
  stage: number;
  difficulty: number;
  seed: number;
  rng: number;
  time: number;
  wave: number;
  waveTime: number;
  spawned: number;
  spawnTotal: number;
  spawnTimer: number;
  phase: 'combat' | 'victory' | 'ended';
  hp: number;
  maxHp: number;
  shield: number;
  scrap: number;
  kills: number;
  earned: number;
  weapons: WeaponInstance[];
  cards: CardStack[];
  enemies: EnemyV2[];
  projectiles: ProjectileV2[];
  areas: AreaEffect[];
  visuals: VisualV2[];
  buffs: TimedBuff[];
  pendingRewards: PendingReward[];
  nextId: number;
  targeting: Targeting;
  skillCd: number;
  secondaryCd: number;
  secondary: string;
  synergies: string[];
  notices: string[];
  endless: boolean;
  cleared: boolean;
  settled: boolean;
  damageByWeapon: Record<string, number>;
  damageByElement: Record<Element | 'physical', number>;
  counters: Record<string, number>;
  stats: {
    spent: number;
    shopsVisited: number;
    shopPurchases: number;
    procCount: number;
    peakEnemies: number;
    peakProjectiles: number;
    damageTaken: number;
    skillsUsed: number;
  };
  tutorialStep: number;
}
export interface WindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  docked: boolean;
}
export interface SettingsV2 extends LegacySettings {
  damageNumbers: boolean;
  uiScale: number;
  intensity: 'subtle' | 'balanced' | 'spectacular';
  shake: boolean;
  autoPauseChoices: boolean;
  windows: Record<string, WindowLayout>;
}
export interface SaveV2 {
  version: 2;
  profile: Profile;
  run: RunV2 | LegacyRun | null;
  settings: SettingsV2;
}
