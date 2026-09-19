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
  Radius,
  Space,
} from '../../theme/tokens';
import { PRO_ENTRY_HEIGHT } from '../../components/ui/ProEntryButton';
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
let mockCommonTranslations: Readonly<Record<string, string>> = {};
const mockRefreshRoster = jest.fn(async () => mockRoster);
const mockProbeActive = jest.fn(async () => true);
const mockReconnectConnection = jest.fn(async (_id: string): Promise<void> => undefined);

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
    ScrollView: host('ScrollView'),
    Image: host('Image'),
    Platform: {
      OS: 'ios',
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    StyleSheet: {
      absoluteFill: {},
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
      Text: animatedHost('AnimatedText'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      ease: 'ease',
      linear: 'linear',
      cubic: 'cubic',
      inOut: (value: unknown) => value,
      out: (value: unknown) => value,
    },
    FadeIn: layoutAnimation('FadeIn'),
    FadeOut: layoutAnimation('FadeOut'),
    ReduceMotion: { Always: 'always', Never: 'never', System: 'system' },
    interpolateColor: jest.fn((_value: number, _input: number[], output: string[]) => output[0]),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: jest.fn((_delay: number, value: unknown) => value),
    withSequence: jest.fn((...values: unknown[]) => values[values.length - 1]),
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
  useTranslation: () => ({
    t: (key: string, options?: Readonly<Record<string, unknown>>) => (
      mockCommonTranslations[key] ?? key
    ).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? '')),
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => ({
    refreshRoster: mockRefreshRoster,
    probeActive: mockProbeActive,
    reconnectConnection: mockReconnectConnection,
  }),
  useConnections: () => mockConnections,
  useRoster: () => mockRoster,
}));

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  return {
    Sheet: ({ visible, children, testID, onAfterClose }: Record<string, unknown>) => {
      const wasVisible = ReactRuntime.useRef(false);
      ReactRuntime.useEffect(() => {
        if (!visible && wasVisible.current) (onAfterClose as (() => void) | undefined)?.();
        wasVisible.current = visible;
      }, [visible, onAfterClose]);
      return visible ? ReactRuntime.createElement('View', { testID }, children) : null;
    },
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
    mockCommonTranslations = {};
    mockRoster = [group('live', 'live', [agent('live', 'main'), agent('live', 'builder')])];
    mockConnections = snapshot();
    mockRefreshRoster.mockClear();
    mockProbeActive.mockClear();
    mockReconnectConnection.mockReset().mockResolvedValue(undefined);
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
    expect(view.getByTestId('roster-row-session:live:agent:main:main:channel:ops-pin-icon')).toBeTruthy();
    expect(view.getByTestId(
      'roster-row-session:live:agent:main:main:channel:ops-avatar-overlay',
    )).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:cached:builder-lock-icon')).toBeTruthy();
    expect(view.getAllByText('just now')).toHaveLength(2);
    expect(view.queryByTestId('roster-row-agent:cached:main-attention')).toBeNull();
    expect(view.queryByTestId('roster-row-agent:cached:builder-unread')).toBeNull();
    expect(view.getByTestId('roster-row-agent:cached:main').props.accessibilityLabel).toBe(
      'Main, Last synced',
    );
    expect(view.queryByTestId('roster-row-agent:cached:main-avatar-working-ring')).toBeNull();

    fireEvent.press(view.getByTestId('roster-account'));
    fireEvent.press(view.getByTestId('roster-search'));
    fireEvent.press(view.getByTestId('roster-add'));
    expect(view.queryByTestId('roster-add-sheet')).toBeNull();
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

  it('renders the registry-provided semantic subtitle instead of the latest session preview', () => {
    const source = group('sprite');
    mockRoster = [{
      ...source,
      connection: {
        ...source.connection,
        backendKind: 'youmind',
        transportKind: 'https',
      },
      agents: source.agents.map((summary, index) => index === 0
        ? {
            ...summary,
            agent: {
              ...summary.agent,
              emoji: undefined,
              avatarUrl: 'https://cdn.example.invalid/sprite.png',
            },
            subtitle: { kind: 'backend' as const, label: 'YouMind' },
          }
        : summary),
    }];
    mockConnections = snapshot({
      connections: [mockRoster[0].connection],
      activeConnectionId: 'sprite',
      roster: mockRoster,
    });

    const view = render(<RosterScreen {...props()} />);

    expect(view.getByText('YouMind')).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:sprite:main-avatar-image').props.source).toEqual({
      uri: 'https://cdn.example.invalid/sprite.png',
    });
    expect(view.queryByText('Needs approval')).toBeNull();
  });

  it('localizes the cached last-synced time in a non-English locale', () => {
    const now = Date.now();
    mockCommonTranslations = {
      '{{count}}h ago': '{{count}}時間前',
      'Last synced': '最終同期',
    };
    mockRoster = [{
      ...group('cached-ja', 'cache'),
      syncedAt: now - 2 * 3_600_000,
    }];
    mockConnections = snapshot({
      connections: [connection('cached-ja')],
      activeConnectionId: 'live',
      roster: mockRoster,
    });

    const view = render(<RosterScreen {...props()} />);

    expect(view.getByTestId('roster-row-agent:cached-ja:main-synced').props.children).toBe(
      '2時間前',
    );
    expect(view.getByTestId('roster-row-agent:cached-ja:main').props.accessibilityLabel).toBe(
      'Main, 最終同期',
    );
  });

  it('places the free Pro entry beside the account control in the header row while preserving attention priority', () => {
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
    const pro = view.getByTestId('roster-pro');
    expect(pro.props.accessibilityLabel).toBe('View Pro');
    const proStyle = flattenStyle(pro.props.style);
    expect(proStyle).toMatchObject({
      height: PRO_ENTRY_HEIGHT,
      borderRadius: Radius.full,
      flexDirection: 'row',
    });
    expect(proStyle.position).toBeUndefined();
    expect(pro.parent?.parent?.props.testID ?? pro.parent?.props.testID).not.toBe('roster-account');
    const header = view.getByTestId('roster-header');
    const accountGroup = header.props.children[0];
    expect(accountGroup.props.children[0].props.testID).toBe('roster-account');
    expect(accountGroup.props.children[1].props.testID).toBe('roster-pro');
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
    const onManageConnection = jest.fn();
    const onRemoveConnection = jest.fn();
    const screenProps = props({
      canCreateAgent: true,
      onCreateAgent,
      onCreateAgentLocked,
      onOpenPro,
      onToggleAgentPinned,
      onManageConnection,
      onRemoveConnection,
    });
    const view = render(<RosterScreen {...screenProps} />);

    fireEvent.press(view.getByTestId('roster-add'));
    expect(view.getByTestId('roster-action-add_connection')).toBeTruthy();
    expect(view.getByText('Connect OpenClaw, Hermes and more')).toBeTruthy();
    expect(view.getByText('Create another agent on live')).toBeTruthy();
    expect(view.queryByTestId('roster-action-add_connection-lock-icon')).toBeNull();
    expect(view.getByTestId('roster-action-create_agent-lock-icon')).toBeTruthy();
    fireEvent.press(view.getByTestId('roster-action-create_agent'));
    expect(onCreateAgentLocked).toHaveBeenCalledTimes(1);
    expect(onOpenPro).not.toHaveBeenCalled();
    expect(onCreateAgent).not.toHaveBeenCalled();

    view.rerender(<RosterScreen {...screenProps} isPro />);
    fireEvent.press(view.getByTestId('roster-add'));
    expect(view.queryByTestId('roster-action-create_agent-lock-icon')).toBeNull();
    fireEvent.press(view.getByTestId('roster-action-create_agent'));
    expect(onCreateAgent).toHaveBeenCalledTimes(1);

    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');
    fireEvent.press(view.getByTestId('roster-action-pin_agent'));
    expect(onToggleAgentPinned).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main' }));

    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');
    expect(view.queryByTestId('roster-action-mute_agent')).toBeNull();
    fireEvent.press(view.getByTestId('roster-action-manage_connection'));
    expect(onManageConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'live', agentId: 'main' }));

    fireEvent(view.getByTestId('roster-row-agent:live:main'), 'longPress');
    fireEvent.press(view.getByTestId('roster-action-remove_connection'));
    expect(onRemoveConnection).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('roster-remove-connection-confirm'));
    expect(onRemoveConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'live' }));
  });

  it('reveals pin and manage on a trailing swipe and never removal', () => {
    mockRoster = [group('live', 'live', [agent('live', 'main')])];
    mockConnections = snapshot({ roster: mockRoster });
    const onToggleAgentPinned = jest.fn();
    const onManageConnection = jest.fn();
    const onRemoveConnection = jest.fn();
    const view = render(<RosterScreen {...props({
      agentPreferences: { 'live:main': { agentPinned: true } },
      onToggleAgentPinned,
      onManageConnection,
      onRemoveConnection,
    })} />);

    const tray = view.getByTestId('roster-swipe-agent:live:main-actions');
    expect(tray).toBeTruthy();
    expect(view.queryByTestId('roster-swipe-agent:live:main-action-remove_connection')).toBeNull();
    expect(view.getByText('Unpin')).toBeTruthy();
    expect(view.getByText('Manage')).toBeTruthy();
    const unpin = view.getByTestId('roster-swipe-agent:live:main-action-unpin_agent');
    expect(unpin.props.accessibilityLabel).toBe('Unpin Agent');
    fireEvent.press(unpin);
    expect(onToggleAgentPinned).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main', agentPinned: true }));
    fireEvent.press(view.getByTestId('roster-swipe-agent:live:main-action-manage_connection'));
    expect(onManageConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'live' }));
    expect(onRemoveConnection).not.toHaveBeenCalled();
    expect(view.queryByTestId('roster-row-actions')).toBeNull();
  });

  it('marks a locked add-connection choice and still routes it through onAdd', () => {
    mockRoster = [group('live', 'live', [agent('live', 'main')])];
    mockConnections = snapshot({ roster: mockRoster });
    const onAdd = jest.fn();
    const view = render(<RosterScreen {...props({
      canCreateAgent: true,
      addConnectionLocked: true,
      onAdd,
      onCreateAgent: jest.fn(),
    })} />);

    fireEvent.press(view.getByTestId('roster-add'));
    expect(view.getByTestId('roster-action-add_connection-lock-icon')).toBeTruthy();
    expect(view.getByTestId('roster-action-add_connection').props.accessibilityLabel).toBe(
      'Add Connection, Connect OpenClaw, Hermes and more',
    );
    fireEvent.press(view.getByTestId('roster-action-add_connection'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('roster-add-sheet')).toBeNull();
  });

  it('describes agent creation generically when the active connection has no label', () => {
    mockRoster = [{ ...group('live', 'live', [agent('live', 'main')]), connection: { ...connection('live'), label: '  ' } }];
    mockConnections = snapshot({ roster: mockRoster });
    const view = render(<RosterScreen {...props({ canCreateAgent: true, onCreateAgent: jest.fn() })} />);

    fireEvent.press(view.getByTestId('roster-add'));
    expect(view.getByText('Create another agent on this connection')).toBeTruthy();
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
    expect(view.getByTestId('roster-row-session:live:agent:main:main:channel:ops-pin-icon')).toBeTruthy();

    fireEvent(pinned, 'longPress');
    fireEvent.press(view.getByTestId('roster-action-unpin_session'));
    expect(onUnpinSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pinned_session' }));

    view.rerender(<RosterScreen {...screenProps} pinnedSessionKeys={{}} />);
    expect(view.queryByTestId('roster-row-session:live:agent:main:main:channel:ops')).toBeNull();
    expect(view.queryByTestId('roster-row-session:live:agent:main:main:channel:ops-pin-icon')).toBeNull();

    view.rerender(<RosterScreen {...screenProps} />);

    fireEvent(view.getByTestId('roster-row-session:live:agent:main:main:channel:ops'), 'longPress');
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

  it.each([
    { operation: 'remove', connectionId: 'live' },
    { operation: 'roster', connectionId: 'live' },
    { operation: 'connect', connectionId: 'other' },
  ] as const)('does not replace a healthy connection for $operation errors scoped to $connectionId', (error) => {
    mockConnections = snapshot({ error: { ...error, message: 'Failed' } });
    const view = render(<RosterScreen {...props()} />);
    expect(view.queryByTestId('roster-connection-unavailable')).toBeNull();
    expect(view.getByTestId('roster-row-agent:live:main')).toBeTruthy();
  });

  it('explains an empty offline roster instead of claiming there are no agents', async () => {
    mockRoster = [];
    mockConnections = snapshot({ activeState: 'offline', roster: [] });
    const onManageActiveConnection = jest.fn();
    const view = render(<RosterScreen {...props({ onManageActiveConnection })} />);
    expect(view.queryByText('No agents on this connection')).toBeNull();
    expect(view.getByTestId('roster-connection-unavailable')).toBeTruthy();
    fireEvent.press(view.getByTestId('roster-connection-unavailable-manage'));
    expect(onManageActiveConnection).toHaveBeenCalledWith('live');
    await act(async () => { fireEvent.press(view.getByTestId('roster-connection-unavailable-retry')); });
    expect(mockReconnectConnection).toHaveBeenCalledWith('live');
    mockConnections = snapshot({ recovering: true, activeState: 'reconnecting', roster: [] });
    view.rerender(<RosterScreen {...props()} />);
    expect(view.queryByTestId('roster-connection-unavailable')).toBeNull();
  });

  it('covers accessible companion loading and empty states', () => {
    mockConnections = snapshot({ initialized: false });
    const loading = render(<RosterScreen {...props()} />);
    expect(loading.getByTestId('roster-loading')).toBeTruthy();
    expect(loading.getByLabelText('Loading agents').props.accessibilityState).toEqual({ busy: true });
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
    // Connection state lives in the header centre, never in the list.
    expect(offline.getByTestId('roster-header-status')).toBeTruthy();
    expect(offline.getByTestId('roster-offline-banner-action').props.accessibilityLabel)
      .toBe('Offline · reconnecting, Reconnect');
    expect(offline.queryByTestId('roster-banners')).toBeNull();
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

  it('shows the recovery window as a quiet header capsule that keeps the list and grace banner in place', () => {
    mockRoster = [group('live', 'cache')];
    mockConnections = snapshot({ activeState: 'reconnecting', recovering: true, roster: mockRoster });
    const view = render(<RosterScreen {...props({
      isPro: true,
      graceBanner: { message: '12 days left', actionLabel: 'View Pro' },
    })} />);
    const status = view.getByTestId('roster-header-status');
    expect(status.props.pointerEvents).toBe('box-none');
    // The capsule trails against Search instead of floating in the centre.
    expect(flattenStyle(status.props.style)).toMatchObject({ alignItems: 'flex-end' });
    expect(view.getByTestId('roster-reconnecting')).toBeTruthy();
    expect(view.getByText('Reconnecting…')).toBeTruthy();
    expect(view.queryByTestId('roster-reconnecting-action')).toBeNull();
    expect(view.queryByTestId('roster-offline-banner')).toBeNull();
    // Product banners stay in the list; connection state never joins them.
    expect(view.getByTestId('roster-grace-banner')).toBeTruthy();
    expect(view.getByTestId('roster-row-agent:live:main')).toBeTruthy();
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
    expect(mockRefreshRoster).toHaveBeenCalledTimes(1);
    expect(mockProbeActive).toHaveBeenCalledTimes(1);
    expect(mockReconnectConnection).toHaveBeenCalledWith(mockConnections.activeConnectionId);
  });

  it('keeps manual reconnect out of native pull refresh and coalesces repeated presses', async () => {
    let finish!: () => void;
    mockReconnectConnection.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    mockConnections = snapshot({ activeState: 'offline', roster: mockRoster });
    const view = render(<RosterScreen {...props()} />);
    await act(async () => {
      fireEvent.press(view.getByTestId('roster-offline-banner-action'));
      fireEvent.press(view.getByTestId('roster-offline-banner-action'));
    });
    expect(mockReconnectConnection).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('roster-refresh-control').props.refreshing).toBe(false);
    expect(view.getByTestId('roster-list').props.contentInsetAdjustmentBehavior).toBe('never');
    expect(mockProbeActive).not.toHaveBeenCalled();
    expect(mockRefreshRoster).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await act(async () => { fireEvent.press(view.getByTestId('roster-offline-banner-action')); });
    expect(mockReconnectConnection).toHaveBeenCalledTimes(2);
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
    expect(flattenStyle(light.getByTestId('roster-add').props.style)).toMatchObject({
      position: 'absolute',
      width: 64,
      height: 64,
      borderRadius: Radius.full,
      backgroundColor: lightColors.ink,
    });
    expect(light.getByTestId('roster-header').findAllByProps({ testID: 'roster-add' })).toHaveLength(0);
    const addBottom = flattenStyle(light.getByTestId('roster-add').props.style).bottom as number;
    expect(flattenStyle(light.getByTestId('roster-list').props.contentContainerStyle).paddingBottom)
      .toBe(addBottom + 64 + Space.lg);
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
    expect(flattenStyle(dark.getByTestId('roster-add').props.style)).toMatchObject({
      width: 64,
      height: 64,
      backgroundColor: darkColors.ink,
    });
    expect(flattenStyle(dark.getByTestId('roster-account').props.style)).toMatchObject({
      backgroundColor: 'transparent',
    });
    expect(renderedFontSizes(dark)).toEqual([
      FontSize.caption,
      FontSize.secondary,
      FontSize.body,
    ]);
  });
});
