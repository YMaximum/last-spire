import { MAX_CLOUD_BYTES, validateSnapshot, type CloudSnapshot } from './snapshot';
import { accountId, type Player } from './cache';

export interface AccountSession {
  clientId: string;
  codeSignIn?: boolean;
  csrf: string;
  nonce: string;
  generation: string;
  player: Player | null;
}
export interface CloudCheckpoint {
  generation: string;
  revision: number;
  updatedAt: number;
  snapshot: CloudSnapshot | null;
  leaseHeld: boolean;
  leaseExpiresAt: number;
}
export interface Lease {
  leaseToken: string;
  revision: number;
  leaseExpiresAt: number;
}
export class SyncError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}
const token = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{43}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function player(v: unknown): v is Player {
  const p = v as Player;
  return !!p && accountId(p.id) && typeof p.name === 'string' && p.name.length <= 80;
}
function invalid(): never {
  throw new SyncError('invalid_response');
}

export class AccountApi {
  session: AccountSession | null = null;
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 12_000);
    try {
      const res = await this.fetcher('/api/' + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: abort.signal,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(method === 'GET' ? {} : { 'X-CSRF-Token': this.session?.csrf ?? '' }),
          ...(!path.startsWith('auth/') && path !== 'session' && this.session?.player
            ? { 'X-Last-Spire-Player': this.session.player.id }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.headers.get('content-type')?.startsWith('application/json'))
        throw new SyncError('service_unavailable', res.status);
      const reader = res.body?.getReader();
      if (!reader) invalid();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_CLOUD_BYTES + 16_384) {
          await reader.cancel();
          invalid();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let cursor = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, cursor);
        cursor += chunk.length;
      }
      let value: any;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        invalid();
      }
      if (!res.ok)
        throw new SyncError(
          typeof value?.error === 'string' ? value.error.slice(0, 80) : 'service_unavailable',
          res.status,
        );
      return value;
    } catch (e) {
      if (e instanceof SyncError) throw e;
      throw new SyncError('offline');
    } finally {
      clearTimeout(timer);
    }
  }
  async bootstrap(): Promise<AccountSession> {
    const s = await this.request('session');
    if (
      !s ||
      !/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(s.clientId) ||
      !token(s.csrf) ||
      !token(s.nonce) ||
      !token(s.generation) ||
      (s.codeSignIn !== undefined && typeof s.codeSignIn !== 'boolean') ||
      (s.player !== null && !player(s.player))
    )
      invalid();
    return (this.session = {
      clientId: s.clientId,
      ...(s.codeSignIn === undefined ? {} : { codeSignIn: s.codeSignIn }),
      csrf: s.csrf,
      nonce: s.nonce,
      generation: s.generation,
      player: s.player ? { id: s.player.id, name: s.player.name } : null,
    });
  }
  async login(credential: string, method: 'credential' | 'code' = 'credential'): Promise<Player> {
    if (!this.session) throw new SyncError('unauthenticated');
    const s = await this.request(method === 'code' ? 'auth/google/code' : 'auth/google', 'POST', {
      [method]: credential,
    });
    if (!player(s?.player) || !token(s.csrf) || !token(s.nonce)) invalid();
    const identified = { id: s.player.id, name: s.player.name };
    this.session = { ...this.session, player: identified, csrf: s.csrf, nonce: s.nonce };
    return identified;
  }
  async read(): Promise<CloudCheckpoint> {
    const c = await this.request('save');
    if (
      !c ||
      !token(c.generation) ||
      !integer(c.revision) ||
      !integer(c.updatedAt) ||
      typeof c.leaseHeld !== 'boolean' ||
      !integer(c.leaseExpiresAt)
    )
      invalid();
    return {
      generation: c.generation,
      revision: c.revision,
      updatedAt: c.updatedAt,
      leaseHeld: c.leaseHeld,
      leaseExpiresAt: c.leaseExpiresAt,
      snapshot: c.snapshot === null ? null : validateSnapshot(c.snapshot),
    };
  }
  async lease(
    c: Pick<CloudCheckpoint, 'generation' | 'revision'>,
    takeover: boolean,
    leaseToken?: string,
  ): Promise<Lease> {
    const lease = await this.request('save/lease', 'POST', {
      generation: c.generation,
      revision: c.revision,
      takeover,
      ...(leaseToken ? { leaseToken } : {}),
    });
    if (!token(lease?.leaseToken) || !integer(lease.revision) || !integer(lease.leaseExpiresAt))
      invalid();
    return {
      leaseToken: lease.leaseToken,
      revision: lease.revision,
      leaseExpiresAt: lease.leaseExpiresAt,
    };
  }
  async write(
    c: Pick<CloudCheckpoint, 'generation' | 'revision'>,
    leaseToken: string,
    snapshot: CloudSnapshot,
    writeId: string,
  ): Promise<{ revision: number; updatedAt: number }> {
    const r = await this.request('save', 'PUT', {
      generation: c.generation,
      revision: c.revision,
      leaseToken,
      writeId,
      snapshot,
    });
    if (!integer(r?.revision) || r.revision !== c.revision + 1 || !integer(r.updatedAt)) invalid();
    return { revision: r.revision, updatedAt: r.updatedAt };
  }
  async history(): Promise<{ revision: number; updatedAt: number }[]> {
    const r = await this.request('save/history');
    if (
      !Array.isArray(r?.history) ||
      r.history.length > 5 ||
      r.history.some((h: any) => !integer(h?.revision) || !integer(h.updatedAt))
    )
      invalid();
    return r.history.map((h: { revision: number; updatedAt: number }) => ({
      revision: h.revision,
      updatedAt: h.updatedAt,
    }));
  }
  async historical(revision: number): Promise<CloudSnapshot> {
    if (!integer(revision)) invalid();
    const r = await this.request('save/history/' + revision);
    return validateSnapshot(r?.snapshot);
  }
  async logout(): Promise<void> {
    await this.request('auth/logout', 'POST', {});
    this.session = null;
  }
  async delete(): Promise<void> {
    await this.request('account', 'DELETE', { confirmation: 'DELETE' });
    this.session = null;
  }
}
