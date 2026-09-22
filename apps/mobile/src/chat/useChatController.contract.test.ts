import { clearUncertainSends } from './sendRecovery';
import { act, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';
import * as DocumentPicker from 'expo-document-picker';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import { analyticsEvents } from '../services/analytics/events';
import { recordSuccessfulSendForAutomaticReview } from '../services/auto-app-review';
import { cacheMessageImages } from '../services/image-cache';
import { StorageService } from '../services/storage';
import { useChatAutoCache } from '../hooks/useChatAutoCache';
import { useAdapterChatEvents } from './useAdapterChatEvents';
import { useChatController as useChatControllerImpl } from './useChatController';
import { resetMessageQueueStore } from './messageQueue';

const mockT = (key: string) => key;
const mockI18n = { language: 'en-US' };

const historyMock = {
  sessionKey: 'agent:main:main' as string | null,
  sessions: [{ key: 'agent:main:main', kind: 'direct' as const }],
  refreshing: false,
  refreshingSessions: false,
  hasMoreHistory: false,
  loadingMoreHistory: false,
  historyLoaded: true,
  activitySnapshot: null as import('@clawket/agent-protocol').SessionHistory | null,
  messages: [] as any[],
  thinkingLevel: null as string | null,
  historyLimitRef: { current: 50 },
  historyRawCountRef: { current: 0 },
  loadMoreLockRef: { current: false },
  setMessages: jest.fn((next: any[] | ((prev: any[]) => any[])) => {
    historyMock.messages = typeof next === 'function' ? next(historyMock.messages) : next;
  }),
  setSessions: jest.fn((next: any[] | ((prev: any[]) => any[])) => {
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
  loadSessionsAndHistory: jest.fn(),
  reconcileLatestAssistantFromHistory: jest.fn().mockResolvedValue(undefined),
  refreshCurrentSessionHistory: jest.fn().mockResolvedValue(undefined),
};

const voiceInputHookMock = {
  toggleVoiceInput: jest.fn(),
  voiceInputActive: false,
  voiceInputDisabled: false,
  voiceInputLevel: { value: 0.42 },
  voiceInputState: 'idle' as const,
  voiceInputSupported: true,
};

const modelPickerHookMock = {
  availableModels: [{ id: 'gpt-5', name: 'gpt-5', provider: 'openai' }],
  modelPickerError: null,
  modelPickerLoading: false,
  modelPickerVisible: true,
  onSelectModel: jest.fn(),
  openModelPicker: jest.fn(() => true),
  retryModelPickerLoad: jest.fn(),
  setModelPickerVisible: jest.fn(),
};

const commandPickerHookMock = {
  closeCommandPicker: jest.fn(),
  commandPickerError: null,
  commandPickerLoading: false,
  commandPickerOptions: [{ value: 'high', isCurrent: true }],
  commandPickerTitle: 'Thinking',
  commandPickerVisible: true,
  onSelectCommandOption: jest.fn(),
  openCommandPicker: jest.fn(() => true),
  retryCommandPickerLoad: jest.fn(),
};

const imagePickerHookMock = {
  pendingImages: [] as any[],
  setPendingImages: jest.fn(),
  pickImage: jest.fn(),
  clearPendingImages: jest.fn(),
  removePendingImage: jest.fn(),
  canAddMoreImages: true,
};

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(() => true),
}));

jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(() => ({
    t: mockT,
    i18n: mockI18n,
  })),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
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
  useChatImagePicker: jest.fn(() => imagePickerHookMock),
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

jest.mock('../services/image-cache', () => ({
  cacheMessageImages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/auto-app-review', () => ({
  recordSuccessfulSendForAutomaticReview: jest.fn().mockResolvedValue(undefined),
}));

const mockAppContext: any = {
  activeGatewayConfigId: null,
  mainSessionKey: 'agent:main:main',
  currentAgentId: 'main',
  agents: [],
  setAgents: jest.fn(),
  setCurrentAgentId: jest.fn(),
  pendingAgentSwitch: null,
  clearPendingAgentSwitch: jest.fn(),
  execApprovalEnabled: false,
  pendingChatInput: null,
  clearPendingChatInput: jest.fn(),
  pendingMainSessionSwitch: false,
  clearPendingMainSessionSwitch: jest.fn(),
  initialChatPreview: null,
};

function resetMockState() {
  mockAppContext.activeGatewayConfigId = null;
  mockAppContext.mainSessionKey = 'agent:main:main';
  mockAppContext.currentAgentId = 'main';
  mockAppContext.agents = [];
  mockAppContext.pendingAgentSwitch = null;
  mockAppContext.execApprovalEnabled = false;
  mockAppContext.pendingChatInput = null;
  mockAppContext.pendingMainSessionSwitch = false;
  mockAppContext.initialChatPreview = null;

  historyMock.sessionKey = 'agent:main:main';
  historyMock.sessions = [{ key: 'agent:main:main', kind: 'direct' as const }];
  historyMock.refreshing = false;
  historyMock.refreshingSessions = false;
  historyMock.hasMoreHistory = false;
  historyMock.loadingMoreHistory = false;
  historyMock.historyLoaded = true;
  historyMock.messages = [];
  historyMock.thinkingLevel = null;
  historyMock.setMessages.mockClear();
  historyMock.setSessions.mockClear();
  historyMock.setSessionKey.mockClear();
  imagePickerHookMock.pendingImages = [];
  imagePickerHookMock.setPendingImages.mockClear();
  imagePickerHookMock.pickImage.mockClear();
  imagePickerHookMock.clearPendingImages.mockClear();
  imagePickerHookMock.removePendingImage.mockClear();
}

jest.mock('../contexts/AppContext', () => ({
  useAppContext: jest.fn(() => mockAppContext),
}));

jest.mock('./useChatHistoryState', () => ({
  useChatHistoryState: jest.fn(() => historyMock),
}));

jest.mock('../chat/useAdapterChatEvents', () => ({
  useAdapterChatEvents: jest.fn(),
}));

jest.mock('./useChatVoiceInput', () => ({
  useChatVoiceInput: jest.fn(() => voiceInputHookMock),
}));

jest.mock('./useChatModelPicker', () => ({
  useChatModelPicker: jest.fn(() => modelPickerHookMock),
}));

jest.mock('./useChatCommandPicker', () => ({
  useChatCommandPicker: jest.fn(() => commandPickerHookMock),
}));

jest.mock('../services/analytics/events', () => ({
  analyticsEvents: {
    chatSendTapped: jest.fn(),
    chatSlashCommandTriggered: jest.fn(),
    chatQueueHeld: jest.fn(),
    chatMessageQueued: jest.fn(),
    chatQueuedMessageDelivered: jest.fn(),
    approvalResolved: jest.fn(),
  },
}));

function createAdapter(
  connectionState: 'ready' | 'connecting' = 'ready',
  backendKind: 'openclaw' | 'hermes' = 'openclaw',
) {
  const listeners: Record<string, Set<(...args: any[]) => void>> = {
    update: new Set(),
    state: new Set(),
    sessions: new Set(),
  };
  const resolveExec = jest.fn().mockResolvedValue(undefined);
  const approveDevice = jest.fn().mockResolvedValue(undefined);
  const rejectDevice = jest.fn().mockResolvedValue(undefined);
  const approveNode = jest.fn().mockResolvedValue(undefined);
  const rejectNode = jest.fn().mockResolvedValue(undefined);
  const listDevices = jest.fn().mockResolvedValue({ pending: [], paired: [] });
  const listNodePairRequests = jest.fn().mockResolvedValue({ pending: [], nodes: [] });
  return {
    connection: {
      id: 'connection-1',
      backendKind,
      transportKind: 'relay' as const,
      label: 'OpenClaw',
      createdAt: 1,
      isFreeSlot: false,
    },
    capabilities: { ...CAPABILITY_MATRIX[backendKind] },
    state: connectionState,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    probe: jest.fn().mockResolvedValue(true),
    prompt: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    loadSession: jest.fn().mockResolvedValue({
      key: 'agent:main:main',
      messages: [],
      hasActiveRun: false,
    }),
    listSessions: jest.fn().mockResolvedValue([]),
    listAgents: jest.fn().mockResolvedValue([]),
    cancel: jest.fn().mockResolvedValue(undefined),
    management: {
      approvals: { resolveExec },
      devices: { list: listDevices, approve: approveDevice, reject: rejectDevice },
      nodes: {
        pairRequests: listNodePairRequests,
        approve: approveNode,
        reject: rejectNode,
      },
      models: { listThinkingLevels: () => ['off', 'low', 'high'] },
    },
    on: jest.fn((event: string, listener: (...args: any[]) => void) => {
      listeners[event]?.add(listener);
      return () => listeners[event]?.delete(listener);
    }),
    emitUpdate(update: any) {
      for (const listener of listeners.update) listener(update);
    },
    emitState(state: any) {
      for (const listener of listeners.state) listener(state);
    },
  };
}

function useChatController(options: Record<string, any>) {
  return useChatControllerImpl(options as any);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('useChatController contract', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    resetMessageQueueStore();
    historyMock.activitySnapshot = null;
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    jest.clearAllMocks();
    clearUncertainSends('connection-1');
    resetMockState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('exposes stable public fields and forwards extracted hook outputs', () => {
    const adapter = createAdapter();
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    expect(result.current).toEqual(
      expect.objectContaining({
        connectionState: 'ready',
        input: '',
        setInput: expect.any(Function),
        onPasteFiles: expect.any(Function),
        onPasteFailed: expect.any(Function),
        onSend: expect.any(Function),
        onRefresh: expect.any(Function),
        switchSession: expect.any(Function),
        reloadSession: expect.any(Function),
        voiceInputSupported: voiceInputHookMock.voiceInputSupported,
        voiceInputDisabled: voiceInputHookMock.voiceInputDisabled,
        voiceInputLevel: voiceInputHookMock.voiceInputLevel,
        toggleVoiceInput: voiceInputHookMock.toggleVoiceInput,
        modelPickerVisible: modelPickerHookMock.modelPickerVisible,
        openModelPicker: modelPickerHookMock.openModelPicker,
        retryModelPickerLoad: modelPickerHookMock.retryModelPickerLoad,
        commandPickerVisible: commandPickerHookMock.commandPickerVisible,
        commandPickerTitle: commandPickerHookMock.commandPickerTitle,
        onSelectCommandOption: commandPickerHookMock.onSelectCommandOption,
        closeCommandPicker: commandPickerHookMock.closeCommandPicker,
      }),
    );
  });

  it('stays idle and subscribes safely while the active adapter is null', () => {
    const { result } = renderHook(() =>
      useChatController({
        adapter: null,
        debugMode: false,
        showAgentAvatar: true,
      }),
    );

    expect(result.current.connectionState).toBe('idle');
    expect(jest.mocked(useAdapterChatEvents)).toHaveBeenLastCalledWith(
      expect.objectContaining({ adapter: null }),
    );
  });

  it('hydrates agent identity from the last opened session snapshot before reconnect completes', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    mockedStorage.getLastOpenedSessionSnapshot.mockResolvedValueOnce({
      sessionKey: 'agent:main:main',
      updatedAt: 1_700_000_000_000,
      agentId: 'main',
      agentName: 'Snapshot Agent',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/avatar.png',
    } as any);

    const adapter = createAdapter('connecting');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.agentDisplayName).toBe('Snapshot Agent');
    expect(result.current.agentEmoji).toBe('🤖');
    expect(result.current.agentAvatarUri).toBe('https://example.com/avatar.png');
  });

  it('does not pass another connection global agent identity to the message cache', () => {
    mockAppContext.agents = [{
      connectionId: 'connection-a',
      id: 'main',
      name: 'Agent A',
      identity: { name: 'Agent A', emoji: 'A' },
    }];
    historyMock.messages = [{ id: 'message-1', role: 'assistant', text: 'Hello' }];
    const adapter = createAdapter('connecting');
    adapter.connection.id = 'connection-b';

    renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    expect(jest.mocked(useChatAutoCache)).toHaveBeenLastCalledWith(expect.objectContaining({
      gatewayConfigId: 'connection-b',
      agentId: 'main',
      agentName: undefined,
      agentEmoji: undefined,
    }));
  });

  it('selects the active connection identity when global agents contain the same id twice', () => {
    mockAppContext.agents = [{
      connectionId: 'connection-a',
      id: 'main',
      name: 'Agent A',
      identity: { name: 'Agent A', emoji: 'A' },
    }, {
      connectionId: 'connection-b',
      id: 'main',
      name: 'Agent B',
      identity: { name: 'Agent B', emoji: 'B' },
    }];
    historyMock.messages = [{ id: 'message-1', role: 'assistant', text: 'Hello' }];
    const adapter = createAdapter('connecting');
    adapter.connection.id = 'connection-b';

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    expect(result.current.agentDisplayName).toBe('Agent B');
    expect(result.current.agentEmoji).toBe('B');
    expect(jest.mocked(useChatAutoCache)).toHaveBeenLastCalledWith(expect.objectContaining({
      gatewayConfigId: 'connection-b',
      agentId: 'main',
      agentName: 'Agent B',
      agentEmoji: 'B',
    }));
  });

  it('hydrates agent identity from cached agent storage when snapshot is unavailable', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    mockedStorage.getLastOpenedSessionSnapshot.mockResolvedValueOnce(null);
    mockedStorage.getCachedAgentIdentity.mockResolvedValueOnce({
      agentId: 'main',
      updatedAt: 1_700_000_000_000,
      agentName: 'Cached Agent',
      agentEmoji: '🛰️',
      agentAvatarUri: 'https://example.com/cached-avatar.png',
    } as any);

    const adapter = createAdapter('connecting');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.agentDisplayName).toBe('Cached Agent');
    expect(result.current.agentEmoji).toBe('🛰️');
    expect(result.current.agentAvatarUri).toBe('https://example.com/cached-avatar.png');
    expect(mockedStorage.getCachedAgentIdentity).toHaveBeenCalledWith(expect.any(String), 'main');
  });

  it('does not hydrate Hermes identity from legacy cached main-agent data', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    mockAppContext.mainSessionKey = 'main';
    historyMock.sessionKey = '20260411_122441_d40735';
    historyMock.sessions = [{ key: '20260411_122441_d40735', kind: 'direct' as const }];
    mockedStorage.getLastOpenedSessionSnapshot.mockResolvedValueOnce({
      sessionKey: 'agent:main:main',
      updatedAt: 1_700_000_000_000,
      agentId: 'main',
      agentName: 'Snapshot Agent',
      agentEmoji: '🤖',
      agentAvatarUri: 'https://example.com/avatar.png',
    } as any);
    mockedStorage.getCachedAgentIdentity.mockResolvedValueOnce({
      agentId: 'main',
      updatedAt: 1_700_000_000_001,
      agentName: 'Cached Agent',
      agentEmoji: '🛰️',
      agentAvatarUri: 'https://example.com/cached-avatar.png',
    } as any);

    const adapter = createAdapter('connecting');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.agentDisplayName).toBe('Assistant');
    expect(result.current.agentEmoji).toBeNull();
    expect(result.current.agentAvatarUri).toBeNull();
  });

  it('does not write legacy last-session state when switching sessions', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    historyMock.sessions = [
      { key: 'agent:main:main', kind: 'direct' as const },
      { key: 'agent:main:dm:alice', kind: 'direct' as const, sessionId: 'sess-alice' },
    ] as any;
    const adapter = createAdapter('ready');

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.switchSession(historyMock.sessions[1] as any);
      await Promise.resolve();
    });

    await act(async () => {
      result.current.switchSession(historyMock.sessions[0] as any);
      await Promise.resolve();
    });

    expect(mockedStorage.setLastSessionKey).not.toHaveBeenCalled();
  });

  it('runs probe then refresh when onRefresh is invoked while disconnected', async () => {
    const adapter = createAdapter('connecting');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(adapter.probe).toHaveBeenCalledTimes(1);
    expect(historyMock.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps read-only session drafts without prompting or probing', async () => {
    const adapter = createAdapter('ready');
    const { result } = renderHook(() => useChatController({
      adapter: adapter as any, readOnly: true, debugMode: false, showAgentAvatar: true,
    } as any));
    await act(async () => { result.current.setInput('Keep this draft'); });
    await act(async () => { result.current.onSend(); });
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(adapter.probe).not.toHaveBeenCalled();
    expect(result.current.input).toBe('Keep this draft');
  });

  it('blocks send when send preflight probe fails', async () => {
    const adapter = createAdapter('ready');
    adapter.probe.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });

    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
    });

    expect(adapter.probe).toHaveBeenCalledTimes(1);
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(recordSuccessfulSendForAutomaticReview).not.toHaveBeenCalled();
    expect(result.current.input).toBe('');
    expect(result.current.listData[0]).toMatchObject({ text: 'hello', delivery: 'held' });
    expect(result.current.sendFailure).toBe('Sending failed. Check the conversation before trying again.');
  });

  it('sends after send preflight probe succeeds', async () => {
    const adapter = createAdapter('ready');
    adapter.probe.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });

    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
    });

    expect(adapter.probe).toHaveBeenCalledTimes(1);
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(recordSuccessfulSendForAutomaticReview).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('keeps one uncertain bubble without refilling the composer (new draft: %s)', async (hasNewDraft) => {
    const adapter = createAdapter('ready');
    let rejectSend: (error: Error) => void = () => undefined;
    adapter.prompt.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    const { result } = renderHook(() => useChatController({
      adapter: adapter as any, debugMode: false, showAgentAvatar: true,
    } as any));
    await act(async () => { result.current.setInput('Original draft'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    if (hasNewDraft) await act(async () => { result.current.setInput('New draft'); });
    await act(async () => { rejectSend(new Error('Private backend response')); await Promise.resolve(); });
    expect(result.current.input).toBe(hasNewDraft ? 'New draft' : '');
    expect(result.current.listData.filter((message) => message.text === 'Original draft')).toHaveLength(1);
    expect(result.current.listData.find((message) => message.text === 'Original draft')?.sendUncertain).toBe(true);
    expect(result.current.isSending).toBe(false);
    expect(result.current.sendFailure).toBe('Sending failed. Check the conversation before trying again.');
    expect(historyMock.messages.some((message) => message.text.includes('Private backend response'))).toBe(false);
  });

  it('keeps a late send failure in the original session without changing the new draft', async () => {
    const adapter = createAdapter('ready');
    let rejectSend: (error: Error) => void = () => undefined;
    adapter.prompt.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    const { result, rerender } = renderHook(() => useChatController({
      adapter: adapter as any, debugMode: false, showAgentAvatar: true,
    } as any));
    await act(async () => { result.current.setInput('Source message'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    historyMock.sessionKey = 'agent:main:other';
    historyMock.messages = [];
    rerender(undefined);
    await act(async () => { result.current.setInput('Other draft'); });
    await act(async () => { rejectSend(new Error('socket closed')); await Promise.resolve(); });
    expect(result.current.input).toBe('Other draft');
    expect(result.current.sendFailure).toBeNull();
    expect(result.current.listData.some((message) => message.text === 'Source message')).toBe(false);
    historyMock.sessionKey = 'agent:main:main';
    rerender(undefined);
    expect(result.current.listData.find((message) => message.text === 'Source message')?.sendUncertain).toBe(true);
  });

  it.each(['openclaw', 'hermes'] as const)(
    'keeps a named pasted image image-typed when sending through %s',
    async (backendKind) => {
      const adapter = createAdapter('ready', backendKind);
      imagePickerHookMock.pendingImages = [{
        uri: 'file:///tmp/pasted.png',
        base64: 'cGl4ZWxz',
        mimeType: 'image/png',
        fileName: 'pasted.png',
      }];

      const { result } = renderHook(() =>
        useChatController({
          adapter: adapter as any,
          debugMode: false,
          showAgentAvatar: true,
        } as any),
      );

      await act(async () => {
        result.current.onSend();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(adapter.prompt).toHaveBeenCalledWith(
        'agent:main:main',
        expect.objectContaining({
          text: 'Look at this image',
          attachments: [{
            type: 'image',
            mimeType: 'image/png',
            content: expect.any(String),
          }],
        }),
      );
    },
  );

  it.each([
    {
      kind: 'image-only',
      attachments: [{ uri: 'file:///photo.png', base64: 'a', mimeType: ' Image/PNG ' }],
      expectedText: 'Look at this image',
    },
    {
      kind: 'file-only',
      attachments: [{
        uri: 'file:///spec.pdf',
        base64: 'b',
        mimeType: ' Application/PDF ',
        fileName: 'spec.pdf',
      }],
      expectedText: 'Review this file',
    },
    {
      kind: 'mixed',
      attachments: [
        { uri: 'file:///photo.png', base64: 'a', mimeType: ' Image/PNG ' },
        {
          uri: 'file:///notes.txt',
          base64: 'b',
          mimeType: ' Text/Plain ',
          fileName: 'notes.txt',
        },
      ],
      expectedText: 'Review these attachments',
    },
  ])('uses localized $kind fallback copy for attachment-only sends', async ({
    attachments,
    expectedText,
  }) => {
    const adapter = createAdapter('ready', 'openclaw');
    imagePickerHookMock.pendingImages = attachments;
    const { result } = renderHook(() => useChatController({
      adapter: adapter as any,
      debugMode: false,
      showAgentAvatar: true,
    } as any));

    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adapter.prompt).toHaveBeenCalledWith(
      'agent:main:main',
      expect.objectContaining({ text: expectedText }),
    );
    expect(historyMock.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      text: expectedText,
    }));
  });

  it('keeps an ordinary attachment file-typed when sending through OpenClaw', async () => {
    const adapter = createAdapter('ready', 'openclaw');
    imagePickerHookMock.pendingImages = [{
      uri: 'file:///tmp/spec.pdf',
      base64: 'cGRm',
      mimeType: 'application/pdf',
      fileName: ' spec.pdf ',
    }];

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('Summarize the attached spec');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adapter.prompt).toHaveBeenCalledWith(
      'agent:main:main',
      expect.objectContaining({
        text: 'Summarize the attached spec',
        attachments: [{
          type: 'file',
          mimeType: 'application/pdf',
          content: 'cGRm',
          name: 'spec.pdf',
        }],
      }),
    );
    expect(historyMock.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      text: 'Summarize the attached spec',
      imageUris: undefined,
      fileAttachments: [{
        uri: 'file:///tmp/spec.pdf',
        mimeType: 'application/pdf',
        fileName: 'spec.pdf',
      }],
    }));
    expect(cacheMessageImages).not.toHaveBeenCalled();
  });

  it('opens the file picker only when the adapter declares non-image file support', async () => {
    const picker = DocumentPicker.getDocumentAsync as jest.MockedFunction<
      typeof DocumentPicker.getDocumentAsync
    >;
    const hermes = createAdapter('ready', 'hermes');
    hermes.capabilities = { ...hermes.capabilities, documentAttachments: false };
    const hermesController = renderHook(() =>
      useChatController({
        adapter: hermes as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await hermesController.result.current.pickFile();
    });
    expect(picker).not.toHaveBeenCalled();
    expect(hermesController.result.current.pickImage).toBe(imagePickerHookMock.pickImage);
    hermesController.unmount();

    const openclaw = createAdapter('ready', 'openclaw');
    const openclawController = renderHook(() =>
      useChatController({
        adapter: openclaw as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    await act(async () => {
      await openclawController.result.current.pickFile();
    });
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('captures send analytics with text length and attachment summary', async () => {
    const adapter = createAdapter('ready');
    adapter.probe.mockResolvedValue(true);
    imagePickerHookMock.pendingImages = [
      { uri: 'file:///one.jpg', base64: 'a', mimeType: 'image/jpeg' },
      {
        uri: 'file:///spec.pdf',
        base64: 'b',
        mimeType: 'application/pdf',
        fileName: 'spec.pdf',
      },
      { uri: 'file:///two.png', base64: 'c', mimeType: 'image/png' },
    ];

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });

    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedAnalytics.chatSendTapped).toHaveBeenCalledWith({
      has_text: true,
      text_length: 5,
      attachment_count: 3,
      image_count: 2,
      file_count: 1,
      attachment_formats: 'application/pdf,image/jpeg,image/png',
      is_command: false,
      session_key_present: true,
    });
    expect(cacheMessageImages).toHaveBeenCalledWith(
      'agent:main:main',
      'hello',
      [
        expect.objectContaining({ mimeType: 'image/jpeg' }),
        expect.objectContaining({ mimeType: 'image/png' }),
      ],
      expect.objectContaining({ role: 'user' }),
    );
    const cachedAttachments = (cacheMessageImages as jest.Mock).mock.calls[0]?.[2];
    expect(cachedAttachments).toHaveLength(2);
    expect(cachedAttachments).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ mimeType: 'application/pdf' }),
    ]));
  });

  it('ignores a rapid duplicate send tap before disabled state commits', async () => {
    let resolveSend: ((value: { runId: string }) => void) | null = null;
    const adapter = createAdapter('ready');
    adapter.prompt.mockImplementation(
      () =>
        new Promise<{ runId: string }>((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });

    const staleOnSend = result.current.onSend;

    await act(async () => {
      staleOnSend();
      staleOnSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(mockedAnalytics.chatSendTapped).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend?.({ runId: 'run-1' });
      await Promise.resolve();
    });
  });

  it('releases the send tap guard after a failed preflight so Send now can retry the same bubble', async () => {
    const adapter = createAdapter('ready');
    adapter.probe
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });

    const staleOnSend = result.current.onSend;

    await act(async () => {
      staleOnSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adapter.prompt).not.toHaveBeenCalled();
    const queuedId = result.current.queuedMessages[0].id;

    await act(async () => {
      result.current.sendQueuedMessageNow(queuedId);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adapter.probe).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.listData.filter((message) => message.id === queuedId)).toHaveLength(1);
  });

  it('captures slash command metadata when sending a typed command', async () => {
    const adapter = createAdapter('ready');
    adapter.probe.mockResolvedValue(true);

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('/status');
    });

    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedAnalytics.chatSendTapped).toHaveBeenCalledWith({
      has_text: true,
      text_length: 7,
      attachment_count: 0,
      image_count: 0,
      file_count: 0,
      is_command: true,
      slash_command: 'status',
      session_key_present: true,
    });
  });

  it('captures slash command selection from suggestions', async () => {
    const adapter = createAdapter('ready');

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.onSelectSlashCommand({
        key: 'status',
        command: '/status',
        description: 'Show session status',
        action: 'send',
      });
    });

    expect(mockedAnalytics.chatSlashCommandTriggered).toHaveBeenCalledWith({
      command_key: 'status',
      command: '/status',
      action: 'send',
      source: 'slash_suggestions',
      session_key_present: true,
    });
  });

  it('captures exec approval decisions', async () => {
    const adapter = createAdapter('ready');
    historyMock.messages = [{ id: 'approval_approval-1', role: 'system', text: '', approval: { id: 'approval-1', command: 'pwd', expiresAtMs: Date.now() + 60000, status: 'pending' } }];

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await result.current.resolveApproval('approval-1', 'allow-once');
    });

    expect(mockedAnalytics.approvalResolved).toHaveBeenCalledWith({
      kind: 'exec',
      decision: 'allow-once',
    });
    expect(adapter.management.approvals.resolveExec).toHaveBeenCalledWith('approval-1', 'allow-once');
  });

  it('keeps failed exec approval pending and refuses an unavailable permanent scope', async () => {
    const adapter = createAdapter('ready');
    adapter.management.approvals.resolveExec.mockRejectedValue(new Error('offline'));
    historyMock.messages = [{ id: 'approval_approval-1', role: 'system', text: '', approval: { id: 'approval-1', command: 'pwd', expiresAtMs: Date.now() + 60000, status: 'pending', decisions: ['allow-once', 'deny'] } }];
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    await act(async () => { await result.current.resolveApproval('approval-1', 'allow-always'); });
    expect(adapter.management.approvals.resolveExec).not.toHaveBeenCalled();
    await act(async () => { await result.current.resolveApproval('approval-1', 'allow-once'); });
    expect(historyMock.messages[0].approval).toMatchObject({ status: 'pending', resolving: false, resolutionError: true });
    expect(mockedAnalytics.approvalResolved).not.toHaveBeenCalled();
  });

  it('routes pair decisions to the target management operation', async () => {
    const adapter = createAdapter('ready');
    const historyMessages = [
      { id: 'session-older', role: 'user', text: 'Older', timestampMs: 100 },
      { id: 'session-newer', role: 'assistant', text: 'Newer', timestampMs: 400 },
    ];
    historyMock.messages = historyMessages;
    adapter.management.devices.list.mockResolvedValue({
      pending: [{
        requestId: 'device-request',
        deviceId: 'phone-1',
        displayName: 'Phone',
        platform: 'ios',
        requestedAtMs: 200,
      }],
      paired: [],
    });
    adapter.management.nodes.pairRequests.mockResolvedValue({
      pending: [{
        requestId: 'node-request',
        nodeId: 'node-1',
        displayName: 'Mac',
        platform: 'darwin',
        requestedAtMs: 300,
      }],
      nodes: [],
    });
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listData.map((message) => message.id)).toEqual([
      'session-newer',
      'approval_pair_node_node-request',
      'approval_pair_device_device-request',
      'session-older',
    ]);
    expect(historyMock.messages).toEqual(historyMessages);

    await act(async () => {
      await result.current.resolveApproval('device-request', 'approve', 'device');
      await result.current.resolveApproval('node-request', 'reject', 'node');
    });

    expect(mockedAnalytics.approvalResolved.mock.calls).toEqual([
      [{ kind: 'pair', decision: 'approve' }],
      [{ kind: 'pair', decision: 'reject' }],
    ]);
    expect(adapter.management.devices.approve).toHaveBeenCalledWith('device-request');
    expect(adapter.management.nodes.reject).toHaveBeenCalledWith('node-request');
    expect(result.current.listData.map((message) => message.approval?.status)).toEqual([
      undefined,
      undefined,
    ]);
    expect(historyMock.messages).toEqual(historyMessages);
  });

  it('keeps a failed pair decision pending and emits no success analytics', async () => {
    const adapter = createAdapter('ready');
    adapter.management.devices.list.mockResolvedValue({
      pending: [{
        requestId: 'device-request',
        deviceId: 'phone-1',
        displayName: 'Phone',
        requestedAtMs: 1,
      }],
      paired: [],
    });
    adapter.management.devices.approve.mockRejectedValueOnce(new Error('stale request'));
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.resolveApproval('device-request', 'approve', 'device');
    });

    expect(adapter.management.devices.approve).toHaveBeenCalledWith('device-request');
    expect(adapter.management.devices.list).toHaveBeenCalledTimes(1);
    expect(mockedAnalytics.approvalResolved).not.toHaveBeenCalled();
    expect(result.current.listData[0]?.approval).toMatchObject({
      id: 'device-request',
      status: 'pending',
      resolving: false,
      resolutionError: true,
    });
    expect(historyMock.messages).toEqual([]);

    await act(async () => {
      await result.current.resolveApproval('device-request', 'approve', 'device');
    });
    expect(adapter.management.devices.approve).toHaveBeenCalledTimes(2);
    expect(mockedAnalytics.approvalResolved).toHaveBeenCalledWith({
      kind: 'pair',
      decision: 'approve',
    });
    expect(result.current.listData).toEqual([]);
  });

  it('keeps a resolving pair card through refresh and deduplicates rapid decisions', async () => {
    const adapter = createAdapter('ready');
    const approval = deferred<void>();
    adapter.management.devices.list.mockResolvedValue({
      pending: [{
        requestId: 'device-request',
        deviceId: 'phone-1',
        displayName: 'Phone',
        requestedAtMs: 1,
      }],
      paired: [],
    });
    adapter.management.devices.approve.mockReturnValueOnce(approval.promise);
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let resolution: Promise<void> | void;
    act(() => {
      resolution = result.current.resolveApproval('device-request', 'approve', 'device');
      result.current.resolveApproval('device-request', 'approve', 'device');
    });
    expect(adapter.management.devices.approve).toHaveBeenCalledTimes(1);
    expect(result.current.listData[0]?.approval).toMatchObject({
      status: 'pending',
      resolving: true,
    });

    adapter.management.devices.list.mockResolvedValue({ pending: [], paired: [] });
    adapter.management.nodes.pairRequests.mockResolvedValue({ pending: [], nodes: [] });
    await act(async () => {
      adapter.emitUpdate({
        type: 'history_reconciled',
        sessionKey: 'agent:main:main',
        history: { key: 'agent:main:main', messages: [], hasActiveRun: false },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listData[0]?.approval).toMatchObject({
      status: 'pending',
      resolving: true,
    });

    await act(async () => {
      approval.resolve();
      await resolution;
    });
    expect(result.current.listData).toEqual([]);
  });

  it('does not project one connection pair request after the adapter changes', async () => {
    const firstAdapter = createAdapter('ready');
    firstAdapter.management.devices.list.mockResolvedValue({
      pending: [{
        requestId: 'first-connection-request',
        deviceId: 'phone-1',
        displayName: 'First phone',
        requestedAtMs: 1,
      }],
      paired: [],
    });
    const secondAdapter = createAdapter('ready');
    secondAdapter.connection.id = 'connection-2';
    let currentAdapter = firstAdapter;
    const { result, rerender } = renderHook(() =>
      useChatController({
        adapter: currentAdapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.listData[0]?.approval?.id).toBe('first-connection-request');

    currentAdapter = secondAdapter;
    rerender(undefined);
    expect(result.current.listData.some((message) => (
      message.approval?.id === 'first-connection-request'
    ))).toBe(false);
    expect(historyMock.messages).toEqual([]);
  });

  it('skips a second probe when transport was just confirmed healthy', async () => {
    const adapter = createAdapter('ready');
    adapter.probe.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];

    await act(async () => {
      result.current.setInput('hello-1');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Finish the first turn; a send during a run would join the queue instead.
    await act(async () => {
      eventParams!.onUpdate?.({
        type: 'run_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stopReason: 'end_turn',
        activeRunId: null,
        isSending: false,
        finalMessage: { id: 'final_run-1', role: 'assistant', text: 'Hi', timestampMs: 10 },
      });
      await Promise.resolve();
    });
    expect(result.current.isSending).toBe(false);

    await act(async () => {
      result.current.setInput('hello-2');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(adapter.probe).toHaveBeenCalledTimes(1);
    expect(adapter.prompt).toHaveBeenCalledTimes(2);
  });

  it('blocks send when network is offline even if connection state is ready', async () => {
    const adapter = createAdapter('ready');
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({
      type: 'NONE' as any,
      isConnected: false,
      isInternetReachable: false,
    });

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
    });

    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(adapter.probe).not.toHaveBeenCalled();
    expect(result.current.input).toBe('');
    expect(result.current.listData[0]).toMatchObject({ text: 'hello', delivery: 'held' });
  });

  it('clears sending state when adapter cache scope changes', async () => {
    let adapter = createAdapter('ready');
    const { result, rerender } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isSending).toBe(true);

    await act(async () => {
      adapter = {
        ...createAdapter('ready'),
        connection: { ...adapter.connection, id: 'connection-2' },
      };
      rerender(undefined);
    });
    expect(result.current.isSending).toBe(false);
    expect(result.current.activityLabel).toBeNull();
  });

  it('keeps sending state when adapter cache scope does not change', async () => {
    const adapter = createAdapter('ready');
    const { result, rerender } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isSending).toBe(true);

    await act(async () => {
      rerender(undefined);
    });
    expect(result.current.isSending).toBe(true);
  });

  it('does not derive sending from running-tool rows before history loads', async () => {
    const adapter = createAdapter('ready');
    historyMock.historyLoaded = false;
    historyMock.messages = [
      {
        id: 'tool_1',
        role: 'tool',
        text: '',
        toolName: 'search',
        toolStatus: 'running',
      },
    ];

    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isSending).toBe(false);
  });

  it('still derives sending from running-tool rows after history loads', async () => {
    const adapter = createAdapter('ready');
    historyMock.historyLoaded = true;
    historyMock.messages = [];

    const { result, rerender } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      historyMock.messages = [
        {
          id: 'tool_1',
          role: 'tool',
          text: '',
          toolName: 'search',
          toolStatus: 'running',
          timestampMs: Date.now(),
        },
      ];
      rerender(undefined);
      await Promise.resolve();
    });

    expect(result.current.isSending).toBe(true);
  });

  it('does not leak sending state when switching session before history loads', async () => {
    const adapter = createAdapter('ready');
    historyMock.historyLoaded = true;
    historyMock.sessionKey = 'agent:main:main';
    historyMock.messages = [
      {
        id: 'tool_1',
        role: 'tool',
        text: '',
        toolName: 'search',
        toolStatus: 'running',
        timestampMs: Date.now(),
      },
    ];

    const { result, rerender } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isSending).toBe(true);

    await act(async () => {
      historyMock.sessionKey = 'agent:main:other';
      historyMock.historyLoaded = false;
      historyMock.messages = [];
      rerender(undefined);
      await Promise.resolve();
    });

    expect(result.current.isSending).toBe(false);
    expect(result.current.activityLabel).toBeNull();
  });

  it('restores active run state when switching away from an agent and back', async () => {
    const adapter = createAdapter('ready');
    historyMock.historyLoaded = true;
    historyMock.sessionKey = 'agent:main:main';
    historyMock.sessions = [
      { key: 'agent:main:main', kind: 'direct' as const },
      { key: 'agent:agent-b:main', kind: 'direct' as const },
    ];
    mockAppContext.currentAgentId = 'main';

    const { result, rerender } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isSending).toBe(true);
    expect(historyMock.sessionKey).toBe('agent:main:main');

    await act(async () => {
      mockAppContext.pendingAgentSwitch = 'agent-b';
      rerender(undefined);
      await Promise.resolve();
    });
    expect(historyMock.sessionKey).toBe('agent:agent-b:main');
    expect(result.current.isSending).toBe(false);

    await act(async () => {
      mockAppContext.pendingAgentSwitch = 'main';
      rerender(undefined);
      await Promise.resolve();
    });
    expect(historyMock.sessionKey).toBe('agent:main:main');
    expect(result.current.isSending).toBe(true);
  });

  it('drives connection and session state from adapter events', async () => {
    const adapter = createAdapter('connecting');
    const { result } = renderHook(() =>
      useChatController({
        adapter,
        debugMode: false,
        showAgentAvatar: true,
      }),
    );
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();
    expect(result.current.connectionState).toBe('connecting');

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onSessions?.([{
        connectionId: 'connection-1',
        agentId: 'main',
        key: 'agent:main:main',
        kind: 'main',
        title: 'Main thread',
        updatedAt: 123,
        preview: 'Latest reply',
        hasActiveRun: false,
        allowedActions: {
          rename: true,
          reset: true,
          delete: false,
          pin: true,
        },
      }]);
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe('ready');
    expect(historyMock.loadSessionsAndHistory).toHaveBeenCalledTimes(1);
    expect(historyMock.sessions).toEqual([
      expect.objectContaining({
        connectionId: 'connection-1',
        agentId: 'main',
        key: 'agent:main:main',
        kind: 'main',
        title: 'Main thread',
        lastMessagePreview: 'Latest reply',
        hasActiveRun: false,
        allowedActions: {
          rename: true,
          reset: true,
          delete: false,
          pin: true,
        },
      }),
    ]);

    await act(async () => {
      eventParams!.onUpdate?.({
        type: 'session_info_update',
        session: {
          connectionId: 'connection-1',
          agentId: 'main',
          key: 'agent:main:cron:daily-report',
          kind: 'cron',
          title: 'Daily report',
          hasActiveRun: false,
          attention: 'cron_failed',
          parentSessionKey: 'agent:main:main',
        },
      });
      await Promise.resolve();
    });
    expect(historyMock.sessions).toContainEqual(expect.objectContaining({
      connectionId: 'connection-1',
      agentId: 'main',
      key: 'agent:main:cron:daily-report',
      kind: 'cron',
      title: 'Daily report',
      hasActiveRun: false,
      attention: 'cron_failed',
      parentSessionKey: 'agent:main:main',
      spawnedBy: 'agent:main:main',
    }));
  });

  it('renders adapter run chunks and tools, then commits the final message', async () => {
    const adapter = createAdapter('ready');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onUpdate?.({
        type: 'run_started',
        sessionKey: 'agent:main:main',
        runId: 'run-adapter',
        activeRunId: 'run-adapter',
        isSending: true,
        startedAtMs: 100,
      });
      eventParams!.onUpdate?.({
        type: 'agent_message_chunk',
        sessionKey: 'agent:main:main',
        runId: 'run-adapter',
        text: 'Hello',
        activeRunId: 'run-adapter',
        isSending: true,
        visible: true,
        streamingMessage: {
          id: 'streaming',
          role: 'assistant',
          text: 'Hello',
          streaming: true,
        },
      });
      eventParams!.onUpdate?.({
        type: 'tool_call',
        sessionKey: 'agent:main:main',
        runId: 'run-adapter',
        toolCallId: 'tool-adapter',
        activeRunId: 'run-adapter',
        isSending: true,
        merge: false,
        message: {
          id: 'toolcall_tool-adapter',
          role: 'tool',
          text: '',
          toolName: 'exec',
          toolStatus: 'running',
          toolArgs: '{"command":"pwd"}',
        },
      });
    });

    expect(result.current.isSending).toBe(true);
    expect(result.current.listData).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', text: 'Hello' }),
      expect.objectContaining({
        id: 'toolcall_tool-adapter',
        role: 'tool',
        toolStatus: 'running',
      }),
    ]));

    await act(async () => {
      eventParams!.onUpdate?.({
        type: 'tool_call_update',
        sessionKey: 'agent:main:main',
        runId: 'run-adapter',
        toolCallId: 'tool-adapter',
        activeRunId: 'run-adapter',
        isSending: true,
        merge: true,
        message: {
          id: 'toolcall_tool-adapter',
          role: 'tool',
          text: '',
          toolStatus: 'success',
          toolFinishedAt: 200,
        },
      });
      eventParams!.onUpdate?.({
        type: 'run_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-adapter',
        stopReason: 'end_turn',
        activeRunId: null,
        isSending: false,
        finalMessage: {
          id: 'final_run-adapter',
          role: 'assistant',
          text: 'Hello world',
          timestampMs: 300,
        },
      });
      await Promise.resolve();
    });

    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages.map(message => [message.role, message.text])).toEqual([
      ['assistant', 'Hello'], ['tool', ''], ['assistant', 'world'],
    ]);
    expect(result.current.listData.map(message => message.text)).toEqual(['world', '', 'Hello']);
  });

  it('handles cancelled and errored adapter runs without leaving sending state stuck', async () => {
    const adapter = createAdapter('ready');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onUpdate?.({
        type: 'run_started',
        sessionKey: 'agent:main:main',
        runId: 'run-cancelled',
        activeRunId: 'run-cancelled',
        isSending: true,
        startedAtMs: 100,
      });
      eventParams!.onUpdate?.({
        type: 'agent_message_chunk',
        sessionKey: 'agent:main:main',
        runId: 'run-cancelled',
        text: 'Partial',
        activeRunId: 'run-cancelled',
        isSending: true,
        visible: true,
      });
      eventParams!.onUpdate?.({
        type: 'run_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-cancelled',
        stopReason: 'cancelled',
        activeRunId: null,
        isSending: false,
        systemMessage: {
          id: 'sys_abort_run-cancelled',
          role: 'system',
          text: 'Run aborted by user.',
        },
      });
    });

    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'abort_run-cancelled', text: 'Partial' }),
      expect.objectContaining({ id: 'sys_abort_run-cancelled' }),
    ]));

    await act(async () => {
      eventParams!.onUpdate?.({
        type: 'run_started',
        sessionKey: 'agent:main:main',
        runId: 'run-error',
        activeRunId: 'run-error',
        isSending: true,
        startedAtMs: 400,
      });
      eventParams!.onUpdate?.({
        type: 'error',
        sessionKey: 'agent:main:main',
        runId: 'run-error',
        code: 'server',
        errorMessage: 'Backend failed',
        message: {
          id: 'error_run-error_500',
          role: 'system',
          text: 'Backend failed',
        },
      });
      eventParams!.onUpdate?.({
        type: 'run_finished',
        sessionKey: 'agent:main:main',
        runId: 'run-error',
        stopReason: 'error',
        activeRunId: null,
        isSending: false,
      });
    });

    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages.some((message) => message.id === 'error_run-error_500')).toBe(false);
    expect(result.current.sendFailure).toBe("The agent couldn't complete this reply. Please try again.");
    expect(result.current.sendFailureDetails).toBe('Backend failed');
    act(() => result.current.clearSendFailure());
    expect(result.current.sendFailureDetails).toBeNull();
  });

  it('shows compaction temporarily and keeps handshake pairing state separate from pair cards', async () => {
    const adapter = createAdapter('ready');
    adapter.management.devices.list.mockResolvedValue({
      pending: [{
        requestId: 'owner-request',
        deviceId: 'phone-1',
        displayName: 'Phone',
        platform: 'ios',
        requestedAtMs: 123,
      }],
      paired: [],
    });
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      eventParams!.onUpdate?.({
        type: 'compaction',
        sessionKey: 'agent:main:main',
        phase: 'start',
        notice: 'Compacting context...',
      });
    });
    expect(result.current.compactionNotice).toBe('Compacting context...');
    act(() => jest.advanceTimersByTime(5_000));
    expect(result.current.compactionNotice).toBeNull();

    act(() => {
      eventParams!.onUpdate?.({
        type: 'compaction',
        sessionKey: 'agent:main:main',
        phase: 'start',
        notice: 'Compacting context...',
      });
      eventParams!.onUpdate?.({
        type: 'compaction',
        sessionKey: 'agent:main:main',
        phase: 'end',
        notice: null,
      });
    });
    expect(result.current.compactionNotice).toBeNull();

    act(() => {
      eventParams!.onUpdate?.({ type: 'pairing_required', requestId: 'self-request' });
      eventParams!.onUpdate?.({
        type: 'approval_requested',
        approval: {
          kind: 'pair',
          id: 'owner-request',
          target: 'device',
          displayName: 'Phone',
          platform: 'ios',
          receivedAtMs: 123,
        },
        message: {
          id: 'approval_owner-request',
          role: 'system',
          text: '',
          timestampMs: 123,
          approval: {
            kind: 'pair',
            id: 'owner-request',
            target: 'device',
            displayName: 'Phone',
            platform: 'ios',
            receivedAtMs: 123,
            status: 'pending',
          },
        },
      });
    });
    expect(result.current.pairingPending).toBe(true);
    expect(result.current.listData).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'approval_pair_device_owner-request' }),
    ]));
    expect(historyMock.messages).toEqual([]);

    act(() => {
      adapter.emitUpdate({
        type: 'approval_resolved',
        approvalId: 'owner-request',
        decision: 'approved',
        kind: 'pair',
        target: 'device',
      });
    });
    expect(result.current.pairingPending).toBe(true);
    expect(result.current.listData.some(message => message.approval?.kind === 'pair')).toBe(false);
    act(() => {
      eventParams!.onUpdate?.({
        type: 'pairing_resolved',
        requestId: 'self-request',
        decision: 'approved',
      });
    });
    expect(result.current.pairingPending).toBe(false);
  });

  it('applies adapter approvals and reconciled history to the current session', async () => {
    mockAppContext.execApprovalEnabled = true;
    const adapter = createAdapter('ready');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onUpdate?.({
        type: 'approval_requested',
        sessionKey: 'agent:main:main',
        approval: {
          kind: 'exec',
          id: 'approval-1',
          command: 'pwd',
          expiresAtMs: 999,
        },
        message: {
          id: 'approval_approval-1',
          role: 'system',
          text: '',
          approval: {
            id: 'approval-1',
            command: 'pwd',
            expiresAtMs: 999,
            status: 'pending',
          },
        },
      });
      eventParams!.onUpdate?.({
        type: 'approval_resolved',
        approvalId: 'approval-1',
        decision: 'allow-once',
        status: 'allowed',
        messageId: 'approval_approval-1',
      });
    });

    expect(historyMock.messages).toEqual([
      expect.objectContaining({
        id: 'approval_approval-1',
        approval: expect.objectContaining({ status: 'allowed' }),
      }),
    ]);

    await act(async () => {
      eventParams!.onUpdate?.({
        type: 'history_reconciled',
        sessionKey: 'agent:main:main',
        history: {
          key: 'agent:main:main',
          hasActiveRun: false,
          messages: [],
        },
        messages: [{
          id: 'history-assistant',
          role: 'assistant',
          text: 'Reconciled answer',
        }],
        nextCursor: 'cursor-2',
        hasActiveRun: false,
      });
    });

    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages).toEqual([
      expect.objectContaining({ id: 'history-assistant', text: 'Reconciled answer' }),
    ]);
    expect(historyMock.setHistoryLoaded).toHaveBeenCalledWith(true);
    expect(historyMock.setHasMoreHistory).toHaveBeenCalledWith(true);
  });

  it('avoids duplicate history recovery for a terminal adapter tool update', async () => {
    const adapter = createAdapter('ready');
    const { rerender } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();

    historyMock.sessionKey = 'agent:main:main';

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onUpdate?.({
        type: 'run_started',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        activeRunId: 'run-1',
        isSending: true,
        startedAtMs: Date.now(),
      });
      eventParams!.onUpdate?.({
        type: 'tool_call_update',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        toolCallId: 'tool-1',
        activeRunId: 'run-1',
        isSending: true,
        merge: true,
        message: {
          id: 'toolcall_tool-1',
          role: 'tool',
          text: '',
          toolStatus: 'success',
          toolFinishedAt: Date.now(),
        },
      });
      await Promise.resolve();
    });

    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1_800);
      await Promise.resolve();
    });

    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);
    expect(historyMock.reconcileLatestAssistantFromHistory).not.toHaveBeenCalled();

    await act(async () => {
      rerender(undefined);
    });
  });

it('restores thinking and streamed text from history after the controller remounts', async () => {
  historyMock.activitySnapshot = null;
  const adapter = createAdapter('ready');
  const { result, rerender, unmount } = renderHook(() => useChatController({ adapter: adapter as any,
    debugMode: false, showAgentAvatar: true } as any));
  await act(async () => {
    historyMock.activitySnapshot = { key: 'agent:main:main', messages: [], hasActiveRun: true,
      activeRun: { runId: 'recovered', text: '', startedAtMs: Date.now() } };
    rerender({});
  });
  expect(result.current.isSending).toBe(true);
  await act(async () => {
    historyMock.activitySnapshot = { ...historyMock.activitySnapshot!, activeRun: {
      runId: 'recovered', text: 'Working on it', startedAtMs: Date.now() } };
    rerender({});
  });
  expect(result.current.listData.some(message => message.text === 'Working on it')).toBe(true);
  await act(async () => {
    historyMock.activitySnapshot = { key: 'agent:main:main', messages: [], hasActiveRun: false };
    rerender({});
  });
  expect(result.current.isSending).toBe(false);
  unmount();
  historyMock.activitySnapshot = null;
});


it('does not restore an old history snapshot after a live terminal event', async () => {
  const adapter = createAdapter('ready');
  const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any,
    debugMode: false, showAgentAvatar: true } as any));
  const requestedAtMs = Date.now() - 100;
  await act(async () => {
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    events.onUpdate?.({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'old',
      stopReason: 'end_turn', activeRunId: null, isSending: false });
    historyMock.activitySnapshot = { key: 'agent:main:main', hasActiveRun: true, messages: [],
      activeRun: { runId: 'old', text: 'stale' }, requestedAtMs } as any;
    rerender({});
  });
  expect(result.current.isSending).toBe(false);
  expect(result.current.listData.some(message => message.text === 'stale')).toBe(false);
});

  it('restores unused steering only for the active run without replaying it', async () => {
    const adapter = createAdapter('ready', 'hermes');
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      result.current.setInput('Existing draft');
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
    });
    await act(async () => {
      events.onUpdate?.({ type: 'run_finished', runId: 'old', sessionKey: 'agent:main:main', activeRunId: null, isSending: false, stopReason: 'end_turn', unappliedInput: 'stale input' });
    });
    expect(result.current.input).toBe('Existing draft');
    await act(async () => {
      events.onUpdate?.({ type: 'run_finished', runId: 'active', sessionKey: 'agent:main:main', activeRunId: null, isSending: false, stopReason: 'end_turn', unappliedInput: 'Use the corrected date', finalMessage: { id: 'final-active', role: 'assistant', text: 'Done' } });
    });
    expect(result.current.input).toBe('Existing draft\n\nUse the corrected date');
    expect(result.current.sendFailure).toContain('draft is restored');
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('recovers native pending approvals with the legacy display toggle off and ignores a late resolved snapshot', async () => {
    const adapter = createAdapter('ready', 'hermes');
    const snapshot = deferred<any[]>();
    Object.assign(adapter.management.approvals, { listExec: jest.fn(() => snapshot.promise) });
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => { events.onState?.('ready'); });
    await act(async () => {
      events.onUpdate?.({ type: 'approval_resolved', kind: 'exec', messageId: 'approval_done', status: 'allowed' } as any);
      snapshot.resolve([{ sessionKey: 'agent:main:main', approval: { kind: 'exec', id: 'done', command: 'echo done', expiresAtMs: Date.now() + 60000 } },
        { sessionKey: 'agent:main:main', approval: { kind: 'exec', id: 'pending', command: 'echo pending', expiresAtMs: Date.now() + 60000 } }]);
      await snapshot.promise;
    });
    expect(historyMock.messages.some(message => message.approval?.id === 'done')).toBe(false);
    expect(historyMock.messages.some(message => message.approval?.id === 'pending')).toBe(true);
  });

  it.each([false, true])('refreshes terminal history after an in-flight tool read unless a new run owns the session (%s)', async newRun => {
    const adapter = createAdapter('ready');
    renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    let finishRead!: (value: number) => void;
    historyMock.loadHistory.mockImplementationOnce(() => new Promise<number>(resolve => { finishRead = resolve; }));
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'first', activeRunId: 'first', isSending: true, startedAtMs: Date.now() });
      events.onUpdate?.({ type: 'tool_call_update', sessionKey: 'agent:main:main', runId: 'first', toolCallId: 'tool', activeRunId: 'first', isSending: true, merge: true,
        message: { id: 'toolcall_tool', role: 'tool', text: '', toolStatus: 'success', toolFinishedAt: Date.now() } });
      events.onUpdate?.({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'first', activeRunId: null, isSending: false, stopReason: 'end_turn',
        finalMessage: { id: 'final_first', role: 'assistant', text: 'Done' } });
    });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (newRun) events.onUpdate?.({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'second', activeRunId: 'second', isSending: true, startedAtMs: Date.now() });
      finishRead(1);
    });
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(newRun ? 1 : 2);
  });

});
