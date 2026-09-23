import React from 'react';
import {
  act,
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
import { FontSize, Radius, Space } from '../../theme/tokens';
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

const mockPreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockCoordinator,
  useConnections: () => mockRuntime,
}));

jest.mock('../../services/analytics/events', () => ({
  analyticsAgentDocument: jest.requireActual('../../services/analytics/events').analyticsAgentDocument,
  analyticsEvents: {
    settingsRowOpened: jest.fn(),
    agentFileActivity: jest.fn(),
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

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, disabled, loading, onPress }: {
      testID?: string;
      label: string;
      disabled?: boolean;
      loading?: boolean;
      onPress?: () => void;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, disabled: disabled || loading, onPress },
      ReactRuntime.createElement(Text, null, label),
    ),
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

jest.mock('./SkillDiscoverScreen', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    SkillDiscoverScreen: (props: Record<string, unknown>) => ReactRuntime.createElement(View, { ...props, testID: 'mock-skill-discover-screen' }),
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
    FilesSection: (props: Record<string, unknown>) => ReactRuntime.createElement(View, { ...props, testID: 'mock-files-section' }),
  };
});

jest.mock('./DocumentScreen', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    DocumentScreen: (props: Record<string, unknown>) => ReactRuntime.createElement(View, { ...props, testID: 'mock-document-screen' }),
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
    ToolsSection: ({ saveRequest, onEditorChange }: {
      saveRequest?: number;
      onEditorChange?: (state: unknown) => void;
    }) => ReactRuntime.createElement(View, { testID: 'mock-tools-section', saveRequest, onEditorChange }),
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
      .toMatchObject({ backgroundColor: colors.canvasGrouped });
    expect(flattenStyle(view.getByTestId('agent-settings-section-header').props.style))
      .toMatchObject({ paddingTop: 24 + Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.sm });
    expect(view.getByTestId('agent-settings-section-back')).toBeTruthy();
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

  it('pushes workspace files and SKILL.md onto the document page and hosts it as its own screen', () => {
    const files = screenProps('files', jest.fn());
    const list = render(<AgentSettingsSectionScreen {...files} />);
    fireEvent(list.getByTestId('mock-files-section'), 'openFile', { name: 'MEMORY.md', path: '/MEMORY.md', missing: false });
    expect(files.navigation.push).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'studio', agentId: 'main', section: 'files', action: 'open-file', fileName: 'MEMORY.md',
    });
    list.rerender(<AgentSettingsSectionScreen {...files} route={{ ...files.route, params: { ...files.route.params, action: 'open-file', fileName: 'MEMORY.md' } }} />);
    const page = list.getByTestId('mock-document-screen');
    expect(page.props.title).toBe('MEMORY.md');
    expect(page.props.subtitle).toBeUndefined();
    expect(page.props.source.key).toBe('studio:main:file:MEMORY.md');
    expect(page.props.isPro).toBe(true);
    expect(list.queryByTestId('agent-settings-section-screen')).toBeNull();
    list.unmount();

    mockRuntime = { ...mockRuntime, activeAdapter: { ...adapter, management: { ...management, skills: { ...management.skills, get: operation } } } };
    const skills = screenProps('skills', jest.fn());
    const view = render(<AgentSettingsSectionScreen {...skills} />);
    fireEvent(view.getByTestId('mock-skills-section'), 'openSource', { skillKey: 'builder', name: 'Builder' });
    expect(skills.navigation.push).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'studio', agentId: 'main', section: 'skills', action: 'skill-source', skillKey: 'builder', skillName: 'Builder',
    });
    view.rerender(<AgentSettingsSectionScreen {...skills} route={{ ...skills.route, params: { ...skills.route.params, action: 'skill-source', skillKey: 'builder', skillName: 'Builder' } }} />);
    const source = view.getByTestId('mock-document-screen');
    expect(source.props.title).toBe('SKILL.md');
    expect(source.props.subtitle).toBe('Builder');
    expect(source.props.source.key).toBe('studio:main:skill:builder');
    fireEvent(source, 'openLinkedFile', 'scripts/run.py');
    expect(skills.navigation.push).toHaveBeenLastCalledWith('AgentSettingsSection', {
      connectionId: 'studio', agentId: 'main', section: 'skills', action: 'skill-source',
      skillKey: 'builder', skillName: 'Builder', skillFilePath: 'scripts/run.py',
    });
  });

  it('opens the ClawHub discovery page from the header as its own screen and returns to main chat with reviewable installation text', () => {
    const props = screenProps('skills', jest.fn());
    const view = render(<AgentSettingsSectionScreen {...props} />);
    fireEvent.press(view.getByTestId('agent-skills-discover'));
    expect(props.navigation.push).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'studio', agentId: 'main', section: 'skills', action: 'discover-skills',
    });
    view.rerender(<AgentSettingsSectionScreen {...props} route={{ ...props.route, params: { ...props.route.params, action: 'discover-skills' } }} />);
    const page = view.getByTestId('mock-skill-discover-screen');
    expect(page.props.backend).toBe('openclaw');
    expect(page.props.online).toBe(true);
    expect(view.queryByTestId('mock-skills-section')).toBeNull();
    expect(view.queryByTestId('agent-settings-section-screen')).toBeNull();
    fireEvent(page, 'installRequested', 'Install the selected skill');
    expect(props.navigation.popTo).toHaveBeenCalledWith('Thread', expect.objectContaining({
      connectionId: 'studio', agentId: 'main', sessionKey: agent.mainSessionKey,
      composerDraft: { id: expect.any(String), text: 'Install the selected skill' },
    }));
  });

  it('drives the tools draft from a header Save and guards a dirty leave', () => {
    const props = screenProps('tools', jest.fn());
    const view = render(<AgentSettingsSectionScreen {...props} />);
    const section = () => view.getByTestId('mock-tools-section');
    // No Save until the section reports an editable policy; a clean draft never blocks leaving.
    expect(view.queryByTestId('agent-tools-save')).toBeNull();
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);

    fireEvent(section(), 'editorChange', { dirty: false, saving: false, editable: true });
    expect(view.getByTestId('agent-tools-save').props.disabled).toBe(true);
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);

    fireEvent(section(), 'editorChange', { dirty: true, saving: false, editable: true });
    expect(view.getByTestId('agent-tools-save').props.disabled).toBe(false);
    expect(section().props.saveRequest).toBe(0);
    fireEvent.press(view.getByTestId('agent-tools-save'));
    expect(section().props.saveRequest).toBe(1);

    // A dirty draft turns route removal into the discard confirmation.
    const [blocked, onRemove] = mockPreventRemove.mock.calls.at(-1)!;
    expect(blocked).toBe(true);
    const removal = { data: { action: { type: 'GO_BACK' } } };
    act(() => { onRemove(removal); });
    expect(view.getByTestId('agent-tools-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-tools-discard-cancel'));
    expect(view.queryByTestId('agent-tools-discard')).toBeNull();
    expect(props.navigation.dispatch).not.toHaveBeenCalled();

    act(() => { onRemove(removal); });
    fireEvent.press(view.getByTestId('agent-tools-discard-confirm'));
    expect(view.queryByTestId('agent-tools-discard')).toBeNull();
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);
    expect(props.navigation.dispatch).toHaveBeenCalledWith(removal.data.action);

    // A write in flight keeps the Save busy.
    fireEvent(section(), 'editorChange', { dirty: true, saving: true, editable: true });
    expect(view.getByTestId('agent-tools-save').props.disabled).toBe(true);
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

  it('renders the connection route as unsupported instead of a dead section', () => {
    const view = render(<AgentSettingsSectionScreen {...screenProps('connection', jest.fn())} />);

    expect(view.getByTestId('agent-settings-section-unsupported')).toBeTruthy();
    expect(view.queryByText('Bridge version')).toBeNull();
    expect(view.queryByText('Last ready')).toBeNull();
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
      popTo: jest.fn(),
      dispatch: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
      navigate: jest.fn(),
    },
    isPro: true,
    resolveAction,
  } as unknown as AgentSettingsSectionScreenProps;
}
