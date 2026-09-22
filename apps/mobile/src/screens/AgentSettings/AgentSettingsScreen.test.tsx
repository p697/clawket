import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type {
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
  CronJob,
  ManagementOperations,
} from '@clawket/agent-protocol';
import { CAPABILITY_MATRIX, createMockAdapter } from '@clawket/agent-protocol';
import { analyticsEvents } from '../../services/analytics/events';
import { CronFailureAckService, type CronFailureAckScope } from '../../services/cron-failure-acks';
import { ControlSize, FontSize, Radius, Space } from '../../theme/tokens';
import {
  AgentSettingsScreen,
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

jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, onAfterClose }: any) => {
  const ReactRuntime = require('react');
  const previous = ReactRuntime.useRef(false);
  ReactRuntime.useEffect(() => {
    if (!visible && previous.current) onAfterClose?.();
    previous.current = visible;
  }, [visible, onAfterClose]);
  return visible ? children : null;
} }));
jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return { Button: ({ label, onPress, testID }: any) => ReactRuntime.createElement(Pressable, { onPress, testID }, ReactRuntime.createElement(Text, null, label)) };
});

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
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    Platform: {
      OS: 'ios',
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Image: host('Image'),
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      absoluteFill: {},
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
  // Entering/exiting presets are chainable builders; the status capsule only needs them to exist.
  const layoutAnimation = (name: string) => {
    const animation: Record<string, unknown> = { name };
    for (const method of ['duration', 'delay', 'easing', 'reduceMotion']) animation[method] = () => animation;
    return animation;
  };
  return {
    __esModule: true,
    default: {
      View: animatedHost('AnimatedView'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: { ease: 'ease', linear: 'linear', cubic: 'cubic', inOut: (value: unknown) => value, out: (value: unknown) => value },
    FadeIn: layoutAnimation('FadeIn'),
    FadeOut: layoutAnimation('FadeOut'),
    ReduceMotion: { Always: 'always', Never: 'never', System: 'system' },
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
const ackListeners = new Set<(scope: CronFailureAckScope) => void>();
jest.mock('../../services/cron-failure-acks', () => ({
  CronFailureAckService: {
    read: jest.fn(async () => new Set<string>()),
    subscribe: jest.fn((listener: (scope: CronFailureAckScope) => void) => {
      ackListeners.add(listener);
      return () => { ackListeners.delete(listener); };
    }),
  },
}));
const mockedAcks = CronFailureAckService as jest.Mocked<typeof CronFailureAckService>;

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
      modelCount: 12,
      installedSkillCount: 3,
      cronJobCount: 2,
      cronFailureCount: 1,
      hasCronFailure: true,
      fileCount: 7,
      todayCostUsd: 0.5,
      todayTokens: 965_200,
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
    });
    // The canonical page header owns the safe-area inset, the 16-point edge and the quiet back circle.
    expect(flattenStyle(view.getByTestId('agent-settings-header').props.style)).toMatchObject({
      paddingTop: 24 + Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.sm, backgroundColor: lightColors.canvasGrouped,
    });
    expect(flattenStyle(view.getByTestId('agent-settings-back').props.style)).toMatchObject({
      borderRadius: ControlSize.floatingButton / 2, backgroundColor: lightColors.surfaceFloating,
    });
    expect(flattenStyle(view.getByTestId('agent-settings-title').props.style)).toMatchObject({
      color: lightColors.ink,
      fontSize: FontSize.title,
    });
    // Identity opens from the hero itself (owner request 2026-09-19): the avatar and name share one
    // touch target with an edit glyph beside the name, and the former Identity row is gone.
    expect(view.queryByTestId('agent-settings-identity-group')).toBeNull();
    expect(view.queryByText('Identity')).toBeNull();
    expect(view.getByTestId('agent-settings-identity').props.accessibilityRole).toBe('button');
    expect(view.getByTestId('agent-settings-identity').props.accessibilityLabel).toBe('Lucy');
    expect(view.getByTestId('agent-settings-identity-glyph')).toBeTruthy();
    expect(view.queryByTestId('agent-settings-hero')).toBeNull();
    // No static identity line: the backend sits on the avatar as a corner mark and the
    // connection group has no heading, so the connection label appears nowhere on the page.
    expect(view.queryByTestId('agent-settings-identity-detail')).toBeNull();
    expect(view.queryByText('Studio · OpenClaw')).toBeNull();
    expect(view.queryByText('Studio')).toBeNull();
    expect(view.getByTestId('agent-settings-backend-mark').props.accessibilityLabel).toBe('OpenClaw');
    expect(flattenStyle(view.getByTestId('agent-settings-backend-mark').props.style)).toMatchObject({
      width: Space.xl,
      height: Space.xl,
      borderColor: lightColors.canvasGrouped,
      backgroundColor: lightColors.surfaceFloating,
    });
    expect(view.queryByTestId('agent-settings-row-models')).toBeNull();
    expect(view.queryByTestId('agent-settings-row-cron')).toBeNull();

    // Stat cards: two heroes, then tiles, each a white settings group with one value and one label.
    expect(view.getAllByTestId(/^agent-settings-stat-[a-z]+$/).map((node) => node.props.testID)).toEqual([
      'agent-settings-stat-cron',
      'agent-settings-stat-usage',
      'agent-settings-stat-models',
      'agent-settings-stat-skills',
      'agent-settings-stat-files',
    ]);
    expect(flattenStyle(view.getByTestId('agent-settings-stat-cron').props.style)).toMatchObject({
      backgroundColor: lightColors.surfaceFloating,
      borderRadius: Radius.settingsGroup,
    });
    expect(view.getByTestId('agent-settings-stat-cron-value').props.children).toBe('2');
    expect(flattenStyle(view.getByTestId('agent-settings-stat-cron-value').props.style)).toMatchObject({
      fontSize: FontSize.title,
      fontVariant: ['tabular-nums'],
    });
    expect(view.getByTestId('agent-settings-stat-cron-detail').props.children).toBe('{{count}} failed');
    expect(flattenStyle(view.getByTestId('agent-settings-stat-cron-detail').props.style)).toMatchObject({
      color: lightColors.bad,
      fontSize: FontSize.caption,
    });
    expect(view.getByText('Cron jobs')).toBeTruthy();
    expect(view.getByTestId('agent-settings-stat-usage-value').props.children).toBe('$0.50');
    // Dollars only: no token caption competes with the amount for the hero card's width.
    expect(view.queryByTestId('agent-settings-stat-usage-detail')).toBeNull();
    expect(view.getByTestId('agent-settings-stat-models-value').props.children).toBe('12');
    expect(view.getByTestId('agent-settings-stat-files-value').props.children).toBe('7');
    expect(view.queryByTestId('agent-settings-stat-models-detail')).toBeNull();

    // Management rows are directly accessible.
    expect(view.getByTestId('agent-settings-row-tools')).toBeTruthy();
    expect(view.queryByTestId('agent-settings-row-usage')).toBeNull();
    expect(view.getByTestId('agent-settings-row-channels-devices-attention')).toBeTruthy();
    expect(flattenStyle(view.getAllByTestId('agent-settings-connection-group')[0].props.style))
      .not.toHaveProperty('borderWidth');

    fireEvent.press(view.getByTestId('agent-settings-identity'));
    fireEvent.press(view.getByTestId('agent-settings-stat-models-row'));
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

  it('continues chatting from the header and shows heartbeat activity in the identity line', () => {
    const onContinueChat = jest.fn();
    const now = Date.now();
    const view = render(
      <AgentSettingsView
        {...props({
          onContinueChat,
          summary: { todayTokens: 4_200, lastHeartbeatAt: now - 19 * 60_000 },
        })}
      />,
    );

    fireEvent.press(view.getByTestId('agent-profile-chat'));
    expect(onContinueChat).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('agent-profile-chat').props.accessibilityLabel).toBe('Continue chatting');
    expect(view.getByTestId('agent-settings-identity-detail').props.children)
      .toBe('Active {{age}}');
    expect(view.queryByText('Studio · OpenClaw')).toBeNull();
    // Without a dollar figure the card leads with tokens and drops its caption.
    expect(view.getByText('Tokens today')).toBeTruthy();
    expect(view.getByTestId('agent-settings-stat-usage-value').props.children).toBe('4.2K');
    expect(view.queryByTestId('agent-settings-stat-usage-detail')).toBeNull();
    expect(view.getByTestId('agent-settings-stat-cron-value').props.children).toBe('—');
  });

  it('opens management and logs directly for free users; Pro gates live inside the pages', () => {
    const onNavigate = jest.fn();
    const onOpenPro = jest.fn();
    const free = render(<AgentSettingsView {...props({ onNavigate, onOpenPro })} />);

    // Management and logs rows open for everyone; each page previews real data
    // and presents the contextual paywall only at its last step.
    fireEvent.press(free.getByTestId('agent-settings-row-openclaw'));
    expect(free.queryByTestId('agent-settings-row-logs-lock-icon')).toBeNull();
    fireEvent.press(free.getByTestId('agent-settings-row-logs'));
    expect(onOpenPro).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'openclaw',
    });
    expect(onNavigate).toHaveBeenCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'logs',
    });
    free.unmount();

    const pro = render(<AgentSettingsView {...props({ isPro: true, onNavigate, onOpenPro })} />);
    // Management rows are directly accessible.
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
    expect(view.getByTestId('agent-settings-stat-models-value').props.children).toBe('12');
    // Management rows are directly accessible.
    expect(view.getByTestId('agent-settings-row-tools')).toBeTruthy();
    expect(view.getByText('Offline')).toBeTruthy();
    // Connection state takes the header title slot instead of pushing the profile down.
    expect(view.getByTestId('agent-settings-header-status')).toBeTruthy();
    expect(view.queryByTestId('agent-settings-title')).toBeNull();
    fireEvent.press(view.getByTestId('agent-settings-offline-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.unmount();

    const recovering = render(
      <AgentSettingsView
        {...props({ state: 'offline', connectionState: 'reconnecting', reconnecting: true, onRetry })}
      />,
    );
    expect(recovering.getByTestId('agent-settings-reconnecting')).toBeTruthy();
    expect(recovering.getByText('Reconnecting…')).toBeTruthy();
    expect(recovering.queryByTestId('agent-settings-offline')).toBeNull();
    expect(recovering.queryByTestId('agent-settings-title')).toBeNull();
    expect(recovering.getByTestId('agent-settings-identity')).toBeTruthy();
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
    expect(permission.getByTestId('agent-settings-stat-cron-lock')).toBeTruthy();
    fireEvent.press(permission.getByTestId('agent-settings-stat-cron-row'));
    expect(onOpenPro).toHaveBeenNthCalledWith(1, 'identity', expect.any(Function));
    expect(onOpenPro).toHaveBeenNthCalledWith(2, 'connection', expect.any(Function));
    expect(onOpenPro).toHaveBeenNthCalledWith(3, 'cron', expect.any(Function));
    expect(mockedAnalyticsEvents.settingsRowOpened).toHaveBeenCalledWith({
      row: 'connection',
      locked: true,
      backend: 'openclaw',
    });
    // A locked Agent keeps the hero as the Identity entry, with the lock in place of the edit glyph.
    fireEvent.press(permission.getByTestId('agent-settings-identity'));
    expect(onOpenPro).toHaveBeenLastCalledWith('identity', expect.any(Function));
    expect(mockedAnalyticsEvents.settingsRowOpened).toHaveBeenLastCalledWith({
      row: 'identity',
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
    expect(flattenStyle(view.getAllByTestId('agent-settings-connection-group')[0].props.style).backgroundColor)
      .toBe(darkColors.surfaceFloating);
    expect(flattenStyle(view.getByTestId('agent-settings-stat-usage').props.style).backgroundColor)
      .toBe(darkColors.surfaceFloating);
    expect(flattenStyle(view.getByTestId('agent-settings-stat-cron-value').props.style).color)
      .toBe(darkColors.ink);
  });

  it('opens the Cron page the same way from a lit failure count and a clear card', () => {
    const onNavigate = jest.fn();
    const lit = render(<AgentSettingsView {...props({ onNavigate })} />);
    fireEvent.press(lit.getByTestId('agent-settings-stat-cron-row'));
    expect(onNavigate).toHaveBeenLastCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'cron',
    });
    lit.unmount();

    const clear = render(<AgentSettingsView {...props({
      onNavigate,
      summary: { ...props().summary, cronFailureCount: 0, hasCronFailure: false },
    })} />);
    expect(clear.queryByTestId('agent-settings-stat-cron-detail')).toBeNull();
    fireEvent.press(clear.getByTestId('agent-settings-stat-cron-row'));
    expect(onNavigate).toHaveBeenLastCalledWith('AgentSettingsSection', {
      connectionId: 'connection-one',
      agentId: 'main',
      section: 'cron',
    });
  });

  it('clears the red failure count once the Runs tab acknowledges it', async () => {
    const failed: CronJob = {
      id: 'cron-one',
      name: 'Daily sync',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: 'every', everyMs: 60_000 },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: { kind: 'agentTurn', message: 'sync' },
      state: { lastRunStatus: 'error', lastRunAtMs: 100 },
    };
    const list = jest.fn(async () => ({ jobs: [failed], total: 1, offset: 0, limit: 200, hasMore: false, nextOffset: null }));
    const adapter = createMockAdapter({
      connection,
      agents: [agent],
      management: { cron: { list } } as unknown as ManagementOperations,
      initialState: 'ready',
    });
    const view = render(
      <AgentSettingsScreen
        adapter={adapter}
        connection={connection}
        agent={agent}
        capabilities={{ ...CAPABILITY_MATRIX.openclaw }}
        isPro={false}
        onBack={jest.fn()}
        onNavigate={jest.fn()}
        onOpenPro={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    await waitFor(() => expect(view.getByTestId('agent-settings-stat-cron-detail').props.children).toBe('{{count}} failed'));
    expect(ackListeners.size).toBe(1);

    // The Runs tab stored the failure signature; only the Cron card is read again.
    mockedAcks.read.mockResolvedValue(new Set(['cron-one@100']));
    act(() => { for (const listener of ackListeners) listener({ connectionId: 'connection-one', agentId: 'main' }); });
    await waitFor(() => expect(view.queryByTestId('agent-settings-stat-cron-detail')).toBeNull());
    expect(view.getByTestId('agent-settings-stat-cron-value').props.children).toBe('1');
    expect(list).toHaveBeenCalledTimes(2);

    // Another Agent's acknowledgement is not this card's business.
    act(() => { for (const listener of ackListeners) listener({ connectionId: 'connection-one', agentId: 'helper' }); });
    expect(list).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(ackListeners.size).toBe(0);
    mockedAcks.read.mockResolvedValue(new Set());
  });

  it('does not render sections whose capability is false', () => {
    const disabled: Capabilities = {
      ...CAPABILITY_MATRIX.youmind,
      devices: true,
    };
    const view = render(<AgentSettingsView {...props({ capabilities: disabled })} />);
    expect(view.queryByTestId('agent-settings-stats')).toBeNull();
    expect(view.queryByTestId('agent-settings-stat-models')).toBeNull();
    expect(view.queryByTestId('agent-settings-row-openclaw')).toBeNull();
    expect(view.getByTestId('agent-settings-row-connection')).toBeTruthy();
    // Management rows are directly accessible.
    expect(view.getByTestId('agent-settings-row-channels-devices')).toBeTruthy();
  });
});
