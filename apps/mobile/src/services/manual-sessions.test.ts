import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ManualSessions, useManualSession } from './manual-sessions';
import type { AgentAdapter } from '@clawket/agent-protocol';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

test('persists only explicit sessions, scopes access, and removes access with the connection', async () => {
  const first = { connectionId: 'one', agentId: 'main', key: 'chat-1' };
  const { result, rerender } = renderHook((entry: typeof first) => useManualSession(entry.connectionId, entry.agentId, entry.key), { initialProps: first });
  expect(result.current).toBe(false);
  await act(async () => { await Promise.all([ManualSessions.remember(first), ManualSessions.remember(first)]); });
  await waitFor(() => expect(result.current).toBe(true));
  expect(JSON.parse((await AsyncStorage.getItem('clawket.manual-sessions.v1'))!)).toEqual([first]);
  rerender({ ...first, agentId: 'other' });
  expect(result.current).toBe(false);
  rerender({ ...first, connectionId: 'other' });
  expect(result.current).toBe(false);
  rerender(first);
  await act(async () => { await ManualSessions.removeConnection('one'); });
  expect(result.current).toBe(false);
});

test('failed persistence never grants access and a later retry remains possible', async () => {
  const entry = { connectionId: 'failure', agentId: 'main', key: 'chat-2' };
  const { result } = renderHook(() => useManualSession(entry.connectionId, entry.agentId, entry.key));
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage full'));
  await act(async () => { await expect(ManualSessions.remember(entry)).rejects.toThrow('storage full'); });
  expect(result.current).toBe(false);
  await act(async () => { await ManualSessions.remember(entry); });
  expect(result.current).toBe(true);
  await expect(ManualSessions.remember({ ...entry, key: '' })).rejects.toThrow('invalid');
});

test('a storage retry reuses the created backend session and overlapping taps coalesce', async () => {
  const session = { key: 'created-once' };
  const createSession = jest.fn().mockResolvedValue(session);
  const adapter = { connection: { id: 'create-retry' }, capabilities: { sessionCreate: true }, createSession } as unknown as AgentAdapter;
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage full'));
  const first = ManualSessions.create(adapter, 'main');
  expect(ManualSessions.create(adapter, 'main')).toBe(first);
  await expect(first).rejects.toThrow('storage full');
  await expect(ManualSessions.create(adapter, 'main')).resolves.toEqual(session);
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem('clawket.manual-sessions.v1'))!)).toContainEqual({ connectionId: 'create-retry', agentId: 'main', key: 'created-once' });
});

test('an unsupported adapter never creates a backend session', async () => {
  const createSession = jest.fn();
  const adapter = { capabilities: { sessionCreate: false }, createSession } as unknown as AgentAdapter;
  await expect(ManualSessions.create(adapter, 'main')).rejects.toThrow('unavailable');
  expect(createSession).not.toHaveBeenCalled();
});

test('independent creation actions do not coalesce into one shared draft target', async () => {
  const createSession = jest.fn().mockResolvedValueOnce({ key: 'manual-target' }).mockResolvedValueOnce({ key: 'reply-target' });
  const adapter = { connection: { id: 'independent' }, capabilities: { sessionCreate: true }, createSession } as unknown as AgentAdapter;
  const [manual, reply] = await Promise.all([ManualSessions.create(adapter, 'main'), ManualSessions.create(adapter, 'main', 'reply:source:message')]);
  expect(manual.key).not.toBe(reply.key);
  expect(createSession).toHaveBeenCalledTimes(2);
});
