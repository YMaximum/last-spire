import { parseGame, type SaveV3 } from '../v3/storage';
import { validateSnapshot, type CloudSnapshot } from './snapshot';

export interface Player {
  id: string;
  name: string;
}
export interface SyncBase {
  generation: string;
  revision: number;
  hash: string;
}
export interface Recovery {
  id: string;
  reason: string;
  at: number;
  save: SaveV3;
}
export const accountId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const r = indexedDB.open('last-spire-account-cache', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cache');
    r.onsuccess = () => {
      if (blocked) r.result.close();
      else resolve(r.result);
    };
    r.onerror = () => reject(new Error('Account cache could not open.'));
    r.onblocked = () => {
      blocked = true;
      reject(new Error('Account cache is blocked by another tab.'));
    };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('cache', mode);
      let result: T;
      const request = work(tx.objectStore('cache'));
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error('Account cache could not be saved.'));
    });
  } finally {
    db.close();
  }
}
async function get(key: string): Promise<unknown> {
  return transaction('readonly', (s) => s.get(key));
}
async function put(key: string, value: unknown): Promise<void> {
  await transaction('readwrite', (s) => s.put(value, key));
}
function key(id: string, suffix: string) {
  if (!accountId(id)) throw new Error('Invalid account context.');
  return id + ':' + suffix;
}
export async function readBase(id: string): Promise<SyncBase | null> {
  const value = (await get(key(id, 'base'))) as SyncBase | undefined;
  if (!value) return null;
  if (
    !/^[\w-]{43}$/.test(value.generation) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !/^[a-f0-9]{64}$/.test(value.hash)
  )
    throw new Error('Sync metadata needs recovery. Export the local account save first.');
  return value;
}
export async function writeBase(id: string, value: SyncBase): Promise<void> {
  await put(key(id, 'base'), value);
}
export async function rememberPlayer(player: Player | null): Promise<void> {
  await put('active-player', player);
}
export async function rememberedPlayer(): Promise<Player | null> {
  const p = (await get('active-player')) as Player | null;
  return p && accountId(p.id) && typeof p.name === 'string' && p.name.length <= 80 ? p : null;
}
/** Replacements keep five local recovery copies per account; no lease or login tokens. */
export async function archiveSave(id: string, save: SaveV3, reason: string): Promise<void> {
  const history = await readRecovery(id);
  const entry: Recovery = {
    id: crypto.randomUUID(),
    reason: reason.slice(0, 100),
    at: Date.now(),
    save: parseGame(save),
  };
  await put(key(id, 'recovery'), [entry, ...history].slice(0, 5));
}
export async function readRecovery(id: string): Promise<Recovery[]> {
  const raw = await get(key(id, 'recovery'));
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 5) throw new Error('Recovery cache is invalid.');
  return raw.map((r) => {
    if (!r || !accountId(r.id) || typeof r.reason !== 'string' || !Number.isFinite(r.at))
      throw new Error('Recovery cache is invalid.');
    return { id: r.id, reason: r.reason.slice(0, 100), at: r.at, save: parseGame(r.save) };
  });
}
export async function forgetAccount(id: string): Promise<void> {
  await transaction('readwrite', (s) => s.delete(key(id, 'base')));
  await transaction('readwrite', (s) => s.delete(key(id, 'recovery')));
  if ((await rememberedPlayer())?.id === id) await rememberPlayer(null);
}
export async function fingerprint(snapshot: CloudSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(validateSnapshot(snapshot)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}

/** Hold a browser-wide account cache lock until sign-out/switch. Fail closed if unsupported. */
export async function reserveAccount(id: string): Promise<() => void> {
  if (!navigator.locks)
    throw new Error(
      'This browser cannot reserve an account cache. Guest play and exports remain available.',
    );
  key(id, 'lock');
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request('last-spire-account:' + id, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(
            new Error(
              'This account is already open in another tab. Close or sign out there first.',
            ),
          );
          return;
        }
        await new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}

/** A tab-only writer token is not a login credential: the API still requires its
 * HttpOnly session, matching account and CSRF proof. Never persist those proofs. */
export function readTabLease(
  id: string,
  generation: string,
): { leaseToken: string; revision: number; leaseExpiresAt: number } | null {
  try {
    const raw = sessionStorage.getItem(key(id, 'writer'));
    if (!raw) return null;
    const lease = JSON.parse(raw);
    if (
      lease.generation !== generation ||
      !/^[\w-]{43}$/.test(lease.leaseToken) ||
      !Number.isSafeInteger(lease.revision) ||
      lease.revision < 0 ||
      !Number.isSafeInteger(lease.leaseExpiresAt) ||
      lease.leaseExpiresAt <= Date.now()
    )
      return null;
    return {
      leaseToken: lease.leaseToken,
      revision: lease.revision,
      leaseExpiresAt: lease.leaseExpiresAt,
    };
  } catch {
    return null;
  }
}
export function writeTabLease(
  id: string,
  generation: string,
  lease: { leaseToken: string; revision: number; leaseExpiresAt: number },
): void {
  try {
    sessionStorage.setItem(key(id, 'writer'), JSON.stringify({ generation, ...lease }));
  } catch {
    /* A refresh will require deliberate re-acquisition instead. */
  }
}
export function clearTabLease(id: string): void {
  try {
    sessionStorage.removeItem(key(id, 'writer'));
  } catch {
    /* Expiry/ownership checks still apply on the server. */
  }
}
