import * as Network from 'expo-network';
import { analyticsEvents } from './analytics/events';
import { startConnectionDiagnostic } from './connection-diagnostics';

jest.mock('./analytics/events', () => ({ analyticsEvents: { connectionDiagnostic: jest.fn() } }));
const network = jest.mocked(Network.getNetworkStateAsync);
const capture = jest.mocked(analyticsEvents.connectionDiagnostic);
const context = { backend: 'openclaw', transport: 'relay', operation: 'connect' } as const;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  network.mockResolvedValue({ type: 'WIFI' as Network.NetworkStateType, isConnected: true, isInternetReachable: true });
});
afterEach(() => jest.useRealTimers());

it('measures foreground recovery through confirmed readiness without sampling network identity', () => {
  const attempt = startConnectionDiagnostic({ ...context, operation: 'foreground_recovery' });
  jest.advanceTimersByTime(734);
  attempt.finish({ outcome: 'success', phase: 'ready' });
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ operation: 'foreground_recovery', elapsed_ms: 734, outcome: 'success' }));
  expect(network).not.toHaveBeenCalled();
});

it('does not sample the OS on success and reports only once', () => {
  const attempt = startConnectionDiagnostic(context);
  attempt.finish({ outcome: 'success', phase: 'ready' });
  attempt.finish({ outcome: 'error', phase: 'socket' });
  expect(network).not.toHaveBeenCalled();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'completed', network: 'not_sampled' }));
});
it.each(['pair_payload', 'pair_claim_result', 'pair_saved_connection'] as const)(
  'records %s as local validation without sampling or blaming the network', (phase) => {
    startConnectionDiagnostic({ ...context, operation: 'pair_validation',
      detected_backend: 'codex', environment: 'production', detected_environment: 'preview',
    }).finish({ outcome: 'error', phase, code: 'pairing_backend_mismatch' });
    expect(network).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'pair_validation', phase, code: 'pairing_backend_mismatch',
      evidence: 'local_validation', network: 'not_sampled', detected_backend: 'codex',
      environment: 'production', detected_environment: 'preview',
    }));
  },
);
it('does not equate a connected Wi-Fi path with proven Internet reachability or network fault', async () => {
  startConnectionDiagnostic(context).finish({ outcome: 'timeout', phase: 'handshake', code: 'timeout' });
  await jest.advanceTimersByTimeAsync(0);
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'unconfirmed', network: 'wifi', code: 'timeout' }));
});
it('records OS-offline evidence without retaining network identifiers', async () => {
  network.mockResolvedValue({ type: 'NONE' as Network.NetworkStateType, isConnected: false });
  startConnectionDiagnostic(context).finish({ outcome: 'error', phase: 'socket', code: 'unknown' });
  await jest.advanceTimersByTimeAsync(0);
  expect(capture.mock.calls[0][0]).toEqual({ ...context, outcome: 'error', phase: 'socket', code: 'unknown',
    http_status: undefined, elapsed_ms: 0, network: 'offline', evidence: 'os_offline' });
});
it('keeps HTTP response evidence even when the subsequent OS snapshot says offline', async () => {
  network.mockResolvedValue({ isConnected: false });
  startConnectionDiagnostic(context).finish({ outcome: 'error', phase: 'body', http_status: 429 });
  await jest.advanceTimersByTimeAsync(0);
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'http_response', http_status: 429 }));
});
it('bounds OS sampling; late offline results cannot relabel a timeout', async () => {
  let resolve!: (value: Network.NetworkState) => void;
  network.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  startConnectionDiagnostic(context).finish({ outcome: 'timeout', phase: 'socket' });
  expect(capture).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'unconfirmed', network: 'unknown' }));
  resolve({ isConnected: false }); await jest.advanceTimersByTimeAsync(0);
  expect(capture).toHaveBeenCalledTimes(1);
});
it('ignores cancelled attempts and tolerates unavailable native modules and analytics', async () => {
  const attempt = startConnectionDiagnostic(context); attempt.cancel(); attempt.finish({ outcome: 'error', phase: 'socket' });
  expect(network).not.toHaveBeenCalled();
  network.mockRejectedValueOnce(new Error('private native details'));
  capture.mockImplementationOnce(() => { throw new Error('telemetry unavailable'); });
  expect(() => startConnectionDiagnostic(context).finish({ outcome: 'error', phase: 'socket' })).not.toThrow();
  await jest.advanceTimersByTimeAsync(0);
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ network: 'unknown' }));
});
