import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBridgeUpgrade } from './useBridgeUpgrade';
import { bridgeCapabilityStore } from '../../connection/registry/bridge-capability-store';

jest.mock('../../connection/registry/bridge-capability-store', () => ({bridgeCapabilityStore: {get: jest.fn().mockResolvedValue(null)}}));

import type { ConnectionDescriptor } from '@clawket/agent-protocol';
const connection: ConnectionDescriptor = { id: 'a', backendKind: 'openclaw', transportKind: 'relay', label: 'Computer', createdAt: 1, isFreeSlot: true };
beforeEach(() => {
  const values = new Map<string, string>();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(bridgeCapabilityStore.get).mockResolvedValue(null);
});
it('retains previously verified offline evidence and replaces it after an upgraded handshake', async () => {
  await AsyncStorage.setItem('clawket.bridgeGeneration.v1', '{"a":"legacy"}');
  const {result, rerender} = renderHook(({details}: {details: Parameters<typeof useBridgeUpgrade>[2]}) => useBridgeUpgrade(true, [connection], details), {initialProps:{details:{}}});
  await waitFor(() => expect(result.current).toEqual(['a']));
  await act(async () => rerender({details:{a:{bridgeGeneration:'current',bridgeVersion:'3.0.0',bridgeCapabilities:[],lastReadyAt:5}}}));
  expect(result.current).toEqual([]);
  await waitFor(async () => expect(await AsyncStorage.getItem('clawket.bridgeGeneration.v1')).toBe('{"a":"current"}'));
});
it('does not infer old Bridge from a cached ready time without a handshake', async () => {
  const {result} = renderHook(() => useBridgeUpgrade(true, [connection], {a:{lastReadyAt:1,bridgeVersion:null,bridgeCapabilities:[]}}));
  await act(async () => {});
  expect(result.current).toEqual([]);
});
it('prunes removed connections rather than showing a stale recommendation', async () => {
  await AsyncStorage.setItem('clawket.bridgeGeneration.v1', '{"removed":"legacy"}');
  const {result} = renderHook(() => useBridgeUpgrade(true, [], {}));
  await waitFor(async () => expect(await AsyncStorage.getItem('clawket.bridgeGeneration.v1')).toBe('{}'));
  expect(result.current).toEqual([]);
});

it('migrates an already negotiated legacy OpenClaw connection while offline', async () => {
  jest.mocked(bridgeCapabilityStore.get).mockResolvedValue('legacy');
  const {result} = renderHook(() => useBridgeUpgrade(true, [connection], {}));
  await waitFor(() => expect(result.current).toEqual(['a']));
});
