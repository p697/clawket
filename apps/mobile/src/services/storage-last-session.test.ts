import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isAccentScale: jest.fn(() => false),
}));

import { StorageService } from './storage';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockAsyncGetItem = AsyncStorage.getItem as jest.Mock;
const mockAsyncSetItem = AsyncStorage.setItem as jest.Mock;

describe('StorageService last session key scoping', () => {
  beforeEach(() => {
    mockGetItemAsync.mockReset();
    mockSetItemAsync.mockReset();
    mockAsyncGetItem.mockReset();
    mockAsyncSetItem.mockReset();
    mockAsyncGetItem.mockResolvedValue(null);
    mockAsyncSetItem.mockResolvedValue(undefined);
  });

  it('returns the scoped last session key when present', async () => {
    mockGetItemAsync.mockResolvedValueOnce('agent:main:main');

    await expect(StorageService.getLastSessionKey('cfg:gw-1')).resolves.toBe('agent:main:main');
    expect(mockGetItemAsync).toHaveBeenCalledWith(
      'clawket.lastSessionKey.v1.cfg:gw-1',
      expect.any(Object),
    );
  });

  it('does not fall back to the legacy global key when a scoped key is missing', async () => {
    mockGetItemAsync.mockResolvedValueOnce(null);

    await expect(StorageService.getLastSessionKey('cfg:gw-2')).resolves.toBeNull();
    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockGetItemAsync).toHaveBeenCalledWith(
      'clawket.lastSessionKey.v1.cfg:gw-2',
      expect.any(Object),
    );
  });

  it('keeps the legacy key behavior for unscoped callers', async () => {
    mockGetItemAsync.mockResolvedValueOnce('agent:legacy:main');

    await expect(StorageService.getLastSessionKey()).resolves.toBe('agent:legacy:main');
    expect(mockGetItemAsync).toHaveBeenCalledWith(
      'clawket.lastSessionKey.v1',
      expect.any(Object),
    );
  });

  it('stores scoped keys without affecting the legacy global slot', async () => {
    await StorageService.setLastSessionKey('agent:main:main', 'cfg:gw-3');

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      'clawket.lastSessionKey.v1.cfg:gw-3',
      'agent:main:main',
      expect.any(Object),
    );
  });

  it('stores and reads the scoped last opened session snapshot', async () => {
    const snapshot = {
      sessionKey: 'agent:main:dm:alice',
      sessionId: 'sess-1',
      sessionLabel: 'Alice',
      updatedAt: 1234,
      agentId: 'main',
      agentName: 'Main Agent',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/avatar.png',
    };
    mockAsyncGetItem.mockResolvedValueOnce(JSON.stringify(snapshot));

    await StorageService.setLastOpenedSessionSnapshot('cfg:gw-4', snapshot);
    await expect(
      StorageService.getLastOpenedSessionSnapshot('cfg:gw-4'),
    ).resolves.toEqual(snapshot);

    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      [
        ['clawket.lastOpenedSessionSnapshot.v1.cfg:gw-4', JSON.stringify(snapshot)],
        ['clawket.lastOpenedSessionSnapshot.v1.cfg:gw-4::main', JSON.stringify(snapshot)],
      ],
    );
    expect(mockAsyncGetItem).toHaveBeenCalledWith(
      'clawket.lastOpenedSessionSnapshot.v1.cfg:gw-4',
    );
  });

  it('prefers the agent-scoped snapshot key when an agent id is provided', async () => {
    const globalSnapshot = {
      sessionKey: 'agent:main:main',
      updatedAt: 1111,
      agentId: 'main',
    };
    const scopedSnapshot = {
      sessionKey: 'agent:writer:main',
      updatedAt: 2222,
      agentId: 'writer',
    };
    mockAsyncGetItem
      .mockResolvedValueOnce(JSON.stringify(scopedSnapshot))
      .mockResolvedValueOnce(JSON.stringify(globalSnapshot));

    await expect(
      StorageService.getLastOpenedSessionSnapshot('cfg:gw-5', 'writer'),
    ).resolves.toEqual(scopedSnapshot);

    expect(mockAsyncGetItem).toHaveBeenNthCalledWith(
      1,
      'clawket.lastOpenedSessionSnapshot.v1.cfg:gw-5::writer',
    );
    expect(mockAsyncGetItem).toHaveBeenCalledTimes(1);
  });

  it('falls back to the global snapshot when the scoped slot is missing', async () => {
    const snapshot = {
      sessionKey: 'agent:main:main',
      updatedAt: 1234,
      agentId: 'main',
    };
    mockAsyncGetItem
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify(snapshot));

    await expect(
      StorageService.getLastOpenedSessionSnapshot('cfg:gw-5', 'main'),
    ).resolves.toEqual(expect.objectContaining(snapshot));

    expect(mockAsyncGetItem).toHaveBeenNthCalledWith(
      1,
      'clawket.lastOpenedSessionSnapshot.v1.cfg:gw-5::main',
    );
    expect(mockAsyncGetItem).toHaveBeenNthCalledWith(
      2,
      'clawket.lastOpenedSessionSnapshot.v1.cfg:gw-5',
    );
  });

  it('stores and reads cached agent identity per gateway scope and agent id', async () => {
    const identity = {
      agentId: 'writer',
      updatedAt: 1234,
      agentName: 'Writer',
      agentEmoji: '✍️',
      agentAvatarUri: 'https://example.com/writer.png',
    };
    mockAsyncGetItem
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify(identity));

    await StorageService.setCachedAgentIdentity('cfg:gw-6', identity);
    await expect(
      StorageService.getCachedAgentIdentity('cfg:gw-6', 'writer'),
    ).resolves.toEqual(identity);

    expect(mockAsyncSetItem).toHaveBeenCalledWith(
      'clawket.cachedAgentIdentity.v1.cfg:gw-6::writer',
      JSON.stringify(identity),
    );
    expect(mockAsyncGetItem).toHaveBeenCalledWith(
      'clawket.cachedAgentIdentity.v1.cfg:gw-6::writer',
    );
  });
});
