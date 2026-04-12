import { act, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { analyticsEvents } from '../../../services/analytics/events';
import { StorageService } from '../../../services/storage';
import { useChatController } from './useChatController';
import { useGatewayChatEvents } from './useGatewayChatEvents';

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
  voiceInputLevel: 0.42,
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

jest.mock('../../../services/speech/speechRecognition', () => ({
  stopSpeechRecognitionAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/speech/speechText', () => ({
  resolveSpeechLocale: jest.fn(() => 'en-US'),
}));

jest.mock('../../../services/storage', () => ({
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

jest.mock('../../../hooks/useChatImagePicker', () => ({
  useChatImagePicker: jest.fn(() => imagePickerHookMock),
}));

jest.mock('../../../hooks/useChatImagePreview', () => ({
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

jest.mock('../../../hooks/useChatAutoCache', () => ({
  useChatAutoCache: jest.fn(),
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
  speechRecognitionLanguage: 'system',
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
  mockAppContext.pendingAgentSwitch = null;
  mockAppContext.speechRecognitionLanguage = 'system';
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

jest.mock('../../../contexts/AppContext', () => ({
  useAppContext: jest.fn(() => mockAppContext),
}));

jest.mock('./useChatHistoryState', () => ({
  useChatHistoryState: jest.fn(() => historyMock),
}));

jest.mock('./useGatewayChatEvents', () => ({
  useGatewayChatEvents: jest.fn(),
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

jest.mock('../../../services/analytics/events', () => ({
  analyticsEvents: {
    chatSendTapped: jest.fn(),
    chatSlashCommandTriggered: jest.fn(),
    chatExecApprovalResolved: jest.fn(),
  },
}));

function createGateway(connectionState: 'ready' | 'connecting' = 'ready') {
  return {
    getConnectionState: jest.fn(() => connectionState),
    getBackendKind: jest.fn(() => 'openclaw' as const),
    getBackendCapabilities: jest.fn(() => ({ chatAbort: true })),
    getBaseUrl: jest.fn(() => ''),
    fetchIdentity: jest.fn().mockResolvedValue({}),
    probeConnection: jest.fn().mockResolvedValue(true),
    reconnect: jest.fn(),
    sendChat: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
    listSessions: jest.fn().mockResolvedValue([]),
    resolveExecApproval: jest.fn().mockResolvedValue(undefined),
    abortChat: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(() => jest.fn()),
  };
}

describe('useChatController contract', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    jest.clearAllMocks();
    resetMockState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('exposes stable public fields and forwards extracted hook outputs', () => {
    const gateway = createGateway();
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    expect(result.current).toEqual(
      expect.objectContaining({
        connectionState: 'ready',
        input: '',
        setInput: expect.any(Function),
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

    const gateway = createGateway('connecting');
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: {
          mode: 'local',
          url: 'http://localhost:3000',
        } as any,
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

    const gateway = createGateway('connecting');
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: {
          mode: 'local',
          url: 'http://localhost:3000',
        } as any,
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

  it('does not write legacy last-session state when switching sessions', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    historyMock.sessions = [
      { key: 'agent:main:main', kind: 'direct' as const },
      { key: 'agent:main:dm:alice', kind: 'direct' as const, sessionId: 'sess-alice' },
    ] as any;
    const gateway = createGateway('ready');

    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: {
          mode: 'local',
          url: 'http://localhost:3000',
        } as any,
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
    const gateway = createGateway('connecting');
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(gateway.probeConnection).toHaveBeenCalledTimes(1);
    expect(historyMock.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('blocks send when send preflight probe fails', async () => {
    const gateway = createGateway('ready');
    gateway.probeConnection.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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

    expect(gateway.probeConnection).toHaveBeenCalledTimes(1);
    expect(gateway.sendChat).not.toHaveBeenCalled();
    expect(result.current.input).toBe('hello');
  });

  it('sends after send preflight probe succeeds', async () => {
    const gateway = createGateway('ready');
    gateway.probeConnection.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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

    expect(gateway.probeConnection).toHaveBeenCalledTimes(1);
    expect(gateway.sendChat).toHaveBeenCalledTimes(1);
  });

  it('captures send analytics with text length and attachment summary', async () => {
    const gateway = createGateway('ready');
    gateway.probeConnection.mockResolvedValue(true);
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
        gateway: gateway as any,
        config: null,
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
  });

  it('captures slash command metadata when sending a typed command', async () => {
    const gateway = createGateway('ready');
    gateway.probeConnection.mockResolvedValue(true);

    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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
    const gateway = createGateway('ready');

    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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
    const gateway = createGateway('ready');

    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.resolveApproval('approval-1', 'allow-once');
    });

    expect(mockedAnalytics.chatExecApprovalResolved).toHaveBeenCalledWith({
      decision: 'allow-once',
      source: 'approval_card',
    });
    expect(gateway.resolveExecApproval).toHaveBeenCalledWith('approval-1', 'allow-once');
  });

  it('skips a second probe when transport was just confirmed healthy', async () => {
    const gateway = createGateway('ready');
    gateway.probeConnection.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    await act(async () => {
      result.current.setInput('hello-1');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      result.current.setInput('hello-2');
    });
    await act(async () => {
      result.current.onSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gateway.probeConnection).toHaveBeenCalledTimes(1);
    expect(gateway.sendChat).toHaveBeenCalledTimes(2);
  });

  it('blocks send when network is offline even if connection state is ready', async () => {
    const gateway = createGateway('ready');
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({
      type: 'NONE' as any,
      isConnected: false,
      isInternetReachable: false,
    });

    const { result } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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

    expect(gateway.sendChat).not.toHaveBeenCalled();
    expect(gateway.probeConnection).not.toHaveBeenCalled();
    expect(result.current.input).toBe('hello');
  });

  it('clears sending state when gateway cache scope changes', async () => {
    const gateway = createGateway('ready');
    mockAppContext.activeGatewayConfigId = 'cfg:one';
    const { result, rerender } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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
      mockAppContext.activeGatewayConfigId = 'cfg:two';
      rerender(undefined);
    });
    expect(result.current.isSending).toBe(false);
    expect(result.current.activityLabel).toBeNull();
  });

  it('keeps sending state when gateway cache scope does not change', async () => {
    const gateway = createGateway('ready');
    mockAppContext.activeGatewayConfigId = 'cfg:stable';
    const { result, rerender } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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
      mockAppContext.activeGatewayConfigId = 'cfg:stable';
      rerender(undefined);
    });
    expect(result.current.isSending).toBe(true);
  });

  it('does not derive sending from running-tool rows before history loads', async () => {
    const gateway = createGateway('ready');
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
        gateway: gateway as any,
        config: null,
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
    const gateway = createGateway('ready');
    historyMock.historyLoaded = true;
    historyMock.messages = [];

    const { result, rerender } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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
    const gateway = createGateway('ready');
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
        gateway: gateway as any,
        config: null,
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
    const gateway = createGateway('ready');
    historyMock.historyLoaded = true;
    historyMock.sessionKey = 'agent:main:main';
    historyMock.sessions = [
      { key: 'agent:main:main', kind: 'direct' as const },
      { key: 'agent:agent-b:main', kind: 'direct' as const },
    ];
    mockAppContext.currentAgentId = 'main';

    const { result, rerender } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
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

  it('avoids double history reload when toolResult and toolSettled fire for the same run', async () => {
    const gateway = createGateway('ready');
    const { rerender } = renderHook(() =>
      useChatController({
        gateway: gateway as any,
        config: null,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );

    const eventParams = jest.mocked(useGatewayChatEvents).mock.calls.at(-1)?.[0];
    expect(eventParams).toBeTruthy();

    historyMock.sessionKey = 'agent:main:main';
    eventParams!.currentRunIdRef.current = 'run-1';

    await act(async () => {
      eventParams!.onToolResult?.({
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        toolName: 'exec',
        status: 'success',
      });
      await Promise.resolve();
    });

    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      eventParams!.onToolSettled?.({
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        toolName: 'exec',
        status: 'success',
      });
      jest.advanceTimersByTime(1_800);
      await Promise.resolve();
    });

    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);
    expect(historyMock.reconcileLatestAssistantFromHistory).not.toHaveBeenCalled();

    await act(async () => {
      rerender(undefined);
    });
  });
});
