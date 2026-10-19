// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowManager } from '../src/ui/windows';
import { AccountPanel, checkpointMarkup } from '../src/account/panel';
import { AccountSync } from '../src/account/sync';
import { emptySave } from '../src/persistence/storage';
import { snapshotFromSave } from '../src/account/snapshot';
import { AccountApi } from '../src/account/api';
import { renderGoogleButton } from '../src/account/google';
vi.mock('../src/account/google', () => ({
  renderGoogleButton: vi.fn(
    async (
      host: HTMLElement,
      _client: string,
      _nonce: string,
      callback: (proof: string) => Promise<void>,
    ) => {
      const button = document.createElement('button');
      button.textContent = 'Sign in with Google';
      button.onclick = () => {
        void callback('fixture-proof');
      };
      host.replaceChildren(button);
    },
  ),
}));
const ID = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});
function setup() {
  const panels = new Map<string, HTMLElement>();
  const manager = {
    open: vi.fn((id: string, _spec: unknown, html: string) => {
      const el = panels.get(id) ?? document.createElement('section');
      el.innerHTML = html;
      el.hidden = false;
      panels.set(id, el);
      document.body.append(el);
    }),
    has: (id: string) => panels.has(id),
    visible: (id: string) => !!panels.get(id) && !panels.get(id)!.hidden,
    element: (id: string) => panels.get(id),
    close: (id: string) => {
      panels.get(id)?.remove();
      panels.delete(id);
    },
  };
  const save = emptySave(),
    download = vi.fn(),
    pause = vi.fn();
  const sync = new AccountSync(
    {
      save: () => save,
      scope: () => 'guest',
      persist: async () => {},
      activate: async () => {},
      changed: () => {},
    },
    new AccountApi(vi.fn()),
  );
  vi.spyOn(sync.api, 'bootstrap').mockImplementation(async () => {
    const session = {
      clientId: '123-test.apps.googleusercontent.com',
      codeSignIn: true,
      csrf: 'a'.repeat(43),
      nonce: 'b'.repeat(43),
      generation: 'c'.repeat(43),
      player: null,
    };
    sync.api.session = session;
    return session;
  });
  const panel = new AccountPanel(sync, manager as unknown as WindowManager, download, pause);
  const click = (id: string) => document.querySelector<HTMLButtonElement>('#' + id)!.click();
  return { save, sync, panel, manager, download, pause, click };
}
function choices(s: ReturnType<typeof setup>) {
  s.sync.view.player = { id: ID, name: '<img src=x onerror=alert(1)>' };
  s.sync.view.phase = 'choice';
  s.sync.view.cloud = {
    generation: 'a'.repeat(43),
    revision: 1,
    updatedAt: 100,
    snapshot: snapshotFromSave(emptySave()),
    leaseHeld: true,
    leaseExpiresAt: Date.now() + 90_000,
  };
}
describe('account and checkpoint interface', () => {
  it('enables an explicit retry after a rejected active-account upload, but not while busy', () => {
    const s = setup();
    choices(s);
    vi.spyOn(s.sync, 'active', 'get').mockReturnValue(true);
    const retry = vi.spyOn(s.sync, 'sync').mockResolvedValue();
    s.sync.view.phase = 'error';
    s.sync.view.message = 'Cloud rejected the checkpoint. Retry after the service update.';
    s.panel.open();
    const button = document.querySelector<HTMLButtonElement>('#account-sync')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(retry).toHaveBeenCalledTimes(1);
    s.sync.view.busy = true;
    s.panel.update();
    expect(document.querySelector<HTMLButtonElement>('#account-sync')!.disabled).toBe(true);
  });

  it('keeps guest play clear and leaves Google unloaded during background updates', () => {
    const s = setup();
    s.panel.update();
    expect(renderGoogleButton).not.toHaveBeenCalled();
    expect(s.sync.api.bootstrap).not.toHaveBeenCalled();
    s.panel.open();
    expect(document.body.textContent).toContain('Guest play is always available');
    expect(document.body.textContent).toContain('total server or disk loss');
    expect(renderGoogleButton).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="google"]')).toBeNull();
    s.click('account-export');
    expect(s.download).toHaveBeenCalledWith(
      expect.stringContaining('"version": 6'),
      'last-spire-save.json',
    );
  });
  it('keeps an unavailable account service distinct from guest play', () => {
    const s = setup();
    choices(s);
    vi.spyOn(s.sync.host, 'scope').mockReturnValue(`account:${ID}`);
    s.sync.view.phase = 'unavailable';
    s.panel.open();
    expect(document.body.textContent).toContain('Cloud unavailable · Local');
    expect(document.body.textContent).toContain('Google connected · account progress');
  });
  it('renders untrusted names as text and previews actual progression', () => {
    const s = setup();
    choices(s);
    s.save.profile.credits = 321;
    s.panel.open();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.body.textContent).toContain('321');
    expect(document.body.textContent).toContain('Progress and credits stay separate');
    expect(checkpointMarkup(s.save, '<script>')).toContain('&lt;script&gt;');
  });
  it('requires explicit takeover before the checkpoint confirmation can run', async () => {
    const s = setup();
    choices(s);
    const choose = vi.spyOn(s.sync, 'choose').mockResolvedValue();
    s.panel.open();
    document.querySelector<HTMLButtonElement>('[data-account-source="cloud"]')!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('#confirm-account-choice')).not.toBeNull(),
    );
    const confirm = document.querySelector<HTMLButtonElement>('#confirm-account-choice')!;
    expect(confirm.disabled).toBe(true);
    expect(choose).not.toHaveBeenCalled();
    expect(s.pause).toHaveBeenCalledOnce();
    const takeover = document.querySelector<HTMLInputElement>('#account-takeover')!;
    takeover.checked = true;
    takeover.dispatchEvent(new Event('change'));
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await vi.waitFor(() =>
      expect(choose).toHaveBeenCalledWith('cloud', true, expect.stringMatching(/^[a-f0-9]{64}$/)),
    );
  });
  it('does not reopen a minimized account panel when background save status changes', () => {
    const s = setup();
    s.panel.open();
    const element = s.manager.element('account')!;
    element.hidden = true;
    s.sync.view.phase = 'offline';
    s.panel.update();
    expect(element.hidden).toBe(true);
    expect(s.manager.open).toHaveBeenCalledTimes(1);
  });
  it('requires a separate typed deletion confirmation and explains retained backups', async () => {
    const s = setup();
    choices(s);
    s.panel.open();
    const remove = vi.spyOn(s.sync, 'deleteAccount').mockResolvedValue();
    s.click('account-delete');
    const confirm = document.querySelector<HTMLButtonElement>('#confirm-account-delete')!,
      input = document.querySelector<HTMLInputElement>('#account-delete-text')!;
    expect(confirm.disabled).toBe(true);
    expect(document.body.textContent).toContain('within seven days');
    input.value = 'delete';
    input.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(true);
    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });
  it('shows one direct Google button and no preparation button', async () => {
    const s = setup();
    const signIn = vi.spyOn(s.sync, 'signIn').mockResolvedValue();
    s.panel.open();
    await vi.waitFor(() =>
      expect(document.querySelector('#google-signin-button button')).not.toBeNull(),
    );
    const buttons = [...document.querySelectorAll('button')].filter((b) =>
      /Google/.test(b.textContent!),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Sign in with Google');
    expect(document.querySelector('#account-signin')).toBeNull();
    buttons[0].click();
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledWith('fixture-proof', 'code'));
  });
  it('preserves the real button when save status changes rather than blinking or duplicating it', async () => {
    const s = setup();
    s.panel.open();
    await vi.waitFor(() =>
      expect(document.querySelector('#google-signin-button button')).not.toBeNull(),
    );
    const original = document.querySelector('#google-signin-button button');
    s.sync.view.message = 'Guest checkpoint secured.';
    s.panel.update();
    expect(document.querySelector('#google-signin-button button')).toBe(original);
    expect(renderGoogleButton).toHaveBeenCalledTimes(1);
  });
  it('keeps reauthentication and destructive controls folded away after sign-in', async () => {
    const s = setup();
    choices(s);
    s.panel.open();
    expect(renderGoogleButton).not.toHaveBeenCalled();
    const options = document.querySelector<HTMLDetailsElement>('.account-google-options')!;
    expect(options.open).toBe(false);
    expect(document.querySelector<HTMLDetailsElement>('.account-delete-options')!.open).toBe(false);
    options.open = true;
    options.dispatchEvent(new Event('toggle'));
    await vi.waitFor(() => expect(renderGoogleButton).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('#google-signin-button')).toHaveLength(1);
  });
});
