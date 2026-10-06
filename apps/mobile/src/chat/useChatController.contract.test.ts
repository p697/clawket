import { useChatHistoryState } from './useChatHistoryState';
import { resetSessionHistory } from '../connection/session-reset';
import { ChatCacheService } from '../services/chat-cache';
import { clearUncertainSends } from './sendRecovery';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { AdapterError, CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import { analyticsEvents } from '../services/analytics/events';
import { recordSuccessfulSendForAutomaticReview } from '../services/auto-app-review';
import { cacheMessageImages } from '../services/image-cache';
import { StorageService } from '../services/storage';
import { useChatAutoCache } from '../hooks/useChatAutoCache';
import { useAdapterChatEvents } from './useAdapterChatEvents';
import { useChatController as useChatControllerImpl } from './useChatController';
import { resetMessageQueueStore } from './messageQueue';
import { preserveOptimisticAssistantMessage } from './historyMergePolicy';
import { readFileAsBase64 } from './chatControllerUtils';

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
  applyReconciledHistory: jest.fn().mockReturnValue(false),
  setThinkingLevel: jest.fn(),
  refreshSessions: jest.fn(),
  onLoadMoreHistory: jest.fn(),
  onRefresh: jest.fn().mockResolvedValue(undefined),
  loadHistory: jest.fn().mockResolvedValue(0),
  restoreCachedMessages: jest.fn().mockResolvedValue(undefined),
  loadSessionsAndHistory: jest.fn(),
  reconcileLatestAssistantFromHistory: jest.fn().mockResolvedValue(undefined),
  captureSessionScope: jest.fn(() => () => true),
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
  hasRuntimeSettings: false,
  nativeThinkingLevel: null as string | null,
  runtimeSettingsBusy: false,
  runtimeSettingsPendingRef: { current: false },
    runtimeSettingsUnconfirmedRef: { current: false },
  requirePermissionsConfirmation: jest.fn(() => { modelPickerHookMock.runtimeSettingsUnconfirmedRef.current = true; }),
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
  isCurrentAttachmentScope: jest.fn(() => true),
};
let mockActualImagePicker = false;

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(() => true),
}));

jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(() => ({
    t: mockT,
    i18n: mockI18n,
  })),
}));

jest.mock('../i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

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
  useChatImagePicker: jest.fn((...args: unknown[]) => mockActualImagePicker
    ? jest.requireActual('../hooks/useChatImagePicker').useChatImagePicker(...args)
    : imagePickerHookMock),
}));

jest.mock('./chatControllerUtils', () => ({
  ...jest.requireActual('./chatControllerUtils'),
  readFileAsBase64: jest.fn().mockResolvedValue('YQ=='),
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
  modelPickerHookMock.hasRuntimeSettings = false;
  modelPickerHookMock.nativeThinkingLevel = null;
  modelPickerHookMock.runtimeSettingsUnconfirmedRef.current = false;
  historyMock.setMessages.mockClear();
  historyMock.applyReconciledHistory.mockReset().mockReturnValue(false);
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
  backendKind: keyof typeof CAPABILITY_MATRIX = 'openclaw',
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
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

  it.each(['codex', 'hermes', 'pi'] as const)('keeps the chooser available but serializes pending Current acknowledgement for %s', async backend => {
    const adapter = createAdapter('ready', backend);
    const acknowledgement = deferred<void>();
    const steer = jest.fn(() => acknowledgement.promise);
    Object.assign(adapter, { steer });
    const { result } = renderHook(() => useChatController({ adapter, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('First guidance');
    });
    expect(result.current.canSteer).toBe(true);
    act(() => result.current.onSteer('active'));
    expect(result.current.canSteer).toBe(false);
    expect(result.current.steeringPending).toBe(true);
    expect(result.current.canChooseRunInput).toBe(true);
    act(() => result.current.setInput('Next guidance'));
    act(() => result.current.onSteer('active'));
    expect(steer).toHaveBeenCalledTimes(1);
    expect(result.current.input).toBe('Next guidance');
    await act(async () => { acknowledgement.resolve(); await acknowledgement.promise; });
    expect(result.current.steeringPending).toBe(false);
    expect(result.current.canSteer).toBe(true);
    expect(result.current.input).toBe('Next guidance');
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('retains the normal outbox path when the backend does not advertise Current guidance', async () => {
    const adapter = createAdapter('ready', 'openclaw');
    const steer = jest.fn().mockResolvedValue(undefined);
    Object.assign(adapter, { steer });
    const { result } = renderHook(() => useChatController({ adapter, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Next task');
    });
    expect(result.current.canChooseRunInput).toBe(false);
    expect(result.current.canSteer).toBe(false);
    act(() => result.current.onSteer('active'));
    await act(async () => { result.current.onSend(); });
    expect(result.current.queuedMessages.map(message => message.text)).toEqual(['Next task']);
    expect(steer).not.toHaveBeenCalled();
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('preserves a deliberately recomposed identical draft while the previous Current acknowledgement is pending', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    const steer = jest.fn().mockReturnValueOnce(acknowledgement.promise).mockResolvedValue(undefined);
    Object.assign(adapter, { steer });
    const { result } = renderHook(() => useChatController({ adapter, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Keep waiting');
    });
    act(() => result.current.onSteer('active'));
    act(() => result.current.setInput(''));
    act(() => result.current.setInput('Keep waiting'));
    await act(async () => { acknowledgement.resolve(); await acknowledgement.promise; });
    expect(result.current.input).toBe('Keep waiting');
    expect(result.current.canChooseRunInput).toBe(true);
    expect(steer).toHaveBeenCalledTimes(1);
    expect(adapter.prompt).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); result.current.onSteer('active'); await Promise.resolve(); });
    expect(steer).toHaveBeenCalledTimes(2);
    expect(historyMock.messages.filter(message => message.text === 'Keep waiting')).toHaveLength(2);
    expect(result.current.input).toBe('');
  });

  it('restores Current availability after an uncertain acknowledgement failure without replaying or clearing its draft', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    const steer = jest.fn(() => acknowledgement.promise);
    Object.assign(adapter, { steer });
    const { result } = renderHook(() => useChatController({ adapter, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Keep waiting');
    });
    act(() => result.current.onSteer('active'));
    expect(result.current.canSteer).toBe(false);
    await act(async () => { acknowledgement.reject(new Error('timed out')); await acknowledgement.promise.catch(() => undefined); });
    expect(result.current.steeringPending).toBe(false);
    expect(result.current.canSteer).toBe(true);
    expect(result.current.input).toBe('Keep waiting');
    expect(result.current.sendFailure).toContain('Sending failed');
    expect(historyMock.messages.some(message => message.text === 'Keep waiting')).toBe(false);
    expect(steer).toHaveBeenCalledTimes(1);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it.each(['session', 'adapter'] as const)('does not let a pending Current acknowledgement modify the later %s draft', async change => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    Object.assign(adapter, { steer: jest.fn(() => acknowledgement.promise) });
    let activeAdapter = adapter;
    const { result, rerender } = renderHook(() => useChatController({ adapter: activeAdapter, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('First guidance');
    });
    act(() => result.current.onSteer('active'));
    await act(async () => {
      if (change === 'session') historyMock.sessionKey = 'other-session';
      else activeAdapter = createAdapter('ready', 'codex');
      historyMock.messages = [{ id: 'other-user', role: 'user', text: 'Other conversation' }];
      rerender({});
      result.current.setInput('Other draft');
    });
    await act(async () => { acknowledgement.resolve(); await acknowledgement.promise; });
    expect(result.current.input).toBe('Other draft');
    expect(historyMock.messages.map(message => message.text)).toEqual(['Other conversation']);
    expect(result.current.steeringPending).toBe(false);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('keeps explicit Next and Stop available while a Current acknowledgement is pending', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    const steer = jest.fn(() => acknowledgement.promise);
    Object.assign(adapter, { steer });
    const { result } = renderHook(() => useChatController({ adapter, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('First guidance');
    });
    act(() => result.current.onSteer('active'));
    await act(async () => { result.current.setInput('Next task'); });
    await act(async () => { result.current.onSend(); });
    expect(result.current.queuedMessages.map(message => message.text)).toEqual(['Next task']);
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(result.current.steeringPending).toBe(true);
    act(() => result.current.abortCurrentRun());
    expect(adapter.cancel).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledTimes(1);
    await act(async () => { acknowledgement.resolve(); await acknowledgement.promise; });
  });

  it('retires Reset run presentation while retaining the draft, attachments and held queue without sending', async () => {
    const adapter = { ...createAdapter(), resetSession: jest.fn().mockResolvedValue(undefined) };
    const removeCache = jest.spyOn(ChatCacheService, 'deleteMessages').mockResolvedValue(undefined);
    const { result, rerender, unmount } = renderHook(() => useChatController({ adapter, debugMode: false }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const events = () => jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => { events().onState!('ready'); await Promise.resolve(); });
    act(() => { events().onUpdate!({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'old-run', activeRunId: 'old-run', isSending: true, startedAtMs: Date.now() }); });
    act(() => { events().onUpdate!({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'old-run', activeRunId: 'old-run', isSending: true, text: 'old streamed reply', visible: true }); });
    expect(result.current.isSending).toBe(true);
    act(() => { result.current.setInput('queued unsent'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    expect(result.current.queuedMessages).toHaveLength(1);
    act(() => { result.current.setInput('current draft'); });
    imagePickerHookMock.pendingImages = [{ uri: 'local-image', base64: 'image-bytes', mimeType: 'image/png' }];
    rerender({});
    imagePickerHookMock.clearPendingImages.mockClear();
    await act(async () => { await resetSessionHistory(adapter as any, 'main', 'agent:main:main'); });
    expect(result.current.isSending).toBe(false);
    expect(result.current.activeRunId).toBeNull();
    expect(result.current.listData.some(message => message.text === 'old streamed reply')).toBe(false);
    expect(result.current.input).toBe('current draft');
    expect(result.current.pendingImages).toBe(imagePickerHookMock.pendingImages);
    expect(result.current.queuedMessages).toHaveLength(1);
    expect(result.current.listData.find(message => message.text === 'queued unsent')?.delivery).toBe('held');
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(imagePickerHookMock.clearPendingImages).not.toHaveBeenCalled();
    unmount(); removeCache.mockRestore();
  });

  it('rejects a late Reset ACK after same-batch away/back using the real history scope token', async () => {
    const actualHistory = jest.requireActual('./useChatHistoryState').useChatHistoryState;
    let state: any;
    jest.mocked(useChatHistoryState).mockImplementation(options => {
      state = actualHistory(options);
      return state;
    });
    const ack = deferred<void>();
    const adapter = { ...createAdapter(), resetSession: jest.fn(() => ack.promise) };
    const removeCache = jest.spyOn(ChatCacheService, 'deleteMessages').mockResolvedValue(undefined);
    const key = 'agent:main:main';
    const { result, unmount } = renderHook(() => useChatController({ adapter, routeSessionKey: key, debugMode: false }));
    const events = () => jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => { events().onState!('ready'); await Promise.resolve(); await Promise.resolve(); });
    let reset!: Promise<void>;
    act(() => { reset = resetSessionHistory(adapter as any, 'main', key); });
    act(() => { state.setSessionKey('another'); state.setSessionKey(key); });
    act(() => { events().onUpdate!({ type: 'run_started', sessionKey: key, runId: 'new-run', activeRunId: 'new-run', isSending: true, startedAtMs: Date.now() }); });
    act(() => { result.current.setInput('new scope draft'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    expect(result.current.queuedMessages).toHaveLength(1);
    expect(result.current.listData.find(message => message.text === 'new scope draft')?.delivery).toBe('queued');
    act(() => { result.current.setInput('current draft'); });
    await act(async () => { ack.resolve(); await reset; });
    expect(result.current.activeRunId).toBe('new-run');
    expect(result.current.isSending).toBe(true);
    expect(result.current.input).toBe('current draft');
    expect(result.current.listData.find(message => message.text === 'new scope draft')?.delivery).toBe('queued');
    expect(adapter.prompt).not.toHaveBeenCalled();
    unmount(); removeCache.mockRestore();
    jest.mocked(useChatHistoryState).mockImplementation(() => historyMock as any);
  });

  it('retires history and controller together after successful Reset ACK using the real scope token', async () => {
    const actualHistory = jest.requireActual('./useChatHistoryState').useChatHistoryState;
    let state: any;
    jest.mocked(useChatHistoryState).mockImplementation(options => {
      state = actualHistory(options);
      return state;
    });
    const ack = deferred<void>();
    const adapter = { ...createAdapter(), resetSession: jest.fn(() => ack.promise) };
    const removeCache = jest.spyOn(ChatCacheService, 'deleteMessages').mockResolvedValue(undefined);
    const key = 'agent:main:main';
    const { result, unmount } = renderHook(() => useChatController({ adapter, routeSessionKey: key, debugMode: false }));
    const events = () => jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => { events().onState!('ready'); await Promise.resolve(); await Promise.resolve(); });
    let reset!: Promise<void>;
    act(() => { reset = resetSessionHistory(adapter as any, 'main', key); });
    act(() => { events().onUpdate!({ type: 'run_started', sessionKey: key, runId: 'new-run', activeRunId: 'new-run', isSending: true, startedAtMs: Date.now() }); });
    act(() => { result.current.setInput('new scope draft'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    expect(result.current.queuedMessages).toHaveLength(1);
    expect(result.current.listData.find(message => message.text === 'new scope draft')?.delivery).toBe('queued');
    act(() => { result.current.setInput('current draft'); });
    await act(async () => { ack.resolve(); await reset; });
    expect(result.current.activeRunId).toBeNull();
    expect(result.current.isSending).toBe(false);
    expect(result.current.input).toBe('current draft');
    expect(result.current.listData.find(message => message.text === 'new scope draft')?.delivery).toBe('held');
    expect(adapter.prompt).not.toHaveBeenCalled();
    unmount(); removeCache.mockRestore();
    jest.mocked(useChatHistoryState).mockImplementation(() => historyMock as any);
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

  it.each([false, true])('only uses historical thinking as a fallback without native runtime settings (runtime settings: %s)', (hasRuntimeSettings) => {
    historyMock.thinkingLevel = 'high';
    modelPickerHookMock.hasRuntimeSettings = hasRuntimeSettings;
    const adapter = createAdapter();
    const { result, rerender } = renderHook(() => useChatController({
      adapter, debugMode: false, showAgentAvatar: true,
    }));
    expect(result.current.thinkingLevel).toBe(hasRuntimeSettings ? null : 'high');
    modelPickerHookMock.nativeThinkingLevel = 'low';
    rerender({});
    expect(result.current.thinkingLevel).toBe('low');
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

  it.each([false, true])('holds an explicitly rejected permission send for review without uncertainty or replay (new draft: %s)', async (hasNewDraft) => {
    const adapter = createAdapter('ready', 'codex');
    adapter.capabilities.sessionPermissions = true;
    let rejectSend!: (error: Error) => void;
    adapter.prompt.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    await act(async () => { result.current.setInput('Original permission draft'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    if (hasNewDraft) await act(async () => { result.current.setInput('New draft'); });
    await act(async () => {
      rejectSend(new AdapterError('server', 'Fixed native permission rejection', 'confirm_permissions'));
      await Promise.resolve();
    });
    expect(modelPickerHookMock.requirePermissionsConfirmation).toHaveBeenCalledWith(adapter, 'agent:main:main');
    expect(result.current.input).toBe(hasNewDraft ? 'New draft' : '');
    expect(result.current.listData.filter(message => message.text === 'Original permission draft')).toHaveLength(1);
    expect(result.current.listData.find(message => message.text === 'Original permission draft')).toMatchObject({ delivery: 'held' });
    expect(result.current.listData.some(message => message.sendUncertain)).toBe(false);
    expect(result.current.sendFailure).toBeNull();
    expect(result.current.sendFailureDetails).toBeNull();
    expect(result.current.isSending).toBe(false);
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Codex did not restore the conversation permissions. Select and confirm permissions before sending.',
    'The previous conversation permissions cannot be verified safely. Select and confirm permissions before sending.',
  ])('keeps an immediate permission rejection paused after local submission settles (%s)', async message => {
    const adapter = createAdapter('ready', 'codex');
    adapter.capabilities.sessionPermissions = true;
    adapter.prompt.mockRejectedValue(new AdapterError('server', message, 'confirm_permissions'));
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    await act(async () => { result.current.setInput('Keep this input'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    expect(result.current.listData.filter(message => message.text === 'Keep this input')).toHaveLength(1);
    expect(result.current.listData.find(message => message.text === 'Keep this input')).toMatchObject({ delivery: 'held' });
    expect(result.current.listData.some(message => message.sendUncertain)).toBe(false);
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Codex did not restore the conversation permissions. Select and confirm permissions before sending.',
    'The previous conversation permissions cannot be verified safely. Select and confirm permissions before sending.',
  ])('retains the ordinary uncertain send path when a server error has the permission text without a classified recovery (%s)', async message => {
    const adapter = createAdapter('ready', 'codex');
    adapter.capabilities.sessionPermissions = true;
    adapter.prompt.mockRejectedValue(new AdapterError('server', message));
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    await act(async () => { result.current.setInput('Unknown result'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    expect(modelPickerHookMock.requirePermissionsConfirmation).not.toHaveBeenCalled();
    expect(result.current.listData.find(message => message.text === 'Unknown result')?.sendUncertain).toBe(true);
    expect(result.current.listData.find(message => message.text === 'Unknown result')?.delivery).not.toBe('held');
    expect(result.current.sendFailure).toBe('Sending failed. Check the conversation before trying again.');
  });

  it('keeps a late explicit rejection in the original held outbox without changing a different session draft', async () => {
    const adapter = createAdapter('ready', 'codex');
    adapter.capabilities.sessionPermissions = true;
    modelPickerHookMock.requirePermissionsConfirmation.mockImplementationOnce(() => {});
    let rejectSend!: (error: Error) => void;
    adapter.prompt.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    await act(async () => { result.current.setInput('Original permission draft'); });
    await act(async () => { result.current.onSend(); await Promise.resolve(); });
    historyMock.sessionKey = 'agent:main:other'; historyMock.messages = []; rerender(undefined);
    await act(async () => { result.current.setInput('Other draft'); });
    await act(async () => { rejectSend(new AdapterError('server', 'Fixed native permission rejection', 'confirm_permissions')); await Promise.resolve(); });
    expect(result.current.input).toBe('Other draft');
    expect(result.current.listData.some(message => message.text === 'Original permission draft')).toBe(false);
    historyMock.sessionKey = 'agent:main:main'; rerender(undefined);
    expect(result.current.listData.filter(message => message.text === 'Original permission draft')).toHaveLength(1);
    expect(result.current.listData.find(message => message.text === 'Original permission draft')).toMatchObject({ delivery: 'held' });
    expect(result.current.listData.some(message => message.sendUncertain)).toBe(false);
    expect(adapter.prompt).toHaveBeenCalledTimes(1);
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

  it('ends a reply watched live with Success, a failed one with Warning, and stays still out of view', async () => {
    const ExpoHaptics = jest.requireMock('expo-haptics') as { notificationAsync: jest.Mock };
    const { useIsFocused } = jest.requireMock('@react-navigation/native') as { useIsFocused: jest.Mock };
    const run = async (runId: string, stopReason: 'end_turn' | 'error') => {
      const adapter = createAdapter('ready');
      const view = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
      const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
      await act(async () => {
        eventParams!.onState?.('ready');
        eventParams!.onUpdate?.({ type: 'run_started', sessionKey: 'agent:main:main', runId, activeRunId: runId, isSending: true, startedAtMs: 100 });
        // OpenClaw reports a failed run twice: as an error, then as a finished run.
        if (stopReason === 'error') {
          eventParams!.onUpdate?.({
            type: 'error', sessionKey: 'agent:main:main', runId, code: 'server', errorMessage: 'Backend failed',
            message: { id: `error_${runId}`, role: 'system', text: 'Backend failed' },
          });
        }
        eventParams!.onUpdate?.({
          type: 'run_finished', sessionKey: 'agent:main:main', runId, stopReason, activeRunId: null, isSending: false,
          finalMessage: { id: `final_${runId}`, role: 'assistant', text: 'Done', timestampMs: 300 },
        });
        await Promise.resolve();
      });
      view.unmount();
    };

    ExpoHaptics.notificationAsync.mockClear();
    await run('run-ok', 'end_turn');
    expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith('success');
    ExpoHaptics.notificationAsync.mockClear();
    await run('run-failed', 'error');
    expect(ExpoHaptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith('warning');
    ExpoHaptics.notificationAsync.mockClear();
    useIsFocused.mockReturnValue(false);
    try {
      await run('run-unseen', 'end_turn');
    } finally {
      useIsFocused.mockReturnValue(true);
    }
    expect(ExpoHaptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('keeps reported unknown tool updates uncompleted without scheduling settled recovery', async () => {
    const adapter = createAdapter('ready');
    const view = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    const run = { sessionKey: 'agent:main:main', runId: 'run-unknown', activeRunId: 'run-unknown', isSending: true as const };
    await act(async () => {
      events!.onState?.('ready');
      events!.onUpdate?.({ type: 'run_started', ...run, startedAtMs: 100 });
      events!.onUpdate?.({ type: 'tool_call', ...run, toolCallId: 'read', merge: false, message: {
        id: 'toolcall_read', role: 'tool', text: '', toolName: 'read', toolStatus: 'running', toolStartedAt: 100,
      } });
    });
    expect(view.result.current.activityLabel).toBe('Reading file');
    historyMock.loadHistory.mockClear();
    historyMock.refreshCurrentSessionHistory.mockClear();
    historyMock.reconcileLatestAssistantFromHistory.mockClear();
    await act(async () => {
      events!.onUpdate?.({ type: 'tool_call_update', ...run, toolCallId: 'read', merge: true, message: {
        id: 'toolcall_read', role: 'tool', text: '', toolStatus: 'unknown', toolStatusReported: true, toolFinishedAt: undefined,
      } });
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(view.result.current.isSending).toBe(true);
    expect(view.result.current.activityLabel).toBeNull();
    expect(historyMock.loadHistory).not.toHaveBeenCalled();
    expect(historyMock.refreshCurrentSessionHistory).not.toHaveBeenCalled();
    expect(historyMock.reconcileLatestAssistantFromHistory).not.toHaveBeenCalled();
    view.unmount();
  });

  it('stops labelling the turn with a tool once that tool settles', async () => {
    const adapter = createAdapter('ready');
    const { result } = renderHook(() =>
      useChatController({
        adapter: adapter as any,
        debugMode: false,
        showAgentAvatar: true,
      } as any),
    );
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    const tool = (id: string, toolName: string) => ({
      type: 'tool_call' as const,
      sessionKey: 'agent:main:main',
      runId: 'run-settle',
      toolCallId: id,
      activeRunId: 'run-settle',
      isSending: true as const,
      merge: false as const,
      message: { id: `toolcall_${id}`, role: 'tool' as const, text: '', toolName, toolStatus: 'running' as const },
    });
    const settle = (id: string) => ({
      type: 'tool_call_update' as const,
      sessionKey: 'agent:main:main',
      runId: 'run-settle',
      toolCallId: id,
      activeRunId: 'run-settle',
      isSending: true as const,
      merge: true as const,
      message: { id: `toolcall_${id}`, role: 'tool' as const, text: '', toolStatus: 'success' as const, toolFinishedAt: 200 },
    });

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onUpdate?.({
        type: 'run_started',
        sessionKey: 'agent:main:main',
        runId: 'run-settle',
        activeRunId: 'run-settle',
        isSending: true,
        startedAtMs: 100,
      });
      eventParams!.onUpdate?.(tool('read-1', 'read'));
      eventParams!.onUpdate?.(tool('exec-1', 'exec'));
    });
    expect(result.current.activityLabel).toBe('Running command');

    await act(async () => { eventParams!.onUpdate?.(settle('exec-1')); });
    expect(result.current.activityLabel).toBe('Reading file');

    await act(async () => { eventParams!.onUpdate?.(settle('read-1')); });
    expect(result.current.isSending).toBe(true);
    expect(result.current.activityLabel).toBeNull();
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
    // History never carries approval cards: the answered one stays beside the reconciled rows.
    expect(historyMock.messages).toEqual([
      expect.objectContaining({ id: 'approval_approval-1', approval: expect.objectContaining({ status: 'allowed' }) }),
      expect.objectContaining({ id: 'history-assistant', text: 'Reconciled answer' }),
    ]);
    expect(historyMock.setHistoryLoaded).toHaveBeenCalledWith(true);
    expect(historyMock.setHasMoreHistory).toHaveBeenCalledWith(true);
  });

  it('keeps the step times this phone measured when reconciled history has none', async () => {
    const adapter = createAdapter('ready');
    renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    historyMock.sessionKey = 'agent:main:main';
    const run = { sessionKey: 'agent:main:main', runId: 'run-7', activeRunId: 'run-7', isSending: true as const };

    await act(async () => {
      eventParams!.onState?.('ready');
      eventParams!.onUpdate?.({ type: 'run_started', ...run, startedAtMs: 9_000 });
      eventParams!.onUpdate?.({ type: 'tool_call', ...run, toolCallId: 'call-7', merge: false, message: {
        id: 'toolcall_call-7', role: 'tool', text: '', toolName: 'bash', toolStatus: 'running', toolStartedAt: 10_000,
      } });
      eventParams!.onUpdate?.({ type: 'tool_call_update', ...run, toolCallId: 'call-7', merge: true, message: {
        id: 'toolcall_call-7', role: 'tool', text: '', toolStatus: 'success', toolFinishedAt: 16_000,
      } });
      await Promise.resolve();
    });
    // Pi history names the call `toolresult_<id>` and stamps it only with the record's own clock.
    await act(async () => {
      eventParams!.onUpdate?.({
        type: 'history_reconciled',
        sessionKey: 'agent:main:main',
        history: { key: 'agent:main:main', hasActiveRun: false, messages: [] },
        messages: [{ id: 'toolresult_call-7', role: 'tool', text: '', toolName: 'bash', toolStatus: 'success', toolFinishedAt: 7_000 }],
        hasActiveRun: false,
      });
    });

    expect(historyMock.messages).toEqual([expect.objectContaining({
      id: 'toolresult_call-7', toolStartedAt: 10_000, toolFinishedAt: 16_000, toolDurationMs: 6_000,
    })]);
  });

  it('delegates a reconciled paged head to the history window without discarding loaded older rows', async () => {
    const adapter = createAdapter('ready');
    renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const eventParams = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)?.[0];
    historyMock.applyReconciledHistory.mockReturnValue(true);
    historyMock.setMessages.mockClear(); historyMock.setHasMoreHistory.mockClear();
    const head = { key: 'agent:main:main', messages: [], hasActiveRun: false };
    await act(async () => { eventParams!.onUpdate?.({ type: 'history_reconciled', sessionKey: 'agent:main:main',
      history: head, messages: [], nextCursor: 'older', hasActiveRun: false }); });
    expect(historyMock.applyReconciledHistory).toHaveBeenCalledWith({ ...head, nextCursor: 'older' });
    expect(historyMock.setHasMoreHistory).not.toHaveBeenCalled();
    expect(historyMock.setMessages).not.toHaveBeenCalled();
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

  it.each([false, true])('does not append a late steering acknowledgement after its canonical echo or a newer turn (%s)', async nextTurn => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    const steer = jest.fn(() => acknowledgement.promise);
    Object.assign(adapter, { steer });
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    const timestampMs = Date.now() - 120_000;
    const initial = [{ id: 'native-prompt', historyMessageId: 'native-prompt', role: 'user', text: 'Initial task', timestampMs }];
    historyMock.messages = initial;
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: timestampMs });
      result.current.setInput('Change course');
    });
    act(() => result.current.onSteer('active'));
    expect(steer).toHaveBeenCalledWith('agent:main:main', 'active', 'Change course');
    // Native input is committed and a tool-result/history read wins the RPC response race.
    const canonical = [...initial, { id: 'native-steer', historyMessageId: 'native-steer', role: 'user', text: 'Change course', timestampMs }];
    await act(async () => {
      historyMock.messages = canonical;
      if (nextTurn) {
        events.onUpdate?.({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'active', activeRunId: null, isSending: false,
          stopReason: 'end_turn', finalMessage: { id: 'native-final', role: 'assistant', text: 'Done', timestampMs: timestampMs + 1000 } });
        historyMock.messages.push({ id: 'native-next-user', historyMessageId: 'native-next-user', role: 'user', text: 'Next task', timestampMs: Date.now() });
        events.onUpdate?.({ type: 'run_started', runId: 'next', sessionKey: 'agent:main:main', activeRunId: 'next', isSending: true, startedAtMs: Date.now() });
      }
      rerender({});
      acknowledgement.resolve();
      await acknowledgement.promise;
    });
    expect(historyMock.messages.filter(message => message.text === 'Change course')).toHaveLength(1);
    expect(historyMock.messages.find(message => message.text === 'Change course')?.historyMessageId).toBe('native-steer');
    if (nextTurn) expect(historyMock.messages.at(-1).text).toBe('Next task');
    // A further canonical reload must not preserve a duplicate as an unrelated older user.
    const next = nextTurn ? [...canonical, ...historyMock.messages.filter(message => message.id === 'native-final' || message.id === 'native-next-user')] : canonical;
    expect(preserveOptimisticAssistantMessage(historyMock.messages, next).filter(message => message.text === 'Change course')).toHaveLength(1);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('places accepted steering before a later turn when its canonical echo has not reached the phone', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    Object.assign(adapter, { steer: jest.fn(() => acknowledgement.promise) });
    const initial = [{ id: 'native-prompt', historyMessageId: 'native-prompt', role: 'user', text: 'Initial task' }];
    historyMock.messages = initial;
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Change course');
    });
    const dispatchedAt = Date.now();
    act(() => result.current.onSteer('active'));
    await act(async () => {
      events.onUpdate?.({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'active', activeRunId: null, isSending: false,
        stopReason: 'end_turn', finalMessage: { id: 'native-final', role: 'assistant', text: 'Done' } });
      historyMock.messages.push({ id: 'native-next-user', historyMessageId: 'native-next-user', idempotencyKey: 'next-send', role: 'user', text: 'Next task' });
      events.onUpdate?.({ type: 'run_started', runId: 'next', sessionKey: 'agent:main:main', activeRunId: 'next', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('New draft');
      rerender({});
      jest.advanceTimersByTime(250);
      acknowledgement.resolve();
      await acknowledgement.promise;
    });
    expect(historyMock.messages.map(message => message.text)).toEqual(['Initial task', 'Change course', 'Done', 'Next task']);
    expect(historyMock.messages[1].timestampMs).toBe(dispatchedAt);
    expect(result.current.acceptedSubmission).toBeNull();
    expect(result.current.input).toBe('New draft');
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('recognizes a canonical steering echo from the actual adapter recovery mapper without a history alias', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    Object.assign(adapter, { steer: jest.fn(() => acknowledgement.promise) });
    historyMock.messages = [{ id: 'native-prompt', role: 'user', text: 'Initial task', timestampMs: Date.now() - 120_000 }];
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() - 120_000 });
      result.current.setInput('Change course');
    });
    act(() => result.current.onSteer('active'));
    const { mapAdapterSessionUpdate } = jest.requireActual<typeof import('./useAdapterChatEvents')>('./useAdapterChatEvents');
    await act(async () => {
      events.onUpdate?.(mapAdapterSessionUpdate({ type: 'history_reconciled', sessionKey: 'agent:main:main', history: {
        key: 'agent:main:main', hasActiveRun: true, messages: [
          { id: 'native-prompt', role: 'user', text: 'Initial task', timestampMs: Date.now() - 120_000 },
          { id: 'native-steer', role: 'user', text: 'Change course', timestampMs: Date.now() - 120_000 },
        ],
      } }));
      acknowledgement.resolve();
      await acknowledgement.promise;
    });
    const guide = historyMock.messages.filter(message => message.text === 'Change course');
    expect(guide).toHaveLength(1);
    expect(guide[0].id).toBe('native-steer');
    expect(guide[0].historyMessageId).toBeUndefined();
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('keeps two intentional same-clock steering submissions distinct until their native echoes arrive', async () => {
    const adapter = createAdapter('ready', 'codex');
    Object.assign(adapter, { steer: jest.fn().mockResolvedValue(undefined) });
    historyMock.messages = [{ id: 'native-prompt', historyMessageId: 'native-prompt', role: 'user', text: 'Initial task' }];
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
    });
    for (let index = 0; index < 2; index++) {
      await act(async () => { result.current.setInput('Change course'); rerender({}); });
      await act(async () => { result.current.onSteer('active'); await Promise.resolve(); });
    }
    const local = historyMock.messages.filter(message => message.text === 'Change course');
    expect(local).toHaveLength(2);
    expect(new Set(local.map(message => message.id)).size).toBe(2);
    expect((adapter as any).steer).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it.each([false, true])('reads post-acknowledgement history only while the send scope remains current (%s)', async retireScope => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    const staleRead = deferred<number>();
    Object.assign(adapter, { steer: jest.fn(() => acknowledgement.promise) });
    historyMock.loadHistory.mockReturnValueOnce(staleRead.promise);
    historyMock.messages = [{ id: 'native-prompt', historyMessageId: 'native-prompt', role: 'user', text: 'Initial task' }];
    let activeAdapter = adapter;
    const { result, rerender } = renderHook(() => useChatController({ adapter: activeAdapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Change course');
    });
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.onSteer('active'); acknowledgement.resolve(); await acknowledgement.promise; });
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);
    if (retireScope) await act(async () => { activeAdapter = createAdapter('ready', 'codex'); rerender(undefined); });
    await act(async () => { staleRead.resolve(0); await staleRead.promise; });
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(retireScope ? 1 : 2);
    expect(historyMock.loadHistory).toHaveBeenLastCalledWith('agent:main:main', 50);
  });

  it.each(['session', 'adapter'] as const)('ignores a late steering acknowledgement after the %s changes', async change => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    Object.assign(adapter, { steer: jest.fn(() => acknowledgement.promise) });
    let activeAdapter = adapter;
    const { result, rerender } = renderHook(() => useChatController({ adapter: activeAdapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Change course');
    });
    act(() => result.current.onSteer('active'));
    await act(async () => {
      if (change === 'session') historyMock.sessionKey = 'other-session';
      historyMock.messages = [{ id: 'other-user', role: 'user', text: 'Other conversation' }];
      if (change === 'adapter') activeAdapter = createAdapter('ready', 'codex');
      rerender(undefined);
      result.current.setInput('Other draft');
    });
    await act(async () => { acknowledgement.resolve(); await acknowledgement.promise; });
    expect(historyMock.messages.map(message => message.text)).toEqual(['Other conversation']);
    expect(result.current.input).toBe('Other draft');
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('coalesces two accepted steering reads that waited for the same stale history request', async () => {
    const adapter = createAdapter('ready', 'codex');
    const staleRead = deferred<number>();
    Object.assign(adapter, { steer: jest.fn().mockResolvedValue(undefined) });
    historyMock.loadHistory.mockReturnValueOnce(staleRead.promise);
    historyMock.messages = [{ id: 'native-prompt', historyMessageId: 'native-prompt', role: 'user', text: 'Initial task' }];
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
    });
    for (let index = 0; index < 2; index++) {
      await act(async () => { result.current.setInput(`Guidance ${index}`); rerender({}); });
      await act(async () => { result.current.onSteer('active'); await Promise.resolve(); });
    }
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(1);
    await act(async () => { staleRead.resolve(0); await staleRead.promise; });
    expect(historyMock.loadHistory).toHaveBeenCalledTimes(2);
    expect((adapter as any).steer).toHaveBeenCalledTimes(2);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('preserves the steering draft after uncertain acknowledgement failure without replay or an accepted row', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    Object.assign(adapter, { steer: jest.fn(() => acknowledgement.promise) });
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Change course');
    });
    await act(async () => { result.current.onSteer('active'); acknowledgement.reject(new Error('timed out')); await acknowledgement.promise.catch(() => undefined); });
    expect(result.current.input).toBe('Change course');
    expect(result.current.sendFailure).toContain('Sending failed');
    expect(historyMock.messages.some(message => message.text === 'Change course')).toBe(false);
    expect((adapter as any).steer).toHaveBeenCalledTimes(1);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes', 'pi'] as const)('preserves the existing steering capability and acceptance path for %s', async backend => {
    const adapter = createAdapter('ready', backend);
    Object.assign(adapter, { steer: jest.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true } as any));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', runId: 'active', sessionKey: 'agent:main:main', activeRunId: 'active', isSending: true, startedAtMs: Date.now() });
      result.current.setInput('Change course');
    });
    await act(async () => { result.current.onSteer('active'); await Promise.resolve(); });
    const supported = backend !== 'openclaw';
    expect(historyMock.messages.filter(message => message.text === 'Change course')).toHaveLength(supported ? 1 : 0);
    expect(result.current.input).toBe(supported ? '' : 'Change course');
    expect(result.current.acceptedSubmission?.text).toBe(supported ? 'Change course' : undefined);
    expect((adapter as any).steer).toHaveBeenCalledTimes(supported ? 1 : 0);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it.each(['text', 'tool'] as const)('keeps long Codex paragraph boundaries when %s arrives before reconnect history', async first => {
    const adapter = createAdapter('ready', 'codex');
    historyMock.messages = [{ id: 'main', role: 'user', text: 'Long task', turnId: 'native-turn' }];
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true }));
    const events = () => jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    const run = { sessionKey: 'agent:main:main', runId: 'run', activeRunId: 'run', isSending: true as const,
      turnId: 'native-turn', inputMessageId: 'main' };
    const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index}: checking the long task.`);
    const chunk = (count: number) => events().onUpdate?.({ type: 'agent_message_chunk', ...run,
      visible: true, textMode: 'snapshot', text: paragraphs.slice(0, count).join('\n\n') });
    const tool = (index: number) => events().onUpdate?.({ type: 'tool_call', ...run, toolCallId: `step-${index}`, merge: false,
      message: { id: `toolcall_step-${index}`, role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' } });
    await act(async () => {
      events().onState?.('ready');
      events().onUpdate?.({ type: 'run_started', ...run, startedAtMs: Date.now() });
      for (let count = 1; count <= 10; count++) { chunk(count); tool(count); }
      chunk(11);
    });
    const before = [...result.current.listData].reverse();
    expect(before.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(paragraphs.slice(0, 11));
    const keys = before.filter(row => row.role === 'assistant').map(row => row.renderKey ?? row.id);
    // The cache contains separately persisted native rows, as in the phone
    // screenshots. A pending head must not display them again in a rollup.
    historyMock.messages = before.map((row, index) => row.role === 'assistant'
      ? { ...row, id: `native-${index}`, renderKey: undefined, turnId: 'native-turn' } : row);
    const pendingHistory = deferred<void>();
    historyMock.loadSessionsAndHistory.mockReturnValueOnce(pendingHistory.promise);
    await act(async () => { events().onState?.('reconnecting'); });
    await act(async () => { events().onState?.('ready'); });
    await act(async () => { if (first === 'tool') tool(11); chunk(12); });
    const rows = [...result.current.listData].reverse();
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(first === 'tool'
      ? paragraphs : [...paragraphs.slice(0, 10), paragraphs.slice(10).join('\n\n')]);
    expect(rows.filter(row => row.role === 'assistant').slice(0, 10).map(row => row.renderKey ?? row.id)).toEqual(keys.slice(0, 10));
    expect(rows.filter(row => row.role === 'tool').map(row => row.id)).toEqual(Array.from({ length: first === 'tool' ? 11 : 10 }, (_, index) => `toolcall_step-${index + 1}`));
    await act(async () => { pendingHistory.resolve(); await pendingHistory.promise; });
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('extends native commentary boundaries without tools across successive history reads and completion', async () => {
    const adapter = createAdapter('ready', 'codex');
    const turnId = 'native-turn';
    const paragraphs = ['First update.', 'Second update.', 'Third update.', 'Final answer.'];
    const user = { id: 'main', role: 'user', text: 'Task', turnId };
    const native = (count: number) => [user, ...paragraphs.slice(0, count).map((text, index) => ({
      id: `native-${index}`, role: 'assistant', text, turnId, timestampMs: 1000 + index * 1000,
    }))];
    historyMock.messages = native(2);
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true }));
    const events = () => jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    const run = { sessionKey: 'agent:main:main', runId: 'run', activeRunId: 'run', isSending: true as const,
      turnId, inputMessageId: 'main' };
    await act(async () => {
      events().onState?.('ready');
      events().onUpdate?.({ type: 'run_started', ...run, startedAtMs: 1000 });
      events().onUpdate?.({ type: 'agent_message_chunk', ...run, visible: true, textMode: 'snapshot', text: paragraphs.slice(0, 2).join('\n\n') });
    });
    expect([...result.current.listData].reverse().filter(row => row.role === 'assistant').map(row => row.text)).toEqual(paragraphs.slice(0, 2));
    const initialKeys = [...result.current.listData].reverse().filter(row => row.role === 'assistant').map(row => row.renderKey ?? row.id);
    historyMock.messages = native(3); rerender({});
    await act(async () => {
      events().onUpdate?.({ type: 'agent_message_chunk', ...run, visible: true, textMode: 'snapshot', text: paragraphs.slice(0, 3).join('\n\n') });
      events().onUpdate?.({ type: 'tool_call', ...run, toolCallId: 'step', merge: false,
        message: { id: 'toolcall_step', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' } });
      events().onUpdate?.({ type: 'agent_message_chunk', ...run, visible: true, textMode: 'snapshot', text: paragraphs.join('\n\n') });
    });
    expect([...result.current.listData].reverse().filter(row => row.role === 'assistant').map(row => row.text)).toEqual(paragraphs);
    expect([...result.current.listData].reverse().filter(row => row.role === 'assistant').slice(0, 2).map(row => row.renderKey ?? row.id)).toEqual(initialKeys);
    await act(async () => {
      events().onUpdate?.({ type: 'run_finished', sessionKey: run.sessionKey, runId: run.runId, activeRunId: null,
        isSending: false, stopReason: 'end_turn', finalMessage: { id: 'final', role: 'assistant', text: paragraphs.join('\n\n') } });
    });
    expect(historyMock.messages.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(paragraphs);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('restores Codex rows after a session visit while consuming newer cumulative offscreen text', async () => {
    const adapter = createAdapter('ready', 'codex');
    historyMock.messages = [{ id: 'main', role: 'user', text: 'Task', turnId: 'turn' }];
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true }));
    const events = () => jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    const run = { sessionKey: 'agent:main:main', runId: 'run', activeRunId: 'run', isSending: true as const,
      turnId: 'turn', inputMessageId: 'main' };
    const chunk = (text: string) => events().onUpdate?.({ type: 'agent_message_chunk', ...run,
      visible: true, textMode: 'snapshot', text });
    await act(async () => {
      events().onState?.('ready');
      events().onUpdate?.({ type: 'run_started', ...run, startedAtMs: Date.now() });
      chunk('Before.');
      events().onUpdate?.({ type: 'tool_call', ...run, toolCallId: 'step', merge: false,
        message: { id: 'toolcall_step', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' } });
      chunk('Before.\n\nAfter.');
    });
    const original = [...result.current.listData].reverse();
    await act(async () => { result.current.switchSession({ key: 'other', kind: 'direct' } as any); });
    historyMock.messages = [{ id: 'other-user', role: 'user', text: 'Other task' }]; rerender({});
    expect(result.current.listData.some(row => row.text === 'Before.')).toBe(false);
    await act(async () => { chunk('Before.\n\nAfter. More text.'); });
    await act(async () => { result.current.switchSession({ key: run.sessionKey, kind: 'direct' } as any); });
    historyMock.messages = [original[0]]; rerender({});
    const restored = [...result.current.listData].reverse();
    expect(restored.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['Before.', 'After. More text.']);
    expect(restored.find(row => row.text === 'Before.')?.renderKey).toBe(original.find(row => row.text === 'Before.')?.renderKey);
    expect(restored.filter(row => row.role === 'tool').map(row => row.id)).toEqual(['toolcall_step']);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('recovers a cold active Codex transcript across two same-turn user guides', async () => {
    const adapter = createAdapter('ready', 'codex');
    historyMock.messages = [{ id: 'main', role: 'user', text: 'Task', turnId: 'native-turn' },
      { id: 'a', role: 'assistant', text: 'First paragraph.', turnId: 'native-turn', timestampMs: 1000 },
      { id: 'toolcall_1', role: 'tool', text: '', toolName: 'exec', turnId: 'native-turn', toolStatus: 'success' },
      { id: 'guide1', role: 'user', text: 'Same guide', turnId: 'native-turn' },
      { id: 'b', role: 'assistant', text: 'Second paragraph.', turnId: 'native-turn', timestampMs: 2000 },
      { id: 'toolcall_2', role: 'tool', text: '', toolName: 'exec', turnId: 'native-turn', toolStatus: 'running' },
      { id: 'guide2', role: 'user', text: 'Same guide', turnId: 'native-turn' },
      { id: 'c', role: 'assistant', text: 'Live tail.', turnId: 'native-turn', timestampMs: 3000 }];
    historyMock.activitySnapshot = { key: 'agent:main:main', hasActiveRun: true, requestedAtMs: Date.now(), messages: [],
      activeRun: { runId: 'run', text: 'First paragraph.\n\nSecond paragraph.\n\nLive tail.',
        startedAtMs: 1000, turnId: 'native-turn', inputMessageId: 'main' } } as any;
    const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true }));
    await act(async () => { await Promise.resolve(); });
    const rows = [...result.current.listData].reverse();
    expect(rows.filter(row => row.role === 'user').map(row => row.id)).toEqual(['main', 'guide1', 'guide2']);
    expect(rows.filter(row => row.role === 'tool').map(row => row.id)).toEqual(['toolcall_1', 'toolcall_2']);
    expect(rows.filter(row => row.role === 'assistant').map(row => row.text)).toEqual(['First paragraph.', 'Second paragraph.', 'Live tail.']);
    expect(new Set(rows.map(row => row.renderKey ?? row.id)).size).toBe(rows.length);
    expect(result.current.runWorkIdentity).toMatchObject({ sessionKey: 'agent:main:main', runId: 'run', turnId: 'native-turn', inputMessageId: 'main', startedAt: 1000 });
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    await act(async () => { events.onUpdate?.({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'run', activeRunId: null, isSending: false, stopReason: 'end_turn', finalMessage: { id: 'final', role: 'assistant', text: 'Live tail.' } }); });
    expect(result.current.runWorkIdentity).toBeUndefined();
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('keeps a live Codex run intact when its native anchor arrives after tools and stamps a delayed guide with the captured turn', async () => {
    const adapter = createAdapter('ready', 'codex');
    const acknowledgement = deferred<void>();
    const steer = jest.fn(() => acknowledgement.promise);
    Object.assign(adapter, { steer, capabilities: { ...adapter.capabilities, steer: true } });
    historyMock.messages = [{ id: 'main', role: 'user', text: 'Main task', idempotencyKey: 'original-key' }];
    const { result, rerender } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true }));
    const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
    const run = { sessionKey: 'agent:main:main', runId: 'run', activeRunId: 'run', isSending: true as const };
    await act(async () => {
      events.onState?.('ready');
      events.onUpdate?.({ type: 'run_started', ...run, startedAtMs: 1000 });
      events.onUpdate?.({ type: 'agent_message_chunk', ...run, visible: true, textMode: 'snapshot', text: 'Before the tool.' });
      events.onUpdate?.({ type: 'tool_call', ...run, toolCallId: 'tool', merge: false,
        message: { id: 'toolcall_tool', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' } });
      events.onUpdate?.({ type: 'run_started', ...run, startedAtMs: 2000, turnId: 'native-turn', inputMessageId: 'native-input', inputMessageKey: 'original-key' });
      events.onUpdate?.({ type: 'agent_message_chunk', ...run, visible: true, textMode: 'snapshot', text: 'Before the tool.\n\nAfter the tool.' });
      result.current.setInput('Same guide');
    });
    await act(async () => { result.current.onSteer('run'); });
    expect(steer).toHaveBeenCalledTimes(1);
    expect(result.current.listData.filter(row => row.id === 'toolcall_tool')).toHaveLength(1);
    expect(result.current.listData.filter(row => row.text === 'Before the tool.')).toHaveLength(1);
    await act(async () => { acknowledgement.resolve(); await acknowledgement.promise; });
    expect(historyMock.messages.find(row => row.text === 'Same guide')).toMatchObject({ role: 'user', turnId: 'native-turn' });
    // A same-run snapshot from an older Bridge lacks additive metadata. It
    // cannot erase the already proven native anchor or reset the accumulated body.
    historyMock.activitySnapshot = { key: 'agent:main:main', hasActiveRun: true,
      requestedAtMs: Date.now() + 1, messages: [], activeRun: { runId: 'run', text: 'Before the tool.\n\nAfter the tool.', startedAtMs: 1000 } } as any;
    rerender({});
    await act(async () => { await Promise.resolve(); });
    expect(result.current.listData.filter(row => row.id === 'toolcall_tool')).toHaveLength(1);
    expect(result.current.listData.filter(row => row.text === 'Before the tool.')).toHaveLength(1);
    expect(result.current.listData.filter(row => row.text === 'Same guide')).toHaveLength(1);
    expect(adapter.prompt).not.toHaveBeenCalled();
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

it('reconciles actual aborted controller output after ACK-first guidance and a late canonical head', async () => {
  const runAt = Date.UTC(2026, 9, 5, 0, 0, 0);
  jest.setSystemTime(runAt);
  const adapter = createAdapter('ready', 'codex');
  const acknowledgement = deferred<void>();
  const steer = jest.fn(() => acknowledgement.promise);
  Object.assign(adapter, { steer, capabilities: { ...adapter.capabilities, steer: true } });
  const { mapAdapterSessionUpdate } = jest.requireActual<typeof import('./useAdapterChatEvents')>('./useAdapterChatEvents');
  const realPresentation = jest.requireActual<typeof import('./liveRunThread')>('./liveRunThread');
  const finishSpy = jest.spyOn(realPresentation, 'finishLiveRunPresentation'); // calls actual implementation
  const key = 'agent:main:main', runId = 'aborted-run', turnId = 'native-turn';
  const main = { id: 'native-main', role: 'user' as const, text: 'Synthetic main', turnId,
    idempotencyKey: 'main-send', timestampMs: runAt };
  historyMock.messages = [main];
  historyMock.applyReconciledHistory.mockReturnValue(false);
  const { result, rerender, unmount } = renderHook(() => useChatController({ adapter: adapter as any,
    debugMode: false, showAgentAvatar: true }));
  const events = jest.mocked(useAdapterChatEvents).mock.calls.at(-1)![0];
  const identity = { sessionKey: key, runId, turnId, inputMessageId: main.id, inputMessageKey: main.idempotencyKey };
  const receive = (update: any, at: number) => {
    jest.setSystemTime(at);
    events.onUpdate?.(mapAdapterSessionUpdate(update, { now: () => at }));
  };
  const s = 'Before tool.', a = 'Commentary A.', b = 'Commentary B.', guide = 'Synthetic guide';
  try {
    await act(async () => {
      events.onState?.('ready');
      receive({ type: 'run_started', ...identity }, runAt);
      receive({ type: 'agent_message_chunk', ...identity, textMode: 'snapshot', text: s, timestampMs: runAt + 1_000 }, runAt + 1_000);
      receive({ type: 'tool_call', ...identity, toolCallId: 'synthetic-tool', title: 'exec', status: 'running' }, runAt + 2_000);
      receive({ type: 'agent_message_chunk', ...identity, textMode: 'snapshot', text: s + '\n\n' + a,
        timestampMs: runAt + 10_000 }, runAt + 10_000);
    });
    const firstSegmentKey = result.current.listData.find(row => row.text === s)?.renderKey;
    expect(firstSegmentKey).toBeTruthy();
    expect(result.current.runWorkIdentity).toMatchObject({ runId, turnId, inputMessageId: main.id });
    await act(async () => { jest.setSystemTime(runAt + 20_000); result.current.setInput(guide); });
    act(() => result.current.onSteer(runId));
    expect(steer).toHaveBeenCalledTimes(1);
    // A new paragraph arrives while ACK is pending. It must never be cut at
    // ACK time merely because the local dispatch happened before this chunk.
    await act(async () => {
      receive({ type: 'agent_message_chunk', ...identity, textMode: 'snapshot', text: [s, a, b].join('\n\n'),
        timestampMs: runAt + 30_000 }, runAt + 30_000);
      acknowledgement.resolve();
      await acknowledgement.promise;
    });
    const accepted = historyMock.messages.find(row => row.role === 'user' && row.text === guide);
    expect(accepted).toMatchObject({ sentLocally: true, turnId, timestampMs: runAt + 20_000 });
    expect(accepted?.id).toMatch(/^usr_\d+_steer_aborted-run_/);
    const tailKey = result.current.listData.find(row => row.id === 'streaming')?.renderKey;
    expect(tailKey).toBeTruthy();
    // Actual mapping uses cancelled; Native turn abortion is not a new wire enum.
    await act(async () => {
      receive({ type: 'run_finished', sessionKey: key, runId, stopReason: 'cancelled' }, runAt + 40_000);
      rerender({});
    });
    expect(finishSpy).toHaveBeenLastCalledWith(expect.objectContaining({ runId, turnId, cancelled: true, tail: a + '\n\n' + b }));
    const produced = finishSpy.mock.results.at(-1)?.value as import('../types/chat').UiMessage[];
    expect(produced.find(row => row.id === 'abort_aborted-run')).toMatchObject({ role: 'assistant', text: a + '\n\n' + b,
      turnId, presentationRunId: runId, renderKey: tailKey });
    // The head has not arrived yet; retaining this unknown rollup is correct.
    expect(historyMock.messages.find(row => row.id === 'abort_aborted-run')?.turnId).toBe(turnId);
    expect(result.current.isSending).toBe(false);
    expect(result.current.runWorkIdentity).toBeUndefined();

    const canonical = [main,
      { id: 'native-s', role: 'assistant' as const, text: s, turnId, timestampMs: runAt + 1_000 },
      { id: 'toolcall_synthetic-tool', role: 'tool' as const, text: '', turnId, timestampMs: runAt + 2_000,
        tool: { name: 'exec', callId: 'synthetic-tool', status: 'success' as const } },
      { id: 'native-a', role: 'assistant' as const, text: a, turnId, timestampMs: runAt + 10_000 },
      { id: 'native-guide', role: 'user' as const, text: guide, turnId, timestampMs: runAt + 20_000 },
      { id: 'native-b', role: 'assistant' as const, text: b, turnId, timestampMs: runAt + 30_000 }];
    for (let pass = 0; pass < 2; pass++) {
      await act(async () => {
        receive({ type: 'history_reconciled', sessionKey: key, history: { key, hasActiveRun: false, messages: canonical } }, runAt + 41_000 + pass);
        rerender({});
      });
      const rows = historyMock.messages.filter(row => row.role !== 'system');
      expect(rows.map(row => row.text)).toEqual([main.text, s, '', a, guide, b]);
      expect(rows.filter(row => row.id === 'native-a')).toHaveLength(1);
      expect(rows.filter(row => row.id === 'native-b')).toHaveLength(1);
      expect(rows.some(row => row.id === 'abort_aborted-run')).toBe(false);
      // Local origin survives a confirmed native echo; it is not evidence
      // that this row still lacks canonical native identity.
      expect(rows.find(row => row.id === 'native-guide')).toMatchObject({ sentLocally: true, renderKey: accepted.renderKey });
      expect(rows.find(row => row.text === s)?.renderKey).toBe(firstSegmentKey);
      expect(rows.find(row => row.id === 'native-a')?.renderKey).toBe(tailKey);
      expect(new Set(rows.map(row => row.renderKey ?? row.id)).size).toBe(rows.length);
      expect(result.current.listData.filter(row => row.role === 'assistant').reverse().map(row => row.text)).toEqual([s, a, b]);
      expect(result.current.listData.some(row => row.id === 'streaming')).toBe(false);
    }
    expect(adapter.prompt).not.toHaveBeenCalled();
    expect(adapter.cancel).not.toHaveBeenCalled();
    expect(steer).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    finishSpy.mockRestore();
  }
});

});

it('puts external input in the chosen chat without switching to an empty main key', async () => {
  mockAppContext.mainSessionKey = '';
  mockAppContext.clearPendingChatInput.mockImplementationOnce(() => { mockAppContext.pendingChatInput = null; });
  mockAppContext.clearPendingMainSessionSwitch.mockImplementationOnce(() => { mockAppContext.pendingMainSessionSwitch = false; });
  mockAppContext.pendingChatInput = 'Review this';
  mockAppContext.pendingMainSessionSwitch = true;
  historyMock.sessionKey = 'chosen';
  historyMock.sessions = [{ key: 'chosen', kind: 'direct' as const }];
  const adapter = createAdapter('ready');
  const { result } = renderHook(() => useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: false } as any));
  await act(async () => { await Promise.resolve(); });
  expect(result.current.input).toBe('Review this');
  expect(historyMock.setSessionKey).not.toHaveBeenCalledWith('');
  expect(mockAppContext.clearPendingMainSessionSwitch).toHaveBeenCalled();
});

describe('mounted controller attachment scope', () => {
  const image = { uri: 'file:///qa-current.jpg', base64: 'YQ==', mimeType: 'image/jpeg', width: 10, height: 10 };
  const pasted = { uri: 'file:///qa-paste.png', fileName: 'qa-paste.png', fileSize: 1, type: 'image/png' };
  const library = jest.mocked(ImagePicker.launchImageLibraryAsync);
  const camera = jest.mocked(ImagePicker.launchCameraAsync);
  const permission = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
  const document = jest.mocked(DocumentPicker.getDocumentAsync);
  const readFile = jest.mocked(readFileAsBase64);
  let alert: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  function mount(backend: keyof typeof CAPABILITY_MATRIX = 'openclaw') {
    const adapter = createAdapter('ready', backend);
    const view = renderHook(({ key, selectedAdapter }: { key: string; selectedAdapter: any }) => useChatController({
      adapter: selectedAdapter,
      routeConnectionId: adapter.connection.id,
      routeAgentId: 'main',
      routeSessionKey: key,
      debugMode: false,
    }), { initialProps: { key: 'session-a', selectedAdapter: adapter } });
    return { adapter, view, switchTo: (key: string, selectedAdapter: any = adapter) => view.rerender({ key, selectedAdapter }) };
  }

  async function select(view: ReturnType<typeof mount>['view']) {
    library.mockResolvedValueOnce({ canceled: false, assets: [image] } as any);
    await act(async () => { await view.result.current.pickImage(); });
    expect(view.result.current.pendingImages).toEqual([image]);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetMessageQueueStore();
    resetMockState();
    mockActualImagePicker = true;
    library.mockReset(); camera.mockReset(); permission.mockReset(); document.mockReset(); readFile.mockReset();
    library.mockResolvedValue({ canceled: true, assets: null } as any);
    camera.mockResolvedValue({ canceled: false, assets: [image] } as any);
    permission.mockResolvedValue({ granted: true } as any);
    document.mockResolvedValue({ canceled: true, assets: null } as any);
    readFile.mockResolvedValue('YQ==');
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    mockActualImagePicker = false;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    alert.mockRestore();
    consoleError.mockRestore();
  });

  it.each(['openclaw', 'hermes', 'codex', 'pi', 'claude-code'] as const)('retires the selected tray on same-Agent %s A→B→A session changes', async backend => {
    const { adapter, view, switchTo } = mount(backend);
    await select(view);
    switchTo('session-b');
    expect(view.result.current.pendingImages).toEqual([]);
    expect(view.result.current.canAddMoreImages).toBe(true);
    switchTo('session-a');
    expect(view.result.current.pendingImages).toEqual([]);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('preserves the same logical scope through reconnect, a missing adapter and history reload', async () => {
    const { adapter, view, switchTo } = mount();
    await select(view);
    switchTo('session-a', { ...adapter, state: 'connecting' });
    expect(view.result.current.pendingImages).toEqual([image]);
    switchTo('session-a', null);
    expect(view.result.current.pendingImages).toEqual([image]);
    switchTo('session-a');
    await act(async () => { view.result.current.reloadSession({ key: 'session-a', kind: 'direct' }); });
    expect(view.result.current.pendingImages).toEqual([image]);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('rejects a library result from the first A visit after A→B→A, preserving the new A selection', async () => {
    const { adapter, view, switchTo } = mount();
    const late = deferred<any>(); library.mockReturnValueOnce(late.promise);
    let task!: Promise<void>;
    act(() => { task = view.result.current.pickImage(); });
    switchTo('session-b'); switchTo('session-a');
    await select(view);
    await act(async () => { late.resolve({ canceled: false, assets: [{ ...image, uri: 'file:///old-a.jpg' }] }); await task; });
    expect(view.result.current.pendingImages).toEqual([image]);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('rejects a recent-photo conversion from an earlier A visit', async () => {
    const { view, switchTo } = mount();
    const late = deferred<any>();
    jest.requireMock('expo-image-manipulator').manipulateAsync.mockReturnValueOnce(late.promise);
    let task!: Promise<void>;
    await act(async () => { task = view.result.current.attachLocalImages(['file:///old.heic']); });
    switchTo('session-b'); switchTo('session-a');
    await act(async () => { late.resolve({ ...image, uri: 'file:///old.jpg' }); await task; });
    expect(view.result.current.pendingImages).toEqual([]);
  });

  it('does not read a file selected after its conversation has departed', async () => {
    const { view, switchTo } = mount();
    const late = deferred<any>(); document.mockReturnValueOnce(late.promise);
    let task!: Promise<void>; act(() => { task = view.result.current.pickFile(); });
    switchTo('session-b');
    await act(async () => { late.resolve({ canceled: false, assets: [{ uri: 'file:///old.pdf', name: 'old.pdf', mimeType: 'application/pdf' }] }); await task; });
    expect(readFile).not.toHaveBeenCalled();
    expect(view.result.current.pendingImages).toEqual([]);
  });

  it('rejects a file read that completes after A→B→A', async () => {
    const { view, switchTo } = mount();
    const late = deferred<string>(); readFile.mockReturnValueOnce(late.promise);
    document.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///old.pdf', name: 'old.pdf', mimeType: 'application/pdf' }] } as any);
    let task!: Promise<void>; await act(async () => { task = view.result.current.pickFile(); });
    expect(readFile).toHaveBeenCalledTimes(1);
    switchTo('session-b'); switchTo('session-a');
    await act(async () => { late.resolve('YQ=='); await task; });
    expect(view.result.current.pendingImages).toEqual([]);
  });

  it('does not launch the camera after an old permission callback survives A→B→A', async () => {
    const { view, switchTo } = mount();
    const late = deferred<any>(); permission.mockReturnValueOnce(late.promise);
    let task!: Promise<void>; await act(async () => { task = view.result.current.takePhoto(); });
    expect(permission).toHaveBeenCalledTimes(1);
    switchTo('session-b'); switchTo('session-a');
    await act(async () => { late.resolve({ granted: true }); await task; });
    expect(camera).not.toHaveBeenCalled();
    expect(view.result.current.pendingImages).toEqual([]);
  });

  it('rejects an old camera result after A→B→A', async () => {
    const { view, switchTo } = mount();
    const late = deferred<any>(); camera.mockReturnValueOnce(late.promise);
    let task!: Promise<void>; await act(async () => { task = view.result.current.takePhoto(); });
    expect(camera).toHaveBeenCalledTimes(1);
    switchTo('session-b'); switchTo('session-a');
    await act(async () => { late.resolve({ canceled: false, assets: [image] }); await task; });
    expect(view.result.current.pendingImages).toEqual([]);
  });

  it('retires a native paste without poisoning the next scope capacity or reporting old failure', async () => {
    const { adapter, view, switchTo } = mount();
    const late = deferred<string>(); readFile.mockReturnValueOnce(late.promise);
    let task!: Promise<void>;
    await act(async () => { task = view.result.current.onPasteFiles([pasted, { ...pasted, type: 'unsupported/private' }]); });
    expect(readFile).toHaveBeenCalledTimes(1);
    switchTo('session-b'); switchTo('session-a');
    let currentPaste!: Promise<void>;
    await act(async () => { currentPaste = view.result.current.onPasteFiles(Array.from({ length: 6 }, (_, i) => ({ ...pasted, uri: `file:///new-${i}.png` }))); });
    const currentCountBeforeOldRead = view.result.current.pendingImages.length;
    await act(async () => { late.resolve('YQ=='); await Promise.all([task, currentPaste]); });
    expect(currentCountBeforeOldRead).toBe(6);
    expect(alert).not.toHaveBeenCalled();
    expect(view.result.current.pendingImages).toHaveLength(6);
    expect(view.result.current.pendingImages.every(attachment => attachment.uri.startsWith('file:///new-'))).toBe(true);
    expect(view.result.current.canAddMoreImages).toBe(false);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('rejects retained setters and paste callbacks from the departed scope', async () => {
    const { view, switchTo } = mount();
    const old = view.result.current;
    switchTo('session-b'); switchTo('session-a');
    await act(async () => {
      old.setPendingImages([image]);
      old.onPasteFailed();
      await old.onPasteFiles([pasted]);
      await old.pickImage();
    });
    expect(view.result.current.pendingImages).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(library).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { await old.pickFile(); });
    expect(document).not.toHaveBeenCalled();
  });
});
