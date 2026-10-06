import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBridgeRelease } from './useBridgeRelease';
const fetchMock = jest.fn(); const originalFetch = global.fetch;
const registry = (version: string, updateProtocol = 1) => ({ ok: true, text: async () => JSON.stringify({ name: '@p697/clawket', version, clawket: { updateProtocol } }) });
beforeEach(() => { jest.mocked(AsyncStorage.getItem).mockResolvedValue(null); jest.mocked(AsyncStorage.setItem).mockResolvedValue(); fetchMock.mockReset(); global.fetch = fetchMock; });
afterEach(() => { global.fetch = originalFetch; });
it('checks npm live even with a fresh saved release and keeps the saved one when that check fails', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ version: '3.1.11', unifiedUpdate: true, checkedAt: Date.now() })); fetchMock.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useBridgeRelease(true));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(result.current.release?.version).toBe('3.1.11');
  await act(async () => { await result.current.refresh(); }); expect(fetchMock).toHaveBeenCalledTimes(2); expect(result.current.release?.version).toBe('3.1.11');
});
it('replaces the saved release with the live one and checks again on every request', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ version: '3.1.12', unifiedUpdate: true, checkedAt: Date.now() })); fetchMock.mockResolvedValue(registry('3.1.13'));
  const { result } = renderHook(() => useBridgeRelease(true));
  await waitFor(() => expect(result.current.release?.version).toBe('3.1.13'));
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('clawket.bridgeRelease.v1', expect.stringContaining('"version":"3.1.13"'));
  fetchMock.mockResolvedValue(registry('3.1.14'));
  await act(async () => { await result.current.refresh(); }); expect(result.current.release?.version).toBe('3.1.14');
});
it('shares one request between checks that overlap', async () => {
  let answer!: (value: unknown) => void;
  fetchMock.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  const { result } = renderHook(() => useBridgeRelease(true));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = result.current.refresh(); second = result.current.refresh(); });
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(result.current.checking).toBe(true);
  await act(async () => { answer(registry('3.1.13')); await Promise.all([first, second]); });
  expect(result.current.release?.version).toBe('3.1.13'); expect(result.current.checking).toBe(false);
});
it('does not enable an unreleased command or trust invalid registry metadata', async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ name: '@p697/clawket', version: '3.1.10' }) });
  const { result } = renderHook(() => useBridgeRelease(true)); await waitFor(() => expect(result.current.release?.version).toBe('3.1.10')); expect(result.current.release?.unifiedUpdate).toBe(false);
  fetchMock.mockResolvedValue({ ok: true, text: async () => '{"name":"bad","version":"3.1.11"}' }); await act(async () => { await result.current.refresh(); }); expect(result.current.failed).toBe(true); expect(result.current.release?.version).toBe('3.1.10');
});
