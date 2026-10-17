export type Pattern = 'bolt' | 'volley' | 'spiral' | 'beam' | 'orbit' | 'pulse' | 'swarm' | 'mine';
export type Element = 'fire' | 'frost' | 'lightning' | 'poison' | 'solar' | 'void';
export type Modifier = 'echo' | 'rupture' | 'mark' | 'surge';
export type TowerId = 'bastion' | 'pyre' | 'tempest' | 'glacier' | 'verdant' | 'null' | 'monolith';
export type EnemyKind =
  'swarmer' | 'runner' | 'armored' | 'ranged' | 'support' | 'splitter' | 'elite' | 'boss';
export type Targeting = 'nearest' | 'strongest' | 'weakest';
export type Secondary = 'repair' | 'nova' | 'stasis';
export interface Attack {
  pattern: Pattern;
  element: Element;
  modifier: Modifier;
  rank: number;
  cooldown: number;
  shots: number;
}
export interface TowerDefinition {
  id: TowerId;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  cost: number;
  hp: number;
  damage: number;
  rate: number;
  pattern: Pattern;
  element: Element;
  passive: string;
  skill: string;
  skillDescription: string;
}
export interface StageDefinition {
  id: number;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  background: string;
  hazard: string;
  bosses: string[];
}
export interface SynergyDefinition {
  id: string;
  name: string;
  elements?: Element[];
  modifiers?: Modifier[];
  tower?: TowerId;
  description: string;
  color: string;
}
export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  radius: number;
  armor: number;
  attackCd: number;
  burn: number;
  poison: number;
  chill: number;
  mark: number;
  stun: number;
  vx: number;
  vy: number;
  reward: number;
}
export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
  element: Element;
  modifier: Modifier;
  pattern: Pattern;
  pierce: number;
  hit: number[];
  surge: boolean;
  targetId?: number;
}
export interface Visual {
  kind: 'hit' | 'ring' | 'beam' | 'chain' | 'text' | 'hazard' | 'synergy';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
  text?: string;
}
export interface RunState {
  version: 1;
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
  phase: 'combat' | 'draft' | 'shop' | 'victory' | 'ended';
  hp: number;
  maxHp: number;
  shield: number;
  scrap: number;
  kills: number;
  earned: number;
  attacks: Attack[];
  enemies: Enemy[];
  projectiles: Projectile[];
  visuals: Visual[];
  nextId: number;
  targeting: Targeting;
  skillCd: number;
  secondaryCd: number;
  secondary: Secondary;
  buff: number;
  stasis: number;
  rerolls: number;
  pendingShop: boolean;
  endless: boolean;
  cleared: boolean;
  settled: boolean;
  damageByElement: Record<Element, number>;
  synergies: string[];
  notices: string[];
  perks: { damage: number; rate: number; armor: number; regen: number; fortune: number };
  choices: Upgrade[];
  tutorialStep: number;
}
export interface Upgrade {
  id: string;
  kind: 'pattern' | 'element' | 'modifier' | 'rank' | 'perk' | 'secondary';
  name: string;
  description: string;
  color: string;
  slot?: number;
  value: string;
  price: number;
}
export interface Profile {
  version: 1;
  credits: number;
  unlocked: TowerId[];
  stageUnlocked: number;
  clears: number[];
  difficultyUnlocked: number;
  upgrades: { power: number; vitality: number; fortune: number };
  runs: number;
  bestWave: number;
  totalKills: number;
  settledRuns: string[];
  seenSynergies: string[];
  tutorialDone: boolean;
}
export interface Settings {
  sound: boolean;
  effects: 'high' | 'low';
  reducedMotion: boolean;
  speed: 1 | 2 | 3;
}
export interface SaveData {
  version: 1;
  profile: Profile;
  run: RunState | null;
  settings: Settings;
}
