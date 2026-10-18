import './style.css';
import type { AccountSession } from './api';
import type { Player } from './cache';
import { renderGoogleButton } from './google';

interface EntryActions {
  session(): Promise<AccountSession>;
  remembered(): Promise<Player | null>;
  guest(): void;
  signIn(code: string): Promise<void>;
  continueAccount(): Promise<void>;
}

/** The landing choice never replaces or uploads either save branch. */
export class EntryScreen {
  private dialog: HTMLDialogElement | null = null;
  private cleanup: (() => void) | null = null;
  private busy = false;
  get visible() {
    return !!this.dialog?.open;
  }
  constructor(private actions: EntryActions) {}
  open() {
    if (this.dialog) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'spire-entry';
    dialog.setAttribute('aria-labelledby', 'entry-title');
    dialog.innerHTML = `<div class="entry-intro"><span class="entry-kicker">THE RUNEFORGED AGE</span><svg class="entry-spire" viewBox="0 0 160 180" fill="none" aria-hidden="true"><path class="entry-ring" d="M80 7 145 45v75l-65 38-65-38V45Z"/><path d="m80 23 50 29v58l-50 29-50-29V52Z"/><path d="m80 38-19 32 8 9-15 55h52L91 79l8-9-19-32ZM61 70h38M69 79h22M54 134l-12 13h76l-12-13M80 23v15M30 81h25M105 81h25"/><path class="entry-core" d="m80 61-9 16 9 16 9-16-9-16Z"/><path d="M70 118h20M75 107h10M80 147v18M59 158l-8 8M101 158l8 8"/></svg><h1 id="entry-title">LAST SPIRE</h1><p>One spire. A thousand ways to fight.</p></div><div class="entry-choices"><span class="entry-kicker">CHOOSE HOW TO PLAY</span><h2>Carry the light onward.</h2><p>Your next expedition is waiting.</p><button type="button" class="gold-button entry-guest" autofocus>Play as guest <span aria-hidden="true">→</span></button><p class="entry-caption">Continue your browser save. No account needed.</p><div class="entry-divider"><span>OR</span></div><div class="google-signin-shell"><div class="entry-google google-signin-slot"><span class="google-loading">Checking Google sign-in…</span></div></div><p class="entry-caption">Carry your progress between devices.<br>You choose which checkpoint to use after signing in.</p><div class="entry-remembered" hidden><button type="button" class="outline-button entry-continue"></button><p class="entry-caption">Open the account checkpoint kept on this device.</p></div><p class="entry-error" role="status"></p><footer>Guest and account saves stay separate. <a href="/privacy.html" target="_blank" rel="noopener">Privacy & saves ↗</a></footer></div>`;
    this.dialog = dialog;
    document.body.append(dialog);
    dialog.showModal();
    const guest = dialog.querySelector<HTMLButtonElement>('.entry-guest')!;
    guest.onclick = () => {
      if (!this.busy) {
        this.close();
        this.actions.guest();
      }
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      guest.click();
    });
    dialog.querySelector<HTMLButtonElement>('.entry-continue')!.onclick = () => {
      void this.act(dialog, () => this.actions.continueAccount());
    };
    void this.prepare(dialog);
    void this.actions
      .remembered()
      .then((player) => {
        if (!player || this.dialog !== dialog) return;
        dialog.querySelector<HTMLButtonElement>('.entry-continue')!.textContent =
          `Continue as ${player.name}`;
        dialog.querySelector<HTMLElement>('.entry-remembered')!.hidden = false;
      })
      .catch(() => {});
  }
  private async prepare(dialog: HTMLDialogElement) {
    const host = dialog.querySelector<HTMLElement>('.entry-google')!;
    try {
      const session = await this.actions.session();
      if (this.dialog !== dialog) return;
      const cleanup = await renderGoogleButton(
        host,
        session.clientId,
        session.nonce,
        (code) => this.act(dialog, () => this.actions.signIn(code)),
        session.codeSignIn === true,
      );
      if (this.dialog === dialog) this.cleanup = cleanup;
      else cleanup();
    } catch {
      if (this.dialog === dialog) {
        const cleanup = await renderGoogleButton(host, '', '', async () => {}, false);
        if (this.dialog !== dialog) {
          cleanup();
          return;
        }
        this.cleanup = cleanup;
        const hint =
          host.querySelector<HTMLElement>('.google-button-message') ?? document.createElement('p');
        hint.className = 'google-button-message';
        hint.textContent = 'Google sign-in is unavailable. Your browser save is ready to play.';
        host.append(hint);
      }
    }
  }
  private async act(dialog: HTMLDialogElement, action: () => Promise<void>) {
    if (this.busy || this.dialog !== dialog) return;
    this.busy = true;
    dialog
      .querySelectorAll<HTMLButtonElement>('.entry-guest,.entry-continue')
      .forEach((button) => (button.disabled = true));
    try {
      await action();
      if (this.dialog === dialog) this.close();
    } catch {
      if (this.dialog === dialog) {
        dialog.querySelector<HTMLElement>('.entry-error')!.textContent =
          'Could not open account progress. Try again or play as guest; your saves are unchanged.';
        dialog
          .querySelectorAll<HTMLButtonElement>('.entry-guest,.entry-continue')
          .forEach((button) => (button.disabled = false));
      }
    } finally {
      this.busy = false;
    }
  }
  close() {
    this.cleanup?.();
    this.cleanup = null;
    this.dialog?.close();
    this.dialog?.remove();
    this.dialog = null;
  }
}
