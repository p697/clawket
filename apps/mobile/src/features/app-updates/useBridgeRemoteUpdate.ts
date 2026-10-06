import { useCallback, useEffect, useRef, useState } from 'react';
import { isBridgeUpdateFinished, type BridgeUpdateOperations, type BridgeUpdateStatus } from '@clawket/agent-protocol';

export type RemoteUpdateFailure = NonNullable<BridgeUpdateStatus['reason']> | 'disabled' | 'lost';
export type RemoteUpdateView =
  | { phase: 'idle' }
  | { phase: 'running'; connectionId: string; status: BridgeUpdateStatus | null; reconnecting: boolean }
  | { phase: 'updated'; connectionId: string; status: BridgeUpdateStatus }
  | { phase: 'failed'; connectionId: string; reason: RemoteUpdateFailure };

const POLL_MS = 2_000;
/** A Bridge restart normally takes well under a minute; never spin forever on a computer that went away. */
const GIVE_UP_MS = 15 * 60_000;
/** Without an accepted run ID only an in-progress run can be adopted; finished ones may be older. */
const ADOPT_WINDOW_MS = 60_000;

type Run = { connectionId: string; id: string | null; startedAt: number; last: BridgeUpdateStatus | null; timer?: ReturnType<typeof setTimeout> };

/**
 * Phone-started Bridge update (owner decision 2026-10-06). The phone only starts the official
 * updater and follows its status; poll failures while the Bridge restarts read as reconnecting.
 */
export function useBridgeRemoteUpdate(resolve: (connectionId: string) => BridgeUpdateOperations | undefined, now: () => number = Date.now) {
  const [view, setView] = useState<RemoteUpdateView>({ phase: 'idle' });
  const run = useRef<Run | null>(null);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const stop = useCallback(() => {
    if (run.current?.timer) clearTimeout(run.current.timer);
    run.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const finish = useCallback((next: RemoteUpdateView) => { stop(); setView(next); }, [stop]);

  const poll = useCallback(async () => {
    const current = run.current;
    if (!current) return;
    const elapsed = now() - current.startedAt;
    if (elapsed > GIVE_UP_MS || (current.id === null && elapsed > ADOPT_WINDOW_MS)) {
      finish({ phase: 'failed', connectionId: current.connectionId, reason: current.id === null ? 'error' : 'lost' });
      return;
    }
    const operations = resolveRef.current(current.connectionId);
    let status: BridgeUpdateStatus | null = null, reachable = false;
    if (operations) {
      try { status = await operations.status(); reachable = true; } catch { /* The Bridge is restarting. */ }
    }
    if (run.current !== current) return;
    if (status && (status.id === current.id || (current.id === null && !isBridgeUpdateFinished(status)))) {
      current.id = status.id; current.last = status;
      if (status.state === 'updated') { finish({ phase: 'updated', connectionId: current.connectionId, status }); return; }
      if (status.state === 'failed') {
        finish({ phase: 'failed', connectionId: current.connectionId, reason: status.reason ?? 'error' });
        return;
      }
    }
    setView({ phase: 'running', connectionId: current.connectionId, status: current.last, reconnecting: !reachable });
    current.timer = setTimeout(() => { void poll(); }, POLL_MS);
  }, [finish, now]);

  const start = useCallback(async (connectionId: string) => {
    if (run.current) return;
    const operations = resolveRef.current(connectionId);
    if (!operations) { setView({ phase: 'failed', connectionId, reason: 'error' }); return; }
    const current: Run = { connectionId, id: null, startedAt: now(), last: null };
    run.current = current;
    setView({ phase: 'running', connectionId, status: null, reconnecting: false });
    try {
      const result = await operations.start();
      if (run.current !== current) return;
      if (!result.accepted && result.reason === 'disabled') { finish({ phase: 'failed', connectionId, reason: 'disabled' }); return; }
      // A run already in progress on that computer is followed rather than started twice.
      if (result.status) { current.id = result.status.id; current.last = result.status; }
    } catch { /* A lost reply may still have started the updater; polling adopts it or gives up. */ }
    if (run.current === current) void poll();
  }, [finish, now, poll]);

  /** Clears a finished result, e.g. when the guide closes; a running update keeps going. */
  const dismissFinished = useCallback(() => {
    setView(previous => previous.phase === 'updated' || previous.phase === 'failed' ? { phase: 'idle' } : previous);
  }, []);

  return { view, start, dismissFinished };
}
