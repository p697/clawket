import { useUsageCalendar } from './useUsageCalendar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentAdapter,
  AgentDescriptor,
  CostSummary,
  UsageResult,
} from '@clawket/agent-protocol';
import {
  formatIsoDate,
  getUsageDateRange,
  USAGE_RANGE_KEYS,
  type UsageDateRange,
  type UsageRangeKey,
} from './usage-model';

export type UsageRangeData = Readonly<{
  usage: UsageResult | null;
  cost: CostSummary | null;
  fetchedAt: number;
}>;

/** A cached range is reused without a request for this long; older entries refresh silently. */
export const USAGE_CACHE_FRESH_MS = 60_000;

export type UsageDashboardOptions = Readonly<{
  initialRange?: UsageRangeKey;
  now?: () => Date;
}>;

export type UsageDashboard = Readonly<{
  rangeKey: UsageRangeKey;
  setRangeKey: (key: UsageRangeKey) => void;
  range: UsageDateRange;
  today: string;
  supported: boolean;
  canShowCost: boolean;
  /** Data for the selected range, from cache when available. */
  data: UsageRangeData | null;
  /** The 7-day range, used as context behind the single-day view. */
  weekData: UsageRangeData | null;
  /** Whether the selected range came straight from cache when it was selected. */
  cached: boolean;
  loading: boolean;
  /** No data for the selected range yet and a request is possible: mirror the layout with Skeleton. */
  showSkeleton: boolean;
  /** The latest request for the selected range failed; `error` carries its message when one exists. */
  failed: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>;

// In-memory, adapter- and Agent-scoped cache so range switches and stack
// navigation reuse what was already fetched.
const cache = new WeakMap<AgentAdapter, Map<string, UsageRangeData>>();

function storeFor(adapter: AgentAdapter): Map<string, UsageRangeData> {
  let store = cache.get(adapter);
  if (!store) {
    store = new Map();
    cache.set(adapter, store);
  }
  return store;
}

function entryKey(scope: string, key: UsageRangeKey, range: UsageDateRange): string {
  return `${scope}:${key}:${range.startDate}:${range.endDate}`;
}

export function useUsageDashboard(
  adapter: AgentAdapter,
  agent: AgentDescriptor,
  online: boolean,
  options: UsageDashboardOptions = {},
): UsageDashboard {
  const now = options.now ?? defaultNow;
  const nowRef = useRef(now);
  nowRef.current = now;
  const [rangeKey, setRangeKeyState] = useState<UsageRangeKey>(options.initialRange ?? 'today');
  const [, setVersion] = useState(0);
  const [cached, setCached] = useState(false);
  const calendar = useUsageCalendar(now);
  const scope = `${agent.connectionId}:${agent.agentId}:${calendar.key}`;
  const today = formatIsoDate(now());
  const range = useMemo(() => getUsageDateRange(rangeKey, nowRef.current()), [rangeKey, today]);
  const weekRange = useMemo(() => getUsageDateRange('7d', nowRef.current()), [today]);
  const currentKey = entryKey(scope, rangeKey, range);
  const weekKey = entryKey(scope, '7d', weekRange);
  const operations = adapter.management?.usage;
  const supported = Boolean(operations?.sessions);
  const canShowCost = adapter.capabilities.cost && Boolean(operations?.cost);

  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef(new Set<string>());
  const errors = useRef(new Map<string, string>());
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;
  const prefetchedScope = useRef<string | null>(null);

  const bump = useCallback(() => {
    if (mounted.current) setVersion((value) => value + 1);
  }, []);

  const load = useCallback(async (
    key: UsageRangeKey,
    target: UsageDateRange,
    force = false,
  ): Promise<void> => {
    const ops = adapter.management?.usage;
    if (!ops?.sessions || !online) return;
    const store = storeFor(adapter);
    const id = entryKey(scope, key, target);
    const existing = store.get(id);
    if (existing && !force && nowRef.current().getTime() - existing.fetchedAt < USAGE_CACHE_FRESH_MS) return;
    if (pending.current.has(id)) return;
    const request = generation.current;
    pending.current.add(id);
    bump();
    try {
      const params = { ...target, agentId: agent.agentId };
      const [usage, cost] = await Promise.all([
        ops.sessions(params),
        adapter.capabilities.cost && ops.cost ? ops.cost(params) : Promise.resolve(null),
      ]);
      if (!mounted.current || generation.current !== request) return;
      store.set(id, { usage: usage ?? null, cost: cost ?? null, fetchedAt: nowRef.current().getTime() });
      errors.current.delete(id);
    } catch (loadError: unknown) {
      if (!mounted.current || generation.current !== request) return;
      errors.current.set(id, errorMessage(loadError));
    } finally {
      pending.current.delete(id);
      if (mounted.current && generation.current === request) bump();
    }
  }, [adapter, agent.agentId, bump, online, scope]);

  // Reset per-scope bookkeeping when the adapter or Agent changes.
  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    pending.current.clear();
    errors.current.clear();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [adapter, scope]);

  useEffect(() => {
    if (calendar.revision === 0) return;
    for (const [id, entry] of storeFor(adapter)) {
      if (id.startsWith(`${scope}:`)) storeFor(adapter).set(id, { ...entry, fetchedAt: 0 });
    }
  }, [adapter, calendar.revision, scope]);

  // Load the selected range, keep the week context for the single-day view,
  // then prefetch the other ranges once per scope so later switches are instant.
  useEffect(() => {
    const store = storeFor(adapter);
    setCached(Boolean(store.get(currentKey)));
    let cancelled = false;
    void (async () => {
      await load(rangeKey, range);
      if (cancelled) return;
      if (rangeKey === 'today') await load('7d', weekRange);
      if (cancelled || prefetchedScope.current === scope) return;
      prefetchedScope.current = scope;
      for (const key of USAGE_RANGE_KEYS) {
        if (cancelled || key === rangeKey) continue;
        await load(key, getUsageDateRange(key, nowRef.current()));
      }
    })();
    return () => { cancelled = true; };
  }, [adapter, calendar.revision, currentKey, load, range, rangeKey, scope, weekRange]);

  const setRangeKey = useCallback((key: UsageRangeKey) => {
    setRangeKeyState(key);
  }, []);

  const refresh = useCallback(async () => {
    const store = storeFor(adapter);
    for (const [id, entry] of store) {
      if (id !== currentKeyRef.current && id.startsWith(`${scope}:`)) store.set(id, { ...entry, fetchedAt: 0 });
    }
    await load(rangeKey, range, true);
  }, [adapter, load, range, rangeKey, scope]);

  const store = storeFor(adapter);
  const data = store.get(currentKey) ?? null;
  const weekData = rangeKey === 'today' ? store.get(weekKey) ?? null : null;
  const loading = pending.current.has(currentKey);
  const failed = errors.current.has(currentKey);
  const error = errors.current.get(currentKey) || null;

  return {
    rangeKey,
    setRangeKey,
    range,
    today,
    supported,
    canShowCost,
    data,
    weekData,
    cached,
    loading,
    // Old numbers never stand in for another range: an unloaded range shows the
    // skeleton until its own response (or error) arrives.
    showSkeleton: !data && !failed && online && supported,
    failed,
    error,
    refresh,
  };
}

function defaultNow(): Date {
  return new Date();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return '';
}
