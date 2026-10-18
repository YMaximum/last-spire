/** Google's supported code-popup API, launched by our own accessible button. */
interface GoogleCodeResponse {
  code?: string;
  error?: string;
}
interface GoogleCodeClient {
  requestCode(): void;
}
interface GoogleAccounts {
  oauth2?: {
    initCodeClient(options: {
      client_id: string;
      scope: string;
      include_granted_scopes: false;
      ux_mode: 'popup';
      select_account: true;
      callback: (response: GoogleCodeResponse) => void;
      error_callback: (error: { type?: string }) => void;
    }): GoogleCodeClient;
  };
  id?: { disableAutoSelect(): void };
}
declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}
let loading: Promise<NonNullable<GoogleAccounts['oauth2']>> | null = null;
export function loadGoogle(): Promise<NonNullable<GoogleAccounts['oauth2']>> {
  if (window.google?.accounts.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    const timer = window.setTimeout(fail, 12_000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(
        new Error(
          'Google sign-in could not load. Check your connection. Guest play remains available.',
        ),
      );
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.google?.accounts.oauth2) resolve(window.google.accounts.oauth2);
      else fail();
    };
    document.head.append(script);
  });
  return loading;
}
// Standard multicolour Google mark; no white logo tile or third-party iframe.
const googleMark =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.87-3.56 6.08-8.8 6.08-14.82Z"/><path fill="#34A853" d="M24 44c5.51 0 10.13-1.83 13.51-4.96l-6.61-5.14c-1.83 1.23-4.18 1.96-6.9 1.96-5.32 0-9.82-3.59-11.43-8.42H5.74v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.57 27.44A12.01 12.01 0 0 1 12 24c0-1.19.2-2.35.57-3.44v-5.3H5.74A19.99 19.99 0 0 0 4 24c0 3.23.77 6.29 2.14 8.99l6.43-5.55Z"/><path fill="#EA4335" d="M24 12.14c3 0 5.69 1.03 7.81 3.06l5.86-5.86C34.13 6.12 29.51 4 24 4A20 20 0 0 0 5.74 15.26l6.83 5.3c1.61-4.83 6.11-8.42 11.43-8.42Z"/></svg>';
export async function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  _nonce: string,
  callback: (code: string) => Promise<void>,
  enabled = true,
) {
  if (!parent.isConnected) return () => {};
  delete parent.dataset.googleRetry;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'spire-google-button';
  button.innerHTML = googleMark + '<span>Continue with Google</span>';
  button.disabled = true;
  const hint = document.createElement('p');
  hint.className = 'google-button-message';
  hint.setAttribute('role', 'status');
  hint.textContent = enabled
    ? 'Preparing secure sign-in…'
    : 'Google sign-in is waiting for server configuration. Guest play is available.';
  parent.replaceChildren(button, hint);
  if (!enabled) return () => {};
  let disposed = false,
    pending = false,
    timer: number | undefined;
  const reset = (message = '') => {
    pending = false;
    clearTimeout(timer);
    if (disposed || !parent.isConnected) return;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.querySelector('span')!.textContent = 'Continue with Google';
    hint.textContent = message;
  };
  try {
    const google = await loadGoogle();
    if (!parent.isConnected) return () => {};
    const client = google.initCodeClient({
      client_id: clientId,
      scope: 'openid profile',
      include_granted_scopes: false,
      ux_mode: 'popup',
      select_account: true,
      callback: (response) => {
        if (!pending || disposed || !parent.isConnected) return;
        if (typeof response.code !== 'string' || !response.code || response.error) {
          reset('Sign-in was not completed. You can try again or keep playing as a guest.');
          return;
        }
        clearTimeout(timer);
        pending = false;
        void callback(response.code).then(
          () => reset(),
          () => reset('Sign-in could not finish. Check your connection and try again.'),
        );
      },
      error_callback: (error) => {
        if (!pending) return;
        reset(
          error.type === 'popup_closed'
            ? 'Sign-in cancelled. Guest play remains available.'
            : 'Allow the Google popup in your browser, then try again.',
        );
      },
    });
    reset();
    button.onclick = () => {
      if (pending || disposed) return;
      pending = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.querySelector('span')!.textContent = 'Waiting for Google…';
      hint.textContent = '';
      timer = window.setTimeout(() => reset('Sign-in timed out. Please try again.'), 120_000);
      try {
        client.requestCode();
      } catch {
        reset('Allow the Google popup in your browser, then try again.');
      }
    };
  } catch {
    parent.dataset.googleRetry = 'true';
    hint.textContent =
      'Google could not load. Check connection to try again. Guest play is available.';
  }
  return () => {
    disposed = true;
    clearTimeout(timer);
    button.onclick = null;
  };
}
