import { act, renderHook, waitFor } from '@testing-library/react-native';
import { resolveCapabilities, type AdapterErrorCode, type BackendKind } from '@clawket/agent-protocol';
import {
  mapAdapterSessionUpdate,
  useAdapterChatEvents,
} from './useAdapterChatEvents';
import { useChatController } from './useChatController';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { routeGatewayEvent } from '../connection/protocol/events';
import { mapGatewayAdapterEvent, type GatewayAdapterEvent } from '../connection/adapters/gateway-session-update';
import { buildChildSessionActivityCards } from './childSessionActivity';
import { useChildRunRecords } from './useChildRunRecords';
import { buildThreadTimelineItems } from '../screens/Thread/model';

const historyMock = {
  sessionKey: 'agent:main:main' as string | null,
  sessions: [{ key: 'agent:main:main', kind: 'direct' as const }],
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
  captureSessionScope: jest.fn(() => () => true),
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
    voiceInputLevel: { value: 0 },
    voiceInputState: 'idle',
    voiceInputSupported: true,
  })),
}));

jest.mock('./useChatModelPicker', () => ({
  useChatModelPicker: jest.fn(() => ({
    runtimeSettingsBusy: false,
    runtimeSettingsPendingRef: { current: false },
    runtimeSettingsUnconfirmedRef: { current: false },
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
    approvalResolved: jest.fn(),
  },
}));

function createAdapter(backendKind: BackendKind = 'openclaw') {
  const transportKinds = { openclaw: 'relay', hermes: 'relay', 'local-model': 'relay', pi: 'relay', codex: 'relay', 'claude-code': 'relay' } as const;
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
    historyMock.activitySnapshot = null;
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

  it('dates each Codex commentary segment independently across two tool boundaries', () => {
    const runAt = Date.UTC(2026, 9, 3, 20, 13, 35);
    jest.setSystemTime(runAt);
    const { result, handlers } = renderController('codex');
    const receive = (update: any, receivedAt: number) => {
      jest.setSystemTime(receivedAt);
      act(() => handlers.onUpdate?.(mapAdapterSessionUpdate(update, { now: () => receivedAt })));
    };
    act(() => handlers.onState?.('ready'));
    receive({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'clock-run' }, runAt);
    const firstAt = runAt + 4_000, secondAt = runAt + 94_000, thirdAt = runAt + 162_000;
    const texts = ['I will run the first command.', 'The first command is still running.', 'The second command is now running.'];
    for (const [index, at] of [firstAt, secondAt, thirdAt].entries()) {
      receive({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'clock-run',
        textMode: 'snapshot', text: texts.slice(0, index + 1).join('\n\n'), timestampMs: at }, at + 2_000);
      const tail = result.current.listData.find(message => message.id === 'streaming');
      expect(tail).toMatchObject({ text: texts[index], timestampMs: at });
      const renderKey = tail?.renderKey;
      // Later tokens cannot advance this paragraph's first observed clock or its identity.
      receive({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'clock-run',
        textMode: 'snapshot', text: texts.slice(0, index + 1).join('\n\n') + ' More.', timestampMs: at + 1_000 }, at + 3_000);
      expect(result.current.listData.find(message => message.id === 'streaming')).toMatchObject({ timestampMs: at, renderKey });
      if (index < 2) receive({ type: 'tool_call', sessionKey: 'agent:main:main', runId: 'clock-run',
        toolCallId: `tool-${index}`, title: 'exec' }, at + 10_000);
      // The Native cumulative stream includes the committed paragraph's last tokens.
      texts[index] += ' More.';
    }
    expect(result.current.listData.filter(message => message.role === 'assistant').reverse()
      .map(message => message.timestampMs)).toEqual([firstAt, secondAt, thirdAt]);
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, 1e20, '123'])('keeps a fixed first-receipt Codex paragraph clock when Native omits or corrupts it: %j', timestampMs => {
    jest.setSystemTime(1_000);
    const { result, handlers } = renderController('codex');
    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'clock-run' }));
    });
    jest.setSystemTime(20_000);
    act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'clock-run', text: 'A new paragraph is arriving.', timestampMs } as any)));
    expect(result.current.listData.find(message => message.id === 'streaming')?.timestampMs).toBe(20_000);
    jest.setSystemTime(30_000);
    act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'clock-run', text: ' More.', timestampMs } as any)));
    expect(result.current.listData.find(message => message.id === 'streaming')?.timestampMs).toBe(20_000);
  });

  it.each(['openclaw', 'hermes', 'pi'] as const)('retains the existing %s live clock when its stream has no stage metadata', backend => {
    jest.setSystemTime(1_000);
    const { result, handlers } = renderController(backend);
    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'clock-run' }));
    });
    jest.setSystemTime(20_000);
    act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'clock-run', text: 'A paragraph is arriving.' })));
    expect(result.current.listData.find(message => message.id === 'streaming')?.timestampMs).toBe(1_000);
  });

  it('restores the same Codex paragraph clock after transport disconnect without advancing it on later tokens', () => {
    jest.setSystemTime(1_000);
    const { result, handlers } = renderController('codex');
    act(() => handlers.onState?.('ready'));
    jest.setSystemTime(20_000);
    act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main',
      runId: 'clock-run', text: 'A paragraph in progress.', timestampMs: 19_000 })));
    act(() => handlers.onState?.('offline'));
    jest.setSystemTime(30_000);
    act(() => handlers.onState?.('ready'));
    act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main',
      runId: 'clock-run', text: ' More.', timestampMs: 29_000 })));
    expect(result.current.listData.find(message => message.id === 'streaming')?.timestampMs).toBe(19_000);
  });

  it('keeps a noncurrent Codex paragraph first clock and isolates it from the previous selected conversation', () => {
    jest.setSystemTime(10_000);
    const { result, rerender, handlers } = renderController('codex');
    act(() => handlers.onState?.('ready'));
    const receive = (sessionKey: string, text: string, timestampMs: number) => act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({
      type: 'agent_message_chunk', sessionKey, runId: sessionKey, text, timestampMs,
    })));
    receive('agent:main:main', 'The selected conversation paragraph.', 9_000);
    receive('agent:main:other', 'Another conversation paragraph.', 11_000);
    receive('agent:main:other', ' More.', 12_000);
    historyMock.sessionKey = 'agent:main:other';
    rerender({});
    expect(result.current.listData.find(message => message.id === 'streaming')).toMatchObject({
      text: 'Another conversation paragraph. More.', timestampMs: 11_000,
    });
    receive('agent:main:main', ' Later.', 15_000);
    expect(result.current.listData.find(message => message.id === 'streaming')?.timestampMs).toBe(11_000);
  });

  it.each([true, false])('recovers a later Codex paragraph from active history (explicit tail clock: %s)', reported => {
    jest.setSystemTime(30_000);
    const { result, rerender } = renderController('codex');
    historyMock.messages = [
      { id: 'user', role: 'user', text: 'Request', timestampMs: 1_000 },
      { id: 'first', role: 'assistant', text: 'Earlier paragraph.', timestampMs: 5_000 },
      { id: 'toolcall_exec', role: 'tool', text: '', toolName: 'exec', toolCallId: 'exec', toolStatus: 'running', timestampMs: 7_000 },
      { id: 'second', role: 'assistant', text: 'A later paragraph.', timestampMs: 19_000 },
    ];
    historyMock.activitySnapshot = { key: 'agent:main:main', messages: [], hasActiveRun: true, requestedAtMs: 30_000,
      activeRun: { runId: 'clock-run', text: 'Earlier paragraph.\n\nA later paragraph.', startedAtMs: 1_000,
        ...(reported ? { messageTimestampMs: 19_000 } : {}) } };
    rerender({});
    expect(result.current.listData.find(message => message.id === 'streaming')).toMatchObject({ text: 'A later paragraph.', timestampMs: 19_000 });
    expect(result.current.listData.find(message => message.text === 'Earlier paragraph.')).toMatchObject({ timestampMs: 5_000 });
  });

  it('recovers the first clock of consecutive Codex assistant items merged into one tail without a tool', () => {
    jest.setSystemTime(30_000);
    const { result, rerender } = renderController('codex');
    historyMock.messages = [
      { id: 'user', role: 'user', text: 'Request', timestampMs: 1_000 },
      { id: 'first', role: 'assistant', text: 'First paragraph.', timestampMs: 13_000 },
      { id: 'second', role: 'assistant', text: 'Second paragraph.', timestampMs: 15_000 },
    ];
    historyMock.activitySnapshot = { key: 'agent:main:main', messages: [], hasActiveRun: true, requestedAtMs: 30_000,
      activeRun: { runId: 'clock-run', text: 'First paragraph.\n\nSecond paragraph.', startedAtMs: 1_000, messageTimestampMs: 15_000 } };
    rerender({});
    expect(result.current.listData.find(message => message.id === 'streaming')).toMatchObject({
      text: 'First paragraph.\n\nSecond paragraph.', timestampMs: 13_000,
    });
  });

  it.each([false, true])('does not borrow an empty recovered Codex tail clock (previous tool: %s)', previousTool => {
    jest.setSystemTime(10_000);
    const { result, rerender, handlers } = renderController('codex');
    act(() => handlers.onState?.('ready'));
    historyMock.messages = previousTool ? [
      { id: 'user', role: 'user', text: 'Request', timestampMs: 1_000 },
      { id: 'first', role: 'assistant', text: 'Earlier paragraph.', timestampMs: 5_000 },
      { id: 'toolcall_exec', role: 'tool', text: '', toolName: 'exec', toolCallId: 'exec', toolStatus: 'running', timestampMs: 7_000 },
    ] : [];
    historyMock.activitySnapshot = { key: 'agent:main:main', messages: [], hasActiveRun: true, requestedAtMs: 10_000,
      activeRun: { runId: 'clock-run', text: previousTool ? 'Earlier paragraph.' : '', startedAtMs: 1_000,
        ...(previousTool ? { messageTimestampMs: 5_000 } : {}) } };
    rerender({});
    jest.setSystemTime(20_000);
    act(() => handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main',
      runId: 'clock-run', textMode: 'snapshot', text: `${previousTool ? 'Earlier paragraph.\n\n' : ''}A later paragraph.`, timestampMs: 19_000 })));
    expect(result.current.listData.find(message => message.id === 'streaming')).toMatchObject({ text: 'A later paragraph.', timestampMs: 19_000 });
  });

  it.each([true, false])('restores a noncurrent Codex run as tool-bounded paragraphs with their own clocks (reported clocks: %s)', reported => {
    const runAt = Date.UTC(2026, 9, 6, 2, 16, 54);
    jest.setSystemTime(runAt);
    const { result, rerender, handlers } = renderController('codex');
    act(() => handlers.onState?.('ready'));
    const other = 'agent:main:other';
    const receive = (update: any, at: number) => {
      jest.setSystemTime(at);
      act(() => handlers.onUpdate?.(mapAdapterSessionUpdate(update, { now: () => at })));
    };
    const texts = ['First commentary.', 'Second commentary.', 'Third commentary.'];
    const nativeAt = [runAt + 4_000, runAt + 95_000, runAt + 580_000];
    receive({ type: 'run_started', sessionKey: other, runId: 'desktop:turn' }, runAt + 500);
    texts.forEach((_, index) => {
      receive({ type: 'agent_message_chunk', sessionKey: other, runId: 'desktop:turn', textMode: 'snapshot', text: texts.slice(0, index + 1).join('\n\n'),
        ...(reported ? { timestampMs: nativeAt[index] } : {}) }, nativeAt[index]! + 1_000);
      receive({ type: 'tool_call', sessionKey: other, runId: 'desktop:turn', toolCallId: `tool-${index}`, title: 'exec', status: 'running',
        ...(reported ? { startedAtMs: nativeAt[index]! + 2_000 } : {}) }, nativeAt[index]! + 3_000);
    });
    receive({ type: 'tool_call_update', sessionKey: other, runId: 'desktop:turn', toolCallId: 'tool-0', status: 'success',
      ...(reported ? { finishedAtMs: runAt + 40_000, durationMs: 33_000 } : {}) }, runAt + 41_000);
    jest.setSystemTime(runAt + 600_000);
    historyMock.sessionKey = other;
    rerender({});
    const rows = result.current.listData.slice().reverse();
    expect(rows.filter(row => row.role === 'assistant' && row.text.trim()).map(row => [row.text, row.timestampMs])).toEqual(
      texts.map((text, index) => [text, reported ? nativeAt[index] : nativeAt[index]! + 1_000]));
    expect(rows.filter(row => row.role === 'tool').map(row => [row.id, row.toolStatus, row.toolStartedAt])).toEqual(
      texts.map((_, index) => [`toolcall_tool-${index}`, index === 0 ? 'success' : 'running', nativeAt[index]! + (reported ? 2_000 : 3_000)]));
    expect(rows.find(row => row.id === 'toolcall_tool-0')).toMatchObject(reported
      ? { toolFinishedAt: runAt + 40_000, toolDurationMs: 33_000 } : { toolFinishedAt: runAt + 41_000, toolDurationMs: 34_000 });
    // No earlier paragraph is repeated inside a tail dated by the run start.
    expect(rows.some(row => row.role === 'assistant' && row.text.includes(texts[0]!) && row.text.includes(texts[2]!))).toBe(false);
    expect(rows.filter(row => row.role === 'assistant' && row.text.trim() && row.timestampMs === runAt + 500)).toEqual([]);
  });

  it('keeps the native run time of a Codex step over the phone receipt span', () => {
    jest.setSystemTime(1_000);
    const { result, handlers } = renderController('codex');
    const receive = (update: any, at: number) => {
      jest.setSystemTime(at);
      act(() => handlers.onUpdate?.(mapAdapterSessionUpdate(update, { now: () => at })));
    };
    act(() => handlers.onState?.('ready'));
    receive({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'run' }, 1_000);
    receive({ type: 'tool_call', sessionKey: 'agent:main:main', runId: 'run', toolCallId: 'exec', title: 'exec', status: 'running', startedAtMs: 2_000 }, 9_000);
    receive({ type: 'tool_call_update', sessionKey: 'agent:main:main', runId: 'run', toolCallId: 'exec', status: 'success',
      startedAtMs: 2_000, finishedAtMs: 8_500, durationMs: 6_400 }, 10_000);
    expect(result.current.listData.find(row => row.id === 'toolcall_exec')).toMatchObject({
      toolStatus: 'success', toolStartedAt: 2_000, toolFinishedAt: 8_500, toolDurationMs: 6_400,
    });
    receive({ type: 'tool_call', sessionKey: 'agent:main:main', runId: 'run', toolCallId: 'legacy', title: 'exec' }, 11_000);
    receive({ type: 'tool_call_update', sessionKey: 'agent:main:main', runId: 'run', toolCallId: 'legacy', status: 'success' }, 14_000);
    expect(result.current.listData.find(row => row.id === 'toolcall_legacy')).toMatchObject({
      toolStartedAt: 11_000, toolFinishedAt: 14_000, toolDurationMs: 3_000,
    });
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

  it.each(['missing', 'recent'])('keeps the latest reply after its user when an earlier matching reply has a %s timestamp', (timestampKind) => {
    const previousMessages = [
      { id: 'old-user', role: 'user', text: 'First question' },
      { id: 'native-old-reply', role: 'assistant', text: 'OK', timestampMs: timestampKind === 'recent' ? Date.now() : undefined },
      { id: 'current-user', role: 'user', text: 'Next question' },
    ];
    historyMock.messages = previousMessages;
    const { result, handlers } = renderController('codex');

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started', sessionKey: 'agent:main:main', runId: 'current-run',
      }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_finished', sessionKey: 'agent:main:main', runId: 'current-run',
        stopReason: 'end_turn', message: { role: 'assistant', content: 'OK' },
      }));
    });

    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages).toEqual([
      ...previousMessages,
      expect.objectContaining({ role: 'assistant', text: 'OK' }),
    ]);
  });

  it('still merges a matching recovered reply after the latest user', () => {
    historyMock.messages = [
      { id: 'current-user', role: 'user', text: 'Question' },
      { id: 'native-current-reply', role: 'assistant', text: 'OK' },
    ];
    const { handlers } = renderController('codex');
    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started', sessionKey: 'agent:main:main', runId: 'current-run',
      }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_finished', sessionKey: 'agent:main:main', runId: 'current-run',
        stopReason: 'end_turn', message: { role: 'assistant', content: 'OK' },
      }));
    });
    expect(historyMock.messages).toHaveLength(2);
    expect(historyMock.messages[1]).toEqual(expect.objectContaining({ role: 'assistant', text: 'OK' }));
    });

  it.each([
    ['codex', true], ['codex', false], ['openclaw', true],
  ] as const)('keeps the paragraphs a %s live tail showed before a final that repeats only its last one (tool: %s)', (backend, withTool) => {
    const { result, handlers } = renderController(backend);
    const startedAt = Date.UTC(2026, 9, 6, 7, 40, 0);
    const user = { id: 'native-user', role: 'user' as const, text: 'Run the checks', timestampMs: startedAt };
    historyMock.messages = [user];
    const receive = (update: any, at: number) => {
      jest.setSystemTime(at);
      act(() => handlers.onUpdate?.(mapAdapterSessionUpdate(update, { now: () => at })));
    };
    act(() => handlers.onState?.('ready'));
    receive({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'tail-run' }, startedAt);
    const before = withTool ? 'The date is October 6.\n\n' : '';
    if (withTool) {
      receive({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'tail-run', textMode: 'snapshot', text: 'The date is October 6.' }, startedAt + 2_000);
      receive({ type: 'tool_call', sessionKey: 'agent:main:main', runId: 'tail-run', toolCallId: 'uptime', title: 'exec' }, startedAt + 3_000);
      receive({ type: 'tool_call_update', sessionKey: 'agent:main:main', runId: 'tail-run', toolCallId: 'uptime', status: 'success' }, startedAt + 4_000);
    }
    receive({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'tail-run', textMode: 'snapshot',
      text: `${before}The system has been up for eight days.\n\nAll six commands completed.` }, startedAt + 6_000);
    const tail = result.current.listData.find(message => message.id === 'streaming');
    expect(tail?.text).toBe('The system has been up for eight days.\n\nAll six commands completed.');
    // The backend's final carries only its last message.
    receive({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'tail-run', stopReason: 'end_turn',
      message: { role: 'assistant', content: 'All six commands completed.' } }, startedAt + 8_000);
    const replies = historyMock.messages.filter(message => message.role === 'assistant');
    expect(replies.map(message => message.text)).toEqual([
      ...(withTool ? ['The date is October 6.'] : []), 'The system has been up for eight days.', 'All six commands completed.',
    ]);
    // The earlier paragraph stays in the bubble that showed it; the final takes its own.
    expect(replies.at(-2)?.renderKey).toBe(tail?.renderKey);
    expect(replies.at(-1)?.renderKey).not.toBe(tail?.renderKey);
  });

  it('keeps a final that repeats the whole live tail as one reply', () => {
    const { handlers } = renderController('codex');
    historyMock.messages = [{ id: 'native-user', role: 'user' as const, text: 'Run the checks' }];
    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'whole-run' }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'whole-run', textMode: 'snapshot',
        text: 'Checked it.\n\nAll done.' }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'run_finished', sessionKey: 'agent:main:main', runId: 'whole-run', stopReason: 'end_turn',
        message: { role: 'assistant', content: 'Checked it.\n\nAll done.' } }));
    });
    expect(historyMock.messages.filter(message => message.role === 'assistant').map(message => message.text)).toEqual(['Checked it.\n\nAll done.']);
  });

  it.each([false, true])('retains the final reply completion clock and separator through repeated canonical reloads (tool: %s)', withTool => {
    const { result, adapter, handlers } = renderController('codex');
    const startedAt = 1727996280000, completedAt = startedAt + 31 * 60_000;
    const user = { id: 'native-user', role: 'user' as const, text: 'Wait for my answer', timestampMs: startedAt };
    historyMock.messages = [user];
    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'run_started', sessionKey: 'agent:main:main', runId: 'clock-run' }, { now: () => startedAt }));
      if (withTool) handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'tool_call', sessionKey: 'agent:main:main', runId: 'clock-run', toolCallId: 'clock-tool', title: 'exec',
      }, { now: () => startedAt + 1000 }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_finished', sessionKey: 'agent:main:main', runId: 'clock-run', stopReason: 'end_turn',
        message: { role: 'assistant', content: 'Done', timestampMs: completedAt },
      }, { now: () => completedAt + 20_000 }));
    });
    const final = historyMock.messages.find(message => message.role === 'assistant');
    expect(final).toMatchObject({ text: 'Done', timestampMs: completedAt });
    const dates = () => buildThreadTimelineItems({ messages: [...historyMock.messages].reverse(), runs: [], nowMs: completedAt })
      .filter(item => item.type === 'date').map(item => item.timestampMs);
    expect(dates()).toContain(completedAt);
    for (let count = 0; count < 2; count++) act(() => {
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'history_reconciled', sessionKey: 'agent:main:main', history: {
          key: 'agent:main:main', hasActiveRun: false, messages: [user,
            ...(withTool ? [{ id: 'toolcall_clock-tool', role: 'tool' as const, text: '', timestampMs: startedAt,
              tool: { name: 'exec', callId: 'clock-tool', status: 'success' as const } }] : []),
            { id: 'native-final', role: 'assistant' as const, text: 'Done', timestampMs: completedAt }],
        },
      }));
    });
    expect(historyMock.messages.filter(message => message.role === 'assistant')).toEqual([
      expect.objectContaining({ text: 'Done', timestampMs: completedAt, renderKey: final.renderKey }),
    ]);
    expect(dates()).toContain(completedAt);
    expect(result.current.isSending).toBe(false);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('keeps one failed native-turn notice after live completion and repeated history recovery', () => {
    const { result, adapter, handlers } = renderController('codex');
    const terminalMessage = {
      id: 'codex-turn-error:native-failed-turn', role: 'system' as const,
      text: 'Model authentication failed. Sign in again on your computer.', timestampMs: 200,
    };
    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_started', sessionKey: 'agent:main:main', runId: 'bridge-failed-run',
      }, { now: () => 100 }));
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'run_finished', sessionKey: 'agent:main:main', runId: 'bridge-failed-run',
        stopReason: 'error', terminalMessage,
        message: { role: 'assistant', content: terminalMessage.text },
      }, { now: () => 200 }));
    });
    expect(result.current.isSending).toBe(false);
    expect(historyMock.messages.filter(message => message.role === 'assistant')).toEqual([]);
    expect(historyMock.messages.filter(message => message.id === terminalMessage.id)).toHaveLength(1);
    for (let count = 0; count < 2; count++) act(() => {
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'history_reconciled', sessionKey: 'agent:main:main',
        history: { key: 'agent:main:main', hasActiveRun: false, messages: [terminalMessage] },
      }));
    });
    expect(historyMock.messages.filter(message => message.id === terminalMessage.id)).toEqual([
      expect.objectContaining(terminalMessage),
    ]);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('persists an agent-event-only child through a cold controller mount using the real cache codec', async () => {
    // Model disk, not a prebuilt successful cache response: the second mount can
    // only read bytes actually written by the first through AsyncStorage.
    const disk = new Map<string, string>();
    const storage = jest.mocked(AsyncStorage);
    storage.getItem.mockImplementation(async key => disk.get(key) ?? null);
    storage.setItem.mockImplementation(async (key, value) => { disk.set(key, value); });
    storage.removeItem.mockImplementation(async key => { disk.delete(key); });
    const scope = { connectionId: 'openclaw-connection', agentId: 'main', sessionKey: 'agent:main:main' };
    const childKey = 'agent:main:subagent:weather-probe';
    const adapter = createAdapter();
    const mount = () => renderHook(() => {
      const controller = useChatController({ adapter: adapter as any, debugMode: false, showAgentAvatar: true });
      const cards = buildChildSessionActivityCards({
        currentSessionKey: controller.sessionKey, currentAgentId: 'main', sessions: controller.sessions,
        activityMap: controller.childSessionActivityRef.current, resolveSessionTitle: session => session.label ?? 'Subagent',
      });
      return { controller, records: useChildRunRecords(scope, cards).runs };
    });
    const first = mount();
    const handlers = latestAdapterHandlers();
    const receive = (stream: string, data: Record<string, unknown>) => routeGatewayEvent('agent', {
      runId: 'weather-run', sessionKey: childKey, stream, data,
    }, (event, payload) => {
      if (!['chatRunStart', 'chatDelta', 'chatFinal', 'chatAborted', 'chatError', 'chatTool'].includes(event)) return;
      for (const update of mapGatewayAdapterEvent({ type: event, payload } as GatewayAdapterEvent, scope.sessionKey)) {
        handlers.onUpdate?.(mapAdapterSessionUpdate(update.type === 'agent_message_chunk' ? { ...update, textMode: 'snapshot' } : update));
      }
    }, () => Date.now());
    act(() => {
      handlers.onState?.('ready');
      receive('lifecycle', { phase: 'start' });
      receive('assistant', { text: '杭州明天天气：多云', delta: '杭州明天天气：多云' });
      receive('assistant', { text: '杭州明天天气：多云，29–31 ℃', delta: '，29–31 ℃' });
      receive('lifecycle', { phase: 'end' });
    });
    const expected = { id: childKey, status: 'completed', summary: '杭州明天天气：多云，29–31 ℃' };
    await waitFor(() => expect(first.result.current.records).toEqual([expect.objectContaining(expected)]));
    await waitFor(() => expect([...disk.keys()].some(key => key.endsWith('::subagents'))).toBe(true));
    first.unmount();
    const cold = mount();
    expect(cold.result.current.controller.childSessionActivityRef.current.size).toBe(0);
    await waitFor(() => expect(cold.result.current.records).toEqual([expect.objectContaining(expected)]));
    cold.unmount();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue();
    storage.removeItem.mockResolvedValue();
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
      resultText: 'Done',
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

  it('keeps session-scoped local TLS explanations in their transcript', () => {
    const { handlers } = renderController();
    const explanation = 'Direct local TLS adapter connections are not supported in Clawket mobile yet. Disable OpenClaw adapter TLS for LAN pairing, or use Relay/Tailscale instead.';

    act(() => {
      handlers.onState?.('ready');
      handlers.onUpdate?.(mapAdapterSessionUpdate({
        type: 'error',
        code: 'network',
        message: explanation,
        sessionKey: 'agent:main:main',
      }, { now: () => 500 }));
    });

    expect(historyMock.messages).toEqual([
      expect.objectContaining({ role: 'system', text: explanation }),
    ]);
  });

  it('does not persist reconnect failures into conversation history', () => {
    const { handlers } = renderController();
    act(() => {
      handlers.onState?.('reconnecting');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        handlers.onUpdate?.(mapAdapterSessionUpdate({ type: 'error', code: 'timeout', message: 'Health timeout' }, { now: () => 500 + attempt }));
      }
    });
    expect(historyMock.messages).toEqual([]);
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
        sessionKey: 'agent:main:main',
      }, { now: () => 600 }));
    });

    expect(historyMock.messages).toEqual([
      expect.objectContaining({ role: 'system', text }),
    ]);
  });
});
