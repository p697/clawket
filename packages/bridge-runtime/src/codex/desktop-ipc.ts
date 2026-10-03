import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DESKTOP_IPC_FRAME_BYTES as LIMIT, DesktopHistoryLimitError } from './desktop-limits.js';

// Protocol reference: remodex e0e342d (Apache-2.0). No router, filesystem mutation,
// desktop process control or automatic retry of a delivered operation lives here.
const versions: Record<string, number> = {
  'thread-stream-state-changed': 11, 'thread-follower-start-turn': 2,
  'thread-follower-interrupt-turn': 4, 'thread-archived': 2,
  'thread-follower-update-thread-settings': 2,
};
// Native routing can spend 10s discovering an owner, then 10s awaiting its
// response. Expiring at the discovery boundary loses explicit no-owner proof.
const REQUEST_TIMEOUT_MS = 25_000;
export class DesktopIpcError extends Error {
  constructor(readonly outcome: 'no-owner' | 'uncertain' | 'rejected', message: string, readonly reason?: 'broker-unavailable' | 'version-mismatch') { super(message); }
}
export type DesktopSnapshot = { state: any; source: string; revision?: number; fresh: boolean };

/** Strict, bounded Immer patch application. Invalid baselines require a new snapshot. */
export function applyDesktopPatches(state: any, patches: any[]): any {
  if (!Array.isArray(patches) || patches.length > 2000) throw new Error('Invalid desktop patches');
  const next = structuredClone(state);
  for (const patch of patches) {
    if (!Array.isArray(patch.path) || !patch.path.length || patch.path.length > 32 || patch.path.some((k: unknown) => !['string', 'number'].includes(typeof k) || ['__proto__', 'constructor', 'prototype'].includes(String(k)))) throw new Error('Invalid desktop patch path');
    let parent = next;
    for (const key of patch.path.slice(0, -1)) { if (!parent || !Object.hasOwn(parent, key)) throw new Error('Missing desktop baseline'); parent = parent[key]; }
    const key = patch.path.at(-1);
    if (!parent || typeof parent !== 'object') throw new Error('Missing desktop baseline');
    if (Array.isArray(parent)) {
      if (!Number.isSafeInteger(key) || key < 0 || key > parent.length || (patch.op !== 'add' && key === parent.length)) throw new Error('Invalid desktop index');
      if (patch.op === 'remove') parent.splice(key, 1);
      else if (patch.op === 'add') parent.splice(key, 0, patch.value);
      else if (patch.op === 'replace') parent[key] = patch.value;
      else throw new Error('Invalid desktop operation');
    } else if (patch.op === 'remove') delete parent[key];
    else if (patch.op === 'add' || (patch.op === 'replace' && Object.hasOwn(parent, key))) parent[key] = patch.value;
    else throw new Error('Invalid desktop operation');
  }
  return next;
}

export class DesktopIpc extends EventEmitter {
  private socket?: Socket;
  private clientId = '';
  private connecting?: Promise<void>;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, { method: string; conversationId?: string; resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private followed = new Set<string>();
  private permanentFollows = new Set<string>();
  private followGenerations = new Map<string, number>();
  private stateGenerations = new Map<string, number>();
  private nextFollowGeneration = 0;
  private noOwner = new Set<string>();
  private ownerProbeQueue = new Set<string>();
  private ownerProbes = new Map<string, number>();
  /** Service work stays protected even before a native active snapshot arrives. */
  followProtected?: (id: string) => boolean;
  handler?: { accepts(method: string, params: any): boolean; request(method: string, params: any): Promise<any> };
  broadcast(method: string, params: object): void {
    if (this.ready) this.write({ type: 'broadcast', method, version: versions[method] ?? 1, sourceClientId: this.clientId, params });
  }
  readonly snapshots = new Map<string, DesktopSnapshot>();
  constructor(private readonly paths = process.platform === 'win32' ? ['\\\\.\\pipe\\codex-ipc'] : [join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock'), join(tmpdir(), 'codex-ipc', `ipc-${process.getuid?.() ?? 0}.sock`)]) { super(); }
  get ready(): boolean { return !!this.clientId && !this.socket?.destroyed; }
  async connect(): Promise<void> {
    if (this.closed) throw new Error('Desktop connection stopped');
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      for (const path of this.paths) {
        try { await this.open(path); return; } catch { /* Try the legacy socket without mutating it. */ }
      }
      // This error is emitted before any thread operation is dispatched. It is
      // deliberately distinct from a lost acknowledgement after sending one.
      throw new DesktopIpcError('uncertain', 'Codex Desktop is unavailable. Open it on your computer to continue this conversation.', 'broker-unavailable');
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async open(path: string): Promise<void> {
    const socket = createConnection(path); this.socket = socket;
    const header = Buffer.alloc(4); let headerBytes = 0, body: Buffer | undefined, bodyBytes = 0;
    socket.on('data', chunk => {
      if (this.socket !== socket) return;
      let offset = 0;
      while (offset < chunk.length) {
        if (!body) {
          const count = Math.min(4 - headerBytes, chunk.length - offset);
          chunk.copy(header, headerBytes, offset, offset + count); headerBytes += count; offset += count;
          if (headerBytes < 4) return;
          const size = header.readUInt32LE(0); headerBytes = 0;
          if (!size || size > LIMIT) { socket.destroy(); return; }
          body = Buffer.allocUnsafe(size); bodyBytes = 0;
        }
        const count = Math.min(body.length - bodyBytes, chunk.length - offset);
        chunk.copy(body, bodyBytes, offset, offset + count); bodyBytes += count; offset += count;
        if (bodyBytes < body.length) return;
        const completed = body; body = undefined; bodyBytes = 0;
        try { this.receive(JSON.parse(completed.toString('utf8'))); }
        catch { socket.destroy(); return; }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      body = undefined;
      if (this.socket !== socket) return;
      this.clientId = ''; this.socket = undefined;
      this.noOwner.clear(); this.ownerProbeQueue.clear();
      for (const value of this.snapshots.values()) value.fresh = false;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new DesktopIpcError('uncertain', 'Desktop connection interrupted; check the task before retrying.')); }
      this.pending.clear(); this.emit('offline');
      if (!this.closed && this.followed.size && !this.retry) this.retry = setTimeout(() => { this.retry = undefined; void this.connect().catch(() => {}); }, 2000);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('Desktop connection timed out')); }, 1500);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.once('error', error => { clearTimeout(timer); reject(error); });
      });
      const result = await this.call('initialize', { clientType: 'clawket-bridge' }, true);
      if (typeof result?.clientId !== 'string' || !result.clientId) throw new Error('Invalid desktop handshake');
      this.clientId = result.clientId;
      for (const id of this.followed) { this.announceFollowing(id, true); this.queueOwnerProbe(id); }
      this.emit('ready');
    } catch (error) { socket.destroy(); throw error; }
  }
  private write(value: any): void {
    if (!this.socket || this.socket.destroyed) throw new DesktopIpcError('uncertain', 'Desktop connection unavailable');
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > LIMIT) throw new DesktopHistoryLimitError();
    if (this.socket.writableLength + body.length + 4 > LIMIT) throw new Error('Desktop transfer is busy; refresh shortly');
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length); this.socket.write(Buffer.concat([header, body]));
  }
  private call(method: string, params: object, initializing = false, version = versions[method] ?? 1): Promise<any> {
    if (this.pending.size >= 32) return Promise.reject(new Error('Too many desktop requests'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); queueMicrotask(() => this.probeOwners()); reject(new DesktopIpcError('uncertain', 'Desktop has not confirmed this operation. Do not send it again automatically.')); }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { method, conversationId: (params as { conversationId?: string }).conversationId, resolve, reject, timer });
      try { this.write({ type: 'request', requestId, sourceClientId: initializing ? 'initializing-client' : this.clientId, version, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); queueMicrotask(() => this.probeOwners()); reject(error); }
    });
  }
  async request(method: string, params: object): Promise<any> {
    await this.connect();
    const socket = this.socket, clientId = this.clientId;
    try { return await this.call(method, params); }
    catch (error) {
      // Settings v2 adds active-turn/conditional operations. Our outbound
      // next-turn settings subset also exists in v1. The native receiver emits
      // this exact error before dispatch; no ambiguous write is ever replayed.
      if (method !== 'thread-follower-update-thread-settings'
        || Object.hasOwn(params, 'activeTurnId') || Object.hasOwn(params, 'condition')
        || !(error instanceof DesktopIpcError) || error.reason !== 'version-mismatch'
        || !this.ready || this.socket !== socket || this.clientId !== clientId) throw error;
      return this.call(method, params, false, 1);
    }
  }
  follow(id: string): void {
    if (this.closed) throw new Error('Desktop connection stopped');
    if (!this.followed.has(id) && this.followed.size >= 64) {
      const disposable = [...this.followed].find(key => !this.permanentFollows.has(key))
        ?? [...this.followed].find(key => this.idleFollow(key));
      if (!disposable) throw new Error('Too many active or unconfirmed desktop conversations; refresh after tasks finish');
      this.releaseFollow(disposable);
    }
    const alreadyFollowed = this.followed.has(id), alreadyOpened = this.permanentFollows.has(id);
    this.permanentFollows.add(id);
    if (!alreadyFollowed) this.followGenerations.set(id, ++this.nextFollowGeneration);
    // Insertion order is the recency order; repeatedly reading a chat renews it.
    this.followed.delete(id);
    this.followed.add(id);
    try { this.announceFollowing(id, true); }
    catch (error) {
      if (!alreadyOpened) this.permanentFollows.delete(id);
      if (!alreadyFollowed) { this.followed.delete(id); this.followGenerations.delete(id); }
      throw error;
    }
    this.queueOwnerProbe(id);
  }
  /** Bounded catalog observation never acquires an owner or loads complete history. */
  observe(id: string): boolean {
    if (this.closed) return false;
    if (!this.followed.has(id) && this.followed.size >= 64) return false;
    if (!this.followed.has(id)) this.followGenerations.set(id, ++this.nextFollowGeneration);
    this.followed.add(id);
    this.announceFollowing(id, true);
    return true;
  }
  isObservationOnly(id: string): boolean { return this.followed.has(id) && !this.permanentFollows.has(id); }
  unobserve(id: string): void {
    if (this.permanentFollows.has(id)) return;
    this.releaseFollow(id);
  }
  private idleFollow(id: string): boolean {
    if (this.followProtected?.(id) || [...this.pending.values()].some(request => request.conversationId === id)) return false;
    const snapshot = this.snapshots.get(id);
    if (snapshot) {
      const state = snapshot.state, history = state?.turnHistory?.history;
      let turns = state?.turns;
      if (state?.turnHistory?.kind === 'canonical') {
        if (!history?.entitiesByKey || typeof history.entitiesByKey !== 'object' || Array.isArray(history.entitiesByKey)
          || !Array.isArray(history.islands)) return false;
        for (const island of history.islands) {
          if (!island || !Array.isArray(island.entries)) return false;
          for (const entry of island.entries) {
            const key = typeof entry === 'string' ? entry : entry?.value ?? entry?.key;
            if (typeof key !== 'string' || !Object.hasOwn(history.entitiesByKey, key)) return false;
          }
        }
        // Hidden/unreferenced entities may still be active. An empty projected
        // island is never proof that the native graph has no active turn.
        turns = Object.values(history.entitiesByKey);
      }
      return Array.isArray(turns) && (snapshot.fresh || (this.ready && this.noOwner.has(id))) && Array.isArray(state?.requests)
        && state.requests.every((request: any) => request?.completed === true)
        && turns.every((turn: any) => ['completed', 'interrupted', 'failed'].includes(turn?.status));
    }
    return this.ready && this.noOwner.has(id);
  }
  private releaseFollow(id: string): void {
    if (!this.followed.has(id)) return;
    // Retire native observation before changing local membership. A failed
    // write leaves the old follow intact rather than leaking an untracked one.
    if (this.ready) this.announceFollowing(id, false);
    this.followed.delete(id); this.permanentFollows.delete(id);
    this.followGenerations.delete(id); this.stateGenerations.delete(id); this.noOwner.delete(id); this.ownerProbeQueue.delete(id);
    this.snapshots.delete(id);
    this.emit('observation-released', id);
  }
  private queueOwnerProbe(id: string): void {
    if (!this.permanentFollows.has(id) || this.snapshots.get(id)?.fresh || this.noOwner.has(id)) return;
    this.ownerProbeQueue.add(id);
    queueMicrotask(() => this.probeOwners());
  }
  private probeOwners(): void {
    if (this.closed || !this.ready) return;
    for (const id of this.ownerProbeQueue) {
      if (this.ownerProbes.size >= 2 || this.pending.size >= 30) return;
      if (this.ownerProbes.has(id)) continue;
      this.ownerProbeQueue.delete(id);
      if (!this.permanentFollows.has(id) || this.snapshots.get(id)?.fresh) continue;
      const generation = this.followGenerations.get(id)!, socket = this.socket, clientId = this.clientId;
      const stateGeneration = this.stateGenerations.get(id), snapshot = this.snapshots.get(id);
      this.ownerProbes.set(id, generation);
      // No snapshot is not idle evidence. Read-only native discovery supplies
      // explicit no-owner proof without adding its deadline to history reads.
      void this.call('thread-owner-discovery', { conversationId: id }).catch(error => {
        if (error instanceof DesktopIpcError && error.outcome === 'no-owner' && this.ready
          && this.socket === socket && this.clientId === clientId && this.followGenerations.get(id) === generation
          && this.stateGenerations.get(id) === stateGeneration && this.snapshots.get(id) === snapshot) this.noOwner.add(id);
      }).finally(() => {
        if (this.ownerProbes.get(id) === generation) this.ownerProbes.delete(id);
        this.probeOwners();
      });
    }
  }
  private announceFollowing(id: string, following: boolean): void {
    if (this.ready) {
      // The owner answers this subscription (including repeated subscriptions)
      // with its current snapshot. Loading complete history here would turn a
      // normal follow or patch repair into an unbounded native history scan.
      this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: this.clientId, params: { hostId: 'local', conversationId: id, following } });
    }
    else void this.connect().catch(() => {});
  }
  private receive(frame: any): void {
    if (frame.type === 'response') {
      const p = this.pending.get(frame.requestId); if (!p) return;
      this.pending.delete(frame.requestId); clearTimeout(p.timer);
      queueMicrotask(() => this.probeOwners());
      if (frame.method !== undefined && frame.method !== p.method) { p.reject(new DesktopIpcError('uncertain', 'Unsupported desktop response')); return; }
      if (frame.resultType === 'error') {
        const error = String(frame.error);
        const outcome = /^no-client-found(?:\b|:)/.test(error) ? 'no-owner'
          : ['request-version-mismatch', 'no-handler-for-request'].includes(error) ? 'rejected' : 'uncertain';
        p.reject(new DesktopIpcError(outcome, outcome === 'uncertain'
          ? 'Codex has not confirmed this operation. Check the conversation before trying again.'
          : 'Codex Desktop could not handle this operation.', error === 'request-version-mismatch' ? 'version-mismatch' : undefined));
      }
      else if (frame.resultType === 'success') p.resolve(frame.result);
      else p.reject(new DesktopIpcError('uncertain', 'Unsupported desktop response'));
      return;
    }
    if (frame.type === 'client-discovery-request') {
      this.write({ type: 'client-discovery-response', requestId: frame.requestId, response: { canHandle: this.handler?.accepts(frame.request?.method, frame.request?.params ?? {}) === true } }); return;
    }
    if (frame.type === 'request') {
      const handler = this.handler, socket = this.socket, clientId = this.clientId;
      const current = () => this.ready && this.socket === socket && this.clientId === clientId;
      void Promise.resolve().then(() => {
        const supportedVersion = frame.version === (versions[frame.method] ?? 1)
          || (frame.method === 'thread-follower-update-thread-settings' && frame.version === 1);
        if (!current() || !handler?.accepts(frame.method, frame.params ?? {}) || !supportedVersion) throw new Error('Unsupported desktop operation');
        return handler.request(frame.method, frame.params ?? {});
      }).then(result => { if (current()) this.write({ type: 'response', requestId: frame.requestId, method: frame.method, resultType: 'success', handledByClientId: clientId, result }); }, error => {
        if (current()) this.write({ type: 'response', requestId: frame.requestId, method: frame.method, resultType: 'error', handledByClientId: this.clientId, error: error instanceof DesktopHistoryLimitError ? error.message : 'Clawket could not complete this operation' });
      }).catch(() => {});
      return;
    }
    if (frame.type === 'broadcast' && frame.method === 'thread-stream-following-changed' && frame.params?.hostId === 'local') this.emit('follow', frame.params.conversationId, frame.params.following === true);
    if (frame.type !== 'broadcast' || frame.method !== 'thread-stream-state-changed' || frame.sourceClientId === this.clientId) return;
    const p = frame.params, id = p?.conversationId;
    if (p.hostId !== 'local' || typeof frame.sourceClientId !== 'string' || !this.followed.has(id)) return; // Never cache unrelated desktop content.
    this.noOwner.delete(id); this.stateGenerations.set(id, (this.stateGenerations.get(id) ?? 0) + 1);
    if (frame.version !== 11) { this.snapshots.delete(id); this.emit('unsupported', id); return; }
    const old = this.snapshots.get(id), change = p.change;
    let state: any;
    if (change?.type === 'snapshot') state = change.conversationState;
    else if (change?.type === 'patches' && old?.fresh && old.source === frame.sourceClientId && (change.baseRevision === undefined || old.revision === change.baseRevision)) {
      try { state = applyDesktopPatches(old.state, change.patches); } catch { if (old) old.fresh = false; this.announceFollowing(id, true); return; }
    } else { if (old) old.fresh = false; this.announceFollowing(id, true); return; }
    if (!state || !Array.isArray(state.turns) || !Array.isArray(state.requests)) { if (old) old.fresh = false; this.emit('unsupported', id); return; }
    if (typeof change.revision === 'number' && old?.fresh && old.source === frame.sourceClientId && typeof old.revision === 'number' && change.revision < old.revision) return;
    this.ownerProbeQueue.delete(id);
    const next = { state, source: frame.sourceClientId, revision: change.revision, fresh: true };
    this.snapshots.set(id, next); this.emit('snapshot', id, next);
  }
  stop(): void {
    this.closed = true; if (this.retry) clearTimeout(this.retry); this.socket?.destroy();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new DesktopIpcError('uncertain', 'Desktop connection stopped')); }
    this.pending.clear(); this.ownerProbes.clear(); this.ownerProbeQueue.clear();
    this.snapshots.clear(); this.followed.clear(); this.permanentFollows.clear(); this.followGenerations.clear(); this.stateGenerations.clear(); this.noOwner.clear();
  }
}
