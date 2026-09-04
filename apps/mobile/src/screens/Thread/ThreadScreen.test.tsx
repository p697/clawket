import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import { ThreadScreen, type ThreadScreenProps } from './ThreadScreen';
import type { ThreadViewProps } from './ThreadView';

let mockThreadViewProps: ThreadViewProps | null = null;
let mockConnections: Record<string, unknown>;
let mockApp: Record<string, unknown>;
let mockController: Record<string, unknown>;

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
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => mockApp,
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockRuntime,
  useConnections: () => mockConnections,
}));

jest.mock('../ChatScreen/hooks/useChatController', () => ({
  useChatController: () => mockController,
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

const adapter = {
  capabilities: { ...CAPABILITY_MATRIX.openclaw },
  cancel: jest.fn(async () => undefined),
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
  return {
    activityLabel: null,
    agentDisplayName: 'Controller Atlas',
    canSend: true,
    connectionState: 'ready',
    currentModelHeaderLabel: 'Sonnet',
    hasMoreHistory: true,
    historyLoaded: true,
    input: 'Draft',
    isSending: false,
    listData: [{ id: 'message-1', role: 'assistant', text: 'Hello' }],
    loadingMoreHistory: false,
    onLoadMoreHistory: jest.fn(),
    onSend: jest.fn(),
    pickImage: jest.fn(),
    preview: { openPreview: jest.fn() },
    resolveApproval: jest.fn(),
    sessionKey: 'agent:atlas:main',
    sessions: [{
      key: 'agent:atlas:main',
      title: 'Main thread',
      totalTokens: 46,
      totalTokensFresh: true,
      contextTokens: 100,
    }],
    setInput: jest.fn(),
    toggleVoiceInput: jest.fn(),
    voiceInputSupported: true,
  };
}

function createApp(): Record<string, unknown> {
  return {
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
    mockConnections = {
      initialized: true,
      switching: false,
      activeConnectionId: 'connection-1',
      activeAdapter: adapter,
      error: null,
    };
    mockApp = createApp();
    mockController = createController();
    adapter.cancel.mockClear();
    mockRuntime.activate.mockClear();
    mockRuntime.probeActive.mockClear();
    mockRuntime.getSnapshot.mockReturnValue({ activeConnectionId: 'connection-1' });
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
      onOpenAttachments,
    });

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
    expect(adapter.cancel).toHaveBeenCalledWith('agent:atlas:main');
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
