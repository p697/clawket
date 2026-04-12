import { act, renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { shouldAppendReconciledAssistant } from './historyReconcile';
import { shouldSuppressHistoryLoadError } from './historyErrorPolicy';
import { shouldRestoreCacheBeforeHistoryRefresh } from './historyRefreshPolicy';
import { buildCachedPreviewSessions } from './startupPreview';
import { useChatHistoryState } from './useChatHistoryState';
import { ChatCacheService } from '../../../services/chat-cache';
import { StorageService } from '../../../services/storage';

jest.mock('../../../services/storage', () => ({
  StorageService: {
    getLastSessionKey: jest.fn(),
    getLastOpenedSessionSnapshot: jest.fn(),
    setLastSessionKey: jest.fn(),
    setLastOpenedSessionSnapshot: jest.fn(),
  },
}));

jest.mock('../../../services/chat-cache', () => ({
  ChatCacheService: {
    getMessages: jest.fn(),
    getTimelinePage: jest.fn(),
    listSessions: jest.fn(),
  },
}));

jest.mock('../../../services/image-cache', () => ({
  cacheMessageImages: jest.fn(),
  findCachedEntry: jest.fn(),
  generateStableKey: jest.fn(() => 'stable-key'),
  getAllCachedForSession: jest.fn().mockResolvedValue([]),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSession(key: string) {
  return {
    key,
    kind: 'direct' as const,
    updatedAt: 0,
  };
}

const translate = (key: string, options?: Record<string, unknown>) => {
  if (!options) return key;
  return key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options[token] ?? ''));
};

describe('useChatHistoryState', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    (StorageService.getLastSessionKey as jest.Mock).mockResolvedValue(null);
    (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockResolvedValue(null);
    (StorageService.setLastSessionKey as jest.Mock).mockResolvedValue(undefined);
    (StorageService.setLastOpenedSessionSnapshot as jest.Mock).mockResolvedValue(undefined);
    (ChatCacheService.getTimelinePage as jest.Mock).mockResolvedValue({ messages: [], hasMore: false });
    (ChatCacheService.listSessions as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('keeps a newer session switch when refresh resolves with an older captured key', async () => {
    const listSessionsDeferred = deferred<Array<ReturnType<typeof createSession>>>();
    const gateway = {
      listSessions: jest.fn(() => listSessionsDeferred.promise),
      fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:previous');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:previous');
    });

    let refreshPromise: Promise<void> | undefined;
    await act(async () => {
      refreshPromise = result.current.state.onRefresh();

      result.current.sessionKeyRef.current = 'agent:main:channel:target';
      result.current.state.setSessionKey('agent:main:channel:target');

      listSessionsDeferred.resolve([
        createSession('agent:main:main'),
        createSession('agent:main:previous'),
        createSession('agent:main:channel:target'),
      ]);

      await refreshPromise;
    });

    expect(result.current.state.sessionKey).toBe('agent:main:channel:target');
    expect(result.current.sessionKeyRef.current).toBe('agent:main:channel:target');
    expect(gateway.fetchHistory).toHaveBeenCalledWith('agent:main:channel:target', 50);
  });

  it('optimistically enters the Hermes main session before sessions.list resolves', async () => {
    const listSessionsDeferred = deferred<Array<ReturnType<typeof createSession>>>();
    const gateway = {
      listSessions: jest.fn(() => listSessionsDeferred.promise),
      fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'main',
        gatewayConfigId: 'hermes-gw',
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    let loadPromise: Promise<void> | undefined;
    await act(async () => {
      loadPromise = result.current.state.loadSessionsAndHistory();
      await Promise.resolve();
    });

    expect(result.current.state.sessionKey).toBe('main');
    expect(result.current.sessionKeyRef.current).toBe('main');
    expect(gateway.fetchHistory).toHaveBeenCalledWith('main', 50);

    await act(async () => {
      listSessionsDeferred.resolve([createSession('main')]);
      await loadPromise;
    });

    expect(result.current.state.sessionKey).toBe('main');
    expect(result.current.state.sessions).toEqual([createSession('main')]);
  });

  it('reloads only the current session history for lightweight refresh', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.refreshCurrentSessionHistory();
    });

    expect(gateway.fetchHistory).toHaveBeenCalledWith('agent:main:main', 50);
    expect(gateway.listSessions).not.toHaveBeenCalled();
    expect(result.current.state.sessionKey).toBe('agent:main:main');
    expect(result.current.sessionKeyRef.current).toBe('agent:main:main');
  });

  it('deduplicates concurrent loadHistory calls for the same session and limit', async () => {
    const fetchHistoryDeferred = deferred<{ messages: Array<{ role: string; content: string }> }>();
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn(() => fetchHistoryDeferred.promise),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    let firstPromise: Promise<number>;
    let secondPromise: Promise<number>;
    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      firstPromise = result.current.state.loadHistory('agent:main:main', 12);
      secondPromise = result.current.state.loadHistory('agent:main:main', 12);
      await Promise.resolve();
    });

    expect(gateway.fetchHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      fetchHistoryDeferred.resolve({
        messages: [{ role: 'assistant', content: 'reply' }],
      });
      await Promise.all([firstPromise!, secondPromise!]);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['reply']);
  });

  it('filters delivery-mirror assistant history entries during loadHistory', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          {
            role: 'assistant',
            provider: 'openclaw',
            model: 'delivery-mirror',
            content: [{ type: 'text', text: 'reply' }],
            timestamp: 1_000,
          },
          {
            role: 'assistant',
            provider: 'openai',
            model: 'gpt-5',
            content: [{ type: 'text', text: 'reply' }],
            timestamp: 1_001,
          },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 12);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['reply']);
    expect(result.current.state.messages[0]?.modelLabel).toBe('openai/gpt-5');
  });

  it('deduplicates concurrent reconcileLatestAssistantFromHistory calls for the same session', async () => {
    const fetchHistoryDeferred = deferred<{ messages: Array<{ role: string; content: string; timestamp?: number }> }>();
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn(() => fetchHistoryDeferred.promise),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
    });

    let firstPromise: Promise<void>;
    let secondPromise: Promise<void>;
    await act(async () => {
      firstPromise = result.current.state.reconcileLatestAssistantFromHistory('agent:main:main', {
        appendIfMissing: true,
      });
      secondPromise = result.current.state.reconcileLatestAssistantFromHistory('agent:main:main', {
        appendIfMissing: true,
      });
      await Promise.resolve();
    });

    expect(gateway.fetchHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      fetchHistoryDeferred.resolve({
        messages: [{ role: 'assistant', content: 'reply', timestamp: 1_000 }],
      });
      await Promise.all([firstPromise!, secondPromise!]);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['reply']);
  });

  it('ignores delivery-mirror entries when reconciling the latest assistant from history', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          {
            role: 'assistant',
            provider: 'openai',
            model: 'gpt-5',
            content: [{ type: 'text', text: 'real reply' }],
            timestamp: 1_000,
          },
          {
            role: 'assistant',
            provider: 'openclaw',
            model: 'delivery-mirror',
            content: [{ type: 'text', text: 'real reply' }],
            timestamp: 1_001,
          },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.reconcileLatestAssistantFromHistory('agent:main:main', {
        appendIfMissing: true,
      });
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['real reply']);
    expect(result.current.state.messages[0]?.modelLabel).toBe('openai/gpt-5');
  });

  it('does not merge reconcile requests with different append semantics', async () => {
    const firstDeferred = deferred<{ messages: Array<{ role: string; content: string; timestamp?: number }> }>();
    const secondDeferred = deferred<{ messages: Array<{ role: string; content: string; timestamp?: number }> }>();
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn()
        .mockImplementationOnce(() => firstDeferred.promise)
        .mockImplementationOnce(() => secondDeferred.promise),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
    });

    let alignPromise: Promise<void>;
    let recoveryPromise: Promise<void>;
    await act(async () => {
      alignPromise = result.current.state.reconcileLatestAssistantFromHistory('agent:main:main', {
        appendIfMissing: false,
      });
      recoveryPromise = result.current.state.reconcileLatestAssistantFromHistory('agent:main:main', {
        appendIfMissing: true,
        minTimestampMs: 1_000,
      });
      await Promise.resolve();
    });

    expect(gateway.fetchHistory).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstDeferred.resolve({
        messages: [{ role: 'assistant', content: 'reply', timestamp: 1_500 }],
      });
      secondDeferred.resolve({
        messages: [{ role: 'assistant', content: 'reply', timestamp: 1_500 }],
      });
      await Promise.all([alignPromise!, recoveryPromise!]);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['reply']);
  });

  it('loads older local cached messages after gateway history is exhausted', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn()
        .mockResolvedValueOnce({
          sessionId: 'sess-current',
          messages: [
            { role: 'user', content: 'new generation user', timestamp: 3_000 },
            { role: 'assistant', content: 'new generation reply', timestamp: 4_000 },
          ],
        })
        .mockResolvedValueOnce({
          sessionId: 'sess-current',
          messages: [
            { role: 'user', content: 'new generation user', timestamp: 3_000 },
            { role: 'assistant', content: 'new generation reply', timestamp: 4_000 },
          ],
        }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };
    (ChatCacheService.getTimelinePage as jest.Mock).mockResolvedValueOnce({
      messages: [
        { id: 'old-user', role: 'user', text: 'old generation user', timestampMs: 1_000 },
        { id: 'old-assistant', role: 'assistant', text: 'old generation reply', timestampMs: 2_000 },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: 'gw-1',
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });
    await act(async () => {
      await result.current.state.onLoadMoreHistory();
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual([
      'old generation user',
      'old generation reply',
      'new generation user',
      'new generation reply',
    ]);
  });

  it('keeps prepended local history visible after a gateway refresh reloads the current session', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn()
        .mockResolvedValueOnce({
          sessionId: 'sess-current',
          messages: [
            { role: 'user', content: 'recent user', timestamp: 3_000 },
            { role: 'assistant', content: 'recent reply', timestamp: 4_000 },
          ],
        })
        .mockResolvedValueOnce({
          sessionId: 'sess-current',
          messages: [
            { role: 'user', content: 'recent user', timestamp: 3_000 },
            { role: 'assistant', content: 'recent reply', timestamp: 4_000 },
          ],
        })
        .mockResolvedValueOnce({
          sessionId: 'sess-current',
          messages: [
            { role: 'user', content: 'recent user', timestamp: 3_000 },
            { role: 'assistant', content: 'recent reply', timestamp: 4_000 },
          ],
        }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };
    (ChatCacheService.getTimelinePage as jest.Mock).mockResolvedValueOnce({
      messages: [
        { id: 'older-user', role: 'user', text: 'older user', timestampMs: 1_000 },
        { id: 'older-assistant', role: 'assistant', text: 'older reply', timestampMs: 2_000 },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: 'gw-1',
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });
    await act(async () => {
      await result.current.state.onLoadMoreHistory();
    });
    await act(async () => {
      await result.current.state.refreshCurrentSessionHistory();
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual([
      'older user',
      'older reply',
      'recent user',
      'recent reply',
    ]);
  });

  it('filters assistant NO_REPLY messages from gateway history while keeping user NO_REPLY text', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'NO_REPLY' },
          { role: 'assistant', content: 'NO_REPLY' },
          { role: 'assistant', content: 'visible reply' },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      'user:NO_REPLY',
      'assistant:visible reply',
    ]);
  });

  it('filters assistant NO_ placeholder messages from gateway history', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          { role: 'assistant', content: 'NO_' },
          { role: 'assistant', content: 'visible reply' },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      'assistant:visible reply',
    ]);
  });

  it('filters user messages that start with the OpenClaw runtime context prefix from gateway history', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'OpenClaw runtime context\n\ninternal' },
          { role: 'assistant', content: 'visible reply' },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      'assistant:visible reply',
    ]);
  });

  it('keeps repeated user messages when text is identical but history items are distinct', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'same text', timestamp: 1_000 },
          { role: 'user', content: 'same text', timestamp: 2_000 },
          { role: 'assistant', content: 'reply' },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      'user:same text',
      'user:same text',
      'assistant:reply',
    ]);
  });

  it('renders persisted tool results from history', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'check weather', timestamp: 1_000 },
          {
            role: 'toolResult',
            content: 'sunny',
            timestamp: 1_500,
            toolName: 'weather',
            toolCallId: 'tool_1',
            isError: false,
          },
          { role: 'assistant', content: 'It is sunny.', timestamp: 2_000 },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'check weather' }),
      expect.objectContaining({
        role: 'tool',
        toolName: 'weather',
        toolStatus: 'success',
        toolArgs: undefined,
      }),
      expect.objectContaining({ role: 'assistant', text: 'It is sunny.' }),
    ]);
  });

  it('keeps persisted tool timing and args details from history', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          {
            role: 'toolResult',
            content: '{"ok":true}',
            timestamp: 1_500,
            toolName: 'weather',
            toolCallId: 'tool_1',
            toolArgs: '{"city":"Shanghai"}',
            toolDurationMs: 250,
            toolStartedAt: 1_250,
            toolFinishedAt: 1_500,
            isError: false,
          },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: null,
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages).toEqual([
      expect.objectContaining({
        role: 'tool',
        toolName: 'weather',
        toolStatus: 'success',
        toolArgs: '{"city":"Shanghai"}',
        toolDetail: '{"ok":true}',
        toolDurationMs: 250,
        toolStartedAt: 1_250,
        toolFinishedAt: 1_500,
      }),
    ]);
  });

  it('clears in-memory history when the gateway scope changes', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'message on gw-1' },
        ],
      }),
      getConnectionState: jest.fn().mockReturnValue('ready'),
    };

    const { result, rerender } = renderHook(
      ({ gatewayConfigId }: { gatewayConfigId: string | null }) => {
        const sessionKeyRef = useRef<string | null>('agent:main:main');
        const state = useChatHistoryState({
          gateway: gateway as any,
          dbg: jest.fn(),
          t: translate,
          sessionKeyRef,
          mainSessionKey: 'agent:main:main',
          gatewayConfigId,
          currentAgentId: 'main',
        });
        return { state, sessionKeyRef };
      },
      {
        initialProps: {
          gatewayConfigId: 'gw-1',
        },
      },
    );

    await act(async () => {
      result.current.state.setSessionKey('agent:main:main');
      await result.current.state.loadHistory('agent:main:main', 50);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['message on gw-1']);
    expect(result.current.state.sessionKey).toBe('agent:main:main');
    expect(result.current.sessionKeyRef.current).toBe('agent:main:main');

    await act(async () => {
      rerender({ gatewayConfigId: 'gw-2' });
    });

    expect(result.current.state.messages).toEqual([]);
    expect(result.current.state.sessionKey).toBeNull();
    expect(result.current.sessionKeyRef.current).toBeNull();
    expect(result.current.state.sessions).toEqual([]);
    expect(result.current.state.historyLoaded).toBe(false);
  });

  it('restores startup preview session metadata from the current agent scoped snapshot', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
      getConnectionState: jest.fn().mockReturnValue('connecting'),
    };
    (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockResolvedValue({
      sessionKey: 'agent:writer:dm:alice',
      sessionId: 'sess-alice',
      sessionLabel: 'Alice',
      updatedAt: 1_700_000_000_000,
      agentId: 'writer',
      agentName: 'Writer Agent',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/avatar.png',
    });
    (ChatCacheService.getTimelinePage as jest.Mock).mockResolvedValueOnce({
      messages: [
        { id: 'cached-1', role: 'assistant', text: 'cached writer hello', timestampMs: 1_700_000_000_100 },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:writer:main',
        gatewayConfigId: 'gw-1',
        currentAgentId: 'writer',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(StorageService.getLastOpenedSessionSnapshot).toHaveBeenCalledWith('gw-1', 'writer');
    expect(result.current.state.sessionKey).toBe('agent:writer:dm:alice');
    expect(result.current.sessionKeyRef.current).toBe('agent:writer:dm:alice');
    expect(result.current.state.sessions).toEqual([
      expect.objectContaining({
        key: 'agent:writer:dm:alice',
        sessionId: 'sess-alice',
        label: 'Alice',
        title: 'Alice',
        displayName: 'Writer Agent',
      }),
    ]);
    expect(result.current.state.messages.map((message) => message.text)).toEqual(['cached writer hello']);
  });

  it('ignores a snapshot from another agent and restores the current agent main preview instead', async () => {
    const gateway = {
      listSessions: jest.fn().mockResolvedValue([]),
      fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
      getConnectionState: jest.fn().mockReturnValue('connecting'),
    };
    (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockResolvedValue({
      sessionKey: 'agent:writer:dm:alice',
      sessionId: 'sess-alice',
      sessionLabel: 'Alice',
      updatedAt: 1_700_000_000_000,
      agentId: 'writer',
    });
    (StorageService.getLastSessionKey as jest.Mock).mockResolvedValue('agent:writer:dm:alice');
    (ChatCacheService.listSessions as jest.Mock).mockResolvedValue([
      {
        storageKey: 'cache-main',
        gatewayConfigId: 'gw-1',
        agentId: 'main',
        sessionKey: 'agent:main:main',
        sessionLabel: 'Main Session',
        updatedAt: 1_700_000_000_100,
        messageCount: 3,
      },
      {
        storageKey: 'cache-1',
        gatewayConfigId: 'gw-1',
        agentId: 'writer',
        sessionKey: 'agent:writer:dm:alice',
        sessionLabel: 'Alice',
        updatedAt: 1_700_000_000_200,
        messageCount: 1,
      },
    ]);
    (ChatCacheService.getTimelinePage as jest.Mock).mockResolvedValueOnce({
      messages: [
        { id: 'cached-main', role: 'assistant', text: 'cached main only', timestampMs: 1_700_000_000_100 },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      const state = useChatHistoryState({
        gateway: gateway as any,
        dbg: jest.fn(),
        t: translate,
        sessionKeyRef,
        mainSessionKey: 'agent:main:main',
        gatewayConfigId: 'gw-1',
        currentAgentId: 'main',
      });
      return { state, sessionKeyRef };
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(StorageService.getLastOpenedSessionSnapshot).toHaveBeenCalledWith('gw-1', 'main');
    expect(result.current.state.sessionKey).toBe('agent:main:main');
    expect(result.current.state.messages.map((message) => message.text)).toEqual(['cached main only']);
  });
});

describe('shouldSuppressHistoryLoadError', () => {
  it('suppresses transient reconnect states', () => {
    expect(shouldSuppressHistoryLoadError('connecting')).toBe(true);
    expect(shouldSuppressHistoryLoadError('challenging')).toBe(true);
    expect(shouldSuppressHistoryLoadError('reconnecting')).toBe(true);
    expect(shouldSuppressHistoryLoadError('pairing_pending')).toBe(true);
  });

  it('does not suppress stable or terminal states', () => {
    expect(shouldSuppressHistoryLoadError('ready')).toBe(false);
    expect(shouldSuppressHistoryLoadError('idle')).toBe(false);
    expect(shouldSuppressHistoryLoadError('closed')).toBe(false);
  });
});

describe('buildCachedPreviewSessions', () => {
  it('returns recent cached sessions for the active gateway and agent scope', () => {
    const result = buildCachedPreviewSessions(
      [
        {
          storageKey: 'one',
          gatewayConfigId: 'gw-1',
          agentId: 'main',
          sessionKey: 'agent:main:main',
          sessionLabel: 'Main Session',
          messageCount: 10,
          updatedAt: 20,
        },
        {
          storageKey: 'two',
          gatewayConfigId: 'gw-1',
          agentId: 'main',
          sessionKey: 'agent:main:side',
          sessionLabel: 'Side Session',
          messageCount: 4,
          updatedAt: 30,
        },
        {
          storageKey: 'three',
          gatewayConfigId: 'gw-2',
          agentId: 'main',
          sessionKey: 'agent:main:other',
          sessionLabel: 'Other Gateway',
          messageCount: 2,
          updatedAt: 40,
        },
      ],
      'gw-1',
      'agent:main:main',
    );

    expect(result.map((session) => session.key)).toEqual(['agent:main:main']);
    expect(result[0]).toMatchObject({
      kind: 'unknown',
      label: 'Main Session',
    });
  });
});

describe('shouldAppendReconciledAssistant', () => {
  it('does not append without explicit recovery context', () => {
    expect(shouldAppendReconciledAssistant(1000)).toBe(false);
    expect(shouldAppendReconciledAssistant(1000, { appendIfMissing: false })).toBe(false);
  });

  it('allows append for an active recovery when timestamp is recent enough', () => {
    expect(shouldAppendReconciledAssistant(10_500, {
      appendIfMissing: true,
      minTimestampMs: 10_000,
    })).toBe(true);
  });

  it('rejects stale history when recovering a run', () => {
    expect(shouldAppendReconciledAssistant(8_000, {
      appendIfMissing: true,
      minTimestampMs: 10_000,
    })).toBe(false);
  });
});

describe('shouldRestoreCacheBeforeHistoryRefresh', () => {
  it('skips cache restore when refreshing the active loaded session with visible messages', () => {
    expect(shouldRestoreCacheBeforeHistoryRefresh({
      targetKey: 'agent:main:main',
      currentKey: 'agent:main:main',
      historyLoaded: true,
      currentMessages: [
        { id: 'u1', role: 'user', text: 'hello' },
        { id: 'final_run', role: 'assistant', text: 'world' },
      ],
    })).toBe(false);
  });

  it('restores cache when switching sessions', () => {
    expect(shouldRestoreCacheBeforeHistoryRefresh({
      targetKey: 'agent:main:side',
      currentKey: 'agent:main:main',
      historyLoaded: true,
      currentMessages: [
        { id: 'u1', role: 'user', text: 'hello' },
      ],
    })).toBe(true);
  });

  it('restores cache before history has been loaded', () => {
    expect(shouldRestoreCacheBeforeHistoryRefresh({
      targetKey: 'agent:main:main',
      currentKey: 'agent:main:main',
      historyLoaded: false,
      currentMessages: [
        { id: 'u1', role: 'user', text: 'hello' },
      ],
    })).toBe(true);
  });
});
