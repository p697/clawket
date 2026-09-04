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

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockCoordinator,
  useConnections: () => mockRuntime,
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

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
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
        {...viewProps('logs', { model: lockedModel, state: 'locked', onOpenPaywall })}
      />,
    );
    fireEvent.press(locked.getByTestId('agent-settings-section-locked-action'));
    fireEvent.press(locked.getByTestId('agent-settings-section-row-logs.view'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(2);
    expect(onOpenPaywall).toHaveBeenCalledWith('logs');
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
    expect(view.getByText('Preview')).toBeTruthy();
    expect(view.getByText('Offline')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-settings-section-row-connection.reconnect'));
    expect(onAction).toHaveBeenCalledWith('connection.reconnect');
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
    fireEvent.press(error.getByTestId('agent-settings-section-error-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    error.unmount();

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

  it('passes a canonical adapter context to the root action resolver', async () => {
    const resolveAction = jest.fn();
    const props = screenProps('skills', resolveAction);
    const view = render(<AgentSettingsSectionScreen {...props} />);

    fireEvent.press(view.getByTestId('agent-settings-section-row-skills.installed'));
    await waitFor(() => expect(resolveAction).toHaveBeenCalledWith(
      {
        section: 'skills',
        action: 'skills.installed',
        connectionId: 'studio',
        agentId: 'main',
      },
      { adapter, connection, agent },
    ));
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
      navigate: jest.fn(),
    },
    isPro: true,
    resolveAction,
  } as unknown as AgentSettingsSectionScreenProps;
}
