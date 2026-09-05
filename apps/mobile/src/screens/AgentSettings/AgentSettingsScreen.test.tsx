import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type {
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
} from '@clawket/agent-protocol';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import { analyticsEvents } from '../../services/analytics/events';
import { FontSize, Radius } from '../../theme/tokens';
import {
  AgentSettingsView,
  type AgentSettingsViewProps,
} from './AgentSettingsScreen';

const lightColors = {
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

const darkColors = {
  ...lightColors,
  canvas: '#0C0C0D',
  canvasGrouped: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
  line: '#2A2A2F',
  accent: '#6B95FF',
  accentSoft: '#1B2947',
  good: '#2FA07C',
  goodSoft: '#17352C',
  warn: '#D07F30',
  warnSoft: '#3A2B1E',
  bad: '#E06060',
  badSoft: '#3B2224',
};

let mockTheme = { scheme: 'light' as 'light' | 'dark', colors: lightColors };
const mockedAnalyticsEvents = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

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
      absoluteFillObject: {},
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const animatedHost = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    __esModule: true,
    default: {
      View: animatedHost('AnimatedView'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: { ease: 'ease', linear: 'linear', inOut: (value: unknown) => value },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: jest.fn((_delay: number, value: unknown) => value),
    withRepeat: jest.fn((value: unknown) => value),
    withTiming: jest.fn((value: unknown) => value),
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
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    agentSettingsOpened: jest.fn(),
    settingsRowOpened: jest.fn(),
  },
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

const connection: ConnectionDescriptor = {
  id: 'connection-one',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Studio',
  createdAt: 1,
  isFreeSlot: true,
};

const agent: AgentDescriptor = {
  connectionId: connection.id,
  agentId: 'main',
  name: 'Lucy',
  emoji: 'L',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

function props(
  patch: Partial<AgentSettingsViewProps> = {},
): AgentSettingsViewProps {
  return {
    connection,
    agent,
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    connectionState: 'ready',
    state: 'ready',
    isPro: false,
    summary: {
      currentModel: 'model-one',
      installedSkillCount: 3,
      cronJobCount: 2,
      hasCronFailure: true,
      todayCostUsd: 0.5,
      toolCount: 4,
      pendingConnectionCount: 1,
    },
    onBack: jest.fn(),
    onNavigate: jest.fn(),
    onOpenPro: jest.fn(),
    onRetry: jest.fn(),
    ...patch,
  };
}

describe('AgentSettingsView deep rendering', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTheme = { scheme: 'light', colors: lightColors };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders canonical grouped chrome and routes identity and capability rows', () => {
    const onNavigate = jest.fn();
    const view = render(<AgentSettingsView {...props({ onNavigate })} />);

    expect(flattenStyle(view.getByTestId('agent-settings-screen').props.style)).toMatchObject({
      backgroundColor: lightColors.canvasGrouped,
      paddingTop: 24,
    });
    expect(flattenStyle(view.getByTestId('agent-settings-title').props.style)).toMatchObject({
      color: lightColors.ink,
      fontSize: FontSize.title,
    });
    expect(flattenStyle(view.getByTestId('agent-settings-identity-group').props.style)).toMatchObject({
      backgroundColor: lightColors.surfaceFloating,
      borderRadius: Radius.settingsGroup,
    });
    expect(view.getByText('Studio · OpenClaw')).toBeTruthy();
    expect(view.getByText('model-one')).toBeTruthy();
    expect(view.getByTestId('agent-settings-row-cron-attention')).toBeTruthy();
    expect(view.getByTestId('agent-settings-row-channels-devices-attention')).toBeTruthy();
    expect(flattenStyle(view.getByTestId('agent-settings-agent-group').props.style))
      .not.toHaveProperty('borderWidth');

    fireEvent.press(view.getByTestId('agent-settings-identity'));
    fireEvent.press(view.getByTestId('agent-settings-row-models'));
    expect(onNavigate.mock.calls).toEqual([
      ['AgentSettingsSection', { connectionId: 'connection-one', agentId: 'main', section: 'identity' }],
      ['AgentSettingsSection', { connectionId: 'connection-one', agentId: 'main', section: 'models' }],
    ]);
    expect(mockedAnalyticsEvents.agentSettingsOpened).toHaveBeenCalledWith({ backend: 'openclaw' });
    expect(mockedAnalyticsEvents.settingsRowOpened.mock.calls).toEqual([
      [{ row: 'identity', locked: false, backend: 'openclaw' }],
      [{ row: 'models', locked: false, backend: 'openclaw' }],
    ]);
  });

  it('opens contextual management for free users while keeping logs Pro-gated', () => {
    const onNavigate = jest.fn();
    const onOpenPro = jest.fn();
    const free = render(<AgentSettingsView {...props({ onNavigate, onOpenPro })} />);

    fireEvent.press(free.getByTestId('agent-settings-row-openclaw'));
    fireEvent.press(free.getByTestId('agent-settings-row-logs'));
    expect(onOpenPro).toHaveBeenCalledWith('logs', expect.any(Function));
    expect(onNavigate).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'openclaw',
    });
    const continueToLogs = onOpenPro.mock.calls[0]?.[1] as (() => void) | undefined;
    continueToLogs?.();
    expect(onNavigate).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'logs',
    });
    free.unmount();

    const pro = render(<AgentSettingsView {...props({ isPro: true, onNavigate, onOpenPro })} />);
    fireEvent.press(pro.getByTestId('agent-settings-row-openclaw'));
    expect(onNavigate).toHaveBeenLastCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'openclaw',
    });
  });

  it('renders loading and empty states without native loading chrome', () => {
    const loading = render(<AgentSettingsView {...props({ state: 'loading' })} />);
    expect(loading.getByTestId('agent-settings-loading')).toBeTruthy();
    expect(loading.getByTestId('agent-settings-skeleton-avatar')).toBeTruthy();
    expect(loading.queryByTestId('agent-settings-content')).toBeNull();
    loading.unmount();

    const empty = render(<AgentSettingsView {...props({ state: 'empty', agent: null })} />);
    expect(empty.getByTestId('agent-settings-empty')).toBeTruthy();
    expect(empty.getByText('Agent unavailable')).toBeTruthy();
  });

  it('keeps cached settings visible in offline state and retries from the banner', () => {
    const onRetry = jest.fn();
    const view = render(
      <AgentSettingsView
        {...props({ state: 'offline', connectionState: 'reconnecting', onRetry })}
      />,
    );
    expect(view.getByTestId('agent-settings-offline')).toBeTruthy();
    expect(view.getByTestId('agent-settings-identity')).toBeTruthy();
    expect(view.getByTestId('agent-settings-row-models')).toBeTruthy();
    expect(view.getByText('Offline')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-settings-offline-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders actionable error and permission states', () => {
    const onRetry = jest.fn();
    const error = render(
      <AgentSettingsView {...props({ state: 'error', connectionState: 'error', onRetry })} />,
    );
    expect(error.getByText('Settings could not load')).toBeTruthy();
    fireEvent.press(error.getByTestId('agent-settings-error-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    error.unmount();

    const onOpenPro = jest.fn();
    const permission = render(
      <AgentSettingsView {...props({ state: 'permission', onOpenPro })} />,
    );
    expect(permission.getByTestId('agent-settings-permission')).toBeTruthy();
    fireEvent.press(permission.getByTestId('agent-settings-permission-action'));
    fireEvent.press(permission.getByTestId('agent-settings-row-connection'));
    expect(onOpenPro).toHaveBeenNthCalledWith(1, 'identity', expect.any(Function));
    expect(onOpenPro).toHaveBeenNthCalledWith(2, 'connection', expect.any(Function));
    expect(mockedAnalyticsEvents.settingsRowOpened).toHaveBeenCalledWith({
      row: 'connection',
      locked: true,
      backend: 'openclaw',
    });
  });

  it('uses the same semantic hierarchy in dark mode', () => {
    mockTheme = { scheme: 'dark', colors: darkColors };
    const view = render(<AgentSettingsView {...props()} />);
    expect(flattenStyle(view.getByTestId('agent-settings-screen').props.style).backgroundColor)
      .toBe(darkColors.canvasGrouped);
    expect(flattenStyle(view.getByTestId('agent-settings-title').props.style).color)
      .toBe(darkColors.ink);
    expect(flattenStyle(view.getByTestId('agent-settings-agent-group').props.style).backgroundColor)
      .toBe(darkColors.surfaceFloating);
  });

  it('does not render sections whose capability is false', () => {
    const disabled: Capabilities = {
      ...CAPABILITY_MATRIX.youmind,
      devices: true,
    };
    const view = render(<AgentSettingsView {...props({ capabilities: disabled })} />);
    expect(view.queryByTestId('agent-settings-row-models')).toBeNull();
    expect(view.queryByTestId('agent-settings-row-openclaw')).toBeNull();
    expect(view.getByTestId('agent-settings-row-connection')).toBeTruthy();
    expect(view.getByTestId('agent-settings-row-channels-devices')).toBeTruthy();
  });
});
