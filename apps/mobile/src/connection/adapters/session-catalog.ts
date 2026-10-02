import {
  AdapterError,
  type SessionCatalogRevision,
  type SessionCatalogSyncRequest,
  type SessionCatalogSyncResponse,
  type SessionDescriptor,
} from '@clawket/agent-protocol';
import { getWebSocketFrameByteLength } from '../transports/frame-limit';

const PAGE_BYTES = 64 * 1024;
const CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_SESSIONS = 10_000;
const REVISION = /^[a-f0-9]{32}$/;
const KINDS = new Set(['main', 'channel', 'direct', 'group', 'subagent', 'cron', 'other']);
type Snapshot = SessionCatalogRevision & { sessions: SessionDescriptor[] };
type Request = (method: 'sessions.list' | 'sessions.sync', params: Record<string, unknown>) => Promise<unknown>;

/** Local cancellation only; never inferred from a backend error code or prose. */
export class SessionCatalogSupersededError extends AdapterError {
  constructor() {
    super('network', 'Session catalog read was superseded');
    this.name = 'SessionCatalogSupersededError';
  }
}

function invalid(): never { throw new AdapterError('server', 'Invalid session catalog response'); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function byteLength(value: unknown): number {
  try { return getWebSocketFrameByteLength(JSON.stringify(value)) ?? invalid(); }
  catch { return invalid(); }
}
function revision(value: unknown): value is string { return typeof value === 'string' && REVISION.test(value); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function timestamp(value: unknown): boolean { return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0); }
function descriptor(value: unknown): value is SessionDescriptor {
  if (!object(value) || typeof value.key !== 'string' || !value.key || value.key.length > 1024 || typeof value.connectionId !== 'string'
    || typeof value.agentId !== 'string' || !value.agentId || typeof value.title !== 'string'
    || typeof value.kind !== 'string' || !KINDS.has(value.kind) || !timestamp(value.updatedAt) || typeof value.hasActiveRun !== 'boolean'
    || !object(value.allowedActions)) return false;
  const actions = value.allowedActions;
  if (!['rename', 'reset', 'delete', 'pin'].every(key => typeof actions[key] === 'boolean')) return false;
  if (actions.archive !== undefined && typeof actions.archive !== 'boolean') return false;
  if (value.lastActivityAt !== undefined && !timestamp(value.lastActivityAt)) return false;
  if (value.archived !== undefined && typeof value.archived !== 'boolean') return false;
  if (value.canContinue !== undefined && typeof value.canContinue !== 'boolean') return false;
  if (value.source !== undefined && value.source !== 'bridge' && value.source !== 'native') return false;
  if (value.attention !== undefined && value.attention !== null && (typeof value.attention !== 'string'
    || !['input', 'approval', 'error', 'cron_failed'].includes(value.attention))) return false;
  if (value.continuationBlockedReason !== undefined && (typeof value.continuationBlockedReason !== 'string'
    || !['in_use', 'ownership_unknown', 'project_unavailable'].includes(value.continuationBlockedReason))) return false;
  if (value.project !== undefined && (!object(value.project) || typeof value.project.id !== 'string'
    || typeof value.project.name !== 'string' || typeof value.project.path !== 'string' || typeof value.project.available !== 'boolean')) return false;
  return ['preview', 'model', 'modelProvider', 'sessionId', 'parentSessionKey', 'channel']
    .every(key => value[key] === undefined || typeof value[key] === 'string');
}
function copy(session: SessionDescriptor): SessionDescriptor {
  return { ...session, allowedActions: { ...session.allowedActions }, ...(session.project ? { project: { ...session.project } } : {}) };
}
function uniqueKeys(values: unknown): values is string[] {
  return Array.isArray(values) && values.length <= MAX_SESSIONS
    && values.every(key => typeof key === 'string' && key.length > 0) && new Set(values).size === values.length;
}
function sessions(values: unknown): asserts values is SessionDescriptor[] {
  if (!Array.isArray(values) || values.length > MAX_SESSIONS || !values.every(descriptor)
    || new Set(values.map(session => session.key)).size !== values.length) invalid();
}
function response(value: unknown): SessionCatalogSyncResponse {
  if (!object(value) || !revision(value.epoch) || byteLength(value) > PAGE_BYTES) invalid();
  if (value.kind === 'expired') return value as unknown as SessionCatalogSyncResponse;
  if (!revision(value.revision) || !['full', 'delta', 'unchanged'].includes(String(value.kind))) invalid();
  return value as unknown as SessionCatalogSyncResponse;
}

/** A complete wire baseline, isolated from UI/event objects and socket incarnations. */
export class SessionCatalogConsumer {
  private enabled = false;
  private pageIndex = false;
  private generation = 0;
  private baseline: Snapshot | null = null;
  private pending: Promise<Snapshot> | null = null;

  constructor(private readonly request: Request) {}

  configure(version: unknown, pageIndexVersion?: unknown): void {
    const enabled = version === 1;
    const pageIndex = enabled && pageIndexVersion === 1;
    if (this.enabled !== enabled || this.pageIndex !== pageIndex) { this.generation++; this.pending = null; }
    this.enabled = enabled;
    this.pageIndex = pageIndex;
    if (!enabled) this.baseline = null;
  }

  /** Same configured adapter may reuse a complete baseline after fresh negotiation. */
  retire(): void {
    this.generation++; this.enabled = false; this.pageIndex = false; this.pending = null;
  }

  /** An acknowledged management write cannot join a catalog read begun before it. */
  invalidate(): void {
    this.generation++; this.pending = null;
  }

  async list(): Promise<SessionDescriptor[]> {
    if (!this.enabled) return await this.request('sessions.list', {}) as SessionDescriptor[];
    const generation = this.generation;
    if (!this.pending) {
      const attempt = this.sync(generation).finally(() => { if (this.pending === attempt) this.pending = null; });
      this.pending = attempt;
    }
    const snapshot = await this.pending;
    this.assertCurrent(generation);
    return snapshot.sessions.map(copy);
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation || !this.enabled) throw new SessionCatalogSupersededError();
  }

  private async read(params: SessionCatalogSyncRequest, generation: number): Promise<SessionCatalogSyncResponse> {
    this.assertCurrent(generation);
    let value: unknown;
    try { value = await this.request('sessions.sync', { ...params }); }
    catch (error) { this.assertCurrent(generation); throw error; }
    this.assertCurrent(generation);
    return response(value);
  }

  private async sync(generation: number): Promise<Snapshot> {
    const baseline = this.baseline;
    const initial = (base?: SessionCatalogRevision): SessionCatalogSyncRequest => ({ ...(base ? { base: { epoch: base.epoch, revision: base.revision } } : {}), ...(this.pageIndex ? { pageIndex: true } : {}) });
    let next = await this.read(initial(baseline ?? undefined), generation);
    let restarts = 0;
    for (;;) {
      if (next.kind === 'unchanged') {
        if (!baseline || next.epoch !== baseline.epoch || next.revision !== baseline.revision) invalid();
        return this.commit(baseline, generation);
      }
      if (next.kind === 'delta') {
        if (!baseline || next.epoch !== baseline.epoch || next.baseRevision !== baseline.revision
          || next.revision === baseline.revision) invalid();
        sessions(next.upserts);
        if (!uniqueKeys(next.removedKeys) || !uniqueKeys(next.order)) invalid();
        const map = new Map(baseline.sessions.map(session => [session.key, session]));
        const removed = new Set(next.removedKeys);
        for (const key of removed) if (!map.delete(key)) invalid();
        for (const session of next.upserts) {
          if (removed.has(session.key)) invalid();
          map.set(session.key, copy(session));
        }
        if (map.size !== next.order.length || next.order.some(key => !map.has(key))) invalid();
        const result = next.order.map(key => map.get(key)!);
        if (byteLength(result) > CATALOG_BYTES) invalid();
        return this.commit({ epoch: next.epoch, revision: next.revision, sessions: result }, generation);
      }
      if (next.kind !== 'full' || next.offset !== 0) invalid();
      const epoch = next.epoch, version = next.revision, total = next.total;
      if (!integer(total) || total > MAX_SESSIONS) invalid();
      const offsets = this.pageIndex ? next.pageOffsets : undefined;
      if (offsets !== undefined && (!Array.isArray(offsets) || offsets.length > 512
        || offsets.some((offset, i) => !integer(offset) || offset === 0 || offset >= total || (i > 0 && offset <= offsets[i - 1]))
        || (next.nextOffset === null ? offsets.length !== 0 : offsets[0] !== next.nextOffset))) invalid();
      let fetched = 0;
      let queued: SessionCatalogSyncResponse[] = [];
      const result: SessionDescriptor[] = [];
      const keys = new Set<string>();
      let bytes = 2;
      for (;;) {
        if (next.kind !== 'full' || next.epoch !== epoch || next.revision !== version || next.total !== total
          || next.offset !== result.length) invalid();
        sessions(next.sessions);
        for (const session of next.sessions) {
          if (keys.has(session.key)) invalid();
          keys.add(session.key);
          bytes += byteLength(session) + (result.length > 0 ? 1 : 0);
          if (bytes > CATALOG_BYTES || result.length >= total) invalid();
          result.push(copy(session));
        }
        if (next.nextOffset === null) {
          if (result.length !== total) invalid();
          if (offsets && (fetched !== offsets.length || queued.length)) invalid();
          return this.commit({ epoch, revision: version, sessions: result }, generation);
        }
        if (!integer(next.nextOffset) || next.nextOffset !== result.length || result.length >= total || next.sessions.length === 0) invalid();
        if (offsets) {
          if (!queued.length) {
            const batch = offsets.slice(fetched, fetched + 3);
            if (!batch.length || batch[0] !== result.length) invalid();
            // Settle the whole bounded window even on one failed page. A retry
            // must not accumulate orphaned continuations behind a fast error.
            const settled = await Promise.allSettled(batch.map(offset => this.read({ page: { epoch, revision: version, offset } }, generation)));
            this.assertCurrent(generation);
            queued = settled.map(result => {
              if (result.status === 'rejected') throw result.reason;
              return result.value;
            });
            fetched += batch.length;
          }
          next = queued.shift()!;
        } else {
          next = await this.read({ page: { epoch, revision: version, offset: result.length } }, generation);
        }
        if (next.kind === 'expired') {
          if (restarts++ > 0) invalid();
          next = await this.read(initial(), generation);
          // A restart cannot apply a delta to the previous partial snapshot.
          if (next.kind !== 'full') invalid();
          break;
        }
      }
    }
  }

  private commit(snapshot: Snapshot, generation: number): Snapshot {
    this.assertCurrent(generation);
    this.baseline = snapshot;
    return snapshot;
  }
}
