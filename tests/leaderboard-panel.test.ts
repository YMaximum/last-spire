// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardClient } from '../src/account/leaderboard';
import { SyncError } from '../src/account/api';
import { BALANCE_EDITION, type LeaderboardResult } from '../src/model/leaderboard';
import { defaultRuneLoadout } from '../src/game/controls';
import { emptySave } from '../src/persistence/storage';
import {
  LeaderboardPanel,
  publicEntryMarkup,
  publicationPreview,
} from '../src/ui/leaderboard-panel';
import type { WindowManager } from '../src/ui/windows';

const result: LeaderboardResult = {
  runId: 'finished-run',
  stage: 0,
  difficulty: 0,
  balanceEdition: BALANCE_EDITION,
  division: 'standard',
  clearedWaves: 160,
  checkpointSeconds: 6000.25,
  tower: 'bastion',
  runes: defaultRuneLoadout().selected,
  fusions: [],
};
const {
  runId: _run,
  stage: _stage,
  difficulty: _difficulty,
  balanceEdition: _edition,
  division: _division,
  ...publicResult
} = result;
const entry = { ...publicResult, rank: 1, username: 'BrassSpire', score: 16000 };
afterEach(() => document.body.replaceChildren());

function setup(signedIn = true) {
  let identity: string | null = signedIn ? 'synthetic-account' : null,
    published = false;
  const save = emptySave();
  save.progression.leaderboardResults = [structuredClone(result)];
  const root = document.createElement('div');
  document.body.append(root);
  const open = vi.fn((_id: string, _spec: unknown, html: string) => {
    root.innerHTML = html;
  });
  const manager = { open, has: () => true, element: () => root } as unknown as WindowManager;
  const request = vi.fn(async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    if (path.startsWith('leaderboard?')) return { entries: [entry], own: signedIn ? entry : null };
    if (path === 'leaderboard/profile')
      return { username: 'BrassSpire', results: [{ ...result, published }] };
    if (path === 'leaderboard/publish') {
      published = true;
      return { published: true };
    }
    if (path === 'leaderboard/entry') {
      published = false;
      return { withdrawn: true };
    }
    throw new Error(`Unexpected request: ${method} ${path} ${JSON.stringify(body)}`);
  });
  const prepare = vi.fn(async () => {}),
    account = vi.fn();
  const panel = new LeaderboardPanel(manager, new LeaderboardClient({ request }), {
    save: () => save,
    identity: () => identity,
    prepare,
    account,
  });
  const click = (id: string) => root.querySelector<HTMLButtonElement>('#' + id)!.click();
  const ready = () => vi.waitFor(() => expect(root.textContent).not.toContain('Working…'));
  return {
    panel,
    root,
    open,
    request,
    prepare,
    account,
    click,
    ready,
    setIdentity: (id: string | null) => (identity = id),
    save,
  };
}

describe('Endless publication interface', () => {
  it('marks a lost publication response as uncertain and refreshes authoritative status before retrying', async () => {
    const s = setup();
    s.panel.open(result.runId);
    await s.ready();
    const original = s.request.getMockImplementation()!;
    s.request.mockImplementation(async (path, method, body) => {
      const value = await original(path, method, body);
      if (path === 'leaderboard/publish') throw new SyncError('offline');
      return value;
    });
    s.click('leaderboard-review');
    s.click('leaderboard-confirm');
    await s.ready();
    expect(s.root.textContent).toContain('Publication could already have succeeded');
    expect(s.root.textContent).toContain('Publication unconfirmed');
    s.click('leaderboard-refresh-results');
    await s.ready();
    expect(s.root.querySelector('#leaderboard-withdraw')).not.toBeNull();
    expect(s.root.textContent).not.toContain('Publication unconfirmed');
  });
  it('requires a separate result preview and final confirmation; reading and cancelling never publish', async () => {
    const s = setup();
    s.panel.open(result.runId);
    await s.ready();
    expect(s.root.textContent).toContain('Public score preview');
    expect(s.root.textContent).toContain('BrassSpire');
    expect(s.request.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
    expect(s.open.mock.calls[0][1]).not.toHaveProperty('choice', true);
    s.click('leaderboard-review');
    s.click('leaderboard-cancel');
    expect(s.prepare).not.toHaveBeenCalled();
    s.click('leaderboard-review');
    s.click('leaderboard-confirm');
    await s.ready();
    expect(s.prepare).toHaveBeenCalledOnce();
    expect(s.request).toHaveBeenCalledWith('leaderboard/publish', 'POST', {
      runId: result.runId,
      confirmation: 'PUBLISH',
      expectedUsername: 'BrassSpire',
    });
    expect(s.root.textContent).toContain('Score published');
    s.click('leaderboard-withdraw');
    await s.ready();
    expect(s.request).toHaveBeenCalledWith('leaderboard/entry', 'DELETE', { runId: result.runId });
    expect(s.root.textContent).toContain('Entry withdrawn');
  });
  it('lets guests browse and retain results without publishing or copying account identity', async () => {
    const s = setup(false);
    s.panel.open(result.runId);
    await s.ready();
    expect(s.root.textContent).toContain('Guests keep personal records');
    expect(s.root.querySelector('#leaderboard-confirm')).toBeNull();
    expect(s.request.mock.calls.some(([path]) => path === 'leaderboard/profile')).toBe(false);
    s.click('leaderboard-account');
    expect(s.account).toHaveBeenCalledOnce();
  });
  it('does not submit after the account changes while preparing a cloud checkpoint', async () => {
    const s = setup();
    s.panel.open(result.runId);
    await s.ready();
    s.prepare.mockImplementation(async () => {
      s.setIdentity('different-account');
    });
    s.click('leaderboard-review');
    s.click('leaderboard-confirm');
    await vi.waitFor(() => expect(s.prepare).toHaveBeenCalledOnce());
    expect(s.request.mock.calls.some(([path]) => path === 'leaderboard/publish')).toBe(false);
  });
  it('preserves private results and allows another explicit attempt after a publication failure', async () => {
    const s = setup();
    s.panel.open(result.runId);
    await s.ready();
    s.prepare.mockRejectedValueOnce(new SyncError('offline'));
    s.click('leaderboard-review');
    s.click('leaderboard-confirm');
    await s.ready();
    expect(s.save.progression.leaderboardResults).toHaveLength(1);
    expect(s.root.textContent).toContain('local progress and rewards are safe');
    expect(s.request.mock.calls.some(([path]) => path === 'leaderboard/publish')).toBe(false);
    s.click('leaderboard-review');
    s.click('leaderboard-confirm');
    await s.ready();
    expect(s.root.textContent).toContain('Score published');
  });
});

describe('bounded leaderboard responses and text rendering', () => {
  it('rejects oversized boards, arbitrary scores, private IDs, and invalid profile receipts', async () => {
    for (const value of [
      { entries: Array(101).fill(entry), own: null },
      { entries: [{ ...entry, score: 1 }], own: null },
      { entries: [{ ...entry, userId: 'private' }], own: null },
      { entries: [{ ...entry, runId: 'private' }], own: null },
    ]) {
      const client = new LeaderboardClient({ request: async () => value });
      await expect(
        client.board({
          stage: 0,
          difficulty: 0,
          balanceEdition: BALANCE_EDITION,
          division: 'standard',
        }),
      ).rejects.toThrow('invalid_response');
    }
    await expect(
      new LeaderboardClient({
        request: async () => ({
          username: 'Valid_Name',
          results: [{ ...result, checkpointSeconds: Infinity, published: false }],
        }),
      }).profile(),
    ).rejects.toThrow('invalid_response');
  });
  it('renders public usernames as text even when directly supplied hostile input', () => {
    document.body.innerHTML = publicEntryMarkup({
      ...entry,
      username: '<img src=x onerror=alert(1)>',
    });
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    document.body.innerHTML = publicationPreview(result, '<script>bad</script>');
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).toContain('16,000');
  });
});
