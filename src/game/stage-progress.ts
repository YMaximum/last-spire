import type { Profile } from '../model/shared';

export interface StageProgress {
  unlockedDifficulty: number;
  clearedDifficulties: number[];
  /** Older profiles recorded a stage clear without its difficulty. */
  legacyClear: boolean;
}
export const STAGE_COUNT = 3;
export const MAX_ASCENSION = 5;
export const difficultyName = (difficulty: number) =>
  difficulty === 0 ? 'Normal' : `Ascension ${difficulty}`;

export function freshStageProgress(): StageProgress[] {
  return Array.from({ length: STAGE_COUNT }, () => ({
    unlockedDifficulty: 0,
    clearedDifficulties: [],
    legacyClear: false,
  }));
}

/** Grandfather access only on stages unlocked before this migration. */
export function migrateStageProgress(
  profile: Profile,
  records: { stage: number; difficulty: number; cleared: boolean }[] = [],
): StageProgress[] {
  return freshStageProgress().map((entry, stage) => ({
    ...entry,
    unlockedDifficulty: Math.max(
      stage < profile.stageUnlocked ? profile.difficultyUnlocked : 0,
      ...records
        .filter((r) => r.stage === stage && r.cleared)
        .map((r) => Math.min(MAX_ASCENSION, r.difficulty + 1)),
    ),
    clearedDifficulties: [
      ...new Set(
        records
          .filter((r) => r.stage === stage && r.cleared && r.difficulty <= MAX_ASCENSION)
          .map((r) => r.difficulty),
      ),
    ].sort((a, b) => a - b),
    legacyClear:
      profile.clears.includes(stage) ||
      records.some((r) => r.stage === stage && r.cleared && r.difficulty > MAX_ASCENSION),
  }));
}

/** Shared by immediate campaign clears and transactional settlement; idempotent. */
export function recordStageClear(
  profile: Profile,
  stages: StageProgress[],
  run: { stage: number; difficulty: number; cleared: boolean },
): void {
  if (!run.cleared) return;
  const entry = stages[run.stage];
  if (!entry) throw new Error('Unknown stage progression.');
  if (run.difficulty <= MAX_ASCENSION)
    entry.clearedDifficulties = [...new Set([...entry.clearedDifficulties, run.difficulty])].sort(
      (a, b) => a - b,
    );
  else entry.legacyClear = true; // Older run validators also admitted internal tiers 6–10.
  entry.unlockedDifficulty = Math.max(
    entry.unlockedDifficulty,
    Math.min(MAX_ASCENSION, run.difficulty + 1),
  );
  profile.clears = [...new Set([...profile.clears, run.stage])].sort((a, b) => a - b);
  profile.stageUnlocked = Math.max(profile.stageUnlocked, Math.min(STAGE_COUNT, run.stage + 2));
  // Retain the old aggregate for legacy tooling; never use it to authorize a new run.
  profile.difficultyUnlocked = Math.max(profile.difficultyUnlocked, entry.unlockedDifficulty);
}
