// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryScreen } from '../src/account/entry';
import { renderGoogleButton } from '../src/account/google';
import { AccountApi } from '../src/account/api';
vi.mock('../src/account/google', () => ({
  renderGoogleButton: vi.fn(
    async (
      host: HTMLElement,
      _id: string,
      _nonce: string,
      callback: (code: string) => Promise<void>,
      enabled: boolean,
    ) => {
      const button = document.createElement('button');
      button.textContent = 'Continue with Google';
      button.disabled = !enabled;
      button.onclick = () => {
        void callback('fixture-code');
      };
      host.replaceChildren(button);
      return vi.fn();
    },
  ),
}));
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const session = {
  clientId: '123-test.apps.googleusercontent.com',
  csrf: 'a'.repeat(43),
  nonce: 'b'.repeat(43),
  generation: 'c'.repeat(43),
  player: null,
  codeSignIn: true,
};
function setup(overrides: Record<string, unknown> = {}) {
  const actions = {
    session: vi.fn(async () => session),
    remembered: vi.fn(async () => null),
    guest: vi.fn(),
    signIn: vi.fn(async (_code: string) => {}),
    continueAccount: vi.fn(async () => {}),
    ...overrides,
  };
  const entry = new EntryScreen(actions);
  return {
    actions,
    entry,
    guest: () => document.querySelector<HTMLButtonElement>('.entry-guest')!,
    google: () => document.querySelector<HTMLButtonElement>('.entry-google button')!,
  };
}
describe('page-entry choice', () => {
  it('makes guest play immediately available without waiting for Google or activating an account', async () => {
    let finish!: (s: typeof session) => void;
    const s = setup({ session: vi.fn(() => new Promise<typeof session>((r) => (finish = r))) });
    s.entry.open();
    expect(s.entry.visible).toBe(true);
    expect(s.guest().disabled).toBe(false);
    s.guest().click();
    expect(s.entry.visible).toBe(false);
    expect(s.actions.guest).toHaveBeenCalledOnce();
    expect(s.actions.signIn).not.toHaveBeenCalled();
    expect(s.actions.continueAccount).not.toHaveBeenCalled();
    finish(session);
    await Promise.resolve();
    expect(renderGoogleButton).not.toHaveBeenCalled();
  });
  it('offers one direct Google control and opens checkpoints only after sign-in', async () => {
    const s = setup();
    s.entry.open();
    s.entry.open();
    await vi.waitFor(() => expect(s.google()).not.toBeNull());
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    expect(s.actions.signIn).not.toHaveBeenCalled();
    s.google().click();
    await vi.waitFor(() => expect(s.entry.visible).toBe(false));
    expect(s.actions.signIn).toHaveBeenCalledExactlyOnceWith('fixture-code');
    expect(s.actions.guest).not.toHaveBeenCalled();
  });
  it('retains the entry choice after an account failure and allows guest fallback', async () => {
    const s = setup({
      signIn: vi.fn(async () => {
        throw new Error('private-provider-detail');
      }),
    });
    s.entry.open();
    await vi.waitFor(() => expect(s.google()).not.toBeNull());
    s.google().click();
    await vi.waitFor(() =>
      expect(document.querySelector('.entry-error')!.textContent).toContain('Could not open'),
    );
    expect(s.entry.visible).toBe(true);
    expect(document.body.textContent).not.toContain('private-provider-detail');
    s.guest().click();
    expect(s.actions.guest).toHaveBeenCalledOnce();
  });
  it('opens remembered account progress only on explicit choice and treats its name as text', async () => {
    const s = setup({
      remembered: vi.fn(async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        name: '<img src=x>',
      })),
    });
    s.entry.open();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>('.entry-remembered')!.hidden).toBe(false),
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x>');
    expect(s.actions.continueAccount).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('.entry-continue')!.click();
    await vi.waitFor(() => expect(s.entry.visible).toBe(false));
    expect(s.actions.continueAccount).toHaveBeenCalledOnce();
  });
  it('prevents guest switching while account activation is in progress', async () => {
    let finish!: () => void;
    const s = setup({ signIn: vi.fn(() => new Promise<void>((r) => (finish = r))) });
    s.entry.open();
    await vi.waitFor(() => expect(s.google()).not.toBeNull());
    s.google().click();
    expect(s.guest().disabled).toBe(true);
    s.guest().click();
    expect(s.actions.guest).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(s.entry.visible).toBe(false));
  });
  it('keeps guest play available when account services are unreachable and supports Escape', async () => {
    const s = setup({
      session: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    s.entry.open();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Google sign-in is unavailable'),
    );
    expect(s.google().disabled).toBe(true);
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(s.entry.visible).toBe(false);
    expect(s.actions.guest).toHaveBeenCalledOnce();
  });
});
describe('entry session request coordination', () => {
  it('shares an in-flight bootstrap so rapid entry/account actions cannot create competing sessions', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    const api = new AccountApi(fetcher as typeof fetch);
    const a = api.bootstrap(),
      b = api.bootstrap();
    expect(fetcher).toHaveBeenCalledOnce();
    finish(
      new Response(JSON.stringify(session), { headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await a).toEqual(await b);
    expect(api.session?.nonce).toBe(session.nonce);
  });
});
