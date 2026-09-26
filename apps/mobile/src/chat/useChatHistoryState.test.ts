import { act, renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { shouldAppendReconciledAssistant } from './historyReconcile';
import { shouldSuppressHistoryLoadError } from './historyErrorPolicy';
import { shouldRestoreCacheBeforeHistoryRefresh } from './historyRefreshPolicy';
import { buildCachedPreviewSessions } from './startupPreview';
import { useChatHistoryState } from './useChatHistoryState';
import { ChatCacheService } from '../services/chat-cache';
import { StorageService } from '../services/storage';

jest.mock('../services/storage', () => ({
  StorageService: {
    getLastSessionKey: jest.fn(),
    getLastOpenedSessionSnapshot: jest.fn(),
    setLastSessionKey: jest.fn(),
    setLastOpenedSessionSnapshot: jest.fn(),
  },
}));

jest.mock('../services/chat-cache', () => ({
  ChatCacheService: {
    getMessages: jest.fn(),
    getTimelinePage: jest.fn(),
    listSessions: jest.fn(),
  },
}));

jest.mock('../services/image-cache', () => ({
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
    (ChatCacheService.getMessages as jest.Mock).mockReset().mockResolvedValue([]);
    (ChatCacheService.listSessions as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each(['openclaw', 'hermes'])('preserves %s participants with identical timestamps and text', async backendKind => {
    const key = 'agent:main:slack:channel:room';
    const adapter = { connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession(key)]),
      loadSession: jest.fn().mockResolvedValue({ messages: ['alice', 'bob'].map(id => ({
        id, role: 'user', text: 'Same', timestampMs: 100000,
        attribution: { channel: 'slack', sender: { id, name: id } },
      })), hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.map(m => m.attribution?.sender?.name)).toEqual(['alice', 'bob']);
    expect(new Set(result.current.messages.map(m => m.id)).size).toBe(2);
  });

  it.each(['openclaw', 'hermes'])('keeps the visible %s conversation in place when a reconnect refreshes it', async (backendKind) => {
    const key = 'agent:main:main';
    const canonical = [
      { id: 'server-user', role: 'user', text: 'Hi', timestampMs: 100_000 },
      { id: 'server-reply', role: 'assistant', text: 'Hello', timestampMs: 110_000 },
    ];
    const adapter = {
      connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession(key)]),
      loadSession: jest.fn().mockResolvedValue({ messages: canonical, hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: 'connection-1', currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages.map(message => message.text)).toEqual(['Hi', 'Hello']);
    const visible = result.current.messages;
    (ChatCacheService.getMessages as jest.Mock).mockClear();

    const refresh = deferred<{ messages: typeof canonical; hasActiveRun: boolean }>();
    adapter.loadSession.mockReturnValueOnce(refresh.promise);
    let reconnect!: Promise<void>;
    await act(async () => { reconnect = result.current.loadSessionsAndHistory(); await Promise.resolve(); });
    // No lagging cache snapshot replaces the rows on screen while history reloads.
    expect(ChatCacheService.getMessages).not.toHaveBeenCalled();
    expect(result.current.messages).toBe(visible);
    await act(async () => { refresh.resolve({ messages: canonical, hasActiveRun: false }); await reconnect; });
    expect(result.current.messages.map(message => message.id)).toEqual(visible.map(message => message.id));
    expect(result.current.historyLoaded).toBe(true);
  });

  it('still starts another session from its cache on reconnect', async () => {
    const adapter = {
      connection: { backendKind: 'openclaw' }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession('agent:main:main')]),
      loadSession: jest.fn().mockResolvedValue({ messages: [], hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: 'agent:main:main', gatewayConfigId: 'connection-1', currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(ChatCacheService.getMessages).toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes'])('retains %s source identities when projecting text around tools', async (backendKind) => {
    const key = 'agent:main:main';
    const adapter = {
      connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession(key)]),
      loadSession: jest.fn().mockResolvedValue({ messages: [
        { id: 'source-user', role: 'user', text: 'Check', timestampMs: 100_000 },
        { id: 'source-first', role: 'assistant', text: 'Checking', timestampMs: 110_000 },
        { id: 'source-tool', role: 'tool', text: '', timestampMs: 120_000,
          tool: { name: 'read', callId: 'call-1', status: 'success' } },
        { id: 'source-last', role: 'assistant', text: 'Finished', timestampMs: 130_000 },
      ] }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages.filter(message => message.role !== 'tool').map(message => message.historyMessageId))
      .toEqual(['source-user', 'source-first', 'source-last']);
  });

  it.each(['openclaw', 'hermes'])('retains a locally sent %s user across an echo without send metadata and a stale refresh', async (backendKind) => {
    const key = 'agent:main:main';
    const older = [
      { id: 'old-user', role: 'user', text: 'Earlier', timestampMs: 1000 },
      { id: 'old-answer', role: 'assistant', text: 'Earlier answer', timestampMs: 2000 },
    ];
    const adapter = { connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession(key)]),
      loadSession: jest.fn().mockResolvedValue({ key, messages: older, hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    const sent = { id: 'usr_3000_qtest', renderKey: 'usr_3000_qtest', role: 'user' as const,
      text: 'Current question', timestampMs: 3000, idempotencyKey: 'send-current' };
    act(() => result.current.setMessages(previous => [...previous, sent]));
    adapter.loadSession.mockResolvedValue({ key, messages: [...older,
      { id: 'server-user', role: 'user', text: sent.text, timestampMs: 3100 }], hasActiveRun: true });
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages.at(-1)).toMatchObject({ historyMessageId: 'server-user',
      renderKey: sent.renderKey, timestampMs: sent.timestampMs });
    adapter.loadSession.mockResolvedValue({ key, messages: older, hasActiveRun: true });
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages.map(message => message.text)).toEqual(['Earlier', 'Earlier answer', 'Current question']);
    expect(result.current.messages.at(-1)?.renderKey).toBe(sent.renderKey);
  });

  it.each(['openclaw', 'hermes'])('keeps an explicit %s task route even when absent from the session index', async (backendKind) => {
    const key = 'agent:main:cron:archived:run:123';
    const adapter = {
      connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession('agent:main:main')]),
      loadSession: jest.fn().mockResolvedValue({ messages: [] }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: 'agent:main:main', gatewayConfigId: null,
        currentAgentId: 'main', routeSessionKey: key });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.sessionKey).toBe(key);
    expect(result.current.historyLoaded).toBe(true);
    await act(async () => { await result.current.onRefresh(); await result.current.refreshSessions(); });
    expect(result.current.sessionKey).toBe(key);
    expect(adapter.loadSession.mock.calls.every(([session]) => session === key)).toBe(true);
  });

  it('keeps a newer session switch when refresh resolves with an older captured key', async () => {
    const listSessionsDeferred = deferred<Array<ReturnType<typeof createSession>>>();
    const adapter = {
      listSessions: jest.fn(() => listSessionsDeferred.promise),
      loadSession: jest.fn().mockResolvedValue({ messages: [] }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:previous');
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    expect(adapter.loadSession).toHaveBeenCalledWith('agent:main:channel:target', { limit: 50 });
  });

  it('optimistically enters the Hermes main session before sessions.list resolves', async () => {
    const listSessionsDeferred = deferred<Array<ReturnType<typeof createSession>>>();
    const adapter = {
      listSessions: jest.fn(() => listSessionsDeferred.promise),
      loadSession: jest.fn().mockResolvedValue({ messages: [] }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    expect(adapter.loadSession).toHaveBeenCalledWith('main', { limit: 50 });

    await act(async () => {
      listSessionsDeferred.resolve([createSession('main')]);
      await loadPromise;
    });

    expect(result.current.state.sessionKey).toBe('main');
    expect(result.current.state.sessions).toEqual([createSession('main')]);
  });

  it('reloads only the current session history for lightweight refresh', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ messages: [] }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

    expect(adapter.loadSession).toHaveBeenCalledWith('agent:main:main', { limit: 50 });
    expect(adapter.listSessions).not.toHaveBeenCalled();
    expect(result.current.state.sessionKey).toBe('agent:main:main');
    expect(result.current.sessionKeyRef.current).toBe('agent:main:main');
  });

  it('deduplicates concurrent loadHistory calls for the same session and limit', async () => {
    const loadSessionDeferred = deferred<{ messages: Array<{ role: string; content: string }> }>();
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn(() => loadSessionDeferred.promise),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

    expect(adapter.loadSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      loadSessionDeferred.resolve({
        messages: [{ role: 'assistant', content: 'reply' }],
      });
      await Promise.all([firstPromise!, secondPromise!]);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['reply']);
  });

  it('filters delivery-mirror assistant history entries during loadHistory', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
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
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

  it.each(['openclaw', 'hermes'])('keeps missing %s tool results unknown without inventing output', async backendKind => {
    const key = 'agent:main:main';
    const adapter = { connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ key, hasActiveRun: true, messages: [
        { id: 'old-call', role: 'assistant', text: '', timestampMs: 1000,
          tool: { name: 'read', callId: 'old', status: 'running', input: { path: 'a' } } },
        { id: 'new-user', role: 'user', text: 'continue', timestampMs: 2000 },
        { id: 'new-call', role: 'assistant', text: '', timestampMs: 3000,
          tool: { name: 'read', callId: 'new', status: 'running' } },
        { id: 'cached-missing', role: 'tool', text: '', timestampMs: 4000,
          tool: { name: 'read', callId: 'cached', status: 'unknown', summary: 'Read a file' } },
      ] }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { result.current.setSessionKey(key); await result.current.loadHistory(key, 12); });
    expect(result.current.messages.find(message => message.id === 'toolcall_old')?.toolStatus).toBe('unknown');
    expect(result.current.messages.find(message => message.id === 'toolcall_new')?.toolStatus).toBe('running');
    expect(result.current.messages.find(message => message.id === 'toolresult_cached')).toMatchObject({
      toolStatus: 'unknown', toolDetail: undefined,
    });
  });

  it.each(['openclaw', 'hermes'].flatMap(backendKind =>
    [false, true, undefined].map(hasActiveRun => ({ backendKind, hasActiveRun })),
  ))('reconciles latest $backendKind tools with active run $hasActiveRun', async ({ backendKind, hasActiveRun }) => {
    const key = 'agent:main:main';
    const adapter = { connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ key, hasActiveRun, messages: [
        { id: 'user', role: 'user', text: 'Remember this', timestampMs: 1000 },
        { id: 'call', role: 'assistant', text: '', timestampMs: 2000,
          tool: { name: 'read', callId: 'unpaired', status: 'running', input: { path: 'notes.md' } } },
        { id: 'cached-call', role: 'tool', text: '', timestampMs: 2500,
          tool: { name: 'write', callId: 'cached', status: 'running' } },
        { id: 'success', role: 'tool', text: 'Saved', timestampMs: 3000,
          tool: { name: 'write', callId: 'saved', status: 'success' } },
        { id: 'error', role: 'tool', text: 'Denied', timestampMs: 3500,
          tool: { name: 'exec', callId: 'denied', status: 'error' } },
        { id: 'reply', role: 'assistant', text: 'Remembered.', timestampMs: 4000 },
      ] }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { result.current.setSessionKey(key); await result.current.loadHistory(key, 12); });
    const expected = hasActiveRun === false ? 'unknown' : 'running';
    expect(result.current.messages.find(message => message.id === 'toolcall_unpaired')).toMatchObject({
      toolStatus: expected, toolArgs: JSON.stringify({ path: 'notes.md' }, null, 2),
    });
    expect(result.current.messages.find(message => message.id === 'toolresult_cached')?.toolStatus).toBe(expected);
    expect(result.current.messages.find(message => message.id === 'toolresult_saved')?.toolStatus).toBe('success');
    expect(result.current.messages.find(message => message.id === 'toolresult_denied')?.toolStatus).toBe('error');
    expect(result.current.messages.some(message => message.text === 'Remembered.')).toBe(true);
  });

  it('preserves a normalized standalone tool call identity across native history refresh', async () => {
    const key = 'claude-owned';
    const adapter = { connection: { backendKind: 'claude-code' }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ key, hasActiveRun: false, messages: [
        { id: 'toolcall_native-call', role: 'tool', text: '',
          tool: { name: 'AskUserQuestion', callId: 'native-call', status: 'error', output: 'Interrupted' } },
      ] }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { result.current.setSessionKey(key); await result.current.loadHistory(key, 12); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'toolcall_native-call', toolStatus: 'error', toolDetail: 'Interrupted' });
    await act(async () => { await result.current.loadHistory(key, 12); });
    expect(result.current.messages.map(message => message.id)).toEqual(['toolcall_native-call']);
  });

  it('renders normalized adapter text, image and file attachments, and paired tool history', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
        key: 'agent:main:main',
        hasActiveRun: false,
        messages: [
          {
            id: 'user-1',
            role: 'user',
            text: 'inspect',
            timestampMs: 1_000,
            attachments: [
              { type: 'image', mimeType: 'image/png', content: 'pixels' },
              {
                type: 'file',
                mimeType: ' Application/PDF ',
                content: 'pdf-bytes-must-not-enter-image-gallery',
                name: ' spec.pdf ',
              },
            ],
          },
          {
            id: 'assistant-tool',
            role: 'assistant',
            text: '',
            timestampMs: 2_000,
            tool: {
              name: 'read',
              status: 'running',
              callId: 'call-1',
              input: { path: '/tmp/file' },
              startedAtMs: 2_000,
            },
          },
          {
            id: 'tool-result',
            role: 'tool',
            text: 'two lines',
            timestampMs: 2_050,
            tool: {
              name: 'read',
              status: 'success',
              callId: 'call-1',
              output: { lines: 2 },
              durationMs: 50,
              startedAtMs: 2_000,
              finishedAtMs: 2_050,
            },
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            text: 'done',
            timestampMs: 3_000,
            provider: 'openai',
            model: 'gpt-5',
          },
        ],
      }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

    expect(result.current.state.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'inspect',
        imageUris: ['data:image/png;base64,pixels'],
        fileAttachments: [{ mimeType: 'application/pdf', fileName: 'spec.pdf' }],
      }),
      expect.objectContaining({
        id: 'toolcall_call-1',
        role: 'tool',
        toolName: 'read',
        toolStatus: 'success',
        toolDetail: 'two lines',
        toolDurationMs: 50,
      }),
      expect.objectContaining({
        role: 'assistant',
        text: 'done',
        modelLabel: 'openai/gpt-5',
      }),
    ]);
  });

  it('deduplicates concurrent reconcileLatestAssistantFromHistory calls for the same session', async () => {
    const loadSessionDeferred = deferred<{ messages: Array<{ role: string; content: string; timestamp?: number }> }>();
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn(() => loadSessionDeferred.promise),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

    expect(adapter.loadSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      loadSessionDeferred.resolve({
        messages: [{ role: 'assistant', content: 'reply', timestamp: 1_000 }],
      });
      await Promise.all([firstPromise!, secondPromise!]);
    });

    expect(result.current.state.messages.map((message) => message.text)).toEqual(['reply']);
  });

  it('ignores delivery-mirror entries when reconciling the latest assistant from history', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
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
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn()
        .mockImplementationOnce(() => firstDeferred.promise)
        .mockImplementationOnce(() => secondDeferred.promise),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

    expect(adapter.loadSession).toHaveBeenCalledTimes(2);

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

  it('loads older local cached messages after adapter history is exhausted', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn()
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
      state: 'ready',
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
        adapter: adapter as any,
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

  it('keeps prepended local history visible after a adapter refresh reloads the current session', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn()
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
      state: 'ready',
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
        adapter: adapter as any,
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

  it('filters assistant NO_REPLY messages from adapter history while keeping user NO_REPLY text', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'NO_REPLY' },
          { role: 'assistant', content: 'NO_REPLY' },
          { role: 'assistant', content: 'visible reply' },
        ],
      }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

  it('filters assistant NO_ placeholder messages from adapter history', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
        messages: [
          { role: 'assistant', content: 'NO_' },
          { role: 'assistant', content: 'visible reply' },
        ],
      }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

  it('filters user messages that start with the OpenClaw runtime context prefix from adapter history', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'OpenClaw runtime context\n\ninternal' },
          { role: 'assistant', content: 'visible reply' },
        ],
      }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'same text', timestamp: 1_000 },
          { role: 'user', content: 'same text', timestamp: 2_000 },
          { role: 'assistant', content: 'reply' },
        ],
      }),
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
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
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
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
      state: 'ready',
    };

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>('agent:main:main');
      const state = useChatHistoryState({
        adapter: adapter as any,
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

  it('clears in-memory history when the adapter scope changes', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({
        messages: [
          { role: 'user', content: 'message on gw-1' },
        ],
      }),
      state: 'ready',
    };

    const { result, rerender } = renderHook(
      ({ gatewayConfigId }: { gatewayConfigId: string | null }) => {
        const sessionKeyRef = useRef<string | null>('agent:main:main');
        const state = useChatHistoryState({
          adapter: adapter as any,
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

  it.each(['openclaw', 'hermes'])('switches %s message ownership atomically before any cache or network reply', async backendKind => {
    const main = 'agent:main:main';
    const other = 'agent:main:other';
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockResolvedValue({ messages: [] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(main);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: main, mainSessionKey: main, gatewayConfigId: 'gw-1', currentAgentId: 'main' });
    });
    act(() => result.current.setMessages([{ id: 'final_main', role: 'assistant', text: 'Main only', timestampMs: 1000 }]));
    act(() => result.current.setSessionKey(other));
    expect(result.current.sessionKey).toBe(other);
    expect(result.current.messages).toEqual([]);
    (ChatCacheService.getMessages as jest.Mock).mockResolvedValueOnce([
      { id: 'stale-other', role: 'assistant', text: 'Old duplicate', timestampMs: 1000 },
    ]);
    await act(async () => { await result.current.restoreCachedMessages(other); });
    await act(async () => { await result.current.loadHistory(other); });
    expect(result.current.messages).toEqual([]);
  });

  it.each(['history', 'reconcile', 'older-cache'])('ignores an old %s reply after switching away and back to the same session', async source => {
    const key = 'agent:main:main';
    const pending = deferred<any>();
    const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValue({ messages: [] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: 'gw-1', currentAgentId: 'main' });
    });
    if (source === 'older-cache') (ChatCacheService.getTimelinePage as jest.Mock).mockReturnValueOnce(pending.promise);
    else adapter.loadSession.mockReturnValueOnce(pending.promise);
    let oldRequest!: Promise<unknown>;
    await act(async () => {
      oldRequest = source === 'history' ? result.current.loadHistory(key)
        : source === 'reconcile' ? result.current.reconcileLatestAssistantFromHistory(key, { appendIfMissing: true })
          : result.current.onLoadMoreHistory();
      await Promise.resolve();
    });
    act(() => result.current.setSessionKey('agent:main:other'));
    act(() => result.current.setSessionKey(key));
    act(() => result.current.setMessages([{ id: 'final_new', role: 'assistant', text: 'Current answer', timestampMs: 100_000 }]));
    const visible = result.current.messages;
    if (source === 'history') {
      adapter.loadSession.mockResolvedValueOnce({ messages: [{ role: 'assistant', text: 'Current answer', timestampMs: 100_000 }] });
      await act(async () => { await result.current.loadHistory(key); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(2);
    }
    const beforeReply = result.current.messages;
    await act(async () => {
      pending.resolve({ messages: [{ id: 'old', role: 'assistant', text: 'Obsolete answer', content: 'Obsolete answer', timestampMs: 1000 }], hasMore: false });
      await oldRequest;
    });
    expect(result.current.messages).toBe(beforeReply);
    if (source !== 'history') expect(result.current.messages).toBe(visible);
    expect(result.current.messages.map(message => message.text)).toEqual(['Current answer']);
    if (source === 'older-cache') {
      // A stale page must not mark the new entry's local paging as exhausted.
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(ChatCacheService.getTimelinePage).toHaveBeenCalledTimes(2);
    }
  });

  it.each(['openclaw', 'hermes'].flatMap(backend => ['populated', 'empty', 'error'].map(cacheState => [backend, cacheState])))
  ('does not let a late %s cache restore (%s) replace committed network history', async (backendKind, cacheState) => {
    const key = 'agent:main:main';
    const cache = deferred<any>();
    (ChatCacheService.getMessages as jest.Mock).mockReturnValueOnce(cache.promise);
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockResolvedValue({
      messages: [{ id: 'canonical', role: 'assistant', text: '| City | Weather |\n|---|---|\n| Hangzhou | Sunny |', timestampMs: 2000 }],
    }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, gatewayConfigId: 'gw-1', currentAgentId: 'main' });
    });
    let restore!: Promise<boolean>;
    act(() => { restore = result.current.restoreCachedMessages(key, { clearWhenEmpty: true }); });
    await act(async () => { await result.current.loadHistory(key); });
    const canonical = result.current.messages;
    await act(async () => {
      if (cacheState === 'error') cache.reject(new Error('storage unavailable'));
      else cache.resolve(cacheState === 'empty' ? [] : [{ id: 'final_old', role: 'assistant', text: 'Outdated preview', timestampMs: 1000 }]);
      await restore;
    });
    expect(result.current.messages).toBe(canonical);
  });

  it.each([false, true])('falls back to a legacy cache only while the restore is current (superseded: %s)', async superseded => {
    const key = 'agent:main:main';
    const missingGeneration = deferred<any[]>();
    (ChatCacheService.getMessages as jest.Mock).mockReturnValueOnce(missingGeneration.promise)
      .mockResolvedValueOnce([{ id: 'legacy', role: 'assistant', text: 'Offline legacy reply' }]);
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: null, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: 'gw-1', currentAgentId: 'main' });
    });
    let restore!: Promise<boolean>;
    act(() => { restore = result.current.restoreCachedMessages(key, { sessionId: 'missing-generation' }); });
    if (superseded) act(() => result.current.setSessionKey('agent:main:other'));
    await act(async () => { missingGeneration.resolve([]); await restore; });
    expect(ChatCacheService.getMessages).toHaveBeenCalledTimes(superseded ? 1 : 2);
    expect(result.current.messages.map(message => message.text)).toEqual(superseded ? [] : ['Offline legacy reply']);
  });

  it('keeps only confirmed cache row keys while canonical history replaces stale optimistic rows', async () => {
    const key = 'agent:main:main';
    const text = '| City | Weather |\n|---|---|\n| Hangzhou | Sunny |';
    (ChatCacheService.getMessages as jest.Mock).mockResolvedValueOnce([
      { id: 'cached-table', renderKey: 'stable-table', historyMessageId: 'canonical', role: 'assistant', text, timestampMs: 2000 },
      { id: 'final_stale', role: 'assistant', text: 'Stale duplicate', timestampMs: 3000 },
    ]);
    const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValue({
      messages: [{ id: 'canonical', role: 'assistant', text, timestampMs: 2000 }],
    }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, gatewayConfigId: 'gw-1', currentAgentId: 'main',
        initialPreview: { sessionKey: key, agentId: 'main', updatedAt: 2000 } });
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages).toEqual([expect.objectContaining({ renderKey: 'stable-table', text, historyMessageId: 'canonical' })]);
    expect(result.current.messages[0].id).not.toBe('cached-table');
  });

  it.each(['openclaw', 'hermes'])('keeps a new %s send when the first server history replaces an old cached preview', async (backendKind) => {
    const key = 'agent:main:main';
    const request = deferred<any>();
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn(() => request.promise) };
    (ChatCacheService.getMessages as jest.Mock).mockResolvedValueOnce([
      { id: 'usr_1000', role: 'user', text: 'Old cached send', timestampMs: 1000 },
      { id: 'final_old', role: 'assistant', text: 'Stale cached answer', timestampMs: 2000 },
    ]);
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, gatewayConfigId: 'gw-1', currentAgentId: 'main',
        initialPreview: { sessionKey: key, agentId: 'main', updatedAt: 1000 } });
    });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.messages.map(message => message.text)).toEqual(['Old cached send', 'Stale cached answer']);
    let load!: Promise<number>;
    act(() => { load = result.current.loadHistory(key); });
    const fresh = { id: 'usr_3000', renderKey: 'usr_3000', role: 'user' as const, text: 'New send', timestampMs: 3000, idempotencyKey: 'new-send' };
    act(() => { result.current.setMessages(previous => [...previous, fresh]); });
    await act(async () => { request.resolve({ key, messages: [], hasActiveRun: true }); await load; });
    expect(result.current.messages).toEqual([fresh]);
  });

  it('keeps assistant text before tool calls embedded in the same history record', async () => {
    const key = 'agent:main:main';
    const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValue({ key, hasActiveRun: false, messages: [
      { id: 'u', role: 'user', text: 'Inspect', timestampMs: 1000 },
      { id: 'a', role: 'assistant', text: 'Reading the file.', timestampMs: 2000,
        tool: { callId: 'read-1', name: 'read', status: 'running' } },
      { id: 'r', role: 'tool', text: 'contents', timestampMs: 3000,
        tool: { callId: 'read-1', name: 'read', status: 'success' } },
      { id: 'b', role: 'assistant', text: 'Done.', timestampMs: 4000 },
    ] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages.map(message => [message.role, message.text])).toEqual([
      ['user', 'Inspect'], ['assistant', 'Reading the file.'], ['tool', ''], ['assistant', 'Done.'],
    ]);
  });

  it('restores startup preview session metadata from the current agent scoped snapshot', async () => {
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ messages: [] }),
      state: 'connecting',
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
    (ChatCacheService.getMessages as jest.Mock).mockResolvedValueOnce([
        { id: 'cached-1', role: 'assistant', text: 'cached writer hello', timestampMs: 1_700_000_000_100 },
    ]);

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      const state = useChatHistoryState({
        adapter: adapter as any,
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
    const adapter = {
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ messages: [] }),
      state: 'connecting',
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
    (ChatCacheService.getMessages as jest.Mock).mockResolvedValueOnce([
        { id: 'cached-main', role: 'assistant', text: 'cached main only', timestampMs: 1_700_000_000_100 },
    ]);

    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(null);
      const state = useChatHistoryState({
        adapter: adapter as any,
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
  it('returns recent cached sessions for the active adapter and agent scope', () => {
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
