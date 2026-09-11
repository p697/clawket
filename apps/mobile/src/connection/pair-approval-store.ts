import type { AgentAdapter, ApprovalRequest, SessionUpdate } from '@clawket/agent-protocol';

export type PairApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired';

export type PairApprovalEntry = Extract<ApprovalRequest, { kind: 'pair' }> & Readonly<{
  status: PairApprovalStatus;
  resolving: boolean;
  resolutionError: boolean;
}>;

type PairTarget = PairApprovalEntry['target'];
type Listener = () => void;

const stores = new WeakMap<AgentAdapter, ConnectionPairApprovalStore>();
const MAX_RESOLVED_ENTRIES = 50;
const MAX_RESOLUTION_TOMBSTONES = 100;

function entryKey(target: PairTarget, requestId: string): string {
  return `${target}:${requestId}`;
}

function readRequestedAtMs(request: { requestedAtMs?: number }, fallback: number): number {
  if (typeof request.requestedAtMs === 'number') return request.requestedAtMs;
  const wireTimestamp = (request as { ts?: unknown }).ts;
  return typeof wireTimestamp === 'number' ? wireTimestamp : fallback;
}

function sameEntry(left: PairApprovalEntry, right: PairApprovalEntry): boolean {
  return left.id === right.id
    && left.target === right.target
    && left.displayName === right.displayName
    && left.platform === right.platform
    && left.receivedAtMs === right.receivedAtMs
    && left.status === right.status
    && left.resolving === right.resolving
    && left.resolutionError === right.resolutionError;
}

/**
 * Connection-wide projection for Gateway pair requests. Pair requests have no
 * session key, so they must not be persisted in whichever Thread happens to be
 * mounted when the event arrives.
 */
export class ConnectionPairApprovalStore {
  private entries = new Map<string, PairApprovalEntry>();
  private snapshot: ReadonlyArray<PairApprovalEntry> = [];
  private readonly listeners = new Set<Listener>();
  private readonly resolutionTombstones = new Set<string>();
  private revision = 0;
  private refreshPromise: Promise<void> | null = null;
  private refreshQueued = false;

  public constructor(
    private readonly adapter: AgentAdapter,
    private readonly now: () => number = Date.now,
  ) {
    adapter.on('update', (update) => this.handleUpdate(update));
    adapter.on('state', (state) => {
      if (state === 'ready') void this.refresh();
    });
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): ReadonlyArray<PairApprovalEntry> {
    return this.snapshot;
  }

  public get(requestId: string, target: PairTarget): PairApprovalEntry | undefined {
    return this.entries.get(entryKey(target, requestId));
  }

  public recordRequest(request: Extract<ApprovalRequest, { kind: 'pair' }>): void {
    const key = entryKey(request.target, request.id);
    if (this.resolutionTombstones.has(key)) return;
    const existing = this.entries.get(key);
    if (existing && existing.status !== 'pending') return;
    this.setEntry(key, {
      ...request,
      status: 'pending',
      resolving: existing?.resolving ?? false,
      resolutionError: existing?.resolutionError ?? false,
    });
  }

  public recordResolution(
    requestId: string,
    target: PairTarget,
    decision: string,
  ): PairApprovalEntry | undefined {
    const key = entryKey(target, requestId);
    const tombstoneAdded = this.rememberResolution(key);
    const existing = this.entries.get(key);
    if (!existing) {
      if (tombstoneAdded) this.invalidateInFlightRefresh();
      return undefined;
    }
    const status = decision === 'approved' || decision === 'approve'
      ? 'allowed'
      : decision === 'expired'
        ? 'expired'
        : 'denied';
    const next = {
      ...existing,
      status,
      resolving: false,
      resolutionError: false,
    } as const;
    this.setEntry(key, next);
    return next;
  }

  public beginResolution(requestId: string, target: PairTarget): boolean {
    const key = entryKey(target, requestId);
    const existing = this.entries.get(key);
    if (!existing || existing.status !== 'pending' || existing.resolving) return false;
    this.setEntry(key, { ...existing, resolving: true, resolutionError: false });
    return true;
  }

  public failResolution(requestId: string, target: PairTarget): void {
    const key = entryKey(target, requestId);
    const existing = this.entries.get(key);
    if (!existing || existing.status !== 'pending' || !existing.resolving) return;
    this.setEntry(key, { ...existing, resolving: false, resolutionError: true });
  }

  public completeResolution(
    requestId: string,
    target: PairTarget,
    decision: 'approve' | 'reject',
  ): PairApprovalEntry | undefined {
    const existing = this.get(requestId, target);
    if (!existing) return undefined;
    if (existing.status !== 'pending') return existing;
    return this.recordResolution(requestId, target, decision);
  }

  public refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }
    const revision = this.revision;
    const devices = this.adapter.management?.devices;
    const nodes = this.adapter.management?.nodes;
    const requests: Array<Promise<Readonly<{
      target: PairTarget;
      pending: ReadonlyArray<{
        requestId: string;
        displayName?: string;
        platform?: string;
        requestedAtMs?: number;
      }>;
    }> | null>> = [];
    if (devices?.list) {
      requests.push(devices.list()
        .then((result) => ({ target: 'device' as const, pending: result.pending }))
        .catch(() => null));
    }
    if (nodes?.pairRequests) {
      requests.push(nodes.pairRequests()
        .then((result) => ({ target: 'node' as const, pending: result.pending }))
        .catch(() => null));
    }

    this.refreshPromise = Promise.all(requests)
      .then((results) => {
        if (this.revision !== revision) {
          this.refreshQueued = true;
          return;
        }
        const next = new Map(this.entries);
        for (const result of results) {
          if (!result) continue;
          const incoming = new Set(result.pending
            .map((request) => entryKey(result.target, request.requestId))
            .filter((key) => !this.resolutionTombstones.has(key)));
          for (const [key, entry] of next) {
            if (
              entry.target === result.target
              && entry.status === 'pending'
              && !entry.resolving
              && !incoming.has(key)
            ) {
              next.delete(key);
            }
          }
          for (const request of result.pending) {
            const key = entryKey(result.target, request.requestId);
            if (this.resolutionTombstones.has(key)) continue;
            const existing = next.get(key);
            if (existing && existing.status !== 'pending') continue;
            next.set(key, {
              kind: 'pair',
              id: request.requestId,
              target: result.target,
              displayName: request.displayName ?? null,
              platform: request.platform ?? null,
              receivedAtMs: readRequestedAtMs(request, existing?.receivedAtMs ?? this.now()),
              status: 'pending',
              resolving: existing?.resolving ?? false,
              resolutionError: existing?.resolutionError ?? false,
            });
          }
        }
        this.replaceEntries(next);
      })
      .finally(() => {
        this.refreshPromise = null;
        if (!this.refreshQueued) return;
        this.refreshQueued = false;
        void this.refresh();
      });
    return this.refreshPromise;
  }

  private handleUpdate(update: SessionUpdate): void {
    if (update.type === 'approval_requested' && update.approval.kind === 'pair') {
      this.recordRequest(update.approval);
      return;
    }
    if (
      update.type === 'approval_resolved'
      && update.kind === 'pair'
      && update.target
    ) {
      this.recordResolution(update.approvalId, update.target, update.decision);
      return;
    }
    if (update.type === 'history_reconciled') void this.refresh();
  }

  private setEntry(key: string, entry: PairApprovalEntry): void {
    const existing = this.entries.get(key);
    if (existing && sameEntry(existing, entry)) return;
    if (this.refreshPromise) this.refreshQueued = true;
    const next = new Map(this.entries);
    next.set(key, entry);
    this.replaceEntries(next);
  }

  private rememberResolution(key: string): boolean {
    if (this.resolutionTombstones.has(key)) return false;
    this.resolutionTombstones.add(key);
    while (this.resolutionTombstones.size > MAX_RESOLUTION_TOMBSTONES) {
      const oldest = this.resolutionTombstones.values().next().value;
      if (typeof oldest !== 'string') break;
      this.resolutionTombstones.delete(oldest);
    }
    return true;
  }

  private invalidateInFlightRefresh(): void {
    if (this.refreshPromise) this.refreshQueued = true;
    this.revision += 1;
  }

  private replaceEntries(entries: Map<string, PairApprovalEntry>): void {
    const resolved = [...entries.entries()]
      .filter(([, entry]) => entry.status !== 'pending')
      .sort((left, right) => right[1].receivedAtMs - left[1].receivedAtMs);
    for (const [key] of resolved.slice(MAX_RESOLVED_ENTRIES)) entries.delete(key);
    const unchanged = entries.size === this.entries.size
      && [...entries].every(([key, entry]) => {
        const existing = this.entries.get(key);
        return existing ? sameEntry(existing, entry) : false;
      });
    if (unchanged) return;
    this.entries = entries;
    this.snapshot = [...entries.values()].sort((left, right) => (
      right.receivedAtMs - left.receivedAtMs
      || entryKey(left.target, left.id).localeCompare(entryKey(right.target, right.id))
    ));
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

export function getConnectionPairApprovalStore(
  adapter: AgentAdapter,
): ConnectionPairApprovalStore {
  const existing = stores.get(adapter);
  if (existing) return existing;
  const store = new ConnectionPairApprovalStore(adapter);
  stores.set(adapter, store);
  return store;
}
