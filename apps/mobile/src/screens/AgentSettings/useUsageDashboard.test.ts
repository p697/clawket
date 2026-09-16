import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type AgentDescriptor,
  type UsageResult,
} from '@clawket/agent-protocol';
import { useUsageDashboard } from './useUsageDashboard';

type Deferred = { params: { startDate: string; endDate: string }; resolve: (value: UsageResult) => void; reject: (reason: unknown) => void };

const agent: AgentDescriptor = {
  connectionId: 'conn-1',
  agentId: 'main',
  name: 'Lucy',
  backendKind: 'openclaw',
} as unknown as AgentDescriptor;

function usageFor(tokens: number): UsageResult {
  return {
    totals: {
      input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
      totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0,
    },
  };
}

function createAdapter(): { adapter: AgentAdapter; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const sessions = jest.fn((params: { startDate: string; endDate: string }) => new Promise<UsageResult>((resolve, reject) => {
    calls.push({ params, resolve, reject });
  }));
  const adapter = {
    connection: { backendKind: 'openclaw' },
    capabilities: { ...CAPABILITY_MATRIX.openclaw, cost: false },
    management: { usage: { sessions } },
  } as unknown as AgentAdapter;
  return { adapter, calls };
}

const now = () => new Date(2026, 8, 16, 10, 38);

function pendingFor(calls: Deferred[], startDate: string): Deferred {
  const match = [...calls].reverse().find((call) => call.params.startDate === startDate);
  if (!match) throw new Error(`No request for ${startDate}`);
  return match;
}

describe('useUsageDashboard', () => {
  it('shows only the selected range and never lets a slower response for another range overwrite it', async () => {
    const { adapter, calls } = createAdapter();
    const view = renderHook(() => useUsageDashboard(adapter, agent, true, { now }));

    expect(view.result.current.showSkeleton).toBe(true);
    expect(view.result.current.data).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].params).toEqual({ startDate: '2026-09-16', endDate: '2026-09-16', agentId: 'main' });

    act(() => view.result.current.setRangeKey('7d'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(view.result.current.showSkeleton).toBe(true);

    // The newer (7d) request answers first, then the stale single-day one.
    await act(async () => { pendingFor(calls, '2026-09-10').resolve(usageFor(700)); });
    await waitFor(() => expect(view.result.current.data?.usage?.totals?.totalTokens).toBe(700));
    await act(async () => { pendingFor(calls, '2026-09-16').resolve(usageFor(16)); });
    expect(view.result.current.rangeKey).toBe('7d');
    expect(view.result.current.data?.usage?.totals?.totalTokens).toBe(700);

    // The single-day range is now cached: switching back is instant and needs no request.
    const requestsBefore = calls.length;
    act(() => view.result.current.setRangeKey('today'));
    expect(view.result.current.data?.usage?.totals?.totalTokens).toBe(16);
    expect(view.result.current.weekData?.usage?.totals?.totalTokens).toBe(700);
    expect(view.result.current.showSkeleton).toBe(false);
    await waitFor(() => expect(view.result.current.cached).toBe(true));
    expect(calls.filter((call) => call.params.startDate === '2026-09-16')).toHaveLength(1);
    expect(calls.length).toBeGreaterThanOrEqual(requestsBefore);
  });

  it('prefetches the remaining ranges once after the first range lands', async () => {
    const { adapter, calls } = createAdapter();
    const view = renderHook(() => useUsageDashboard(adapter, agent, true, { now }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => { calls[0].resolve(usageFor(1)); });
    await waitFor(() => expect(calls.map((call) => call.params.startDate)).toEqual(['2026-09-16', '2026-09-10']));
    await act(async () => { pendingFor(calls, '2026-09-10').resolve(usageFor(7)); });
    await waitFor(() => expect(calls.map((call) => call.params.startDate)).toEqual(['2026-09-16', '2026-09-10', '2026-08-18']));
    await act(async () => { pendingFor(calls, '2026-08-18').resolve(usageFor(30)); });
    await waitFor(() => expect(view.result.current.weekData?.usage?.totals?.totalTokens).toBe(7));

    act(() => view.result.current.setRangeKey('30d'));
    expect(view.result.current.data?.usage?.totals?.totalTokens).toBe(30);
    expect(view.result.current.showSkeleton).toBe(false);
    await waitFor(() => expect(calls).toHaveLength(3));
  });

  it('keeps the loaded range visible when a refresh fails and reports the failure', async () => {
    const { adapter, calls } = createAdapter();
    const view = renderHook(() => useUsageDashboard(adapter, agent, true, { now }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => { calls[0].resolve(usageFor(5)); });
    await waitFor(() => expect(view.result.current.data?.usage?.totals?.totalTokens).toBe(5));

    let refreshed: Promise<void> | undefined;
    act(() => { refreshed = view.result.current.refresh(); });
    await waitFor(() => expect(calls.filter((call) => call.params.startDate === '2026-09-16')).toHaveLength(2));
    await act(async () => {
      pendingFor(calls, '2026-09-16').reject(new Error('Gateway unavailable'));
      await refreshed;
    });
    expect(view.result.current.failed).toBe(true);
    expect(view.result.current.error).toBe('Gateway unavailable');
    expect(view.result.current.data?.usage?.totals?.totalTokens).toBe(5);
    expect(view.result.current.showSkeleton).toBe(false);
  });

  it('surfaces a failed first load without a skeleton and requests nothing while offline', async () => {
    const failing = createAdapter();
    const failed = renderHook(() => useUsageDashboard(failing.adapter, agent, true, { now }));
    await waitFor(() => expect(failing.calls).toHaveLength(1));
    await act(async () => { failing.calls[0].reject('offline'); });
    await waitFor(() => expect(failed.result.current.failed).toBe(true));
    expect(failed.result.current.showSkeleton).toBe(false);
    expect(failed.result.current.data).toBeNull();

    const offline = createAdapter();
    const view = renderHook(() => useUsageDashboard(offline.adapter, agent, false, { now }));
    await act(async () => {});
    expect(offline.calls).toHaveLength(0);
    expect(view.result.current.showSkeleton).toBe(false);
    expect(view.result.current.loading).toBe(false);
  });
});
