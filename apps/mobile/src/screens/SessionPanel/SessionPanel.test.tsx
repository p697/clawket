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
import { analyticsEvents } from '../../services/analytics/events';
import { FontSize, StatusSize } from '../../theme/tokens';
import {
  SessionPanelView,
  type SessionPanelViewProps,
} from './SessionPanel';
import { buildSessionPanelRows, type SessionPanelRow } from './model';

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
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }),
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

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    chatSessionSelected: jest.fn(),
    searchPerformed: jest.fn(),
    sessionAction: jest.fn(),
    sessionPanelAgentSwitched: jest.fn(),
    sessionPanelFilterChanged: jest.fn(),
    sessionPanelOpened: jest.fn(),
  },
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
    Sheet: ({ visible, testID, title, titleContent, headerRight, children, onAfterClose, snapPoints }: Record<string, unknown>) => (
      visible
        ? ReactRuntime.createElement(
          View,
          { testID, onAfterClose, snapPoints },
          titleContent ?? (title ? ReactRuntime.createElement(Text, null, title) : null),
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

jest.mock('../../components/ui/AgentAvatar', () => {
  const ReactRuntime = require('react');
  return {
    AgentAvatar: (props: Record<string, unknown>) => ReactRuntime.createElement('AgentAvatar', props),
  };
});

jest.mock('../../components/ui/SearchInput', () => {
  const ReactRuntime = require('react');
  return {
    SearchInput: (props: Record<string, unknown>) => ReactRuntime.createElement('TextInput', props),
  };
});

jest.mock('../../components/ui/FormTextInput', () => {
  const ReactRuntime = require('react');
  return {
    FormTextInput: (props: Record<string, unknown>) => ReactRuntime.createElement('TextInput', props),
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
    emoji: agentId === 'main' ? '🦞' : undefined,
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
    session('main', 'main', 'Main thread', { preview: 'Shipping the panel today.' }),
    session('main', 'channel', 'Operations', { channel: 'telegram', attention: 'approval', preview: 'Restart the registry?' }),
    session('main', 'channel', 'Design', { channel: 'slack', preview: 'Colors look right now.', updatedAt: 940_000 }),
    session('main', 'direct', 'Lucy'),
    session('main', 'subagent', 'Research', { hasActiveRun: true }),
    session('main', 'subagent', 'Completed research', { updatedAt: 100_000 }),
    session('main', 'cron', 'Daily report'),
  ];
  const builderSessions = [
    session('builder', 'main', 'Builder thread', { preview: 'Build 42 uploaded.' }),
    session('builder', 'channel', 'Release', { channel: 'slack' }),
  ];
  return {
    connection: connection(),
    source: 'live',
    syncedAt: 1_000_000,
    agents: [
      {
        agent: main,
        sessions: mainSessions,
        lastActivityAt: 950_000,
        unreadCount: 0,
        hasUnread: false,
        unreadSessionKeys: ['agent:main:channel:Design'],
        attentionCount: 1,
        attention: 'approval',
      },
      {
        agent: builder,
        sessions: builderSessions,
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
const rows = buildSessionPanelRows(source, {
  now: 1_000_000,
  pinnedSessionKeys: { 'connection:main': ['agent:main:cron:Daily report'] },
});
const capabilities = {
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
    onClose: jest.fn(),
    onSelectSession: jest.fn(),
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

function rowById(key: string, agentId = 'main'): SessionPanelRow {
  const row = rows.find((candidate) => candidate.key === key && candidate.agentId === agentId);
  if (!row) throw new Error(`Missing fixture row ${key}`);
  return row;
}

function chooseAfterDismiss(view: ReturnType<typeof render>, action: string) {
  const afterClose = view.getByTestId('session-panel-actions').props.onAfterClose;
  fireEvent.press(view.getByTestId(`session-panel-action-${action}`));
  expect(view.queryByTestId('session-panel-rename')).toBeNull();
  expect(view.queryByTestId('session-panel-confirm')).toBeNull();
  act(() => afterClose());
}

describe('SessionPanelView', () => {
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

  it('shows the current Agent in the header pill with roster-style rows and chips', () => {
    const view = render(<SessionPanelView {...props()} />);
    expect(mockedAnalyticsEvents.sessionPanelOpened).toHaveBeenCalledWith({ session_count: rows.length });
    expect(view.queryByText('Sessions')).toBeNull();
    expect(view.getByTestId('session-panel-agent-pill-avatar').props).toMatchObject({
      agentId: 'main',
      emoji: '🦞',
      variant: 'header',
    });
    expect(view.getByLabelText('Switch Agent')).toBeTruthy();

    // Main conversation first, with the Agent avatar and its preview; other Agents stay out of the list.
    const mainRow = rowById('agent:main:main');
    expect(view.getByText('Main session')).toBeTruthy();
    expect(view.getByTestId(`session-panel-row-${mainRow.id}-avatar`).props).toMatchObject({
      variant: 'panel',
      emoji: '🦞',
      status: 'idle',
    });
    expect(view.getByText('Shipping the panel today.')).toBeTruthy();
    expect(view.queryByText('Builder thread')).toBeNull();

    // Channel rows carry a monochrome platform glyph; pinned, unread, attention and working markers.
    const design = rowById('agent:main:channel:Design');
    expect(view.getByTestId(`session-panel-row-${design.id}-tile`)).toBeTruthy();
    expect(flattenStyle(view.getByTestId(`session-panel-row-${design.id}-unread`).props.style)).toMatchObject({
      width: StatusSize.dot,
      height: StatusSize.dot,
      backgroundColor: lightColors.ink,
    });
    expect(flattenStyle(view.getByTestId(`session-panel-row-${design.id}-preview`).props.style)).toMatchObject({
      color: lightColors.ink,
    });
    const operations = rowById('agent:main:channel:Operations');
    expect(flattenStyle(view.getByTestId(`session-panel-row-${operations.id}-attention`).props.style)).toMatchObject({
      width: StatusSize.dot,
      backgroundColor: lightColors.bad,
    });
    expect(view.queryByTestId(`session-panel-row-${operations.id}-unread`)).toBeNull();
    const cron = rowById('agent:main:cron:Daily report');
    expect(view.getByTestId(`session-panel-row-${cron.id}-pinned`)).toBeTruthy();
    const research = rowById('agent:main:subagent:Research');
    expect(view.queryByTestId(`session-panel-row-${research.id}-working`)).toBeNull();

    // Finished sub-agent runs fold into one trailing row that opens the Subagents chip.
    expect(view.queryByText('Completed research')).toBeNull();
    expect(view.getByTestId('session-panel-subagents')).toBeTruthy();
    expect(view.getByTestId('session-panel-chip-all').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('session-panel-chip-channel:telegram')).toBeTruthy();
    expect(view.getByTestId('session-panel-chip-channel:slack')).toBeTruthy();
    expect(view.getByTestId('session-panel-chip-direct_group')).toBeTruthy();
    expect(view.getByTestId('session-panel-chip-cron')).toBeTruthy();
    fireEvent.press(view.getByTestId('session-panel-subagents'));
    expect(mockedAnalyticsEvents.sessionPanelFilterChanged).toHaveBeenCalledWith({ filter: 'subagent' });
    expect(view.getByText('Completed research')).toBeTruthy();
    expect(view.queryByText('Main session')).toBeNull();
  });

  it('filters by channel chip and searches inside the current Agent', async () => {
    const view = render(<SessionPanelView {...props()} />);
    fireEvent.press(view.getByTestId('session-panel-chip-channel:slack'));
    expect(mockedAnalyticsEvents.sessionPanelFilterChanged).toHaveBeenCalledWith({ filter: 'channel' });
    expect(view.getByText('Design')).toBeTruthy();
    expect(view.queryByText('Operations')).toBeNull();
    expect(view.queryByText('Main session')).toBeNull();
    expect(view.queryByTestId('session-panel-subagents')).toBeNull();
    fireEvent.press(view.getByTestId('session-panel-chip-channel:slack'));
    expect(mockedAnalyticsEvents.sessionPanelFilterChanged).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByTestId('session-panel-chip-all'));
    fireEvent.changeText(view.getByTestId('session-panel-search'), 'daily');
    expect(view.getByText('Daily report')).toBeTruthy();
    expect(view.queryByText('Main session')).toBeNull();
    await waitFor(() => expect(mockedAnalyticsEvents.searchPerformed).toHaveBeenCalledWith({
      scope: 'panel',
      has_results: true,
      result_kinds: 'cron',
    }));
    fireEvent.changeText(view.getByTestId('session-panel-search'), 'completed');
    expect(view.getByText('Completed research')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('session-panel-search'), 'nothing here');
    expect(view.getByText('No matching sessions')).toBeTruthy();
  });

  it('switches the viewed Agent from the header pill without leaving the conversation', () => {
    const onSelectSession = jest.fn();
    const view = render(<SessionPanelView {...props({ onSelectSession })} />);
    expect(view.queryByTestId('session-panel-agent-menu')).toBeNull();
    fireEvent.press(view.getByTestId('session-panel-agent-pill'));
    expect(view.getByTestId('session-panel-agent-main').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('session-panel-agent-builder').props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(view.getByTestId('session-panel-agent-builder'));
    expect(mockedAnalyticsEvents.sessionPanelAgentSwitched).toHaveBeenCalledWith({ session_count: 2 });
    expect(view.queryByTestId('session-panel-agent-menu')).toBeNull();
    expect(view.getByTestId('session-panel-agent-pill-avatar').props.agentId).toBe('builder');
    expect(view.queryByText('Builder thread')).toBeNull();
    expect(view.getByText('Build 42 uploaded.')).toBeTruthy();
    expect(view.queryByText('Shipping the panel today.')).toBeNull();
    expect(view.getByTestId('session-panel-chip-channel:slack')).toBeTruthy();
    expect(view.queryByTestId('session-panel-chip-channel:telegram')).toBeNull();
    expect(onSelectSession).not.toHaveBeenCalled();

    fireEvent.press(view.getByTestId('session-panel-agent-pill'));
    fireEvent.press(view.getByTestId('session-panel-agent-menu-backdrop'));
    expect(view.queryByTestId('session-panel-agent-menu')).toBeNull();

    // Reopening returns to the conversation's own Agent and the full list.
    view.rerender(<SessionPanelView {...props({ onSelectSession, visible: false })} />);
    view.rerender(<SessionPanelView {...props({ onSelectSession })} />);
    expect(view.getByTestId('session-panel-agent-pill-avatar').props.agentId).toBe('main');
    expect(view.getByText('Main session')).toBeTruthy();
  });

  it('renders a static pill when the connection has one Agent and hides chips for a lone main chat', () => {
    const builderOnly = source.agents[1]!;
    const view = render(
      <SessionPanelView
        {...props({
          rows: rows.filter((row) => row.agentId === 'builder' && row.kind === 'main'),
          agents: [builderOnly.agent],
          currentAgentId: 'builder',
          currentSessionKey: 'agent:builder:main',
        })}
      />,
    );
    expect(view.queryByLabelText('Switch Agent')).toBeNull();
    expect(view.getByTestId('session-panel-agent-pill')).toBeTruthy();
    expect(view.queryByTestId('session-panel-chips')).toBeNull();
    expect(view.getByText('Main session')).toBeTruthy();
  });

  it('selects sessions and reports the panel as the source', async () => {
    const onSelectSession = jest.fn(async () => undefined);
    const onClose = jest.fn();
    const view = render(<SessionPanelView {...props({ onSelectSession, onClose })} />);
    const operations = rowById('agent:main:channel:Operations');
    await act(async () => {
      fireEvent.press(view.getByTestId(`session-panel-row-${operations.id}`));
    });
    expect(onSelectSession).toHaveBeenCalledWith(operations);
    expect(mockedAnalyticsEvents.chatSessionSelected).toHaveBeenCalledWith({
      source: 'panel',
      session_kind: 'channel',
      from: 'panel',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps a long press from also opening the conversation when its finger is released', () => {
    const onSelectSession = jest.fn();
    const view = render(<SessionPanelView {...props({ onSelectSession })} />);
    const row = view.getByTestId(`session-panel-row-${rowById('agent:main:main').id}`);
    fireEvent(row, 'pressIn');
    fireEvent(row, 'longPress');
    fireEvent.press(row);
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(view.getByTestId('session-panel-action-export')).toBeTruthy();
  });

  it('runs pin, reset and delete after the action sheet dismisses and labels pinned rows as Unpin', async () => {
    const onSessionAction = jest.fn(async () => undefined);
    const view = render(<SessionPanelView {...props({ onSessionAction })} />);
    const mainRow = rowById('agent:main:main');
    const cron = rowById('agent:main:cron:Daily report');

    fireEvent(view.getByTestId(`session-panel-row-${cron.id}`), 'longPress');
    expect(view.getByText('Unpin from roster')).toBeTruthy();
    chooseAfterDismiss(view, 'pin');
    expect(onSessionAction).toHaveBeenCalledWith(cron, 'pin');

    fireEvent(view.getByTestId(`session-panel-row-${mainRow.id}`), 'longPress');
    expect(view.getByText('Pin to roster')).toBeTruthy();
    chooseAfterDismiss(view, 'reset');
    expect(view.getByTestId('session-panel-confirm')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('Reset'));
    });
    expect(onSessionAction).toHaveBeenCalledWith(mainRow, 'reset');

    fireEvent(view.getByTestId(`session-panel-row-${mainRow.id}`), 'longPress');
    chooseAfterDismiss(view, 'delete');
    await act(async () => {
      fireEvent.press(view.getByLabelText('Delete'));
    });
    expect(onSessionAction).toHaveBeenCalledWith(mainRow, 'delete');
    expect(mockedAnalyticsEvents.sessionAction.mock.calls).toEqual([
      [{ action: 'pin' }],
      [{ action: 'reset' }],
      [{ action: 'delete' }],
    ]);
  });

  it('renames through a cross-platform editor and passes the trimmed title to the host', async () => {
    const onSessionAction = jest.fn(async () => undefined);
    const mainRow = rowById('agent:main:main');
    const view = render(<SessionPanelView {...props({ onSessionAction })} />);

    fireEvent(view.getByTestId(`session-panel-row-${mainRow.id}`), 'longPress');
    chooseAfterDismiss(view, 'rename');

    expect(view.getByTestId('session-panel-rename')).toBeTruthy();
    expect(view.getByTestId('session-panel-rename-input').props.value).toBe(mainRow.title);

    fireEvent.changeText(view.getByTestId('session-panel-rename-input'), '  Launch review  ');
    await act(async () => {
      fireEvent.press(view.getByLabelText('Save'));
    });

    expect(onSessionAction).toHaveBeenCalledWith(mainRow, 'rename', { title: 'Launch review' });
    expect(mockedAnalyticsEvents.sessionAction).toHaveBeenCalledWith({ action: 'rename' });
    await waitFor(() => expect(view.queryByTestId('session-panel-rename')).toBeNull());
  });

  it('keeps rename open for invalid drafts and failed host updates', async () => {
    const onSessionAction = jest.fn(async () => {
      throw new Error('rename failed');
    });
    const mainRow = rowById('agent:main:main');
    const view = render(<SessionPanelView {...props({ onSessionAction })} />);

    fireEvent(view.getByTestId(`session-panel-row-${mainRow.id}`), 'longPress');
    chooseAfterDismiss(view, 'rename');
    fireEvent.changeText(view.getByTestId('session-panel-rename-input'), '   ');
    expect(view.getByLabelText('Save').props.disabled).toBe(true);

    fireEvent.changeText(view.getByTestId('session-panel-rename-input'), 'New title');
    await act(async () => {
      fireEvent.press(view.getByLabelText('Save'));
    });

    expect(onSessionAction).toHaveBeenCalledWith(mainRow, 'rename', { title: 'New title' });
    expect(view.getByTestId('session-panel-rename')).toBeTruthy();
  });

  it('covers loading, empty, error, offline cached, permission, and old bridge states', () => {
    const view = render(<SessionPanelView {...props({ state: 'loading' })} />);
    expect(view.getByTestId('session-panel-loading')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'empty', rows: [] })} />);
    expect(view.getByText('No sessions yet')).toBeTruthy();
    expect(view.queryByTestId('session-panel-chips')).toBeNull();

    view.rerender(<SessionPanelView {...props({ state: 'error' })} />);
    expect(view.getByTestId('session-panel-error')).toBeTruthy();
    expect(view.getByText('Main session')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'offline' })} />);
    expect(view.getByTestId('session-panel-offline')).toBeTruthy();
    expect(view.getByText('Main session')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'offline', reconnecting: true })} />);
    expect(view.getByTestId('session-panel-reconnecting')).toBeTruthy();
    expect(view.queryByTestId('session-panel-offline')).toBeNull();
    expect(view.getByText('Main session')).toBeTruthy();

    view.rerender(<SessionPanelView {...props({ state: 'permission' })} />);
    expect(view.getByTestId('session-panel-permission')).toBeTruthy();
    expect(view.queryByText('Main session')).toBeNull();
    expect(view.queryByTestId('session-panel-chips')).toBeNull();

    view.rerender(<SessionPanelView {...props({ bridgeOutdated: true })} />);
    expect(view.getByTestId('session-panel-bridge-outdated')).toBeTruthy();
  });

  it('uses exactly the title, preview, and time tiers with borderless dark rows and chips', () => {
    mockTheme = { scheme: 'dark', colors: darkColors };
    const view = render(<SessionPanelView {...props()} />);
    const mainRow = rowById('agent:main:main');
    const rowStyle = flattenStyle(view.getByTestId(`session-panel-row-${mainRow.id}`).props.style);
    expect(rowStyle).toEqual(expect.objectContaining({ backgroundColor: darkColors.accentSoft }));
    expect(rowStyle).not.toHaveProperty('borderWidth');
    const chipStyle = flattenStyle(view.getByTestId('session-panel-chip-all').props.style);
    expect(chipStyle).toEqual(expect.objectContaining({ backgroundColor: darkColors.ink }));
    expect(chipStyle).not.toHaveProperty('borderWidth');
    expect(renderedFontSizes(view)).toEqual([
      FontSize.caption,
      FontSize.secondary,
      FontSize.body,
    ]);
  });
});

it('does not offer session creation without a handler or an Agent', () => {
  const view = render(<SessionPanelView {...props()} />);
  expect(view.queryByText('New session')).toBeNull();
  view.rerender(<SessionPanelView {...props({ rows: [], agents: [] })} />);
  expect(view.queryByText('New session')).toBeNull();
  expect(view.queryByTestId('session-panel-agent-pill')).toBeNull();
});

 it('coalesces repeated header creation taps while creation is pending', async () => {
   let finish!: () => void;
   const onCreateSession = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
   const onClose = jest.fn();
   const view = render(<SessionPanelView {...props({ onCreateSession, onClose })} />);
   expect(view.getByTestId('session-panel').props.snapPoints).toEqual(['95%']);
   const create = view.getByTestId('session-panel-create');
   fireEvent.press(create);
   fireEvent.press(create);
   await act(async () => Promise.resolve());
   expect(onCreateSession).toHaveBeenCalledTimes(1);
   expect(onClose).not.toHaveBeenCalled();
   await act(async () => finish());
   expect(onClose).toHaveBeenCalledTimes(1);
 });
