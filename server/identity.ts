import { timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { ApiError, requireApi } from './errors';

export interface GoogleIdentity {
  subject: string;
  name: string;
}
export type IdentityVerifier = (credential: string, nonce: string) => Promise<GoogleIdentity>;

export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function googleVerifier(
  clientId: string,
  client = new OAuth2Client(clientId),
): IdentityVerifier {
  return async (credential, nonce) => {
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
  };
}
