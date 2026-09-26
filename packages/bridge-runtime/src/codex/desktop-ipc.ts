import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Protocol reference: remodex e0e342d (Apache-2.0). No router, filesystem mutation,
// desktop process control or automatic retry of a delivered operation lives here.
const versions: Record<string, number> = {
  'thread-stream-state-changed': 11, 'thread-follower-start-turn': 2,
  'thread-follower-interrupt-turn': 4, 'thread-archived': 2,
};
const LIMIT = 8 * 1024 * 1024;
export class DesktopIpcError extends Error {
  constructor(readonly outcome: 'no-owner' | 'uncertain' | 'rejected', message: string) { super(message); }
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
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private followed = new Set<string>();
  private baselineRequests = new Map<string, number>();
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
      throw new DesktopIpcError('uncertain', 'Codex Desktop is unavailable. Open it on your computer to continue this conversation.');
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async open(path: string): Promise<void> {
    const socket = createConnection(path); this.socket = socket;
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      if (this.socket !== socket) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (size > LIMIT) { socket.destroy(); return; }
        if (buffer.length < size + 4) return;
        try { this.receive(JSON.parse(buffer.subarray(4, size + 4).toString('utf8'))); }
        catch { socket.destroy(); return; }
        buffer = buffer.subarray(size + 4);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.clientId = ''; this.socket = undefined; this.baselineRequests.clear();
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
      for (const id of this.followed) this.follow(id);
      this.emit('ready');
    } catch (error) { socket.destroy(); throw error; }
  }
  private write(value: any): void {
    if (!this.socket || this.socket.destroyed) throw new DesktopIpcError('uncertain', 'Desktop connection unavailable');
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > LIMIT || this.socket.writableLength > LIMIT) throw new Error('Desktop transfer limit exceeded');
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length); this.socket.write(Buffer.concat([header, body]));
  }
  private call(method: string, params: object, initializing = false): Promise<any> {
    if (this.pending.size >= 32) return Promise.reject(new Error('Too many desktop requests'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new DesktopIpcError('uncertain', 'Desktop has not confirmed this operation. Do not send it again automatically.')); }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.write({ type: 'request', requestId, sourceClientId: initializing ? 'initializing-client' : this.clientId, version: versions[method] ?? 1, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  async request(method: string, params: object): Promise<any> { await this.connect(); return this.call(method, params); }
  follow(id: string): void {
    if (!this.followed.has(id) && this.followed.size >= 64) throw new Error('Too many open desktop conversations');
    this.followed.add(id);
    if (this.ready) {
      this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: this.clientId, params: { hostId: 'local', conversationId: id, following: true } });
      if (Date.now() - (this.baselineRequests.get(id) ?? 0) > 2000) {
        this.baselineRequests.set(id, Date.now());
        void this.call('thread-follower-load-complete-history', { hostId: 'local', conversationId: id }).catch(() => {});
      }
    }
    else void this.connect().catch(() => {});
  }
  private receive(frame: any): void {
    if (frame.type === 'response') {
      const p = this.pending.get(frame.requestId); if (!p) return;
      this.pending.delete(frame.requestId); clearTimeout(p.timer);
      if (frame.resultType === 'error') p.reject(new DesktopIpcError(/^no-client-found(?:\b|:)/.test(String(frame.error)) ? 'no-owner' : 'rejected', 'Codex Desktop could not handle this operation.'));
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
        if (!current() || !handler?.accepts(frame.method, frame.params ?? {}) || frame.version !== (versions[frame.method] ?? 1)) throw new Error('Unsupported desktop operation');
        return handler.request(frame.method, frame.params ?? {});
      }).then(result => { if (current()) this.write({ type: 'response', requestId: frame.requestId, method: frame.method, resultType: 'success', handledByClientId: clientId, result }); }, () => {
        if (current()) this.write({ type: 'response', requestId: frame.requestId, method: frame.method, resultType: 'error', handledByClientId: this.clientId, error: 'Clawket could not complete this operation' });
      }).catch(() => {});
      return;
    }
    if (frame.type === 'broadcast' && frame.method === 'thread-stream-following-changed' && frame.params?.hostId === 'local') this.emit('follow', frame.params.conversationId, frame.params.following === true);
    if (frame.type !== 'broadcast' || frame.method !== 'thread-stream-state-changed' || frame.sourceClientId === this.clientId) return;
    const p = frame.params, id = p?.conversationId;
    if (p.hostId !== 'local' || typeof frame.sourceClientId !== 'string' || !this.followed.has(id)) return; // Never cache unrelated desktop content.
    if (frame.version !== 11) { this.snapshots.delete(id); this.emit('unsupported', id); return; }
    const old = this.snapshots.get(id), change = p.change;
    let state: any;
    if (change?.type === 'snapshot') state = change.conversationState;
    else if (change?.type === 'patches' && old?.fresh && old.source === frame.sourceClientId && (change.baseRevision === undefined || old.revision === change.baseRevision)) {
      try { state = applyDesktopPatches(old.state, change.patches); } catch { if (old) old.fresh = false; this.follow(id); return; }
    } else { if (old) old.fresh = false; this.follow(id); return; }
    if (!state || !Array.isArray(state.turns) || !Array.isArray(state.requests)) { if (old) old.fresh = false; this.emit('unsupported', id); return; }
    if (typeof change.revision === 'number' && old?.fresh && old.source === frame.sourceClientId && typeof old.revision === 'number' && change.revision < old.revision) return;
    const next = { state, source: frame.sourceClientId, revision: change.revision, fresh: true };
    this.snapshots.set(id, next); this.emit('snapshot', id, next);
  }
  stop(): void { this.closed = true; if (this.retry) clearTimeout(this.retry); this.socket?.destroy(); this.snapshots.clear(); this.followed.clear(); }
}
