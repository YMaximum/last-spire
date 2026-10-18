import {
  deleteAccountCache,
  emptySave,
  loadGame,
  parseGame,
  readRawSave,
  type SaveScope,
  type SaveV3,
} from '../v3/storage';
import { snapshotFromSave, saveFromSnapshot, type CloudSnapshot } from './snapshot';
import { AccountApi, SyncError, type CloudCheckpoint, type Lease } from './api';
import {
  archiveSave,
  readTabLease,
  writeTabLease,
  clearTabLease,
  fingerprint,
  forgetAccount,
  readBase,
  rememberPlayer,
  rememberedPlayer,
  reserveAccount,
  type Player,
  type SyncBase,
} from './cache';

export interface SyncHost {
  save(): SaveV3;
  scope(): SaveScope;
  /** Resolve only after a durable local write, or reject. */
  persist(): Promise<void>;
  /** Flush the old scope before changing data; retain device settings. */
  activate(save: SaveV3, scope: SaveScope): Promise<void>;
  changed(): void;
}
export type SyncPhase =
  | 'guest'
  | 'checking'
  | 'choice'
  | 'synced'
  | 'local'
  | 'offline'
  | 'conflict'
  | 'lease'
  | 'reauth'
  | 'unavailable'
  | 'error';
export interface SyncView {
  phase: SyncPhase;
  busy: boolean;
  player: Player | null;
  cloud: CloudCheckpoint | null;
  cached: SaveV3 | null;
  message: string;
  lastSynced: number;
}
export type CheckpointSource = 'cloud' | 'local' | 'guest' | 'fresh';
export const scopeFor = (p: Player): SaveScope => `account:${p.id}`;

export async function compareCheckpoint(
  local: CloudSnapshot,
  base: SyncBase | null,
  remote: CloudCheckpoint,
): Promise<'equal' | 'local' | 'cloud' | 'conflict'> {
  if (!base || base.generation !== remote.generation) return 'conflict';
  const localHash = await fingerprint(local),
    remoteHash = remote.snapshot ? await fingerprint(remote.snapshot) : '';
  if (localHash === remoteHash) return 'equal';
  if (base.hash === localHash) return 'cloud';
  if (base.revision === remote.revision && base.hash === remoteHash) return 'local';
  return 'conflict';
}
const messages: Record<string, string> = {
  offline:
    'Cloud saves could not be reached. Local progress is kept; reconnect and review before syncing.',
  service_unavailable:
    'Cloud saves are not available here yet. Guest play and manual exports work normally.',
  lease_held:
    'Another device is writing this cloud save. Review the checkpoints, then explicitly continue here.',
  lease_lost:
    'Another device took over, or your writer reservation expired. Your local branch is kept.',
  stale_revision: 'The cloud checkpoint changed. Compare both saves before continuing.',
  restored_database:
    'Cloud recovery changed the database. Review your local and restored checkpoints before continuing.',
  unauthenticated: 'Sign in again to reconnect this account. Your local checkpoint is kept.',
  session_changed:
    'The Google account changed in another tab. Sign in again; this local checkpoint stays separate.',
  csrf_rejected: 'Your session changed. Sign in again before syncing.',
  auth_failed: 'Google sign-in could not be verified. Please retry the sign-in button.',
  rate_limited:
    'Cloud requests are temporarily limited. Keep playing locally and retry in a minute.',
  storage_full: 'Cloud storage is full. Your local checkpoint is kept; export a copy.',
  recent_sign_in_required: 'Sign in with Google again before deleting this account.',
  invalid_response: 'The cloud response could not be validated. No local checkpoint was replaced.',
};

export class AccountSync {
  readonly view: SyncView = {
    phase: 'guest',
    busy: false,
    player: null,
    cloud: null,
    cached: null,
    message: 'Guest progress stays in this browser.',
    lastSynced: 0,
  };
  private base: SyncBase | null = null;
  private lease: Lease | null = null;
  private leaseGeneration = '';
  private release: (() => void) | null = null;
  private reservedId = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: {
    remote: CloudCheckpoint;
    snapshot: CloudSnapshot;
    hash: string;
    id: string;
  } | null = null;
  constructor(
    readonly host: SyncHost,
    readonly api = new AccountApi(),
    private reserve = reserveAccount,
  ) {}
  get active() {
    return !!this.view.player && this.host.scope() === scopeFor(this.view.player);
  }
  get hasLease() {
    return !!this.lease && this.lease.leaseExpiresAt > Date.now();
  }
  private changed() {
    this.host.changed();
  }
  private phase(phase: SyncPhase, message: string) {
    this.view.phase = phase;
    this.view.message = message;
    this.changed();
  }
  private async operation(work: () => Promise<void>) {
    if (this.view.busy) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.view.busy = true;
    this.changed();
    try {
      await work();
    } catch (e) {
      this.failure(e);
    } finally {
      this.view.busy = false;
      this.changed();
    }
  }
  private failure(e: unknown) {
    const code = e instanceof SyncError ? e.code : '';
    if (['lease_held', 'lease_lost'].includes(code)) {
      if (this.view.player) clearTabLease(this.view.player.id);
      this.lease = null;
    }
    const phase: SyncPhase = ['lease_held', 'lease_lost'].includes(code)
      ? 'lease'
      : ['stale_revision', 'restored_database'].includes(code)
        ? 'conflict'
        : [
              'unauthenticated',
              'session_changed',
              'csrf_rejected',
              'recent_sign_in_required',
            ].includes(code)
          ? 'reauth'
          : ['offline', 'rate_limited', 'storage_full', 'service_busy'].includes(code)
            ? 'offline'
            : code === 'service_unavailable'
              ? 'unavailable'
              : 'error';
    this.phase(
      phase,
      (code === 'service_unavailable' && this.active
        ? 'The cloud service is unavailable. Your account checkpoint is kept locally; reconnect and review before syncing.'
        : messages[code]) ??
        (e instanceof SyncError
          ? 'Sync stopped safely. Your local checkpoint is kept; export it before closing.'
          : e instanceof Error
            ? e.message
            : 'Local storage could not be reached. Export your current save.'),
    );
  }
  private async reservation(player: Player) {
    if (this.reservedId === player.id) return;
    const release = await this.reserve(player.id);
    this.release?.();
    this.release = release;
    this.reservedId = player.id;
  }
  private async verifyOwner() {
    const session = await this.api.bootstrap();
    if (!session.player || session.player.id !== this.view.player?.id)
      throw new SyncError('session_changed', 401);
  }
  private async acquire(remote: CloudCheckpoint, takeover: boolean) {
    if (this.leaseGeneration !== remote.generation) this.lease = null;
    this.lease ??= readTabLease(this.view.player!.id, remote.generation);
    this.lease = await this.api.lease(remote, takeover, this.lease?.leaseToken);
    this.leaseGeneration = remote.generation;
    writeTabLease(this.view.player!.id, remote.generation, this.lease);
  }
  private async setBase(remote: CloudCheckpoint, hash: string) {
    const base = { generation: remote.generation, revision: remote.revision, hash };
    await writeSyncBase(this.view.player!.id, base);
    this.base = base;
  }
  async initialize() {
    await this.operation(async () => {
      const remembered = await rememberedPlayer();
      if (remembered) {
        const raw = await readRawSave(scopeFor(remembered));
        if (raw !== undefined) {
          await this.reservation(remembered);
          this.view.player = remembered;
          this.base = await readBase(remembered.id);
          await this.host.activate(parseGame(raw), scopeFor(remembered));
          this.phase('offline', 'Account checkpoint restored locally. Checking cloud status…');
        }
      }
      const session = await this.api.bootstrap();
      if (this.active) {
        if (session.player?.id !== this.view.player!.id)
          throw new SyncError('unauthenticated', 401);
        await this.reconcile(false);
      } else if (session.player) await this.inspect(session.player);
    });
  }
  private async inspect(player: Player) {
    this.view.player = player;
    this.lease = null;
    this.pending = null;
    this.base = await readBase(player.id);
    const raw = await readRawSave(scopeFor(player));
    this.view.cached = raw === undefined ? null : parseGame(raw);
    this.view.cloud = await this.api.read();
    this.phase(
      'choice',
      'Choose the progress to use. Guest, cached account, and cloud saves are never merged automatically.',
    );
  }
  async signIn(credential: string, method: 'credential' | 'code' = 'credential') {
    await this.operation(async () => {
      const player = await this.api.login(credential, method);
      if (this.active && this.view.player!.id !== player.id) {
        await this.host.activate(await loadGame(), 'guest');
        this.release?.();
        this.release = null;
        this.reservedId = '';
      }
      if (this.active && this.view.player!.id === player.id) {
        this.view.player = player;
        await this.reconcile(false);
      } else await this.inspect(player);
    });
  }
  async refresh() {
    await this.operation(async () => {
      if (this.active) {
        await this.verifyOwner();
        await this.reconcile(false);
      } else {
        const s = await this.api.bootstrap();
        if (s.player) await this.inspect(s.player);
        else {
          this.view.player = null;
          this.view.cloud = null;
          this.phase('guest', 'Guest progress stays in this browser.');
        }
      }
    });
  }
  /** The only route which deliberately adopts/replaces a cloud branch. */
  async choose(source: CheckpointSource, takeover = false, reviewedHash?: string) {
    await this.operation(async () => {
      const player = this.view.player,
        reviewed = this.view.cloud;
      if (!player || !reviewed) throw new SyncError('unauthenticated');
      await this.verifyOwner();
      const remote = await this.api.read();
      if (remote.generation !== reviewed.generation || remote.revision !== reviewed.revision) {
        this.view.cloud = remote;
        throw new SyncError('stale_revision', 409);
      }
      await this.reservation(player);
      await this.host.persist();
      let save: SaveV3;
      if (source === 'cloud') {
        if (!remote.snapshot) throw new Error('No cloud checkpoint exists yet.');
        save = saveFromSnapshot(remote.snapshot, this.host.save().settings);
      } else if (source === 'local') {
        const cached = this.active ? this.host.save() : this.view.cached;
        if (!cached) throw new Error('No cached account checkpoint exists.');
        save = parseGame(cached);
      } else if (source === 'guest') {
        save = this.host.scope() === 'guest' ? parseGame(this.host.save()) : await loadGame();
      } else save = emptySave();
      if (reviewedHash && (await fingerprint(snapshotFromSave(save))) !== reviewedHash)
        throw new Error(
          'Progress changed while you reviewed it. Open the comparison again before choosing.',
        );
      await this.acquire(remote, takeover);
      const previous = await readRawSave(scopeFor(player));
      if (previous !== undefined)
        await archiveSave(
          player.id,
          parseGame(previous),
          'Before choosing ' + source + ' progress',
        );
      await this.host.activate(save, scopeFor(player));
      await rememberPlayer(player);
      this.view.cached = null;
      this.view.cloud = remote;
      await this.setBase(
        remote,
        remote.snapshot
          ? await fingerprint(remote.snapshot)
          : await fingerprint(snapshotFromSave(emptySave())),
      );
      if (source !== 'cloud') await this.upload(remote, snapshotFromSave(this.host.save()));
      else this.phase('synced', 'Cloud checkpoint loaded. This device is the active writer.');
    });
  }
  async onLocalSave(scope: SaveScope) {
    if (!this.active || scope !== this.host.scope()) return;
    if (!['synced', 'local'].includes(this.view.phase)) return;
    const playerId = this.view.player!.id;
    try {
      const hash = await fingerprint(snapshotFromSave(this.host.save()));
      if (
        this.view.player?.id !== playerId ||
        this.host.scope() !== scope ||
        !['synced', 'local'].includes(this.view.phase)
      )
        return;
      // Presentation-only autosaves must not flash pending or generate uploads.
      if (hash === this.base?.hash) return;
      this.phase('local', 'Saved on this device. Cloud sync is queued.');
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.sync();
      }, 15_000);
    } catch (e) {
      this.failure(e);
    }
  }
  private async upload(remote: CloudCheckpoint, snapshot: CloudSnapshot) {
    const hash = await fingerprint(snapshot);
    const pending =
      this.pending &&
      this.pending.remote.generation === remote.generation &&
      this.pending.remote.revision === remote.revision &&
      this.pending.hash === hash
        ? this.pending
        : { remote, snapshot, hash, id: crypto.randomUUID() };
    this.pending = pending;
    const result = await this.api.write(
      remote,
      this.lease!.leaseToken,
      pending.snapshot,
      pending.id,
    );
    const saved = { ...remote, ...result, snapshot: pending.snapshot };
    await this.setBase(saved, hash);
    this.pending = null;
    this.view.cloud = saved;
    this.view.lastSynced = result.updatedAt;
    if ((await fingerprint(snapshotFromSave(this.host.save()))) === hash)
      this.phase('synced', 'Saved on this device and in the cloud.');
    else {
      this.phase('local', 'New local progress is queued for the next cloud checkpoint.');
      this.onLocalSave(this.host.scope());
    }
  }
  private async reconcile(write: boolean) {
    const remote = await this.api.read();
    this.view.cloud = remote;
    const local = snapshotFromSave(this.host.save());
    // A lost response can be recognized without replaying rewards or replacing new local progress.
    if (
      this.pending &&
      remote.generation === this.pending.remote.generation &&
      remote.revision === this.pending.remote.revision + 1 &&
      remote.snapshot &&
      (await fingerprint(remote.snapshot)) === this.pending.hash
    ) {
      await this.setBase(remote, this.pending.hash);
      this.pending = null;
    }
    const comparison = await compareCheckpoint(local, this.base, remote);
    if (comparison === 'conflict' || comparison === 'cloud') {
      this.phase(
        'conflict',
        comparison === 'cloud'
          ? 'A newer cloud checkpoint is available. Review it before replacing this local checkpoint.'
          : 'Local and cloud progress differ. Choose one; credits and rewards are never added together.',
      );
      return;
    }
    await this.acquire(remote, false);
    if (comparison === 'equal') {
      await this.setBase(remote, await fingerprint(local));
      this.view.lastSynced = remote.updatedAt;
      this.phase('synced', 'Saved on this device and in the cloud.');
    } else if (write) await this.upload(remote, local);
    else {
      this.phase('local', 'Local progress is ahead of the cloud. Sync now or keep playing.');
      this.onLocalSave(this.host.scope());
    }
  }
  async sync() {
    if (!this.active || !['synced', 'local', 'offline'].includes(this.view.phase)) return;
    await this.operation(async () => {
      await this.host.persist();
      await this.verifyOwner();
      await this.reconcile(true);
    });
  }
  async returnToGuest(signOut = false) {
    await this.operation(async () => {
      await this.host.persist();
      if (signOut) await this.api.logout();
      await this.host.activate(await loadGame(), 'guest');
      await rememberPlayer(null);
      if (signOut && this.view.player) clearTabLease(this.view.player.id);
      this.release?.();
      this.release = null;
      this.reservedId = '';
      this.lease = null;
      this.base = null;
      this.pending = null;
      this.view.player = signOut ? null : (this.api.session?.player ?? null);
      this.view.cloud = null;
      this.view.cached = null;
      this.phase(
        'guest',
        signOut
          ? 'Signed out. Your original guest progress is restored.'
          : 'Playing as a guest. Account progress stays cached separately; it is not syncing.',
      );
    });
  }
  async deleteAccount() {
    await this.operation(async () => {
      const player = this.view.player;
      if (!player) throw new SyncError('unauthenticated');
      await this.host.persist();
      await this.verifyOwner();
      await this.reservation(player);
      await this.api.delete();
      await this.host.activate(await loadGame(), 'guest');
      await deleteAccountCache(scopeFor(player));
      clearTabLease(player.id);
      await forgetAccount(player.id);
      this.release?.();
      this.release = null;
      this.reservedId = '';
      this.lease = null;
      this.base = null;
      this.pending = null;
      this.view.player = null;
      this.view.cloud = null;
      this.view.cached = null;
      this.phase(
        'guest',
        'Account deleted. Your original guest save is unchanged. Server recovery copies expire within seven days.',
      );
    });
  }
  dispose() {
    clearTimeout(this.timer);
    this.release?.();
    this.release = null;
  }
}

// Kept separate so a cache failure cannot silently mark a cloud write as durable.
import { writeBase as writeSyncBase } from './cache';
