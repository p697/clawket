import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import type { ComposerHandle } from '../../components/ui/Composer';
import { analyticsEvents } from '../../services/analytics/events';
import { ThreadScreen, type ThreadScreenProps } from './ThreadScreen';
import type { ThreadViewProps } from './ThreadView';
import type { ThreadOverlaysProps } from './components/ThreadOverlays';

let mockThreadViewProps: ThreadViewProps | null = null;
let mockThreadViewRenders: Array<{ kind: string; runCount: number }> = [];
const mockThreadActivityCache = {
  read: jest.fn(async (): Promise<unknown[] | null> => null),
  write: jest.fn(async () => undefined),
};
let mockCronRunSheetProps: Record<string, unknown> | null = null;
let mockThreadOverlayProps: ThreadOverlaysProps | null = null;
let mockConnections: Record<string, unknown>;
let mockApp: Record<string, unknown>;
let mockController: Record<string, unknown>;
let mockIsPro = true;
let mockSubscriptionLoading = false;
let mockFocused = true;
let mockScopedApp: Record<string, unknown> | null = null;
const mockToggleFavorite = jest.fn(async () => ({ favorited: true, favoriteKey: 'favorite-1' }));
const mockIsFavoritedMessage = jest.fn(() => false);
const mockedAnalyticsEvents = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

const mockRuntime = {
  markSessionOpened: jest.fn(async () => ({})),
  activate: jest.fn(async () => undefined),
  probeActive: jest.fn(async () => true),
  reconnectConnection: jest.fn(async () => undefined),
  getSnapshot: jest.fn(() => ({ activeConnectionId: 'connection-1' })),
};

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    View: ({ children, ...props }: { children?: React.ReactNode }) => ReactRuntime.createElement(
      'View',
      props,
      children,
    ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => Object.entries(options ?? {}).reduce(
      (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
      key,
    ),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../AgentSettings/CronRunSheet', () => ({
  CronRunSheet: (props: Record<string, unknown>) => { mockCronRunSheetProps = props; return null; },
}));
jest.mock('../../contexts/AppContext', () => {
  const ReactRuntime = require('react');
  const Context = ReactRuntime.createContext(null);
  return {
    AppContextProvider: ({ value, children }: any) => ReactRuntime.createElement(Context.Provider, { value }, children),
    useAppContext: () => ReactRuntime.useContext(Context) ?? mockApp,
  };
});

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => ({ isPro: mockIsPro, isLoading: mockSubscriptionLoading }),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockRuntime,
  useConnections: () => mockConnections,
}));

jest.mock('../../chat/useChatController', () => ({
  useChatController: () => {
    mockScopedApp = require('../../contexts/AppContext').useAppContext();
    return mockController;
  },
}));

jest.mock('../../chat/useMessageFavorites', () => ({
  useMessageFavorites: () => ({
    favoriteMessageIdSet: new Set<string>(),
    isFavoritedMessage: mockIsFavoritedMessage,
    toggleFavorite: mockToggleFavorite,
  }),
}));

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    chatAbortTapped: jest.fn(),
    chatAddMenuOpened: jest.fn(),
    chatAddMenuAction: jest.fn(),
    runCardOpened: jest.fn(),
    threadOpened: jest.fn(),
    threadLoadState: jest.fn(),
    sessionPreviewViewed: jest.fn(),
  },
}));

jest.mock('./ThreadView', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ThreadView: (props: ThreadViewProps) => {
      mockThreadViewProps = props;
      mockThreadViewRenders.push({ kind: props.state.kind, runCount: props.runCards?.length ?? 0 });
      return ReactRuntime.createElement(View, { testID: 'connected-thread-view' });
    },
  };
});

jest.mock('../../services/thread-activity-cache', () => ({
  ThreadActivityCacheService: {
    read: (...args: unknown[]) => mockThreadActivityCache.read(...(args as [])),
    write: (...args: unknown[]) => mockThreadActivityCache.write(...(args as [])),
  },
}));

jest.mock('./components/ThreadOverlays', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ThreadOverlays: (props: ThreadOverlaysProps) => {
      mockThreadOverlayProps = props;
      return ReactRuntime.createElement(View, { testID: 'connected-thread-overlays' });
    },
  };
});

const adapter = {
  connection: { id: 'connection-1', backendKind: 'openclaw' },
  capabilities: { ...CAPABILITY_MATRIX.openclaw },
  cancel: jest.fn(async () => undefined),
  management: { cron: {} as Record<string, unknown> },
};

function createNavigationProps(): ThreadScreenProps {
  return {
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
      replace: jest.fn(),
      pop: jest.fn(),
      getState: jest.fn(() => ({ index: 1, routes: [
        { name: 'Thread', params: { connectionId: 'connection-1', agentId: 'atlas', sessionKey: 'agent:atlas:main' } },
        { name: 'Thread' },
      ] })),
    },
    route: {
      key: 'Thread-key',
      name: 'Thread',
      params: {
        connectionId: 'connection-1',
        agentId: 'atlas',
        sessionKey: 'agent:atlas:main',
        from: 'roster',
      },
    },
  } as unknown as ThreadScreenProps;
}

function createController(): Record<string, unknown> {
  const composerRef = React.createRef<ComposerHandle>();
  return {
    activityLabel: null,
    agentDisplayName: 'Controller Atlas',
    agentAvatarUri: null,
    agentEmoji: null,
    availableModels: [],
    availableProviders: [],
    canAddMoreImages: true,
    canAbortCurrentRun: true,
    canSend: true,
    compactionNotice: 'Compacting context...',
    childSessionActivityRef: { current: new Map() },
    childSessionActivityVersion: 0,
    clearChildSessionActivities: jest.fn(),
    closeCommandPicker: jest.fn(),
    closeStaticThinkPicker: jest.fn(),
    commandPickerError: null,
    commandPickerLoading: false,
    commandPickerOptions: [],
    commandPickerTitle: 'Choose option',
    commandPickerVisible: false,
    composerRef,
    connectionState: 'ready',
    currentModel: 'anthropic/sonnet',
    currentModelHeaderLabel: 'Sonnet',
    currentModelProvider: 'anthropic',
    dismissSlashSuggestions: jest.fn(),
    hasMoreHistory: true,
    historyLoaded: true,
    input: 'Draft',
    isSending: false,
    listData: [{ id: 'message-1', role: 'assistant', text: 'Hello' }],
    loadingMoreHistory: false,
    modelPickerError: null,
    modelPickerLoading: false,
    modelPickerVisible: false,
    onLoadMoreHistory: jest.fn(),
    abortCurrentRun: jest.fn(),
    onSelectCommandOption: jest.fn(),
    onSelectModel: jest.fn(),
    onSelectSlashCommand: jest.fn(),
    onSelectStaticThinkLevel: jest.fn(),
    onSend: jest.fn(),
    onPasteFiles: jest.fn(),
    onPasteFailed: jest.fn(),
    pendingImages: [],
    pickFile: jest.fn(),
    pickImage: jest.fn(),
    attachLocalImages: jest.fn(),
    preview: {
      closePreview: jest.fn(),
      openPreview: jest.fn(),
      previewHeight: 844,
      previewIndex: 0,
      previewUris: [],
      previewVisible: false,
      previewWidth: 390,
      screenHeight: 844,
      screenWidth: 390,
      setPreviewIndex: jest.fn(),
    },
    removePendingImage: jest.fn(),
    resolveApproval: jest.fn(),
    retryCommandPickerLoad: jest.fn(),
    retryModelPickerLoad: jest.fn(),
    sessionKey: 'agent:atlas:main',
    sessions: [{
      key: 'agent:atlas:main',
      title: 'Main thread',
      totalTokens: 46,
      totalTokensFresh: true,
      contextTokens: 100,
    }],
    setModelPickerVisible: jest.fn(),
    setInput: jest.fn(),
    showSlashSuggestions: false,
    slashSuggestions: [],
    staticThinkPickerVisible: false,
    takePhoto: jest.fn(),
    thinkingLevel: 'off',
    thinkingLevelOptions: ['off', 'low', 'medium', 'high'],
    toggleVoiceInput: jest.fn(),
    voiceInputLevel: { value: 0 },
    voiceInputState: 'idle',
    voiceInputSupported: true,
  };
}

function createApp(): Record<string, unknown> {
  return {
    activeGatewayConfigId: 'connection-1',
    activeAdapter: adapter,
    agents: [{ id: 'atlas', name: 'Atlas', identity: { name: 'Atlas', emoji: null } }],
    chatSessionRequest: null,
    clearChatSessionRequest: jest.fn(),
    config: { id: 'connection-1' },
    currentAgentId: 'main',
    debugMode: false,
    gateway: {},
    mainSessionKey: 'agent:atlas:main',
    requestChatSession: jest.fn(),
    setCurrentAgentId: jest.fn(),
    showAgentAvatar: false,
  };
}

describe('ThreadScreen connection container', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockFocused = true;
    mockScopedApp = null;
    mockThreadViewProps = null;
    mockThreadViewRenders = [];
    mockThreadOverlayProps = null;
    mockThreadActivityCache.read.mockReset();
    mockThreadActivityCache.read.mockResolvedValue(null);
    mockThreadActivityCache.write.mockReset();
    mockThreadActivityCache.write.mockResolvedValue(undefined);
    mockConnections = {
      connectionDetails: {},
      initialized: true,
      switching: false,
      activeConnectionId: 'connection-1',
      activeAdapter: adapter,
      connections: [{ id: 'connection-1', backendKind: 'openclaw', label: 'OpenClaw Preview' }],
      roster: [],
      error: null,
    };
    mockApp = createApp();
    mockController = createController();
    mockIsPro = true;
    mockSubscriptionLoading = false;
    adapter.capabilities = { ...CAPABILITY_MATRIX.openclaw };
    adapter.management.cron = {};
    adapter.cancel.mockClear();
    mockRuntime.markSessionOpened.mockClear();
    mockRuntime.activate.mockClear();
    mockRuntime.probeActive.mockClear();
    mockRuntime.reconnectConnection.mockClear();
    mockRuntime.getSnapshot.mockReturnValue({ activeConnectionId: 'connection-1' });
    mockToggleFavorite.mockClear();
    mockIsFavoritedMessage.mockClear();
    mockedAnalyticsEvents.chatAbortTapped.mockClear();
    mockedAnalyticsEvents.runCardOpened.mockClear();
    mockedAnalyticsEvents.threadOpened.mockClear();
    mockedAnalyticsEvents.threadLoadState.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each(['openclaw', 'hermes'] as const)('retries %s with a fresh connection and exposes scoped settings', async (backend) => {
    mockConnections.connections = [{ id: 'connection-1', backendKind: backend, label: 'My computer' }];
    mockConnections.connectionDetails = { 'connection-1': { lastReadyAt: 1234 } };
    const props = createNavigationProps();
    render(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.connectionFailure).toMatchObject({ name: 'My computer', lastReadyAt: 1234 });
    mockThreadViewProps?.connectionFailure?.onManage?.();
    expect(props.navigation.navigate).toHaveBeenCalledWith('Connection', { connectionId: 'connection-1' });
    await act(async () => { mockThreadViewProps?.onRetry?.(); mockThreadViewProps?.onRetry?.(); });
    expect(mockRuntime.reconnectConnection).toHaveBeenCalledTimes(1);
    expect(mockRuntime.reconnectConnection).toHaveBeenCalledWith('connection-1');
    expect(mockRuntime.probeActive).not.toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes'] as const)('opens %s pairing instead of retrying expired credentials', (backend) => {
    mockConnections.connections = [{ id: 'connection-1', backendKind: backend, label: 'Computer' }];
    const props = createNavigationProps();
    render(<ThreadScreen {...props} />);
    mockThreadViewProps?.onErrorAction?.({ kind: 'error', code: 'pairing_expired', message: 'Expired' });
    expect(props.navigation.navigate).toHaveBeenCalledWith('Onboarding', { presentation: 'modal', initialBackend: backend });
    expect(mockRuntime.reconnectConnection).not.toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes'] as const)('shows scoped cached %s preview while network history is pending', (backend) => {
    mockIsPro = false;
    mockConnections.activeAdapter = { ...adapter, connection: { ...adapter.connection, backendKind: backend } };
    const props = createNavigationProps();
    props.route = { ...props.route, params: { ...props.route.params, sessionKey: 'channel-one' } };
    mockController.sessionKey = 'channel-one';
    mockController.historyLoaded = false;
    mockController.listData = [{ id: 'cached', role: 'assistant', text: 'Cached reply' }];
    render(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages).toEqual(mockController.listData);
    expect(mockThreadViewProps?.state.kind).toBe('ready');
    expect(mockThreadViewProps?.sessionPreview?.loading).toBe(false);
  });

  it.each(['empty', 'tools', 'different-session'] as const)('shows loading when %s data cannot produce a preview yet', (scenario) => {
    mockIsPro = false;
    const props = createNavigationProps();
    props.route = { ...props.route, params: { ...props.route.params, sessionKey: 'channel-one' } };
    mockController.sessionKey = scenario === 'different-session' ? 'other' : 'channel-one';
    mockController.historyLoaded = false;
    mockController.listData = scenario === 'empty' ? [] : [{
      id: 'not-visible', role: scenario === 'tools' ? 'tool' : 'assistant', text: 'Not ready',
    }];
    render(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages).toEqual([]);
    expect(mockThreadViewProps?.state.kind).toBe('loading');
    expect(mockThreadViewProps?.sessionPreview?.loading).toBe(true);
  });

  it.each(['openclaw', 'hermes'] as const)('shows the safe %s preview while subscription lookup is pending', (backend) => {
    mockIsPro = false;
    mockSubscriptionLoading = true;
    mockConnections.activeAdapter = { ...adapter, connection: { ...adapter.connection, backendKind: backend } };
    const props = createNavigationProps();
    props.route = { ...props.route, params: { ...props.route.params, sessionKey: 'channel-one' } };
    mockController.sessionKey = 'channel-one';
    mockController.listData = [
      { id: 'latest', role: 'assistant', text: 'Latest reply' },
      { id: 'question', role: 'user', text: 'Latest question' },
      { id: 'older', role: 'assistant', text: 'Must remain hidden' },
    ];
    const view = render(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages.map((m) => m.id)).toEqual(['latest', 'question']);
    expect(mockThreadViewProps?.state.kind).toBe('ready');
    expect(mockThreadViewProps?.sessionPreview?.loading).toBe(false);
    expect(mockThreadViewProps?.canSend).toBe(false);
    expect(mockThreadViewProps?.onLoadMoreHistory).toBeUndefined();
    expect(mockedAnalyticsEvents.threadLoadState).toHaveBeenLastCalledWith({
      backend, phase: 'ready', history_loaded: true, subscription_loading: true,
      target_session_ready: true, preview_only: true, elapsed_ms: expect.any(Number),
    });
    const diagnosticCalls = mockedAnalyticsEvents.threadLoadState.mock.calls.length;
    mockController.listData = [...(mockController.listData as object[])];
    view.rerender(<ThreadScreen {...props} />);
    expect(mockedAnalyticsEvents.threadLoadState).toHaveBeenCalledTimes(diagnosticCalls);
    mockSubscriptionLoading = false;
    mockIsPro = true;
    view.rerender(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages).toHaveLength(3);
    expect(mockThreadViewProps?.sessionPreview).toBeUndefined();
    expect(mockRuntime.activate).not.toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes'] as const)('previews non-main %s sessions and unlocks in place', (backend) => {
    mockIsPro = false;
    mockConnections.activeAdapter = { ...adapter, connection: { ...adapter.connection, backendKind: backend } };
    const props = createNavigationProps();
    props.route = { ...props.route, params: { ...props.route.params, sessionKey: 'agent:atlas:slack:channel:one', from: 'panel' } };
    mockController.sessionKey = props.route.params.sessionKey;
    mockController.listData = [
      { id: 'new', role: 'assistant', text: 'Latest reply' },
      { id: 'question', role: 'user', text: 'Latest question' },
      { id: 'old', role: 'assistant', text: 'Hidden history' },
    ];
    const view = render(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages.map((m) => m.id)).toEqual(['new', 'question']);
    expect(mockThreadViewProps?.sessionPreview?.hasHiddenHistory).toBe(true);
    expect(mockThreadViewProps?.onLoadMoreHistory).toBeUndefined();
    expect(mockThreadViewProps?.canSend).toBe(false);
    act(() => mockThreadViewProps?.sessionPreview?.onMain());
    expect(props.navigation.pop).toHaveBeenCalledWith(1);
    act(() => mockThreadViewProps?.sessionPreview?.onUpgrade());
    expect(props.navigation.navigate).toHaveBeenCalledWith('Paywall', { reason: 'sessionHistory' });
    mockIsPro = true;
    view.rerender(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages).toHaveLength(3);
    expect(mockThreadViewProps?.sessionPreview).toBeUndefined();
    expect(mockThreadViewProps?.onLoadMoreHistory).toBe(mockController.onLoadMoreHistory);
    expect(mockRuntime.activate).not.toHaveBeenCalled();
  });

  it('replaces a directly opened preview with main chat when no main route exists', () => {
    mockIsPro = false;
    const props = createNavigationProps();
    props.route = { ...props.route, params: { ...props.route.params, sessionKey: 'agent:atlas:cron:one' } };
    mockController.sessionKey = props.route.params.sessionKey;
    jest.mocked(props.navigation.getState).mockReturnValue({ index: 0, routes: [{ name: 'Thread' }] } as any);
    render(<ThreadScreen {...props} />);
    act(() => mockThreadViewProps?.sessionPreview?.onMain());
    expect(props.navigation.replace).toHaveBeenCalledWith('Thread', {
      connectionId: 'connection-1', agentId: 'atlas', sessionKey: 'agent:atlas:main', from: 'panel',
    });
  });

  it('keeps main conversations and the existing grace period complete', () => {
    mockIsPro = false;
    const props = createNavigationProps();
    const view = render(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.sessionPreview).toBeUndefined();
    props.route = { ...props.route, params: { ...props.route.params, sessionKey: 'agent:atlas:cron:one' } };
    mockController.sessionKey = props.route.params.sessionKey;
    view.rerender(<ThreadScreen {...props} sessionHistoryGraceActive />);
    expect(mockThreadViewProps?.sessionPreview).toBeUndefined();
  });

  it('marks only the visible route as read and advances when its history updates', async () => {
    mockController.historyLoaded = false;
    const props = createNavigationProps();
    const view = render(<ThreadScreen {...props} />);
    expect(mockRuntime.markSessionOpened).not.toHaveBeenCalled();
    mockController.historyLoaded = true;
    mockController.sessions = [{ key: 'agent:atlas:main', updatedAt: 120 }];
    view.rerender(<ThreadScreen {...props} />);
    await act(async () => Promise.resolve());
    expect(mockRuntime.markSessionOpened).toHaveBeenLastCalledWith({
      connectionId: 'connection-1', key: 'agent:atlas:main', updatedAt: 120, lastActivityAt: 120,
    });
    const calls = mockRuntime.markSessionOpened.mock.calls.length;
    view.rerender(<ThreadScreen {...props} />);
    expect(mockRuntime.markSessionOpened).toHaveBeenCalledTimes(calls);
    // Housekeeping moved updatedAt without new human activity: nothing to re-mark.
    mockController.sessions = [{ key: 'agent:atlas:main', updatedAt: 900, lastActivityAt: 120 }];
    view.rerender(<ThreadScreen {...props} />);
    await act(async () => Promise.resolve());
    expect(mockRuntime.markSessionOpened).toHaveBeenCalledTimes(calls);
    mockFocused = false;
    mockController.sessions = [{ key: 'agent:atlas:main', updatedAt: 950, lastActivityAt: 150 }];
    view.rerender(<ThreadScreen {...props} />);
    expect(mockRuntime.markSessionOpened).toHaveBeenCalledTimes(calls);
    mockFocused = true;
    view.rerender(<ThreadScreen {...props} />);
    await act(async () => Promise.resolve());
    expect(mockRuntime.markSessionOpened).toHaveBeenLastCalledWith({
      connectionId: 'connection-1', key: 'agent:atlas:main', updatedAt: 150, lastActivityAt: 150,
    });
  });

  it('scopes the first controller render to its route and discards an unrelated preview', () => {
    mockApp.currentAgentId = 'lucy';
    mockApp.mainSessionKey = 'agent:lucy:main';
    mockApp.initialChatPreview = { sessionKey: 'agent:lucy:main', messages: [{ text: 'private history' }] };
    mockApp.chatSessionRequest = { sessionKey: 'agent:lucy:main', requestedAt: 1 };
    render(<ThreadScreen {...createNavigationProps()} />);
    expect(mockScopedApp).toMatchObject({
      currentAgentId: 'atlas', mainSessionKey: 'agent:atlas:main',
      initialChatPreview: null, chatSessionRequest: null, pendingAgentSwitch: null,
    });
  });

  it('does not let a retained background thread consume global navigation or input', () => {
    mockFocused = false;
    mockApp.pendingChatInput = 'draft for the foreground agent';
    mockApp.pendingMainSessionSwitch = true;
    render(<ThreadScreen {...createNavigationProps()} />);
    expect(mockScopedApp).toMatchObject({
      pendingChatInput: null, pendingMainSessionSwitch: false,
    });
    expect(mockApp.setCurrentAgentId).not.toHaveBeenCalled();
    expect(mockApp.requestChatSession).not.toHaveBeenCalled();
    expect(mockRuntime.activate).not.toHaveBeenCalled();
  });

  it('retains the adapter and visible timeline across a secondary route and back', () => {
    const props = createNavigationProps();
    const view = render(<ThreadScreen {...props} />);
    const visibleMessages = mockThreadViewProps?.messages;
    mockFocused = false;
    view.rerender(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages).toBe(visibleMessages);
    expect(mockThreadViewProps?.capabilities).toBe(adapter.capabilities);
    mockFocused = true;
    view.rerender(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.messages).toBe(visibleMessages);
    expect(mockApp.requestChatSession).not.toHaveBeenCalled();
  });

  it('does not present a roster refresh timeout as a failed chat connection', () => {
    mockConnections.error = { operation: 'roster', connectionId: 'connection-1', message: '[request_timeout] sessions.list request timed out' };
    render(<ThreadScreen {...createNavigationProps()} />);
    expect(mockThreadViewProps?.state).toMatchObject({ kind: 'ready' });
  });

  it('binds the target route, active adapter capabilities, controller, and navigation actions', () => {
    const props = createNavigationProps();
    const onThreadOpened = jest.fn();
    const onOpenAttachments = jest.fn();
    render(
      <ThreadScreen
        {...props}
        onThreadOpened={onThreadOpened}
        onOpenAttachments={onOpenAttachments}
      />,
    );

    expect(mockApp.setCurrentAgentId).toHaveBeenCalledWith('atlas');
    expect(mockApp.requestChatSession).not.toHaveBeenCalled();
    expect(onThreadOpened).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      agentId: 'atlas',
      sessionKey: 'agent:atlas:main',
      from: 'roster',
    });
    expect(mockedAnalyticsEvents.threadOpened).toHaveBeenCalledWith({
      backend: 'openclaw',
      kind: 'main',
      from: 'roster',
    });
    expect(mockThreadViewProps).toMatchObject({
      agentId: 'atlas',
      agentName: 'Controller Atlas',
      sessionKey: 'agent:atlas:main',
      model: 'Sonnet',
      contextUsed: 46,
      contextWindow: 100,
      state: { kind: 'ready' },
      capabilities: adapter.capabilities,
      topInset: 24,
      bottomInset: 16,
      compactionNotice: 'Compacting context...',
    });
    expect(mockThreadViewProps?.composerRef).toBe(mockController.composerRef);
    expect(mockThreadViewProps?.onPasteFiles).toBe(mockController.onPasteFiles);
    expect(mockThreadViewProps?.onPasteFailed).toBe(mockController.onPasteFailed);

    const message = mockThreadViewProps?.messages[0];
    expect(message).toBeDefined();
    act(() => {
      if (message) mockThreadViewProps?.onOpenAttachments?.(message, 2);
    });
    expect(onOpenAttachments).toHaveBeenCalledWith(message, 2);

    act(() => mockThreadViewProps?.onBack());
    expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
    act(() => mockThreadViewProps?.onOpenSettings());
    expect(props.navigation.navigate).toHaveBeenCalledWith('AgentSettings', {
      connectionId: 'connection-1',
      agentId: 'atlas',
    });
    act(() => mockThreadViewProps?.onOpenPaywall?.());
    expect(props.navigation.navigate).toHaveBeenCalledWith('Paywall', { reason: 'agents' });
    act(() => mockThreadViewProps?.onCancel?.());
    expect(adapter.cancel).not.toHaveBeenCalled();
    expect(mockController.abortCurrentRun).toHaveBeenCalledTimes(1);
    expect(mockedAnalyticsEvents.chatAbortTapped).toHaveBeenCalledWith({ backend: 'openclaw' });
  });

  it('prefers route-scoped roster identity over same-id agents from another connection', () => {
    mockApp.agents = [{
      connectionId: 'connection-2',
      id: 'atlas',
      name: 'Legacy Atlas',
      identity: {
        name: 'Legacy Atlas',
        emoji: 'L',
        avatarUrl: 'https://example.com/legacy.png',
      },
    }];
    mockController.agentDisplayName = 'Controller Atlas';
    mockController.agentEmoji = 'C';
    mockController.agentAvatarUri = 'https://example.com/controller.png';
    mockConnections.roster = [
      {
        connection: { id: 'connection-2' },
        agents: [{
          agent: {
            connectionId: 'connection-2',
            agentId: 'atlas',
            name: 'Wrong Atlas',
            emoji: 'W',
            avatarUrl: 'https://example.com/wrong.png',
          },
        }],
      },
      {
        connection: { id: 'connection-1' },
        agents: [{
          agent: {
            connectionId: 'connection-1',
            agentId: 'atlas',
            name: 'Scoped Atlas',
            emoji: 'S',
            avatarUrl: 'https://example.com/scoped.png',
          },
        }],
      },
    ];

    render(<ThreadScreen {...createNavigationProps()} />);

    expect(mockThreadViewProps).toMatchObject({
      agentName: 'Scoped Atlas',
      agentEmoji: 'S',
      agentAvatarUrl: 'https://example.com/scoped.png',
    });
  });

  it('uses the connection quota reason supplied by the host and keeps agents as the default', () => {
    const defaultProps = createNavigationProps();
    const defaultView = render(<ThreadScreen {...defaultProps} locked />);
    act(() => mockThreadViewProps?.onOpenPaywall?.());
    expect(defaultProps.navigation.navigate).toHaveBeenCalledWith('Paywall', { reason: 'agents' });

    defaultView.unmount();
    const connectionProps = createNavigationProps();
    render(
      <ThreadScreen
        {...connectionProps}
        locked
        lockedReason="gatewayConnections"
      />,
    );
    act(() => mockThreadViewProps?.onOpenPaywall?.());
    expect(connectionProps.navigation.navigate).toHaveBeenCalledWith('Paywall', {
      reason: 'gatewayConnections',
    });
  });

  it('normalizes global and unknown session kinds to other for analytics', () => {
    mockController.sessions = [{
      key: 'agent:atlas:main',
      kind: 'global',
      title: 'Global thread',
    }];

    render(<ThreadScreen {...createNavigationProps()} />);

    expect(mockedAnalyticsEvents.threadOpened).toHaveBeenCalledWith({
      backend: 'openclaw',
      kind: 'other',
      from: 'roster',
    });
  });

  it('projects owned child activity and real Cron results into capability- and Pro-gated run cards', async () => {
    const now = Date.now();
    const childSessionKey = 'agent:atlas:subagent:release-worker';
    const cronSessionKey = 'agent:atlas:cron:nightly';
    mockController.sessions = [
      {
        key: 'agent:atlas:main',
        kind: 'main',
        agentId: 'atlas',
        title: 'Main thread',
      },
      {
        key: childSessionKey,
        kind: 'subagent',
        agentId: 'atlas',
        title: 'Release worker',
        parentSessionKey: 'agent:atlas:main',
      },
      {
        key: cronSessionKey,
        kind: 'cron',
        agentId: 'atlas',
        title: '[Cron] Nightly report',
        parentSessionKey: 'agent:atlas:main',
        attention: 'cron_failed',
        hasActiveRun: false,
        updatedAt: now - 1_000,
      },
      {
        key: 'agent:other:cron:hidden',
        kind: 'cron',
        agentId: 'other',
        title: 'Hidden job',
        attention: 'cron_failed',
        updatedAt: now,
      },
    ];
    mockController.childSessionActivityRef = {
      current: new Map([
        [childSessionKey, {
          sessionKey: childSessionKey,
          agentId: 'atlas',
          status: 'streaming',
          previewText: 'Private streaming preview',
          toolName: null,
          updatedAt: now,
        }],
        ['agent:other:subagent:hidden', {
          sessionKey: 'agent:other:subagent:hidden',
          agentId: 'other',
          status: 'streaming',
          previewText: null,
          toolName: null,
          updatedAt: now,
        }],
      ]),
    };
    mockController.childSessionActivityVersion = 1;
    adapter.capabilities = { ...CAPABILITY_MATRIX.openclaw, logs: true };
    adapter.management.cron = {
      list: jest.fn(async () => ({
        jobs: [{
          id: 'nightly',
          agentId: 'atlas',
          sessionKey: cronSessionKey,
          name: 'Nightly report',
        }],
        total: 1,
        offset: 0,
        limit: 100,
        hasMore: false,
        nextOffset: null,
      })),
      runs: jest.fn(async () => ({
        entries: [{
          ts: now - 1_000,
          jobId: 'nightly',
          action: 'finished',
          status: 'error',
          jobName: '[Cron] Nightly report',
          sessionKey: cronSessionKey,
        }],
        total: 1,
        offset: 0,
        limit: 100,
        hasMore: false,
        nextOffset: null,
      })),
    };
    const onOpenRunSession = jest.fn();
    const onOpenRunLogs = jest.fn();
    const view = render(<ThreadScreen
      {...createNavigationProps()}
      onOpenRunSession={onOpenRunSession}
      onOpenRunLogs={onOpenRunLogs}
    />);

    await waitFor(() => expect(mockThreadViewProps?.runCards).toEqual([
        expect.objectContaining({
          id: childSessionKey,
          kind: 'subagent',
          sessionKey: childSessionKey,
          agentId: 'atlas',
          title: 'Release worker',
          status: 'streaming',
          statusLabel: 'Running',
          timeLabel: expect.any(String),
        }),
        expect.objectContaining({
          id: `nightly:${now - 1_000}`,
          kind: 'cron',
          sessionKey: cronSessionKey,
          jobId: 'nightly',
          agentId: 'atlas',
          title: 'Nightly report',
          status: 'failed',
          statusLabel: 'Failed',
          timeLabel: expect.any(String),
          canOpenLogs: true,
        }),
      ]));
    const callsBeforeChatUpdate = (adapter.management.cron.list as jest.Mock).mock.calls.length;
    mockController.sessions = (mockController.sessions as Array<Record<string, unknown>>).map((session) => (
      session.key === 'agent:atlas:main' ? { ...session, updatedAt: now + 1, totalTokens: 99 } : session
    ));
    view.rerender(<ThreadScreen {...createNavigationProps()} onOpenRunSession={onOpenRunSession} onOpenRunLogs={onOpenRunLogs} />);
    expect((adapter.management.cron.list as jest.Mock).mock.calls).toHaveLength(callsBeforeChatUpdate);
    expect(mockThreadViewProps?.runCards?.some((run) => run.jobId === 'nightly')).toBe(true);
    (adapter.management.cron.list as jest.Mock).mockRejectedValueOnce(new Error('temporary offline'));
    mockApp = { ...mockApp, foregroundEpoch: 2 };
    await act(async () => { view.rerender(<ThreadScreen {...createNavigationProps()} onOpenRunSession={onOpenRunSession} onOpenRunLogs={onOpenRunLogs} />); });
    expect(mockThreadViewProps?.runCards?.some((run) => run.jobId === 'nightly')).toBe(true);

    expect(mockThreadViewProps?.locale).toBe('en');
    expect(mockThreadViewProps?.onOpenRunSession).toBeDefined();
    expect(mockThreadViewProps?.onOpenRunLogs).toBe(onOpenRunLogs);
    act(() => mockThreadViewProps?.onOpenRunSession?.(
      childSessionKey,
      'atlas',
      'subagent',
    ));
    expect(onOpenRunSession).toHaveBeenCalledWith(childSessionKey, 'atlas', 'subagent');
    expect(mockedAnalyticsEvents.runCardOpened).toHaveBeenCalledWith({ kind: 'subagent' });

    // The Cron card carries its run record and opens the execution record sheet on this
    // screen; the sheet, not the card, decides whether the stable cron session opens.
    const cronCard = mockThreadViewProps?.runCards?.find((run) => run.kind === 'cron');
    expect(cronCard?.cronRun).toEqual(expect.objectContaining({ jobId: 'nightly', sessionKey: cronSessionKey }));
    act(() => mockThreadViewProps?.onOpenCronRun?.(cronCard!));
    expect(mockedAnalyticsEvents.runCardOpened).toHaveBeenCalledWith({ kind: 'cron' });
    expect(mockCronRunSheetProps?.run).toEqual(expect.objectContaining({ jobId: 'nightly' }));
    expect(onOpenRunSession).toHaveBeenCalledTimes(1);
    (mockCronRunSheetProps?.onOpenSession as (key: string) => void)(cronSessionKey);
    expect(onOpenRunSession).toHaveBeenLastCalledWith(cronSessionKey, 'atlas', 'cron');
    act(() => (mockCronRunSheetProps?.onClose as () => void)());
    expect(mockCronRunSheetProps?.run).toBeNull();

    view.unmount();
    mockIsPro = false;
    render(<ThreadScreen
      {...createNavigationProps()}
      onOpenRunSession={onOpenRunSession}
      onOpenRunLogs={onOpenRunLogs}
    />);
    await waitFor(() => expect(
      mockThreadViewProps?.runCards?.find((run) => run.kind === 'cron')?.canOpenLogs,
    ).toBe(false));
  });

  it.each(['openclaw', 'hermes'] as const)('paints cached %s scheduled cards with the first ready frame and refreshes without a rebuild', async (backend) => {
    const now = Date.now();
    const cronSessionKey = 'agent:atlas:cron:nightly';
    const cachedRun = {
      id: `nightly:${now - 60_000}`,
      kind: 'cron' as const,
      sessionKey: cronSessionKey,
      jobId: 'nightly',
      agentId: 'atlas',
      title: 'Nightly report',
      status: 'succeeded' as const,
      updatedAt: now - 60_000,
      cronRun: { ts: now - 60_000, jobId: 'nightly', action: 'finished' as const, status: 'ok' as const, sessionKey: cronSessionKey },
    };
    const job = { id: 'nightly', agentId: 'atlas', sessionKey: cronSessionKey, name: 'Nightly report' };
    const page = { total: 1, offset: 0, limit: 100, hasMore: false, nextOffset: null };
    let latestEntry: Record<string, unknown> = { ...cachedRun.cronRun, runAtMs: now - 60_000 };
    mockConnections.activeAdapter = { ...adapter, connection: { ...adapter.connection, backendKind: backend } };
    mockThreadActivityCache.read.mockResolvedValue([cachedRun]);
    adapter.management.cron = {
      list: jest.fn(async () => ({ jobs: [job], ...page })),
      runs: jest.fn(async () => ({ entries: [latestEntry], ...page })),
    };
    // An empty main thread whose history is already known: the first frame must
    // still wait for the local snapshot rather than flash `empty` and then insert.
    mockController.listData = [];
    const view = render(<ThreadScreen {...createNavigationProps()} />);

    await waitFor(() => expect(mockThreadViewProps?.runCards?.map((run) => run.id)).toEqual([cachedRun.id]));
    expect(mockThreadActivityCache.read).toHaveBeenCalledWith({
      connectionId: 'connection-1', agentId: 'atlas', sessionKey: 'agent:atlas:main',
    });
    const firstReady = mockThreadViewRenders.findIndex((entry) => entry.kind === 'ready');
    expect(firstReady).toBeGreaterThanOrEqual(0);
    expect(mockThreadViewRenders.slice(0, firstReady).every((entry) => entry.kind === 'loading')).toBe(true);
    expect(mockThreadViewRenders.slice(firstReady).every((entry) => entry.runCount === 1)).toBe(true);
    const hydratedCards = mockThreadViewProps?.runCards;

    // The network refresh matches the snapshot: same cards, nothing persisted again.
    await waitFor(() => expect(adapter.management.cron.runs as jest.Mock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    mockController.listData = [{ id: 'message-1', role: 'assistant', text: 'Hello' }];
    view.rerender(<ThreadScreen {...createNavigationProps()} />);
    expect(mockThreadViewProps?.runCards).toBe(hydratedCards);
    expect(mockThreadActivityCache.write).not.toHaveBeenCalled();

    // A changed result replaces the cards and refreshes the snapshot.
    latestEntry = { ...latestEntry, status: 'error', error: 'Model unavailable' };
    mockApp = { ...mockApp, foregroundEpoch: 2 };
    await act(async () => { view.rerender(<ThreadScreen {...createNavigationProps()} />); });
    await waitFor(() => expect(mockThreadViewProps?.runCards?.[0]?.status).toBe('failed'));
    expect(mockThreadActivityCache.write).toHaveBeenCalledTimes(1);
    expect(mockThreadActivityCache.write).toHaveBeenCalledWith(
      { connectionId: 'connection-1', agentId: 'atlas', sessionKey: 'agent:atlas:main' },
      [expect.objectContaining({ id: cachedRun.id, status: 'failed', summary: 'Model unavailable' })],
    );
  });

  it('keeps cached cards from painting ahead of messages and settles a fresh result with the history refresh', async () => {
    const now = Date.now();
    const cronSessionKey = 'agent:atlas:cron:nightly';
    const job = { id: 'nightly', agentId: 'atlas', sessionKey: cronSessionKey, name: 'Nightly report' };
    const page = { total: 1, offset: 0, limit: 100, hasMore: false, nextOffset: null };
    adapter.management.cron = {
      list: jest.fn(async () => ({ jobs: [job], ...page })),
      runs: jest.fn(async () => ({
        entries: [{ ts: now - 1_000, jobId: 'nightly', action: 'finished', status: 'ok', sessionKey: cronSessionKey }],
        ...page,
      })),
    };
    mockController.historyLoaded = false;
    mockController.listData = [];
    const view = render(<ThreadScreen {...createNavigationProps()} />);

    await waitFor(() => expect(adapter.management.cron.runs as jest.Mock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Without history the result waits: no cards-only frame while messages are still loading.
    expect(mockThreadViewProps?.runCards).toEqual([]);
    expect(mockThreadViewProps?.state.kind).toBe('loading');

    mockController.historyLoaded = true;
    mockController.listData = [{ id: 'message-1', role: 'assistant', text: 'Hello' }];
    view.rerender(<ThreadScreen {...createNavigationProps()} />);
    await waitFor(() => expect(mockThreadViewProps?.runCards?.map((run) => run.jobId)).toEqual(['nightly']));
    expect(mockThreadViewProps?.state.kind).toBe('ready');
    expect(mockThreadActivityCache.write).toHaveBeenCalledTimes(1);
  });

  it('opens only image URIs when a message also carries file attachments', () => {
    render(<ThreadScreen {...createNavigationProps()} />);
    const openPreview = (mockController.preview as { openPreview: jest.Mock }).openPreview;

    act(() => mockThreadViewProps?.onOpenAttachments?.({
      id: 'file-only',
      role: 'user',
      text: 'Review this file',
      fileAttachments: [{
        mimeType: 'application/pdf',
        fileName: 'spec.pdf',
        uri: 'file:///spec.pdf',
      }],
    }));
    expect(openPreview).not.toHaveBeenCalled();

    act(() => mockThreadViewProps?.onOpenAttachments?.({
      id: 'mixed',
      role: 'user',
      text: 'Review these attachments',
      imageUris: ['file:///photo.png'],
      fileAttachments: [{
        mimeType: 'text/plain',
        fileName: 'notes.txt',
        uri: 'file:///notes.txt',
      }],
    }));
    expect(openPreview).toHaveBeenCalledWith(['file:///photo.png'], 0);

    // The tapped photo's position opens the viewer there; out-of-range indexes clamp.
    act(() => mockThreadViewProps?.onOpenAttachments?.({
      id: 'album',
      role: 'user',
      text: '',
      imageUris: ['file:///one.png', 'file:///two.png', 'file:///three.png'],
    }, 2));
    expect(openPreview).toHaveBeenLastCalledWith(['file:///one.png', 'file:///two.png', 'file:///three.png'], 2);
    act(() => mockThreadViewProps?.onOpenAttachments?.({
      id: 'album',
      role: 'user',
      text: '',
      imageUris: ['file:///one.png', 'file:///two.png'],
    }, 9));
    expect(openPreview).toHaveBeenLastCalledWith(['file:///one.png', 'file:///two.png'], 1);
  });

  it('keeps Hermes image actions while withholding non-image file entry points', () => {
    adapter.capabilities = { ...CAPABILITY_MATRIX.hermes };
    render(<ThreadScreen {...createNavigationProps()} />);

    expect(mockThreadViewProps?.onPickImage).toBe(mockController.pickImage);
    expect(mockThreadViewProps?.onTakePhoto).toBe(mockController.takePhoto);
    expect(mockThreadViewProps?.onPasteFiles).toBe(mockController.onPasteFiles);
    expect(mockThreadViewProps?.onChooseFile).toBeUndefined();
    expect(mockThreadOverlayProps?.attachmentsEnabled).toBe(true);
    expect(mockThreadOverlayProps?.onPickImage).toBe(mockController.pickImage);
    expect(mockThreadOverlayProps?.onTakePhoto).toBe(mockController.takePhoto);
    expect(mockThreadOverlayProps?.onChooseFile).toBeUndefined();
  });

  it('gates every Add sheet entry by backend capability for OpenClaw, Hermes and YouMind', () => {
    const props = createNavigationProps();
    adapter.capabilities = { ...CAPABILITY_MATRIX.openclaw };
    const view = render(<ThreadScreen {...props} />);

    expect(mockThreadViewProps?.onOpenAddMenu).toBeDefined();
    expect(mockThreadOverlayProps?.onAttachRecentPhotos).toBe(mockController.attachLocalImages);
    expect(mockThreadOverlayProps?.remainingAttachmentSlots).toBe(6);
    expect(mockThreadOverlayProps?.onOpenCommands).toBeDefined();
    expect(mockThreadOverlayProps?.onOpenSkills).toBeDefined();
    expect(mockThreadOverlayProps?.commandsSheet.visible).toBe(false);
    act(() => mockThreadOverlayProps?.onOpenCommands?.());
    expect(mockThreadOverlayProps?.commandsSheet.visible).toBe(true);
    const command = { key: 'status', command: '/status', description: 'Show session status', action: 'send' as const };
    act(() => mockThreadOverlayProps?.commandsSheet.onSelect(command));
    expect(mockController.onSelectSlashCommand).toHaveBeenCalledWith(command, 'commands_sheet');
    act(() => mockThreadOverlayProps?.commandsSheet.onClose());
    expect(mockThreadOverlayProps?.commandsSheet.visible).toBe(false);
    expect(mockThreadOverlayProps?.onCreateScheduledTask).toBeDefined();
    expect(mockThreadOverlayProps?.onOpenTools).toBeDefined();

    act(() => mockThreadOverlayProps?.onCreateScheduledTask?.());
    expect(props.navigation.navigate).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'connection-1',
      agentId: 'atlas',
      section: 'cron',
      action: 'create-cron',
      cronPrompt: 'Draft',
    });
    act(() => mockThreadOverlayProps?.onOpenTools?.());
    expect(props.navigation.navigate).toHaveBeenLastCalledWith('AgentSettingsSection', expect.objectContaining({ section: 'tools' }));
    act(() => mockThreadOverlayProps?.onAddPresented?.({ photoAccess: 'granted' }));
    expect(mockedAnalyticsEvents.chatAddMenuOpened).toHaveBeenCalledWith({ backend: 'openclaw', photo_access: 'granted' });
    act(() => mockThreadOverlayProps?.onAddAction?.('recent-photos', 2));
    expect(mockedAnalyticsEvents.chatAddMenuAction).toHaveBeenCalledWith({ backend: 'openclaw', action: 'recent-photos', count: 2 });

    adapter.capabilities = { ...CAPABILITY_MATRIX.hermes };
    view.rerender(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.onOpenAddMenu).toBeDefined();
    expect(mockThreadOverlayProps?.onAttachRecentPhotos).toBe(mockController.attachLocalImages);
    // Hermes only interprets its inline directives; the OpenClaw catalog must not be offered.
    expect(mockThreadOverlayProps?.onOpenCommands).toBeUndefined();
    expect(mockThreadOverlayProps?.onOpenSkills).toBeDefined();
    expect(mockThreadOverlayProps?.onCreateScheduledTask).toBeDefined();
    expect(mockThreadOverlayProps?.onOpenTools).toBeUndefined();

    adapter.capabilities = { ...CAPABILITY_MATRIX.youmind };
    view.rerender(<ThreadScreen {...props} />);
    expect(mockThreadViewProps?.onOpenAddMenu).toBeUndefined();
    expect(mockThreadOverlayProps?.onAttachRecentPhotos).toBeUndefined();
    expect(mockThreadOverlayProps?.onOpenCommands).toBeUndefined();
    expect(mockThreadOverlayProps?.onOpenSkills).toBeUndefined();
    expect(mockThreadOverlayProps?.onCreateScheduledTask).toBeUndefined();
    expect(mockThreadOverlayProps?.onOpenTools).toBeUndefined();
  });

  it('activates an inactive route and keeps the view in loading with no optimistic capabilities', async () => {
    mockConnections = {
      ...mockConnections,
      switching: true,
      activeConnectionId: 'connection-2',
      activeAdapter: null,
    };
    mockRuntime.getSnapshot.mockReturnValue({ activeConnectionId: 'connection-2' });
    render(<ThreadScreen {...createNavigationProps()} />);

    await waitFor(() => expect(mockRuntime.activate).toHaveBeenCalledWith('connection-1'));
    expect(mockThreadViewProps?.state).toEqual({ kind: 'loading' });
    expect(mockThreadViewProps?.capabilities.chat).toBe(false);
    expect(mockThreadViewProps?.capabilities.sessions).toBe(false);
  });

  it('maps a structured adapter failure through its product error descriptor', async () => {
    mockConnections = {
      ...mockConnections,
      activeConnectionId: 'connection-2',
      activeAdapter: null,
    };
    mockRuntime.getSnapshot.mockReturnValue({ activeConnectionId: 'connection-2' });
    mockRuntime.activate.mockRejectedValueOnce({
      code: 'bridge_offline',
      message: 'low-level socket detail',
    });
    render(<ThreadScreen {...createNavigationProps()} />);

    await waitFor(() => expect(mockThreadViewProps?.state).toEqual({
      kind: 'error',
      code: 'bridge_offline',
      message: 'Bridge is not running on your computer',
      actionLabel: 'Help',
    }));
  });

  it('maps coordinator failures and quota locks to explicit view states', () => {
    mockConnections = {
      ...mockConnections,
      error: {
        operation: 'probe',
        connectionId: 'connection-1',
        message: 'Bridge unavailable',
      },
    };
    const failure = render(<ThreadScreen {...createNavigationProps()} />);
    expect(mockThreadViewProps?.state).toEqual({
      kind: 'error',
      code: 'network',
      message: 'Bridge unavailable',
      actionLabel: 'Retry',
    });
    failure.unmount();

    render(<ThreadScreen {...createNavigationProps()} locked />);
    expect(mockThreadViewProps?.state).toEqual({ kind: 'locked' });
  });

  it('does not activate or expose an adapter for a locked inactive connection', async () => {
    mockConnections = {
      ...mockConnections,
      switching: true,
      activeConnectionId: 'connection-2',
      activeAdapter: adapter,
    };
    mockRuntime.getSnapshot.mockReturnValue({ activeConnectionId: 'connection-2' });

    render(<ThreadScreen {...createNavigationProps()} locked />);

    await act(async () => Promise.resolve());
    expect(mockRuntime.activate).not.toHaveBeenCalled();
    expect(mockThreadViewProps?.state).toEqual({ kind: 'locked' });
    expect(mockThreadViewProps?.capabilities.chat).toBe(false);
  });
});
