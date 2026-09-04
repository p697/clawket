import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatScreenLayout } from './ChatScreenLayout';

const chatHeaderMock = jest.fn();
const chatComposerPaneMock = jest.fn();

const gatewayMock = {
  getBackendCapabilities: jest.fn(),
  getBaseUrl: jest.fn(() => 'https://example.com'),
};

const appContextMock = {
  activeGatewayConfigId: 'cfg-1',
  currentAgentId: 'agent-1',
  agentAvatars: {},
  setAgentAvatars: jest.fn(),
  agents: [{ id: 'agent-1', name: 'Agent 1', identity: { name: 'Agent 1', emoji: 'A' } }],
  gateway: gatewayMock,
  gatewayEpoch: 0,
  showModelUsage: false,
  chatFontSize: 16,
  chatAppearance: { background: { enabled: false, imagePath: null } },
  config: { backendKind: 'hermes' as 'openclaw' | 'hermes' },
  isMultiAgent: false,
  switchAgent: jest.fn(),
  debugMode: false,
  onSaved: jest.fn(),
};

jest.mock('react-native', () => {
  const React = require('react');
  const primitive = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) => (
    React.createElement(name, props, children)
  );

  class AnimatedValue {
    interpolate() {
      return '0deg';
    }

    setValue() {}

    stopAnimation() {}
  }

  return {
    Animated: {
      View: primitive('AnimatedView'),
      Value: AnimatedValue,
      delay: (value: unknown) => value,
      loop: () => ({ start: jest.fn(), stop: jest.fn() }),
      sequence: (value: unknown) => value,
      timing: () => ({ start: (callback?: (value: { finished: boolean }) => void) => callback?.({ finished: true }), stop: jest.fn() }),
    },
    LayoutAnimation: {
      Types: { spring: 'spring', easeInEaseOut: 'easeInEaseOut' },
      Properties: { opacity: 'opacity' },
      configureNext: jest.fn(),
    },
    Platform: {
      OS: 'ios',
    },
    Pressable: primitive('Pressable'),
    ScrollView: primitive('ScrollView'),
    StyleSheet: {
      absoluteFillObject: {},
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    UIManager: {
      setLayoutAnimationEnabledExperimental: jest.fn(),
    },
    View: primitive('View'),
    useWindowDimensions: () => ({
      width: 375,
      height: 812,
      scale: 1,
      fontScale: 1,
    }),
  };
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: {
      View: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    },
  };
});

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => appContextMock,
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => ({
    isPro: true,
    showPaywall: jest.fn(),
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: {
        background: '#fff',
        text: '#111',
        textMuted: '#666',
        textSubtle: '#999',
        border: '#ddd',
        primary: '#0a84ff',
        primaryText: '#fff',
        surfaceMuted: '#f2f2f2',
        inputBackground: '#f5f5f5',
        badgeModel: '#1f7',
        badgeThinking: '#fa0',
        badgeTools: '#08f',
        badgePrompts: '#f0a',
        warning: '#f90',
        iconOnColor: '#fff',
      },
    },
  }),
}));

jest.mock('../../hooks/useShareIntent', () => ({
  useShareIntent: jest.fn(),
}));

jest.mock('../../hooks/useChatGatewaySwitcher', () => ({
  useChatGatewaySwitcher: () => ({
    configs: [],
    activeConfigId: null,
    loading: false,
    activateConfig: jest.fn(),
    refreshConfigs: jest.fn(async () => {}),
  }),
}));

jest.mock('../../services/agent-avatar', () => ({
  pickAvatarImage: jest.fn(),
  saveAgentAvatar: jest.fn(),
  removeAgentAvatar: jest.fn(),
  buildAvatarKey: jest.fn(() => 'avatar-key'),
  readAgentAvatar: jest.fn(() => null),
}));

jest.mock('../../services/auto-app-review', () => ({
  scheduleAutomaticAppReview: jest.fn(),
}));

jest.mock('../../connection/hermes-connect-trace', () => ({
  finishHermesConnectTrace: jest.fn(),
  markHermesConnectTrace: jest.fn(),
}));

jest.mock('../../utils/usage-format', () => ({
  formatSessionContextLabel: jest.fn(() => null),
}));

jest.mock('../../utils/pro', () => ({
  canAddAgent: jest.fn(() => true),
}));

jest.mock('../../utils/agent-avatar-uri', () => ({
  pickAgentIdentityAvatarUri: jest.fn(() => null),
}));

jest.mock('./hooks/chatSyncPolicy', () => ({
  getChatHeaderSyncState: jest.fn(() => ({
    isConnecting: false,
    status: null,
    busy: false,
  })),
}));

jest.mock('./hooks/chatHeaderStatusLabel', () => ({
  getChatHeaderStatusLabel: jest.fn(() => null),
}));

jest.mock('./hooks/useChatListViewport', () => ({
  useChatListViewport: () => ({
    onListContentSizeChange: jest.fn(),
    onScrollBeginDrag: jest.fn(),
    onScrollEndDrag: jest.fn(),
    onScrollStateChange: jest.fn(),
    onScrollToBottom: jest.fn(),
    showScrollButton: false,
  }),
}));

jest.mock('./hooks/useChatMessageEntrance', () => ({
  useChatMessageEntrance: () => ({
    listFadeAnim: null,
    newMessageIds: new Set<string>(),
  }),
}));

jest.mock('./hooks/useChatMessageSelection', () => ({
  useChatMessageSelection: () => ({
    clearSelection: jest.fn(),
    copiedSelected: false,
    copyButtonSize: 40,
    copySelectedMessage: jest.fn(),
    handleSelectMessage: jest.fn(),
    hasSelectedMessageText: false,
    selectedFrames: null,
    selectedMessageFavorited: false,
    selectedMessage: null,
    selectedMessageId: null,
    selectedMessageVisible: false,
    selectionAnim: { value: 0 },
    toggleSelectedMessageFavorite: jest.fn(),
    toggleMessageSelection: jest.fn(),
  }),
}));

jest.mock('./hooks/useMessageFavorites', () => ({
  useMessageFavorites: () => ({
    favoriteMessageIdSet: new Set<string>(),
    isFavoritedMessage: jest.fn(() => false),
    toggleFavorite: jest.fn(),
  }),
}));

jest.mock('./hooks/useRotatingPlaceholder', () => ({
  useRotatingPlaceholder: () => 'Thinking...',
}));

jest.mock('./hooks/useChatKeyboardLayout', () => ({
  useChatKeyboardLayout: () => ({
    animatedRootStyle: {},
    composerBottomPadding: 0,
    composerSwipeGesture: {},
    handleComposerBlur: jest.fn(),
    handleComposerFocus: jest.fn(),
    modalBottomInset: 0,
    slashSuggestionsMaxHeight: 200,
  }),
}));

jest.mock('./components/renderChatMessageBubble', () => ({
  renderChatMessageBubble: jest.fn(() => null),
}));

jest.mock('./hooks/childSessionActivity', () => ({
  buildChildSessionActivityCards: jest.fn(() => []),
}));

jest.mock('../../components/chat/ChatHeader', () => ({
  ChatHeader: (props: unknown) => {
    chatHeaderMock(props);
    return null;
  },
}));

jest.mock('../../components/chat/ChildSessionActivityStrip', () => ({
  ChildSessionActivityStrip: () => null,
}));

jest.mock('../../components/chat/CompactionBanner', () => ({
  CompactionBanner: () => null,
}));

jest.mock('../../components/chat/ChatBackgroundLayer', () => ({
  ChatBackgroundLayer: () => null,
}));

jest.mock('../../components/chat/DebugOverlay', () => ({
  DebugOverlay: () => null,
}));

jest.mock('../../components/chat/PairingPendingCard', () => ({
  PairingPendingCard: () => null,
}));

jest.mock('../../components/config/QuickConnectionPanel', () => ({
  QuickConnectionPanel: () => null,
}));

jest.mock('./components/ChatComposerPane', () => ({
  ChatComposerPane: (props: unknown) => {
    chatComposerPaneMock(props);
    return null;
  },
}));

jest.mock('./components/ChatMessagePane', () => ({
  ChatMessagePane: () => null,
}));

jest.mock('./components/ChatOverlays', () => ({
  ChatOverlays: () => null,
}));

function createController() {
  return {
    agentActivityRef: { current: new Map() },
    agentActiveCount: 0,
    activityLabel: null,
    agentAvatarUri: null,
    agentDisplayName: 'Agent 1',
    agentEmoji: null,
    approveCommand: '',
    availableModels: [],
    availableProviders: [],
    canAbortCurrentRun: false,
    canAddMoreImages: true,
    canSend: true,
    childSessionActivityRef: { current: new Map() },
    childSessionActivityVersion: 0,
    clearChildSessionActivities: jest.fn(),
    closeCommandPicker: jest.fn(),
    closeStaticThinkPicker: jest.fn(),
    commandPickerError: null,
    commandPickerLoading: false,
    commandPickerOptions: [],
    commandPickerTitle: '',
    commandPickerVisible: false,
    compactionNotice: null,
    composerRef: { current: null },
    connectionState: 'ready',
    copied: false,
    currentModel: null,
    currentModelProvider: null,
    debugLog: [],
    dismissSlashSuggestions: jest.fn(),
    handleCopyCommand: jest.fn(),
    handlePairingRetry: jest.fn(),
    historyLoaded: true,
    input: '',
    isSending: false,
    keyboardVisible: false,
    listData: [],
    loadingMoreHistory: false,
    onLoadMoreHistory: jest.fn(),
    onRefresh: jest.fn(),
    onSelectCommandOption: jest.fn(),
    onSelectModel: jest.fn(),
    onSelectSlashCommand: jest.fn(),
    onSelectStaticThinkLevel: jest.fn(),
    onSend: jest.fn(),
    openModelPicker: jest.fn(),
    openSlashMenu: jest.fn(),
    pairngPending: false,
    pairingPending: false,
    pendingImages: [],
    pickFile: jest.fn(),
    pickImage: jest.fn(),
    preview: {
      closePreview: jest.fn(),
      openPreview: jest.fn(),
      previewIndex: 0,
      previewUris: [],
      previewVisible: false,
      screenHeight: 800,
      screenWidth: 400,
      setPreviewIndex: jest.fn(),
    },
    refreshing: false,
    removePendingImage: jest.fn(),
    resolveApproval: jest.fn(),
    retryCommandPickerLoad: jest.fn(),
    retryModelPickerLoad: jest.fn(),
    scrollToBottomRequestAt: null,
    sessionKey: 'main',
    sessions: [{ key: 'main', label: 'Main', kind: 'direct' }],
    setInput: jest.fn(),
    setModelPickerVisible: jest.fn(),
    setPendingImages: jest.fn(),
    showAgentAvatar: true,
    showDebug: false,
    showSlashSuggestions: false,
    slashSuggestions: [],
    staticThinkPickerVisible: false,
    switchSession: jest.fn(),
    takePhoto: jest.fn(),
    thinkingLevel: 'off',
    thinkingLevelOptions: ['off', 'minimal', 'low'],
    toggleVoiceInput: jest.fn(),
    voiceInputActive: false,
    voiceInputDisabled: false,
    voiceInputLevel: 0,
    voiceInputState: 'idle',
    voiceInputSupported: false,
  };
}

describe('ChatScreenLayout backend capability updates', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    chatHeaderMock.mockClear();
    chatComposerPaneMock.mockClear();
    appContextMock.config = { backendKind: 'hermes' };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('updates Tools badge visibility when backend changes on the same gateway instance', () => {
    const controller = createController();
    const { rerender } = render(
      React.createElement(ChatScreenLayout, {
        controller: controller as never,
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        onOpenSidebar: jest.fn(),
        onAddGatewayConnection: jest.fn(),
        onOpenQuickConnectionFlow: jest.fn(),
        onManageAgents: jest.fn(),
      }),
    );

    expect(chatComposerPaneMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onWebSearchPress: undefined,
      }),
    );

    appContextMock.config = { backendKind: 'openclaw' };
    rerender(
      React.createElement(ChatScreenLayout, {
        controller: controller as never,
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        onOpenSidebar: jest.fn(),
        onAddGatewayConnection: jest.fn(),
        onOpenQuickConnectionFlow: jest.fn(),
        onManageAgents: jest.fn(),
      }),
    );

    expect(chatComposerPaneMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onWebSearchPress: expect.any(Function),
      }),
    );
  });
});
