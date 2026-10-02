import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBridgeVersions, parseVersions } from './useBridgeVersions';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
const connection: ConnectionDescriptor = { id: 'a', backendKind: 'codex', transportKind: 'relay', label: 'Computer', createdAt: 1, isFreeSlot: true };
beforeEach(() => { const map = new Map<string, string>(); jest.mocked(AsyncStorage.getItem).mockImplementation(async key => map.get(key) ?? null); jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { map.set(key, value); }); });
it('retains authenticated offline evidence, supersedes it on new handshake and prunes removed connections', async () => {
  await AsyncStorage.setItem('clawket.bridgeVersions.v1', '{"a":"3.1.9","removed":"3.1.1"}');
  const { result, rerender } = renderHook(({ connections, details }: { connections: ConnectionDescriptor[]; details: Parameters<typeof useBridgeVersions>[2] }) => useBridgeVersions(true, connections, details), { initialProps: { connections: [connection], details: {} } });
  await waitFor(() => expect(result.current).toEqual({ a: '3.1.9' }));
  await act(async () => rerender({ connections: [connection], details: { a: { bridgeVersion: '3.1.11', bridgeCapabilities: [], lastReadyAt: 2 } } })); expect(result.current).toEqual({ a: '3.1.11' });
  await act(async () => rerender({ connections: [], details: {} })); await waitFor(async () => expect(await AsyncStorage.getItem('clawket.bridgeVersions.v1')).toBe('{}'));
});
it('rejects unknown/malformed cache values', () => { expect(parseVersions('{"a":"unknown","b":"3.1.10-rc.1","c":12}')).toEqual({}); });
