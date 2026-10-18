import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { MAX_CLOUD_BYTES } from '../src/account/snapshot';
import { ApiError, requireApi } from './errors';
import { sameSecret, type IdentityVerifier, type GoogleCodeVerifier } from './identity';
import { AccountStore, LOGIN_MS, SESSION_MS } from './store';

export interface ApiConfig {
  origin: string;
  clientId: string;
  development?: boolean;
  /** Only enable behind a trusted loopback proxy which overwrites this header. */
  trustProxy?: boolean;
  releaseCommit?: string;
  trustedProxyAddress?: string;
}

export function validateConfig(config: ApiConfig): ApiConfig {
  requireApi(
    config.trustedProxyAddress === undefined ||
      (config.trustProxy === true && isIP(config.trustedProxyAddress) !== 0),
    500,
    'invalid_proxy',
  );
  requireApi(
    config.releaseCommit === undefined || /^[a-f0-9]{40}$/.test(config.releaseCommit),
    500,
    'invalid_release',
  );
  const origin = new URL(config.origin);
  requireApi(
    origin.origin === config.origin && !origin.username && !origin.password,
    500,
    'invalid_origin',
  );
  requireApi(
    origin.protocol === 'https:' ||
      (config.development === true &&
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)),
    500,
    'https_required',
  );
  requireApi(
    /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId),
    500,
    'invalid_client_id',
  );
  return { ...config };
}

/** Fixed-window buckets are bounded and expire; no IP addresses are written to disk. */
export class RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  constructor(private now = Date.now) {}
  allow(key: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (this.buckets.size >= 10_000) {
        for (const [key, value] of this.buckets) if (value.until <= now) this.buckets.delete(key);
        if (this.buckets.size >= 10_000) return false;
      }
      bucket = { count: 0, until: now + windowMs };
      this.buckets.set(key, bucket);
    }
    return ++bucket.count <= limit;
  }
}

function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  requireApi(value && typeof value === 'object' && !Array.isArray(value), 400, 'invalid_request');
  const record = value as Record<string, unknown>;
  requireApi(
    required.every((key) => Object.hasOwn(record, key)) &&
      Object.keys(record).every((key) => required.includes(key) || optional.includes(key)),
    400,
    'invalid_request',
  );
  return record;
}
function revision(value: unknown): asserts value is number {
  requireApi(Number.isSafeInteger(value) && Number(value) >= 0, 400, 'invalid_revision');
}
function secret(value: unknown): asserts value is string {
  requireApi(typeof value === 'string' && /^[\w-]{43}$/.test(value), 400, 'invalid_request');
}
async function body(req: IncomingMessage, limit: number): Promise<unknown> {
  requireApi(
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''),
    415,
    'json_required',
  );
  requireApi(
    !req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity',
    415,
    'encoding_not_supported',
  );
  if (req.headers['content-length'])
    requireApi(Number(req.headers['content-length']) <= limit, 413, 'payload_too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    requireApi(size <= limit, 413, 'payload_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
}
function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(JSON.stringify(value));
}

export function accountServer(
  store: AccountStore,
  input: ApiConfig,
  verify: IdentityVerifier,
  verifyCode?: GoogleCodeVerifier,
) {
  const config = validateConfig(input),
    limiter = new RateLimiter(store.now);
  let uploads = 0;
  async function readBody(req: IncomingMessage, limit: number) {
    // Bound concurrent buffered bodies in addition to individual request size.
    requireApi(uploads < 2, 503, 'service_busy');
    uploads++;
    try {
      return await body(req, limit);
    } finally {
      uploads--;
    }
  }
  const secure = new URL(config.origin).protocol === 'https:';
  const cookieName = secure ? '__Host-last-spire' : 'last-spire-dev';
  function cookie(res: ServerResponse, raw: string, maxAge: number) {
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
    );
  }
  function readCookie(req: IncomingMessage): string | undefined {
    const entries = (req.headers.cookie ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x.startsWith(cookieName + '='));
    // Duplicate session cookies are ambiguous; do not select one based on order.
    return entries.length === 1 ? entries[0].slice(cookieName.length + 1) : undefined;
  }
  function clientAddress(req: IncomingMessage): string {
    const remote = req.socket.remoteAddress ?? 'unknown';
    if (
      config.trustProxy &&
      (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
        remote === config.trustedProxyAddress)
    ) {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
    }
    return remote;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url,
      method = req.method;
    if (method === 'GET' && path === '/api/healthz')
      return reply(res, 200, {
        ok: true,
        schema: 1,
        ...(config.releaseCommit
          ? {
              commit: config.releaseCommit,
              database: Number(store.db.prepare('PRAGMA user_version').get()!.user_version),
              runtime: Number(process.versions.node.split('.')[0]),
            }
          : {}),
      });
    requireApi(limiter.allow('global', 1200, 60_000), 429, 'rate_limited');
    requireApi(limiter.allow('ip:' + clientAddress(req), 240, 60_000), 429, 'rate_limited');
    if (method !== 'GET') {
      requireApi(req.headers.origin === config.origin, 403, 'origin_rejected');
      requireApi(
        !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin',
        403,
        'origin_rejected',
      );
    }
    if (method === 'GET' && path === '/api/session') {
      requireApi(
        !req.headers['sec-fetch-site'] ||
          ['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])),
        403,
        'origin_rejected',
      );
      const { raw, session } = store.bootstrap(readCookie(req));
      cookie(res, raw, Math.max(0, Math.floor((session.expiresAt - store.now()) / 1000)));
      return reply(res, 200, {
        clientId: config.clientId,
        codeSignIn: !!verifyCode,
        csrf: session.csrf,
        nonce: session.nonce,
        generation: store.generation,
        player: session.userId ? store.player(session.userId) : null,
      });
    }
    const session = store.session(readCookie(req));
    requireApi(session, 401, 'unauthenticated');
    if (method !== 'GET')
      requireApi(
        typeof req.headers['x-csrf-token'] === 'string' &&
          sameSecret(req.headers['x-csrf-token'], session.csrf),
        403,
        'csrf_rejected',
      );
    if (method === 'POST' && (path === '/api/auth/google' || path === '/api/auth/google/code')) {
      requireApi(
        limiter.allow('login-ip:' + clientAddress(req), 20, LOGIN_MS),
        429,
        'rate_limited',
      );
      const codeFlow = path === '/api/auth/google/code';
      if (codeFlow) requireApi(verifyCode, 503, 'sign_in_not_configured');
      const field = codeFlow ? 'code' : 'credential';
      const data = object(await readBody(req, 16 * 1024), [field]);
      requireApi(
        typeof data[field] === 'string' &&
          (data[field] as string).length > 0 &&
          (data[field] as string).length <= 12_000,
        400,
        'invalid_request',
      );
      const identity = codeFlow
        ? await verifyCode!(data[field] as string)
        : await verify(data[field] as string, session.nonce);
      const result = store.login(session, identity);
      cookie(res, result.raw, Math.floor(SESSION_MS / 1000));
      return reply(res, 200, {
        player: result.player,
        csrf: result.session.csrf,
        nonce: result.session.nonce,
      });
    }
    requireApi(session.userId, 401, 'unauthenticated');
    // A cookie can change in another tab between bootstrap and a read. This is
    // an additional identity assertion, never a source of authorization.
    requireApi(
      !req.headers['x-last-spire-player'] || req.headers['x-last-spire-player'] === session.userId,
      401,
      'session_changed',
    );
    requireApi(limiter.allow('user:' + session.userId, 120, 60_000), 429, 'rate_limited');
    if (method === 'POST' && path === '/api/auth/logout') {
      object(await readBody(req, 1024), []);
      store.logout(session);
      cookie(res, '', 0);
      return reply(res, 200, { signedOut: true });
    }
    if (method === 'DELETE' && path === '/api/account') {
      const data = object(await readBody(req, 1024), ['confirmation']);
      requireApi(data.confirmation === 'DELETE', 400, 'confirmation_required');
      store.deleteAccount(session);
      cookie(res, '', 0);
      return reply(res, 200, { deleted: true, backupRetentionDays: 7 });
    }
    if (method === 'GET' && path === '/api/save')
      return reply(res, 200, store.read(session.userId));
    if (method === 'POST' && path === '/api/save/lease') {
      const data = object(
        await readBody(req, 2048),
        ['generation', 'revision', 'takeover'],
        ['leaseToken'],
      );
      revision(data.revision);
      secret(data.generation);
      requireApi(typeof data.takeover === 'boolean', 400, 'invalid_request');
      if (data.leaseToken !== undefined) secret(data.leaseToken);
      return reply(
        res,
        200,
        store.acquireLease(
          session.userId,
          data.generation,
          data.revision,
          data.takeover,
          data.leaseToken as string | undefined,
        ),
      );
    }
    if (method === 'PUT' && path === '/api/save') {
      requireApi(limiter.allow('write:' + session.userId, 30, 60_000), 429, 'rate_limited');
      const data = object(await readBody(req, MAX_CLOUD_BYTES + 4096), [
        'generation',
        'revision',
        'leaseToken',
        'writeId',
        'snapshot',
      ]);
      revision(data.revision);
      secret(data.leaseToken);
      secret(data.generation);
      requireApi(
        typeof data.writeId === 'string' &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.writeId),
        400,
        'invalid_request',
      );
      return reply(
        res,
        200,
        store.write(
          session.userId,
          data.generation,
          data.revision,
          data.leaseToken,
          data.writeId,
          data.snapshot,
        ),
      );
    }
    if (method === 'GET' && path === '/api/save/history')
      return reply(res, 200, { history: store.history(session.userId) });
    if (method === 'GET' && /^\/api\/save\/history\/[1-9][0-9]*$/.test(path ?? '')) {
      const id = Number(path!.split('/').at(-1));
      revision(id);
      return reply(res, 200, store.historical(session.userId, id));
    }
    throw new ApiError(404, 'not_found');
  }
  const server = createServer(
    { maxHeaderSize: 16 * 1024, requestTimeout: 15_000, headersTimeout: 10_000 },
    (req, res) => {
      void handle(req, res).catch((error) => {
        if (res.headersSent || res.destroyed) {
          res.destroy();
          return;
        }
        const status = error instanceof ApiError ? error.status : 503;
        const code = error instanceof ApiError ? error.code : 'service_unavailable';
        if (status === 429) res.setHeader('Retry-After', '60');
        // Close rejected bodies instead of draining arbitrarily large attacker-controlled streams.
        res.setHeader('Connection', 'close');
        reply(res, status, { error: code });
      });
    },
  );
  server.keepAliveTimeout = 5000;
  server.maxConnections = 32;
  return server;
}
