import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type Capabilities } from '@clawket/agent-protocol';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { FontSize, Motion, Radius, Space } from '../../theme/tokens';
import type { ComposerHandle } from '../../components/ui/Composer';
import type { UiMessage } from '../../types/chat';
import { ThreadView, type ThreadCopy, type ThreadViewProps } from './ThreadView';

let mockScheme: 'light' | 'dark' = 'light';
let mockReducedMotion = false;

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
    Linking: {
      openURL: jest.fn(),
    },
    Platform: {
      OS: 'ios',
      select: (values: Record<string, unknown>) => values.ios ?? values.default,
    },
    Image: host('Image'),
    Pressable: host('Pressable'),
    StyleSheet: {
      absoluteFillObject: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('react-native-enriched-markdown', () => {
  const ReactRuntime = require('react');
  const { Text } = require('react-native');
  return {
    EnrichedMarkdownText: ({ markdown, ...props }: { markdown: string }) => ReactRuntime.createElement(
      Text,
      { ...props, markdown },
      markdown,
    ),
  };
});

jest.mock('react-native-keyboard-controller', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    KeyboardAvoidingView: ReactRuntime.forwardRef(
      ({ children, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
        View,
        { ...props, ref },
        children,
      ),
    ),
  };
});

jest.mock('@shopify/flash-list', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    FlashList: ReactRuntime.forwardRef(({
      data = [],
      renderItem,
      ListHeaderComponent,
      ListFooterComponent,
      ...props
    }: {
      data?: unknown[];
      renderItem: (info: { item: unknown; index: number; target: string }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
    }, ref: unknown) => ReactRuntime.createElement(
      View,
      { ...props, ref },
      ...data.map((item, index) => ReactRuntime.createElement(
        ReactRuntime.Fragment,
        { key: (item as { id?: string }).id ?? index },
        renderItem({ item, index, target: 'Cell' }),
      )),
      ListHeaderComponent,
      ListFooterComponent,
    )),
  };
});

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');
  const createLayoutAnimation = (name: string) => {
    const animation = {
      name,
      durationMs: undefined as number | undefined,
      easingValue: undefined as unknown,
      reduceMotionMode: undefined as string | undefined,
      duration(durationMs: number) {
        animation.durationMs = durationMs;
        return animation;
      },
      easing(easingValue: unknown) {
        animation.easingValue = easingValue;
        return animation;
      },
      reduceMotion(reduceMotionMode: string) {
        animation.reduceMotionMode = reduceMotionMode;
        return animation;
      },
    };
    return animation;
  };
  return {
    __esModule: true,
    default: {
      Text,
      View,
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      cubic: 'cubic',
      ease: 'ease',
      linear: 'linear',
      inOut: (value: unknown) => value,
      out: (value: unknown) => ({ kind: 'out', value }),
    },
    FadeIn: createLayoutAnimation('FadeIn'),
    FadeOut: createLayoutAnimation('FadeOut'),
    ReduceMotion: {
      Always: 'always',
      Never: 'never',
      System: 'system',
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: jest.fn((_delay: number, value: unknown) => value),
    withRepeat: jest.fn((value: unknown) => value),
    withSequence: jest.fn((...values: unknown[]) => values.at(-1)),
    withTiming: jest.fn((value: unknown) => value),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return new Proxy({}, {
    get: (_target, property) => icon(String(property)),
  });
});

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: buildTheme(mockScheme, mockScheme, builtInAccents.iceBlue),
  }),
}));

jest.mock('../../components/chat/PendingImageBar', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    PendingImageBar: (props: Record<string, unknown>) => ReactRuntime.createElement(
      View,
      { ...props, testID: 'thread-pending-attachments' },
    ),
  };
});

jest.mock('../../components/chat/SlashSuggestions', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    SlashSuggestions: (props: Record<string, unknown>) => ReactRuntime.createElement(
      View,
      { ...props, testID: 'thread-slash-suggestions' },
    ),
  };
});

jest.mock('../../components/chat/ThinkingLevelMenu', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ThinkingLevelMenu: ({ children, ...props }: Record<string, unknown>) => ReactRuntime.createElement(
      View,
      { ...props, testID: 'thread-thinking-menu' },
      children,
    ),
  };
});

jest.mock('../../components/chat/ToolDetailModal', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ToolDetailModal: (props: Record<string, unknown>) => props.visible
      ? ReactRuntime.createElement(View, { ...props, testID: 'thread-tool-detail' })
      : null,
  };
});

function flattenStyle(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  return Object.assign({}, ...value.map(flattenStyle));
}

const copy: ThreadCopy = {
  back: 'Back',
  settings: 'Agent settings',
  openSessions: 'Open sessions',
  add: 'Add',
  voice: 'Voice input',
  send: 'Send',
  stop: 'Stop',
  reconnect: 'Reconnect',
  offline: 'Offline · reconnecting',
  thinking: 'Thinking…',
  loadingHistory: 'Loading history',
  locked: 'Multiple agents require Pro',
  viewPro: 'View Pro',
  retry: 'Retry',
  file: 'File',
  tool: 'Tool',
  toolRunning: 'Running',
  toolCompleted: 'Completed',
  toolFailed: 'Failed',
  approvalTitle: 'Allow exec?',
  approvalError: 'Could not update this request. Try again.',
  device: 'Device',
  node: 'Node',
  allow: 'Allow',
  reject: 'Reject',
  allowed: 'Allowed',
  denied: 'Denied',
  expired: 'Expired',
  logs: 'Logs',
  formatAsk: (name) => `Ask ${name}`,
  formatEmpty: (name) => `Start a conversation with ${name}`,
  formatAttachments: (count) => `${count} attachments`,
  formatRunDetail: (status, time) => time ? `${status} · ${time}` : status,
  formatModelContext: (model, remaining) => `${model} · ${remaining}% left`,
  formatThinkingLevel: (level) => level,
};

function createProps(overrides: Partial<ThreadViewProps> = {}): ThreadViewProps {
  return {
    agentId: 'atlas',
    agentName: 'Atlas',
    sessionKey: 'agent:atlas:main',
    model: 'Sonnet',
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    state: { kind: 'ready' },
    messages: [{ id: 'message-1', role: 'assistant', text: 'Ready to help.' }],
    input: 'Ship it',
    isRunning: false,
    canSend: true,
    copy,
    onBack: jest.fn(),
    onOpenSessionPanel: jest.fn(),
    onOpenSettings: jest.fn(),
    onChangeInput: jest.fn(),
    onSend: jest.fn(),
    onCancel: jest.fn(),
    onOpenAddMenu: jest.fn(),
    onVoice: jest.fn(),
    onRetry: jest.fn(),
    onOpenPaywall: jest.fn(),
    onErrorAction: jest.fn(),
    onLoadMoreHistory: jest.fn(),
    onOpenAttachments: jest.fn(),
    onResolveApproval: jest.fn(),
    ...overrides,
  };
}

describe('ThreadView', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockScheme = 'light';
    mockReducedMotion = false;
    require('react-native').Linking.openURL.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it.each(['light', 'dark'] as const)('deep-renders canonical thread chrome in %s mode', (scheme) => {
    mockScheme = scheme;
    const props = createProps({
      topInset: Space.xl,
      bottomInset: Space.lg,
      contextUsed: 46,
      contextWindow: 100,
    });
    const view = render(<ThreadView {...props} />);
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);

    expect(flattenStyle(view.getByTestId('thread-screen').props.style)).toMatchObject({
      flex: 1,
      backgroundColor: theme.colors.canvas,
    });
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style)).toMatchObject({
      borderRadius: Radius.full,
      backgroundColor: theme.colors.surfaceFloating,
    });
    expect(view.getByText('Sonnet · 54% left')).toBeTruthy();
    expect(view.getByTestId('thread-markdown-message-1').props.markdownStyle.paragraph.fontSize)
      .toBe(FontSize.body);
    expect(view.getByTestId('thread-screen-timeline').props.inverted).toBe(true);
  });

  it('renders loading, empty, error, offline-cache, and locked permission states', () => {
    const loading = render(<ThreadView {...createProps({ state: { kind: 'loading' } })} />);
    expect(loading.getByTestId('thread-history-loading')).toBeTruthy();
    expect(loading.getAllByTestId(/thread-history-skeleton-/)).toHaveLength(3);
    loading.unmount();

    const empty = render(<ThreadView {...createProps({ state: { kind: 'empty' }, messages: [] })} />);
    expect(empty.getByTestId('thread-screen-empty')).toBeTruthy();
    expect(empty.getByText('Start a conversation with Atlas')).toBeTruthy();
    empty.unmount();

    const onErrorAction = jest.fn();
    const error = render(<ThreadView {...createProps({
      state: {
        kind: 'error',
        code: 'timeout',
        message: 'Connection timed out',
        actionLabel: 'Retry',
      },
      onErrorAction,
    })} />);
    expect(error.getByText('Connection timed out')).toBeTruthy();
    expect(error.getByText('Ready to help.')).toBeTruthy();
    fireEvent.press(error.getByTestId('thread-screen-error-action'));
    expect(onErrorAction).toHaveBeenCalledWith(expect.objectContaining({ code: 'timeout' }));
    error.unmount();

    const onRetry = jest.fn();
    const offline = render(<ThreadView {...createProps({
      state: { kind: 'offline' },
      onRetry,
    })} />);
    expect(offline.getAllByText('Offline · reconnecting')).toHaveLength(2);
    expect(offline.getByText('Ready to help.')).toBeTruthy();
    expect(offline.getByTestId('thread-screen-composer-input').props.editable).toBe(true);
    expect(offline.getByTestId('thread-screen-composer-primary').props.accessibilityState)
      .toEqual({ disabled: true });
    fireEvent.press(offline.getByTestId('thread-screen-offline-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    offline.unmount();

    const onOpenPaywall = jest.fn();
    const locked = render(<ThreadView {...createProps({
      state: { kind: 'locked' },
      onOpenPaywall,
    })} />);
    expect(locked.getByTestId('thread-screen-locked')).toBeTruthy();
    expect(locked.queryByTestId('thread-screen-composer')).toBeNull();
    fireEvent.press(locked.getByText('View Pro'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(1);
  });

  it('routes header, composer, history, run, attachment, and approval interactions', () => {
    const onBack = jest.fn();
    const onOpenSessionPanel = jest.fn();
    const onOpenSettings = jest.fn();
    const onChangeInput = jest.fn();
    const onSend = jest.fn();
    const onOpenAddMenu = jest.fn();
    const onVoice = jest.fn();
    const onPasteFiles = jest.fn();
    const onPasteFailed = jest.fn();
    const onLoadMoreHistory = jest.fn();
    const onOpenAttachments = jest.fn();
    const onResolveApproval = jest.fn();
    const messages: UiMessage[] = [
      {
        id: 'approval-1',
        role: 'tool',
        text: '',
        approval: {
          id: 'request-1',
          command: 'npm test',
          expiresAtMs: Date.now() + 60_000,
          status: 'pending',
        },
      },
      {
        id: 'tool-1',
        role: 'tool',
        text: '',
        toolName: 'exec',
        toolStatus: 'running',
        toolArgs: '{"command":"npm test"}',
        toolDetail: 'Running tests',
        toolStartedAt: 100,
      },
      { id: 'system-1', role: 'system', text: 'Connection restored' },
      { id: 'assistant-1', role: 'assistant', text: 'Working now', streaming: true },
      { id: 'user-1', role: 'user', text: '', imageUris: ['file://one.jpg'] },
    ];
    const view = render(<ThreadView {...createProps({
      messages,
      onBack,
      onOpenSessionPanel,
      onOpenSettings,
      onChangeInput,
      onSend,
      onOpenAddMenu,
      onVoice,
      onPasteFiles,
      onPasteFailed,
      onLoadMoreHistory,
      onOpenAttachments,
      onResolveApproval,
    })} />);

    expect(view.getByTestId('thread-markdown-assistant-1').props.streamingAnimation).toBe(true);
    expect(view.getByTestId(
      'thread-stream-cursor-assistant-1',
      { includeHiddenElements: true },
    )).toBeTruthy();

    fireEvent.press(view.getByTestId('thread-screen-back'));
    fireEvent.press(view.getByTestId('thread-screen-header-pill'));
    fireEvent.press(view.getByTestId('thread-screen-settings'));
    fireEvent.changeText(view.getByTestId('thread-screen-composer-input'), 'New draft');
    const pastedFile = {
      uri: 'file:///tmp/pasted.pdf',
      fileName: 'pasted.pdf',
      fileSize: 512,
      type: 'application/pdf',
    };
    fireEvent(view.getByTestId('thread-screen-composer-input'), 'paste', null, [pastedFile]);
    fireEvent(view.getByTestId('thread-screen-composer-input'), 'paste', 'native error', []);
    fireEvent.press(view.getByTestId('thread-screen-composer-add'));
    fireEvent.press(view.getByTestId('thread-screen-composer-voice'));
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    view.getByTestId('thread-screen-timeline').props.onEndReached();
    fireEvent.press(view.getByTestId('thread-run-tool-1'));
    fireEvent.press(view.getByLabelText('1 attachments'));
    fireEvent.press(view.getByTestId('thread-approval-approval-1-primary'));
    fireEvent(view.getByTestId('thread-approval-approval-1-primary'), 'longPress');
    fireEvent.press(view.getByTestId('thread-approval-approval-1-secondary'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenSessionPanel).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onChangeInput).toHaveBeenCalledWith('New draft');
    expect(onPasteFiles).toHaveBeenCalledWith([pastedFile]);
    expect(onPasteFailed).toHaveBeenCalledTimes(1);
    expect(onOpenAddMenu).toHaveBeenCalledTimes(1);
    expect(onVoice).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('thread-tool-detail').props).toMatchObject({
      name: 'exec',
      status: 'running',
      args: '{"command":"npm test"}',
      detail: 'Running tests',
      startedAtMs: 100,
    });
    expect(onOpenAttachments).toHaveBeenCalledWith(messages[4]);
    expect(onResolveApproval.mock.calls).toEqual([
      ['request-1', 'allow-once'],
      ['request-1', 'allow-always'],
      ['request-1', 'deny'],
    ]);
  });

  it('renders pair requests behind pairRequests without the exec long-press action', () => {
    const onResolveApproval = jest.fn();
    const view = render(<ThreadView {...createProps({
      messages: [
        {
          id: 'pair-device',
          role: 'system',
          text: '',
          approval: {
            kind: 'pair',
            id: 'device-request',
            target: 'device',
            displayName: 'Lucy’s iPhone',
            platform: 'ios',
            receivedAtMs: 100,
            status: 'pending',
          },
        },
        {
          id: 'pair-node',
          role: 'system',
          text: '',
          approval: {
            kind: 'pair',
            id: 'node-request',
            target: 'node',
            displayName: null,
            platform: null,
            receivedAtMs: 101,
            status: 'pending',
          },
        },
      ],
      onResolveApproval,
    })} />);

    expect(view.getByText('Lucy’s iPhone')).toBeTruthy();
    expect(view.getByText('Node')).toBeTruthy();
    const allow = view.getByTestId('thread-approval-pair-device-primary');
    expect(allow.props.onLongPress).toBeUndefined();
    fireEvent.press(allow);
    fireEvent.press(view.getByTestId('thread-approval-pair-node-secondary'));
    expect(onResolveApproval.mock.calls).toEqual([
      ['device-request', 'approve', 'device'],
      ['node-request', 'reject', 'node'],
    ]);

    view.rerender(<ThreadView {...createProps({
      capabilities: { ...CAPABILITY_MATRIX.openclaw, pairRequests: false },
      messages: [{
        id: 'pair-hidden',
        role: 'system',
        text: '',
        approval: {
          kind: 'pair',
          id: 'hidden',
          target: 'device',
          displayName: 'Hidden phone',
          platform: null,
          receivedAtMs: 102,
          status: 'pending',
        },
      }],
    })} />);
    expect(view.queryByTestId('thread-approval-pair-hidden')).toBeNull();
  });

  it('shows a low-sensitivity retry message and keeps failed pair requests actionable', () => {
    const onResolveApproval = jest.fn();
    const view = render(<ThreadView {...createProps({
      messages: [{
        id: 'pair-failed',
        role: 'system',
        text: '',
        approval: {
          kind: 'pair',
          id: 'failed-request',
          target: 'device',
          displayName: 'Lucy’s iPhone',
          platform: 'ios',
          receivedAtMs: 103,
          status: 'pending',
          resolutionError: true,
        },
      }],
      onResolveApproval,
    })} />);

    expect(view.getByText('Could not update this request. Try again.')).toBeTruthy();
    const allow = view.getByTestId('thread-approval-pair-failed-primary');
    expect(allow.props.accessibilityState).toEqual({ disabled: false });
    fireEvent.press(allow);
    expect(onResolveApproval).toHaveBeenCalledWith('failed-request', 'approve', 'device');
  });

  it('renders compaction as a temporary system event row', () => {
    const view = render(<ThreadView {...createProps({
      compactionNotice: 'Compacting context...',
    })} />);
    expect(view.getByTestId('thread-screen-compaction')).toBeTruthy();
    expect(view.getByText('Compacting context...')).toBeTruthy();

    view.rerender(<ThreadView {...createProps({ compactionNotice: null })} />);
    expect(view.queryByTestId('thread-screen-compaction')).toBeNull();
  });

  it('keeps avatar initials scoped to the agent when the header decorates a sub-session name', () => {
    const view = render(<ThreadView {...createProps({
      agentName: 'Atlas Agent',
      sessionTitle: 'Research',
      isMainSession: false,
    })} />);

    expect(view.getByText('Atlas Agent · Research')).toBeTruthy();
    expect(view.getByTestId('thread-screen-header-pill-avatar').props.accessibilityLabel)
      .toBe('Atlas Agent');
  });

  it('cross-fades overlapping session content and bypasses it for reduced motion', () => {
    const view = render(<ThreadView {...createProps({ sessionKey: 'session-a' })} />);
    expect(view.getByTestId('thread-screen-session-content').props.entering).toBeUndefined();

    view.rerender(<ThreadView {...createProps({ sessionKey: 'session-a' })} />);
    expect(view.getByTestId('thread-screen-session-content').props.entering).toBeUndefined();

    view.rerender(<ThreadView {...createProps({ sessionKey: 'session-b' })} />);
    const sessionContent = view.getByTestId('thread-screen-session-content');
    expect(sessionContent.props.entering).toMatchObject({
      name: 'FadeIn',
      durationMs: Motion.duration.normal,
      easingValue: { kind: 'out', value: 'cubic' },
      reduceMotionMode: 'system',
    });
    expect(sessionContent.props.exiting).toMatchObject({
      name: 'FadeOut',
      durationMs: Motion.duration.normal,
      easingValue: { kind: 'out', value: 'cubic' },
      reduceMotionMode: 'system',
    });
    expect(flattenStyle(sessionContent.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    view.unmount();
    mockReducedMotion = true;
    const reducedView = render(<ThreadView {...createProps({ sessionKey: 'session-c' })} />);
    reducedView.rerender(<ThreadView {...createProps({ sessionKey: 'session-d' })} />);
    const reducedContent = reducedView.getByTestId('thread-screen-session-content');
    expect(reducedContent.props.entering).toBeUndefined();
    expect(reducedContent.props.exiting).toBeUndefined();
  });

  it('renders dated subagent and Cron cards without treating tool details as sessions', () => {
    const onOpenRunSession = jest.fn();
    const onOpenRunLogs = jest.fn();
    const newer = new Date(2026, 8, 5, 11).getTime();
    const older = new Date(2026, 8, 4, 23).getTime();
    const view = render(<ThreadView {...createProps({
      locale: 'en-US',
      messages: [{
        id: 'tool-details',
        role: 'tool',
        text: '',
        timestampMs: newer + 1,
        toolName: 'read',
        toolStatus: 'success',
        toolDetail: 'package.json',
      }],
      runCards: [
        {
          id: 'agent:atlas:subagent:worker',
          kind: 'subagent',
          sessionKey: 'agent:atlas:subagent:worker',
          agentId: 'atlas',
          title: 'Release worker',
          status: 'streaming',
          statusLabel: 'Running',
          timeLabel: '11:00 AM',
          updatedAt: newer,
        },
        {
          id: 'nightly-run',
          kind: 'cron',
          sessionKey: 'agent:atlas:cron:nightly',
          jobId: 'nightly',
          agentId: 'atlas',
          title: 'Nightly report',
          status: 'failed',
          statusLabel: 'Failed',
          timeLabel: '11:00 PM',
          updatedAt: older,
          canOpenLogs: true,
        },
        {
          id: 'hermes-digest-run',
          kind: 'cron',
          jobId: 'hermes-digest',
          agentId: 'atlas',
          title: 'Hermes digest',
          status: 'succeeded',
          statusLabel: 'Succeeded',
          timeLabel: '10:55 AM',
          updatedAt: newer - 300_000,
        },
      ],
      onOpenRunSession,
      onOpenRunLogs,
    })} />);

    expect(view.getByTestId(
      'thread-subagent-run-agent:atlas:subagent:worker-detail',
    ).props.children).toEqual(expect.arrayContaining(['11:00 AM']));
    expect(view.getByTestId(
      'thread-cron-run-nightly-run-detail',
    ).props.children).toEqual(expect.arrayContaining(['11:00 PM']));
    expect(view.getByTestId(
      'thread-cron-run-hermes-digest-run-detail',
    ).props.children).toEqual(expect.arrayContaining(['10:55 AM']));
    expect(view.getByTestId('thread-cron-run-hermes-digest-run').props.onPress).toBeUndefined();
    expect(view.getAllByTestId(/^thread-date:/)).toHaveLength(2);
    expect(flattenStyle(
      view.getByTestId('thread-cron-run-nightly-run-status').props.style,
    )).toMatchObject({ backgroundColor: buildTheme('light', 'light', builtInAccents.iceBlue).colors.bad });
    expect(flattenStyle(
      view.getByTestId('thread-cron-run-nightly-run-detail-status').props.style,
    )).toMatchObject({ color: buildTheme('light', 'light', builtInAccents.iceBlue).colors.bad });
    expect(flattenStyle(
      view.getByTestId('thread-cron-run-nightly-run-detail').props.style,
    )).toMatchObject({ color: buildTheme('light', 'light', builtInAccents.iceBlue).colors.inkSecondary });

    fireEvent.press(view.getByTestId('thread-subagent-run-agent:atlas:subagent:worker'));
    expect(onOpenRunSession).toHaveBeenCalledWith(
      'agent:atlas:subagent:worker',
      'atlas',
      'subagent',
    );

    fireEvent.press(view.getByTestId('thread-cron-run-nightly-run'));
    expect(onOpenRunSession).toHaveBeenLastCalledWith(
      'agent:atlas:cron:nightly',
      'atlas',
      'cron',
    );

    fireEvent.press(view.getByTestId('thread-run-tool-details'));
    expect(view.getByTestId('thread-tool-detail').props.detail).toBe('package.json');
    expect(onOpenRunSession).toHaveBeenCalledTimes(2);

    fireEvent.press(view.getByText('Logs'));
    expect(onOpenRunLogs).toHaveBeenCalledWith('nightly', 'atlas');
  });

  it('binds the controller composer handle to the canonical input', () => {
    const composerRef = React.createRef<ComposerHandle>();
    const onChangeInput = jest.fn();
    const view = render(<ThreadView {...createProps({ composerRef, onChangeInput })} />);

    expect(composerRef.current).toEqual(expect.objectContaining({
      focus: expect.any(Function),
      blur: expect.any(Function),
      clear: expect.any(Function),
    }));
    act(() => composerRef.current?.clear());
    expect(onChangeInput).toHaveBeenCalledWith('');
    expect(view.getByTestId('thread-screen-composer-input')).toBeTruthy();
  });

  it('renders assistant Markdown with shared styles and routes links through chat Markdown', () => {
    const { Linking } = require('react-native');
    const view = render(<ThreadView {...createProps({
      messages: [
        {
          id: 'assistant-markdown',
          role: 'assistant',
          text: '**Ready** — [open docs](https://example.com/docs)',
        },
        {
          id: 'user-plain',
          role: 'user',
          text: '**Keep this literal**',
        },
      ],
    })} />);

    const markdown = view.getByTestId('thread-markdown-assistant-markdown');
    expect(markdown.props).toMatchObject({
      flavor: 'github',
      markdown: '**Ready** — [open docs](https://example.com/docs)',
      selectable: true,
      streamingAnimation: false,
    });
    expect(markdown.props.markdownStyle.paragraph.fontSize).toBe(FontSize.body);
    expect(view.queryByTestId('thread-markdown-user-plain')).toBeNull();

    act(() => markdown.props.onLinkPress({ url: 'https://example.com/docs' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('keeps an attachment-only message visible and clickable', () => {
    const onOpenAttachments = jest.fn();
    const message: UiMessage = {
      id: 'attachment-only',
      role: 'assistant',
      text: '',
      imageUris: ['file://one.jpg', 'file://two.jpg'],
    };
    const view = render(<ThreadView {...createProps({
      messages: [message],
      onOpenAttachments,
    })} />);

    expect(view.queryByTestId('thread-bubble-attachment-only')).toBeNull();
    fireEvent.press(view.getByLabelText('2 attachments'));
    expect(onOpenAttachments).toHaveBeenCalledWith(message);
  });

  it('renders files separately from the image gallery for text, file-only, and mixed messages', () => {
    const view = render(<ThreadView {...createProps({
      messages: [
        {
          id: 'custom-file',
          role: 'user',
          text: 'Summarize this spec',
          fileAttachments: [{
            mimeType: 'application/pdf',
            fileName: 'spec.pdf',
            uri: 'file:///spec.pdf',
          }],
        },
        {
          id: 'file-only',
          role: 'assistant',
          text: '',
          fileAttachments: [{ mimeType: 'text/plain' }],
        },
        {
          id: 'mixed',
          role: 'user',
          text: '',
          imageUris: ['file:///photo.png'],
          fileAttachments: [{ mimeType: 'text/plain', fileName: 'notes.txt' }],
        },
      ],
    })} />);

    expect(view.getByText('Summarize this spec')).toBeTruthy();
    expect(view.getByText('spec.pdf')).toBeTruthy();
    expect(view.getByText('File')).toBeTruthy();
    expect(view.getByText('notes.txt')).toBeTruthy();
    expect(view.queryByTestId('thread-attachments-custom-file')).toBeNull();
    expect(view.queryByTestId('thread-attachments-file-only')).toBeNull();
    expect(view.getByTestId('thread-attachments-mixed')).toBeTruthy();
    expect(view.getByTestId('thread-file-custom-file-0').props.onPress).toBeUndefined();
    expect(view.getByTestId('thread-file-file-only-0').props.onPress).toBeUndefined();
  });

  it('wires pending attachments, slash commands, thinking, favorites, and message actions', () => {
    const onOpenPendingAttachment = jest.fn();
    const onRemovePendingAttachment = jest.fn();
    const onPickImage = jest.fn();
    const onTakePhoto = jest.fn();
    const onChooseFile = jest.fn();
    const onSelectSlashCommand = jest.fn();
    const onDismissSlashSuggestions = jest.fn();
    const onSelectThinkingLevel = jest.fn();
    const onMessageLongPress = jest.fn();
    const message: UiMessage = {
      id: 'favorite-1',
      role: 'assistant',
      text: 'Keep this answer',
    };
    const command = {
      key: 'status',
      command: '/status',
      description: 'Show session status',
      action: 'send' as const,
    };
    const view = render(<ThreadView {...createProps({
      messages: [message],
      input: '/st',
      favoriteMessageIds: new Set([message.id]),
      onMessageLongPress,
      pendingAttachments: [{
        uri: 'file://pending.jpg',
        base64: 'preview',
        mimeType: 'image/jpeg',
      }],
      canAddMoreAttachments: true,
      onOpenPendingAttachment,
      onRemovePendingAttachment,
      onPickImage,
      onTakePhoto,
      onChooseFile,
      slashSuggestions: [command],
      showSlashSuggestions: true,
      onSelectSlashCommand,
      onDismissSlashSuggestions,
      thinkingLevel: 'high',
      thinkingLevelOptions: ['off', 'low', 'high'],
      onSelectThinkingLevel,
    })} />);

    const pending = view.getByTestId('thread-pending-attachments');
    expect(pending.props).toMatchObject({ canAddMore: true, attachDisabled: false });
    act(() => pending.props.onOpenPreview(0));
    act(() => pending.props.onRemove(0));
    act(() => pending.props.onPickImage());
    act(() => pending.props.onTakePhoto());
    act(() => pending.props.onChooseFile());
    expect(onOpenPendingAttachment).toHaveBeenCalledWith(0);
    expect(onRemovePendingAttachment).toHaveBeenCalledWith(0);
    expect(onPickImage).toHaveBeenCalledTimes(1);
    expect(onTakePhoto).toHaveBeenCalledTimes(1);
    expect(onChooseFile).toHaveBeenCalledTimes(1);

    const slash = view.getByTestId('thread-slash-suggestions');
    expect(slash.props.suggestions).toEqual([command]);
    act(() => slash.props.onSelect(command));
    expect(onSelectSlashCommand).toHaveBeenCalledWith(command);
    fireEvent.press(view.getByTestId('thread-screen-composer-region').findByProps({ accessible: false }));
    expect(onDismissSlashSuggestions).toHaveBeenCalledTimes(1);

    expect(view.getByTestId('thread-screen-thinking-level')).toBeTruthy();
    act(() => view.getByTestId('thread-thinking-menu').props.onSelect('low'));
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('low');
    expect(view.getByTestId(`thread-favorite-${message.id}`)).toBeTruthy();
    fireEvent(view.getByTestId(`thread-message-${message.id}`), 'longPress');
    expect(onMessageLongPress).toHaveBeenCalledWith(message);
  });

  it('keeps the Hermes pending-image bar usable without a file chooser', () => {
    const onPickImage = jest.fn();
    const onTakePhoto = jest.fn();
    const view = render(<ThreadView {...createProps({
      capabilities: { ...CAPABILITY_MATRIX.hermes },
      pendingAttachments: [{
        uri: 'file://pending.png',
        base64: 'preview',
        mimeType: ' Image/PNG ',
      }],
      canAddMoreAttachments: true,
      onOpenPendingAttachment: jest.fn(),
      onRemovePendingAttachment: jest.fn(),
      onPickImage,
      onTakePhoto,
    })} />);

    const pending = view.getByTestId('thread-pending-attachments');
    expect(pending.props.onPickImage).toBe(onPickImage);
    expect(pending.props.onTakePhoto).toBe(onTakePhoto);
    expect(pending.props.onChooseFile).toBeUndefined();
  });

  it('shows a stop action during a run and suppresses unsupported controls by capability', () => {
    const onCancel = jest.fn();
    const running = render(<ThreadView {...createProps({
      input: '',
      isRunning: true,
      activityLabel: 'Using exec…',
      onCancel,
    })} />);
    expect(running.getByText('Using exec…')).toBeTruthy();
    fireEvent.press(running.getByTestId('thread-screen-composer-primary'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    running.unmount();

    const capabilities: Capabilities = {
      ...CAPABILITY_MATRIX.openclaw,
      abort: false,
      attachments: false,
      execApproval: false,
      models: false,
      sessions: false,
      skills: false,
    };
    const onOpenSessionPanel = jest.fn();
    const unsupported = render(<ThreadView {...createProps({
      capabilities,
      messages: [{
        id: 'approval-hidden',
        role: 'tool',
        text: '',
        approval: {
          id: 'approval-hidden',
          command: 'whoami',
          expiresAtMs: Date.now() + 60_000,
          status: 'pending',
        },
      }],
      onOpenSessionPanel,
      isRunning: true,
      input: '',
    })} />);
    expect(unsupported.queryByTestId('thread-screen-composer-add')).toBeNull();
    expect(unsupported.getByTestId('thread-screen-composer-input').type).toBe('TextInput');
    expect(unsupported.queryByTestId('thread-approval-approval-hidden')).toBeNull();
    expect(unsupported.queryByText('Sonnet')).toBeNull();
    expect(unsupported.getByTestId('thread-screen-header-pill').props.onPress).toBeUndefined();
    expect(unsupported.getByTestId('thread-screen-composer-primary').props.accessibilityState)
      .toEqual({ disabled: true });
  });

  it('renders earlier-history loading through the canonical skeleton', () => {
    const view = render(<ThreadView {...createProps({ loadingMoreHistory: true })} />);
    expect(view.getByTestId('thread-screen-history-more')).toBeTruthy();
  });

  it('expires a pending approval at its deadline without a controller refresh', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
    const view = render(<ThreadView {...createProps({
      messages: [{
        id: 'approval-deadline',
        role: 'tool',
        text: '',
        approval: {
          id: 'approval-deadline',
          command: 'npm test',
          expiresAtMs: Date.now() + 1_000,
          status: 'pending',
        },
      }],
    })} />);

    expect(view.getByTestId('thread-approval-approval-deadline').props.accessibilityState)
      .toEqual({ disabled: false });
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(view.getByTestId('thread-approval-approval-deadline').props.accessibilityState)
      .toEqual({ disabled: true });
    expect(view.getByText('Expired')).toBeTruthy();
  });
});
