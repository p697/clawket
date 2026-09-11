import { act, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { resolveCapabilities, type BackendKind } from '@clawket/agent-protocol';
import { analyticsEvents } from '../services/analytics/events';
import { MESSAGE_QUEUE_LIMIT, resetMessageQueueStore } from './messageQueue';
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
  speechRecognitionLanguage: 'system',
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

jest.mock('../services/speech/speechRecognition', () => ({
  stopSpeechRecognitionAsync: jest.fn().mockResolvedValue(undefined),
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

function createAdapter(backendKind: BackendKind = 'openclaw') {
  const transportKinds = { openclaw: 'relay', hermes: 'relay', youmind: 'https' } as const;
  let promptSeq = 0;
  return {
    state: 'ready',
    capabilities: resolveCapabilities(backendKind),
    connection: {
      id: `${backendKind}-connection`,
      backendKind,
      transportKind: transportKinds[backendKind],
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

describe('useChatController message queue', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
    jest.clearAllMocks();
    resetMessageQueueStore();
    historyMock.sessionKey = SESSION_KEY;
    historyMock.sessions = [{ key: SESSION_KEY, kind: 'direct' as const }];
    historyMock.messages = [];
    historyMock.historyLoaded = true;
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
      expect(result.current.listData[0].timestampMs).toBeUndefined();
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
