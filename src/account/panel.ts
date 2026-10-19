import './style.css';
import type { WindowManager } from '../ui/windows';
import { emptySave, exportGame, loadGame, readRawSave, type SaveV3 } from '../persistence/storage';
import { saveFromSnapshot, snapshotFromSave } from './snapshot';
import { fingerprint, readRecovery } from './cache';
import { AccountSync, scopeFor, type CheckpointSource } from './sync';
import { renderGoogleButton } from './google';

const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const vault =
  '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 3 7 13v22l17 10 17-10V13L24 3Z"/><path d="m24 10-11 7v14l11 7 11-7V17l-11-7ZM24 10v28M13 17l22 14M35 17 13 31"/><path class="vault-core" d="m24 17-6 7 6 7 6-7-6-7Z"/></svg>';
export function checkpointMarkup(save: SaveV3, label: string, compact = false): string {
  const s = save.profile,
    r = save.run;
  return `<article class="account-checkpoint"><h3>${esc(label)}</h3><dl><div><dt>Credits</dt><dd>${s.credits.toLocaleString()}</dd></div><div><dt>Towers</dt><dd>${s.unlocked.length}</dd></div>${compact ? '' : `<div><dt>Best wave</dt><dd>${s.bestWave}</dd></div><div><dt>Finished runs</dt><dd>${s.runs}</dd></div>`}</dl><p>${r ? `${esc(r.tower)} · Wave ${r.wave} · ${esc(r.phase)}${r.settled ? ' · rewards settled' : ' · rewards retained'}` : 'No active expedition'}</p>${!compact && r && 'pendingRewards' in r ? `<small>${r.pendingRewards.length} queued choices · RNG and active build included</small>` : ''}</article>`;
}
const titles: Record<string, string> = {
  guest: 'Guest · Local',
  checking: 'Checking cloud',
  choice: 'Choose progress',
  synced: 'Cloud saved',
  local: 'Cloud pending',
  offline: 'Offline · Local',
  conflict: 'Compare saves',
  lease: 'Continue here?',
  reauth: 'Sign in again',
  unavailable: 'Guest · Local',
  error: 'Save needs attention',
};
const statusTitle = (sync: AccountSync) =>
  sync.active && sync.view.phase === 'unavailable'
    ? 'Cloud unavailable · Local'
    : titles[sync.view.phase];
export class AccountPanel {
  private renderKey = '';
  private googleNonces = new WeakMap<HTMLElement, string>();
  private googleCleanup: (() => void) | null = null;
  constructor(
    readonly sync: AccountSync,
    private manager: WindowManager,
    private download: (text: string, name: string) => void,
    private pause: () => void,
  ) {}
  update() {
    const button = document.getElementById('account-btn');
    if (button) {
      button.querySelector('span')!.textContent = statusTitle(this.sync);
      button.dataset.status = this.sync.view.phase;
      button.title = this.sync.view.message;
    }
    if (this.manager.visible('account')) {
      const key = JSON.stringify([
        this.sync.view.phase,
        this.sync.view.busy,
        this.sync.view.message,
        this.sync.view.player?.id,
        this.sync.view.cloud?.revision,
        this.sync.active,
      ]);
      if (key !== this.renderKey) this.render();
    }
  }
  open() {
    this.render();
  }
  private render() {
    const { view } = this.sync,
      active = this.sync.active;
    const busy = view.busy ? 'disabled' : '';
    const syncDisabled =
      view.busy || !['synced', 'local', 'offline'].includes(view.phase) ? 'disabled' : '';
    const needsSignIn = !view.player || view.phase === 'reauth';
    const previousGoogle = this.manager
      .element('account')
      ?.querySelector<HTMLElement>('#google-signin-button');
    this.renderKey = JSON.stringify([
      view.phase,
      view.busy,
      view.message,
      view.player?.id,
      view.cloud?.revision,
      active,
    ]);
    const canCompare = !!view.cloud && !!view.player;
    const cloud = view.cloud?.snapshot
      ? saveFromSnapshot(view.cloud.snapshot, this.sync.host.save().settings)
      : null;
    const googleSlot = `<div class="google-signin-shell" ${view.busy ? 'inert' : ''}><div id="google-signin-button" class="google-signin-slot"><span class="google-loading" role="status">Preparing secure sign-in…</span></div></div>`;
    const current = this.sync.host.save();
    const compare = canCompare
      ? `<div class="account-compare-intro"><p>Choose a checkpoint. Progress and credits stay separate.</p></div><div class="account-checkpoints">
      <div class="account-branch">${checkpointMarkup(current, active ? 'This device' : 'This browser', true)}<button data-account-source="${active ? 'local' : 'guest'}" class="${active ? 'outline-button' : 'gold-button'}">${active ? 'Review device progress' : 'Use browser progress'}</button></div>
      ${!active && view.cached ? `<div class="account-branch">${checkpointMarkup(view.cached, 'Account on this device', true)}<button data-account-source="local" class="outline-button">Review cached progress</button></div>` : ''}
      <div class="account-branch">${cloud ? `${checkpointMarkup(cloud, 'In the cloud', true)}<button data-account-source="cloud" class="outline-button">Review cloud progress</button>` : `<article class="account-checkpoint account-empty-cloud"><span class="account-empty-rune" aria-hidden="true">◇</span><h3>A new beginning</h3><p>No cloud save yet.<br>Keep your browser progress, or start a new account save.</p></article><button data-account-source="fresh" class="outline-button">Start fresh</button>`}</div></div>`
      : '';
    const showCompare = ['choice', 'conflict', 'lease', 'error'].includes(view.phase);
    const statusMessage = view.phase === 'choice' ? '' : view.message;
    const html = `<div class="account-vault ${needsSignIn ? '' : 'account-vault-connected'}"><div class="account-emblem">${vault}</div><div>${needsSignIn ? '<span class="account-eyebrow">KEEP THE LIGHT WITH YOU</span>' : ''}<h3>${needsSignIn ? 'Your journey, carried onward.' : esc(view.player!.name)}</h3><p>${needsSignIn ? 'Keep your unlocks and expedition across devices.' : `Google connected · ${active ? 'account progress' : 'playing as guest'}`}</p></div></div>
      <div class="account-status" data-phase="${view.phase}" role="status"><div class="account-status-line"><span class="account-status-light" aria-hidden="true"></span><b>${statusTitle(this.sync)}</b>${view.lastSynced ? `<small>${esc(new Date(view.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small>` : ''}</div>${statusMessage ? `<p>${esc(statusMessage)}</p>` : ''}</div>
      ${needsSignIn ? `<section class="account-auth">${googleSlot}<p class="account-hint">Guest play is always available. Choose what to copy after signing in.</p></section>` : ''}
      ${active && !showCompare ? `<div class="account-current"><div><small>Credits</small><b>${current.profile.credits.toLocaleString()}</b></div><div><small>Towers</small><b>${current.profile.unlocked.length}</b></div><div><small>Expedition</small><b>${current.run ? 'Wave ' + current.run.wave : 'At the spire'}</b></div></div>` : ''}
      ${compare ? (showCompare ? `<section class="account-comparison">${compare}</section>` : `<details class="account-details"><summary>Compare checkpoints</summary><div class="account-details-content">${compare}</div></details>`) : ''}
      <p id="account-inline-error" role="alert"></p>
      <div class="account-quick-actions">${active ? `<button id="account-sync" class="gold-button" ${syncDisabled}>Sync now</button>` : ''}<button id="account-export" class="outline-button">Export backup</button><button id="account-refresh" class="account-text-button" ${busy}>Check connection</button></div>
      ${view.player ? `<details class="account-details"><summary>Account & recovery</summary><div class="account-details-content"><div class="account-option-grid"><button id="account-history" class="outline-button" ${busy}>Recovery checkpoints</button><button id="account-raw" class="outline-button">Raw local export</button><button id="account-guest" class="outline-button" ${busy}>Play as guest</button><button id="account-logout" class="outline-button" ${busy}>Sign out</button></div>${!needsSignIn ? `<details class="account-google-options"><summary>Change account or verify again</summary><p class="account-hint">Use Google to choose another account or verify a sensitive action.</p>${googleSlot}</details>` : ''}<details class="account-delete-options"><summary>Delete game account</summary><p class="account-hint">Export anything you want to keep. A recent Google sign-in is required.</p><button id="account-delete" class="outline-button danger-text" ${busy}>Delete account…</button></details></div></details>` : ''}
      <details class="account-details account-save-help"><summary>How your saves work</summary><div class="account-details-content"><p>Guest and account saves stay separate. Signing out keeps unsynced account progress in this browser.</p><p>Graphics, audio, window layouts, and gameplay logs stay on this device. Cloud saves include your build, queued choices, and active expedition.</p><p>Keep an export. Server recovery copies do not protect against total server or disk loss.</p><p>Opening this panel prepares Google’s sign-in control. No password, Gmail, or Drive access is requested.</p></div></details>
      <footer class="account-footer"><span>YOUR PROGRESS · YOUR CHOICE</span><a href="/privacy.html" target="_blank" rel="noopener">Privacy & saves ↗</a></footer>`;
    this.manager.open(
      'account',
      {
        title: 'Continuity vault',
        subtitle: 'ACCOUNT & SAVES',
        width: 620,
        height: 700,
        onClose: () => {
          this.googleCleanup?.();
          this.googleCleanup = null;
        },
      },
      html,
    );
    const el = this.manager.element('account')!;
    const newGoogle = el.querySelector<HTMLElement>('#google-signin-button');
    if (newGoogle && previousGoogle) newGoogle.replaceWith(previousGoogle);
    const bind = (id: string, fn: () => Promise<void> | void) =>
      el.querySelector<HTMLElement>('#' + id)?.addEventListener('click', () => {
        void Promise.resolve(fn()).catch((e) => this.error(e));
      });
    bind('account-refresh', () => this.sync.refresh());
    bind('account-sync', () => this.sync.sync());
    bind('account-export', () =>
      this.download(exportGame(this.sync.host.save()), 'last-spire-save.json'),
    );
    bind('account-history', () => this.history());
    bind('account-raw', async () => {
      if (!this.sync.view.player) return;
      const raw = await readRawSave(scopeFor(this.sync.view.player));
      if (raw === undefined) throw new Error('No local account checkpoint is stored here.');
      this.download(JSON.stringify(raw, null, 2), 'last-spire-account-raw-recovery.json');
    });
    bind('account-guest', () => this.confirmSignOut(false));
    bind('account-logout', () => this.confirmSignOut(true));
    bind('account-delete', () => this.confirmDelete());
    el.querySelectorAll<HTMLButtonElement>('[data-account-source]').forEach((b) => {
      b.disabled = view.busy;
      b.onclick = () => {
        void this.review(b.dataset.accountSource as CheckpointSource).catch((e) => this.error(e));
      };
    });
    el.querySelector<HTMLDetailsElement>('.account-google-options')?.addEventListener(
      'toggle',
      (e) => {
        if ((e.target as HTMLDetailsElement).open) void this.prepareGoogle();
      },
    );
    if (needsSignIn && !view.busy && !['unavailable', 'offline'].includes(view.phase))
      void this.prepareGoogle();
    else if (needsSignIn && ['unavailable', 'offline'].includes(view.phase)) {
      const slot = el.querySelector<HTMLElement>('#google-signin-button')!;
      slot.textContent = 'Sign-in is unavailable. Check connection to try again.';
    }
  }
  private error(e: unknown) {
    const el = this.manager.element('account')?.querySelector('#account-inline-error');
    if (el)
      el.textContent =
        e instanceof Error
          ? e.message
          : 'Account action could not complete. Export your local save.';
  }
  private async prepareGoogle() {
    const host = this.manager
      .element('account')
      ?.querySelector<HTMLElement>('#google-signin-button');
    if (!host || host.dataset.loading === 'true') return;
    if (
      host.dataset.ready === 'true' &&
      this.googleNonces.get(host) ===
        `${this.sync.api.session?.nonce}:${this.sync.api.session?.codeSignIn === true}`
    )
      return;
    delete host.dataset.ready;
    host.dataset.loading = 'true';
    try {
      const session = await this.sync.api.bootstrap();
      if (!host.isConnected) return;
      this.googleNonces.set(host, `${session.nonce}:${session.codeSignIn === true}`);
      this.googleCleanup?.();
      this.googleCleanup = null;
      const cleanup = await renderGoogleButton(
        host,
        session.clientId,
        session.nonce,
        async (credential) => {
          if (!host.isConnected) return;
          // A consumed nonce must be replaced before this control can be reused.
          delete host.dataset.ready;
          await this.sync.signIn(credential, 'code');
          this.update();
        },
        session.codeSignIn === true,
      );
      if (host.isConnected) {
        host.dataset.ready = host.dataset.googleRetry === 'true' ? 'false' : 'true';
        this.googleCleanup = cleanup ?? null;
      } else cleanup?.();
    } catch {
      if (host.isConnected)
        host.textContent = 'Sign-in is unavailable. Check connection to try again.';
    } finally {
      delete host.dataset.loading;
    }
  }
  private async review(source: CheckpointSource) {
    this.pause();
    const v = this.sync.view;
    let save: SaveV3;
    if (source === 'cloud')
      save = saveFromSnapshot(v.cloud!.snapshot, this.sync.host.save().settings);
    else if (source === 'local') save = this.sync.active ? this.sync.host.save() : v.cached!;
    else if (source === 'guest')
      save = this.sync.host.scope() === 'guest' ? this.sync.host.save() : await loadGame();
    else save = emptySave();
    const hash = await fingerprint(snapshotFromSave(save));
    const takeover = !!v.cloud?.leaseHeld && !this.sync.hasLease;
    this.manager.open(
      'account-choice',
      {
        title: 'Continue with this progress?',
        subtitle: 'REVIEW CHECKPOINT',
        width: 580,
        height: 620,
        choice: true,
      },
      `${checkpointMarkup(save, source === 'cloud' ? 'Cloud checkpoint' : source === 'guest' ? 'Copy of guest progress' : source === 'fresh' ? 'Fresh account' : 'Cached account progress')}<p>${source === 'cloud' ? 'This loads the cloud checkpoint. A local account recovery copy is kept before replacement.' : 'This becomes the account’s cloud checkpoint, replacing any cloud progress shown in the comparison. No credits or rewards are merged.'} Your original guest save is unchanged.</p>${takeover ? '<label class="account-takeover"><input id="account-takeover" type="checkbox"> Continue on this device. Another device will stop uploading and must review its local branch.</label>' : ''}<div class="account-actions"><button id="cancel-account-choice" class="outline-button">Cancel</button><button id="confirm-account-choice" class="gold-button" ${takeover ? 'disabled' : ''}>${source === 'cloud' ? 'Load cloud checkpoint' : 'Use this progress in cloud'}</button></div><p class="quiet">Combat is paused for review. Keep it paused until this choice completes.</p>`,
    );
    const el = this.manager.element('account-choice')!,
      confirm = el.querySelector<HTMLButtonElement>('#confirm-account-choice')!;
    el.querySelector('#cancel-account-choice')!.addEventListener('click', () =>
      this.manager.close('account-choice'),
    );
    el.querySelector<HTMLInputElement>('#account-takeover')?.addEventListener('change', (e) => {
      confirm.disabled = !(e.target as HTMLInputElement).checked;
    });
    confirm.onclick = async () => {
      confirm.disabled = true;
      await this.sync.choose(source, takeover, hash);
      this.manager.close('account-choice');
      this.open();
    };
  }
  private confirmSignOut(signOut: boolean) {
    this.pause();
    this.manager.open(
      'account-exit',
      {
        title: signOut ? 'Sign out of Last Spire?' : 'Return to guest progress?',
        subtitle: 'ACCOUNT CHECKPOINT KEPT',
        width: 520,
        height: 400,
        choice: true,
      },
      `<p>Account progress remains in its separate browser cache, including unsynced changes. Your original guest save will reopen. ${signOut ? 'This revokes this browser session; it does not sign you out of Google.' : 'The Google session stays signed in, but guest play does not upload to it.'}</p><div class="account-actions"><button id="cancel-account-exit" class="outline-button">Cancel</button><button id="confirm-account-exit" class="gold-button">${signOut ? 'Sign out' : 'Play as guest'}</button></div>`,
    );
    this.manager
      .element('account-exit')!
      .querySelector('#cancel-account-exit')!
      .addEventListener('click', () => this.manager.close('account-exit'));
    this.manager
      .element('account-exit')!
      .querySelector('#confirm-account-exit')!
      .addEventListener('click', () => {
        void this.sync.returnToGuest(signOut).then(() => {
          window.google?.accounts.id?.disableAutoSelect();
          this.manager.close('account-exit');
          this.open();
        });
      });
  }
  private confirmDelete() {
    this.pause();
    this.manager.open(
      'account-delete',
      {
        title: 'Delete this game account?',
        subtitle: 'PERMANENT CLOUD DATA DELETION',
        width: 550,
        height: 560,
        choice: true,
      },
      '<p>This permanently removes the account, cloud checkpoints, and all its sign-in sessions. This browser’s account cache and local recovery copies are removed. Guest progress is kept. Server backup copies are not live data and expire within seven days. An operator must honor account deletions during any earlier backup restore.</p><p>Export any progress you want to keep. Deletion requires a Google sign-in within the last ten minutes.</p><label>Type DELETE<input id="account-delete-text" autocomplete="off" spellcheck="false"></label><div class="account-actions"><button id="cancel-account-delete" class="outline-button">Cancel</button><button id="confirm-account-delete" class="outline-button danger-text" disabled>Delete account and cloud saves</button></div>',
    );
    const el = this.manager.element('account-delete')!,
      confirm = el.querySelector<HTMLButtonElement>('#confirm-account-delete')!;
    el.querySelector('#cancel-account-delete')!.addEventListener('click', () =>
      this.manager.close('account-delete'),
    );
    el.querySelector<HTMLInputElement>('#account-delete-text')!.oninput = (e) => {
      confirm.disabled = (e.target as HTMLInputElement).value !== 'DELETE';
    };
    confirm.onclick = async () => {
      confirm.disabled = true;
      await this.sync.deleteAccount();
      this.manager.close('account-delete');
      this.open();
    };
  }
  private async history() {
    const player = this.sync.view.player;
    if (!player) return;
    const local = await readRecovery(player.id);
    let cloud: { revision: number; updatedAt: number }[] = [],
      warning = '';
    try {
      cloud = await this.sync.api.history();
    } catch {
      warning = 'Cloud history is unavailable. Local exports still work.';
    }
    this.manager.open(
      'account-history',
      {
        title: 'Recover a previous light.',
        subtitle: 'EXPORT · REVIEW · IMPORT',
        width: 610,
        height: 610,
      },
      `<p>Download a checkpoint, then use Settings → Import to review it. Imported account progress still uses conflict checks before syncing.</p><p role="status">${warning}</p><h3>Local recovery copies</h3>${local.length ? local.map((r, i) => `<div class="account-history-row"><span>${esc(r.reason)}<small>${esc(new Date(r.at).toLocaleString())}</small></span><button data-local-history="${i}" class="outline-button">Export</button></div>`).join('') : '<p>No local replacements have needed recovery.</p>'}<h3>Previous cloud revisions</h3>${cloud.length ? cloud.map((r) => `<div class="account-history-row"><span>Revision ${r.revision}<small>${esc(new Date(r.updatedAt).toLocaleString())}</small></span><button data-cloud-history="${r.revision}" class="outline-button">Export</button></div>`).join('') : '<p>No cloud history is available.</p>'}<p class="quiet">At most five prior revisions and five local recovery copies are retained per account. These copies share their device or server’s failure risks.</p><p id="history-error" role="alert"></p>`,
    );
    const el = this.manager.element('account-history')!;
    el.querySelectorAll<HTMLButtonElement>('[data-local-history]').forEach((b) => {
      b.onclick = () =>
        this.download(
          exportGame(local[Number(b.dataset.localHistory)].save),
          'last-spire-local-recovery.json',
        );
    });
    el.querySelectorAll<HTMLButtonElement>('[data-cloud-history]').forEach((b) => {
      b.onclick = async () => {
        try {
          const snapshot = await this.sync.api.historical(Number(b.dataset.cloudHistory));
          this.download(
            exportGame(saveFromSnapshot(snapshot, this.sync.host.save().settings)),
            'last-spire-cloud-recovery.json',
          );
        } catch {
          el.querySelector('#history-error')!.textContent =
            'Cloud recovery could not be downloaded. Retry after checking your account session.';
        }
      };
    });
  }
}
