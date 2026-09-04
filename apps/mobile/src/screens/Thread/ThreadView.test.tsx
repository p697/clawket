import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type Capabilities } from '@clawket/agent-protocol';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { FontSize, Radius, Space } from '../../theme/tokens';
import type { UiMessage } from '../../types/chat';
import { ThreadView, type ThreadCopy, type ThreadViewProps } from './ThreadView';

let mockScheme: 'light' | 'dark' = 'light';

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
    Pressable: host('Pressable'),
    StyleSheet: {
      absoluteFillObject: {},
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
      ListFooterComponent,
      ...props
    }: {
      data?: unknown[];
      renderItem: (info: { item: unknown; index: number; target: string }) => React.ReactNode;
      ListFooterComponent?: React.ReactNode;
    }, ref: unknown) => ReactRuntime.createElement(
      View,
      { ...props, ref },
      ...data.map((item, index) => ReactRuntime.createElement(
        ReactRuntime.Fragment,
        { key: (item as { id?: string }).id ?? index },
        renderItem({ item, index, target: 'Cell' }),
      )),
      ListFooterComponent,
    )),
  };
});

jest.mock('react-native-reanimated', () => {
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: {
      Text,
      View,
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      ease: 'ease',
      linear: 'linear',
      inOut: (value: unknown) => value,
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
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
  tool: 'Tool',
  toolRunning: 'Running',
  toolCompleted: 'Completed',
  toolFailed: 'Failed',
  approvalTitle: 'Allow exec?',
  allow: 'Allow',
  reject: 'Reject',
  allowed: 'Allowed',
  denied: 'Denied',
  expired: 'Expired',
  formatAsk: (name) => `Ask ${name}`,
  formatEmpty: (name) => `Start a conversation with ${name}`,
  formatAttachments: (count) => `${count} attachments`,
  formatModelContext: (model, remaining) => `${model} · ${remaining}% left`,
};

function createProps(overrides: Partial<ThreadViewProps> = {}): ThreadViewProps {
  return {
    agentId: 'atlas',
    agentName: 'Atlas',
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
    onOpenRun: jest.fn(),
    onOpenAttachments: jest.fn(),
    onResolveApproval: jest.fn(),
    ...overrides,
  };
}

describe('ThreadView', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockScheme = 'light';
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
    const onLoadMoreHistory = jest.fn();
    const onOpenRun = jest.fn();
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
      { id: 'tool-1', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' },
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
      onLoadMoreHistory,
      onOpenRun,
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
    fireEvent.press(view.getByTestId('thread-screen-composer-add'));
    fireEvent.press(view.getByTestId('thread-screen-composer-voice'));
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    view.getByTestId('thread-screen-timeline').props.onEndReached();
    fireEvent.press(view.getByTestId('thread-run-tool-1'));
    fireEvent.press(view.getByText('1 attachments'));
    fireEvent.press(view.getByTestId('thread-approval-approval-1-primary'));
    fireEvent(view.getByTestId('thread-approval-approval-1-primary'), 'longPress');
    fireEvent.press(view.getByTestId('thread-approval-approval-1-secondary'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenSessionPanel).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onChangeInput).toHaveBeenCalledWith('New draft');
    expect(onOpenAddMenu).toHaveBeenCalledTimes(1);
    expect(onVoice).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);
    expect(onOpenRun).toHaveBeenCalledWith(messages[1]);
    expect(onOpenAttachments).toHaveBeenCalledWith(messages[4]);
    expect(onResolveApproval.mock.calls).toEqual([
      ['request-1', 'allow-once'],
      ['request-1', 'allow-always'],
      ['request-1', 'deny'],
    ]);
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
    fireEvent.press(view.getByText('2 attachments'));
    expect(onOpenAttachments).toHaveBeenCalledWith(message);
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
