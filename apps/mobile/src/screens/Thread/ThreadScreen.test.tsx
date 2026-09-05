import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import type { ComposerHandle } from '../../components/ui/Composer';
import { ThreadScreen, type ThreadScreenProps } from './ThreadScreen';
import type { ThreadViewProps } from './ThreadView';
import type { ThreadOverlaysProps } from './components/ThreadOverlays';

let mockThreadViewProps: ThreadViewProps | null = null;
let mockThreadOverlayProps: ThreadOverlaysProps | null = null;
let mockConnections: Record<string, unknown>;
let mockApp: Record<string, unknown>;
let mockController: Record<string, unknown>;
let mockIsPro = true;
const mockToggleFavorite = jest.fn(async () => ({ favorited: true, favoriteKey: 'favorite-1' }));
const mockIsFavoritedMessage = jest.fn(() => false);

const mockRuntime = {
  activate: jest.fn(async () => undefined),
  probeActive: jest.fn(async () => true),
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

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => mockApp,
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => ({ isPro: mockIsPro }),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockRuntime,
  useConnections: () => mockConnections,
}));

jest.mock('../../chat/useChatController', () => ({
  useChatController: () => mockController,
}));

jest.mock('../../chat/useMessageFavorites', () => ({
  useMessageFavorites: () => ({
    favoriteMessageIdSet: new Set<string>(),
    isFavoritedMessage: mockIsFavoritedMessage,
    toggleFavorite: mockToggleFavorite,
  }),
}));

jest.mock('../../services/app-update-announcement', () => ({
  getCurrentAppUpdateAnnouncement: jest.fn(() => null),
  getCurrentAppVersion: jest.fn(() => '3.0.0'),
  markCurrentAppUpdateAnnouncementShown: jest.fn(async () => undefined),
  shouldShowCurrentAppUpdateAnnouncement: jest.fn(async () => false),
}));

jest.mock('./ThreadView', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ThreadView: (props: ThreadViewProps) => {
      mockThreadViewProps = props;
      return ReactRuntime.createElement(View, { testID: 'connected-thread-view' });
    },
  };
});

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
  connection: { id: 'connection-1' },
  capabilities: { ...CAPABILITY_MATRIX.openclaw },
  cancel: jest.fn(async () => undefined),
  management: { cron: {} as Record<string, unknown> },
};

function createNavigationProps(): ThreadScreenProps {
  return {
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
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
    availableModels: [],
    availableProviders: [],
    canAddMoreImages: true,
    canAbortCurrentRun: true,
    canSend: true,
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
    mockThreadViewProps = null;
    mockThreadOverlayProps = null;
    mockConnections = {
      initialized: true,
      switching: false,
      activeConnectionId: 'connection-1',
      activeAdapter: adapter,
      connections: [{ id: 'connection-1', label: 'OpenClaw Preview' }],
      roster: [],
      error: null,
    };
    mockApp = createApp();
    mockController = createController();
    mockIsPro = true;
    adapter.capabilities = { ...CAPABILITY_MATRIX.openclaw };
    adapter.management.cron = {};
    adapter.cancel.mockClear();
    mockRuntime.activate.mockClear();
    mockRuntime.probeActive.mockClear();
    mockRuntime.getSnapshot.mockReturnValue({ activeConnectionId: 'connection-1' });
    mockToggleFavorite.mockClear();
    mockIsFavoritedMessage.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
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
    expect(mockApp.requestChatSession).toHaveBeenCalledWith('agent:atlas:main', 'roster');
    expect(onThreadOpened).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      agentId: 'atlas',
      sessionKey: 'agent:atlas:main',
      from: 'roster',
    });
    expect(mockThreadViewProps).toMatchObject({
      agentId: 'atlas',
      agentName: 'Atlas',
      model: 'Sonnet',
      contextUsed: 46,
      contextWindow: 100,
      state: { kind: 'ready' },
      capabilities: adapter.capabilities,
      topInset: 24,
      bottomInset: 16,
    });
    expect(mockThreadViewProps?.composerRef).toBe(mockController.composerRef);
    expect(mockThreadViewProps?.onPasteFiles).toBe(mockController.onPasteFiles);
    expect(mockThreadViewProps?.onPasteFailed).toBe(mockController.onPasteFailed);

    const message = mockThreadViewProps?.messages[0];
    expect(message).toBeDefined();
    act(() => {
      if (message) mockThreadViewProps?.onOpenAttachments?.(message);
    });
    expect(onOpenAttachments).toHaveBeenCalledWith(message);

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
    expect(mockThreadOverlayProps?.stopConfirmation.visible).toBe(true);
    expect(adapter.cancel).not.toHaveBeenCalled();
    act(() => mockThreadOverlayProps?.stopConfirmation.onConfirm());
    expect(mockController.abortCurrentRun).toHaveBeenCalledTimes(1);
    expect(mockThreadOverlayProps?.stopConfirmation.visible).toBe(false);
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
    expect(mockThreadViewProps?.locale).toBe('en');
    expect(mockThreadViewProps?.onOpenRunSession).toBe(onOpenRunSession);
    expect(mockThreadViewProps?.onOpenRunLogs).toBe(onOpenRunLogs);
    act(() => mockThreadViewProps?.onOpenRunSession?.(
      childSessionKey,
      'atlas',
      'subagent',
    ));
    expect(onOpenRunSession).toHaveBeenCalledWith(childSessionKey, 'atlas', 'subagent');

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
});
