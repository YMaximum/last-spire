import type { RunV2 } from '../model/arsenal';
import type { RuneId } from './controls';
export type * from '../model/arsenal';
export type RunMode = 'quick' | 'normal' | 'endless';
export interface RunV3 extends RunV2 {
  rulesVersion: 3;
  leaderboard?: import('../model/leaderboard').RunLeaderboard;
  evolution?: import('../model/evolution').EvolutionState;
  /** Absent on recovered runs, whose original 30% repair remains unchanged. */
  shopVersion?: 2;
  encounterVersion?: 2;
  /** Expanded arsenal applies only to expeditions started under these rules. */
  arsenalVersion?: 2;
  discoveries?: import('../content/enemies').BestiaryRecords;
  mode: RunMode;
  level: number;
  xp: number;
  xpRequired: number;
  offerRng: number;
  runeSnapshot: Record<RuneId, number>;
}
export interface RunOptions {
  leaderboard?: boolean;
  evolutionVersion?: 0 | 1;
  encounterVersion?: 1 | 2;
  arsenalVersion?: 1 | 2;
  shopVersion?: 1 | 2;
  mode?: RunMode;
  runes?: Partial<Record<RuneId, number>>;
}
export const MASTERY_THRESHOLDS = [0, 60, 180, 360, 600, 900] as const;
export interface FusionPreview {
  name: string;
  description: string;
  ingredients: string[];
  summary: string;
  inherited: string[];
  conversions: string[];
  awaken: string[];
  lost: string[];
}
