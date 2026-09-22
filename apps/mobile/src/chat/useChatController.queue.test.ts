import { act, renderHook } from '@testing-library/react-native';
import { useIsFocused } from '@react-navigation/native';
import * as Network from 'expo-network';
import { resolveCapabilities, type BackendKind } from '@clawket/agent-protocol';
import { analyticsEvents } from '../services/analytics/events';
import { getMessageQueueStore, messageQueueScopeKey, MESSAGE_QUEUE_LIMIT, resetMessageQueueStore } from './messageQueue';
import * as imagePreparation from './preparePendingImagesForSend';
import { mapAdapterSessionUpdate, useAdapterChatEvents } from './useAdapterChatEvents';
import { useChatController } from './useChatController';

const SESSION_KEY = 'agent:main:main';

const historyMock = {
  sessionKey: SESSION_KEY as string | null,
  sessions: [{ key: SESSION_KEY, kind: 'direct' as const }],
  refreshing: false,
  refreshingSessions: false,
  hasMoreHistory: false,
  loadingMoreHistory: false,
  historyLoaded: true,
  activitySnapshot: null as (import('@clawket/agent-protocol').SessionHistory & { requestedAtMs: number }) | null,
  messages: [] as any[],
  thinkingLevel: null as string | null,
  historyLimitRef: { current: 50 },
  historyRawCountRef: { current: 0 },
  loadMoreLockRef: { current: false },
  setMessages: jest.fn((next: any[] | ((previous: any[]) => any[])) => {
    historyMock.messages = typeof next === 'function' ? next(historyMock.messages) : next;
  }),
  setSessions: jest.fn((next: any[] | ((previous: any[]) => any[])) => {
    historyMock.sessions = typeof next === 'function' ? next(historyMock.sessions) : next;
  }),
  setSessionKey: jest.fn((key: string | null) => {
    historyMock.sessionKey = key;
  }),
  setHistoryLoaded: jest.fn(),
  setHasMoreHistory: jest.fn(),
  setThinkingLevel: jest.fn(),
  refreshSessions: jest.fn(),
  onLoadMoreHistory: jest.fn(),
  onRefresh: jest.fn().mockResolvedValue(undefined),
  loadHistory: jest.fn().mockResolvedValue(0),
  restoreCachedMessages: jest.fn().mockResolvedValue(undefined),
  loadSessionsAndHistory: jest.fn().mockResolvedValue(undefined),
  reconcileLatestAssistantFromHistory: jest.fn().mockResolvedValue(undefined),
  refreshCurrentSessionHistory: jest.fn().mockResolvedValue(undefined),
};

const imagePickerMock = {
  pendingImages: [] as any[],
  setPendingImages: jest.fn((next: any[] | ((previous: any[]) => any[])) => {
    imagePickerMock.pendingImages = typeof next === 'function' ? next(imagePickerMock.pendingImages) : next;
  }),
  pickImage: jest.fn(),
  clearPendingImages: jest.fn(() => {
    imagePickerMock.pendingImages = [];
  }),
  removePendingImage: jest.fn(),
  canAddMoreImages: true,
};

const mockAppContext: any = {
  activeGatewayConfigId: null,
  mainSessionKey: SESSION_KEY,
  currentAgentId: 'main',
  agents: [],
  setAgents: jest.fn(),
  setCurrentAgentId: jest.fn(),
  pendingAgentSwitch: null,
  clearPendingAgentSwitch: jest.fn(),
  execApprovalEnabled: true,
  pendingChatInput: null,
  clearPendingChatInput: jest.fn(),
  pendingMainSessionSwitch: false,
  clearPendingMainSessionSwitch: jest.fn(),
  initialChatPreview: null,
};

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(() => true),
}));

jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(() => ({
    t: (key: string, options?: Record<string, unknown>) => key.replace(
      /\{\{\s*(\w+)\s*\}\}/g,
      (_match, token: string) => String(options?.[token] ?? ''),
    ),
    i18n: { language: 'en-US' },
  })),
}));

jest.mock('../i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));



jest.mock('../services/auto-app-review', () => ({
  recordSuccessfulSendForAutomaticReview: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/image-cache', () => ({
  cacheMessageImages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/storage', () => ({
  StorageService: {
    getComposerDraft: jest.fn().mockResolvedValue(''),
    setComposerDraft: jest.fn().mockResolvedValue(undefined),
    getLastSessionKey: jest.fn().mockResolvedValue(null),
    getLastOpenedSessionSnapshot: jest.fn().mockResolvedValue(null),
    getCachedAgentIdentity: jest.fn().mockResolvedValue(null),
    setLastSessionKey: jest.fn().mockResolvedValue(undefined),
    setLastOpenedSessionSnapshot: jest.fn().mockResolvedValue(undefined),
    setCachedAgentIdentity: jest.fn().mockResolvedValue(undefined),
    getToolDurations: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../hooks/useChatImagePicker', () => ({
  useChatImagePicker: jest.fn(() => imagePickerMock),
}));

jest.mock('../hooks/useChatImagePreview', () => ({
  useChatImagePreview: jest.fn(() => ({
    closePreview: jest.fn(),
    previewIndex: 0,
    previewUris: [],
    previewVisible: false,
    screenHeight: 800,
    screenWidth: 390,
    setPreviewIndex: jest.fn(),
  })),
}));

jest.mock('../hooks/useChatAutoCache', () => ({
  useChatAutoCache: jest.fn(),
}));

jest.mock('../contexts/AppContext', () => ({
  useAppContext: jest.fn(() => mockAppContext),
}));

jest.mock('./useChatHistoryState', () => ({
  useChatHistoryState: jest.fn(() => historyMock),
}));

jest.mock('../chat/useAdapterChatEvents', () => ({
  ...jest.requireActual('../chat/useAdapterChatEvents'),
  useAdapterChatEvents: jest.fn(),
}));

jest.mock('./useChatVoiceInput', () => ({
  useChatVoiceInput: jest.fn(() => ({
    toggleVoiceInput: jest.fn(),
    voiceInputActive: false,
    voiceInputDisabled: false,
    voiceInputLevel: { value: 0 },
    voiceInputState: 'idle',
    voiceInputSupported: true,
  })),
}));

jest.mock('./useChatModelPicker', () => ({
  useChatModelPicker: jest.fn(() => ({
    availableModels: [],
    modelPickerError: null,
    modelPickerLoading: false,
    modelPickerVisible: false,
    onSelectModel: jest.fn(),
    openModelPicker: jest.fn(() => true),
    retryModelPickerLoad: jest.fn(),
    setModelPickerVisible: jest.fn(),
  })),
}));

jest.mock('./useChatCommandPicker', () => ({
  useChatCommandPicker: jest.fn(() => ({
    closeCommandPicker: jest.fn(),
    commandPickerError: null,
    commandPickerLoading: false,
    commandPickerOptions: [],
    commandPickerTitle: 'Thinking',
    commandPickerVisible: false,
    onSelectCommandOption: jest.fn(),
    openCommandPicker: jest.fn(() => true),
    retryCommandPickerLoad: jest.fn(),
  })),
}));

jest.mock('../services/analytics/events', () => ({
  analyticsEvents: {
    chatSendTapped: jest.fn(),
    chatSlashCommandTriggered: jest.fn(),
    chatMessageQueued: jest.fn(),
    chatQueuedMessageDelivered: jest.fn(),
    chatQueuedMessageEdited: jest.fn(),
    chatQueuedMessageRemoved: jest.fn(),
    chatQueueHeld: jest.fn(),
    approvalResolved: jest.fn(),
  },
}));

function createAdapter(backendKind: BackendKind = 'openclaw', transportKind?: string) {
  const transportKinds = { openclaw: 'relay', hermes: 'relay', 'local-model': 'relay', youmind: 'https' } as const;
  let promptSeq = 0;
  return {
    state: 'ready',
    capabilities: resolveCapabilities(backendKind),
    connection: {
      id: `${backendKind}-connection`,
      backendKind,
      transportKind: transportKind ?? transportKinds[backendKind],
      label: backendKind,
      createdAt: 1,
      isFreeSlot: true,
    },
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    probe: jest.fn().mockResolvedValue(true),
    listAgents: jest.fn().mockResolvedValue([]),
    listSessions: jest.fn().mockResolvedValue([]),
    loadSession: jest.fn().mockResolvedValue({ key: SESSION_KEY, messages: [], hasActiveRun: false }),
    prompt: jest.fn(async () => ({ runId: `run-${++promptSeq}` })),
    cancel: jest.fn().mockResolvedValue(undefined),
    management: {
      models: { listThinkingLevels: () => [] },
      approvals: { resolveExec: jest.fn().mockResolvedValue(undefined) },
    },
    on: jest.fn(() => jest.fn()),
  };
}

function latestAdapterHandlers() {
  const handlers = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
  if (!handlers) throw new Error('Adapter event handlers were not registered');
  return handlers;
}

function renderController(backendKind: BackendKind = 'openclaw', adapterOverride?: ReturnType<typeof createAdapter>) {
  const adapter = adapterOverride ?? createAdapter(backendKind);
  const rendered = renderHook(() => useChatController({
    adapter: adapter as any,
    debugMode: false,
    showAgentAvatar: true,
  }));
  act(() => {
    latestAdapterHandlers().onState?.('ready');
  });
  return { ...rendered, adapter, handlers: latestAdapterHandlers };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function typeAndSend(result: { current: any }, text: string) {
  await act(async () => {
    result.current.setInput(text);
  });
  await act(async () => {
    result.current.onSend();
  });
  await flush();
}

function finishRun(handlers: () => any, runId: string, stopReason: 'end_turn' | 'cancelled' | 'error' = 'end_turn') {
  act(() => {
    handlers().onUpdate?.(mapAdapterSessionUpdate({
      type: 'run_finished',
      sessionKey: SESSION_KEY,
      runId,
      stopReason,
      ...(stopReason === 'end_turn' ? { message: { role: 'assistant', content: `Reply ${runId}` } } : {}),
    }, { now: () => 1_000 }));
  });
}

function queuedRows(result: { current: any }) {
  return result.current.listData.filter((message: any) => message.delivery);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('useChatController message queue', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
    jest.clearAllMocks();
    jest.mocked(useIsFocused).mockReturnValue(true);
    resetMessageQueueStore();
    historyMock.sessionKey = SESSION_KEY;
    historyMock.sessions = [{ key: SESSION_KEY, kind: 'direct' as const }];
    historyMock.messages = [];
    historyMock.historyLoaded = true;
    historyMock.activitySnapshot = null;
    historyMock.refreshing = false;
    historyMock.refreshingSessions = false;
    imagePickerMock.pendingImages = [];
    mockAppContext.currentAgentId = 'main';
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      type: 'WIFI' as any,
      isConnected: true,
      isInternetReachable: true,
    });
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it.each(['openclaw', 'hermes'] as const)('%s submits the completed voice text without waiting for a draft render', async (backend) => {
    const { result, adapter } = renderController(backend);
    act(() => { result.current.setInput('stale draft'); });
    await act(async () => { result.current.setInput('complete voice text'); result.current.onSend('complete voice text'); });
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.listData.some((message) => message.text === 'complete voice text')).toBe(true);
    expect(result.current.listData.some((message) => message.text === 'stale draft')).toBe(false);
  });

  it('does not clear a new live turn when a foreground history refresh finishes late', async () => {
    const refresh = deferred<void>();
    historyMock.onRefresh.mockReturnValueOnce(refresh.promise);
    jest.mocked(useIsFocused).mockReturnValue(false);
    const { result, handlers, rerender } = renderController();
    jest.mocked(useIsFocused).mockReturnValue(true);
    rerender(undefined);
    expect(historyMock.onRefresh).toHaveBeenCalled();
    await typeAndSend(result, 'Inspect');
    act(() => {
      handlers().onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: SESSION_KEY, runId: 'run-1', text: 'Reading now.' }));
      handlers().onUpdate?.(mapAdapterSessionUpdate({ type: 'tool_call', sessionKey: SESSION_KEY, runId: 'run-1', toolCallId: 'read', title: 'read', kind: 'read' }));
    });
    const before = result.current.listData;
    await act(async () => { refresh.resolve(); });
    expect(result.current.listData).toEqual(before);
  });

  it.each(['openclaw', 'hermes'] as const)('keeps the current %s turn after a user echo followed by stale history', async (backend) => {
    const { result, handlers, rerender } = renderController(backend);
    const older = [
      { id: 'old-user', role: 'user', text: 'Previous question', timestampMs: Date.now() - 2000 },
      { id: 'old-answer', role: 'assistant', text: 'Previous answer', timestampMs: Date.now() - 1000 },
    ];
    historyMock.messages = older;
    rerender(undefined);
    await typeAndSend(result, 'Current question');
    const sent = historyMock.messages.at(-1)!;
    const reconcile = (messages: any[]) => act(() => {
      handlers().onUpdate?.({ type: 'history_reconciled', sessionKey: SESSION_KEY,
        history: { key: SESSION_KEY, messages: [], hasActiveRun: true }, hasActiveRun: true, messages });
    });
    reconcile([...older, { ...sent, id: 'server-user', renderKey: undefined }]);
    rerender(undefined);
    const thinkingKey = result.current.listData.find(message => message.streaming)?.renderKey;
    reconcile(older);
    rerender(undefined);
    expect(result.current.listData.slice().reverse().map(message => message.text))
      .toEqual(['Previous question', 'Previous answer', 'Current question', '']);
    expect(result.current.listData.find(message => message.streaming)?.renderKey).toBe(thinkingKey);
    act(() => handlers().onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk',
      sessionKey: SESSION_KEY, runId: 'run-1', text: 'Current answer streaming',
      textMode: backend === 'openclaw' ? 'snapshot' : 'delta' })));
    expect(result.current.listData.slice().reverse().map(message => message.text))
      .toEqual(['Previous question', 'Previous answer', 'Current question', 'Current answer streaming']);
    expect(result.current.listData.find(message => message.text === 'Current question')?.renderKey).toBe(sent.renderKey);
    expect(result.current.listData.find(message => message.id === 'old-answer')?.streaming).not.toBe(true);
  });

  it.each(['openclaw', 'hermes'] as const)('keeps a recovered %s tool run stable through a minute without text events', async (backend) => {
    const { result, adapter, rerender } = renderController(backend);
    const text = 'Checking the configured provider.';
    historyMock.messages = [
      { id: 'u', role: 'user', text: 'Inspect', timestampMs: Date.now() - 2000 },
      { id: 'a', role: 'assistant', text, timestampMs: Date.now() - 1000 },
      { id: 'toolcall_a', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' },
    ];
    const snapshot = { key: SESSION_KEY, messages: [], hasActiveRun: true,
      activeRun: { runId: 'recovered', text, startedAtMs: Date.now() - 2000 }, requestedAtMs: Date.now() };
    adapter.loadSession.mockResolvedValue(snapshot);
    historyMock.activitySnapshot = snapshot;
    rerender(undefined);
    const rows = result.current.listData.map(row => [row.renderKey ?? row.id, row.text, row.streaming]);
    for (let tick = 0; tick < 15; tick++) {
      await act(async () => { jest.advanceTimersByTime(4000); await Promise.resolve(); });
      expect(result.current.isSending).toBe(true);
      expect(result.current.listData.map(row => [row.renderKey ?? row.id, row.text, row.streaming])).toEqual(rows);
    }
    expect(adapter.disconnect).not.toHaveBeenCalled();
    adapter.loadSession.mockResolvedValue({ key: SESSION_KEY, hasActiveRun: false,
      messages: [{ id: 'done', role: 'assistant', text: 'Done.', timestampMs: Date.now() }] } as any);
    for (let tick = 0; tick < 5; tick++) {
      await act(async () => { jest.advanceTimersByTime(4000); await Promise.resolve(); });
    }
    expect(result.current.isSending).toBe(false);
    expect(historyMock.reconcileLatestAssistantFromHistory).toHaveBeenCalledTimes(1);
  });

  it.each(['openclaw', 'hermes'] as const)('keeps %s text/tool boundaries through a batched final event and history refresh', async (backend) => {
    const { result, handlers, rerender } = renderController(backend);
    await typeAndSend(result, 'Inspect');
    const user = result.current.listData.find(message => message.role === 'user')!;
    const emit = (event: any) => handlers().onUpdate?.(mapAdapterSessionUpdate({ sessionKey: SESSION_KEY, runId: 'run-1', ...event }));
    act(() => {
      emit({ type: 'agent_message_chunk', text: 'First paragraph.' });
      emit({ type: 'tool_call', toolCallId: 'a', title: 'read', kind: 'read' });
      emit({ type: 'tool_call_update', toolCallId: 'a', status: 'success' });
      emit({ type: 'tool_call', toolCallId: 'b', title: 'read', kind: 'read' });
      emit({ type: 'tool_call_update', toolCallId: 'b', status: 'success' });
      emit({ type: 'agent_message_chunk', text: 'Second paragraph.' });
      emit({ type: 'tool_call', toolCallId: 'c', title: 'read', kind: 'read' });
      emit({ type: 'tool_call_update', toolCallId: 'c', status: 'success' });
      emit({ type: 'agent_message_chunk', text: 'Final answer.' });
    });
    const before = [...result.current.listData].reverse();
    expect(before.map(message => message.text)).toEqual(['Inspect', 'First paragraph.', '', '', 'Second paragraph.', '', 'Final answer.']);
    act(() => {
      emit({ type: 'run_finished', stopReason: 'end_turn', message: { role: 'assistant', content: 'First paragraph.\nSecond paragraph.\nFinal answer.' } });
    });
    const finished = [...result.current.listData].reverse();
    expect(finished.map(message => message.text)).toEqual(before.map(message => message.text));
    expect(finished.map(message => message.renderKey ?? message.id)).toEqual(before.map(message => message.renderKey ?? message.id));
    // An aggregate final payload/history snapshot must not collapse the shown rows.
    act(() => handlers().onUpdate?.({ type: 'history_reconciled', sessionKey: SESSION_KEY,
      history: { key: SESSION_KEY, messages: [], hasActiveRun: false }, hasActiveRun: false,
      messages: [{ ...user, id: 'server-user' },
        { id: 'server-answer', role: 'assistant', text: 'First paragraph.\nSecond paragraph.\nFinal answer.' },
        ...finished.filter(message => message.role === 'tool')],
    }));
    expect([...result.current.listData].reverse().map(message => message.text)).toEqual(before.map(message => message.text));
  });

  it.each(['openclaw', 'hermes'] as const)('renders %s multi-tool wire text once during streaming, history refresh and completion', async (backend) => {
    const { result, handlers, rerender } = renderController(backend);
    await typeAndSend(result, 'Inspect');
    const user = result.current.listData.find(message => message.role === 'user')!;
    const emit = (event: any) => handlers().onUpdate?.(mapAdapterSessionUpdate({ sessionKey: SESSION_KEY, runId: 'run-1', ...event }));
    const paragraphs = ['Checking the configuration.', 'Checking the provider.', 'Checking the credentials.'];
    let accumulated = '';
    for (const [index, text] of paragraphs.entries()) {
      act(() => {
        // OpenClaw chat.message.content is a run snapshot; Hermes sends a delta.
        accumulated += text;
        emit({ type: 'agent_message_chunk', text: backend === 'openclaw' ? accumulated : text,
          textMode: backend === 'openclaw' ? 'snapshot' : 'delta' });
      });
      expect([...result.current.listData].reverse().filter(row => row.role === 'assistant' && row.text).map(row => row.text))
        .toEqual(paragraphs.slice(0, index + 1));
      act(() => {
        emit({ type: 'tool_call', toolCallId: `tool-${index}`, title: 'read', kind: 'read' });
        emit({ type: 'tool_call_update', toolCallId: `tool-${index}`, status: 'success' });
      });
    }
    const remote = [user, ...paragraphs.flatMap((text, index) => [
      { id: `server-${index}`, role: 'assistant' as const, text },
      { id: `toolcall_tool-${index}`, role: 'tool' as const, text: '', toolName: 'read', toolStatus: 'success' as const },
    ])];
    act(() => handlers().onUpdate?.({ type: 'history_reconciled', sessionKey: SESSION_KEY,
      history: { key: SESSION_KEY, messages: [], hasActiveRun: true }, hasActiveRun: true, messages: remote }));
    rerender(undefined);
    expect([...result.current.listData].reverse().filter(row => row.role === 'assistant' && row.text).map(row => row.text)).toEqual(paragraphs);
    act(() => {
      emit({ type: 'agent_message_chunk', text: backend === 'openclaw' ? `${accumulated}Done.` : 'Done.',
        textMode: backend === 'openclaw' ? 'snapshot' : 'delta' });
      emit({ type: 'run_finished', stopReason: 'end_turn', message: { role: 'assistant', content: `${accumulated}Done.` } });
    });
    const expected = ['Inspect', ...paragraphs.flatMap(text => [text, '']), 'Done.'];
    expect([...result.current.listData].reverse().map(row => row.text)).toEqual(expected);
    act(() => handlers().onUpdate?.({ type: 'history_reconciled', sessionKey: SESSION_KEY,
      history: { key: SESSION_KEY, messages: [], hasActiveRun: false }, hasActiveRun: false,
      messages: [...remote, { id: 'server-final', role: 'assistant', text: 'Done.' }] }));
    rerender(undefined);
    expect([...result.current.listData].reverse().map(row => row.text)).toEqual(expected);
  });

  it('keeps repeated Hermes delta tokens and words verbatim', async () => {
    const { result, handlers } = renderController('hermes');
    await typeAndSend(result, 'Repeat');
    act(() => {
      for (const text of ['ha', 'ha', ' ha', ' ha']) handlers().onUpdate?.(mapAdapterSessionUpdate({
        type: 'agent_message_chunk', sessionKey: SESSION_KEY, runId: 'run-1', text, textMode: 'delta',
      } as any));
    });
    jest.setSystemTime(Date.now() + 1_000);
    act(() => { result.current.setInput('next'); });
    expect(result.current.listData.find(row => row.id === 'streaming')?.text).toBe('haha ha ha');
  });

  it.each(['cancelled', 'error'] as const)('preserves snapshot paragraphs and tool order on %s', async (stopReason) => {
    const { result, handlers } = renderController();
    await typeAndSend(result, 'Inspect');
    const emit = (event: any) => handlers().onUpdate?.(mapAdapterSessionUpdate({ sessionKey: SESSION_KEY, runId: 'run-1', ...event }));
    act(() => {
      emit({ type: 'agent_message_chunk', text: 'Checking the files.', textMode: 'snapshot' });
      emit({ type: 'tool_call', toolCallId: 'a', title: 'read', kind: 'read' });
      emit({ type: 'agent_message_chunk', text: 'Checking the files.', textMode: 'snapshot' });
      emit({ type: 'agent_message_chunk', text: 'Checking the files.Found the issue.', textMode: 'snapshot' });
      // A replayed tool start must not commit the next paragraph again.
      emit({ type: 'tool_call', toolCallId: 'a', title: 'read', kind: 'read' });
      emit({ type: 'run_finished', stopReason });
    });
    expect([...result.current.listData].reverse().filter(row => row.role !== 'system').map(row => row.text))
      .toEqual(['Inspect', 'Checking the files.', '', 'Found the issue.']);
    expect(result.current.isSending).toBe(false);
  });

  it('replaces a corrected OpenClaw snapshot instead of concatenating two drafts', async () => {
    const { result, handlers } = renderController();
    await typeAndSend(result, 'Inspect');
    act(() => {
      for (const text of ['The preliminary answer is incorrect.', 'Corrected answer.']) handlers().onUpdate?.(mapAdapterSessionUpdate({
        type: 'agent_message_chunk', sessionKey: SESSION_KEY, runId: 'run-1', text, textMode: 'snapshot',
      }));
    });
    expect(result.current.listData.find(row => row.id === 'streaming')?.text).toBe('Corrected answer.');
  });

  it.each(['openclaw', 'hermes'] as const)(
    '%s immediately shows one pending bubble before network or backend health resolves',
    async (backendKind) => {
      const network = deferred<Awaited<ReturnType<typeof Network.getNetworkStateAsync>>>();
      const health = deferred<boolean>();
      jest.mocked(Network.getNetworkStateAsync).mockReturnValueOnce(network.promise);
      const { result, adapter, handlers } = renderController(backendKind);
      // Expire the existing 3s health window without changing its policy.
      jest.setSystemTime(Date.now() + 4_000);
      adapter.probe.mockReturnValueOnce(health.promise);
      act(() => { result.current.setInput('instant'); });
      const send = result.current.onSend;
      act(() => { send(); send(); });

      expect(result.current.input).toBe('');
      expect(result.current.listData[0]).toMatchObject({ text: 'instant', delivery: 'sending' });
      expect(result.current.queuedMessages).toHaveLength(1);
      const id = result.current.queuedMessages[0].id;
      const pending = result.current.listData[0];
      const scrollRequest = result.current.scrollToBottomRequestAt;
      expect(result.current.isSending).toBe(false);
      expect(adapter.prompt).not.toHaveBeenCalled();
      expect(adapter.probe).not.toHaveBeenCalled();
      await act(async () => {
        network.resolve({ type: 'WIFI' as any, isConnected: true, isInternetReachable: true });
      });
      expect(adapter.probe).toHaveBeenCalledWith(1500);
      expect(adapter.prompt).not.toHaveBeenCalled();
      act(() => { result.current.setInput('next draft'); });
      await act(async () => { health.resolve(true); });
      expect(adapter.prompt).toHaveBeenCalledTimes(1);
      expect(result.current.input).toBe('next draft');
      expect(result.current.queuedMessages).toHaveLength(0);
      expect(result.current.listData.filter((message) => message.id === id)).toHaveLength(1);
      expect(result.current.listData.find((message) => message.id === id)).toMatchObject({
        renderKey: pending.renderKey, timestampMs: pending.timestampMs, text: pending.text,
      });
      expect(result.current.listData.find((message) => message.id === id)?.delivery).toBeUndefined();
      expect(result.current.scrollToBottomRequestAt).toBe(scrollRequest);
      const replyKey = result.current.listData.find(message => message.id === 'streaming')?.renderKey;
      expect(replyKey).toBeTruthy();
      finishRun(handlers, 'run-1');
      expect(result.current.listData.find(message => message.role === 'assistant')?.renderKey).toBe(replyKey);
    },
  );

  it.each((['openclaw', 'hermes'] as const).flatMap((backend) =>
    ['relay', 'local', 'tailscale', 'cloudflare', 'custom'].map((transport) => ({ backend, transport })),
  ))('preserves failed preflight and explicit retry for $backend over $transport', async ({ backend, transport }) => {
    const adapter = createAdapter(backend, transport);
    const { result, rerender } = renderController(backend, adapter);
    jest.setSystemTime(Date.now() + 4_000);
    adapter.probe.mockResolvedValueOnce(false);
    await typeAndSend(result, 'keep me');
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(result.current.input).toBe('');
    expect(result.current.listData[0]).toMatchObject({ text: 'keep me', delivery: 'held' });
    const id = result.current.queuedMessages[0].id;
    rerender(undefined);
    await flush();
    expect(adapter.probe).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.sendQueuedMessageNow(id); });
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.listData.filter((message) => message.text === 'keep me')).toHaveLength(1);
    expect(result.current.listData.find((message) => message.id === id)?.sendUncertain).toBeUndefined();
  });

  it('keeps image preparation behind the bubble without overwriting the next draft attachments', async () => {
    const preparation = deferred<Awaited<ReturnType<typeof imagePreparation.preparePendingImagesForSend>>>();
    jest.spyOn(imagePreparation, 'preparePendingImagesForSend').mockReturnValueOnce(preparation.promise);
    const original = { uri: 'file:///original.png', base64: 'AAA', mimeType: 'image/png', width: 400, height: 300 };
    imagePickerMock.pendingImages = [original];
    const { result, adapter } = renderController();
    await typeAndSend(result, 'photo');
    expect(result.current.input).toBe('');
    expect(imagePickerMock.pendingImages).toEqual([]);
    expect(result.current.listData[0]).toMatchObject({ text: 'photo', imageUris: [original.uri], delivery: 'sending' });
    expect(adapter.prompt).not.toHaveBeenCalled();

    const next = { uri: 'file:///next.png', base64: 'BBB', mimeType: 'image/png' };
    imagePickerMock.pendingImages = [next];
    act(() => { result.current.setInput('next'); });
    await act(async () => {
      preparation.resolve({ changed: true, images: [{ ...original, uri: 'file:///compressed.jpg', width: 200, height: 150, base64: 'CCC' }] });
    });
    expect(adapter.prompt).toHaveBeenCalledWith(SESSION_KEY, expect.objectContaining({
      attachments: [expect.objectContaining({ content: 'CCC' })],
    }));
    expect(result.current.listData.find(message => message.role === 'user')).toMatchObject({ imageUris: [original.uri], imageMetas: [{ uri: original.uri, width: 400, height: 300 }] });
    expect(result.current.input).toBe('next');
    expect(imagePickerMock.pendingImages).toEqual([next]);
  });

  it('holds an unreadable attachment for editing without creating a run or losing the message', async () => {
    jest.spyOn(imagePreparation, 'preparePendingImagesForSend').mockRejectedValueOnce(new Error('file unavailable'));
    imagePickerMock.pendingImages = [{ uri: 'file:///missing.pdf', base64: '', mimeType: 'application/pdf' }];
    const { result, adapter } = renderController();
    await typeAndSend(result, 'document');
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(result.current.isSending).toBe(false);
    expect(result.current.listData[0]).toMatchObject({ text: 'document', delivery: 'held' });
    expect(result.current.sendFailure).toBeTruthy();
    act(() => { result.current.editQueuedMessage(result.current.queuedMessages[0].id); });
    expect(result.current.input).toBe('document');
    expect(imagePickerMock.pendingImages[0].uri).toBe('file:///missing.pdf');
  });

  it.each(['session', 'adapter', 'unmount'] as const)(
    'retires an in-flight preflight after %s changes and keeps the source bubble recoverable',
    async (change) => {
      const health = deferred<boolean>();
      const adapter = createAdapter();
      adapter.probe.mockReturnValueOnce(health.promise);
      const { result, rerender, unmount } = renderHook(({ activeAdapter }: { activeAdapter: ReturnType<typeof createAdapter> }) => useChatController({
        adapter: activeAdapter as any, debugMode: false, showAgentAvatar: true,
      }), { initialProps: { activeAdapter: adapter } });
      await typeAndSend(result, 'source');
      expect(adapter.probe).toHaveBeenCalledTimes(1);
      const replacement = createAdapter('hermes');
      if (change === 'session') {
        historyMock.sessionKey = 'agent:main:other';
        rerender({ activeAdapter: adapter });
        act(() => { result.current.setInput('other draft'); });
      } else if (change === 'adapter') {
        rerender({ activeAdapter: replacement });
        act(() => { result.current.setInput('other draft'); });
      } else unmount();
      await act(async () => { health.resolve(true); });
      expect(adapter.prompt).not.toHaveBeenCalled();
      expect(replacement.prompt).not.toHaveBeenCalled();
      const source = getMessageQueueStore().read(messageQueueScopeKey(adapter.connection.id, SESSION_KEY));
      expect(source.held).toBe(true);
      expect(source.items).toHaveLength(1);
      if (change !== 'unmount') {
        expect(result.current.input).toBe('other draft');
        expect(result.current.sendFailure).toBeNull();
        expect(result.current.listData.some((message) => message.text === 'source')).toBe(false);
      }
    },
  );

  it('does not send a local bubble removed during preflight', async () => {
    const health = deferred<boolean>();
    const { result, adapter } = renderController();
    jest.setSystemTime(Date.now() + 4_000);
    adapter.probe.mockReturnValueOnce(health.promise);
    await typeAndSend(result, 'removed');
    act(() => { result.current.removeQueuedMessage(result.current.queuedMessages[0].id); });
    await act(async () => { health.resolve(true); });
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(result.current.queuedMessages).toHaveLength(0);
  });

  it.each(['openclaw', 'hermes'] as const)('never automatically replays an unacknowledged %s prompt', async (backend) => {
    const acknowledgement = deferred<{ runId: string }>();
    const { result, adapter, rerender } = renderController(backend);
    adapter.prompt.mockReturnValueOnce(acknowledgement.promise);
    await typeAndSend(result, 'receipt may be lost');
    const id = result.current.listData.find((message) => message.role === 'user')!.id;
    expect(result.current.unconfirmedMessageIds.has(id)).toBe(true);
    expect(result.current.queuedMessages).toHaveLength(0);
    act(() => { result.current.setInput('next draft'); });
    await act(async () => { acknowledgement.reject(new Error('socket closed')); });
    rerender(undefined);
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.input).toBe('next draft');
    expect(result.current.listData.filter((message) => message.text === 'receipt may be lost')).toHaveLength(1);
    expect(result.current.listData.find((message) => message.id === id)).toMatchObject({ sendUncertain: true });
    expect(result.current.queuedMessages).toHaveLength(0);
  });

  it('holds the pending message if recovery discovers an existing remote run', async () => {
    const health = deferred<boolean>();
    const { result, adapter, handlers } = renderController();
    jest.setSystemTime(Date.now() + 4_000);
    adapter.probe.mockReturnValueOnce(health.promise);
    await typeAndSend(result, 'after recovery');
    act(() => {
      handlers().onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started', sessionKey: SESSION_KEY, runId: 'remote-run',
      }, { now: () => Date.now() }));
    });
    await act(async () => { health.resolve(true); });
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(result.current.listData.find((message) => message.text === 'after recovery')).toMatchObject({ delivery: 'held' });
    expect(result.current.isSending).toBe(true);
  });

  it.each(['openclaw', 'hermes', 'youmind'] as const)(
    'queues a message sent during a %s run and delivers it once the turn ends',
    async (backendKind) => {
      const { result, adapter, handlers } = renderController(backendKind);

      await typeAndSend(result, 'first');
      expect(adapter.prompt).toHaveBeenCalledTimes(1);
      expect(result.current.isSending).toBe(true);

      await act(async () => {
        result.current.setInput('second');
      });
      expect(result.current.canSend).toBe(true);
      await act(async () => {
        result.current.onSend();
      });
      await flush();

      expect(adapter.prompt).toHaveBeenCalledTimes(1);
      expect(result.current.input).toBe('');
      expect(result.current.queuedMessages).toHaveLength(1);
      expect(result.current.listData[0]).toMatchObject({
        role: 'user',
        text: 'second',
        delivery: 'queued',
      });
      expect(result.current.listData[0].timestampMs).toBe(result.current.queuedMessages[0].createdAt);
      expect(mockedAnalytics.chatMessageQueued).toHaveBeenCalledWith({
        backend: backendKind,
        queue_length: 1,
        has_attachments: false,
      });

      finishRun(handlers, 'run-1');
      await flush();

      expect(adapter.prompt).toHaveBeenCalledTimes(2);
      expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'second' }));
      expect(result.current.isSending).toBe(true);
      expect(result.current.queuedMessages).toHaveLength(0);
      const ids = result.current.listData.map((message: any) => message.id);
      expect(new Set(ids).size).toBe(ids.length);
      const delivered = historyMock.messages.find((message) => message.text === 'second');
      expect(delivered).toMatchObject({ role: 'user', timestampMs: expect.any(Number) });
      expect(delivered.delivery).toBeUndefined();
      expect(queuedRows(result)).toHaveLength(0);
      expect(mockedAnalytics.chatQueuedMessageDelivered).toHaveBeenCalledWith(expect.objectContaining({
        backend: backendKind,
        remaining: 0,
      }));
    },
  );

  it('keeps the queued bubble id when the message settles into history', async () => {
    const { result, handlers } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');
    const queuedId = result.current.queuedMessages[0].id;
    expect(queuedId).toMatch(/^usr_/);

    finishRun(handlers, 'run-1');
    await flush();

    expect(historyMock.messages.some((message) => message.id === queuedId && !message.delivery)).toBe(true);
  });

  it('delivers several queued messages in order, one per turn', async () => {
    const { result, adapter, handlers } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');
    await typeAndSend(result, 'third');
    expect(result.current.queuedMessages.map((item: any) => item.text)).toEqual(['second', 'third']);
    // Newest-first list keeps the queue tail at index 0 so it renders last.
    expect(result.current.listData.slice(0, 2).map((message: any) => message.text)).toEqual(['third', 'second']);

    finishRun(handlers, 'run-1');
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'second' }));
    expect(result.current.queuedMessages.map((item: any) => item.text)).toEqual(['third']);

    finishRun(handlers, 'run-2');
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(3);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'third' }));
    expect(result.current.queuedMessages).toHaveLength(0);
  });

  it('waits for the post-reply history refresh before delivering', async () => {
    const { result, adapter, handlers, rerender } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');

    historyMock.refreshing = true;
    finishRun(handlers, 'run-1');
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.listData[0]).toMatchObject({ text: 'second', delivery: 'queued' });

    historyMock.refreshing = false;
    rerender(undefined);
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'second' }));
  });

  it.each(['openclaw', 'hermes'] as const)('%s keeps an acknowledged stop observable while the backend is active', async (backend) => {
    const { result, adapter, handlers } = renderController(backend);
    await typeAndSend(result, 'Run');
    adapter.loadSession.mockResolvedValue({ key: SESSION_KEY, messages: [], hasActiveRun: true });
    act(() => result.current.abortCurrentRun());
    await flush();
    await act(async () => { jest.advanceTimersByTime(5_001); });
    await flush();
    expect(result.current.isSending).toBe(true);
    finishRun(handlers, 'run-1', 'cancelled');
    await flush();
    expect(result.current.isSending).toBe(false);
  });

  it('retains activity and exposes a failed stop instead of timing out into false success', async () => {
    const { result, adapter } = renderController('hermes');
    await typeAndSend(result, 'Run');
    adapter.cancel.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.abortCurrentRun());
    await flush();
    await act(async () => { jest.advanceTimersByTime(5_001); });
    expect(result.current.isSending).toBe(true);
    expect(result.current.sendFailure).toBe('Could not stop the task. Check its status and try again.');
  });

  it('pauses the queue when the user stops the run and resumes on Send now', async () => {
    const { result, adapter, handlers } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');

    act(() => {
      result.current.abortCurrentRun();
    });
    expect(result.current.queueHeld).toBe(true);
    expect(mockedAnalytics.chatQueueHeld).toHaveBeenCalledWith({ reason: 'abort', queue_length: 1 });

    finishRun(handlers, 'run-1', 'cancelled');
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.isSending).toBe(false);
    expect(result.current.listData[0]).toMatchObject({ text: 'second', delivery: 'held' });
    expect(result.current.canSendQueuedNow).toBe(true);

    const queuedId = result.current.queuedMessages[0].id;
    await act(async () => {
      result.current.sendQueuedMessageNow(queuedId);
    });
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'second' }));
    expect(result.current.queuedMessages).toHaveLength(0);
    expect(result.current.canSendQueuedNow).toBe(false);
  });

  it('pauses the queue after a reply failure and resumes when the user sends again', async () => {
    const { result, adapter, handlers } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');

    act(() => {
      handlers().onUpdate?.(mapAdapterSessionUpdate({
        type: 'error',
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        code: 'server',
        message: 'model unavailable',
      }, { now: () => 900 }));
    });
    await flush();
    expect(result.current.isSending).toBe(false);
    expect(result.current.queueHeld).toBe(true);
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.listData[0]).toMatchObject({ text: 'second', delivery: 'held' });

    // A new message goes out first; the paused item follows on the next turn.
    await typeAndSend(result, 'third');
    expect(adapter.prompt).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'third' }));
    expect(result.current.queueHeld).toBe(false);
    expect(result.current.listData[0]).toMatchObject({ text: 'second', delivery: 'queued' });

    finishRun(handlers, 'run-2');
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(3);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'second' }));
  });

  it('holds the queue when delivery preflight fails instead of dropping the message', async () => {
    const { result, adapter, handlers } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');

    jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      type: 'NONE' as any,
      isConnected: false,
      isInternetReachable: false,
    });
    finishRun(handlers, 'run-1');
    await flush();

    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.queueHeld).toBe(true);
    expect(result.current.queuedMessages).toHaveLength(1);
    expect(result.current.sendFailure).toBeTruthy();
    expect(mockedAnalytics.chatQueueHeld).toHaveBeenCalledWith({ reason: 'preflight_failed', queue_length: 1 });
  });

  it('returns a queued message with its attachments to the composer on edit', async () => {
    const { result } = renderController();
    await typeAndSend(result, 'first');
    imagePickerMock.pendingImages = [{ uri: 'file:///a.png', base64: 'AAA', mimeType: 'image/png', width: 10, height: 10 }];
    await typeAndSend(result, 'with image');
    const queued = result.current.queuedMessages[0];
    expect(queued.images).toHaveLength(1);
    expect(result.current.listData[0]).toMatchObject({ text: 'with image', delivery: 'queued', imageUris: ['file:///a.png'] });

    await act(async () => {
      result.current.setInput('draft');
    });
    await act(async () => {
      result.current.editQueuedMessage(queued.id);
    });
    expect(result.current.queuedMessages).toHaveLength(0);
    expect(result.current.input).toBe('with image\n\ndraft');
    expect(imagePickerMock.pendingImages).toEqual([expect.objectContaining({ uri: 'file:///a.png' })]);
    expect(mockedAnalytics.chatQueuedMessageEdited).toHaveBeenCalledWith({ backend: 'openclaw' });
  });

  it('removes a queued message and ignores unknown ids', async () => {
    const { result } = renderController();
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');
    const queued = result.current.queuedMessages[0];

    act(() => {
      result.current.removeQueuedMessage('missing');
    });
    expect(mockedAnalytics.chatQueuedMessageRemoved).not.toHaveBeenCalled();
    act(() => {
      result.current.removeQueuedMessage(queued.id);
    });
    expect(result.current.queuedMessages).toHaveLength(0);
    expect(queuedRows(result)).toHaveLength(0);
    expect(mockedAnalytics.chatQueuedMessageRemoved).toHaveBeenCalledWith({ backend: 'openclaw' });
  });

  it('stops accepting new messages once the queue is full', async () => {
    const { result } = renderController();
    await typeAndSend(result, 'first');
    for (let index = 0; index < MESSAGE_QUEUE_LIMIT; index += 1) {
      await typeAndSend(result, `queued ${index}`);
    }
    expect(result.current.queuedMessages).toHaveLength(MESSAGE_QUEUE_LIMIT);

    await act(async () => {
      result.current.setInput('one too many');
    });
    expect(result.current.canSend).toBe(false);
    await act(async () => {
      result.current.onSend();
    });
    await flush();
    expect(result.current.queuedMessages).toHaveLength(MESSAGE_QUEUE_LIMIT);
    expect(result.current.input).toBe('one too many');
  });

  it('keeps queued messages across a Thread remount and resumes once the session is idle', async () => {
    const adapter = createAdapter();
    const first = renderController('openclaw', adapter);
    await typeAndSend(first.result, 'first');
    await typeAndSend(first.result, 'second');
    first.unmount();
    expect(adapter.prompt).toHaveBeenCalledTimes(1);

    // The remounted Thread sees an idle session in this harness, so the
    // surviving queue starts delivering right away.
    const second = renderController('openclaw', adapter);
    expect(second.result.current.listData[0]).toMatchObject({
      text: 'second',
      delivery: expect.stringMatching(/^(queued|sending)$/),
    });
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).toHaveBeenLastCalledWith(SESSION_KEY, expect.objectContaining({ text: 'second' }));
    expect(second.result.current.queuedMessages).toHaveLength(0);
  });

  it('does not deliver while the session is read-only', async () => {
    const adapter = createAdapter();
    const { result, handlers } = renderController('openclaw', adapter);
    await typeAndSend(result, 'first');
    await typeAndSend(result, 'second');

    const readOnly = renderHook(() => useChatController({
      adapter: adapter as any,
      debugMode: false,
      showAgentAvatar: true,
      readOnly: true,
    }));
    act(() => {
      latestAdapterHandlers().onState?.('ready');
    });
    finishRun(handlers, 'run-1');
    await flush();
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(readOnly.result.current.queuedMessages).toHaveLength(1);
    readOnly.unmount();
  });
});
