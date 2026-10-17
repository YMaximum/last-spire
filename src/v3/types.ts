import type { RunV2 } from '../v2/types';
import type { RuneId } from './controls';
export type * from '../v2/types';
export type RunMode = 'quick' | 'normal' | 'endless';
export interface RunV3 extends RunV2 {
  rulesVersion: 3;
  mode: RunMode;
  level: number;
  xp: number;
  xpRequired: number;
  offerRng: number;
  runeSnapshot: Record<RuneId, number>;
}
export interface RunOptions {
  mode?: RunMode;
  runes?: Partial<Record<RuneId, number>>;
}
export const MASTERY_THRESHOLDS = [0, 60, 180, 360, 600, 900] as const;
