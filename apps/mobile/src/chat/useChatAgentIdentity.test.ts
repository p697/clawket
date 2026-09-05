import { act, renderHook } from '@testing-library/react-native';
import { resolveCapabilities, type AgentAdapter } from '@clawket/agent-protocol';
import { StorageService } from '../services/storage';
import { useChatAgentIdentity } from './useChatAgentIdentity';

jest.mock('../services/storage', () => ({
  StorageService: {
    getLastOpenedSessionSnapshot: jest.fn().mockResolvedValue(null),
    getCachedAgentIdentity: jest.fn().mockResolvedValue(null),
    setLastOpenedSessionSnapshot: jest.fn().mockResolvedValue(undefined),
    setCachedAgentIdentity: jest.fn().mockResolvedValue(undefined),
  },
}));

function createAdapter(
  connectionState: 'ready' | 'connecting' = 'connecting',
  connectionId = 'connection-1',
) {
  const listAgents = jest.fn().mockResolvedValue([{
    connectionId,
    agentId: 'main',
    name: 'Main',
    isMain: true,
    mainSessionKey: 'agent:main:main',
  }]);
  const adapter = {
    connection: {
      id: connectionId,
      backendKind: 'openclaw' as const,
      transportKind: 'relay' as const,
      label: 'OpenClaw',
      createdAt: 1,
      isFreeSlot: false,
    },
    capabilities: resolveCapabilities('openclaw'),
    state: connectionState,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    probe: jest.fn().mockResolvedValue(true),
    listAgents,
    listSessions: jest.fn().mockResolvedValue([]),
    loadSession: jest.fn().mockResolvedValue({ key: 'main', messages: [], hasActiveRun: false }),
    prompt: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    cancel: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(() => jest.fn()),
  };
  return adapter as typeof adapter & AgentAdapter;
}

describe('useChatAgentIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hydrates identity from cached storage before the adapter reconnects', async () => {
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

    const adapter = createAdapter('connecting');
    const { result } = renderHook(() => useChatAgentIdentity({
      agents,
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      adapter,
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
    const adapter = createAdapter('ready');
    const agents = [
      {
        connectionId: 'cfg:one',
        id: 'main',
        name: 'Main',
        identity: {
          name: 'Main Agent',
          emoji: '🤖',
          avatarUrl: 'https://example.com/avatar.png',
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
      adapter,
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

    const adapter = createAdapter('connecting');
    const { result } = renderHook(() => useChatAgentIdentity({
      agents,
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      adapter,
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

  it('does not persist the Assistant fallback when cache hydration is empty', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const adapter = createAdapter('connecting');

    const { result } = renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: {
        key: 'agent:main:main',
        kind: 'unknown',
      },
      adapter,
      gatewayConfigId: 'cfg:one',
      initialPreview: {
        sessionKey: 'agent:main:main',
        updatedAt: 1,
        agentId: 'main',
      },
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      displayName: 'Assistant',
      avatarUri: null,
      emoji: null,
    });
    expect(mockedStorage.setLastOpenedSessionSnapshot).not.toHaveBeenCalled();
    expect(mockedStorage.setCachedAgentIdentity).not.toHaveBeenCalled();
  });

  it('resets identity scope before persisting an A-to-B same-agent switch', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    mockedStorage.getCachedAgentIdentity.mockImplementation(async (scopeId) => (
      scopeId === 'connection-b'
        ? {
            agentId: 'main',
            updatedAt: 2,
            agentName: 'Cached B',
            agentEmoji: 'B',
            agentAvatarUri: 'https://example.com/b-cached.png',
          }
        : null
    ));
    const adapterA = createAdapter('connecting', 'connection-a');
    const adapterB = createAdapter('connecting', 'connection-b');
    let params: Parameters<typeof useChatAgentIdentity>[0] = {
      agents: [{
        connectionId: 'connection-a',
        id: 'main',
        name: 'Agent A',
        identity: {
          name: 'Agent A',
          emoji: 'A',
          avatarUrl: 'https://example.com/a.png',
        },
      }],
      cacheAgentName: 'Agent A' as string | undefined,
      currentAgentId: 'main',
      currentSessionInfo: {
        key: 'agent:main:main',
        kind: 'unknown' as const,
      },
      adapter: adapterA as AgentAdapter | null,
      gatewayConfigId: 'connection-a' as string | null,
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main' as string | null,
    };
    const { result, rerender } = renderHook(() => useChatAgentIdentity(params));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      displayName: 'Agent A',
      avatarUri: 'https://example.com/a.png',
      emoji: 'A',
    });
    mockedStorage.setCachedAgentIdentity.mockClear();
    mockedStorage.setLastOpenedSessionSnapshot.mockClear();

    params = {
      ...params,
      adapter: adapterB,
      gatewayConfigId: 'connection-b',
    };
    rerender(undefined);
    expect(result.current).toEqual({
      displayName: 'Assistant',
      avatarUri: null,
      emoji: null,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.displayName).toBe('Cached B');
    expect(mockedStorage.setCachedAgentIdentity.mock.calls.filter(([scopeId]) => (
      scopeId === 'connection-b'
    ))).not.toEqual(expect.arrayContaining([
      expect.arrayContaining([expect.objectContaining({ agentName: 'Agent A' })]),
    ]));

    params = {
      ...params,
      agents: [{
        connectionId: 'connection-b',
        id: 'main',
        name: 'Agent B',
        identity: { name: 'Agent B' },
      }],
      cacheAgentName: 'Agent B',
    };
    rerender(undefined);
    expect(result.current).toEqual({
      displayName: 'Agent B',
      avatarUri: null,
      emoji: null,
    });
    expect(mockedStorage.setCachedAgentIdentity).toHaveBeenLastCalledWith(
      'connection-b',
      expect.not.objectContaining({
        agentEmoji: expect.anything(),
        agentAvatarUri: expect.anything(),
      }),
    );
    expect(mockedStorage.setLastOpenedSessionSnapshot.mock.calls.filter(([scopeId, snapshot]) => (
      scopeId === 'connection-b' && snapshot.agentName === 'Agent A'
    ))).toHaveLength(0);
  });

  it('applies an already-loaded B identity when the connection scope changes', async () => {
    const adapterA = createAdapter('connecting', 'connection-a');
    const adapterB = createAdapter('connecting', 'connection-b');
    let params: Parameters<typeof useChatAgentIdentity>[0] = {
      agents: [{
        connectionId: 'connection-a',
        id: 'main',
        name: 'Agent A',
        identity: { name: 'Agent A', emoji: 'A' },
      }],
      cacheAgentName: 'Agent A',
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      adapter: adapterA,
      gatewayConfigId: 'connection-a',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    };
    const { result, rerender } = renderHook(() => useChatAgentIdentity(params));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    params = {
      ...params,
      agents: [{
        connectionId: 'connection-b',
        id: 'main',
        name: 'Agent B',
        identity: { name: 'Agent B', emoji: 'B' },
      }],
      cacheAgentName: 'Agent B',
      adapter: adapterB,
      gatewayConfigId: 'connection-b',
    };
    rerender(undefined);

    expect(result.current).toEqual({
      displayName: 'Agent B',
      avatarUri: null,
      emoji: 'B',
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('ignores an old listAgents result after the adapter changes within one scope', async () => {
    jest.useFakeTimers();
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    let resolveOldAgents!: (agents: Awaited<ReturnType<AgentAdapter['listAgents']>>) => void;
    const oldAgents = new Promise<Awaited<ReturnType<AgentAdapter['listAgents']>>>((resolve) => {
      resolveOldAgents = resolve;
    });
    const adapterA = createAdapter('ready', 'connection-shared');
    const adapterB = createAdapter('connecting', 'connection-shared');
    adapterA.listAgents.mockReturnValueOnce(oldAgents);
    let params: Parameters<typeof useChatAgentIdentity>[0] = {
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      adapter: adapterA,
      gatewayConfigId: 'connection-shared',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    };
    const { result, rerender } = renderHook(() => useChatAgentIdentity(params));

    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(adapterA.listAgents).toHaveBeenCalledTimes(1);

    params = {
      ...params,
      agents: [{
        connectionId: 'connection-shared',
        id: 'main',
        name: 'Fresh Agent',
        identity: { name: 'Fresh Agent', emoji: 'F' },
      }],
      cacheAgentName: 'Fresh Agent',
      adapter: adapterB,
    };
    rerender(undefined);
    expect(result.current.displayName).toBe('Fresh Agent');

    await act(async () => {
      resolveOldAgents([{
        connectionId: 'connection-shared',
        agentId: 'main',
        name: 'Stale Agent',
        isMain: true,
        mainSessionKey: 'agent:main:main',
      }]);
      await oldAgents;
    });

    expect(result.current).toEqual({
      displayName: 'Fresh Agent',
      avatarUri: null,
      emoji: 'F',
    });
    expect(mockedStorage.setCachedAgentIdentity.mock.calls.some(([, identity]) => (
      identity.agentName === 'Stale Agent'
    ))).toBe(false);
    jest.useRealTimers();
  });

  it('persists last-session snapshot and agent cache for a non-main session in the current agent scope', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const adapter = createAdapter('connecting');

    renderHook(() => useChatAgentIdentity({
      agents: [
        {
          connectionId: 'cfg:one',
          id: 'writer',
          name: 'Writer',
          identity: {
            name: 'Writer Agent',
            emoji: '✍️',
            avatarUrl: 'https://example.com/avatar.png',
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
      adapter,
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
    const adapter = createAdapter('connecting');

    renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: {
        key: 'agent:writer:dm:alice',
        kind: 'unknown',
        sessionId: 'sess-writer',
      },
      adapter,
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
    const adapter = createAdapter('connecting');

    renderHook(() => useChatAgentIdentity({
      agents: [{
        connectionId: 'cfg:hermes',
        id: 'main',
        name: 'Hermes',
        identity: { name: 'Hermes' },
      }],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: {
        key: '20260411_122441_d40735',
        kind: 'unknown',
        sessionId: '20260411_122441_d40735',
      },
      adapter,
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

  it('delays adapter identity fetch after ready to avoid contending with session sync', async () => {
    jest.useFakeTimers();
    const adapter = createAdapter('ready');

    renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      adapter,
      gatewayConfigId: 'cfg:one',
      initialPreview: null,
      mainSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:main',
    }));

    expect(adapter.listAgents).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1499);
      await Promise.resolve();
    });

    expect(adapter.listAgents).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(adapter.listAgents).toHaveBeenCalledWith();
    jest.useRealTimers();
  });

  it('ignores cached identity fallback for Hermes when there is no Hermes-valid snapshot', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    mockedStorage.getLastOpenedSessionSnapshot.mockResolvedValueOnce({
      sessionKey: 'agent:main:main',
      updatedAt: 1234,
      agentId: 'main',
      agentName: 'Old OpenClaw Agent',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/openclaw.png',
    } as any);
    mockedStorage.getCachedAgentIdentity.mockResolvedValueOnce({
      agentId: 'main',
      updatedAt: 1235,
      agentName: 'Old Cached Agent',
      agentEmoji: '🛰️',
      agentAvatarUri: 'https://example.com/cached-openclaw.png',
    } as any);

    const adapter = createAdapter('connecting');
    const { result } = renderHook(() => useChatAgentIdentity({
      agents: [],
      cacheAgentName: undefined,
      currentAgentId: 'main',
      currentSessionInfo: undefined,
      adapter,
      gatewayConfigId: 'cfg:hermes',
      initialPreview: null,
      mainSessionKey: 'main',
      sessionKey: '20260411_122441_d40735',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      displayName: 'Assistant',
      avatarUri: null,
      emoji: null,
    });
  });
});
