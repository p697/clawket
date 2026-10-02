import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBridgeRelease } from './useBridgeRelease';
const fetchMock = jest.fn(); const originalFetch = global.fetch;
beforeEach(() => { jest.mocked(AsyncStorage.getItem).mockResolvedValue(null); jest.mocked(AsyncStorage.setItem).mockResolvedValue(); fetchMock.mockReset(); global.fetch = fetchMock; });
afterEach(() => { global.fetch = originalFetch; });
it('uses fresh cache and keeps prior evidence when manual release checking fails', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ version: '3.1.11', unifiedUpdate: true, checkedAt: Date.now() })); fetchMock.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useBridgeRelease(true)); await waitFor(() => expect(result.current.release?.version).toBe('3.1.11')); expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => { await result.current.refresh(); }); expect(result.current.failed).toBe(true); expect(result.current.release?.version).toBe('3.1.11');
});
it('does not enable an unreleased command or trust invalid registry metadata', async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ name: '@p697/clawket', version: '3.1.10' }) });
  const { result } = renderHook(() => useBridgeRelease(true)); await waitFor(() => expect(result.current.release?.version).toBe('3.1.10')); expect(result.current.release?.unifiedUpdate).toBe(false);
  fetchMock.mockResolvedValue({ ok: true, text: async () => '{"name":"bad","version":"3.1.11"}' }); await act(async () => { await result.current.refresh(); }); expect(result.current.failed).toBe(true); expect(result.current.release?.version).toBe('3.1.10');
});
