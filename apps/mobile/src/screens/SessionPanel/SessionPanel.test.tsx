import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import { useConnections, useRoster, type RosterConnectionGroup } from '../../connection';
import { analyticsEvents } from '../../services/analytics/events';
import { FontSize, Motion, Space, StatusSize } from '../../theme/tokens';
import { CONNECTION_STATUS_FLOATING_CLEARANCE } from '../../components/ui/ConnectionStatusPill';
import {
  SessionPanel,
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
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
    Keyboard: { dismiss: jest.fn() },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) },
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

// On device the Sheet renders through Gorhom's portal, where context from above it is gone. A test can
// switch the mock to that mode: it hands the header and body to `mockPortaledSheet` instead of rendering them.
let mockPortaledSheet: { titleContent: unknown; children: unknown } | null = null;
let mockPortalMode = false;
jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { Text, View } = require('react-native');
  return {
    Sheet: ({ visible, testID, title, titleContent, headerRight, children, onAfterClose, snapPoints }: Record<string, unknown>) => {
      if (mockPortalMode && visible && testID === 'session-panel') {
        mockPortaledSheet = { titleContent, children };
        return null;
      }
      return visible
        ? ReactRuntime.createElement(
          View,
          { testID, onAfterClose, snapPoints },
          titleContent ?? (title ? ReactRuntime.createElement(Text, null, title) : null),
          headerRight,
          children,
        )
        : null;
    },
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: (props: Record<string, unknown>) => ReactRuntime.createElement(Pressable, props),
    createFloatingSurfaceStyle: () => ({ backgroundColor: 'floating' }),
    FLOATING_BUTTON_STROKE_WIDTH: 1.75,
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

describe('SessionPanelView portal', () => {
  afterEach(() => {
    mockPortalMode = false;
    mockPortaledSheet = null;
  });

  it('keeps the product face on the Agent pill when the sheet renders outside the panel tree', () => {
    mockPortalMode = true;
    render(<SessionPanelView {...props({ platform: 'codex' })} />);
    expect(mockPortaledSheet).not.toBeNull();
    // A separate root, like the portal host: the provider around <Sheet> is not an ancestor here.
    const portal = render(<>{mockPortaledSheet?.titleContent as React.ReactNode}{mockPortaledSheet?.children as React.ReactNode}</>);
    const pillAvatar = portal.UNSAFE_getAllByType('AgentAvatar' as unknown as React.ComponentType)
      .find((node) => node.props.testID === 'session-panel-agent-pill-avatar');
    expect(pillAvatar?.props.platform).toBe('codex');
  });
});

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

  it('renders only the first screen of sessions while the panel slides up, then widens the list window', () => {
    jest.useFakeTimers();
    try {
      const view = render(<SessionPanelView {...props()} />);
      const windowSize = () => view.getByTestId('session-panel-scroll').props.windowSize;
      // Rows the list renders ahead would mount during the slide and drop its frames.
      expect(windowSize()).toBe(1);
      act(() => jest.advanceTimersByTime(Motion.duration.slow + 79));
      expect(windowSize()).toBe(1);
      act(() => jest.advanceTimersByTime(1));
      expect(windowSize()).toBe(5);
      // Each opening starts on its first screen again.
      view.rerender(<SessionPanelView {...props({ visible: false })} />);
      view.rerender(<SessionPanelView {...props()} />);
      expect(windowSize()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
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
    expect(view.getByText('Scheduled task: Daily report')).toBeTruthy();
    expect(view.queryByText('Main session')).toBeNull();
    await waitFor(() => expect(mockedAnalyticsEvents.searchPerformed).toHaveBeenCalledWith({
      scope: 'panel',
      has_results: true,
      result_kinds: 'cron',
    }));
    fireEvent.changeText(view.getByTestId('session-panel-search'), 'scheduled task');
    expect(view.getByText('Scheduled task: Daily report')).toBeTruthy();
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

  it('runs home toggle, reset and delete after the action sheet dismisses and labels shown rows as Hide', async () => {
    const onSessionAction = jest.fn(async () => undefined);
    const view = render(<SessionPanelView {...props({ onSessionAction })} />);
    const mainRow = rowById('agent:main:main');
    const cron = rowById('agent:main:cron:Daily report');

    // Conversations are shown on or hidden from home; only Agents pin (owner decision 2026-09-27).
    fireEvent(view.getByTestId(`session-panel-row-${cron.id}`), 'longPress');
    expect(view.getByText('Hide from home')).toBeTruthy();
    chooseAfterDismiss(view, 'pin');
    expect(onSessionAction).toHaveBeenCalledWith(cron, 'pin');

    fireEvent(view.getByTestId(`session-panel-row-${mainRow.id}`), 'longPress');
    expect(view.getByText('Show on home')).toBeTruthy();
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

  it('names scheduled runs with the localized kind and renames only the job name', async () => {
    const onSessionAction = jest.fn(async () => undefined);
    const cronRows = buildSessionPanelRows({
      ...source,
      agents: [{
        ...source.agents[0],
        sessions: [
          session('main', 'main', 'Main thread'),
          session('main', 'cron', 'Automation: Morning digest'),
          session('main', 'cron', 'Cron: Nightly backup'),
          session('main', 'cron', 'untitled', { title: 'agent:main:cron:untitled' }),
        ],
      }],
    }, { now: 1_000_000 });
    const view = render(<SessionPanelView {...props({ rows: cronRows, onSessionAction })} />);

    expect(view.getByText('Scheduled task: Morning digest')).toBeTruthy();
    expect(view.getByText('Scheduled task: Nightly backup')).toBeTruthy();
    expect(view.getByText('Scheduled task')).toBeTruthy();
    expect(view.queryByText(/Automation|Cron:|New session/)).toBeNull();

    const digest = cronRows.find((row) => row.title === 'Automation: Morning digest')!;
    fireEvent(view.getByTestId(`session-panel-row-${digest.id}`), 'longPress');
    chooseAfterDismiss(view, 'rename');
    expect(view.getByTestId('session-panel-rename-input').props.value).toBe('Morning digest');
    expect(view.getByLabelText('Save').props.disabled).toBe(true);

    fireEvent.changeText(view.getByTestId('session-panel-rename-input'), 'Evening digest');
    await act(async () => {
      fireEvent.press(view.getByLabelText('Save'));
    });
    expect(onSessionAction).toHaveBeenCalledWith(digest, 'rename', { title: 'Evening digest' });
  });

  it('shows row times through the localized relative-time copy', () => {
    const now = Date.now();
    const timedRows = buildSessionPanelRows({
      ...source,
      agents: [{
        ...source.agents[0],
        sessions: [
          session('main', 'main', 'Main thread', { updatedAt: now - 5 * 60_000 }),
          session('main', 'direct', 'Lucy', { updatedAt: now - 3 * 60 * 60_000 }),
        ],
      }],
    }, { now });
    const view = render(<SessionPanelView {...props({ rows: timedRows })} />);
    expect(view.getByText('5m ago')).toBeTruthy();
    expect(view.getByText('3h ago')).toBeTruthy();
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
    // Connection state floats over the bottom of the list instead of leading it, and the last row can
    // still scroll above it.
    const list = view.getByTestId('session-panel-scroll');
    expect(list.findAll((node) => node.props.testID === 'session-panel-reconnecting')).toHaveLength(0);
    expect(flattenStyle(view.getByTestId('session-panel-reconnecting').props.style)).toMatchObject({ position: 'absolute', bottom: Space.sm });
    expect(flattenStyle(list.props.contentContainerStyle).paddingBottom).toBe(Space.xxl + CONNECTION_STATUS_FLOATING_CLEARANCE);

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


describe('project refresh lifecycle', () => {
  const project = { id: 'project-a', name: 'Work', path: '/work', available: true };
  const props = { currentAgentId: 'main', currentSessionKey: 'agent:main:main', onClose: jest.fn(), onSelectSession: jest.fn(), onCreateSession: jest.fn() };
  function connect(list: jest.Mock, id = 'connection') {
    const adapter = { connection: { id }, capabilities: { ...capabilities, projects: true, sessionCreate: true }, projects: { list }, createSession: jest.fn() };
    jest.mocked(useConnections).mockReturnValue({ initialized: true, activeConnectionId: id, activeAdapter: adapter, activeState: 'ready', error: null } as unknown as ReturnType<typeof useConnections>);
    jest.mocked(useRoster).mockReturnValue([source]);
    return adapter;
  }
  it('does not scan while hidden or on close; cached projects keep New session usable while refreshing', async () => {
    const list = jest.fn().mockResolvedValue([project]);
    connect(list);
    const tree = render(<SessionPanel {...props} visible={false} />);
    expect(list).not.toHaveBeenCalled();
    tree.rerender(<SessionPanel {...props} visible />);
    await waitFor(() => expect(tree.getByTestId('session-panel-create')).toBeTruthy());
    expect(list).toHaveBeenCalledTimes(1);
    tree.rerender(<SessionPanel {...props} visible={false} />);
    expect(list).toHaveBeenCalledTimes(1);
    list.mockImplementation(() => new Promise(() => {}));
    tree.rerender(<SessionPanel {...props} visible />);
    expect(list).toHaveBeenCalledTimes(2);
    expect(tree.getByTestId('session-panel-create')).toBeTruthy();
  });
  it('discards late project results from a replaced adapter', async () => {
    let finish!: (value: typeof project[]) => void;
    connect(jest.fn(() => new Promise(resolve => { finish = resolve; })));
    const tree = render(<SessionPanel {...props} visible />);
    connect(jest.fn().mockResolvedValue([]));
    tree.rerender(<SessionPanel {...props} visible />);
    await act(async () => {});
    await act(async () => finish([project]));
    expect(tree.queryByTestId('session-panel-create')).toBeNull();
  });
  it('keeps creation reachable after a roster refresh error, but never while offline or denied', async () => {
    connect(jest.fn().mockResolvedValue([project]));
    const tree = render(<SessionPanel {...props} visible />);
    await waitFor(() => expect(tree.getByTestId('session-panel-create')).toBeTruthy());
    const snapshot = jest.mocked(useConnections).mock.results.at(-1)!.value;
    jest.mocked(useConnections).mockReturnValue({ ...snapshot, error: { operation: 'roster', message: 'Timed out' } });
    tree.rerender(<SessionPanel {...props} visible />);
    expect(tree.getByTestId('session-panel-error')).toBeTruthy();
    expect(tree.getByTestId('session-panel-create')).toBeTruthy();
    tree.rerender(<SessionPanel {...props} permissionDenied visible />);
    expect(tree.queryByTestId('session-panel-create')).toBeNull();
    jest.mocked(useConnections).mockReturnValue({ ...snapshot, activeState: 'offline' });
    tree.rerender(<SessionPanel {...props} visible />);
    expect(tree.queryByTestId('session-panel-create')).toBeNull();
  });
  it('keeps the current cache on refresh failure, without enabling creation for another adapter', async () => {
    const list = jest.fn().mockResolvedValue([project]);
    connect(list);
    const tree = render(<SessionPanel {...props} visible />);
    await waitFor(() => expect(tree.getByTestId('session-panel-create')).toBeTruthy());
    tree.rerender(<SessionPanel {...props} visible={false} />);
    list.mockRejectedValue(new Error('Offline'));
    tree.rerender(<SessionPanel {...props} visible />);
    await act(async () => {});
    expect(tree.getByTestId('session-panel-create')).toBeTruthy();
    connect(jest.fn(() => new Promise(() => {})));
    tree.rerender(<SessionPanel {...props} visible />);
    expect(tree.queryByTestId('session-panel-create')).toBeNull();
  });
});

it('loads archives only on request and restores without opening a writable chat', async () => {
  const archived = { ...rowById('agent:main:main'), archived: true, sessionId: 'native-id', allowedActions: { archive: true, rename: false, reset: false, delete: false, pin: false }, hasActiveRun: false };
  const onLoadArchived = jest.fn().mockResolvedValue([archived]);
  const onSessionAction = jest.fn().mockResolvedValue(undefined);
  const onSelectSession = jest.fn();
  const view = render(<SessionPanelView {...props({ capabilities: { ...capabilities, sessionArchive: true }, onLoadArchived, onSessionAction, onSelectSession })} />);
  expect(onLoadArchived).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByTestId('session-panel-archived')); });
  fireEvent.press(view.getByTestId(`session-panel-row-${archived.id}`));
  expect(onSelectSession).not.toHaveBeenCalled();
  expect(view.getByText('Restore conversation')).toBeTruthy();
  expect(view.queryByTestId('session-panel-action-delete')).toBeNull();
  await act(async () => { chooseAfterDismiss(view, 'archive'); });
  expect(onSessionAction).toHaveBeenCalledWith(archived, 'archive');
  expect(view.queryByTestId(`session-panel-row-${archived.id}`)).toBeNull();
});

it('shows archive failure and keeps the original conversation available', async () => {
  const original = { ...rowById('agent:main:main'), sessionId: 'native-id', allowedActions: { archive: true, rename: false, reset: false, delete: false, pin: false }, hasActiveRun: false };
  const onSessionAction = jest.fn().mockRejectedValue(new Error('Owner rejected archive'));
  const view = render(<SessionPanelView {...props({ rows: [original], capabilities: { ...capabilities, sessionArchive: true }, onSessionAction })} />);
  fireEvent(view.getByTestId(`session-panel-row-${original.id}`), 'longPress');
  await act(async () => { chooseAfterDismiss(view, 'archive'); });
  expect(view.getByText('Save Failed')).toBeTruthy();
  expect(view.getByTestId(`session-panel-row-${original.id}`)).toBeTruthy();
});

it.each(['resolve', 'reject'] as const)('ignores an old connection restore %s after opening another archive scope', async outcome => {
  const archived = { ...rowById('agent:main:main'), archived: true, sessionId: 'native-id', allowedActions: { archive: true, rename: false, reset: false, delete: false, pin: false }, hasActiveRun: false };
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const onSessionAction = jest.fn(() => new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
  const shared = { capabilities: { ...capabilities, sessionArchive: true }, onLoadArchived: jest.fn().mockResolvedValue([archived]), onSessionAction };
  const view = render(<SessionPanelView {...props({ ...shared, archiveScope: 'first' })} />);
  await act(async () => { fireEvent.press(view.getByTestId('session-panel-archived')); });
  fireEvent.press(view.getByTestId(`session-panel-row-${archived.id}`));
  act(() => { chooseAfterDismiss(view, 'archive'); });
  view.rerender(<SessionPanelView {...props({ ...shared, archiveScope: 'second' })} />);
  await act(async () => { fireEvent.press(view.getByTestId('session-panel-archived')); });
  await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('Old restore failed')); });
  expect(view.queryByText('Save Failed')).toBeNull();
  expect(view.getByTestId(`session-panel-row-${archived.id}`)).toBeTruthy();
});

describe('project and archive scope chips', () => {
  const work = { id: 'work', name: 'clawket', path: '/work/clawket', available: true };
  const lab = { id: 'lab', name: 'workspace-ui-operator', path: '/lab/ui', available: true };
  const direct = { ...rowById('agent:main:direct:Lucy'), project: work };
  const design = { ...rowById('agent:main:channel:Design'), project: work };
  const operations = { ...rowById('agent:main:channel:Operations'), project: lab };
  const archived = {
    ...rowById('agent:main:cron:Daily report'),
    project: lab,
    archived: true,
    sessionId: 'native-id',
    hasActiveRun: false,
    allowedActions: { archive: true, rename: false, reset: false, delete: false, pin: false },
  };
  function scoped(patch: Partial<SessionPanelViewProps> = {}): SessionPanelViewProps {
    return props({
      rows: [direct, design, operations],
      projects: [work, lab],
      capabilities: { ...capabilities, sessionArchive: true },
      onLoadArchived: jest.fn().mockResolvedValue([archived]),
      ...patch,
    });
  }
  function selected(view: ReturnType<typeof render>, testID: string): unknown {
    return view.getByTestId(testID).props.accessibilityState?.selected;
  }

  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: lightColors };
  });

  it('keeps the project filter and the archive switch in one quiet chip row', () => {
    const view = render(<SessionPanelView {...scoped()} />);
    const scope = view.getByTestId('session-panel-scope');
    expect(within(scope).getByText('All projects')).toBeTruthy();
    expect(within(scope).getByText('Archived')).toBeTruthy();
    expect(view.getByTestId('session-panel-archived').props.accessibilityLabel).toBe('Archived conversations');
    expect(selected(view, 'codex-project-filter')).toBe(false);
    expect(selected(view, 'session-panel-archived')).toBe(false);
    expect(flattenStyle(view.getByTestId('codex-project-filter').props.style))
      .toEqual(expect.objectContaining({ backgroundColor: lightColors.surface }));
    // Projects replace the channel chips; the old stacked text links are gone.
    expect(view.queryByTestId('session-panel-chips')).toBeNull();
    expect(view.queryByText('Back to conversations')).toBeNull();

    // A project backend without archive support keeps only the project chip.
    view.rerender(<SessionPanelView {...scoped({ capabilities, onLoadArchived: undefined })} />);
    expect(within(view.getByTestId('session-panel-scope')).getByTestId('codex-project-filter')).toBeTruthy();
    expect(view.queryByTestId('session-panel-archived')).toBeNull();
  });

  it('marks the chosen project in ink and counts conversations in the picker', () => {
    const view = render(<SessionPanelView {...scoped()} />);
    fireEvent.press(view.getByTestId('codex-project-filter'));
    const picker = view.getByTestId('codex-project-picker');
    // The checked row shows no count; the others say how many conversations the choice would list.
    expect(within(picker).getByTestId('codex-project-all')).toBeTruthy();
    expect(within(picker).queryByText('3')).toBeNull();
    expect(within(picker).getByText('2')).toBeTruthy();
    expect(within(picker).getByText('1')).toBeTruthy();

    fireEvent.press(within(picker).getByTestId('codex-project-work'));
    expect(view.queryByTestId('codex-project-picker')).toBeNull();
    const chip = view.getByTestId('codex-project-filter');
    expect(selected(view, 'codex-project-filter')).toBe(true);
    expect(within(chip).getByText('clawket')).toBeTruthy();
    expect(flattenStyle(chip.props.style)).toEqual(expect.objectContaining({ backgroundColor: lightColors.ink }));
    expect(view.getByTestId(`session-panel-row-${direct.id}`)).toBeTruthy();
    expect(view.queryByTestId(`session-panel-row-${operations.id}`)).toBeNull();
    expect(view.queryByTestId(`session-panel-row-${direct.id}-project`)).toBeNull();
  });

  it('selects the archive at once and a second press returns to the live list', async () => {
    let finish!: (value: ReadonlyArray<SessionPanelRow>) => void;
    const onLoadArchived = jest.fn(() => new Promise<ReadonlyArray<SessionPanelRow>>((resolve) => { finish = resolve; }));
    const view = render(<SessionPanelView {...scoped({ onLoadArchived, onCreateSession: jest.fn() })} />);
    expect(view.getByTestId('session-panel-create')).toBeTruthy();

    fireEvent.press(view.getByTestId('session-panel-archived'));
    expect(selected(view, 'session-panel-archived')).toBe(true);
    expect(view.getByTestId('session-panel-loading')).toBeTruthy();
    expect(view.queryByTestId('session-panel-create')).toBeNull();

    fireEvent.press(view.getByTestId('session-panel-archived'));
    expect(selected(view, 'session-panel-archived')).toBe(false);
    expect(view.getByTestId(`session-panel-row-${direct.id}`)).toBeTruthy();
    expect(view.getByTestId('session-panel-create')).toBeTruthy();
    // The cancelled load cannot switch the list afterwards.
    await act(async () => finish([archived]));
    expect(selected(view, 'session-panel-archived')).toBe(false);
    expect(view.queryByTestId(`session-panel-row-${archived.id}`)).toBeNull();
  });

  it('explains a failed archive load and retries from the notice', async () => {
    const onLoadArchived = jest.fn()
      .mockRejectedValueOnce(new Error('Bridge unavailable'))
      .mockResolvedValueOnce([archived]);
    const view = render(<SessionPanelView {...scoped({ onLoadArchived })} />);
    await act(async () => { fireEvent.press(view.getByTestId('session-panel-archived')); });
    expect(view.getByText('Could not load archived conversations')).toBeTruthy();
    expect(view.queryByText('Save Failed')).toBeNull();
    expect(selected(view, 'session-panel-archived')).toBe(false);
    expect(view.getByTestId(`session-panel-row-${direct.id}`)).toBeTruthy();

    await act(async () => { fireEvent.press(view.getByTestId('session-panel-archive-error-action')); });
    expect(onLoadArchived).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId('session-panel-archive-error')).toBeNull();
    expect(selected(view, 'session-panel-archived')).toBe(true);
    expect(view.getByTestId(`session-panel-row-${archived.id}`)).toBeTruthy();
  });

  it('keeps the chosen project while browsing the archive', async () => {
    const view = render(<SessionPanelView {...scoped()} />);
    fireEvent.press(view.getByTestId('codex-project-filter'));
    fireEvent.press(view.getByTestId('codex-project-work'));
    await act(async () => { fireEvent.press(view.getByTestId('session-panel-archived')); });
    expect(view.getByText('No archived conversations')).toBeTruthy();

    fireEvent.press(view.getByTestId('codex-project-filter'));
    fireEvent.press(view.getByTestId('codex-project-lab'));
    expect(view.getByTestId(`session-panel-row-${archived.id}`)).toBeTruthy();
    expect(selected(view, 'session-panel-archived')).toBe(true);
  });

  it('appends the archive switch to channel chips on a backend without projects', () => {
    const view = render(<SessionPanelView {...props({
      capabilities: { ...capabilities, sessionArchive: true },
      onLoadArchived: jest.fn().mockResolvedValue([]),
    })} />);
    expect(within(view.getByTestId('session-panel-chips')).getByTestId('session-panel-archived')).toBeTruthy();
    expect(view.queryByTestId('session-panel-scope')).toBeNull();
  });
});


it('shows the same working arc on ordinary Codex tiles while retaining unread and accessibility status', () => {
  const direct = rows.find(row => row.kind === 'direct')!;
  const working = { ...direct, hasActiveRun: true, unread: true, attention: null, kind: 'direct' as const };
  const view = render(<SessionPanelView {...props({ rows: [working], currentSessionKey: 'other', platform: 'codex' })} />);
  expect(view.getByTestId(`session-panel-row-${working.id}-running`, { includeHiddenElements: true })).toBeTruthy();
  expect(view.getByTestId(`session-panel-row-${working.id}-unread`)).toBeTruthy();
  expect(view.getByTestId(`session-panel-row-${working.id}`).props.accessibilityLabel).toContain('Working');
  view.rerender(<SessionPanelView {...props({ rows: [working], currentSessionKey: 'other', activityLive: false })} />);
  expect(view.queryByTestId(`session-panel-row-${working.id}-running`, { includeHiddenElements: true })).toBeNull();
});
it('shows approval/input/ambiguous waiting distinctly from running', () => {
  const original = rows.find(row => row.kind === 'direct')!;
  for (const [attention, text] of [['approval', 'Waiting for your approval'], ['input', 'Agent needs your input'], [null, 'Needs attention']] as const) {
    const waiting = { ...original, hasActiveRun: true, activityState: 'waiting' as const, attention };
    const view = render(<SessionPanelView {...props({ rows: [waiting] })} />);
    expect(view.queryByTestId(`session-panel-row-${waiting.id}-running`, { includeHiddenElements: true })).toBeNull();
    expect(view.getByText(text)).toBeTruthy();
    expect(view.getByTestId(`session-panel-row-${waiting.id}`).props.accessibilityLabel).toContain(text);
    view.unmount();
  }
});
