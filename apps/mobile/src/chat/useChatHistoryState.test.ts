import { act, renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { shouldAppendReconciledAssistant } from './historyReconcile';
import { shouldSuppressHistoryLoadError } from './historyErrorPolicy';
import { shouldRestoreCacheBeforeHistoryRefresh } from './historyRefreshPolicy';
import { buildCachedPreviewSessions } from './startupPreview';
import { useChatHistoryState } from './useChatHistoryState';
import { ChatCacheService } from '../services/chat-cache';
import { StorageService } from '../services/storage';
import { AdapterError } from '@clawket/agent-protocol';
import { SessionCatalogSupersededError } from '../connection/adapters/session-catalog';

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

  it('preserves image-only managed artifacts through history projection and refresh', async () => {
    const key = 'agent:main:artifact-test';
    const attachments = [{ type: 'image', mimeType: 'image/png', artifactId: 'opaque-image' }];
    const adapter = { connection: { backendKind: 'openclaw' }, state: 'ready',
      loadSession: jest.fn().mockResolvedValue({ messages: [{ id: 'image-message', role: 'assistant', text: '', timestampMs: 1000, attachments }], hasActiveRun: false }),
    };
    const { result, unmount } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, routeSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].artifactAttachments).toEqual(attachments);
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].artifactAttachments).toEqual(attachments);
    unmount();
  });

  describe.each(['codex', 'claude-code', 'pi'])('%s catalog cancellation', backendKind => {
    it.each(['loadSessionsAndHistory', 'onRefresh', 'refreshSessions'] as const)('retries only the pure directory once during %s', async operation => {
      const key = 'owned-session';
      const adapter = { connection: { backendKind }, state: 'ready',
        listSessions: jest.fn().mockRejectedValueOnce(new SessionCatalogSupersededError())
          .mockResolvedValue([{ ...createSession(key), title: 'Renamed' }]),
        loadSession: jest.fn().mockResolvedValue({ messages: [], hasActiveRun: false }),
      };
      const { result } = renderHook(() => {
        const sessionKeyRef = useRef<string | null>(key);
        return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
          sessionKeyRef, mainSessionKey: key, routeSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
      });
      await act(async () => { await result.current[operation](); });
      expect(adapter.listSessions).toHaveBeenCalledTimes(2);
      expect(adapter.listSessions).toHaveBeenNthCalledWith(2, 'main');
      expect(result.current.sessions[0]).toMatchObject({ key, title: 'Renamed' });
      expect(result.current.refreshing).toBe(false);
      expect(result.current.refreshingSessions).toBe(false);
      expect(adapter.loadSession).toHaveBeenCalledTimes(operation === 'refreshSessions' ? 0 : 1);
      if (operation !== 'refreshSessions') expect(result.current.historyLoaded).toBe(true);
    });

    it.each(['consecutive', 'ordinary', 'retired'] as const)('does not loop or retry a %s catalog failure', async failure => {
      const key = 'owned-session';
      const pending = deferred<ReturnType<typeof createSession>[]>();
      const adapter = { connection: { backendKind }, state: 'ready',
        listSessions: jest.fn().mockReturnValueOnce(pending.promise)
          .mockRejectedValue(new SessionCatalogSupersededError()),
        loadSession: jest.fn().mockResolvedValue({ messages: [], hasActiveRun: false }),
      };
      const { result } = renderHook(() => {
        const sessionKeyRef = useRef<string | null>(key);
        return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
          sessionKeyRef, mainSessionKey: key, routeSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
      });
      await act(async () => {
        const refresh = result.current.onRefresh();
        if (failure === 'retired') adapter.state = 'reconnecting';
        pending.reject(failure === 'ordinary'
          ? new AdapterError('network', 'Session catalog read was superseded') : new SessionCatalogSupersededError());
        await refresh;
      });
      expect(adapter.listSessions).toHaveBeenCalledTimes(failure === 'consecutive' ? 2 : 1);
      expect(adapter.loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.refreshing).toBe(false);
      expect(result.current.historyLoaded).toBe(true);
    });
  });

  describe('session read scope', () => {
    const first = 'agent:main:first';
    const second = 'agent:main:second';
    function makeAdapter() {
      return { connection: { backendKind: 'codex' }, state: 'ready',
        listSessions: jest.fn().mockResolvedValue([createSession(first), createSession(second)]),
        loadSession: jest.fn(async (key: string) => ({ messages: [{ id: key, role: 'user', text: key, timestampMs: 1000 }], hasActiveRun: false })),
      };
    }
    function setup(adapter = makeAdapter()) {
      const hook = renderHook(({ route, currentAdapter }: { route: string; currentAdapter: ReturnType<typeof makeAdapter> }) => {
        const sessionKeyRef = useRef<string | null>(first);
        return useChatHistoryState({ adapter: currentAdapter as any, dbg: jest.fn(), t: translate,
          sessionKeyRef, mainSessionKey: first, routeSessionKey: route, gatewayConfigId: 'scope-qa', currentAgentId: 'main' });
      }, { initialProps: { route: first, currentAdapter: adapter } });
      return { ...hook, adapter };
    }

    it('does not select the old route when its bootstrap snapshot resolves after a route switch', async () => {
      const snapshot = deferred<null>();
      (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockReturnValueOnce(snapshot.promise);
      const { result, rerender, adapter } = setup();
      let old!: Promise<void>;
      act(() => { old = result.current.loadSessionsAndHistory(); });
      rerender({ route: second, currentAdapter: adapter });
      await act(async () => {
        result.current.setSessionKey(second);
        await result.current.loadHistory(second);
      });
      adapter.loadSession.mockClear();
      await act(async () => { snapshot.resolve(null); await old; });
      expect(result.current.sessionKey).toBe(second);
      expect(result.current.messages.map(message => message.text)).toEqual([second]);
      expect(adapter.loadSession).not.toHaveBeenCalled();
    });

    it.each(['loadSessionsAndHistory', 'onRefresh', 'refreshSessions'] as const)(
      'fences a delayed %s catalog before it can reselect a prior route', async operation => {
        const pending = deferred<ReturnType<typeof createSession>[]>();
        const { result, rerender, adapter } = setup();
        adapter.listSessions.mockReturnValueOnce(pending.promise);
        let old!: Promise<void>;
        await act(async () => { old = result.current[operation](); await Promise.resolve(); });
        rerender({ route: second, currentAdapter: adapter });
        await act(async () => {
          result.current.setSessionKey(second);
          result.current.setSessions([createSession(second)]);
          await result.current.loadHistory(second);
        });
        adapter.loadSession.mockClear();
        await act(async () => { pending.resolve([createSession(first)]); await old; });
        expect(result.current.sessionKey).toBe(second);
        expect(result.current.messages.map(message => message.text)).toEqual([second]);
        expect(result.current.sessions.map(session => session.key)).toEqual([second]);
        expect(adapter.loadSession).not.toHaveBeenCalled();
        expect(result.current.refreshing).toBe(false);
        expect(result.current.refreshingSessions).toBe(false);
      },
    );

    it.each(['success', 'failure'] as const)(
      'finishes initial history after an overlapping pure directory refresh %s', async outcome => {
        const snapshot = deferred<null>();
        (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockReturnValueOnce(snapshot.promise);
        const { result, adapter } = setup();
        let bootstrap!: Promise<void>;
        act(() => { bootstrap = result.current.loadSessionsAndHistory(); });
        if (outcome === 'failure') adapter.listSessions.mockRejectedValueOnce(new AdapterError('network', 'Offline'));
        else adapter.listSessions.mockResolvedValueOnce([{ ...createSession(first), title: 'Latest' }]);
        await act(async () => { await result.current.refreshSessions(); });
        expect(adapter.loadSession).not.toHaveBeenCalled();
        await act(async () => { snapshot.resolve(null); await bootstrap; });
        expect(adapter.loadSession).toHaveBeenCalledTimes(1);
        expect(result.current.sessionKey).toBe(first);
        expect(result.current.historyLoaded).toBe(true);
        expect(result.current.messages.map(message => message.text)).toEqual([first]);
        if (outcome === 'success') expect(result.current.sessions[0].title).toBe('Latest');
      },
    );

    it('does not repopulate a newer empty catalog from a delayed local snapshot', async () => {
      const snapshot = deferred<{ sessionKey: string; title: string; updatedAt: number }>();
      (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockReturnValueOnce(snapshot.promise);
      const { result, adapter } = setup();
      let bootstrap!: Promise<void>;
      act(() => { bootstrap = result.current.loadSessionsAndHistory(); });
      adapter.listSessions.mockResolvedValueOnce([]);
      await act(async () => { await result.current.refreshSessions(); });
      expect(result.current.sessions).toEqual([]);
      await act(async () => { snapshot.resolve({ sessionKey: first, title: 'Old cached row', updatedAt: 1000 }); await bootstrap; });
      expect(result.current.sessions).toEqual([]);
      expect(adapter.loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.historyLoaded).toBe(true);
    });

    it('does not let an old callback retire the current route bootstrap', async () => {
      const snapshot = deferred<null>();
      const { result, rerender, adapter } = setup();
      const obsoleteRefresh = result.current.onRefresh;
      rerender({ route: second, currentAdapter: adapter });
      act(() => result.current.setSessionKey(second));
      (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockReturnValueOnce(snapshot.promise);
      let bootstrap!: Promise<void>;
      act(() => { bootstrap = result.current.loadSessionsAndHistory(); });
      await act(async () => { await obsoleteRefresh(); snapshot.resolve(null); await bootstrap; });
      expect(adapter.listSessions).toHaveBeenCalledTimes(1);
      expect(adapter.loadSession).toHaveBeenCalledTimes(1);
      expect(adapter.loadSession).toHaveBeenCalledWith(second, { limit: 50 });
      expect(result.current.sessionKey).toBe(second);
      expect(result.current.historyLoaded).toBe(true);
    });

    it('does not start history after a delayed cache restore crosses a route switch', async () => {
      const cache = deferred<[]>();
      (ChatCacheService.getMessages as jest.Mock).mockReturnValueOnce(cache.promise);
      const { result, rerender, adapter } = setup();
      let old!: Promise<void>;
      await act(async () => { old = result.current.onRefresh(); await Promise.resolve(); });
      expect(ChatCacheService.getMessages).toHaveBeenCalledTimes(1);
      rerender({ route: second, currentAdapter: adapter });
      await act(async () => { result.current.setSessionKey(second); await result.current.loadHistory(second); });
      adapter.loadSession.mockClear();
      await act(async () => { cache.resolve([]); await old; });
      expect(result.current.sessionKey).toBe(second);
      expect(result.current.messages.map(message => message.text)).toEqual([second]);
      expect(adapter.loadSession).not.toHaveBeenCalled();
      expect(result.current.refreshing).toBe(false);
    });

    it('does not run an old history fallback after a delayed ordinary catalog failure', async () => {
      const pending = deferred<ReturnType<typeof createSession>[]>();
      const { result, rerender, adapter } = setup();
      adapter.listSessions.mockReturnValueOnce(pending.promise);
      let old!: Promise<void>;
      await act(async () => { old = result.current.onRefresh(); });
      rerender({ route: second, currentAdapter: adapter });
      await act(async () => { result.current.setSessionKey(second); await result.current.loadHistory(second); });
      adapter.loadSession.mockClear();
      await act(async () => { pending.reject(new AdapterError('network', 'Offline')); await old; });
      expect(adapter.loadSession).not.toHaveBeenCalled();
      expect(result.current.sessionKey).toBe(second);
      expect(result.current.refreshing).toBe(false);
    });

    it.each(['onRefresh', 'refreshSessions'] as const)(
      'does not let an older %s clear or replace a newer refresh', async operation => {
        const older = deferred<Array<ReturnType<typeof createSession> & { title: string }>>();
        const newer = deferred<Array<ReturnType<typeof createSession> & { title: string }>>();
        const { result, adapter } = setup();
        adapter.listSessions.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        let old!: Promise<void>, latest!: Promise<void>;
        await act(async () => { old = result.current[operation](); latest = result.current[operation](); });
        await act(async () => { older.resolve([{ ...createSession(first), title: 'Old' }]); await old; });
        expect(result.current[operation === 'onRefresh' ? 'refreshing' : 'refreshingSessions']).toBe(true);
        expect(result.current.sessions.some(session => session.title === 'Old')).toBe(false);
        await act(async () => { newer.resolve([{ ...createSession(first), title: 'Latest' }]); await latest; });
        expect(result.current.sessions[0]).toMatchObject({ key: first, title: 'Latest' });
        expect(result.current.refreshing).toBe(false);
        expect(result.current.refreshingSessions).toBe(false);
      },
    );

    it.each(['route', 'adapter', 'selection', 'unmount'] as const)(
      'does not retry a superseded catalog after %s changes', async change => {
        const pending = deferred<ReturnType<typeof createSession>[]>();
        const { result, rerender, unmount, adapter } = setup();
        adapter.listSessions.mockReturnValueOnce(pending.promise);
        let old!: Promise<void>;
        await act(async () => { old = result.current.onRefresh(); });
        if (change === 'route') rerender({ route: second, currentAdapter: adapter });
        if (change === 'adapter') rerender({ route: first, currentAdapter: makeAdapter() });
        if (change === 'selection') act(() => result.current.setSessionKey(second));
        if (change === 'unmount') unmount();
        await act(async () => { pending.reject(new SessionCatalogSupersededError()); await old; });
        expect(adapter.listSessions).toHaveBeenCalledTimes(1);
        expect(adapter.loadSession).not.toHaveBeenCalled();
      },
    );
  });

  it('handles an immediately rejected bootstrap catalog while the local snapshot is still pending', async () => {
    const key = 'owned-session';
    const snapshot = deferred<null>();
    (StorageService.getLastOpenedSessionSnapshot as jest.Mock).mockReturnValue(snapshot.promise);
    const adapter = { connection: { backendKind: 'codex' }, state: 'ready',
      listSessions: jest.fn().mockRejectedValue(new AdapterError('network', 'Offline')),
      loadSession: jest.fn().mockResolvedValue({ messages: [], hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, routeSessionKey: key, gatewayConfigId: 'codex-connection', currentAgentId: 'main' });
    });
    let bootstrap!: Promise<void>;
    await act(async () => {
      bootstrap = result.current.loadSessionsAndHistory();
      // An unhandled rejection would be reported before this next event-loop turn.
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    expect(adapter.listSessions).toHaveBeenCalledTimes(1);
    expect(adapter.loadSession).not.toHaveBeenCalled();
    await act(async () => { snapshot.resolve(null); await bootstrap; });
    expect(adapter.loadSession).toHaveBeenCalledTimes(1);
    expect(result.current.historyLoaded).toBe(true);
    expect(result.current.sessionKey).toBe(key);
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

  it.each(['openclaw', 'hermes'])('preserves %s cache-only send identity and uncertainty through history refresh', async backendKind => {
    const key = 'agent:main:main';
    const cached = { id: 'native-looking-cache-id', cacheRowId: 'usr_100_qa', role: 'user',
      text: 'Not acknowledged', timestampMs: 100000, idempotencyKey: 'send-qa', sendUncertain: true };
    const adapter = { connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession(key)]),
      loadSession: jest.fn().mockResolvedValue({ messages: [cached], hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'usr_100_qa', sendUncertain: true, idempotencyKey: 'send-qa' });
    adapter.loadSession.mockResolvedValue({ messages: [{ ...cached, cacheRowId: undefined, sendUncertain: undefined, id: 'backend-confirmed' }], hasActiveRun: false });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].sendUncertain).toBeUndefined();
    expect(result.current.messages[0].historyMessageId).toBe('backend-confirmed');
  });

  it.each(['pi', 'openclaw', 'hermes'])('shows explicit %s transcript notices without exposing raw model system prompts', async (backendKind) => {
    const key = 'agent:main:main';
    const adapter = {
      connection: { backendKind }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([createSession(key)]),
      loadSession: jest.fn().mockResolvedValue({ messages: [
        { id: 'internal', role: 'system', content: 'Private model instructions', timestamp: 100_000 },
        { id: 'before', role: 'assistant', text: 'Before extension', timestampMs: 110_000 },
        { id: 'notice', role: 'system', text: 'Selected Blue', timestampMs: 120_000 },
        { id: 'after', role: 'assistant', text: 'After extension', timestampMs: 130_000 },
      ], hasActiveRun: false }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages.map(row => row.text)).toEqual(['Before extension', 'Selected Blue', 'After extension']);
    expect(result.current.messages[1]).toMatchObject({ role: 'system', historyMessageId: 'notice' });
    await act(async () => { await result.current.loadSessionsAndHistory(); });
    expect(result.current.messages.filter(row => row.text === 'Selected Blue')).toHaveLength(1);
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

  it('keeps a newer session switch without starting history from the old refresh', async () => {
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
    expect(adapter.loadSession).not.toHaveBeenCalled();
    expect(result.current.state.refreshing).toBe(false);
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

  it('reads again after pre-recovery history finishes instead of mistaking it for current history', async () => {
    const key = 'agent:main:main'; const old = deferred<{ messages: unknown[] }>();
    const adapter = { state: 'ready', listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockReturnValueOnce(old.promise).mockResolvedValue({
        messages: [{ id: 'fresh', role: 'assistant', text: 'Latest reply', timestampMs: 200000 }], hasActiveRun: false,
      }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    let initial!: Promise<number>; let recovery!: Promise<void>;
    act(() => { initial = result.current.loadHistory(key); });
    act(() => { recovery = result.current.refreshCurrentSessionHistory({ afterInFlight: true, isCurrent: () => true }); });
    expect(adapter.loadSession).toHaveBeenCalledTimes(1);
    await act(async () => { old.resolve({ messages: [] }); await initial; await recovery; });
    expect(adapter.loadSession).toHaveBeenCalledTimes(2);
    expect(result.current.messages.map(message => message.text)).toEqual(['Latest reply']);
    expect(adapter.listSessions).not.toHaveBeenCalled();
  });

  it.each(['scope', 'inactive'] as const)('does not dispatch a delayed recovery read after %s changes', async change => {
    const key = 'agent:main:main'; const old = deferred<{ messages: unknown[] }>();
    const adapter = { state: 'ready', listSessions: jest.fn().mockResolvedValue([]), loadSession: jest.fn(() => old.promise) };
    let current = true;
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate,
        sessionKeyRef, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    let initial!: Promise<number>; let recovery!: Promise<void>;
    act(() => { initial = result.current.loadHistory(key); });
    act(() => { recovery = result.current.refreshCurrentSessionHistory({ afterInFlight: true, isCurrent: () => current }); });
    act(() => { if (change === 'scope') result.current.setSessionKey('agent:main:other'); else current = false; });
    await act(async () => { old.resolve({ messages: [] }); await initial; await recovery; });
    expect(adapter.loadSession).toHaveBeenCalledTimes(1);
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

  it.each(['openclaw', 'hermes', 'pi', 'codex', 'claude-code'])('%s recovery never overwrites a prior turn after canonical history already contains the new reply', async backendKind => {
    const key = 'agent:main:main';
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockResolvedValue({ messages: [
      { id: 'new-user', role: 'user', text: 'Second prompt' },
      { id: 'new-answer', role: 'assistant', text: 'Second answer' },
    ] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    act(() => result.current.setMessages([
      { id: 'final_previous', role: 'assistant', text: 'First answer', timestampMs: 1000, historyMessageId: 'old-answer' },
      { id: 'new-user', role: 'user', text: 'Second prompt', idempotencyKey: 'send-2' },
      { id: 'history_new', role: 'assistant', text: 'Second answer', historyMessageId: 'new-answer' },
    ]));
    const before = result.current.messages;
    await act(async () => { await result.current.reconcileLatestAssistantFromHistory(key, { appendIfMissing: true }); });
    expect(result.current.messages).toBe(before);
    expect(result.current.messages.map(message => message.text)).toEqual(['First answer', 'Second prompt', 'Second answer']);
  });

  it.each(['openclaw', 'hermes', 'pi', 'codex', 'claude-code'])('%s reconciliation cannot cross a newer user turn while its history request is pending', async backendKind => {
    const key = 'agent:main:main';
    const pending = deferred<any>();
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockReturnValue(pending.promise) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    act(() => result.current.setMessages([
      { id: 'user-old', role: 'user', text: 'First prompt', idempotencyKey: 'send-old' },
      { id: 'final_old', role: 'assistant', text: 'First partial' },
    ]));
    let request!: Promise<void>;
    act(() => { request = result.current.reconcileLatestAssistantFromHistory(key, { appendIfMissing: true }); });
    act(() => result.current.setMessages(prev => [...prev,
      { id: 'user-new', role: 'user', text: 'Second prompt', idempotencyKey: 'send-new' },
      { id: 'final_new', role: 'assistant', text: 'Second answer' },
    ]));
    const before = result.current.messages;
    await act(async () => {
      pending.resolve({ messages: [{ role: 'assistant', text: 'First complete' }] });
      await request;
    });
    expect(result.current.messages).toBe(before);
  });

  it.each(['openclaw', 'hermes', 'pi', 'codex', 'claude-code'])('%s recovery does not borrow an older answer when the current prompt has no reply yet', async backendKind => {
    const key = 'agent:main:main';
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockResolvedValue({ messages: [
      { id: 'old-answer', role: 'assistant', text: 'First answer' },
      { id: 'new-user', role: 'user', text: 'Second prompt' },
    ] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    act(() => result.current.setMessages([{ id: 'new-user', role: 'user', text: 'Second prompt' }]));
    const before = result.current.messages;
    await act(async () => { await result.current.reconcileLatestAssistantFromHistory(key, { appendIfMissing: true }); });
    expect(result.current.messages).toBe(before);
  });

  it.each(['openclaw', 'hermes', 'pi', 'codex', 'claude-code'])('%s ignores a stale native answer already known to belong to an earlier prompt', async backendKind => {
    const key = 'agent:main:main';
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockResolvedValue({ messages: [
      { id: 'old-user', role: 'user', text: 'First prompt' },
      { id: 'old-answer', role: 'assistant', text: 'First answer' },
    ] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    act(() => result.current.setMessages([
      { id: 'final_old', role: 'assistant', text: 'First answer', historyMessageId: 'old-answer' },
      { id: 'new-user', role: 'user', text: 'Second prompt' },
      { id: 'final_new', role: 'assistant', text: 'Second partial' },
    ]));
    const before = result.current.messages;
    await act(async () => { await result.current.reconcileLatestAssistantFromHistory(key, { appendIfMissing: true }); });
    expect(result.current.messages).toBe(before);
  });

  it('retains assistant recovery across a native user tool-result envelope', async () => {
    const key = 'agent:main:main';
    const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValue({ messages: [
      { role: 'user', content: 'Inspect the fixture' },
      { role: 'assistant', content: 'I will inspect the fixture.' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'fixture contents' }] },
    ] }) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    act(() => result.current.setMessages([{ id: 'prompt', role: 'user', text: 'Inspect the fixture' }]));
    await act(async () => { await result.current.reconcileLatestAssistantFromHistory(key, { appendIfMissing: true }); });
    expect(result.current.messages.map(message => message.text)).toEqual(['Inspect the fixture', 'I will inspect the fixture.']);
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

  it.each(['codex', 'claude-code', 'pi'])('follows the real %s history cursor instead of treating a short first page as the end', async backendKind => {
    const key = 'owned-session';
    const row = (index: number) => ({ id: `native-${index}`, role: index % 2 ? 'assistant' : 'user', text: `message ${index}`, timestampMs: 10_000 + index });
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn()
      .mockResolvedValueOnce({ key, sessionId: 'native-session', messages: Array.from({ length: 31 }, (_, i) => row(i + 16)), nextCursor: 'older-16', hasActiveRun: false })
      .mockResolvedValueOnce({ key, sessionId: 'native-session', messages: Array.from({ length: 16 }, (_, i) => row(i)), hasActiveRun: true, thinkingLevel: 'old' }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, routeSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadHistory(key); });
    await act(async () => { await result.current.onLoadMoreHistory(); });
    expect(adapter.loadSession).toHaveBeenCalledTimes(2);
    expect(adapter.loadSession).toHaveBeenLastCalledWith(key, { limit: 50, cursor: 'older-16' });
    expect(result.current.messages.filter(row => row.role === 'user')).toHaveLength(24);
    expect(result.current.messages.some(row => row.text === 'message 0')).toBe(true);
    expect(result.current.hasMoreHistory).toBe(false);
    expect(result.current.activitySnapshot?.hasActiveRun).toBe(false);
    expect(result.current.thinkingLevel).not.toBe('old');
    expect(ChatCacheService.getTimelinePage).not.toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes', 'codex', 'claude-code', 'pi'])('allows the next %s page immediately after the previous page settles', async backendKind => {
    const key = 'owned-session';
    const page = (id: string, nextCursor?: string) => ({ key, sessionId: 'native',
      messages: [{ id, role: 'user', text: id, timestampMs: 10_000 }], nextCursor });
    const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn()
      .mockResolvedValueOnce(page('newest', 'p1'))
      .mockResolvedValueOnce(page('middle', 'p2'))
      .mockResolvedValueOnce(page('oldest')) };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, routeSessionKey: key, gatewayConfigId: null, currentAgentId: 'main' });
    });
    await act(async () => { await result.current.loadHistory(key); });
    await act(async () => { await result.current.onLoadMoreHistory(); });
    expect(result.current.loadingMoreHistory).toBe(false);
    // No timer advancement: a second pull after completion must use the new cursor now.
    await act(async () => { await result.current.onLoadMoreHistory(); });
    expect(adapter.loadSession).toHaveBeenCalledTimes(3);
    expect(adapter.loadSession).toHaveBeenLastCalledWith(key, { limit: 50, cursor: 'p2' });
    expect(result.current.hasMoreHistory).toBe(false);
    expect(result.current.messages.filter(row => row.role === 'user').map(row => row.text))
      .toEqual(['oldest', 'middle', 'newest']);
  });

  it('gives untimed history steps the times this phone measured live', async () => {
    const key = 'agent:pi:chats';
    // Pi history: one tool row per call, its own id, no step timing.
    const adapter = { connection: { backendKind: 'pi' }, state: 'ready',
      listSessions: jest.fn().mockResolvedValue([]),
      loadSession: jest.fn().mockResolvedValue({ key, hasActiveRun: false, messages: [
        { id: 'u1', role: 'user', text: 'Run it', timestampMs: 4_000 },
        { id: 'call_1', role: 'tool', text: '', timestampMs: 5_000, tool: { name: 'bash', callId: 'call_1', status: 'success', output: 'ok' } },
      ] }),
    };
    const { result } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      const measuredToolsRef = useRef([{ id: 'toolcall_call_1', role: 'tool' as const, text: '', toolName: 'bash',
        toolStatus: 'success' as const, toolStartedAt: 10_000, toolFinishedAt: 16_000, toolDurationMs: 6_000 }]);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, routeSessionKey: key, gatewayConfigId: null, currentAgentId: 'main', measuredToolsRef });
    });
    await act(async () => { await result.current.loadHistory(key); });
    expect(result.current.messages.find(row => row.role === 'tool')).toMatchObject({
      id: 'toolresult_call_1', toolStartedAt: 10_000, toolFinishedAt: 16_000, toolDurationMs: 6_000,
    });
  });

  describe('native history cursor window', () => {
    const key = 'owned-session';
    const message = (id: string, role = 'user') => ({ id, role, text: id, timestampMs: 10_000 });
    const page = (ids: string[], nextCursor?: string) => ({ key, sessionId: 'native', messages: ids.map(id => message(id)), nextCursor, hasActiveRun: false });
    const setup = (adapter: any) => renderHook(({ route = key, source = adapter }: { route?: string; source?: any }) => {
      const sessionKeyRef = useRef<string | null>(route);
      return useChatHistoryState({ adapter: source, dbg: jest.fn(), t: translate, sessionKeyRef,
        mainSessionKey: key, routeSessionKey: route, gatewayConfigId: null, currentAgentId: 'main' });
    }, { initialProps: { route: key, source: adapter } });

    it.each([{ ids: [] }, { ids: ['new-user', 'first-reply'] }])('does not offer an older read for the complete first cursor page (%j)', async ({ ids }) => {
      // The observed new Codex chat has two rows and no nextCursor. An unopened
      // empty chat is also complete, without a previous window to identify it.
      const head = { ...page(ids), messages: ids.map((id, index) => ({ ...message(id), role: index ? 'assistant' as const : 'user' as const })), pagination: 'cursor' as const };
      const adapter = { connection: { backendKind: 'codex' }, state: 'ready',
        loadSession: jest.fn().mockResolvedValue(head) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.hasMoreHistory).toBe(false);
      expect(result.current.messages.map(row => row.text)).toEqual(ids);
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(1);
      expect(ChatCacheService.getTimelinePage).not.toHaveBeenCalled();
      await act(async () => { expect(result.current.applyReconciledHistory(head)).toBe(true); });
      expect(result.current.hasMoreHistory).toBe(false);
      expect(result.current.messages.map(row => row.text)).toEqual(ids);
    });

    it('keeps distinct native steering and reply items that share text and their turn timestamp', async () => {
      // Codex stamps every item in one native turn with turn.startedAt.
      const messages = [
        { ...message('prompt-1'), text: 'Continue' },
        { ...message('reply-1', 'assistant'), text: 'Checking.' },
        { ...message('steering-1'), text: 'Continue' },
        { ...message('reply-2', 'assistant'), text: 'Checking.' },
        { ...message('steering-2'), text: 'Continue' },
      ];
      const adapter = { connection: { backendKind: 'codex' }, state: 'ready',
        loadSession: jest.fn().mockResolvedValue({ ...page([]), messages }) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.messages.map(row => row.historyMessageId)).toEqual(messages.map(row => row.id));
      expect(new Set(result.current.messages.map(row => row.id)).size).toBe(messages.length);
      expect(result.current.messages.filter(row => row.role === 'user')).toHaveLength(3);
      const identities = result.current.messages.map(row => row.id);
      adapter.loadSession.mockResolvedValueOnce({ ...page([]), messages: messages.map(row => row.id === 'reply-2'
        ? { ...row, text: 'Checking. Finished.' } : row) });
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.messages.map(row => row.id)).toEqual(identities);
      expect(result.current.messages[3].text).toBe('Checking. Finished.');
    });

    it('recovers the real missing-page role structure: 18 users and 6 tools including the older 5 users and 3 tools', async () => {
      const roles = [...Array(5).fill('user'), ...Array(8).fill('assistant'), ...Array(3).fill('tool'),
        ...Array(13).fill('user'), ...Array(15).fill('assistant'), ...Array(3).fill('tool')];
      const rows = roles.map((role, index) => ({ ...message(`native-${index}`, role), timestampMs: 10_000 + index,
        ...(role === 'tool' ? { tool: { callId: `call-${index}`, name: 'exec', status: 'success', output: 'complete' } } : {}) }));
      const adapter = { state: 'ready', loadSession: jest.fn()
        .mockResolvedValueOnce({ ...page([], 'older'), messages: rows.slice(16) })
        .mockResolvedValueOnce({ ...page([]), messages: rows.slice(0, 16) }) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.messages.filter(row => row.role === 'user')).toHaveLength(13);
      expect(result.current.messages.filter(row => row.role === 'tool')).toHaveLength(3);
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(result.current.messages.filter(row => row.role === 'user')).toHaveLength(18);
      expect(result.current.messages.filter(row => row.role === 'tool')).toHaveLength(6);
      expect(result.current.hasMoreHistory).toBe(false);
      const assistantText = result.current.messages.filter(row => row.role === 'assistant').map(row => row.text).join(' ');
      for (let index = 5; index < 13; index++) expect(assistantText).toContain(`native-${index}`);
    });

    it('rejects a cursor head for another conversation', async () => {
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValue({ ...page(['foreign'], 'p1'), key: 'other' }) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.messages).toEqual([]);
      expect(result.current.historyLoadMoreError).toBe(true);
      expect(result.current.hasMoreHistory).toBe(true);
    });

    it('does not coalesce a new adapter head with the old same-key pending head', async () => {
      const pending = deferred<any>();
      const old = { state: 'ready', loadSession: jest.fn().mockReturnValue(pending.promise) };
      const next = { state: 'ready', loadSession: jest.fn().mockResolvedValue(page(['current'], 'more')) };
      const { result, rerender } = setup(old);
      let oldRead!: Promise<number>;
      act(() => { oldRead = result.current.loadHistory(key); });
      rerender({ route: key, source: next });
      await act(async () => { await result.current.loadHistory(key); });
      expect(next.loadSession).toHaveBeenCalledTimes(1);
      expect(result.current.messages.map(row => row.text)).toEqual(['current']);
      await act(async () => { pending.resolve(page(['stale'], 'old')); await oldRead; });
      expect(result.current.messages.map(row => row.text)).toEqual(['current']);
    });

    it('retries a malformed initial cursor head from the head instead of reporting an empty conversation', async () => {
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['a', 'a'], 'p1'))
        .mockResolvedValueOnce(page(['a'], 'p1')) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.historyLoadMoreError).toBe(true);
      await act(async () => { await result.current.retryLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenLastCalledWith(key, { limit: 50 });
      expect(result.current.messages.map(row => row.text)).toEqual(['a']);
    });

    it('does not publish old head activity or thinking again when fetching an older page', async () => {
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['b'], 'older')).mockResolvedValueOnce(page(['a'])) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      const activity = result.current.activitySnapshot;
      act(() => { result.current.setThinkingLevel('new-live'); result.current.setMessages(previous => [...previous,
        { id: 'stream_segment_run-1_0', presentationRunId: 'run-1', role: 'assistant', text: 'in progress', streaming: true, timestampMs: 20_000 }]); });
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(result.current.activitySnapshot).toBe(activity);
      expect(result.current.thinkingLevel).toBe('new-live');
      expect(result.current.messages.some(row => row.id === 'stream_segment_run-1_0' && row.streaming)).toBe(true);
    });

    it('preserves native older rows and rendered identities after fresh and event head refreshes', async () => {
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['c'], 'old'))
        .mockResolvedValueOnce(page(['a', 'b'])).mockResolvedValueOnce(page(['c', 'd'], 'head-old')) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      await act(async () => { await result.current.onLoadMoreHistory(); });
      const ids = result.current.messages.map(row => row.id);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.messages.map(row => row.text)).toEqual(['a', 'b', 'c', 'd']);
      expect(result.current.messages.slice(0, 3).map(row => row.id)).toEqual(ids);
      expect(result.current.hasMoreHistory).toBe(false);
      await act(async () => { expect(result.current.applyReconciledHistory(page(['d', 'e'], 'event-old') as any)).toBe(true); });
      expect(result.current.messages.map(row => row.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(result.current.hasMoreHistory).toBe(false);
    });

    it.each(['codex', 'openclaw', 'hermes'])('finishes the %s reader page before a tool-result head refresh without losing either segment', async backendKind => {
      const older = deferred<any>();
      const adapter = { connection: { backendKind }, state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['c'], 'old'))
        .mockReturnValueOnce(older.promise).mockResolvedValueOnce(page(['c', 'd'], 'head-old')) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      let paging!: Promise<void>, refresh!: Promise<number>;
      act(() => { paging = result.current.onLoadMoreHistory(); });
      act(() => { refresh = result.current.loadHistory(key); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(2);
      expect(result.current.loadingMoreHistory).toBe(true);
      await act(async () => { older.resolve(page(['a', 'b'])); await Promise.all([paging, refresh]); });
      expect(result.current.messages.map(row => row.text)).toEqual(['a', 'b', 'c', 'd']);
      expect(result.current.hasMoreHistory).toBe(false);
      expect(result.current.loadingMoreHistory).toBe(false);
      expect(result.current.historyLoadMoreError).toBe(false);
    });

    it('uses the updated cursor when the reader requests a page during a background head refresh', async () => {
      const head = deferred<any>();
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['c'], 'old'))
        .mockReturnValueOnce(head.promise).mockResolvedValueOnce(page(['a', 'b', 'c'])) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      let paging!: Promise<void>, refresh!: Promise<number>;
      act(() => { refresh = result.current.loadHistory(key); });
      act(() => { paging = result.current.onLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(2);
      await act(async () => { head.resolve(page(['d'], 'new-cursor')); await Promise.all([paging, refresh]); });
      expect(adapter.loadSession).toHaveBeenLastCalledWith(key, { limit: 50, cursor: 'new-cursor' });
      expect(result.current.messages.map(row => row.text)).toEqual(['a', 'b', 'c', 'd']);
      expect(result.current.hasMoreHistory).toBe(false);
      expect(result.current.loadingMoreHistory).toBe(false);
    });

    it('keeps a queued reconciliation head and its current activity after a pending earlier page', async () => {
      const older = deferred<any>();
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['c'], 'old'))
        .mockReturnValueOnce(older.promise) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      let paging!: Promise<void>;
      act(() => { paging = result.current.onLoadMoreHistory(); });
      const currentHead = { ...page(['c', 'd'], 'event-old'), hasActiveRun: true, activeRunId: 'new-run' };
      const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
      try {
        act(() => { expect(result.current.applyReconciledHistory(currentHead as any)).toBe(true); });
        expect(result.current.messages.map(row => row.text)).toEqual(['c']);
        clock.mockReturnValue(5000);
        await act(async () => { older.resolve(page(['a', 'b'])); await paging; });
        expect(adapter.loadSession).toHaveBeenCalledTimes(2);
        expect(result.current.messages.map(row => row.text)).toEqual(['a', 'b', 'c', 'd']);
        expect(result.current.activitySnapshot).toMatchObject({ hasActiveRun: true, activeRunId: 'new-run', requestedAtMs: 1000 });
        expect(result.current.hasMoreHistory).toBe(false);
      } finally { clock.mockRestore(); }
    });

    it.each(['route', 'selection', 'retirement'])('discards a queued head before dispatch after %s changes without blocking the new read', async invalidation => {
      const older = deferred<any>(); let stateListener: (state: string) => void = () => {};
      const adapter = { state: 'ready', on: jest.fn((_event, listener) => { stateListener = listener; return () => {}; }),
        loadSession: jest.fn().mockResolvedValueOnce(page(['b'], 'old')).mockReturnValueOnce(older.promise) };
      const { result, rerender } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      let paging!: Promise<void>, queued!: Promise<number>;
      act(() => { paging = result.current.onLoadMoreHistory(); });
      act(() => { queued = result.current.loadHistory(key); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(2);
      let currentKey = key;
      if (invalidation === 'route') {
        currentKey = 'other';
        rerender({ route: currentKey, source: adapter });
        act(() => result.current.setSessionKey(currentKey));
      } else if (invalidation === 'selection') {
        act(() => result.current.setSessionKey('other'));
        act(() => result.current.setSessionKey(key));
      } else act(() => { stateListener('reconnecting'); stateListener('ready'); });
      adapter.loadSession.mockResolvedValueOnce({ ...page(['current'], 'current-old'), key: currentKey });
      await act(async () => { await result.current.loadHistory(currentKey); });
      const expected = invalidation === 'retirement' ? ['b', 'current'] : ['current'];
      expect(result.current.messages.map(row => row.text)).toEqual(expected);
      await act(async () => { older.resolve(page(['stale'])); await Promise.all([paging, queued]); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(3);
      expect(result.current.messages.map(row => row.text)).toEqual(expected);
      expect(result.current.loadingMoreHistory).toBe(false);
    });

    it.each(['initial', 'older'])('advances through an empty %s native page', async when => {
      const adapter = { state: 'ready', loadSession: jest.fn()
        .mockResolvedValueOnce(page(when === 'initial' ? [] : ['c'], 'p1'))
        .mockResolvedValueOnce(page([], 'p2')).mockResolvedValueOnce(page(['a'])) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      if (when === 'older') await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(3);
      expect(adapter.loadSession).toHaveBeenLastCalledWith(key, { limit: 50, cursor: 'p2' });
      expect(result.current.messages[0].text).toBe('a'); expect(result.current.hasMoreHistory).toBe(false);
    });

    it('bounds an empty first-page chain and exposes manual continuation with its last cursor', async () => {
      let n = 0;
      const adapter = { state: 'ready', loadSession: jest.fn().mockImplementation(() => Promise.resolve(page([], `p${++n}`))) };
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(9);
      expect(result.current.historyLoadMoreError).toBe(true); expect(result.current.hasMoreHistory).toBe(true);
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(9);
      adapter.loadSession.mockResolvedValueOnce(page(['visible']));
      await act(async () => { await result.current.retryLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenLastCalledWith(key, { limit: 50, cursor: 'p9' });
      expect(result.current.messages[0].text).toBe('visible'); expect(result.current.historyLoadMoreError).toBe(false);
    });

    it.each(['repeated', 'network', 'identity'])('keeps rows and the cursor after a %s failure; only explicit retry reads again', async failure => {
      jest.useFakeTimers();
      const adapter = { state: 'ready', loadSession: jest.fn().mockResolvedValueOnce(page(['b'], 'p1')) };
      if (failure === 'network') adapter.loadSession.mockRejectedValueOnce(new Error('network'));
      else adapter.loadSession.mockResolvedValueOnce(failure === 'repeated' ? page(['a'], 'p1') : { ...page(['a']), sessionId: 'foreign' });
      const { result } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(result.current.messages.map(row => row.text)).toEqual(['b']);
      expect(result.current.historyLoadMoreError).toBe(true); expect(result.current.hasMoreHistory).toBe(true);
      act(() => jest.advanceTimersByTime(350));
      await act(async () => { await result.current.onLoadMoreHistory(); });
      expect(adapter.loadSession).toHaveBeenCalledTimes(2);
      adapter.loadSession.mockResolvedValueOnce(page(['a']));
      await act(async () => { await result.current.retryLoadMoreHistory(); });
      expect(result.current.messages.map(row => row.text)).toEqual(['a', 'b']);
      expect(result.current.historyLoadMoreError).toBe(false); jest.useRealTimers();
    });

    it.each(['route', 'adapter', 'retirement', 'selection'])('drops an older page across %s invalidation', async invalidation => {
      const pending = deferred<any>(); let stateListener: (state: string) => void = () => {};
      const adapter = { state: 'ready', on: jest.fn((_event, listener) => { stateListener = listener; return () => {}; }),
        loadSession: jest.fn().mockResolvedValueOnce(page(['b'], 'p1')).mockReturnValueOnce(pending.promise) };
      const { result, rerender } = setup(adapter);
      await act(async () => { await result.current.loadHistory(key); });
      let request!: Promise<void>;
      act(() => { request = result.current.onLoadMoreHistory(); });
      if (invalidation === 'route') rerender({ route: 'other', source: adapter });
      else if (invalidation === 'adapter') rerender({ route: key, source: { ...adapter } });
      else if (invalidation === 'selection') { act(() => result.current.setSessionKey('other')); act(() => result.current.setSessionKey(key)); }
      else act(() => { stateListener('reconnecting'); stateListener('ready'); });
      const previous = result.current.messages;
      await act(async () => { pending.resolve(page(['stale'])); await request; });
      expect(result.current.messages).toBe(previous);
      expect(result.current.messages.some(row => row.text === 'stale')).toBe(false);
    });
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
