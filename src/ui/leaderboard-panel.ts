import { TOWERS, FUSION_BY_ID } from '../content/catalog';
import { STAGES } from '../content/world';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import { difficultyName } from '../game/stage-progress';
import { LeaderboardClient } from '../account/leaderboard';
import { SyncError } from '../account/api';
import {
  BALANCE_EDITION,
  leaderboardScore,
  type BoardKey,
  type LeaderboardResult,
  type LeaderboardProfile,
  type LeaderboardBoard,
  type PublicLeaderboardEntry,
} from '../model/leaderboard';
import type { SaveV3 } from '../persistence/storage';
import type { WindowManager } from './windows';

const esc = (v: string | number) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const runeNames: Record<string, string> = {
  power: 'Power',
  vitality: 'Vitality',
  fortune: 'Fortune',
  experience: 'Experience',
  choices: 'Draft choices',
  autoSignature: 'Signature autocast',
  autoSecondary: 'Secondary autocast',
};
export function checkpointTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(2)}s`;
}
export function resultLoadout(
  result: Pick<LeaderboardResult, 'tower' | 'evolutionPath' | 'runes' | 'fusions'>,
): string {
  const tower = TOWERS.find((t) => t.id === result.tower)!.name;
  const evolution = result.evolutionPath
    ? EVOLUTION_BY_ID[result.evolutionPath].name
    : 'No evolution';
  const runes =
    Object.entries(result.runes)
      .filter(([, level]) => level > 0)
      .map(([id, level]) => `${runeNames[id]} ${level}`)
      .join(' · ') || 'No runes';
  const fusions = result.fusions.map((id) => FUSION_BY_ID[id].name).join(' · ') || 'No fusions';
  return `<p class="leaderboard-loadout">${esc(tower)} · ${esc(evolution)}<br>${esc(runes)}<br>${esc(fusions)}</p>`;
}
export function publicEntryMarkup(entry: PublicLeaderboardEntry, own = false): string {
  return `<article class="leaderboard-entry ${own ? 'leaderboard-own' : ''}"><header><strong>#${entry.rank} · ${esc(entry.username)}</strong><b>${entry.score.toLocaleString()} points</b></header><p>${entry.clearedWaves.toLocaleString()} cleared waves · ${checkpointTime(entry.checkpointSeconds)} to last clear</p><details><summary>Inspect loadout</summary>${resultLoadout(entry)}</details></article>`;
}
export function publicationPreview(result: LeaderboardResult, username: string): string {
  return `<section class="publication-preview" aria-label="Public score preview"><h3 id="leaderboard-preview-heading" tabindex="-1">Public score preview</h3><strong>${esc(username)} · ${leaderboardScore(result).toLocaleString()} points</strong><p>${esc(STAGES[result.stage].name)} · ${esc(difficultyName(result.difficulty))}<br>${result.division === 'quick' ? 'Quick' : 'Standard'} · ${esc(result.balanceEdition)}</p><p>${result.clearedWaves.toLocaleString()} fully cleared waves · ${checkpointTime(result.checkpointSeconds)} to last clear</p>${resultLoadout(result)}<p class="quiet">Only the information above will be public. Your Google identity, full save, and gameplay logs are not included. You can withdraw the entry later.</p></section>`;
}
interface Host {
  save(): SaveV3;
  identity(): string | null;
  account(): void;
  /** Persist and sync without replacing checkpoints; throw if the account is not ready. */
  prepare(): Promise<void>;
}
const messages: Record<string, string> = {
  invalid_username:
    'Use 3–20 ASCII letters, digits, or underscores. Some system names are reserved.',
  username_changed:
    'Your public username changed elsewhere. Refresh and review the result again before publishing.',
  checkpoint_not_synced:
    'Cloud sync needs attention. Open Account & cloud saves, resolve it, then retry publication.',
  storage_unavailable: 'Local storage needs attention. Export your checkpoint before continuing.',
  username_taken: 'That username is already in use. Choose another.',
  reserved_username: 'That username is reserved. Choose another.',
  username_required: 'Choose a public username before publishing.',
  result_not_found: 'This result is not in your cloud checkpoint yet. Sync it, then retry.',
  ineligible_result:
    'This result cannot be published. Historical and imported records remain personal.',
  unauthenticated: 'Sign in and activate your account checkpoint before publishing.',
  session_changed: 'Your account changed. Reopen rankings from the active account.',
  rate_limited: 'Too many requests. Please wait a minute before refreshing.',
  offline: 'Rankings could not be reached. Your local progress and rewards are safe.',
  service_unavailable: 'Rankings are not available on this server yet. Local play is unaffected.',
  invalid_response: 'The ranking response could not be validated. Your save was not changed.',
};

export class LeaderboardPanel {
  private key: BoardKey = {
    stage: 0,
    difficulty: 0,
    balanceEdition: BALANCE_EDITION,
    division: 'standard',
  };
  private board: LeaderboardBoard | null = null;
  private profile: LeaderboardProfile | null = null;
  private tab: 'board' | 'personal' = 'board';
  private selected = '';
  private visibleResults = 20;
  private uncertainResult = '';
  private confirmation = false;
  private busy = false;
  private message = '';
  private error = false;
  private ticket = 0;
  constructor(
    private manager: WindowManager,
    private client: LeaderboardClient,
    private host: Host,
  ) {}

  open(runId?: string) {
    ++this.ticket;
    this.busy = false;
    this.board = null;
    this.profile = null;
    this.message = '';
    this.confirmation = false;
    this.selected = runId ?? '';
    this.uncertainResult = '';
    this.visibleResults = 20;
    this.tab = runId ? 'personal' : 'board';
    const result = this.host.save().progression.leaderboardResults.find((r) => r.runId === runId);
    if (result)
      this.key = {
        stage: result.stage,
        difficulty: result.difficulty,
        balanceEdition: result.balanceEdition,
        division: result.division,
      };
    else if (this.host.save().run) {
      const run = this.host.save().run!;
      this.key = {
        ...this.key,
        stage: run.stage,
        difficulty: run.difficulty,
        division: run.version === 2 && run.mode === 'quick' ? 'quick' : 'standard',
      };
    }
    this.render();
    void this.refresh();
  }
  private localResults(): LeaderboardResult[] {
    return this.host.save().progression.leaderboardResults;
  }
  private results(): (LeaderboardResult & { published: boolean })[] {
    const results = new Map(this.localResults().map((r) => [r.runId, { ...r, published: false }]));
    for (const result of this.profile?.results ?? []) results.set(result.runId, result);
    return [...results.values()].reverse();
  }
  private valid(ticket: number, identity: string | null) {
    return (
      ticket === this.ticket && identity === this.host.identity() && this.manager.has('leaderboard')
    );
  }
  private async task(work: () => Promise<string | void>) {
    if (this.busy) return;
    const ticket = ++this.ticket,
      identity = this.host.identity();
    this.busy = true;
    this.error = false;
    this.message = 'Working…';
    this.render();
    try {
      const message = await work();
      if (!this.valid(ticket, identity)) return;
      this.message = message || 'Updated.';
    } catch (e) {
      if (!this.valid(ticket, identity)) return;
      const code = e instanceof SyncError ? e.code : '';
      this.error = true;
      this.message =
        messages[code] ??
        'The request could not be completed. Your rewards and local checkpoint are safe; refresh or retry.';
      if (this.uncertainResult)
        this.message +=
          ' Publication could already have succeeded. Refresh result status before retrying.';
    } finally {
      if (this.valid(ticket, identity)) {
        this.busy = false;
        this.render();
      }
    }
  }
  private async refresh() {
    await this.task(async () => {
      const identity = this.host.identity(),
        ticket = this.ticket;
      const board = await this.client.board(this.key);
      const profile = identity ? await this.client.profile() : null;
      if (!this.valid(ticket, identity)) return;
      this.board = board;
      this.profile = profile;
      this.uncertainResult = '';
      return 'Rankings refreshed. No automatic polling.';
    });
  }
  private render() {
    const identity = this.host.identity(),
      disabled = this.busy ? 'disabled' : '';
    const results = this.results();
    const selected = results.find((r) => r.runId === this.selected);
    const editions = [
      ...new Set([
        BALANCE_EDITION,
        this.key.balanceEdition,
        ...results.map((r) => r.balanceEdition),
      ]),
    ];
    const own = identity ? this.board?.own : null;
    const boardMarkup = this.board
      ? `${own ? `<h3>Your rank on this board</h3>${publicEntryMarkup(own, true)}` : ''}<h3>Top 100</h3>${this.board.entries.map((e) => publicEntryMarkup(e)).join('') || '<p>No published scores on this board yet.</p>'}`
      : '<p>Refresh to load this board.</p>';
    const personal = `<p>${identity ? 'Choose a separate public username. Changing it also renames your published entries.' : 'Guests keep personal records and can browse every public board. Sign in and choose your account checkpoint to publish.'}</p>${identity ? `<details ${this.profile?.username ? '' : 'open'}><summary>Public username${this.profile?.username ? ` · ${esc(this.profile.username)}` : ' · choose a name'}</summary><form id="leaderboard-username-form"><label>Public username<input id="leaderboard-username" autocomplete="off" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" required value="${esc(this.profile?.username ?? '')}" ${disabled}></label><small>3–20 ASCII letters, digits, or underscores. Your Google name is never filled in.</small><button class="outline-button" ${disabled}>Save public username</button></form></details><button id="leaderboard-refresh-results" class="outline-button" ${disabled}>Refresh result status</button><button id="leaderboard-sync" class="outline-button" ${disabled}>Sync completed results</button>` : '<button id="leaderboard-account" class="gold-button">Account & cloud saves</button>'}${selected ? `${publicationPreview(selected, this.profile?.username ?? 'Choose a username')} ${selected.published ? `<button id="leaderboard-withdraw" class="outline-button full" ${disabled || !identity ? 'disabled' : ''}>Withdraw this entry</button>` : identity && this.profile?.username ? (this.confirmation ? `<p class="notice">Confirm publication of this result as ${esc(this.profile.username)}. It will be visible to everyone on the selected result’s board.</p><button id="leaderboard-confirm" class="gold-button full" ${disabled}>Publish this score</button><button id="leaderboard-cancel" class="outline-button full" ${disabled}>${selected.runId === this.uncertainResult ? 'Cancel retry' : 'Keep private'}</button>` : `<button id="leaderboard-review" class="gold-button full" ${disabled}>Publish score…</button>`) : '<p>Sign in and save a public username before publishing. This result stays private.</p>'}` : ''}<h3>Completed Endless results</h3><p class="quiet">Only eligible runs started with ranking support can be published. Publishing is optional and never affects earned credits.</p>${
      results
        .slice(0, this.visibleResults)
        .map(
          (result) =>
            `<article class="leaderboard-entry"><strong>${leaderboardScore(result).toLocaleString()} points · ${esc(STAGES[result.stage].name)}</strong><p>${result.clearedWaves} cleared waves · ${checkpointTime(result.checkpointSeconds)} · ${result.division === 'quick' ? 'Quick' : 'Standard'}<br>${esc(difficultyName(result.difficulty))} · ${esc(result.balanceEdition)}</p><button class="outline-button" data-result="${esc(result.runId)}" ${disabled}>${result.published ? 'Review published entry' : 'Review score'}</button><small class="leaderboard-result-status">${identity && !this.profile ? 'Status unavailable · refresh result status' : result.runId === this.uncertainResult ? 'Publication unconfirmed · refresh status' : result.published ? 'Published best · withdrawal available' : 'Private · not published'}</small></article>`,
        )
        .join('') ||
      '<p>No eligible completed Endless results yet. Start an Endless expedition, or continue past a campaign victory, then retire or reach defeat.</p>'
    }${results.length > this.visibleResults ? `<button id="leaderboard-more" class="outline-button full" ${disabled}>Show 20 more results</button>` : ''}<details class="leaderboard-history"><summary>Earlier personal expedition records</summary><p class="quiet">Wave reached includes partial waves. These records do not receive public scores.</p>${
      this.host
        .save()
        .progression.records.slice(-20)
        .reverse()
        .map(
          (r) =>
            `<p>${esc(STAGES[r.stage].name)} · ${esc(difficultyName(r.difficulty))} · ${esc(r.mode)} · wave ${r.wave} reached · ${checkpointTime(r.seconds)}</p>`,
        )
        .join('') || '<p>No earlier records.</p>'
    }</details>`;
    this.manager.open(
      'leaderboard',
      {
        title: 'The Endless ledger',
        subtitle: 'CASUAL · CLIENT-REPORTED',
        width: 800,
        height: 780,
      },
      `<div class="leaderboard-panel"><p class="lead">Every completed wave leaves a mark.</p><p class="quiet">Casual · client-reported. No prizes or replay verification.</p><details><summary>How scoring & privacy work</summary><p>100 points per fully cleared wave. Ties use simulation time to the last clear; exact ties share a rank. Partial waves, kills, pauses, and playback speed add no points.</p><p>Only results you explicitly publish appear publicly, under a separately chosen username. Google identities, full saves, and private logs are excluded.</p></details><div class="leaderboard-tabs"><button id="leaderboard-board-tab" class="outline-button" aria-pressed="${this.tab === 'board'}">Rankings</button><button id="leaderboard-personal-tab" class="outline-button" aria-pressed="${this.tab === 'personal'}">My results & username</button></div><p role="status" class="${this.error ? 'warning' : 'quiet'}">${esc(this.message)}</p>${this.tab === 'board' ? `<div class="leaderboard-filters"><label>Stage<select id="leaderboard-stage" ${disabled}>${STAGES.map((stage, i) => `<option value="${i}" ${this.key.stage === i ? 'selected' : ''}>${esc(stage.name)}</option>`).join('')}</select></label><label>Difficulty<select id="leaderboard-difficulty" ${disabled}>${Array.from({ length: 6 }, (_, i) => `<option value="${i}" ${this.key.difficulty === i ? 'selected' : ''}>${esc(difficultyName(i))}</option>`).join('')}</select></label><label>Pace<select id="leaderboard-division" ${disabled}><option value="standard" ${this.key.division === 'standard' ? 'selected' : ''}>Standard · Normal / Endless</option><option value="quick" ${this.key.division === 'quick' ? 'selected' : ''}>Quick → Endless</option></select></label><label>Balance edition<select id="leaderboard-edition" ${disabled}>${editions.map((edition) => `<option ${edition === this.key.balanceEdition ? 'selected' : ''}>${esc(edition)}</option>`).join('')}</select></label></div><button id="leaderboard-refresh" class="gold-button full" ${disabled}>Refresh rankings</button>${boardMarkup}` : personal}</div>`,
    );
    const panel = this.manager.element('leaderboard')!;
    const bind = (id: string, handler: () => void) => {
      const button = panel.querySelector<HTMLButtonElement>('#' + id);
      if (button) button.onclick = handler;
    };
    bind('leaderboard-board-tab', () => {
      this.tab = 'board';
      this.confirmation = false;
      this.render();
    });
    bind('leaderboard-personal-tab', () => {
      this.tab = 'personal';
      this.render();
    });
    bind('leaderboard-refresh', () => void this.refresh());
    bind('leaderboard-refresh-results', () => void this.refresh());
    for (const [id, key] of [
      ['stage', 'stage'],
      ['difficulty', 'difficulty'],
      ['division', 'division'],
      ['edition', 'balanceEdition'],
    ] as const) {
      const select = panel.querySelector<HTMLSelectElement>('#leaderboard-' + id);
      if (select)
        select.onchange = () => {
          this.key = {
            ...this.key,
            [key]: key === 'stage' || key === 'difficulty' ? Number(select.value) : select.value,
          };
          this.board = null;
          this.message = 'Board changed. Refresh rankings to load it.';
          this.render();
        };
    }
    bind('leaderboard-account', () => this.host.account());
    bind('leaderboard-more', () => {
      this.visibleResults += 20;
      this.render();
    });
    panel
      .querySelector<HTMLFormElement>('#leaderboard-username-form')
      ?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = panel.querySelector<HTMLInputElement>('#leaderboard-username')!.value;
        void this.task(async () => {
          const identity = this.host.identity(),
            ticket = this.ticket;
          await this.client.setUsername(name);
          const profile = await this.client.profile();
          if (this.valid(ticket, identity)) this.profile = profile;
          this.confirmation = false;
          return 'Public username saved. Scores stay private until you publish each result.';
        });
      });
    panel.querySelectorAll<HTMLButtonElement>('[data-result]').forEach(
      (b) =>
        (b.onclick = () => {
          this.selected = b.dataset.result!;
          this.confirmation = false;
          this.render();
          this.manager
            .element('leaderboard')
            ?.querySelector<HTMLElement>('#leaderboard-preview-heading')
            ?.focus();
        }),
    );
    bind(
      'leaderboard-sync',
      () =>
        void this.task(async () => {
          const identity = this.host.identity(),
            ticket = this.ticket;
          await this.host.prepare();
          const profile = await this.client.profile();
          if (this.valid(ticket, identity)) this.profile = profile;
          return 'Completed results synced. Nothing was published.';
        }),
    );
    bind('leaderboard-review', () => {
      this.confirmation = true;
      this.render();
    });
    bind('leaderboard-cancel', () => {
      this.confirmation = false;
      this.message = this.uncertainResult === this.selected
        ? 'No retry sent. Publication is still unconfirmed; refresh result status.'
        : 'Result kept private.';
      this.render();
    });
    bind('leaderboard-confirm', () => {
      if (!selected || !identity || !this.confirmation) return;
      const id = selected.runId,
        previewUsername = this.profile!.username!;
      this.confirmation = false;
      void this.task(async () => {
        const actor = this.host.identity(),
          ticket = this.ticket;
        await this.host.prepare();
        if (!this.valid(ticket, actor)) throw new SyncError('session_changed');
        let published: boolean;
        try {
          published = await this.client.publish(id, previewUsername);
        } catch (e) {
          if (
            this.valid(ticket, actor) &&
            (!(e instanceof SyncError) || e.status === 0 || e.status >= 500)
          )
            this.uncertainResult = id;
          throw e;
        }
        if (this.valid(ticket, actor)) {
          this.uncertainResult = '';
          if (published) {
            const previous = (this.profile?.results ?? [])
              .filter((r) => r.runId !== id)
              .map((r) =>
                r.stage === selected.stage &&
                r.difficulty === selected.difficulty &&
                r.balanceEdition === selected.balanceEdition &&
                r.division === selected.division
                  ? { ...r, published: false }
                  : r,
              );
            this.profile = {
              username: previewUsername,
              results: [...previous, { ...selected, published: true }],
            };
          }
          this.board = null;
        }
        return published
          ? 'Score published. Refresh rankings to see the current board.'
          : 'Your existing best result is stronger or tied; it remains on the board.';
      });
    });
    bind('leaderboard-withdraw', () => {
      if (!selected || !identity) return;
      const id = selected.runId;
      void this.task(async () => {
        const actor = this.host.identity(),
          ticket = this.ticket;
        await this.client.withdraw(id);
        if (this.valid(ticket, actor)) {
          if (this.profile)
            this.profile = {
              ...this.profile,
              results: this.profile.results.map((r) =>
                r.runId === id ? { ...r, published: false } : r,
              ),
            };
          this.board = null;
        }
        return 'Entry withdrawn. No other result was automatically published.';
      });
    });
  }
}
