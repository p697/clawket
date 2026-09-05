import { act, renderHook } from '@testing-library/react-native';
import { resolveCapabilities, type AdapterErrorCode, type BackendKind } from '@clawket/agent-protocol';
import {
  mapAdapterSessionUpdate,
  useAdapterChatEvents,
} from './useAdapterChatEvents';
import { useChatController } from './useChatController';

const historyMock = {
  sessionKey: 'agent:main:main' as string | null,
  sessions: [{ key: 'agent:main:main', kind: 'direct' as const }],
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

const mockAppContext: any = {
  activeGatewayConfigId: null,
  mainSessionKey: 'agent:main:main',
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
  useChatImagePicker: jest.fn(() => ({
    pendingImages: [],
    setPendingImages: jest.fn(),
    pickImage: jest.fn(),
    clearPendingImages: jest.fn(),
    removePendingImage: jest.fn(),
    canAddMoreImages: true,
  })),
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
    voiceInputLevel: 0,
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
    chatExecApprovalResolved: jest.fn(),
  },
}));

function createAdapter(backendKind: BackendKind = 'openclaw') {
  const transportKinds = { openclaw: 'relay', hermes: 'relay', youmind: 'https' } as const;
  return {
    state: 'connecting',
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
    loadSession: jest.fn().mockResolvedValue({ key: 'main', messages: [], hasActiveRun: false }),
    prompt: jest.fn().mockResolvedValue({ runId: 'run-1' }),
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

function renderController(backendKind: BackendKind = 'openclaw') {
  const adapter = createAdapter(backendKind);
  const rendered = renderHook(() => useChatController({
    adapter: adapter as any,
    debugMode: false,
    showAgentAvatar: true,
  }));
  return { ...rendered, adapter, handlers: latestAdapterHandlers() };
}

describe('useChatController adapter event migration', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
    jest.clearAllMocks();
    historyMock.sessionKey = 'agent:main:main';
    historyMock.sessions = [{ key: 'agent:main:main', kind: 'direct' as const }];
    historyMock.messages = [];
    historyMock.historyLoaded = true;
    historyMock.hasMoreHistory = false;
    historyMock.loadSessionsAndHistory.mockResolvedValue(undefined);
    mockAppContext.currentAgentId = 'main';
    mockAppContext.execApprovalEnabled = true;
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it.each(['NO', 'NO_'])('does not adopt silent reply prefix %s as the active visible run', (text) => {
    const { result, handlers } = renderController();

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'agent_message_chunk',
        sessionKey: 'agent:main:main',
        runId: 'silent-prefix-run',
        text,
      }, { now: () => 100 }));
    });

    expect(result.current.isSending).toBe(false);
    expect(result.current.listData).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', streaming: true }),
    ]));
  });

  it.each(['NO_REPLY', 'NO_'])('cleans up an active run without a final bubble for %s', (text) => {
    const { result, handlers } = renderController();

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started',
        sessionKey: 'agent:main:main',
        runId: 'silent-final-run',
      }, { now: () => 100 }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_finished',
        sessionKey: 'agent:main:main',
        runId: 'silent-final-run',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: text },
      }, { now: () => 200 }));
    });

    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages).toEqual([]);
  });

  it('tracks a child subagent through start, delta, tool, and final updates', () => {
    const { result, handlers } = renderController();
    const sessionKey = 'agent:main:subagent:coder';

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started',
        sessionKey,
        runId: 'child-run',
      }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'agent_message_chunk',
        sessionKey,
        runId: 'child-run',
        text: 'Inspecting repo state',
      }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'tool_call',
        sessionKey,
        runId: 'child-run',
        toolCallId: 'tool-1',
        title: 'Read file',
        kind: 'read',
      }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_finished',
        sessionKey,
        runId: 'child-run',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: 'Done' },
      }));
    });

    expect(result.current.childSessionActivityRef.current.get(sessionKey)).toMatchObject({
      status: 'completed',
      previewText: 'Inspecting repo state',
      toolName: 'read',
    });
    expect(result.current.childSessionActivityVersion).toBeGreaterThan(0);
  });

  it('does not create child activity for a non-subagent session', () => {
    const { result, handlers } = renderController();

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started',
        sessionKey: 'agent:main:dm:alice',
        runId: 'direct-run',
      }));
    });

    expect(result.current.childSessionActivityRef.current.size).toBe(0);
    expect(result.current.childSessionActivityVersion).toBe(0);
  });

  it.each(['openclaw', 'hermes'] as const)(
    'waits for %s session synchronization to settle before loading agents',
    async (backendKind) => {
      let resolveSessions: (() => void) | undefined;
      historyMock.loadSessionsAndHistory.mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSessions = resolve;
      }));
      const { adapter, handlers } = renderController(backendKind);

      act(() => {
        handlers.onState?.('ready');
      });
      expect(historyMock.loadSessionsAndHistory).toHaveBeenCalledTimes(1);
      expect(adapter.listAgents).not.toHaveBeenCalled();

      await act(async () => {
        resolveSessions?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(adapter.listAgents).toHaveBeenCalledTimes(1);
    },
  );

  it('clears child activity when a ready adapter reconnects', () => {
    const { result, handlers } = renderController();
    const childKey = 'agent:main:subagent:coder';

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started',
        sessionKey: 'agent:main:main',
        runId: 'main-run',
      }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started',
        sessionKey: childKey,
        runId: 'child-run',
      }));
    });
    expect(result.current.isSending).toBe(true);
    expect(result.current.childSessionActivityRef.current.has(childKey)).toBe(true);

    act(() => {
      handlers.onState?.('reconnecting', 'socket_closed');
    });

    expect(result.current.connectionState).toBe('reconnecting');
    expect(result.current.childSessionActivityRef.current.size).toBe(0);
  });

  it('keeps the dedicated direct local TLS explanation visible through an adapter error', () => {
    const { handlers } = renderController();
    const explanation = 'Direct local TLS adapter connections are not supported in Clawket mobile yet. Disable OpenClaw adapter TLS for LAN pairing, or use Relay/Tailscale instead.';

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'error',
        code: 'network',
        message: explanation,
      }, { now: () => 500 }));
    });

    expect(historyMock.messages).toEqual([
      expect.objectContaining({ role: 'system', text: explanation }),
    ]);
  });

  it.each<AdapterErrorCode>([
    'unauthorized',
    'pairing_required',
    'pairing_expired',
    'bridge_offline',
    'gateway_offline',
    'network',
    'timeout',
    'rate_limited',
    'frame_too_large',
    'unsupported',
    'server',
  ])('preserves normalized %s adapter errors in the thread', (code) => {
    const { handlers } = renderController();
    const text = `normalized:${code}`;

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'error',
        code,
        message: text,
      }, { now: () => 600 }));
    });

    expect(historyMock.messages).toEqual([
      expect.objectContaining({ role: 'system', text }),
    ]);
  });
});
