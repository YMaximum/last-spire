import type { DatabaseSync } from 'node:sqlite';
import type { CloudSnapshot } from '../src/account/snapshot';
import {
  BALANCE_EDITION,
  deriveLeaderboardResult,
  isLeaderboardResult,
  type BoardKey,
  type LeaderboardResult,
} from '../src/model/leaderboard';
import { requireApi } from './errors';

const RESERVED = new Set([
  'admin',
  'administrator',
  'moderator',
  'system',
  'support',
  'lastspire',
  'last_spire',
  'official',
  'null',
  'undefined',
  'deleted',
  'anonymous',
]);
const BOARD = 'stage=? AND difficulty=? AND balanceEdition=? AND division=?';
const params = (board: BoardKey) =>
  [board.stage, board.difficulty, board.balanceEdition, board.division] as const;
const stronger = (a: LeaderboardResult, b: LeaderboardResult) =>
  a.clearedWaves > b.clearedWaves ||
  (a.clearedWaves === b.clearedWaves && a.checkpointSeconds < b.checkpointSeconds);

export function parseBoard(query: URLSearchParams): BoardKey {
  requireApi(
    [...query.keys()].length === 4 &&
      ['stage', 'difficulty', 'balanceEdition', 'division'].every(
        (k) => query.getAll(k).length === 1,
      ),
    400,
    'invalid_board',
  );
  const stage = query.get('stage')!,
    difficulty = query.get('difficulty')!;
  requireApi(/^[0-9]$/.test(stage) && /^[0-5]$/.test(difficulty), 400, 'invalid_board');
  const board = {
    stage: Number(stage),
    difficulty: Number(difficulty),
    balanceEdition: query.get('balanceEdition')!,
    division: query.get('division')!,
  };
  requireApi(
    board.stage <= 2 &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(board.balanceEdition) &&
      ['standard', 'quick'].includes(board.division),
    400,
    'invalid_board',
  );
  return board as BoardKey;
}

function publicResult(result: LeaderboardResult, username: string, rank: number) {
  return {
    rank,
    username,
    score: 100 * result.clearedWaves,
    clearedWaves: result.clearedWaves,
    checkpointSeconds: result.checkpointSeconds,
    tower: result.tower,
    ...(result.evolutionPath ? { evolutionPath: result.evolutionPath } : {}),
    runes: result.runes,
    fusions: result.fusions,
  };
}

/** Client-reported casual results. Ownership protects publication, not gameplay integrity. */
export class LeaderboardStore {
  constructor(
    private db: DatabaseSync,
    private ensureSpace: () => void,
  ) {}
  migrate() {
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE leaderboard_profiles (userId TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        username TEXT NOT NULL, usernameKey TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 20)) STRICT;
      CREATE TABLE leaderboard_results (userId TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        runId TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(userId,runId)) STRICT;
      CREATE TABLE leaderboard_entries (userId TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        stage INTEGER NOT NULL, difficulty INTEGER NOT NULL, balanceEdition TEXT NOT NULL,
        division TEXT NOT NULL CHECK(division IN ('standard','quick')), runId TEXT NOT NULL,
        clearedWaves INTEGER NOT NULL CHECK(clearedWaves>=0), checkpointSeconds REAL NOT NULL CHECK(checkpointSeconds>=0),
        PRIMARY KEY(userId,stage,difficulty,balanceEdition,division),
        FOREIGN KEY(userId,runId) REFERENCES leaderboard_results(userId,runId) ON DELETE CASCADE) STRICT;
      CREATE INDEX leaderboard_order ON leaderboard_entries(stage,difficulty,balanceEdition,division,clearedWaves DESC,checkpointSeconds ASC);
      PRAGMA user_version=2; COMMIT;`);
  }
  retain(userId: string, snapshot: CloudSnapshot) {
    const completed = deriveLeaderboardResult(
      snapshot.run && 'rulesVersion' in snapshot.run ? snapshot.run : null,
    );
    const results = [...snapshot.progression.leaderboardResults, ...(completed ? [completed] : [])];
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO leaderboard_results(userId,runId,payload) VALUES (?,?,?)',
    );
    for (const result of results) {
      if (isLeaderboardResult(result) && result.balanceEdition === BALANCE_EDITION)
        insert.run(userId, result.runId, JSON.stringify(result));
    }
    // Keep bounded retry receipts plus the entries currently public. A checkpoint never publishes.
    this.db
      .prepare(
        `DELETE FROM leaderboard_results WHERE userId=? AND runId NOT IN
      (SELECT runId FROM leaderboard_results WHERE userId=? ORDER BY rowid DESC LIMIT 500)
      AND runId NOT IN (SELECT runId FROM leaderboard_entries WHERE userId=?)`,
      )
      .run(userId, userId, userId);
  }
  profile(userId: string) {
    const profile = this.db
      .prepare('SELECT username FROM leaderboard_profiles WHERE userId=?')
      .get(userId);
    const rows = this.db
      .prepare(
        `SELECT r.payload, EXISTS(SELECT 1 FROM leaderboard_entries e WHERE e.userId=r.userId AND e.runId=r.runId) AS published
      FROM leaderboard_results r WHERE r.userId=? ORDER BY published DESC,r.rowid DESC LIMIT 500`,
      )
      .all(userId);
    return {
      username: profile ? String(profile.username) : null,
      results: rows.map((row) => ({
        ...(JSON.parse(String(row.payload)) as LeaderboardResult),
        published: !!row.published,
      })),
    };
  }
  setUsername(userId: string, value: unknown) {
    requireApi(
      typeof value === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(value),
      400,
      'invalid_username',
    );
    const key = value.toLowerCase();
    requireApi(!RESERVED.has(key), 400, 'reserved_username');
    requireApi(
      !this.db
        .prepare('SELECT userId FROM leaderboard_profiles WHERE usernameKey=? AND userId<>?')
        .get(key, userId),
      409,
      'username_taken',
    );
    this.ensureSpace();
    this.db
      .prepare(
        `INSERT INTO leaderboard_profiles VALUES (?,?,?) ON CONFLICT(userId) DO UPDATE SET username=excluded.username,usernameKey=excluded.usernameKey`,
      )
      .run(userId, value, key);
    return { username: value };
  }
  publish(userId: string, runId: string, expectedUsername: string) {
    const profile = this.db
      .prepare('SELECT username FROM leaderboard_profiles WHERE userId=?')
      .get(userId);
    requireApi(profile, 409, 'username_required');
    requireApi(profile.username === expectedUsername, 409, 'username_changed');
    const receipt = this.db
      .prepare('SELECT payload FROM leaderboard_results WHERE userId=? AND runId=?')
      .get(userId, runId);
    requireApi(receipt, 404, 'result_not_found');
    const result = JSON.parse(String(receipt.payload)) as LeaderboardResult;
    requireApi(isLeaderboardResult(result), 409, 'invalid_result');
    const current = this.db
      .prepare(
        `SELECT r.payload FROM leaderboard_entries e JOIN leaderboard_results r ON r.userId=e.userId AND r.runId=e.runId WHERE e.userId=? AND e.${BOARD.replaceAll(' AND ', ' AND e.')}`,
      )
      .get(userId, ...params(result));
    if (current) {
      const previous = JSON.parse(String(current.payload)) as LeaderboardResult;
      if (previous.runId === runId) return { published: true };
      if (!stronger(result, previous)) return { published: false };
    }
    this.ensureSpace();
    this.db
      .prepare(
        `INSERT INTO leaderboard_entries VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(userId,stage,difficulty,balanceEdition,division) DO UPDATE SET runId=excluded.runId,clearedWaves=excluded.clearedWaves,checkpointSeconds=excluded.checkpointSeconds`,
      )
      .run(userId, ...params(result), result.runId, result.clearedWaves, result.checkpointSeconds);
    return { published: true };
  }
  withdraw(userId: string, runId: string) {
    this.db
      .prepare('DELETE FROM leaderboard_entries WHERE userId=? AND runId=?')
      .run(userId, runId);
    return { withdrawn: true };
  }
  board(board: BoardKey, userId?: string) {
    // RANK shares exact wave/time ties; username only stabilizes their display order.
    const query = `WITH ranked AS (SELECT e.userId,r.payload,p.username,
      RANK() OVER (ORDER BY e.clearedWaves DESC,e.checkpointSeconds ASC) AS rank
      FROM leaderboard_entries e JOIN leaderboard_profiles p ON p.userId=e.userId
      JOIN leaderboard_results r ON r.userId=e.userId AND r.runId=e.runId
      WHERE e.${BOARD.replaceAll(' AND ', ' AND e.')})`;
    const convert = (row: Record<string, unknown>) =>
      publicResult(
        JSON.parse(String(row.payload)) as LeaderboardResult,
        String(row.username),
        Number(row.rank),
      );
    const entries = this.db
      .prepare(query + ' SELECT * FROM ranked ORDER BY rank,username COLLATE NOCASE LIMIT 100')
      .all(...params(board))
      .map(convert);
    const own = userId
      ? this.db
          .prepare(query + ' SELECT * FROM ranked WHERE userId=?')
          .get(...params(board), userId)
      : undefined;
    return { entries, own: own ? convert(own) : null };
  }
}
