import React from 'react';
import {
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import {
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type ManagementOperations,
} from '@clawket/agent-protocol';
import { analyticsEvents } from '../../services/analytics/events';
import { FontSize, Radius } from '../../theme/tokens';
import {
  AgentSettingsSectionScreen,
  AgentSettingsSectionView,
  type AgentSettingsSectionScreenProps,
  type AgentSettingsSectionViewProps,
} from './AgentSettingsSectionScreen';
import { buildAgentSettingsSectionModel } from './section-model';

const colors = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  accent: '#1F5EFF',
  accentSoft: '#E8EEFF',
  good: '#178A6A',
  goodSoft: '#E4F3EE',
  warn: '#D9791C',
  warnSoft: '#FAEDE1',
  bad: '#D64545',
  badSoft: '#F9E7E7',
};

let mockRuntime: Record<string, unknown>;
const mockCoordinator = {
  activate: jest.fn(async () => undefined),
  getSnapshot: jest.fn(),
  probeActive: jest.fn(async () => true),
};
const mockedAnalyticsEvents = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockCoordinator,
  useConnections: () => mockRuntime,
}));

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    settingsRowOpened: jest.fn(),
  },
}));

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      name,
      {
        ...props,
        ref,
        style: typeof style === 'function' ? style({ pressed: false }) : style,
      },
      children,
    ),
  );
  return {
    Platform: {
      OS: 'ios',
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props);
  return new Proxy({}, { get: () => icon });
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: { scheme: 'light', colors } }),
}));

jest.mock('../../components/ui/Banner', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Banner: ({ testID, message, actionLabel, onAction }: {
      testID?: string;
      message: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, message),
      actionLabel
        ? ReactRuntime.createElement(
          Pressable,
          { testID: `${testID}-action`, onPress: onAction },
          ReactRuntime.createElement(Text, null, actionLabel),
        )
        : null,
    ),
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: ({ testID, onPress, accessibilityLabel }: {
      testID?: string;
      onPress: () => void;
      accessibilityLabel: string;
    }) => ReactRuntime.createElement(Pressable, { testID, onPress, accessibilityLabel }),
  };
});

jest.mock('../../components/ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  return {
    ConfirmationModal: ({
      visible,
      testID,
      onClose,
      onConfirm,
    }: {
      visible: boolean;
      testID: string;
      onClose: () => void;
      onConfirm: () => void;
    }) => visible
      ? ReactRuntime.createElement(
        'ConfirmationModal',
        { testID },
        ReactRuntime.createElement('ConfirmationCancel', {
          testID: `${testID}-cancel`,
          onPress: onClose,
        }),
        ReactRuntime.createElement('ConfirmationConfirm', {
          testID: `${testID}-confirm`,
          onPress: onConfirm,
        }),
      )
      : null,
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('./ModelsScreen', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ModelsScreen: () => ReactRuntime.createElement(View, { testID: 'mock-models-screen' }),
  };
});

jest.mock('./SkillsSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    SkillsSection: (props: Record<string, unknown>) => ReactRuntime.createElement(View, { ...props, testID: 'mock-skills-section' }),
  };
});

jest.mock('./CronEditorScreen', () => {
  const ReactRuntime = require('react');
  return { CronEditorScreen: (props: Record<string, unknown>) => ReactRuntime.createElement('View', { ...props, testID: 'mock-cron-editor' }) };
});

jest.mock('./CronSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    CronSection: () => ReactRuntime.createElement(View, { testID: 'mock-cron-section' }),
  };
});

jest.mock('./FilesSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    FilesSection: () => ReactRuntime.createElement(View, { testID: 'mock-files-section' }),
  };
});

jest.mock('./UsageSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    UsageSection: () => ReactRuntime.createElement(View, { testID: 'mock-usage-section' }),
  };
});

jest.mock('./IdentityScreen', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    IdentityScreen: (props: { openCreateOnMount?: boolean }) => ReactRuntime.createElement(View, {
      testID: 'mock-identity-screen',
      openCreateOnMount: props.openCreateOnMount,
    }),
  };
});

jest.mock('./ToolsSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ToolsSection: () => ReactRuntime.createElement(View, { testID: 'mock-tools-section' }),
  };
});

jest.mock('./ChannelsDevicesSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ChannelsDevicesSection: () => ReactRuntime.createElement(View, { testID: 'mock-channels-devices-section' }),
  };
});

jest.mock('./LogsSection', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    LogsSection: () => ReactRuntime.createElement(View, { testID: 'mock-logs-section' }),
  };
});

jest.mock('./OpenClawManageScreen', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    OpenClawManageScreen: () => ReactRuntime.createElement(View, { testID: 'mock-openclaw-manage-screen' }),
  };
});

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

const connection: ConnectionDescriptor = {
  id: 'studio',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Studio',
  environment: 'preview',
  createdAt: 1,
  isFreeSlot: true,
};

const agent: AgentDescriptor = {
  connectionId: connection.id,
  agentId: 'main',
  name: 'Lucy',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

const operation = jest.fn();
const management = {
  models: { getSelection: operation, listThinkingLevels: operation },
  skills: { status: operation, discover: operation },
  cron: {
    list: operation,
    add: operation,
    heartbeat: { get: operation, set: operation },
  },
  agents: {
    update: operation,
    files: { list: operation, get: operation, set: operation },
  },
  usage: { sessions: operation, cost: operation },
  config: {
    view: operation,
    permissions: operation,
    doctor: operation,
    backups: { list: operation },
  },
  tools: { catalog: operation },
  channels: { status: operation },
  devices: { list: operation },
  nodes: { list: operation },
  logs: { fetch: operation },
} as unknown as ManagementOperations;

const adapter = {
  connection,
  capabilities: { ...CAPABILITY_MATRIX.openclaw },
  state: 'ready',
  management,
} as unknown as AgentAdapter;

function viewProps(
  section: Parameters<typeof buildAgentSettingsSectionModel>[0]['section'] = 'models',
  patch: Partial<AgentSettingsSectionViewProps> = {},
): AgentSettingsSectionViewProps {
  return {
    model: buildAgentSettingsSectionModel({
      section,
      capabilities: { ...CAPABILITY_MATRIX.openclaw },
      management,
      connection,
      connectionState: 'ready',
      isPro: true,
    }),
    backend: connection.backendKind,
    connectionLabel: connection.label,
    state: 'ready',
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onAction: jest.fn(),
    onOpenPaywall: jest.fn(),
    ...patch,
  };
}

describe('AgentSettingsSectionView', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders canonical section chrome and resolves a model action', () => {
    const onBack = jest.fn();
    const onAction = jest.fn();
    const view = render(
      <AgentSettingsSectionView {...viewProps('models', { onBack, onAction })} />,
    );

    expect(flattenStyle(view.getByTestId('agent-settings-section-screen').props.style))
      .toMatchObject({ backgroundColor: colors.canvasGrouped, paddingTop: 24 });
    expect(flattenStyle(view.getByTestId('agent-settings-section-title').props.style))
      .toMatchObject({ color: colors.ink, fontSize: FontSize.title });
    expect(flattenStyle(view.getByTestId('agent-settings-section-model-group').props.style))
      .toMatchObject({ backgroundColor: colors.surfaceFloating, borderRadius: Radius.settingsGroup });
    expect(flattenStyle(view.getByTestId('agent-settings-section-model-group').props.style))
      .not.toHaveProperty('borderWidth');

    fireEvent.press(view.getByTestId('agent-settings-section-back'));
    fireEvent.press(view.getByTestId('agent-settings-section-row-models.default'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('models.default');
    expect(mockedAnalyticsEvents.settingsRowOpened).toHaveBeenCalledWith({
      row: 'models.default',
      locked: false,
      backend: 'openclaw',
    });
  });

  it('shows unsupported and Pro-locked states without exposing actions', () => {
    const unsupported = render(
      <AgentSettingsSectionView
        {...viewProps('models', {
          model: buildAgentSettingsSectionModel({
            section: 'models',
            capabilities: { ...CAPABILITY_MATRIX.youmind },
            management,
            connection,
            connectionState: 'ready',
            isPro: true,
          }),
          state: 'unsupported',
        })}
      />,
    );
    expect(unsupported.getByText('Not supported by this backend')).toBeTruthy();
    expect(unsupported.queryByTestId('agent-settings-section-row-models.default')).toBeNull();
    unsupported.unmount();

    const onOpenPaywall = jest.fn();
    const onAction = jest.fn();
    const lockedModel = buildAgentSettingsSectionModel({
      section: 'logs',
      capabilities: { ...CAPABILITY_MATRIX.openclaw },
      management,
      connection,
      connectionState: 'ready',
      isPro: false,
    });
    const locked = render(
      <AgentSettingsSectionView
        {...viewProps('logs', {
          model: lockedModel,
          state: 'locked',
          onAction,
          onOpenPaywall,
        })}
      />,
    );
    fireEvent.press(locked.getByTestId('agent-settings-section-locked-action'));
    fireEvent.press(locked.getByTestId('agent-settings-section-row-logs.view'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(2);
    expect(onOpenPaywall).toHaveBeenNthCalledWith(1, 'logs');
    expect(onOpenPaywall).toHaveBeenNthCalledWith(2, 'logs', expect.any(Function));
    const continueToLogs = onOpenPaywall.mock.calls[1]?.[1] as (() => void) | undefined;
    continueToLogs?.();
    expect(onAction).toHaveBeenCalledWith('logs.view');
    expect(mockedAnalyticsEvents.settingsRowOpened).toHaveBeenCalledWith({
      row: 'logs.view',
      locked: true,
      backend: 'openclaw',
    });
  });

  it('keeps cached connection content visible offline and reconnects', () => {
    const onAction = jest.fn();
    const offlineModel = buildAgentSettingsSectionModel({
      section: 'connection',
      capabilities: { ...CAPABILITY_MATRIX.openclaw },
      management,
      connection,
      connectionState: 'reconnecting',
      isPro: true,
    });
    const view = render(
      <AgentSettingsSectionView
        {...viewProps('connection', {
          model: offlineModel,
          state: 'offline',
          onAction,
        })}
      />,
    );
    expect(view.getByTestId('agent-settings-section-offline')).toBeTruthy();
    expect(view.getByTestId('agent-settings-section-header-status')).toBeTruthy();
    expect(view.queryByTestId('agent-settings-section-title')).toBeNull();
    expect(view.getByText('Preview')).toBeTruthy();
    expect(view.getByText('Offline')).toBeTruthy();
    expect(flattenStyle(
      view.getByTestId('agent-settings-section-row-connection.status-attention').props.style,
    )).toMatchObject({ backgroundColor: colors.bad });
    fireEvent.press(view.getByTestId('agent-settings-section-row-connection.reconnect'));
    expect(onAction).toHaveBeenCalledWith('connection.reconnect');
  });

  it('requires app-owned confirmation before removing a connection', () => {
    const onAction = jest.fn();
    const view = render(
      <AgentSettingsSectionView {...viewProps('connection', { onAction })} />,
    );

    fireEvent.press(view.getByTestId('agent-settings-section-row-connection.remove'));
    expect(onAction).not.toHaveBeenCalled();
    expect(view.getByTestId('agent-settings-remove-connection-confirmation')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-settings-remove-connection-confirmation-cancel'));
    expect(view.queryByTestId('agent-settings-remove-connection-confirmation')).toBeNull();

    fireEvent.press(view.getByTestId('agent-settings-section-row-connection.remove'));
    fireEvent.press(view.getByTestId('agent-settings-remove-connection-confirmation-confirm'));
    expect(onAction).toHaveBeenCalledWith('connection.remove');
    expect(view.queryByTestId('agent-settings-remove-connection-confirmation')).toBeNull();
  });

  it('renders loading, empty, error, and unavailable-operation states', () => {
    const loading = render(
      <AgentSettingsSectionView {...viewProps('models', { state: 'loading' })} />,
    );
    expect(loading.getByTestId('agent-settings-section-skeleton-row')).toBeTruthy();
    loading.unmount();

    const empty = render(
      <AgentSettingsSectionView {...viewProps('models', { state: 'empty' })} />,
    );
    expect(empty.getByText('Agent unavailable')).toBeTruthy();
    empty.unmount();

    const onRetry = jest.fn();
    const error = render(
      <AgentSettingsSectionView
        {...viewProps('models', { state: 'error', errorMessage: 'No network', onRetry })}
      />,
    );
    expect(error.getByText('No network')).toBeTruthy();
    fireEvent.press(error.getByTestId('agent-settings-section-error-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    error.unmount();

    const recovering = render(
      <AgentSettingsSectionView
        {...viewProps('models', { state: 'offline', reconnecting: true, onRetry })}
      />,
    );
    expect(recovering.getByTestId('agent-settings-section-reconnecting')).toBeTruthy();
    expect(recovering.queryByTestId('agent-settings-section-offline')).toBeNull();
    expect(recovering.queryByTestId('agent-settings-section-title')).toBeNull();
    recovering.unmount();

    // Logs present their own offline copy in place, so the title stays.
    const logs = render(
      <AgentSettingsSectionView
        {...viewProps('logs', { state: 'offline', onRetry })}
      />,
    );
    expect(logs.queryByTestId('agent-settings-section-offline')).toBeNull();
    expect(logs.getByTestId('agent-settings-section-title')).toBeTruthy();
    logs.unmount();

    const onAction = jest.fn();
    const unavailable = render(
      <AgentSettingsSectionView
        {...viewProps('skills', {
          model: buildAgentSettingsSectionModel({
            section: 'skills',
            capabilities: { ...CAPABILITY_MATRIX.openclaw },
            management: { skills: { status: operation } },
            connection,
            connectionState: 'ready',
            isPro: true,
          }),
          onAction,
        })}
      />,
    );
    expect(unavailable.getByText('Unavailable')).toBeTruthy();
    fireEvent.press(unavailable.getByTestId('agent-settings-section-row-skills.discover'));
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('AgentSettingsSectionScreen host', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
    jest.clearAllMocks();
    mockRuntime = {
      initialized: true,
      switching: false,
      connections: [connection],
      activeConnectionId: connection.id,
      activeAdapter: adapter,
      activeState: 'ready',
      error: null,
      roster: [{
        connection,
        agents: [{ agent }],
      }],
    };
    mockCoordinator.getSnapshot.mockReturnValue({ activeConnectionId: connection.id });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('hosts the identity editor as its own screen instead of descriptor actions', () => {
    const resolveAction = jest.fn();
    const view = render(<AgentSettingsSectionScreen {...screenProps('identity', resolveAction)} />);

    expect(view.getByTestId('mock-identity-screen').props.openCreateOnMount).toBe(false);
    expect(view.queryByTestId('agent-settings-section-screen')).toBeNull();
    expect(view.queryByTestId('agent-settings-section-row-identity.profile')).toBeNull();
    expect(resolveAction).not.toHaveBeenCalled();

    const props = screenProps('identity', resolveAction);
    const creating = render(<AgentSettingsSectionScreen {...props}
      route={{ ...props.route, params: { ...props.route.params, action: 'create-agent' } }} />);
    expect(creating.getByTestId('mock-identity-screen').props.openCreateOnMount).toBe(true);
  });

  it('opens discovery from the header as a separate route with normal back navigation', () => {
    const props = screenProps('skills', jest.fn());
    const view = render(<AgentSettingsSectionScreen {...props} />);
    fireEvent.press(view.getByTestId('agent-skills-discover'));
    expect(props.navigation.push).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'studio', agentId: 'main', section: 'skills', action: 'discover-skills',
    });
    view.rerender(<AgentSettingsSectionScreen {...props} route={{ ...props.route, params: { ...props.route.params, action: 'discover-skills' } }} />);
    expect(view.getByTestId('mock-skills-section').props.view).toBe('discover');
    expect(view.queryByTestId('agent-skills-discover')).toBeNull();
    expect(view.getByTestId('agent-settings-section-title').props.children).toBe('Discover');
    fireEvent.press(view.getByTestId('agent-settings-section-back'));
    expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
    fireEvent(view.getByTestId('mock-skills-section'), 'installRequested');
    expect(props.navigation.navigate).toHaveBeenCalledWith('Thread', expect.objectContaining({
      connectionId: 'studio', agentId: 'main', sessionKey: agent.mainSessionKey,
    }));
  });

  it('hides the discovery header action when the adapter does not support it', () => {
    mockRuntime = { ...mockRuntime, activeAdapter: { ...adapter, capabilities: { ...adapter.capabilities, skillDiscover: false } } };
    const view = render(<AgentSettingsSectionScreen {...screenProps('skills', jest.fn())} />);
    expect(view.queryByTestId('agent-skills-discover')).toBeNull();
  });

  it('hosts the functional models and skills sections in the canonical screen shell', () => {
    const models = render(<AgentSettingsSectionScreen {...screenProps('models', jest.fn())} />);
    expect(models.getByTestId('mock-models-screen')).toBeTruthy();
    expect(models.queryByTestId('agent-settings-section-row-models.default')).toBeNull();
    expect(models.queryByTestId('agent-settings-section-screen')).toBeNull();
    models.unmount();

    const skills = render(<AgentSettingsSectionScreen {...screenProps('skills', jest.fn())} />);
    expect(skills.getByTestId('mock-skills-section')).toBeTruthy();
    expect(skills.queryByTestId('agent-settings-section-row-skills.installed')).toBeNull();

    skills.unmount();
    for (const [section, testID] of [
      ['cron', 'mock-cron-section'],
      ['files', 'mock-files-section'],
      ['usage', 'mock-usage-section'],
      ['tools', 'mock-tools-section'],
      ['channels-devices', 'mock-channels-devices-section'],
      ['logs', 'mock-logs-section'],
    ] as const) {
      const specialized = render(
        <AgentSettingsSectionScreen {...screenProps(section, jest.fn())} />,
      );
      expect(specialized.getByTestId(testID)).toBeTruthy();
      specialized.unmount();
    }

    const openClaw = render(
      <AgentSettingsSectionScreen {...screenProps('openclaw', jest.fn())} />,
    );
    expect(openClaw.getByTestId('mock-openclaw-manage-screen')).toBeTruthy();
    expect(openClaw.queryByTestId('agent-settings-section-screen')).toBeNull();
    openClaw.unmount();
  });

  it('activates the route connection before resolving its capabilities', async () => {
    mockRuntime = {
      ...mockRuntime,
      activeConnectionId: 'other',
      activeAdapter: null,
      activeState: 'connecting',
    };
    render(<AgentSettingsSectionScreen {...screenProps('models', jest.fn())} />);
    await waitFor(() => expect(mockCoordinator.activate).toHaveBeenCalledWith('studio'));
  });

  it('does not activate a permission-locked route connection', async () => {
    mockRuntime = {
      ...mockRuntime,
      activeConnectionId: 'other',
      activeAdapter: null,
      activeState: 'connecting',
    };
    const view = render(
      <AgentSettingsSectionScreen
        {...screenProps('models', jest.fn())}
        isPro={false}
        permissionDenied
      />,
    );

    await Promise.resolve();
    expect(mockCoordinator.activate).not.toHaveBeenCalled();
    expect(view.getByTestId('agent-settings-section-locked')).toBeTruthy();
  });

  it('renders Bridge details only from the coordinator runtime projection', () => {
    mockRuntime = {
      ...mockRuntime,
      connectionDetails: {
        studio: {
          lastReadyAt: Date.UTC(2026, 8, 5, 7, 30),
          bridgeVersion: '2026.9.5',
          bridgeCapabilities: ['bridge.capabilities.v2'],
        },
      },
    };

    const view = render(<AgentSettingsSectionScreen {...screenProps('connection', jest.fn())} />);

    expect(view.getByText('Last ready')).toBeTruthy();
    expect(view.getByText('Bridge version')).toBeTruthy();
    expect(view.getByText('2026.9.5')).toBeTruthy();
    expect(view.getByText('Bridge capabilities')).toBeTruthy();
    expect(view.getByText('bridge.capabilities.v2')).toBeTruthy();
  });
});

function screenProps(
  section: AgentSettingsSectionScreenProps['route']['params']['section'],
  resolveAction: NonNullable<AgentSettingsSectionScreenProps['resolveAction']>,
): AgentSettingsSectionScreenProps {
  return {
    route: {
      key: `section-${section}`,
      name: 'AgentSettingsSection',
      params: { connectionId: 'studio', agentId: 'main', section },
    },
    navigation: {
      goBack: jest.fn(),
      push: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
      navigate: jest.fn(),
    },
    isPro: true,
    resolveAction,
  } as unknown as AgentSettingsSectionScreenProps;
}
