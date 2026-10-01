import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AgentAdapter, SessionActivity } from '@clawket/agent-protocol';

/** One serial, foreground-only read of the visible window; no catalog/cache mutations. */
export function useSessionActivity(adapter: AgentAdapter | null | undefined, enabled: boolean, keys: readonly string[]) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const signature = JSON.stringify(keys.slice(0, 32));
  const scope = `${adapter?.connection.id ?? ''}:${signature}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; adapter: typeof adapter; values: ReadonlyMap<string, SessionActivity> }>();
  const reader = enabled && foreground && adapter?.state === 'ready' ? adapter.readSessionActivity : undefined;
  const generation = useRef(0);
  const pending = useRef(new WeakMap<AgentAdapter, Promise<SessionActivity[]>>());
  useEffect(() => {
    const current = ++generation.current;
    setSnapshot(undefined);
    if (!reader || !adapter) return;
    const targets = JSON.parse(signature) as string[];
    const revisions = new Map<string, number>();
    const runs = new Map<string, string>();
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const alive = () => generation.current === current && adapter.state === 'ready';
    const publish = (activity: SessionActivity) => {
      if (!alive() || !targets.includes(activity.key)) return;
      setSnapshot(previous => {
        const sameScope = previous?.scope === scope && previous.adapter === adapter;
        const old = sameScope ? previous.values.get(activity.key) : undefined;
        if (old?.state === activity.state && old.attention === activity.attention) return previous;
        return { scope, adapter, values: new Map([...(sameScope ? previous.values : []), [activity.key, activity]]) };
      });
    };
    const off = adapter.on('update', update => {
      const key = update.type === 'session_activity_update' ? update.activity.key
        : update.type === 'session_info_update' ? update.session.key : 'sessionKey' in update ? update.sessionKey : undefined;
      if (!key || !targets.includes(key)) return;
      if (!['session_activity_update', 'session_info_update', 'run_started', 'run_finished'].includes(update.type)) return;
      revisions.set(key, (revisions.get(key) ?? 0) + 1);
      if (update.type === 'session_activity_update') publish(update.activity);
      if (update.type === 'run_started') { runs.set(key, update.runId); publish({ key, state: 'running' }); }
      if (update.type === 'run_finished' && (!runs.has(key) || runs.get(key) === update.runId)) {
        runs.delete(key); publish({ key, state: 'idle', attention: null });
      }
      if (update.type === 'session_info_update' && typeof update.session.hasActiveRun === 'boolean') {
        const attention = update.session.attention;
        publish({ key, state: attention === 'input' || attention === 'approval' ? 'waiting'
          : update.session.hasActiveRun ? 'running' : 'idle', attention: attention === 'input' || attention === 'approval' ? attention : null });
      }
    });
    const read = async () => {
      if (!alive() || inFlight || !targets.length) return;
      inFlight = true;
      let request: Promise<SessionActivity[]> | undefined;
      let before = new Map(revisions);
      try {
        const previous = pending.current.get(adapter);
        if (previous) await previous.catch(() => undefined);
        if (!alive()) return;
        before = new Map(revisions);
        request = reader.call(adapter, targets);
        pending.current.set(adapter, request);
        const values = await request;
        if (alive()) for (const activity of values) {
          if ((before.get(activity.key) ?? 0) === (revisions.get(activity.key) ?? 0)) publish(activity);
        }
      } catch {
        if (alive()) for (const key of targets) if ((before.get(key) ?? 0) === (revisions.get(key) ?? 0)) publish({ key, state: 'unknown' });
      } finally {
        if (request && pending.current.get(adapter) === request) pending.current.delete(adapter);
        inFlight = false;
        if (alive()) timer = setTimeout(() => { void read(); }, 15_000);
      }
    };
    void read();
    return () => { generation.current++; off(); if (timer) clearTimeout(timer); };
  }, [adapter, reader, scope, signature]);
  const activities = useMemo(() => {
    if (!reader) return new Map<string, SessionActivity>();
    const values = snapshot?.scope === scope && snapshot.adapter === adapter ? snapshot.values : undefined;
    return new Map((JSON.parse(signature) as string[]).map(key => [key, values?.get(key) ?? { key, state: 'unknown' as const }]));
  }, [adapter, reader, scope, signature, snapshot]);
  return { activities, active: enabled && foreground };
}
