import { act, renderHook } from '@testing-library/react-native';
import { StorageService } from '../../../services/storage';
import { useChatAgentIdentity } from './useChatAgentIdentity';

jest.mock('../../../services/storage', () => ({
  StorageService: {
    getLastOpenedSessionSnapshot: jest.fn().mockResolvedValue(null),
    getCachedAgentIdentity: jest.fn().mockResolvedValue(null),
    setLastOpenedSessionSnapshot: jest.fn().mockResolvedValue(undefined),
    setCachedAgentIdentity: jest.fn().mockResolvedValue(undefined),
  },
}));

function createGateway(connectionState: 'ready' | 'connecting' = 'connecting') {
  return {
    fetchIdentity: jest.fn().mockResolvedValue({}),
    getBaseUrl: jest.fn(() => 'https://example.com'),
    getConnectionState: jest.fn(() => connectionState),
  };
}

describe('useChatAgentIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hydrates identity from cached storage before the gateway reconnects', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const agents: any[] = [];
    mockedStorage.getLastOpenedSessionSnapshot.mockResolvedValueOnce({
      sessionKey: 'agent:main:main',
      updatedAt: 1234,
      agentId: 'main',
      agentName: 'Snapshot Agent',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/avatar.png',
    } as any);
    mockedStorage.getCachedAgentIdentity.mockResolvedValueOnce({
      agentId: 'main',
      updatedAt: 1234,
      agentName: 'Cached Agent',
      agentEmoji: '🛰️',
      agentAvatarUri: 'https://example.com/cached.png',
    } as any);

    const gateway = createGateway('connecting');
    const { result } = renderHook(() => useChatAgentIdentity({
      agents,
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      gateway,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      displayName: 'Snapshot Agent',
      avatarUri: 'https://example.com/avatar.png',
      emoji: '🤖',
    });
  });

  it('updates identity from loaded agent metadata and persists the cache', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const gateway = createGateway('ready');
    const agents = [
      {
        id: 'main',
        name: 'Main',
        identity: {
          name: 'Main Agent',
          emoji: '🤖',
          avatar: '/avatar.png',
        },
      },
    ];

    const { result } = renderHook(() => useChatAgentIdentity({
      agents,
      cacheAgentName: 'Main Agent',
      currentAgentId: 'main',
      currentSessionInfo: {
        key: 'agent:main:main',
        kind: 'unknown',
        sessionId: 'sess-1',
      },
      gateway,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      displayName: 'Main Agent',
      avatarUri: 'https://example.com/avatar.png',
      emoji: '🤖',
    });
    expect(mockedStorage.setCachedAgentIdentity).toHaveBeenCalledWith(
      'cfg:one',
      expect.objectContaining({
        agentId: 'main',
        agentName: 'Main Agent',
        agentEmoji: '🤖',
        agentAvatarUri: 'https://example.com/avatar.png',
      }),
    );
  });

  it('keeps the cached identity when the agent list is still empty', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const agents: any[] = [];
    mockedStorage.getCachedAgentIdentity.mockResolvedValueOnce({
      agentId: 'main',
      updatedAt: 1234,
      agentName: 'Cached Main',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/cached-main.png',
    } as any);

    const gateway = createGateway('connecting');
    const { result } = renderHook(() => useChatAgentIdentity({
      agents,
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      gateway,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      displayName: 'Cached Main',
      avatarUri: 'https://example.com/cached-main.png',
      emoji: '🤖',
    });
  });

  it('persists last-session snapshot and agent cache for a non-main session in the current agent scope', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const gateway = createGateway('connecting');

    renderHook(() => useChatAgentIdentity({
      agents: [
        {
          id: 'writer',
          name: 'Writer',
          identity: {
            name: 'Writer Agent',
            emoji: '✍️',
            avatar: '/avatar.png',
          },
        },
      ],
      cacheAgentName: 'Writer Agent',
      currentAgentId: 'writer',
      currentSessionInfo: {
        key: 'agent:writer:dm:alice',
        kind: 'unknown',
        sessionId: 'sess-writer',
      },
      gateway,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:writer:main',
      sessionKey: 'agent:writer:dm:alice',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedStorage.setLastOpenedSessionSnapshot).toHaveBeenCalledWith(
      'cfg:one',
      expect.objectContaining({
        sessionKey: 'agent:writer:dm:alice',
        sessionId: 'sess-writer',
        agentId: 'writer',
        agentName: 'Writer Agent',
      }),
    );
    expect(mockedStorage.setCachedAgentIdentity).toHaveBeenCalledWith(
      'cfg:one',
      expect.objectContaining({
        agentId: 'writer',
        agentName: 'Writer Agent',
      }),
    );
  });

  it('does not hydrate or persist identity when the visible session belongs to another agent', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const gateway = createGateway('connecting');

    renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: {
        key: 'agent:writer:dm:alice',
        kind: 'unknown',
        sessionId: 'sess-writer',
      },
      gateway,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:writer:dm:alice',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedStorage.getLastOpenedSessionSnapshot).not.toHaveBeenCalled();
    expect(mockedStorage.getCachedAgentIdentity).not.toHaveBeenCalled();
    expect(mockedStorage.setLastOpenedSessionSnapshot).not.toHaveBeenCalled();
    expect(mockedStorage.setCachedAgentIdentity).not.toHaveBeenCalled();
  });

  it('treats Hermes sessions as in scope when using a backend-scoped main session key', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const gateway = createGateway('connecting');

    renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: {
        key: '20260411_122441_d40735',
        kind: 'unknown',
        sessionId: '20260411_122441_d40735',
      },
      gateway,
      gatewayConfigId: 'cfg:hermes',
      initialPreview: null,
      mainSessionKey: 'main',
      sessionKey: '20260411_122441_d40735',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedStorage.getLastOpenedSessionSnapshot).toHaveBeenCalled();
    expect(mockedStorage.setLastOpenedSessionSnapshot).toHaveBeenCalledWith(
      'cfg:hermes',
      expect.objectContaining({
        sessionKey: '20260411_122441_d40735',
        sessionId: '20260411_122441_d40735',
      }),
    );
  });

  it('delays gateway identity fetch after ready to avoid contending with session sync', async () => {
    jest.useFakeTimers();
    const gateway = createGateway('ready');

    renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      gateway,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    }));

    expect(gateway.fetchIdentity).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1499);
      await Promise.resolve();
    });

    expect(gateway.fetchIdentity).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(gateway.fetchIdentity).toHaveBeenCalledWith('main');
    jest.useRealTimers();
  });
});
