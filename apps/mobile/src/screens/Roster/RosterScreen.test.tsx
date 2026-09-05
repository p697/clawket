import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type {
  ConnectionRuntimeSnapshot,
  RosterConnectionGroup,
} from '../../connection';
import {
  ControlSize,
  FontSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import {
  RosterScreen,
  type RosterScreenProps,
} from './RosterScreen';

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
let mockConnections: ConnectionRuntimeSnapshot;
let mockRoster: ReadonlyArray<RosterConnectionGroup> = [];
const mockRefreshRoster = jest.fn(async () => mockRoster);
const mockProbeActive = jest.fn(async () => true);

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
  const View = host('View');
  const FlatList = ({
    data = [],
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
    refreshControl,
    ...props
  }: Record<string, unknown>) => {
    const items = data as ReadonlyArray<unknown>;
    const render = renderItem as (input: { item: unknown; index: number }) => React.ReactNode;
    const extract = keyExtractor as ((item: unknown, index: number) => string) | undefined;
    const header = typeof ListHeaderComponent === 'function'
      ? ReactRuntime.createElement(ListHeaderComponent as React.ComponentType)
      : ListHeaderComponent;
    const empty = items.length === 0
      ? typeof ListEmptyComponent === 'function'
        ? ReactRuntime.createElement(ListEmptyComponent as React.ComponentType)
        : ListEmptyComponent
      : null;
    return ReactRuntime.createElement(
      'FlatList',
      props,
      header,
      ...items.map((item, index) => ReactRuntime.createElement(
        ReactRuntime.Fragment,
        { key: extract?.(item, index) ?? String(index) },
        render({ item, index }),
      )),
      empty,
      refreshControl,
    );
  };
  return {
    FlatList,
    Platform: {
      OS: 'ios',
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    StyleSheet: {
      absoluteFillObject: {},
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View,
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
      Text: animatedHost('AnimatedText'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      ease: 'ease',
      linear: 'linear',
      inOut: (value: unknown) => value,
    },
    interpolateColor: jest.fn((_value: number, _input: number[], output: string[]) => output[0]),
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

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => ({
    refreshRoster: mockRefreshRoster,
    probeActive: mockProbeActive,
  }),
  useConnections: () => mockConnections,
  useRoster: () => mockRoster,
}));

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  return {
    Sheet: ({ visible, children, testID }: Record<string, unknown>) => (
      visible ? ReactRuntime.createElement('View', { testID }, children) : null
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
    }: Record<string, unknown>) => visible ? ReactRuntime.createElement(
      'View',
      { testID },
      ReactRuntime.createElement('Pressable', { testID: `${testID}-cancel`, onPress: onClose }),
      ReactRuntime.createElement('Pressable', { testID: `${testID}-confirm`, onPress: onConfirm }),
    ) : null,
  };
});

jest.mock('../../components/ui/CompositionSafeBottomSheetTextInput', () => {
  const ReactRuntime = require('react');
  return {
    CompositionSafeBottomSheetTextInput: (props: Record<string, unknown>) => (
      ReactRuntime.createElement('TextInput', props)
    ),
  };
});

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

function connection(id: string, isFreeSlot = true): ConnectionDescriptor {
  return {
    id,
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: id,
    createdAt: 1,
    isFreeSlot,
  };
}

function agent(connectionId: string, agentId: string): AgentDescriptor {
  return {
    connectionId,
    agentId,
    name: agentId === 'main' ? 'Main' : 'Builder',
    emoji: agentId === 'main' ? 'C' : undefined,
    isMain: agentId === 'main',
    mainSessionKey: `agent:${agentId}:main`,
  };
}

function session(
  connectionId: string,
  agentId: string,
  key: string,
  patch: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    connectionId,
    agentId,
    key,
    kind: 'main',
    title: 'Main',
    updatedAt: Date.now() - 3_600_000,
    preview: 'Latest work',
    hasActiveRun: false,
    attention: null,
    allowedActions: { rename: true, reset: true, delete: true, pin: true },
    ...patch,
  };
}

function group(
  id: string,
  source: 'live' | 'cache' = 'live',
  agents: ReadonlyArray<AgentDescriptor> = [agent(id, 'main')],
): RosterConnectionGroup {
  return {
    connection: connection(id),
    source,
    syncedAt: Date.now(),
    agents: agents.map((item, index) => {
      const main = session(id, item.agentId, item.mainSessionKey, {
        preview: index === 0 ? 'Needs approval' : 'Unread update',
        attention: index === 0 ? 'approval' : null,
      });
      const pinned = session(id, item.agentId, `${item.mainSessionKey}:channel:ops`, {
        kind: 'channel',
        channel: 'ops',
        title: 'Operations',
      });
      return {
        agent: item,
        sessions: [main, pinned],
        preview: main.preview,
        updatedAt: main.updatedAt,
        lastActivityAt: main.updatedAt,
        unreadCount: index === 0 ? 0 : 4,
        hasUnread: index !== 0,
        attentionCount: index === 0 ? 1 : 0,
        attention: main.attention ?? null,
      };
    }),
    unreadCount: agents.length > 1 ? 4 : 0,
    attentionCount: agents.length > 0 ? 1 : 0,
    lastActivityAt: Date.now() - 3_600_000,
  };
}

function snapshot(
  patch: Partial<ConnectionRuntimeSnapshot> = {},
): ConnectionRuntimeSnapshot {
  const connections = [connection('live')];
  return {
    revision: 1,
    initialized: true,
    switching: false,
    launchPaywallShownThisProcess: false,
    connectionsRevision: 1,
    connections,
    activeConnectionId: 'live',
    freeConnectionId: 'live',
    activeAdapter: null,
    activeState: 'ready',
    connectionDetails: {},
    roster: mockRoster,
    error: null,
    ...patch,
  };
}

function props(patch: Partial<RosterScreenProps> = {}): RosterScreenProps {
  return {
    onOpenAccount: jest.fn(),
    onSearch: jest.fn(),
    onAdd: jest.fn(),
    onOpenRow: jest.fn(),
    onOpenLockedRow: jest.fn(),
    ...patch,
  };
}

type RenderNode = Readonly<{
  props: Readonly<Record<string, unknown>>;
  parent: RenderNode | null;
}>;

function renderedFontSizes(view: ReturnType<typeof render>): ReadonlyArray<number> {
  const sizes = new Set<number>();
  view.UNSAFE_root
    .findAll((node: RenderNode) => Boolean(node.props.style))
    .forEach((node: RenderNode) => {
      let parent = node.parent;
      while (parent) {
        if (parent.props.accessibilityRole === 'image') return;
        parent = parent.parent;
      }
      const value = flattenStyle(node.props.style).fontSize;
      if (typeof value === 'number') sizes.add(value);
    });
  return [...sizes].sort((a, b) => a - b);
}

let consoleErrorSpy: jest.SpyInstance;

describe('RosterScreen', () => {
  beforeAll(() => {
    const original = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
      original(message, ...rest);
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: lightColors };
    mockRoster = [group('live', 'live', [agent('live', 'main'), agent('live', 'builder')])];
    mockConnections = snapshot();
    mockRefreshRoster.mockClear();
    mockProbeActive.mockClear();
  });

  it('renders account actions and ordered Agent, pinned, unread, attention, cached, and locked rows', () => {
    const onOpenAccount = jest.fn();
    const onSearch = jest.fn();
    const onAdd = jest.fn();
    const onOpenRow = jest.fn();
    const onOpenLockedRow = jest.fn();
    const onLongPressRow = jest.fn();
    mockRoster = [
      ...mockRoster,
      group('cached', 'cache', [agent('cached', 'main'), agent('cached', 'builder')]),
    ];
    mockConnections = snapshot({
      connections: [connection('live'), connection('cached', false)],
      roster: mockRoster,
    });

    const view = render(
      <RosterScreen
        {...props({
          accountAttentionCount: 3,
          pinnedSessionKeys: {
            'live:main': ['agent:main:main:channel:ops'],
          },
          canAccessAgent: (connectionId, agentId) => !(
            connectionId === 'cached' && agentId === 'builder'
          ),
          onOpenAccount,
          onSearch,
          onAdd,
          onOpenRow,
          onOpenLockedRow,
          onLongPressRow,
        })}
      />,
    );

    expect(view.getByTestId('roster-account-badge')).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:live:main-attention')).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:live:builder-unread')).toBeTruthy();
    expect(view.getByTestId('roster-row-session:live:agent:main:main:channel:ops')).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:cached:builder-lock-icon')).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:cached:main').props.accessibilityLabel).toBe('Main');
    expect(view.queryByTestId('roster-row-agent:cached:main-avatar-working-ring')).toBeNull();

    fireEvent.press(view.getByTestId('roster-account'));
    fireEvent.press(view.getByTestId('roster-search'));
    fireEvent.press(view.getByTestId('roster-add'));
    fireEvent.press(view.getByTestId('roster-action-add_connection'));
    fireEvent.press(view.getByTestId('roster-row-agent:live:main'));
    fireEvent.press(view.getByTestId('roster-row-agent:cached:builder'));
    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');

    expect(onOpenAccount).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onOpenRow).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main', locked: false }));
    expect(onOpenLockedRow).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'cached',
      agentId: 'builder',
      locked: true,
    }));
    expect(onLongPressRow).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main' }));
  });

  it('overlays the free Pro entry on the single account control while preserving attention priority', () => {
    const onOpenAccount = jest.fn();
    const onOpenPro = jest.fn();
    const screenProps = props({
      accountAttentionCount: 2,
      onOpenAccount,
      onOpenPro,
    });
    const view = render(<RosterScreen {...screenProps} />);

    expect(view.getByText('Pro')).toBeTruthy();
    expect(view.getByTestId('roster-account-badge')).toBeTruthy();
    expect(flattenStyle(view.getByTestId('roster-account-control').props.style)).toMatchObject({
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
      position: 'relative',
    });
    expect(flattenStyle(view.getByTestId('roster-pro').props.style)).toMatchObject({
      position: 'absolute',
      height: LineHeight.caption,
    });
    fireEvent.press(view.getByTestId('roster-account'));
    fireEvent.press(view.getByTestId('roster-pro'));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
    expect(onOpenPro).toHaveBeenCalledTimes(1);

    view.rerender(
      <RosterScreen
        {...screenProps}
        accountAttentionCount={0}
        isPro
      />,
    );
    expect(view.queryByTestId('roster-pro')).toBeNull();
    expect(view.queryByTestId('roster-account-badge')).toBeNull();
  });

  it('assembles production add and sole-Agent actions with Pro gating and confirmation', () => {
    mockRoster = [group('live', 'live', [agent('live', 'main')])];
    mockConnections = snapshot({ roster: mockRoster });
    const onCreateAgent = jest.fn();
    const onCreateAgentLocked = jest.fn();
    const onOpenPro = jest.fn();
    const onToggleAgentPinned = jest.fn();
    const onToggleAgentMuted = jest.fn();
    const onRemoveConnection = jest.fn();
    const screenProps = props({
      canCreateAgent: true,
      onCreateAgent,
      onCreateAgentLocked,
      onOpenPro,
      onToggleAgentPinned,
      onToggleAgentMuted,
      onRemoveConnection,
    });
    const view = render(<RosterScreen {...screenProps} />);

    fireEvent.press(view.getByTestId('roster-add'));
    expect(view.getByTestId('roster-action-add_connection')).toBeTruthy();
    fireEvent.press(view.getByTestId('roster-action-create_agent'));
    expect(onCreateAgentLocked).toHaveBeenCalledTimes(1);
    expect(onOpenPro).not.toHaveBeenCalled();
    expect(onCreateAgent).not.toHaveBeenCalled();

    view.rerender(<RosterScreen {...screenProps} isPro />);
    fireEvent.press(view.getByTestId('roster-add'));
    fireEvent.press(view.getByTestId('roster-action-create_agent'));
    expect(onCreateAgent).toHaveBeenCalledTimes(1);

    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');
    fireEvent.press(view.getByTestId('roster-action-pin_agent'));
    expect(onToggleAgentPinned).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main' }));

    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');
    fireEvent.press(view.getByTestId('roster-action-mute_agent'));
    expect(onToggleAgentMuted).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main' }));

    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');
    fireEvent.press(view.getByTestId('roster-action-remove_connection'));
    expect(onRemoveConnection).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('roster-remove-connection-confirm'));
    expect(onRemoveConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'live' }));
  });

  it('unpins and capability-gates a real pinned-session rename action', async () => {
    const onUnpinSession = jest.fn();
    const onRenameSession = jest.fn(async () => undefined);
    const screenProps = props({
      pinnedSessionKeys: { 'live:main': ['agent:main:main:channel:ops'] },
      canRenamePinnedSession: true,
      onUnpinSession,
      onRenameSession,
    });
    const view = render(<RosterScreen {...screenProps} />);
    const pinned = view.getByTestId('roster-row-session:live:agent:main:main:channel:ops');

    fireEvent(pinned, 'longPress');
    fireEvent.press(view.getByTestId('roster-action-unpin_session'));
    expect(onUnpinSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pinned_session' }));

    fireEvent(pinned, 'longPress');
    fireEvent.press(view.getByTestId('roster-action-rename_session'));
    fireEvent.changeText(view.getByTestId('roster-rename-input'), 'Renamed channel');
    await act(async () => {
      fireEvent.press(view.getByTestId('roster-rename-save'));
    });
    expect(onRenameSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'agent:main:main:channel:ops' }),
      'Renamed channel',
    );
  });

  it('covers loading and empty states with tokenized six-row skeletons', () => {
    mockConnections = snapshot({ initialized: false });
    const loading = render(<RosterScreen {...props()} />);
    expect(loading.getByTestId('roster-loading')).toBeTruthy();
    expect(loading.getAllByLabelText('Loading agents')).toHaveLength(6);
    const avatar = loading.getAllByLabelText('Loading agents')[0];
    expect(flattenStyle(avatar.props.style)).toMatchObject({
      width: ControlSize.settingsRow + Space.xs,
      height: ControlSize.settingsRow + Space.xs,
      borderRadius: Radius.avatarRoster,
      backgroundColor: lightColors.surface,
    });
    loading.unmount();

    mockRoster = [{ ...group('live'), agents: [] }];
    mockConnections = snapshot({ roster: mockRoster });
    const empty = render(<RosterScreen {...props()} />);
    expect(empty.getByText('No agents on this connection')).toBeTruthy();
    expect(flattenStyle(empty.getByTestId('roster-empty').props.style).fontSize).toBe(FontSize.secondary);
  });

  it('keeps cached content visible across error, offline, and permission states', () => {
    mockConnections = snapshot({
      error: { operation: 'roster', connectionId: 'live', message: 'request failed' },
    });
    const error = render(<RosterScreen {...props()} />);
    expect(error.getByTestId('roster-error-banner')).toBeTruthy();
    expect(error.getByTestId('roster-row-agent:live:main')).toBeTruthy();
    error.unmount();

    mockRoster = [group('live', 'cache')];
    mockConnections = snapshot({ activeState: 'reconnecting', roster: mockRoster });
    const offline = render(<RosterScreen {...props()} />);
    expect(offline.getByText('Offline · reconnecting')).toBeTruthy();
    expect(offline.getByTestId('roster-row-agent:live:main')).toBeTruthy();
    expect(offline.getByTestId('roster-row-agent:live:main').props.style).not.toBeNull();
    offline.unmount();

    mockRoster = [group('live')];
    mockConnections = snapshot({ roster: mockRoster });
    const onOpenPro = jest.fn();
    const permission = render(
      <RosterScreen
        {...props({
          canAccessAgent: () => false,
          onOpenPro,
        })}
      />,
    );
    expect(permission.getByTestId('roster-permission-banner')).toBeTruthy();
    expect(permission.getByTestId('roster-row-agent:live:main-lock-icon')).toBeTruthy();
    fireEvent.press(permission.getByTestId('roster-permission-banner-action'));
    expect(onOpenPro).toHaveBeenCalledTimes(1);
  });

  it('refreshes roster data and probes the active adapter from pull-to-refresh and reconnect', async () => {
    const view = render(<RosterScreen {...props()} />);

    await act(async () => {
      fireEvent(view.getByTestId('roster-refresh-control'), 'refresh');
    });
    expect(mockRefreshRoster).toHaveBeenCalledTimes(1);
    expect(mockProbeActive).toHaveBeenCalledTimes(1);

    mockConnections = snapshot({ activeState: 'offline', roster: mockRoster });
    view.rerender(<RosterScreen {...props()} />);
    await act(async () => {
      fireEvent.press(view.getByTestId('roster-offline-banner-action'));
    });
    expect(mockRefreshRoster).toHaveBeenCalledTimes(2);
    expect(mockProbeActive).toHaveBeenCalledTimes(2);
  });

  it('renders grace actions and preserves the canonical visual budget in light and dark themes', () => {
    const onGraceAction = jest.fn();
    const screenProps = props({
      isPro: true,
      graceBanner: { message: '12 days left', actionLabel: 'View Pro' },
      onGraceAction,
    });
    const light = render(<RosterScreen {...screenProps} />);
    expect(flattenStyle(light.getByTestId('roster-screen').props.style).backgroundColor).toBe(lightColors.canvas);
    expect(flattenStyle(light.getByTestId('roster-account').props.style)).toMatchObject({
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
      borderRadius: Radius.full,
    });
    expect(renderedFontSizes(light)).toEqual([
      FontSize.caption,
      FontSize.secondary,
      FontSize.body,
    ]);
    light.getAllByTestId(/^roster-row-/).forEach((node) => {
      if (!String(node.props.testID).match(/^roster-row-(agent|session):[^-]+$/)) return;
      expect(flattenStyle(node.props.style).borderWidth).toBeUndefined();
    });
    fireEvent.press(light.getByTestId('roster-grace-banner-action'));
    expect(onGraceAction).toHaveBeenCalledTimes(1);
    light.unmount();

    mockTheme = { scheme: 'dark', colors: darkColors };
    const dark = render(<RosterScreen {...screenProps} />);
    expect(flattenStyle(dark.getByTestId('roster-screen').props.style).backgroundColor).toBe(darkColors.canvas);
    expect(flattenStyle(dark.getByTestId('roster-account').props.style)).toMatchObject({
      backgroundColor: darkColors.surfaceFloating,
      borderWidth: 1,
      borderColor: darkColors.line,
    });
    expect(renderedFontSizes(dark)).toEqual([
      FontSize.caption,
      FontSize.secondary,
      FontSize.body,
    ]);
  });
});
