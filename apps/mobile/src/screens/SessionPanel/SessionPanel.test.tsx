import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../../connection';
import { FontSize } from '../../theme/tokens';
import {
  SessionPanelView,
  type SessionPanelViewProps,
} from './SessionPanel';
import { buildSessionPanelRows } from './model';

const lightColors = {
  canvas: '#FFFFFF',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  accent: '#1F5EFF',
  accentSoft: '#E8EEFF',
  good: '#178A6A',
  warn: '#D9791C',
  warnSoft: '#FAEDE1',
  bad: '#D64545',
  badSoft: '#F9E7E7',
};

const darkColors = {
  ...lightColors,
  canvas: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
  line: '#2A2A2F',
  accent: '#6B95FF',
  accentSoft: '#1B2947',
  good: '#2FA07C',
  warn: '#D07F30',
  warnSoft: '#3A2B1E',
  bad: '#E06060',
  badSoft: '#3B2224',
};

let mockTheme = { scheme: 'light' as 'light' | 'dark', colors: lightColors };

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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => key.replace(
      /\{\{(\w+)\}\}/g,
      (_match, name: string) => String(options?.[name] ?? ''),
    ),
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => ({ refreshRoster: jest.fn(), probeActive: jest.fn() }),
  useConnections: jest.fn(),
  useRoster: jest.fn(),
}));

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { Text, View } = require('react-native');
  return {
    Sheet: ({ visible, testID, title, headerRight, children }: Record<string, unknown>) => (
      visible
        ? ReactRuntime.createElement(
          View,
          { testID },
          title ? ReactRuntime.createElement(Text, null, title) : null,
          headerRight,
          children,
        )
        : null
    ),
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: (props: Record<string, unknown>) => ReactRuntime.createElement(Pressable, props),
  };
});

jest.mock('../../components/ui/SegmentedTabs', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SegmentedTabs: ({ tabs, onSwitch, testID }: {
      tabs: ReadonlyArray<{ key: string; label: string }>;
      onSwitch: (key: string) => void;
      testID: string;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ...tabs.map((tab) => ReactRuntime.createElement(
        Pressable,
        { key: tab.key, testID: `${testID}-${tab.key}`, onPress: () => onSwitch(tab.key) },
        ReactRuntime.createElement(Text, null, tab.label),
      )),
    ),
  };
});

jest.mock('../../components/ui/SearchInput', () => {
  const ReactRuntime = require('react');
  return {
    SearchInput: (props: Record<string, unknown>) => ReactRuntime.createElement('TextInput', props),
  };
});

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
      actionLabel ? ReactRuntime.createElement(
        Pressable,
        { testID: `${testID}-action`, onPress: onAction },
        ReactRuntime.createElement(Text, null, actionLabel),
      ) : null,
    ),
  };
});

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ label, onPress, ...props }: Record<string, unknown>) => ReactRuntime.createElement(
      Pressable,
      { ...props, accessibilityLabel: label, onPress },
      ReactRuntime.createElement(Text, null, label),
    ),
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return { Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props) };
});

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

function connection(): ConnectionDescriptor {
  return {
    id: 'connection',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    createdAt: 1,
    isFreeSlot: true,
  };
}

function agent(agentId: string): AgentDescriptor {
  return {
    connectionId: 'connection',
    agentId,
    name: agentId === 'main' ? 'Main' : 'Builder',
    isMain: agentId === 'main',
    mainSessionKey: `agent:${agentId}:main`,
  };
}

function session(
  agentId: string,
  kind: SessionDescriptor['kind'],
  title: string,
  patch: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    connectionId: 'connection',
    agentId,
    key: kind === 'main' ? `agent:${agentId}:main` : `agent:${agentId}:${kind}:${title}`,
    kind,
    title,
    updatedAt: 950_000,
    hasActiveRun: false,
    attention: null,
    allowedActions: { pin: true, rename: true, reset: true, delete: true },
    ...patch,
  };
}

function roster(): RosterConnectionGroup {
  const main = agent('main');
  const builder = agent('builder');
  const mainSessions = [
    session('main', 'main', 'Main thread'),
    session('main', 'channel', 'Operations', { channel: 'telegram', attention: 'approval' }),
    session('main', 'direct', 'Lucy'),
    session('main', 'subagent', 'Research', { hasActiveRun: true }),
    session('main', 'subagent', 'Completed research', { updatedAt: 100_000 }),
    session('main', 'cron', 'Daily report'),
  ];
  const builderSessions = [session('builder', 'main', 'Builder thread')];
  return {
    connection: connection(),
    source: 'live',
    syncedAt: 1_000_000,
    agents: [
      {
        agent: main,
        sessions: mainSessions,
        updatedAt: 950_000,
        lastActivityAt: 950_000,
        unreadCount: 0,
        hasUnread: false,
        attentionCount: 1,
        attention: 'approval',
      },
      {
        agent: builder,
        sessions: builderSessions,
        updatedAt: 950_000,
        lastActivityAt: 950_000,
        unreadCount: 0,
        hasUnread: false,
        attentionCount: 0,
        attention: null,
      },
    ],
    unreadCount: 0,
    attentionCount: 1,
    lastActivityAt: 950_000,
  };
}

const source = roster();
const rows = buildSessionPanelRows(source, { now: 1_000_000 });
const capabilities = {
  sessionCreate: true,
  sessionRename: true,
  sessionReset: true,
  sessionDelete: true,
};

function props(patch: Partial<SessionPanelViewProps> = {}): SessionPanelViewProps {
  return {
    visible: true,
    state: 'ready',
    rows,
    agents: source.agents.map((summary) => summary.agent),
    currentAgentId: 'main',
    currentSessionKey: 'agent:main:main',
    capabilities,
    initialMode: 'grouped',
    onClose: jest.fn(),
    onSelectSession: jest.fn(),
    onCreateSession: jest.fn(),
    onSessionAction: jest.fn(),
    ...patch,
  };
}

type RenderNode = Readonly<{ props: Readonly<Record<string, unknown>> }>;

function renderedFontSizes(view: ReturnType<typeof render>): ReadonlyArray<number> {
  const sizes = new Set<number>();
  view.UNSAFE_root.findAll((node: RenderNode) => Boolean(node.props.style)).forEach((node: RenderNode) => {
    const value = flattenStyle(node.props.style).fontSize;
    if (typeof value === 'number') sizes.add(value);
  });
  return [...sizes].sort((left, right) => left - right);
}

describe('SessionPanelView', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: lightColors };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('expands the current Agent, keeps others folded, and reveals completed runs', () => {
    const view = render(<SessionPanelView {...props()} />);
    expect(view.getByText('Main thread')).toBeTruthy();
    expect(view.queryByText('Builder thread')).toBeNull();
    expect(view.getByText('Completed 1')).toBeTruthy();
    expect(view.queryByText('Completed research')).toBeNull();

    fireEvent.press(view.getByTestId('session-panel-completed-toggle'));
    expect(view.getByText('Completed research')).toBeTruthy();
    fireEvent.press(view.getByTestId('session-panel-agent-builder-toggle'));
    expect(view.getByText('Builder thread')).toBeTruthy();
  });

  it('switches to compact list, reports summary, searches, and opens kind filter', () => {
    const onOpenKindFilter = jest.fn();
    const view = render(
      <SessionPanelView
        {...props({ visibleRowCapacity: 2, onOpenKindFilter })}
      />,
    );
    expect(view.getByTestId('session-panel-quick-filter')).toBeTruthy();
    fireEvent.press(view.getByTestId('session-panel-mode-list'));
    expect(view.getByTestId('session-panel-list-mode')).toBeTruthy();
    expect(view.getByText('6 active · 0 recent · 1 idle')).toBeTruthy();
    expect(view.getAllByTestId(/-icon$/)).toHaveLength(rows.length);
    fireEvent.press(view.getByTestId('session-panel-kind-filter'));
    expect(onOpenKindFilter).toHaveBeenCalledWith('all');

    fireEvent.press(view.getByTestId('session-panel-search-toggle'));
    fireEvent.changeText(view.getByTestId('session-panel-search'), 'daily');
    expect(view.getByText('Daily report')).toBeTruthy();
    expect(view.queryByText('Main thread')).toBeNull();
  });

  it('selects and closes, then exposes capability-gated actions with destructive confirmation', async () => {
    const onClose = jest.fn();
    const onSelectSession = jest.fn(async () => undefined);
    const onSessionAction = jest.fn(async () => undefined);
    const mainRow = rows.find((row) => row.kind === 'main' && row.agentId === 'main')!;
    const view = render(
      <SessionPanelView
        {...props({ onClose, onSelectSession, onSessionAction })}
      />,
    );

    fireEvent.press(view.getByTestId(`session-panel-row-${mainRow.id}`));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSelectSession).toHaveBeenCalledWith(mainRow);

    fireEvent(view.getByTestId(`session-panel-row-${mainRow.id}`), 'longPress');
    expect(view.getByTestId('session-panel-actions')).toBeTruthy();
    fireEvent.press(view.getByTestId('session-panel-action-delete'));
    expect(view.getByTestId('session-panel-confirm')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Delete'));
    });
    expect(onSessionAction).toHaveBeenCalledWith(mainRow, 'delete');
  });

  it('covers loading, empty, error, offline cached, permission, and old bridge states', () => {
    const view = render(<SessionPanelView {...props({ state: 'loading' })} />);
    expect(view.getByTestId('session-panel-loading')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'empty', rows: [] })} />);
    expect(view.getByText('No sessions yet')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'error' })} />);
    expect(view.getByTestId('session-panel-error')).toBeTruthy();
    expect(view.getByText('Main thread')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'offline' })} />);
    expect(view.getByTestId('session-panel-offline')).toBeTruthy();
    expect(view.getByText('Main thread')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'permission' })} />);
    expect(view.getByTestId('session-panel-permission')).toBeTruthy();
    expect(view.queryByText('Main thread')).toBeNull();

    view.rerender(<SessionPanelView {...props({ bridgeOutdated: true })} />);
    expect(view.getByTestId('session-panel-bridge-outdated')).toBeTruthy();
  });

  it('uses exactly the grouped title, row, and time tiers with borderless dark rows', () => {
    mockTheme = { scheme: 'dark', colors: darkColors };
    const view = render(<SessionPanelView {...props()} />);
    const mainRow = rows.find((row) => row.kind === 'main' && row.agentId === 'main')!;
    const rowStyle = flattenStyle(view.getByTestId(`session-panel-row-${mainRow.id}`).props.style);
    expect(rowStyle).toEqual(expect.objectContaining({ backgroundColor: darkColors.accentSoft }));
    expect(rowStyle).not.toHaveProperty('borderWidth');
    expect(renderedFontSizes(view)).toEqual([
      FontSize.caption,
      FontSize.secondary,
      FontSize.body,
    ]);
  });
});
