import { SyncError, type AccountApi } from './api';
import {
  BALANCE_EDITION,
  isLeaderboardResult,
  leaderboardScore,
  type BoardKey,
  type LeaderboardBoard,
  type LeaderboardProfile,
  type PublicLeaderboardEntry,
} from '../model/leaderboard';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const username = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(v);
function invalid(): never {
  throw new SyncError('invalid_response');
}
function publicEntry(v: unknown): v is PublicLeaderboardEntry {
  if (
    !object(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          'rank',
          'username',
          'score',
          'clearedWaves',
          'checkpointSeconds',
          'tower',
          'evolutionPath',
          'runes',
          'fusions',
        ].includes(k),
    ) ||
    !Number.isSafeInteger(v.rank) ||
    Number(v.rank) < 1 ||
    !username(v.username)
  )
    return false;
  const { rank: _rank, username: _name, score, ...rest } = v;
  const result = {
    ...rest,
    runId: 'public-row',
    stage: 0,
    difficulty: 0,
    balanceEdition: BALANCE_EDITION,
    division: 'standard',
  };
  return isLeaderboardResult(result) && score === leaderboardScore(result);
}

/** Bounded response validation complements server-side ownership and score checks. */
export class LeaderboardClient {
  constructor(private api: Pick<AccountApi, 'request'>) {}
  async board(key: BoardKey): Promise<LeaderboardBoard> {
    const query = new URLSearchParams({
      stage: String(key.stage),
      difficulty: String(key.difficulty),
      balanceEdition: key.balanceEdition,
      division: key.division,
    });
    const value = await this.api.request(`leaderboard?${query}`);
    if (
      !object(value) ||
      !Array.isArray(value.entries) ||
      value.entries.length > 100 ||
      !value.entries.every(publicEntry) ||
      (value.own !== null && !publicEntry(value.own))
    )
      invalid();
    return value as unknown as LeaderboardBoard;
  }
  async profile(): Promise<LeaderboardProfile> {
    const value = await this.api.request('leaderboard/profile');
    if (
      !object(value) ||
      (value.username !== null && !username(value.username)) ||
      !Array.isArray(value.results) ||
      value.results.length > 500
    )
      invalid();
    for (const result of value.results) {
      if (!object(result)) invalid();
      const { published, ...rest } = result;
      if (typeof published !== 'boolean' || !isLeaderboardResult(rest)) invalid();
    }
    return value as unknown as LeaderboardProfile;
  }
  async setUsername(name: string): Promise<void> {
    if (!username(name)) throw new SyncError('invalid_username');
    const value = await this.api.request('leaderboard/profile', 'PUT', { username: name });
    if (!object(value) || value.username !== name) invalid();
  }
  async publish(runId: string, expectedUsername: string): Promise<boolean> {
    const value = await this.api.request('leaderboard/publish', 'POST', {
      runId,
      confirmation: 'PUBLISH',
      expectedUsername,
    });
    if (!object(value) || typeof value.published !== 'boolean') invalid();
    return value.published;
  }
  async withdraw(runId: string): Promise<void> {
    const value = await this.api.request('leaderboard/entry', 'DELETE', { runId });
    if (!object(value) || value.withdrawn !== true) invalid();
  }
}
