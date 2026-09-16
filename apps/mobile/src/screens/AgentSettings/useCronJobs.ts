import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAdapter, AgentDescriptor, CronJob } from '@clawket/agent-protocol';
import { loadAgentCronJobs } from './cron-model';

// In-memory, adapter- and Agent-scoped cache for native stack navigation/offline reads.
const cache = new WeakMap<AgentAdapter, Map<string, ReadonlyArray<CronJob>>>();

export function useCronJobs(adapter: AgentAdapter, agent: AgentDescriptor, online: boolean, refreshKey = 0) {
  const key = `${agent.connectionId}:${agent.agentId}`;
  const scope = useMemo(() => ({}), [adapter, key]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  const generation = useRef(0);
  const [jobs, setJobs] = useState<ReadonlyArray<CronJob> | null>(() => cache.get(adapter)?.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isCurrent = useCallback(() => mounted.current && currentScope.current === scope, [scope]);
  const publish = useCallback((next: ReadonlyArray<CronJob>) => {
    if (!isCurrent()) return;
    let values = cache.get(adapter);
    if (!values) { values = new Map(); cache.set(adapter, values); }
    values.set(key, next);
    setJobs(next);
  }, [adapter, isCurrent, key]);
  const invalidate = useCallback(() => { generation.current++; if (isCurrent()) setLoading(false); }, [isCurrent]);
  const reload = useCallback(async () => {
    if (!isCurrent()) return;
    const cached = cache.get(adapter)?.get(key);
    if (cached) setJobs(cached);
    if (!online) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await loadAgentCronJobs(adapter.management?.cron, agent);
      if (!isCurrent() || generation.current !== request) return;
      // Preserve the visible order across refreshes and status mutations.
      const previous = cache.get(adapter)?.get(key) ?? [];
      const positions = new Map(previous.map((job, index) => [job.id, index]));
      publish([...result].sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)));
      setError(null);
    } catch (reason) {
      if (isCurrent() && generation.current === request) setError(reason);
    } finally {
      if (isCurrent() && generation.current === request) setLoading(false);
    }
  }, [adapter, agent, isCurrent, key, online, publish]);
  useEffect(() => {
    mounted.current = true;
    setJobs(cache.get(adapter)?.get(key) ?? null);
    setError(null);
    return () => { mounted.current = false; generation.current++; };
  }, [adapter, key, scope]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  const accept = useCallback((job: CronJob) => {
    if (!isCurrent()) return;
    invalidate();
    const existing = cache.get(adapter)?.get(key) ?? [];
    publish(existing.some(value => value.id === job.id) ? existing.map(value => value.id === job.id ? job : value) : [...existing, job]);
    setLoading(false);
  }, [adapter, invalidate, isCurrent, key, publish]);
  const remove = useCallback((id: string) => {
    if (!isCurrent()) return;
    invalidate();
    publish((cache.get(adapter)?.get(key) ?? []).filter(job => job.id !== id));
    setLoading(false);
  }, [adapter, invalidate, isCurrent, key, publish]);
  return { jobs, loading, error, reload, accept, remove, invalidate, isCurrent };
}
