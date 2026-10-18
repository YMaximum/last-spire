// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderGoogleButton } from '../src/account/google';
afterEach(() => {
  delete window.google;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function setup() {
  let options: any;
  const requestCode = vi.fn(),
    received = vi.fn(async (_code: string) => {});
  const initCodeClient = vi.fn((value) => {
    options = value;
    return { requestCode };
  });
  window.google = { accounts: { oauth2: { initCodeClient } } };
  const host = document.createElement('div');
  document.body.append(host);
  return { host, requestCode, received, initCodeClient, options: () => options };
}
describe('custom Google button lifecycle', () => {
  it('uses one accessible dark button to launch only the basic-profile code popup', async () => {
    const s = setup();
    await renderGoogleButton(s.host, '123-test.apps.googleusercontent.com', 'nonce', s.received);
    const button = s.host.querySelector('button')!;
    expect(button.textContent).toBe('Continue with Google');
    expect(button.disabled).toBe(false);
    expect(s.host.querySelector('iframe')).toBeNull();
    expect(s.options()).toMatchObject({
      scope: 'openid profile',
      include_granted_scopes: false,
      select_account: true,
      ux_mode: 'popup',
    });
    expect(s.requestCode).not.toHaveBeenCalled();
    button.click();
    button.click();
    expect(s.requestCode).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    s.options().callback({ code: 'single-use-fixture-code' });
    s.options().callback({ code: 'duplicate-callback-code' });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(s.received).toHaveBeenCalledExactlyOnceWith('single-use-fixture-code');
    expect(s.host.querySelectorAll('button')).toHaveLength(1);
  });
  it('recovers from cancellation and never displays raw provider errors', async () => {
    const s = setup();
    await renderGoogleButton(s.host, '123-test.apps.googleusercontent.com', 'nonce', s.received);
    const button = s.host.querySelector('button')!;
    button.click();
    s.options().error_callback({
      type: 'popup_closed',
      error_description: 'private-provider-detail',
    });
    expect(button.disabled).toBe(false);
    expect(s.host.textContent).toContain('cancelled');
    button.click();
    s.options().callback({ error: 'private-provider-detail', code: 'not-valid-with-error' });
    expect(s.received).not.toHaveBeenCalled();
    expect(s.host.textContent).not.toContain('private-provider-detail');
    expect(button.disabled).toBe(false);
  });
  it('ignores a callback after close and cleans up pending click handlers', async () => {
    const s = setup();
    const cleanup = await renderGoogleButton(
      s.host,
      '123-test.apps.googleusercontent.com',
      'nonce',
      s.received,
    );
    s.host.querySelector('button')!.click();
    cleanup();
    s.options().callback({ code: 'late-code' });
    expect(s.received).not.toHaveBeenCalled();
    expect(s.host.querySelector('button')!.onclick).toBeNull();
  });
  it('does not load Google or open a popup when the server secret is not configured', async () => {
    const s = setup();
    await renderGoogleButton(
      s.host,
      '123-test.apps.googleusercontent.com',
      'nonce',
      s.received,
      false,
    );
    expect(s.host.querySelector('button')!.disabled).toBe(true);
    expect(s.initCodeClient).not.toHaveBeenCalled();
    expect(s.host.textContent).toContain('waiting for server configuration');
  });
  it('does not initialize or render after the account window has closed', async () => {
    const s = setup();
    await renderGoogleButton(
      document.createElement('div'),
      '123-test.apps.googleusercontent.com',
      'nonce',
      s.received,
    );
    expect(s.initCodeClient).not.toHaveBeenCalled();
  });
  it('permits a connection retry after SDK initialization fails without exposing its error', async () => {
    const s = setup();
    s.initCodeClient.mockImplementation(() => {
      throw new Error('private-provider-value');
    });
    await renderGoogleButton(s.host, '123-test.apps.googleusercontent.com', 'nonce', s.received);
    expect(s.host.dataset.googleRetry).toBe('true');
    expect(s.host.textContent).not.toContain('private-provider-value');
    expect(s.host.textContent).toContain('Guest play is available');
  });
});
