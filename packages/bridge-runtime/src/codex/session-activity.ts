import type { SessionActivity } from '@clawket/agent-protocol';
import type { DesktopIpc, DesktopSnapshot } from './desktop-ipc.js';
import { desktopTurns } from './desktop-state.js';

const LEASE_MS = 45_000;
type Binding = { key: string; threadId?: string; local?: SessionActivity };

/** Visible catalog observations are ephemeral, bounded and independent of native writers. */
export class CodexSessionActivity {
  private watches = new Map<string, { key: string; expires: number; observedAt?: number; activity?: SessionActivity }>();
  private closed = false;
  private queries = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly desktop: DesktopIpc, private readonly emit: (activity: SessionActivity) => void,
    private readonly now = Date.now) {
    desktop.on('snapshot', this.snapshot);
    desktop.on('offline', this.offline);
    desktop.on('unsupported', this.unsupported);
    desktop.on('observation-released', this.released);
  }

  read(bindings: Binding[]): SessionActivity[] {
    if (this.closed) return bindings.map(({ key }) => ({ key, state: 'unknown' }));
    this.prune();
    return bindings.map(({ key, threadId, local }) => {
      if (local) {
        for (const [id, watch] of this.watches) if (watch.key === key) {
          this.watches.delete(id); this.desktop.unobserve(id);
        }
        return local;
      }
      if (!threadId || !this.desktop.observe(threadId)) return { key, state: 'unknown' };
      const watch = this.watches.get(threadId);
      this.watches.set(threadId, { key, expires: this.now() + LEASE_MS,
        observedAt: watch?.key === key ? watch.observedAt : undefined,
        activity: watch?.key === key ? watch.activity : undefined });
      if (!this.timer) { this.timer = setInterval(() => this.prune(), 5_000); this.timer.unref?.(); }
      return this.desktop.ready && watch?.observedAt !== undefined && this.now() - watch.observedAt < LEASE_MS
        ? watch.activity ?? { key, state: 'unknown' }
        : { key, state: 'unknown' };
    });
  }

  /** Wait briefly for the owner's renewed snapshot, using the legacy origin-routed RPC response. */
  query(bindings: Binding[]): Promise<SessionActivity[]> {
    return new Promise(resolve => {
      const waiting = new Set(bindings.filter(binding => !binding.local && binding.threadId).map(binding => binding.threadId!));
      let initialized = false, finished = false;
      const current = () => bindings.map(({ key, threadId, local }) => {
        if (this.closed) return { key, state: 'unknown' as const };
        if (local) return local;
        const watch = threadId ? this.watches.get(threadId) : undefined;
        return this.desktop.ready && watch?.key === key && watch.observedAt !== undefined
          && this.now() - watch.observedAt < LEASE_MS ? watch.activity ?? { key, state: 'unknown' as const }
          : { key, state: 'unknown' as const };
      });
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer); this.queries.delete(finish);
        this.desktop.off('snapshot', received); this.desktop.off('offline', finish);
        resolve(current());
      };
      const received = (id: string) => { waiting.delete(id); if (initialized && !waiting.size) finish(); };
      const timer = setTimeout(finish, 1_500);
      this.queries.add(finish); this.desktop.on('snapshot', received); this.desktop.on('offline', finish);
      this.read(bindings);
      for (const id of waiting) if (!this.watches.has(id)) waiting.delete(id);
      initialized = true; if (!waiting.size) finish();
    });
  }

  private snapshot = (id: string, snapshot: DesktopSnapshot): void => {
    const watch = this.watches.get(id);
    if (!watch || watch.expires <= this.now()) return;
    let state: SessionActivity['state'] = 'unknown';
    let attention: SessionActivity['attention'] = null;
    try {
      const source = snapshot.state;
      const canonical = source?.turnHistory?.kind === 'canonical';
      const history = source?.turnHistory?.history;
      const supported = snapshot.fresh && (canonical
        ? history && history.entitiesByKey && typeof history.entitiesByKey === 'object'
          && !Array.isArray(history.entitiesByKey) && Array.isArray(history.islands)
        : Array.isArray(source?.turns));
      if (supported) {
        if (source.requests !== undefined && !Array.isArray(source.requests)) throw new Error('Invalid activity projection');
        const turns = desktopTurns(source);
        const requests = Array.isArray(source.requests) ? source.requests.filter((request: any) => request.completed !== true) : [];
        attention = requests.some((request: any) => request.method === 'item/tool/requestUserInput') ? 'input'
          : requests.some((request: any) => /Approval|requestApproval|requestPermissions/.test(request.method ?? '')) ? 'approval' : null;
        state = requests.length ? 'waiting'
          : turns.some((turn: any) => ['inProgress', 'running', 'active'].includes(turn.status)) ? 'running'
            : turns.every((turn: any) => ['completed', 'interrupted', 'failed'].includes(turn.status)) ? 'idle' : 'unknown';
      }
    } catch { state = 'unknown'; attention = null; } // Invalid native projection cannot break another client's IPC stream.
    const activity: SessionActivity = { key: watch.key, state, attention };
    watch.observedAt = this.now();
    const changed = watch.activity?.state !== activity.state || watch.activity?.attention !== activity.attention;
    watch.activity = activity;
    if (changed) this.emit(activity);
  };
  private unsupported = (id: string): void => {
    const watch = this.watches.get(id);
    if (watch) {
      watch.observedAt = undefined;
      if (watch.activity?.state === 'unknown' && watch.activity.attention === undefined) return;
      watch.activity = { key: watch.key, state: 'unknown' }; this.emit(watch.activity);
    }
  };
  private released = (id: string): void => {
    const watch = this.watches.get(id);
    if (!watch) return;
    this.watches.delete(id); this.emit({ key: watch.key, state: 'unknown' });
  };
  private offline = (): void => { for (const id of this.watches.keys()) this.unsupported(id); };
  private prune(): void {
    for (const [id, watch] of this.watches) {
      if (watch.expires <= this.now()) {
        this.watches.delete(id); this.desktop.unobserve(id);
        this.emit({ key: watch.key, state: 'unknown' });
      } else if (watch.observedAt !== undefined && this.now() - watch.observedAt >= LEASE_MS) this.unsupported(id);
    }
    if (!this.watches.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }
  stop(): void {
    this.closed = true;
    for (const finish of this.queries) finish();
    if (this.timer) clearInterval(this.timer);
    this.desktop.off('snapshot', this.snapshot); this.desktop.off('offline', this.offline); this.desktop.off('unsupported', this.unsupported);
    this.desktop.off('observation-released', this.released);
    for (const id of this.watches.keys()) this.desktop.unobserve(id);
    this.watches.clear();
  }
}
