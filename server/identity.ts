import { timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { ApiError, requireApi } from './errors';

export interface GoogleIdentity {
  subject: string;
  name: string;
}
export type IdentityVerifier = (credential: string, nonce: string) => Promise<GoogleIdentity>;
export type GoogleCodeVerifier = (code: string) => Promise<GoogleIdentity>;

export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function googleVerifier(
  clientId: string,
  client = new OAuth2Client(clientId),
): IdentityVerifier {
  return (credential, nonce) => verifiedIdentity(clientId, client, credential, nonce);
}
async function verifiedIdentity(
  clientId: string,
  client: OAuth2Client,
  credential: string,
  nonce?: string,
): Promise<GoogleIdentity> {
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    requireApi(
      payload &&
        typeof payload.sub === 'string' &&
        payload.sub.length > 0 &&
        payload.sub.length <= 255,
      401,
      'auth_failed',
    );
    // A fresh identity proof is required when rotating into a new app session.
    requireApi(
      typeof payload.iat === 'number' && Date.now() / 1000 - payload.iat <= 600,
      401,
      'auth_failed',
    );
    const claimedNonce = (payload as unknown as Record<string, unknown>).nonce;
    if (nonce !== undefined)
      requireApi(
        typeof claimedNonce === 'string' && sameSecret(claimedNonce, nonce),
        401,
        'auth_failed',
      );
    const name =
      (typeof payload.name === 'string' ? payload.name : 'Spirekeeper')
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .trim()
        .slice(0, 80) || 'Spirekeeper';
    // Email, photo URLs, Google credentials and access/refresh tokens are not persisted.
    return { subject: payload.sub, name };
  } catch {
    throw new ApiError(401, 'auth_failed');
  }
}

/** Popup codes are bound by exact origin + session CSRF before this exchange.
 * The fixed exchange origin matches Google's popup redirect_uri convention.
 * Google access/refresh tokens are discarded, never stored or returned. */
export function googleCodeVerifier(
  clientId: string,
  clientSecret: string,
  origin: string,
  fetcher: typeof fetch = fetch,
  client = new OAuth2Client(clientId),
): GoogleCodeVerifier {
  return async (code) => {
    try {
      const response = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: origin,
        }),
      });
      requireApi(response.ok, 401, 'auth_failed');
      const reader = response.body?.getReader();
      requireApi(reader, 401, 'auth_failed');
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 32_768) {
          await reader.cancel();
          throw new ApiError(401, 'auth_failed');
        }
        chunks.push(part.value);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requireApi(
        typeof value?.id_token === 'string' && value.id_token.length <= 12_000,
        401,
        'auth_failed',
      );
      return await verifiedIdentity(clientId, client, value.id_token);
    } catch {
      throw new ApiError(401, 'auth_failed');
    }
  };
}
