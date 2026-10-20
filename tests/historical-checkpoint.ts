/** Build pre-leaderboard fixtures without backporting new tracking or receipts. */
export function historicalCheckpoint<T extends { run?: unknown; progression?: unknown }>(
  checkpoint: T,
): T {
  const run = checkpoint.run as Record<string, unknown> | null | undefined;
  if (run) delete run.leaderboard;
  const progression = checkpoint.progression as Record<string, unknown> | undefined;
  if (progression) delete progression.leaderboardResults;
  return checkpoint;
}
