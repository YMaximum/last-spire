import type { RunV2, TowerId } from './arsenal';
import type { RunV3 } from '../game/types';
import type { EvolutionPathId } from './evolution';
import { RUNE_CAPS, type RuneId } from '../game/controls';
import { TOWERS, FUSIONS } from '../content/catalog';
import { EVOLUTION_BY_ID } from '../content/evolutions';

/** Change when leaderboard balance changes; older editions remain separate boards. */
export const BALANCE_EDITION = 'spire-e1';
export const MAX_LEADERBOARD_RESULTS = 500;
export interface BoardKey {
  stage: number;
  difficulty: number;
  balanceEdition: string;
  division: 'standard' | 'quick';
}
export interface LeaderboardResult extends BoardKey {
  runId: string;
  clearedWaves: number;
  checkpointSeconds: number;
  tower: TowerId;
  evolutionPath?: EvolutionPathId;
  runes: Record<RuneId, number>;
  fusions: string[];
}
export interface PublicLeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  clearedWaves: number;
  checkpointSeconds: number;
  tower: TowerId;
  evolutionPath?: EvolutionPathId;
  runes: Record<RuneId, number>;
  fusions: string[];
}
export interface LeaderboardProfile {
  username: string | null;
  results: (LeaderboardResult & { published: boolean })[];
}
export interface LeaderboardBoard {
  entries: PublicLeaderboardEntry[];
  own: PublicLeaderboardEntry | null;
}
export interface RunLeaderboard {
  version: 1;
  balanceEdition: string;
  eligible: boolean;
  lastClearedWave: number;
  lastClearedSeconds: number;
}
const integer = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const seconds = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const obj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const maxWaves = Math.floor(Number.MAX_SAFE_INTEGER / 100);
export function isRunLeaderboard(value: unknown): value is RunLeaderboard {
  return (
    obj(value) &&
    Object.keys(value).length === 5 &&
    value.version === 1 &&
    identifier(value.balanceEdition) &&
    typeof value.eligible === 'boolean' &&
    integer(value.lastClearedWave, 0, maxWaves) &&
    seconds(value.lastClearedSeconds) &&
    (value.lastClearedWave !== 0 || value.lastClearedSeconds === 0)
  );
}
export function isLeaderboardResult(value: unknown): value is LeaderboardResult {
  if (!obj(value)) return false;
  const required = [
    'stage',
    'difficulty',
    'balanceEdition',
    'division',
    'runId',
    'clearedWaves',
    'checkpointSeconds',
    'tower',
    'runes',
    'fusions',
  ];
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !required.includes(key) && key !== 'evolutionPath')
  )
    return false;
  if (
    !integer(value.stage, 0, 2) ||
    !integer(value.difficulty, 0, 5) ||
    !identifier(value.balanceEdition) ||
    !['standard', 'quick'].includes(value.division as string) ||
    !identifier(value.runId) ||
    !integer(value.clearedWaves, 1, maxWaves) ||
    !seconds(value.checkpointSeconds) ||
    !TOWERS.some((tower) => tower.id === value.tower)
  )
    return false;
  if (
    value.evolutionPath !== undefined &&
    (!Object.hasOwn(EVOLUTION_BY_ID, value.evolutionPath as string) ||
      EVOLUTION_BY_ID[value.evolutionPath as EvolutionPathId].tower !== value.tower)
  )
    return false;
  const runes = value.runes;
  if (
    !obj(runes) ||
    Object.keys(runes).length !== Object.keys(RUNE_CAPS).length ||
    Object.keys(RUNE_CAPS).some(
      (key) =>
        !integer(
          runes[key],
          0,
          ['power', 'vitality', 'fortune'].includes(key) ? 1000 : RUNE_CAPS[key as RuneId],
        ),
    )
  )
    return false;
  return (
    Array.isArray(value.fusions) &&
    value.fusions.length <= FUSIONS.length &&
    new Set(value.fusions).size === value.fusions.length &&
    value.fusions.every(
      (id) => typeof id === 'string' && FUSIONS.some((fusion) => fusion.id === id),
    )
  );
}
export function leaderboardScore(result: Pick<LeaderboardResult, 'clearedWaves'>): number {
  return result.clearedWaves * 100;
}
/** Purely derives a publication candidate; server ownership checks remain separate. */
export function deriveLeaderboardResult(run: RunV2 | RunV3 | null): LeaderboardResult | null {
  if (!run || run.rulesVersion !== 3) return null;
  const modern = run as RunV3,
    tracking = modern.leaderboard;
  if (
    !tracking ||
    !isRunLeaderboard(tracking) ||
    !tracking.eligible ||
    modern.arsenalVersion !== 2 ||
    modern.encounterVersion !== 2 ||
    modern.shopVersion !== 2 ||
    modern.evolution?.version !== 1 ||
    tracking.balanceEdition !== BALANCE_EDITION ||
    !run.endless ||
    run.phase !== 'ended' ||
    tracking.lastClearedWave < 1 ||
    tracking.lastClearedWave >= run.wave ||
    tracking.lastClearedSeconds > run.time
  )
    return null;
  const result: LeaderboardResult = {
    runId: run.id,
    stage: run.stage,
    difficulty: run.difficulty,
    balanceEdition: tracking.balanceEdition,
    division: modern.mode === 'quick' ? 'quick' : 'standard',
    clearedWaves: tracking.lastClearedWave,
    checkpointSeconds: tracking.lastClearedSeconds,
    tower: run.tower,
    ...(modern.evolution?.path ? { evolutionPath: modern.evolution.path } : {}),
    runes: { ...modern.runeSnapshot },
    fusions: [
      ...new Set(run.weapons.flatMap((weapon) => (weapon.fusion ? [weapon.fusion.recipeId] : []))),
    ].sort(),
  };
  return isLeaderboardResult(result) ? result : null;
}
export const resultFromRun = deriveLeaderboardResult;
