import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuth2Client, LoginTicket } from 'google-auth-library';
import { googleCodeVerifier } from '../server/identity';
import { readGoogleClientSecret } from '../server/secrets';
const CLIENT = '123-test.apps.googleusercontent.com',
  ORIGIN = 'https://game.example.test';
// Deliberately synthetic non-credential input; no live provider exchange in tests.
const SECRET = 'synthetic-test-value-not-a-credential';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function exchange(
  response = new Response(
    JSON.stringify({
      id_token: 'signed-fixture',
      access_token: 'discard-access',
      refresh_token: 'discard-refresh',
    }),
  ),
) {
  const fetcher = vi.fn(async () => response);
  const client = new OAuth2Client(CLIENT);
  const verify = vi.fn(
    async (_options: unknown) =>
      new LoginTicket('', {
        sub: 'synthetic-subject',
        name: 'Spirekeeper',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
        aud: CLIENT,
        iss: 'https://accounts.google.com',
      }),
  );
  client.verifyIdToken = verify as unknown as OAuth2Client['verifyIdToken'];
  return {
    fetcher,
    verify,
    run: googleCodeVerifier(CLIENT, SECRET, ORIGIN, fetcher as typeof fetch, client),
  };
}
describe('private Google code exchange', () => {
  it('exchanges only with the fixed provider endpoint and verifies the ID token audience', async () => {
    const s = exchange();
    expect(await s.run('synthetic-once-code')).toEqual({
      subject: 'synthetic-subject',
      name: 'Spirekeeper',
    });
    const [url, request] = (s.fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(request.redirect).toBe('error');
    expect(request.signal).toBeInstanceOf(AbortSignal);
    const params = request.body as URLSearchParams;
    expect(params.get('client_secret')).toBe(SECRET);
    expect(params.get('redirect_uri')).toBe(ORIGIN);
    expect(params.get('code')).toBe('synthetic-once-code');
    expect(s.verify).toHaveBeenCalledWith({ idToken: 'signed-fixture', audience: CLIENT });
  });
  it('rejects invalid exchanges and does not echo provider secrets or token bodies', async () => {
    for (const response of [
      new Response('private-provider-value', { status: 400 }),
      new Response('not-json'),
      new Response(JSON.stringify({ access_token: 'private-provider-value' })),
      new Response('x'.repeat(32_769)),
    ]) {
      const s = exchange(response);
      await expect(s.run('bad-code')).rejects.toThrow(/^auth_failed$/);
      expect(s.verify).not.toHaveBeenCalled();
    }
    const s = exchange();
    s.verify.mockRejectedValue(new Error('private-provider-value'));
    await expect(s.run('bad-proof')).rejects.toThrow(/^auth_failed$/);
  });
  it('accepts only private regular secret files, without echoing their contents or path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spire-secret-test-'));
    dirs.push(dir);
    const file = join(dir, 'secret'),
      link = join(dir, 'link');
    writeFileSync(file, SECRET, { mode: 0o600 });
    expect(readGoogleClientSecret(file)).toBe(SECRET);
    chmodSync(file, 0o644);
    expect(() => readGoogleClientSecret(file)).toThrow('mode 600');
    chmodSync(file, 0o600);
    symlinkSync(file, link);
    expect(() => readGoogleClientSecret(link)).toThrow('mode 600');
    writeFileSync(file, 'private invalid\ninput');
    expect(() => readGoogleClientSecret(file)).toThrow(
      /^Google sign-in requires a valid private client-secret file \(mode 600\).$/,
    );
    expect(() => readGoogleClientSecret('relative')).toThrow('mode 600');
  });
});
