import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useChildRunRecords, mergeChildRunRecords } from './useChildRunRecords';
import type { ChildSessionActivityCard } from './childSessionActivity';
import { ThreadActivityCacheService } from '../services/thread-activity-cache';
import type { ThreadRunSeed } from '../screens/Thread/model';

jest.mock('../services/thread-activity-cache', () => ({
  ThreadActivityCacheService: { read: jest.fn(), write: jest.fn() },
}));
const cache = jest.mocked(ThreadActivityCacheService);
const scope = { connectionId: 'openclaw', agentId: 'main', sessionKey: 'agent:main:main' };
const childKey = 'agent:main:subagent:83dea863-2aa6-42c0-9cef-d2d6aa6f3268';
// Result and timestamps from the reported 2026-09-20 probe's archived transcript.
const card: ChildSessionActivityCard = {
  sessionKey: childKey, agentId: 'main', title: 'gpt-6-astra 连通性复测',
  status: 'completed', previewText: 'ASTRA_PROBE_OK GPT-6', resultText: 'ASTRA_PROBE_OK GPT-6',
  toolName: null, updatedAt: 1789908569717,
};
const seed: ThreadRunSeed = {
  id: childKey, sessionKey: childKey, agentId: 'main', kind: 'subagent', title: card.title,
  status: 'completed', summary: card.resultText, updatedAt: card.updatedAt,
};

beforeEach(() => {
  jest.clearAllMocks();
  cache.read.mockResolvedValue(null);
  cache.write.mockResolvedValue();
});

it('retains the completed result through activity cleanup and reopening', async () => {
  const { result, rerender, unmount } = renderHook<ReturnType<typeof useChildRunRecords>, { cards: ChildSessionActivityCard[] }>(({ cards }) => useChildRunRecords(scope, cards), {
    initialProps: { cards: [card] },
  });
  await waitFor(() => expect(cache.write).toHaveBeenCalledWith(scope, [seed], 'subagent'));
  rerender({ cards: [] });
  expect(result.current.runs).toEqual([seed]);
  unmount();
  cache.read.mockResolvedValue([seed]);
  const reopened = renderHook(() => useChildRunRecords(scope, []));
  await waitFor(() => expect(reopened.result.current.runs).toEqual([seed]));
});

it('merges a completion during a delayed cache read without losing earlier results', async () => {
  let resolve!: (runs: ThreadRunSeed[]) => void;
  cache.read.mockReturnValue(new Promise(done => { resolve = done; }));
  const old = { ...seed, id: 'old', sessionKey: 'agent:main:subagent:old', updatedAt: 100 };
  const { result, rerender } = renderHook<ReturnType<typeof useChildRunRecords>, { cards: ChildSessionActivityCard[] }>(({ cards }) => useChildRunRecords(scope, cards), {
    initialProps: { cards: [] as ChildSessionActivityCard[] },
  });
  rerender({ cards: [card] });
  expect(cache.write).not.toHaveBeenCalled();
  await act(async () => resolve([old]));
  await waitFor(() => expect(cache.write).toHaveBeenLastCalledWith(scope, [seed, old], 'subagent'));
  expect(result.current.runs).toEqual([seed, old]);
});

it('isolates connections and ignores late reads from a previous scope', async () => {
  let resolve!: (runs: ThreadRunSeed[]) => void;
  cache.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { result, rerender } = renderHook<ReturnType<typeof useChildRunRecords>, { connectionId: string }>(({ connectionId }) => useChildRunRecords({ ...scope, connectionId }, []), {
    initialProps: { connectionId: 'openclaw' },
  });
  rerender({ connectionId: 'hermes' });
  await act(async () => resolve([seed]));
  expect(result.current.runs).toEqual([]);
  expect(cache.write).not.toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'hermes' }), [seed], 'subagent');
});

it('never persists a streaming run as a completed record', async () => {
  const running = { ...card, status: 'streaming' as const };
  const { result } = renderHook(() => useChildRunRecords(scope, [running]));
  await waitFor(() => expect(cache.read).toHaveBeenCalled());
  expect(result.current.runs[0].status).toBe('streaming');
  expect(cache.write.mock.calls.every(call => call[1].length === 0)).toBe(true);
});

it('keeps readable metadata, terminal truth and bounded snapshots', () => {
  expect(mergeChildRunRecords([seed], [{ ...seed, title: 'Subagent', summary: undefined }])).toEqual([seed]);
  expect(mergeChildRunRecords([seed], [{ ...seed, status: 'streaming', updatedAt: 10 }])).toEqual([seed]);
  expect(mergeChildRunRecords([], Array.from({ length: 105 }, (_, i) => ({ ...seed, id: String(i), updatedAt: i })))).toHaveLength(100);
});
