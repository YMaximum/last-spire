import type { TowerId } from './shared';

export type EvolutionPathId =
  | 'citadel'
  | 'vanguard'
  | 'furnace'
  | 'crownflare'
  | 'stormweaver'
  | 'thunderhead'
  | 'winterhold'
  | 'shatterspire'
  | 'rootwarden'
  | 'blightbloom'
  | 'event-horizon'
  | 'rift-engine'
  | 'mirror-regent'
  | 'ironbriar';
export type EvolutionTier = 0 | 1 | 2 | 3;
export interface EvolutionState {
  version: 1;
  /** Original core ID, retained in a fused descendant's ingredient provenance. */
  coreId: string;
  path?: EvolutionPathId;
  tier: EvolutionTier;
  pending: EvolutionTier;
}
export interface EvolutionBonuses {
  coreDamage?: number;
  coreRate?: number;
  coreRange?: number;
  corePierce?: number;
  coreCount?: number;
  shieldCapacity?: number;
  shieldRegen?: number;
  healthRegen?: number;
  mitigation?: number;
  globalDamage?: number;
  skillCooldown?: number;
}
export interface EvolutionUpgrade {
  name: string;
  description: string;
  /** Incremental: selected tiers add together once. */
  bonuses: EvolutionBonuses;
}
export interface EvolutionPath {
  id: EvolutionPathId;
  tower: TowerId;
  name: string;
  color: string;
  coreName: string;
  signatureName: string;
  identity: string;
  tiers: [EvolutionUpgrade, EvolutionUpgrade, EvolutionUpgrade];
}
