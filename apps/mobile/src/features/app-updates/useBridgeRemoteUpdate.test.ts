import { act, renderHook } from '@testing-library/react-native';
import type { BridgeUpdateOperations, BridgeUpdateStatus } from '@clawket/agent-protocol';
import { useBridgeRemoteUpdate } from './useBridgeRemoteUpdate';

const id = '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59';
const at = (state: BridgeUpdateStatus['state'], extra: Partial<BridgeUpdateStatus> = {}): BridgeUpdateStatus => ({ id, state, startedAt: 1, ...extra });
let clock = 0;
const now = () => clock;
function operations(statuses: Array<BridgeUpdateStatus | null | Error>, start: BridgeUpdateOperations['start'] = async () => ({ accepted: true, status: at('checking') })) {
  return {
    start: jest.fn(start),
    status: jest.fn(async () => { const next = statuses.length > 1 ? statuses.shift()! : statuses[0]; if (next instanceof Error) throw next; return next; }),
  };
}
async function tick(ms = 2_000) {
  clock += ms;
  await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); });
}
beforeEach(() => { jest.useFakeTimers(); clock = 0; });
afterEach(() => { jest.useRealTimers(); });

it('follows one run through download and restart to the confirmed result', async () => {
  const ops = operations([at('installing', { version: '3.1.14' }), new Error('network'), at('updated', { version: '3.1.14', finishedAt: 2 })]);
  const { result } = renderHook(() => useBridgeRemoteUpdate(() => ops, now));
  await act(async () => { await result.current.start('computer'); });
  expect(ops.start).toHaveBeenCalledTimes(1);
  expect(result.current.view).toEqual({ phase: 'running', connectionId: 'computer', status: at('installing', { version: '3.1.14' }), reconnecting: false });
  await tick();
  expect(result.current.view).toMatchObject({ phase: 'running', reconnecting: true, status: { state: 'installing' } });
  await act(async () => { await result.current.start('computer'); });
  expect(ops.start).toHaveBeenCalledTimes(1);
  await tick();
  expect(result.current.view).toEqual({ phase: 'updated', connectionId: 'computer', status: at('updated', { version: '3.1.14', finishedAt: 2 }) });
  act(() => result.current.dismissFinished());
  expect(result.current.view).toEqual({ phase: 'idle' });
});

it('adopts the run a lost start reply may have launched, but never an older finished one', async () => {
  const lost = operations([at('installing')], async () => { throw new Error('timeout'); });
  const adopted = renderHook(() => useBridgeRemoteUpdate(() => lost, now));
  await act(async () => { await adopted.result.current.start('computer'); });
  expect(adopted.result.current.view).toMatchObject({ phase: 'running', status: { state: 'installing' } });
  const stale = operations([at('updated', { finishedAt: 2 })], async () => { throw new Error('timeout'); });
  const ignored = renderHook(() => useBridgeRemoteUpdate(() => stale, now));
  await act(async () => { await ignored.result.current.start('computer'); });
  expect(ignored.result.current.view).toMatchObject({ phase: 'running', status: null });
  await tick(62_000);
  expect(ignored.result.current.view).toEqual({ phase: 'failed', connectionId: 'computer', reason: 'error' });
});

it('reports a computer that refuses or a run that ends busy', async () => {
  const disabled = operations([null], async () => ({ accepted: false, reason: 'disabled' }));
  const refused = renderHook(() => useBridgeRemoteUpdate(() => disabled, now));
  await act(async () => { await refused.result.current.start('computer'); });
  expect(refused.result.current.view).toEqual({ phase: 'failed', connectionId: 'computer', reason: 'disabled' });
  expect(disabled.status).not.toHaveBeenCalled();
  const busy = operations([at('failed', { reason: 'busy', waitingFor: 'codex', finishedAt: 2 })]);
  const ended = renderHook(() => useBridgeRemoteUpdate(() => busy, now));
  await act(async () => { await ended.result.current.start('computer'); });
  expect(ended.result.current.view).toEqual({ phase: 'failed', connectionId: 'computer', reason: 'busy', waitingFor: 'codex' });
});

it('gives up on a computer that never comes back and keeps a running update when dismissed', async () => {
  const gone = operations([new Error('bridge_offline')]);
  const { result } = renderHook(() => useBridgeRemoteUpdate(() => gone, now));
  await act(async () => { await result.current.start('computer'); });
  act(() => result.current.dismissFinished());
  expect(result.current.view).toMatchObject({ phase: 'running', reconnecting: true });
  await tick(15 * 60_000 + 1);
  expect(result.current.view).toEqual({ phase: 'failed', connectionId: 'computer', reason: 'lost' });
  const none = renderHook(() => useBridgeRemoteUpdate(() => undefined, now));
  await act(async () => { await none.result.current.start('computer'); });
  expect(none.result.current.view).toEqual({ phase: 'failed', connectionId: 'computer', reason: 'error' });
});
