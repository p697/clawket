import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AgentAdapter, SessionActivity, SessionUpdate } from '@clawket/agent-protocol';
import { useSessionActivity } from './useSessionActivity';

let change: (state: string) => void;
beforeEach(() => {
  jest.useFakeTimers(); AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { change = listener as typeof change; return { remove: jest.fn() }; });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
function fixture() {
  let listener: (update: SessionUpdate) => void = () => {};
  const read = jest.fn<Promise<SessionActivity[]>, [readonly string[]]>().mockResolvedValue([{ key: 'one', state: 'running' }]);
  const off = jest.fn();
  const adapter = { state: 'ready', connection: { id: 'connection' }, readSessionActivity: read,
    on: (_event: string, callback: typeof listener) => { listener = callback; return off; } } as unknown as AgentAdapter;
  return { adapter, read, off, emit: (update: SessionUpdate) => listener(update) };
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
it('reads the bounded visible window serially and stops when hidden/backgrounded', async () => {
  const f = fixture(); const view = renderHook<ReturnType<typeof useSessionActivity>, { enabled: boolean }>(({ enabled }) => useSessionActivity(f.adapter, enabled, ['one']), { initialProps: { enabled: true } });
  await flush(); expect(view.result.current.activities.get('one')?.state).toBe('running');
  expect(f.read).toHaveBeenCalledWith(['one']);
  act(() => { change('background'); }); await flush(); expect(view.result.current.active).toBe(false);
  act(() => { jest.advanceTimersByTime(60_000); }); expect(f.read).toHaveBeenCalledTimes(1);
  act(() => { change('active'); }); await flush(); expect(f.read).toHaveBeenCalledTimes(2);
  view.rerender({ enabled: false }); act(() => { jest.advanceTimersByTime(60_000); }); expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.off).toHaveBeenCalledTimes(2); view.unmount();
});
it('never overlaps a slow poll and ignores a late reply after changing visible scope', async () => {
  const f = fixture(); let resolve!: (value: SessionActivity[]) => void;
  f.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = renderHook<ReturnType<typeof useSessionActivity>, { keys: string[] }>(({ keys }) => useSessionActivity(f.adapter, true, keys), { initialProps: { keys: ['one'] } });
  act(() => { jest.advanceTimersByTime(60_000); }); expect(f.read).toHaveBeenCalledTimes(1);
  f.read.mockResolvedValue([{ key: 'two', state: 'idle' }]); view.rerender({ keys: ['two'] }); await flush();
  expect(f.read).toHaveBeenCalledTimes(1);
  await act(async () => { resolve([{ key: 'one', state: 'running' }]); });
  expect(view.result.current.activities.has('one')).toBe(false); expect(view.result.current.activities.get('two')?.state).toBe('idle');
});
it('keeps newer completion and waiting events ahead of an older poll', async () => {
  const f = fixture(); let resolve!: (value: SessionActivity[]) => void;
  f.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useSessionActivity(f.adapter, true, ['one']));
  act(() => { f.emit({ type: 'run_started', sessionKey: 'one', runId: 'new' }); f.emit({ type: 'run_finished', sessionKey: 'one', runId: 'new', stopReason: 'end_turn' }); });
  await act(async () => { resolve([{ key: 'one', state: 'running' }]); });
  expect(view.result.current.activities.get('one')?.state).toBe('idle');
  act(() => { f.emit({ type: 'run_started', sessionKey: 'one', runId: 'next' }); f.emit({ type: 'run_finished', sessionKey: 'one', runId: 'old', stopReason: 'end_turn' }); });
  expect(view.result.current.activities.get('one')?.state).toBe('running');
  act(() => { f.emit({ type: 'session_activity_update', activity: { key: 'one', state: 'waiting', attention: 'input' } }); });
  expect(view.result.current.activities.get('one')).toEqual({ key: 'one', state: 'waiting', attention: 'input' });
});
it('clears evidence on failed polling and never polls a disconnected or legacy adapter', async () => {
  const f = fixture(); const view = renderHook<ReturnType<typeof useSessionActivity>, { enabled: boolean }>(({ enabled }) => useSessionActivity(f.adapter, enabled, ['one']), { initialProps: { enabled: true } });
  await flush(); f.read.mockRejectedValue(new Error('offline'));
  await act(async () => { jest.advanceTimersByTime(15_000); });
  expect(view.result.current.activities.get('one')?.state).toBe('unknown');
  Object.assign(f.adapter, { state: 'offline' }); view.rerender({ enabled: true });
  act(() => { jest.advanceTimersByTime(60_000); }); expect(f.read).toHaveBeenCalledTimes(2);
  Object.assign(f.adapter, { state: 'ready', readSessionActivity: undefined }); view.rerender({ enabled: true });
  expect(view.result.current.activities.size).toBe(0);
});

it('accepts a current poll during streamed text without treating every chunk as a new activity revision', async () => {
  const f = fixture(); let resolve!: (value: SessionActivity[]) => void;
  f.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useSessionActivity(f.adapter, true, ['one']));
  act(() => { f.emit({ type: 'agent_message_chunk', sessionKey: 'one', runId: 'live', text: 'hello' }); });
  await act(async () => { resolve([{ key: 'one', state: 'running' }]); });
  expect(view.result.current.activities.get('one')?.state).toBe('running');
});
