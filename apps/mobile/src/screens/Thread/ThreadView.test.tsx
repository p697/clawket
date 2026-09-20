jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, ...props }: any) => visible ? React.createElement(require('react-native').View, props, children) : null }));
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type Capabilities } from '@clawket/agent-protocol';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { ControlSize, FontSize, Motion, Radius, Space } from '../../theme/tokens';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import { resolveChatChromeAppearance } from '../../features/chat-appearance/resolver';
import type { SharedValue } from 'react-native-reanimated';
import type { ComposerHandle } from '../../components/ui/Composer';
import type { UiMessage } from '../../types/chat';
import { preserveHydratedMessageKeys } from '../../chat/historyMergePolicy';
import { ThreadView, resolveThreadHeaderHeight, type ThreadCopy, type ThreadViewProps } from './ThreadView';
import type { ThreadRunCard } from './model';

let mockScheme: 'light' | 'dark' = 'light';
let mockReducedMotion = false;
let mockPacedText: string | undefined;
const mockScrollToEnd = jest.fn();
const originalRaf = global.requestAnimationFrame;
const originalCancelRaf = global.cancelAnimationFrame;
beforeAll(() => {
  global.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 16) as unknown as number;
  global.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterAll(() => {
  global.requestAnimationFrame = originalRaf;
  global.cancelAnimationFrame = originalCancelRaf;
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
    DynamicColorIOS: (variants: unknown) => ({ dynamic: variants }),
    Keyboard: { dismiss: jest.fn() },
    PanResponder: { create: (config: Record<string, unknown>) => ({ panHandlers: { __config: config } }) },
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
    Linking: {
      openURL: jest.fn(),
    },
    Platform: {
      OS: 'ios',
      select: (values: Record<string, unknown>) => values.ios ?? values.default,
    },
    Image: host('Image'),
    ActivityIndicator: host('ActivityIndicator'),
    Pressable: host('Pressable'),
    StyleSheet: {
      absoluteFill: {
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
    ScrollView: host('ScrollView'),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => key === 'Yesterday' ? require(`../../i18n/locales/${options?.lng === 'zh-Hans' ? 'zh-Hans' : String(options?.lng || 'en').split('-')[0]}/common.json`).Yesterday : key.replace('{{count}}', String(options?.count ?? '')).replace('{{percent}}', String(options?.percent ?? '')) }),
}));

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

// The word pacer is unit-tested in src/chat; here the stream renders as it arrives.
jest.mock('../../chat/useSmoothedStreamText', () => ({
  useSmoothedStreamText: (text: string) => mockPacedText ?? text,
}));

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
    }, ref: unknown) => {
      ReactRuntime.useImperativeHandle(ref, () => ({ scrollToEnd: mockScrollToEnd }));
      return ReactRuntime.createElement(
      View,
      { ...props, data },
      ...data.map((item, index) => ReactRuntime.createElement(
        ReactRuntime.Fragment,
        { key: (item as { key?: string }).key ?? index },
        renderItem({ item, index, target: 'Cell' }),
      )),
      ListHeaderComponent,
      ListFooterComponent,
    ); }),
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
    LinearTransition: createLayoutAnimation('LinearTransition'),
    ReduceMotion: {
      Always: 'always',
      Never: 'never',
      System: 'system',
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useAnimatedProps: (factory: () => unknown) => factory(),
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: jest.fn((_delay: number, value: unknown) => value),
    withRepeat: jest.fn((value: unknown) => value),
    withSequence: jest.fn((...values: unknown[]) => values.at(-1)),
    withSpring: jest.fn((value: unknown) => value),
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

jest.mock('./components/ThreadMessageActionsOverlay', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ThreadMessageActionsOverlay: (props: Record<string, unknown>) => props.selection
      ? ReactRuntime.createElement(View, { ...props, testID: 'thread-message-actions' })
      : null,
  };
});

jest.mock('../../services/haptics', () => ({
  triggerLightImpact: jest.fn(),
  triggerSelectionHaptic: jest.fn(),
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
  stopVoice: 'Stop voice input',
  listening: 'Listening…',
  preparingVoice: 'Preparing voice input…',
  send: 'Send',
  stop: 'Stop',
  queueSend: 'Send after this reply',
  queued: 'Queued',
  sending: 'Sending…',
  paused: 'Paused',
  sent: 'Sent',
  delivered: 'Delivered',
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
  pairApprovalDetail: 'Allow this device to connect to OpenClaw?',
  device: 'Device',
  node: 'Node',
  allow: 'Allow',
  reject: 'Reject',
  allowed: 'Allowed',
  denied: 'Denied',
  expired: 'Expired',
  logs: 'Logs',
  placeholder: 'Message',
  formatEmpty: (name) => `Start a conversation with ${name}`,
  formatAttachments: (count) => `${count} attachments`,
  formatPhotoPosition: (index, count) => `Photo ${index} of ${count}`,
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
    mockPacedText = undefined;
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

  it('shows the companion loader and honest footer copy while a preview is pending', () => {
    const props = createProps({
      state: { kind: 'loading' }, messages: [],
      sessionPreview: { loading: true, hasHiddenHistory: false, onUpgrade: jest.fn(), onMain: jest.fn() },
    });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-history-loading')).toBeTruthy();
    expect(view.queryByText('Latest messages · read-only preview')).toBeNull();
    expect(view.queryByTestId('session-preview-history')).toBeNull();
    expect(view.queryByTestId('thread-screen-timeline')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('shows a read-only preview and explicit upgrade in %s mode', (scheme) => {
    mockScheme = scheme;
    const onUpgrade = jest.fn();
    const onMain = jest.fn();
    const props = createProps({
      sessionPreview: { hasHiddenHistory: true, onUpgrade, onMain },
      messages: [{ id: 'visible', role: 'assistant', text: 'Visible preview' }],
    });
    const view = render(<ThreadView {...props} />);
    expect(view.getByText('Visible preview')).toBeTruthy();
    expect(view.queryByTestId('thread-composer')).toBeNull();
    expect(view.getByTestId('session-preview-history')).toBeTruthy();
    fireEvent.press(view.getByTestId('session-preview-upgrade'));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByLabelText('Back to main chat'));
    expect(onMain).toHaveBeenCalledTimes(1);
    view.rerender(<ThreadView {...props} sessionPreview={{ hasHiddenHistory: false, onUpgrade, onMain }} />);
    expect(view.queryByTestId('session-preview-history')).toBeNull();
    expect(view.getByTestId('session-preview-footer')).toBeTruthy();
    expect(view.getByText('Upgrade to Pro')).toBeTruthy();
    expect(view.queryByText('View Pro')).toBeNull();
    fireEvent.press(view.getByLabelText('Unlock conversation'));
    expect(onUpgrade).toHaveBeenCalledTimes(2);
  });

  it('opens actionable reply diagnostics without polluting the transcript', () => {
    const dismiss = jest.fn();
    const view = render(<ThreadView {...createProps({
      sendFailure: 'Model authentication failed. Sign in again on your computer.',
      sendFailureDetails: 'OAuth session expired. Run claude auth login.',
      onDismissSendFailure: dismiss,
    })} />);
    expect(view.queryByTestId('reply-failure-diagnostic')).toBeNull();
    fireEvent.press(view.getByTestId('thread-screen-send-error-action'));
    expect(view.getByTestId('reply-failure-diagnostic').props.children).toContain('claude auth login');
    expect(view.getByText('Ready to help.')).toBeTruthy();
    view.unmount();
  });

  it.each(['light', 'dark'] as const)('keeps the %s timeline and editable draft mounted through reconnect', (scheme) => {
    mockScheme = scheme;
    const props = createProps();
    const view = render(<ThreadView {...props} />);
    const input = view.getByTestId('thread-screen-composer-input');
    mockScrollToEnd.mockClear();
    view.rerender(<ThreadView {...props} state={{ kind: 'reconnecting' }} />);
    expect(view.getByText('Reconnecting…')).toBeTruthy();
    expect(view.getByText('Ready to help.')).toBeTruthy();
    expect(view.queryByTestId('thread-screen-error')).toBeNull();
    expect(view.queryByTestId('thread-screen-offline')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-input')).toBe(input);
    expect(input.props.editable).toBe(true);
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityState.disabled).toBe(true);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    view.rerender(<ThreadView {...props} />);
    expect(view.queryByText('Reconnecting…')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityState.disabled).toBe(false);
    view.unmount();
  });

  it.each(['light', 'dark'] as const)('renders readable time groups and refreshes midnight labels in %s', (scheme) => {
    mockScheme = scheme;
    jest.useFakeTimers();
    const timestampMs = new Date(2026, 8, 7, 23, 59).getTime();
    jest.setSystemTime(timestampMs);
    const props = createProps({ locale: 'zh-Hans', messages: [
      { id: 'timed', role: 'user', text: 'Hello', timestampMs },
    ] });
    const view = render(<ThreadView {...props} />);
    const label = () => view.getByTestId('thread-date:message:timed');
    expect(label().props.children).toBe('23:59');
    expect(flattenStyle(label().props.style)).toMatchObject({
      color: buildTheme(scheme, scheme, builtInAccents.iceBlue).colors.inkSecondary,
      backgroundColor: buildTheme(scheme, scheme, builtInAccents.iceBlue).colors.canvas,
      textAlign: 'center',
    });
    act(() => jest.advanceTimersByTime(60_000));
    expect(label().props.children).toBe('昨天 23:59');
    view.rerender(<ThreadView {...props} locale="de" />);
    expect(label().props.children).toBe('Gestern 23:59');
    view.unmount();
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
      backgroundColor: theme.colors.surface,
    });
    expect(view.getByText('Context remaining: 54%')).toBeTruthy();
    expect(view.getByTestId('thread-markdown-message-1').props.markdownStyle.paragraph.fontSize)
      .toBe(FontSize.body);
    expect(view.getByTestId('thread-screen-timeline').props.inverted).toBeUndefined();
    expect(view.getByTestId('thread-screen-timeline').props.maintainVisibleContentPosition.startRenderingFromBottom).toBe(true);
  });

  it.each(['light', 'dark'] as const)('updates manufacturer artwork and preserves model capability in %s mode', (scheme) => {
    mockScheme = scheme;
    const props = createProps({ model: 'openrouter/anthropic/claude-sonnet-4-6', onOpenModelPicker: jest.fn() });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-model-icon').props.source).toBe(402);
    expect(view.getByTestId('thread-model-icon').props.accessible).toBe(false);
    fireEvent.press(view.getByTestId('thread-model-picker'));
    expect(props.onOpenModelPicker).toHaveBeenCalledTimes(1);
    view.rerender(<ThreadView {...props} model="openai/gpt-5.4" />);
    expect(view.getByTestId('thread-model-icon').props.source).toBe(401);
    view.rerender(<ThreadView {...props} model="custom/private-model" />);
    expect(view.getByTestId('thread-model-icon').props.color).toBe(buildTheme(scheme, scheme, builtInAccents.iceBlue).colors.inkSecondary);
    view.rerender(<ThreadView {...props} capabilities={{ ...props.capabilities, models: false }} />);
    expect(view.queryByTestId('thread-model-picker')).toBeNull();
  });

  it('uses the saved text size and stamps replies with their time instead of a model label', () => {
    const view = render(<ThreadView {...createProps({
      chatFontSize: 20,
      showAgentAvatar: false,
      model: 'Current model',
      messages: [{ id: 'recorded', role: 'assistant', text: 'Earlier reply', modelLabel: 'Original model', timestampMs: Date.now() }],
    })} />);
    expect(view.queryByText('Original model')).toBeNull();
    expect(view.queryByText('Current model')).toBeNull();
    expect(view.getByTestId('thread-markdown-recorded').props.markdownStyle.paragraph.fontSize).toBe(20);
    expect(view.getByTestId('thread-message-recorded').props.accessibilityLabel).toBe('Earlier reply');
    expect(view.getByTestId('thread-meta-recorded')).toBeTruthy();
    expect(view.queryByTestId('thread-meta-recorded-status')).toBeNull();
    expect(view.queryByText('Atlas', { includeHiddenElements: true })).toBeTruthy();
  });

  it('keeps the reply bubble present from send until the first token', () => {
    const sent: UiMessage = { id: 'usr_1', role: 'user', text: 'Hello', timestampMs: Date.now() };
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const view = render(<ThreadView {...createProps({ messages: [sent], isRunning: true, activityLabel: null, input: '', messageActions })} />);
    // Thinking placeholder shares the live stream id so the row never remounts.
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Thinking…');
    // Nothing to copy or share yet, so the placeholder has no long-press menu while the sent turn keeps its own.
    expect(view.getByTestId('thread-message-streaming').props.onLongPress).toBeUndefined();
    expect(view.getByTestId('thread-message-usr_1').props.onLongPress).toBeDefined();
    // The header says it with lifting dots, not a second "Thinking…" and not an avatar badge.
    expect(view.getByTestId('thread-screen-header-pill-working')).toBeTruthy();
    expect(view.getAllByText('Thinking…')).toHaveLength(1);
    expect(view.queryByTestId('thread-screen-header-pill-avatar-working')).toBeNull();
    expect(flattenStyle(view.getByTestId('thread-bubble-streaming').props.style)).toMatchObject({
      minHeight: ControlSize.floatingButton, borderRadius: Radius.card, paddingVertical: Space.sm,
    });
    expect(flattenStyle(view.getByTestId('thread-bubble-streaming').props.style).minWidth).toBeGreaterThan(0);

    view.rerender(<ThreadView {...createProps({ messages: [sent], isRunning: true, activityLabel: 'Using exec…', input: '' })} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Using exec…');

    const streaming: UiMessage = { id: 'streaming', role: 'assistant', text: 'Partial **bo', streaming: true };
    view.rerender(<ThreadView {...createProps({ messages: [streaming, sent], isRunning: true, input: '' })} />);
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
    expect(view.getAllByTestId('thread-bubble-streaming')).toHaveLength(1);
    expect(flattenStyle(view.getByTestId('thread-bubble-streaming').props.style).borderRadius).toBe(Radius.bubble);
    expect(view.getByTestId('thread-markdown-streaming').props.streamingAnimation).toBe(true);
    // Open syntax is terminated while streaming so styling never flickers, and
    // no cursor glyph is appended to absorb the native tail fade.
    expect(view.getByTestId('thread-markdown-streaming').props.markdown).toBe('Partial **bo**');
    expect(view.queryByTestId('thread-stream-cursor-streaming', { includeHiddenElements: true })).toBeNull();

    const settled: UiMessage = { id: 'assistant-9', role: 'assistant', text: 'Partial **bold**', timestampMs: Date.now() };
    view.rerender(<ThreadView {...createProps({ messages: [settled, sent], isRunning: false })} />);
    expect(view.getByTestId('thread-markdown-assistant-9').props.streamingAnimation).toBe(false);
    expect(view.getByTestId('thread-markdown-assistant-9').props.markdown).toBe('Partial **bold**');

    view.rerender(<ThreadView {...createProps({ messages: [sent], isRunning: false })} />);
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
    // Locked and preview threads never show a placeholder.
    view.rerender(<ThreadView {...createProps({ messages: [sent], isRunning: true, state: { kind: 'locked' }, input: '' })} />);
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
  });

  it('marks the user’s own messages with Telegram-style delivery glyphs', () => {
    const now = Date.now();
    const turn: UiMessage = { id: 'usr_9', role: 'user', text: 'Ping', timestampMs: now };
    const view = render(<ThreadView {...createProps({
      messages: [turn],
      isRunning: true,
      input: '',
      unconfirmedMessageIds: new Set(['usr_9']),
    })} />);
    expect(view.getByTestId('thread-meta-usr_9-status').props.accessibilityLabel).toBe('Sending…');
    expect(view.getByTestId('thread-message-usr_9').props.accessibilityLabel).toBe('Ping · Sending…');

    view.rerender(<ThreadView {...createProps({ messages: [turn], isRunning: true, input: '', unconfirmedMessageIds: new Set() })} />);
    expect(view.getByTestId('thread-meta-usr_9-status').props.accessibilityLabel).toBe('Sent');

    view.rerender(<ThreadView {...createProps({ messages: [turn], isRunning: true, input: '', runAcknowledged: true })} />);
    expect(view.getByTestId('thread-meta-usr_9-status').props.accessibilityLabel).toBe('Delivered');
    expect(view.getByTestId('thread-message-usr_9').props.accessibilityLabel).toBe('Ping · Delivered');

    const reply: UiMessage = { id: 'a1', role: 'assistant', text: 'Pong', timestampMs: now };
    view.rerender(<ThreadView {...createProps({ messages: [reply, turn] })} />);
    expect(view.getByTestId('thread-meta-usr_9-status').props.accessibilityLabel).toBe('Delivered');
    expect(view.queryByTestId('thread-meta-a1-status')).toBeNull();

    // Attachment-only sends carry the meta as a row below the gallery.
    const photo: UiMessage = { id: 'usr_10', role: 'user', text: '', imageUris: ['file:///a.jpg'], timestampMs: now };
    view.rerender(<ThreadView {...createProps({ messages: [photo, reply, turn], runAcknowledged: true })} />);
    expect(view.queryByTestId('thread-bubble-usr_10')).toBeNull();
    expect(view.getByTestId('thread-meta-usr_10-status').props.accessibilityLabel).toBe('Delivered');
  });

  it('keeps hydrated scheduled cards still and slides in only a card that arrives while reading', () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    withTiming.mockClear();
    // The entrance is the only timing that drives a shared value to 1 over the normal duration
    // with the ease-out curve; the scroll button animates to 0 here and the header fade is shorter.
    const entranceCalls = () => withTiming.mock.calls.filter(([target, options]) => (
      target === 1 && (options as { duration?: number })?.duration === Motion.duration.normal
    ));
    const now = Date.now();
    const card = (id: string, updatedAt: number): ThreadRunCard => ({
      id, kind: 'cron', jobId: id, agentId: 'atlas', title: `Job ${id}`, status: 'succeeded',
      statusLabel: 'Succeeded', timeLabel: '11:00 AM', updatedAt,
    });
    const reply: UiMessage = { id: 'a0', role: 'assistant', text: 'Earlier', timestampMs: now - 3_600_000 };
    const view = render(<ThreadView {...createProps({ messages: [reply], runCards: [card('one', now - 1_800_000)] })} />);
    // Cache hydration lands with the first frame: full size, no offset, no timing.
    const hydrated = flattenStyle(view.getByTestId('thread-entrance-cron-run-one').props.style);
    expect(hydrated).toMatchObject({ opacity: 1, transform: [{ translateY: 0 }] });
    expect(entranceCalls()).toHaveLength(0);
    withTiming.mockClear();

    view.rerender(<ThreadView {...createProps({ messages: [reply], runCards: [card('two', now - 60_000), card('one', now - 1_800_000)] })} />);
    expect(flattenStyle(view.getByTestId('thread-entrance-cron-run-two').props.style)).toMatchObject({ opacity: 1 });
    expect(entranceCalls()).toHaveLength(1);

    // A burst is a reconciliation and lands still.
    withTiming.mockClear();
    view.rerender(<ThreadView {...createProps({ messages: [reply], runCards: [
      card('six', now - 1), card('five', now - 2), card('four', now - 3), card('three', now - 4),
      card('two', now - 60_000), card('one', now - 1_800_000),
    ] })} />);
    expect(entranceCalls()).toHaveLength(0);
  });

  it('arms an entrance only for rows that arrive at the tail after mount', () => {
    const older: UiMessage = { id: 'a0', role: 'assistant', text: 'Earlier' };
    const view = render(<ThreadView {...createProps({ messages: [older] })} />);
    expect(flattenStyle(view.getByTestId('thread-entrance-a0').props.style).opacity).toBe(1);

    const sent: UiMessage = { id: 'usr_2', role: 'user', text: 'New' };
    view.rerender(<ThreadView {...createProps({ messages: [sent, older], isRunning: true, input: '' })} />);
    expect(flattenStyle(view.getByTestId('thread-entrance-usr_2').props.style).opacity).toBe(1);
    expect(flattenStyle(view.getByTestId('thread-entrance-streaming').props.style).opacity).toBe(1);
    expect(flattenStyle(view.getByTestId('thread-entrance-a0').props.style).opacity).toBe(1);

    // History paged in above the reader never animates.
    const paged: UiMessage = { id: 'h0', role: 'user', text: 'Long ago' };
    view.rerender(<ThreadView {...createProps({ messages: [sent, older, paged], isRunning: true, input: '' })} />);
    expect(flattenStyle(view.getByTestId('thread-entrance-h0').props.style).opacity).toBe(1);
  });

  it.each([['openclaw', 'light'], ['openclaw', 'dark'], ['hermes', 'light'], ['hermes', 'dark']] as const)('explains a sustained %s outage in %s, preserves the draft and recovers automatically', (backend, scheme) => {
    mockScheme = scheme;
    const onRetry = jest.fn();
    const onManage = jest.fn();
    const failureProps = createProps({
      capabilities: { ...CAPABILITY_MATRIX[backend] },
      state: { kind: 'offline' },
      connectionFailure: { scope: backend, name: 'My computer', onManage },
      onRetry,
    });
    const view = render(<ThreadView {...failureProps} />);
    expect(view.getByText('My computer')).toBeTruthy();
    expect(view.getByText('Check your network and make sure the remote service is running.')).toBeTruthy();
    expect(view.queryByText('Ready to help.')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-input').props.defaultValue).toBe('Ship it');
    fireEvent.press(view.getByTestId('thread-connection-unavailable-retry'));
    fireEvent.press(view.getByTestId('thread-connection-unavailable-manage'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onManage).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('thread-connection-unavailable-saved'));
    expect(view.getByText('Ready to help.')).toBeTruthy();
    expect(view.queryByTestId('thread-connection-unavailable')).toBeNull();
    view.rerender(<ThreadView {...failureProps} state={{ kind: 'ready' }} />);
    expect(view.getByText('Ready to help.')).toBeTruthy();
    view.rerender(<ThreadView {...failureProps} />);
    expect(view.getByTestId('thread-connection-unavailable')).toBeTruthy();
  });

  it('shows only a known connection timestamp and keeps timeout guidance neutral', () => {
    const props = createProps({
      state: { kind: 'error', code: 'timeout', message: 'Connection timed out' },
      connectionFailure: { scope: 'first', name: 'Computer', lastReadyAt: 1_700_000_000_000 },
      onRetry: jest.fn(),
    });
    const view = render(<ThreadView {...props} />);
    expect(view.getByText('Last connected: {{time}}')).toBeTruthy();
    expect(view.getByText('Connection unavailable')).toBeTruthy();
    expect(view.queryByText('Connection timed out')).toBeNull();
    fireEvent.press(view.getByTestId('thread-connection-unavailable-retry'));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<ThreadView {...props} connectionFailure={{ scope: 'first', name: 'Computer', lastReadyAt: null }} />);
    expect(view.queryByText('Last connected: {{time}}')).toBeNull();
  });

  it('keeps the recovery grace quiet and scopes saved-message dismissal to the connection', () => {
    const props = createProps({ connectionFailure: { name: 'Computer', scope: 'first' }, onRetry: jest.fn() });
    const view = render(<ThreadView {...props} state={{ kind: 'reconnecting' }} />);
    expect(view.queryByTestId('thread-connection-unavailable')).toBeNull();
    expect(view.getByText('Ready to help.')).toBeTruthy();
    view.rerender(<ThreadView {...props} state={{ kind: 'offline' }} />);
    fireEvent.press(view.getByTestId('thread-connection-unavailable-saved'));
    view.rerender(<ThreadView {...props} state={{ kind: 'offline' }} connectionFailure={{ name: 'Other computer', scope: 'second' }} messages={[]} />);
    expect(view.getByTestId('thread-connection-unavailable')).toBeTruthy();
    expect(view.queryByTestId('thread-connection-unavailable-saved')).toBeNull();
  });

  it('preserves actionable pairing errors and a paused connection in the full failure page', () => {
    const onErrorAction = jest.fn();
    const props = createProps({
      connectionFailure: { name: 'Computer', scope: 'first' },
      state: { kind: 'error', code: 'pairing_expired', message: 'Pairing expired, pair again', actionLabel: 'Pair again' },
      onErrorAction,
    });
    const view = render(<ThreadView {...props} />);
    fireEvent.press(view.getByTestId('thread-connection-unavailable-retry'));
    expect(onErrorAction).toHaveBeenCalledWith(props.state);
    expect(view.queryByTestId('thread-screen-error')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityState).toEqual({ disabled: true });
    view.rerender(<ThreadView {...props} state={{ kind: 'offline' }} connectionFailure={{ name: 'Computer', scope: 'first', message: 'Connection paused' }} />);
    expect(view.getByText('Connection paused')).toBeTruthy();
    expect(view.queryByText('Check your network and make sure the remote service is running.')).toBeNull();
  });

  it('renders loading, empty, error, offline-cache, and locked permission states', () => {
    const loading = render(<ThreadView {...createProps({ state: { kind: 'loading' } })} />);
    expect(loading.getByTestId('thread-history-loading')).toBeTruthy();
    expect(loading.getByTestId('thread-history-loading').props.accessibilityRole).toBe('progressbar');
    expect(loading.queryAllByTestId(/thread-history-skeleton-/)).toHaveLength(0);
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
    // The header pill states offline once; the floating capsule only carries the action.
    expect(offline.getAllByText('Offline · reconnecting')).toHaveLength(1);
    expect(offline.getByTestId('thread-screen-offline-action').props.accessibilityLabel)
      .toBe('Offline · reconnecting, Reconnect');
    expect(offline.getByText('Reconnect')).toBeTruthy();
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
    // No synthetic cursor: the native tail fade is the only streaming signal.
    expect(view.queryByTestId(
      'thread-stream-cursor-assistant-1',
      { includeHiddenElements: true },
    )).toBeNull();

    fireEvent.press(view.getByTestId('thread-screen-back'));
    fireEvent.press(view.getByTestId('thread-screen-header-pill'));
    fireEvent.press(view.getByTestId('thread-screen-sessions'));
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
    expect(view.queryByTestId('thread-screen-composer-voice')).toBeNull();
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    view.getByTestId('thread-screen-timeline').props.onStartReached();
    fireEvent.press(view.getByTestId('thread-run-tool-1'));
    fireEvent.press(view.getByLabelText('Photo 1 of 1'));
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
    const emptyComposer = render(<ThreadView {...createProps({ input: '', onVoice })} />);
    fireEvent.press(emptyComposer.getByTestId('thread-screen-composer-voice'));
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
    expect(onOpenAttachments).toHaveBeenCalledWith(messages[4], 0);
    expect(onResolveApproval.mock.calls).toEqual([
      ['request-1', 'allow-once'],
      ['request-1', 'allow-always'],
      ['request-1', 'deny'],
    ]);
  });

  it('shows dictation progress in the composer and keeps a stop control while listening', () => {
    const onVoice = jest.fn();
    const level = { value: 0.5 } as SharedValue<number>;
    const view = render(<ThreadView {...createProps({ input: '', onVoice, voiceState: 'authorizing', voiceLevel: level })} />);
    expect(view.getByText('Preparing voice input…')).toBeTruthy();
    expect(view.getByTestId('thread-screen-composer-voice').props.accessibilityState.busy).toBe(true);
    expect(view.queryByTestId('thread-screen-composer-voice-stop')).toBeNull();

    view.rerender(<ThreadView {...createProps({ input: 'Dictated draft', onVoice, voiceState: 'listening', voiceLevel: level })} />);
    const input = view.getByTestId('thread-screen-composer-input', { includeHiddenElements: true });
    expect(view.getByText('Listening…')).toBeTruthy();
    expect(input.props.editable).toBe(false);
    expect(view.queryByTestId('thread-screen-composer-primary')).toBeNull();
    fireEvent.press(view.getByTestId('thread-screen-composer-voice-stop'));
    expect(onVoice).toHaveBeenCalledTimes(1);

    view.rerender(<ThreadView {...createProps({ input: 'Dictated draft', onVoice, voiceState: 'idle', voiceLevel: level })} />);
    expect(view.getByTestId('thread-screen-composer-input').props.placeholder).toBe('Message');
    expect(view.getByTestId('thread-screen-composer-input').props.editable).toBe(true);
    expect(view.queryByTestId('thread-screen-composer-voice-stop')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-primary')).toBeTruthy();

    // Without a voice handler the state is ignored and the ordinary placeholder stays.
    view.rerender(<ThreadView {...createProps({ input: '', onVoice: undefined, voiceState: 'listening' })} />);
    expect(view.getByTestId('thread-screen-composer-input').props.placeholder).toBe('Message');
    expect(view.queryByTestId('thread-screen-composer-voice-stop')).toBeNull();
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
    expect(view.getAllByText(copy.pairApprovalDetail)).toHaveLength(2);
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

  it('replaces session content without overlapping fade layers', () => {
    const view = render(<ThreadView {...createProps({ sessionKey: 'session-a' })} />);
    for (const sessionKey of ['session-b', 'session-a', 'session-b']) {
      view.rerender(<ThreadView {...createProps({ sessionKey })} />);
      const content = view.getByTestId('thread-screen-session-content');
      expect(content.props.entering).toBeUndefined();
      expect(content.props.exiting).toBeUndefined();
      expect(view.getAllByTestId('thread-screen-timeline')).toHaveLength(1);
    }
  });

  it('leaves initial Markdown placement to FlashList and coalesces later measurements', () => {
    jest.useFakeTimers();
    const message: UiMessage = { id: 'table', role: 'assistant', text: '| City | Weather |\n|---|---|\n| Hangzhou | Sunny |' };
    const view = render(<ThreadView {...createProps({ messages: [message] })} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    const markdown = view.getByTestId('thread-markdown-table');
    mockScrollToEnd.mockClear();
    for (const height of [200, 540, 520, 600]) {
      act(() => {
        timeline.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
        timeline.props.onContentSizeChange(400, height);
      });
    }
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(timeline.props.maintainVisibleContentPosition).toEqual({ startRenderingFromBottom: true });
    fireEvent(timeline, 'load', { elapsedTimeInMs: 10 });
    for (const height of [1000, 1540, 1520, 1600]) fireEvent(timeline, 'contentSizeChange', 400, height);
    fireEvent(timeline, 'layout', { nativeEvent: { layout: { height: 700 } } });
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(20));
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    fireEvent(timeline, 'contentSizeChange', 400, 1600);
    fireEvent(timeline, 'layout', { nativeEvent: { layout: { height: 700 } } });
    act(() => jest.advanceTimersByTime(20));
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('thread-markdown-table')).toBe(markdown);
    expect(markdown.props.streamingAnimation).toBe(false);
  });

  it('keeps the native table mounted when authoritative history replaces its cache row', () => {
    const cached: UiMessage = { id: 'cached-table', renderKey: 'table-row', historyMessageId: 'server-table', role: 'assistant', text: '| City | Weather |\n|---|---|\n| Hangzhou | Sunny |' };
    const props = createProps({ messages: [cached] });
    const view = render(<ThreadView {...props} />);
    const markdown = view.getByTestId('thread-markdown-cached-table');
    const canonical = { ...cached, id: 'canonical-table', renderKey: undefined, text: cached.text.replace('Sunny', 'Cloudy') };
    view.rerender(<ThreadView {...props} messages={preserveHydratedMessageKeys([cached], [canonical])} />);
    expect(view.getByTestId('thread-markdown-canonical-table')).toBe(markdown);
    expect(markdown.props.markdown).toContain('Cloudy');
    expect(view.getAllByTestId(/^thread-markdown-/)).toHaveLength(1);
  });

  it.each(['drag', 'tool', 'session', 'composer', 'unmount'])('cancels a pending layout correction on %s', (action) => {
    jest.useFakeTimers();
    const tool: UiMessage = { id: 'tool', role: 'tool', text: '', toolName: 'bash', toolStatus: 'success' };
    const props = createProps({ input: 'First\nSecond\nThird', messages: [tool, { ...tool, id: 'other-tool' }] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    fireEvent(timeline, 'load', { elapsedTimeInMs: 10 });
    mockScrollToEnd.mockClear();
    fireEvent(timeline, 'contentSizeChange', 400, 2000);
    if (action === 'drag') fireEvent(timeline, 'scrollBeginDrag');
    if (action === 'tool') fireEvent.press(view.getByTestId('tools:other-tool'));
    if (action === 'session') view.rerender(<ThreadView {...props} sessionKey="another-session" />);
    if (action === 'composer') fireEvent.press(view.getByTestId('thread-screen-composer-expand'));
    if (action === 'unmount') view.unmount();
    act(() => jest.advanceTimersByTime(20));
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('renders dated subagent and Cron cards without treating tool details as sessions', () => {
    const onOpenRunSession = jest.fn();
    const onOpenCronRun = jest.fn();
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
          cronRun: { ts: older, jobId: 'nightly', action: 'finished', status: 'error', sessionKey: 'agent:atlas:cron:nightly' },
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
      onOpenCronRun,
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
    fireEvent.press(view.getByTestId('thread-cron-run-hermes-digest-run'));
    expect(view.getByTestId('thread-run-result')).toBeTruthy();
    expect(view.getAllByTestId(/^thread-date:/)).toHaveLength(3);
    expect(view.queryByTestId('thread-cron-run-nightly-run-status')).toBeNull();
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

    // A Cron card with its run record opens the execution record, never a thread
    // (owner decision 2026-09-19); the record sheet decides whether a session opens.
    fireEvent.press(view.getByTestId('thread-cron-run-nightly-run'));
    expect(onOpenCronRun).toHaveBeenCalledWith(expect.objectContaining({
      id: 'nightly-run',
      cronRun: expect.objectContaining({ jobId: 'nightly' }),
    }));
    expect(onOpenRunSession).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByTestId('thread-run-tool-details'));
    expect(view.getByTestId('thread-tool-detail').props.detail).toBe('package.json');
    expect(onOpenRunSession).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByText('Logs'));
    expect(onOpenRunLogs).toHaveBeenCalledWith('nightly', 'atlas');
  });

  it('reads a scheduled run session without a composer', () => {
    // The stable cron session behind "View full conversation" is a transcript to read,
    // not a conversation to continue (owner decision 2026-09-19).
    const cron = render(<ThreadView {...createProps({ sessionKey: 'agent:atlas:cron:nightly', isMainSession: false })} />);
    expect(cron.queryByTestId('thread-screen-composer-region')).toBeNull();
    cron.unmount();
    const main = render(<ThreadView {...createProps({ sessionKey: 'agent:atlas:main' })} />);
    expect(main.getByTestId('thread-screen-composer-region')).toBeTruthy();
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
    expect(view.getByLabelText('2 attachments')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Photo 2 of 2'));
    expect(onOpenAttachments).toHaveBeenCalledWith(message, 1);
  });

  it('lays every attached photo out as one album and opens the viewer at the tapped photo', () => {
    const onOpenAttachments = jest.fn();
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const uris = Array.from({ length: 6 }, (_, index) => `file://shot-${index}.jpg`);
    const message: UiMessage = {
      id: 'album-6',
      role: 'user',
      text: 'Here are the final screenshots.',
      imageUris: uris,
      // Known sizes lay out synchronously; portrait screenshots pack three per row.
      imageMetas: uris.map((uri) => ({ uri, width: 1179, height: 2556 })),
    };
    const view = render(<ThreadView {...createProps({
      messages: [message],
      onOpenAttachments,
      messageActions,
    })} />);

    // Content width is the 393-point window minus the 16-point row insets; the album takes 76% of it.
    const albumWidth = Math.round((393 - Space.lg * 2) * 0.76);
    const album = view.getByTestId('thread-attachments-album-6');
    expect(flattenStyle(album.props.style)).toMatchObject({
      width: albumWidth,
      alignSelf: 'flex-end',
      borderRadius: Radius.bubble,
      overflow: 'hidden',
    });
    const tiles = uris.map((_, index) => view.getByTestId(`thread-attachments-album-6-${index}`));
    expect(tiles).toHaveLength(6);
    const frames = tiles.map((tile) => flattenStyle(tile.props.style));
    // Two rows of three: no photo is dropped, the row spans the album, and rows stack below each other.
    expect(new Set(frames.map((frame) => frame.top)).size).toBe(2);
    expect(frames.slice(0, 3).reduce((sum, frame) => sum + (frame.width as number), 0) + 3 * 2).toBe(albumWidth);
    expect(frames[3].top).toBe((frames[0].height as number) + 3);
    expect(flattenStyle(album.props.style).height).toBe((frames[3].top as number) + (frames[3].height as number));

    fireEvent.press(view.getByLabelText('Photo 5 of 6'));
    expect(onOpenAttachments).toHaveBeenCalledWith(message, 4);
    // A long press on a photo still lifts the message actions, like the bubble does.
    fireEvent(tiles[2], 'longPress');
    expect(view.getByTestId('thread-message-actions').props.selection.messageId).toBe(message.id);
  });

  it('shows a lone photo at its own aspect ratio instead of a square thumbnail', () => {
    const wide: UiMessage = {
      id: 'wide-1',
      role: 'assistant',
      text: '',
      imageUris: ['file://chart.png'],
      imageMetas: [{ uri: 'file://chart.png', width: 1600, height: 900 }],
    };
    const tall: UiMessage = {
      id: 'tall-1',
      role: 'user',
      text: '',
      imageUris: ['file://shot.png'],
      imageMetas: [{ uri: 'file://shot.png', width: 1179, height: 2556 }],
    };
    const view = render(<ThreadView {...createProps({ messages: [wide, tall] })} />);
    const albumWidth = Math.round((393 - Space.lg * 2) * 0.76);
    const wideFrame = flattenStyle(view.getByTestId('thread-attachments-wide-1').props.style);
    expect(wideFrame).toMatchObject({ width: albumWidth, alignSelf: 'flex-start' });
    expect(wideFrame.height).toBeLessThan(albumWidth);
    const tallFrame = flattenStyle(view.getByTestId('thread-attachments-tall-1').props.style);
    expect(tallFrame.height).toBe(Math.round(albumWidth * 1.25));
    expect(tallFrame.width).toBeLessThan(albumWidth);
    expect(tallFrame.alignSelf).toBe('flex-end');
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

    // The nested invisible metadata reservation follows the visible body.
    expect(view.getByText(/^Summarize this spec/)).toBeTruthy();
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
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
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
      messageActions,
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
    fireEvent.press(view.getByTestId('thread-screen-dismiss-slash-suggestions'));
    expect(onDismissSlashSuggestions).toHaveBeenCalledTimes(1);

    expect(view.getByTestId('thread-screen-thinking-level')).toBeTruthy();
    act(() => view.getByTestId('thread-thinking-menu').props.onSelect('low'));
    expect(onSelectThinkingLevel).toHaveBeenCalledWith('low');
    expect(view.getByTestId(`thread-favorite-${message.id}`)).toBeTruthy();
    expect(view.queryByTestId('thread-message-actions')).toBeNull();
    const { triggerLightImpact } = require('../../services/haptics');
    triggerLightImpact.mockClear();
    fireEvent(view.getByTestId(`thread-message-${message.id}`), 'longPress');
    expect(triggerLightImpact).toHaveBeenCalledTimes(1);
    expect(require('react-native').Keyboard.dismiss).toHaveBeenCalled();
    const overlay = view.getByTestId('thread-message-actions');
    expect(overlay.props.selection).toMatchObject({ messageId: message.id, role: 'assistant', anchor: null });
    expect(typeof overlay.props.selection.remeasure).toBe('function');
    expect(overlay.props.message).toBe(message);
    expect(overlay.props.favorited).toBe(true);
    expect(overlay.props.contentInset).toBe(Space.lg);
    expect(overlay.props.onCopy).toBe(messageActions.onCopy);
    expect(overlay.props.onToggleFavorite).toBe(messageActions.onToggleFavorite);
    expect(overlay.props.onShare).toBe(messageActions.onShare);
    // A stale measurement closure reports nothing instead of the wrong frame.
    const measured = jest.fn();
    overlay.props.selection.remeasure(measured);
    expect(measured).toHaveBeenCalledWith(null);
    act(() => overlay.props.onClosed());
    expect(view.queryByTestId('thread-message-actions')).toBeNull();
  });

  it('lifts only the message block into the actions overlay and drops identity chrome', () => {
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const message: UiMessage = { id: 'reply-1', role: 'assistant', text: 'Lifted reply', modelLabel: 'Recorded model' };
    const view = render(<ThreadView {...createProps({
      messages: [message],
      showAgentAvatar: true,
      messageActions,
      favoriteMessageIds: new Set([message.id]),
    })} />);
    // The optional signature shows the name only; the model label is gone for good.
    expect(view.getAllByText('Atlas').length).toBeGreaterThan(1);
    expect(view.queryByText('Recorded model')).toBeNull();
    fireEvent(view.getByTestId(`thread-message-${message.id}`), 'longPress');
    const overlay = view.getByTestId('thread-message-actions');
    const clone = render(<>{overlay.props.renderMessage(message, 320)}</>);
    expect(clone.queryByText('Atlas')).toBeNull();
    expect(clone.queryByText('Recorded model')).toBeNull();
    expect(clone.getByTestId(`thread-bubble-${message.id}`)).toBeTruthy();
    expect(clone.getByTestId(`thread-favorite-${message.id}`)).toBeTruthy();
    // The row owns no vertical padding: the timeline rhythm lives outside the
    // measured row, so the clone and the list row share one geometry.
    const cloneTree = clone.toJSON();
    if (!cloneTree || Array.isArray(cloneTree)) throw new Error('Expected one cloned message root');
    const cloneStyle = flattenStyle(cloneTree.props.style);
    expect(cloneStyle).toMatchObject({ width: 320, paddingHorizontal: Space.lg });
    expect(cloneStyle.paddingTop).toBeUndefined();
    expect(cloneStyle.paddingBottom).toBeUndefined();
    expect(cloneStyle.paddingVertical).toBeUndefined();
  });

  it('does not arm the long-press gesture or overlay without message actions', () => {
    const message: UiMessage = { id: 'plain-1', role: 'user', text: 'No menu here' };
    const view = render(<ThreadView {...createProps({ messages: [message] })} />);
    const row = view.getByTestId(`thread-message-${message.id}`);
    expect(row.props.onLongPress).toBeUndefined();
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.accessibilityActions).toBeUndefined();
    expect(view.queryByTestId('thread-message-actions')).toBeNull();
  });

  it('exposes the message actions to assistive technology as a long-press action', () => {
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const message: UiMessage = { id: 'a11y-1', role: 'assistant', text: 'Reachable reply' };
    const view = render(<ThreadView {...createProps({ messages: [message], messageActions })} />);
    const row = view.getByTestId(`thread-message-${message.id}`);
    expect(row.props.accessibilityActions).toEqual([{ name: 'longpress' }]);
    act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
    expect(view.queryByTestId('thread-message-actions')).toBeNull();
    act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } }));
    expect(view.getByTestId('thread-message-actions').props.selection.messageId).toBe(message.id);
  });

  it('closes the actions overlay when the session changes', () => {
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const message: UiMessage = { id: 'switch-1', role: 'user', text: 'Before switch' };
    const view = render(<ThreadView {...createProps({ messages: [message], messageActions })} />);
    fireEvent(view.getByTestId(`thread-message-${message.id}`), 'longPress');
    expect(view.getByTestId('thread-message-actions').props.selection.role).toBe('user');
    view.rerender(<ThreadView {...createProps({ messages: [message], messageActions, sessionKey: 'agent:atlas:other' })} />);
    expect(view.queryByTestId('thread-message-actions')).toBeNull();
  });

  it('keeps queued messages at full opacity with inline status and opens their actions on tap', () => {
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const queuedMessageActions = {
      canSendNow: false,
      onSendNow: jest.fn(),
      onEdit: jest.fn(),
      onRemove: jest.fn(),
    };
    const sent: UiMessage = { id: 'sent-1', role: 'user', text: 'Already sent', timestampMs: 1_000 };
    const queued: UiMessage = { id: 'usr_2_q1', role: 'user', text: 'Later please', delivery: 'queued' };
    const view = render(<ThreadView {...createProps({
      messages: [queued, sent],
      isRunning: true,
      input: 'draft',
      canSend: true,
      onCancel: jest.fn(),
      messageActions,
      queuedMessageActions,
    })} />);

    // Pending state uses the same inline metadata geometry as delivery confirmation.
    expect(view.getByTestId('thread-meta-usr_2_q1-status').props.accessibilityLabel).toBe('Queued');
    expect(view.queryByTestId('thread-delivery-caption-usr_2_q1')).toBeNull();
    expect(view.getByTestId('thread-message-usr_2_q1').props.accessibilityLabel).toBe('Later please · Queued');
    expect(view.queryByTestId('thread-delivery-caption-sent-1')).toBeNull();
    expect(flattenStyle(view.getByTestId('thread-delivery-usr_2_q1').props.style).opacity ?? 1).toBe(1);
    expect(flattenStyle(view.getByTestId('thread-delivery-sent-1').props.style).opacity ?? 1).toBe(1);
    // The draft exposes both Stop and the queue Send while the run is active.
    expect(view.getByTestId('thread-screen-composer-stop')).toBeTruthy();
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityLabel).toBe('Send after this reply');

    // A plain tap opens the same lifted menu as a long press, with queue actions attached.
    expect(view.getByTestId('thread-message-sent-1').props.onPress).toBeUndefined();
    fireEvent.press(view.getByTestId('thread-message-usr_2_q1'));
    const overlay = view.getByTestId('thread-message-actions');
    expect(overlay.props.selection).toMatchObject({ messageId: queued.id, role: 'user' });
    expect(overlay.props.queuedActions).toMatchObject({ canSendNow: false, editable: true });
    act(() => overlay.props.queuedActions.onEdit(queued));
    expect(queuedMessageActions.onEdit).toHaveBeenCalledWith(queued);
    act(() => overlay.props.onClosed());

    // Paused and sending states change the glyph and lock editing while sending.
    view.rerender(<ThreadView {...createProps({
      messages: [{ ...queued, delivery: 'held' }, sent],
      messageActions,
      queuedMessageActions: { ...queuedMessageActions, canSendNow: true },
    })} />);
    expect(view.getByTestId('thread-meta-usr_2_q1-status').props.accessibilityLabel).toBe('Paused');
    fireEvent.press(view.getByTestId('thread-message-usr_2_q1'));
    expect(view.getByTestId('thread-message-actions').props.queuedActions).toMatchObject({ canSendNow: true, editable: true });
    act(() => view.getByTestId('thread-message-actions').props.onClosed());

    view.rerender(<ThreadView {...createProps({
      messages: [{ ...queued, delivery: 'sending' }, sent],
      messageActions,
      queuedMessageActions: { ...queuedMessageActions, canSendNow: true },
    })} />);
    expect(view.getByTestId('thread-meta-usr_2_q1-status').props.accessibilityLabel).toBe('Sending…');
    fireEvent.press(view.getByTestId('thread-message-usr_2_q1'));
    expect(view.getByTestId('thread-message-actions').props.queuedActions).toMatchObject({ canSendNow: false, editable: false });
    act(() => view.getByTestId('thread-message-actions').props.onClosed());

    // Without queue actions a queued bubble is inert on tap and has no overlay actions.
    view.rerender(<ThreadView {...createProps({ messages: [queued, sent], messageActions })} />);
    expect(view.getByTestId('thread-message-usr_2_q1').props.onPress).toBeUndefined();
    fireEvent(view.getByTestId('thread-message-usr_2_q1'), 'longPress');
    expect(view.getByTestId('thread-message-actions').props.queuedActions).toBeUndefined();
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
    // Header subtitle and the reply placeholder both carry the live activity.
    expect(running.getAllByText('Using exec…').length).toBeGreaterThanOrEqual(1);
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
      onOpenAddMenu: undefined,
      isRunning: true,
      input: '',
    })} />);
    expect(unsupported.queryByTestId('thread-screen-composer-add')).toBeNull();
    expect(unsupported.getByTestId('thread-screen-composer-input').type).toBe('TextInput');
    expect(unsupported.queryByTestId('thread-approval-approval-hidden')).toBeNull();
    expect(unsupported.queryByText('Sonnet')).toBeNull();
    expect(unsupported.queryByTestId('thread-screen-sessions')).toBeNull();
    expect(unsupported.getByTestId('thread-screen-header-pill').props.onPress).toBeDefined();
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

it('keeps expanded tool activity open through updates and opens full tool details', () => {
  const first: UiMessage = { id: 'a', role: 'tool', text: '', toolName: 'bash', toolArgs: JSON.stringify({ command: 'git status' }), toolStatus: 'success' };
  const second: UiMessage = { ...first, id: 'b', toolStatus: 'running' };
  const props = createProps({ messages: [second, first] });
  const view = render(<ThreadView {...props} />);
  expect(view.queryByTestId('thread-run-a')).toBeNull();
  mockScrollToEnd.mockClear();
  fireEvent.press(view.getByTestId('tools:a'));
  expect(view.getByTestId('tools:a').props.accessibilityState).toEqual({ expanded: true });
  const timeline = view.getByTestId('thread-screen-timeline');
  expect(timeline.props.data.map((item: any) => item.key)).toEqual(['tools:a', 'message:a', 'message:b']);
  expect(timeline.props.maintainVisibleContentPosition.autoscrollToBottomThreshold).toBeUndefined();
  fireEvent.scroll(timeline, scrollEvent(0));
  act(() => timeline.props.onContentSizeChange(400, 2300));
  expect(view.getByTestId('thread-screen-scroll-to-bottom')).toBeTruthy();
  expect(mockScrollToEnd).not.toHaveBeenCalled();
  view.rerender(<ThreadView {...props} messages={[{ ...first, id: 'c' }, { ...second, toolStatus: 'success' }, first]} />);
  expect(view.getByTestId('tools:a').props.accessibilityState).toEqual({ expanded: true });
  expect(view.getByTestId('thread-screen-timeline').props.data.map((item: any) => item.key)).toEqual(['tools:a', 'message:a', 'message:b', 'message:c']);
  expect(view.getByTestId('thread-run-c')).toBeTruthy();
  fireEvent.press(view.getByTestId('thread-run-a'));
  expect(view.getByTestId('thread-tool-detail').props.args).toEqual(JSON.stringify({ command: 'git status' }));
});

it('uses a human title for a new session whose backend title is only its internal key', () => {
  const key = 'agent:main:dashboard:new-session';
  const view = render(<ThreadView {...createProps({ sessionKey: key, sessionTitle: key, isMainSession: false })} />);
  expect(view.getByText('Atlas · New session')).toBeTruthy();
  expect(view.queryByText(key)).toBeNull();
});

it('preserves the native draft and timeline while entering and leaving full-screen composition', () => {
  const view = render(<ThreadView {...createProps({ input: 'First\nSecond\nThird' })} />);
  const input = view.getByTestId('thread-screen-composer-input');
  const timeline = view.getByTestId('thread-screen-timeline');
  fireEvent(view.getByTestId('thread-screen-composer-region'), 'layout', { nativeEvent: { layout: { height: 172 } } });
  mockScrollToEnd.mockClear();
  fireEvent.press(view.getByTestId('thread-screen-composer-expand'));
  expect(view.getByTestId('thread-screen-composer-input')).toBe(input);
  expect(view.getByTestId('thread-screen-timeline', { includeHiddenElements: true })).toBe(timeline);
  expect(view.getByTestId('thread-screen-composer-placeholder', { includeHiddenElements: true }).props.style.height).toBe(172);
  expect(view.queryByTestId('thread-screen-back')).toBeNull();
  fireEvent.press(view.getByTestId('thread-screen-composer-collapse'));
  expect(view.getByTestId('thread-screen-composer-input')).toBe(input);
  expect(mockScrollToEnd).not.toHaveBeenCalled();
});

it('follows keyboard and composer size changes only when the reader was at the bottom', () => {
  jest.useFakeTimers();
  const view = render(<ThreadView {...createProps()} />);
  const list = view.getByTestId('thread-screen-timeline');
  fireEvent(list, 'load', { elapsedTimeInMs: 10 });
  mockScrollToEnd.mockClear();
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 360 } } });
  act(() => jest.advanceTimersByTime(20));
  expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false });
  mockScrollToEnd.mockClear();
  fireEvent(list, 'scrollBeginDrag');
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 300 } } });
  act(() => jest.advanceTimersByTime(20));
  expect(mockScrollToEnd).not.toHaveBeenCalled();
  jest.useRealTimers();
});

const scrollEvent = (remaining: number) => ({ nativeEvent: {
  contentSize: { height: 2000, width: 393 },
  layoutMeasurement: { height: 600, width: 393 },
  contentOffset: { y: 1400 - remaining, x: 0 },
} });

it.each(['light', 'dark'] as const)('reveals the bottom action during scrolling without threshold flicker (%s)', (scheme) => {
  mockScheme = scheme;
  const view = render(<ThreadView {...createProps()} />);
  const list = view.getByTestId('thread-screen-timeline');
  const visible = () => view.getByTestId('thread-screen-scroll-to-bottom-container', { includeHiddenElements: true }).props.pointerEvents === 'auto';
  expect(visible()).toBe(false);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, scrollEvent(100));
  expect(visible()).toBe(true);
  fireEvent.scroll(list, scrollEvent(70));
  expect(visible()).toBe(true);
  fireEvent(list, 'momentumScrollEnd', scrollEvent(10));
  expect(visible()).toBe(false);
  fireEvent.scroll(list, scrollEvent(-30));
  expect(visible()).toBe(false);
  mockScheme = 'light';
    mockPacedText = undefined;
});

it('performs one native animated return, defers streaming snaps, then resumes bottom following', () => {
  jest.useFakeTimers();
  const view = render(<ThreadView {...createProps()} />);
  const list = view.getByTestId('thread-screen-timeline');
  fireEvent(list, 'load', { elapsedTimeInMs: 10 });
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, scrollEvent(800));
  mockScrollToEnd.mockClear();
  fireEvent.press(view.getByTestId('thread-screen-scroll-to-bottom'));
  expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
  expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: true });
  fireEvent.scroll(list, scrollEvent(300));
  fireEvent(list, 'contentSizeChange', 393, 2100);
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 600 } } });
  act(() => jest.advanceTimersByTime(20));
  expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
  fireEvent(list, 'momentumScrollEnd', scrollEvent(100));
  expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  mockScrollToEnd.mockClear();
  fireEvent(list, 'contentSizeChange', 393, 2200);
  act(() => jest.advanceTimersByTime(20));
  expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false });
  jest.useRealTimers();
});

it('lets a new drag interrupt the return and resets the action when switching sessions', () => {
  const props = createProps();
  const view = render(<ThreadView {...props} />);
  const list = view.getByTestId('thread-screen-timeline');
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, scrollEvent(900));
  fireEvent.press(view.getByTestId('thread-screen-scroll-to-bottom'));
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, scrollEvent(500));
  mockScrollToEnd.mockClear();
  fireEvent(list, 'momentumScrollEnd', scrollEvent(500));
  fireEvent(list, 'contentSizeChange', 393, 2100);
  expect(mockScrollToEnd).not.toHaveBeenCalled();
  expect(view.getByTestId('thread-screen-scroll-to-bottom')).toBeTruthy();
  view.rerender(<ThreadView {...props} sessionKey="another-session" />);
  expect(view.queryByTestId('thread-screen-scroll-to-bottom')).toBeNull();
});

it('returns immediately under reduced motion and keeps following subsequent content', () => {
  jest.useFakeTimers();
  mockReducedMotion = true;
  const view = render(<ThreadView {...createProps()} />);
  const list = view.getByTestId('thread-screen-timeline');
  fireEvent(list, 'load', { elapsedTimeInMs: 10 });
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, scrollEvent(800));
  mockScrollToEnd.mockClear();
  fireEvent.press(view.getByTestId('thread-screen-scroll-to-bottom'));
  expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  fireEvent(list, 'contentSizeChange', 393, 2100);
  act(() => jest.advanceTimersByTime(20));
  expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
  mockReducedMotion = false;
  jest.useRealTimers();
});


describe('continuous message presentation', () => {
  afterEach(() => { mockPacedText = undefined; });
  it('keeps the known reply clock visible during streaming without a hidden footer', () => {
    const message: UiMessage = { id: 'streaming', role: 'assistant', text: 'Working on the provider.', timestampMs: 1000, streaming: true };
    const view = render(<ThreadView {...createProps({ messages: [message], isRunning: true })} />);
    expect(view.getByTestId('thread-meta-streaming')).toBeTruthy();
    view.rerender(<ThreadView {...createProps({ messages: [{ ...message, streaming: false }], isRunning: true })} />);
    expect(view.getByTestId('thread-meta-streaming')).toBeTruthy();
  });
  it('never adds a second placeholder when the recovered live row has a history id', () => {
    const message: UiMessage = { id: 'history-live', renderKey: 'reply:run:0', role: 'assistant', text: 'Working on the provider.', timestampMs: 1000, streaming: true };
    const view = render(<ThreadView {...createProps({ messages: [message], isRunning: true })} />);
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
    expect(view.getByTestId('thread-markdown-history-live')).toBeTruthy();
  });
  it('retains native rows, visible clocks and one tail across repeated recovery history projections', () => {
    const { buildLiveRunListData } = require('../../chat/liveRunThread');
    const user: UiMessage = { id: 'user', role: 'user', text: 'Inspect', timestampMs: 1000 };
    const tool: UiMessage = { id: 'toolcall_one', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' };
    const params = { historyMessages: [user],
      streamSegments: [{ id: 'segment', renderKey: 'reply:1000:0', text: 'Checking the provider.', timestampMs: 1000 }],
      toolMessages: [tool], liveStreamText: 'Now reading the output.', liveStreamStartedAt: 1000,
      activeRunId: 'run', includePlaceholder: true };
    const view = render(<ThreadView {...createProps({ messages: buildLiveRunListData(params), isRunning: true })} />);
    const segment = view.getByTestId('thread-markdown-segment');
    const tail = view.getByTestId('thread-markdown-streaming');
    const clock = view.getByTestId('thread-meta-segment');
    const keys = view.getByTestId('thread-screen-timeline').props.data.map((item: { key: string }) => item.key);
    for (let index = 0; index < 20; index++) {
      const historyMessages: UiMessage[] = [user,
        { id: `history-segment-${index}`, role: 'assistant', text: index % 2 ? 'Checking' : 'Checking the provider.' },
        tool, { id: `history-tail-${index}`, role: 'assistant', text: 'Now reading' },
      ];
      view.rerender(<ThreadView {...createProps({ messages: buildLiveRunListData({ ...params, historyMessages }), isRunning: true })} />);
      expect(view.getByTestId('thread-markdown-segment')).toBe(segment);
      expect(segment.props.streamingAnimation).toBe(false);
      expect(segment.props.markdown).toBe('Checking the provider.');
      expect(view.getByTestId('thread-meta-segment')).toBe(clock);
      expect(view.getByTestId('thread-markdown-streaming')).toBe(tail);
      expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
      expect(view.getByTestId('thread-screen-timeline').props.data.map((item: { key: string }) => item.key)).toEqual(keys);
    }
  });
  it('retains the same outgoing native subtree and text reservation from pending through server echo', () => {
    const pending: UiMessage = { id: 'usr_1', renderKey: 'usr_1', role: 'user', text: 'A message near the wrapping boundary', timestampMs: 1000, delivery: 'sending' };
    const view = render(<ThreadView {...createProps({ messages: [pending] })} />);
    const bubble = view.getByTestId('thread-bubble-usr_1');
    const meta = view.getByTestId('thread-meta-usr_1');
    const textBefore = bubble.findAllByType(require('react-native').Text).map((node) => typeof node.props.children === 'string' ? node.props.children : null);
    const { delivery: _delivery, ...submitted } = pending;
    view.rerender(<ThreadView {...createProps({ messages: [submitted] })} />);
    expect(view.getByTestId('thread-bubble-usr_1') === bubble).toBe(true);
    expect(bubble.findAllByType(require('react-native').Text).map((node) => typeof node.props.children === 'string' ? node.props.children : null)).toEqual(textBefore);
    view.rerender(<ThreadView {...createProps({ messages: [{ ...submitted, id: 'history-1' }] })} />);
    expect(view.getByTestId('thread-bubble-history-1') === bubble).toBe(true);
    expect(view.getByTestId('thread-meta-history-1') === meta).toBe(true);
  });
  it('keeps thinking until paced text is visible and preserves markdown through finalization', () => {
    const streaming: UiMessage = { id: 'streaming', renderKey: 'reply:1000:0', role: 'assistant', text: 'A complete reply', timestampMs: 1000, streaming: true };
    mockPacedText = '';
    const view = render(<ThreadView {...createProps({ messages: [streaming], isRunning: true })} />);
    expect(view.getByTestId('thread-thinking-streaming')).toBeTruthy();
    expect(view.queryByTestId('thread-markdown-streaming')).toBeNull();
    mockPacedText = 'A complete';
    view.rerender(<ThreadView {...createProps({ messages: [streaming], isRunning: true })} />);
    const markdown = view.getByTestId('thread-markdown-streaming');
    const meta = view.getByTestId('thread-meta-streaming', { includeHiddenElements: true });
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
    expect(markdown.props.markdown).toBe('A complete');
    mockPacedText = undefined;
    view.rerender(<ThreadView {...createProps({ messages: [{ ...streaming, id: 'final_run', streaming: false }] })} />);
    expect(view.getByTestId('thread-markdown-final_run') === markdown).toBe(true);
    expect(view.getByTestId('thread-meta-final_run') === meta).toBe(true);
    expect(markdown.props.markdown).toBe('A complete reply');
  });
});

describe.each(['light', 'dark'] as const)('immersive wallpaper in %s', (scheme) => {
  beforeEach(() => { mockScheme = scheme; });
  const theme = () => buildTheme(scheme, scheme, builtInAccents.iceBlue);
  const wallpaper = (): ThreadViewProps['chatAppearance'] => ({
    ...DEFAULT_CHAT_APPEARANCE,
    background: { ...DEFAULT_CHAT_APPEARANCE.background, enabled: true, imagePath: 'file:///documents/chat-appearance/background.jpg', blur: 4, dim: 0.2 },
  });

  it('floats the header over the timeline and keeps the canvas chrome without a wallpaper', () => {
    const view = render(<ThreadView {...createProps({ topInset: Space.xl })} />);
    const headerHeight = resolveThreadHeaderHeight(Space.xl);
    expect(headerHeight).toBe(Space.xl + Space.sm + ControlSize.floatingButton + Space.sm);
    expect(view.queryByTestId('chat-background-layer')).toBeNull();
    expect(flattenStyle(view.getByTestId('thread-screen-header').props.style)).toMatchObject({
      position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: theme().colors.canvas,
      paddingTop: Space.xl + Space.sm, paddingBottom: Space.sm, paddingHorizontal: Space.lg,
    });
    // Only the 24-point tail below the opaque header fades the timeline out.
    expect(flattenStyle(view.getByTestId('thread-screen-header-scrim').props.style)).toMatchObject({ top: '100%', bottom: -Space.xl });
    expect(flattenStyle(view.getByTestId('thread-screen-timeline').props.contentContainerStyle))
      .toMatchObject({ paddingTop: headerHeight + Space.lg });
    // Navigation controls are white floating circles, like every other page header.
    expect(flattenStyle(view.getByTestId('thread-screen-back').props.style).backgroundColor).toBe(theme().colors.surfaceFloating);
    expect(flattenStyle(view.getByTestId('thread-screen-sessions').props.style).backgroundColor).toBe(theme().colors.surfaceFloating);
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style).backgroundColor).toBe(theme().colors.surface);
    expect(flattenStyle(view.getByTestId('thread-screen-composer-region').props.style).backgroundColor).toBe(theme().colors.canvas);
    expect(view.queryByTestId('thread-screen-composer-scrim')).toBeNull();
    expect(flattenStyle(view.getByTestId('thread-screen-composer').props.style).backgroundColor).toBe(theme().colors.surface);
  });

  it('fills the whole screen with the wallpaper and floats every control on glass', () => {
    const view = render(<ThreadView {...createProps({
      topInset: Space.xl,
      chatAppearance: wallpaper(),
      messages: [{ id: 'timed', role: 'user', text: 'Hello', timestampMs: Date.now() }],
    })} />);
    const glass = resolveChatChromeAppearance(theme());
    const layer = view.getByTestId('chat-background-layer');
    expect(flattenStyle(layer.props.style)).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 });
    expect(view.getByTestId('chat-background-layer-image').props.blurRadius).toBe(4);
    expect(view.getByTestId('chat-background-layer-dim')).toBeTruthy();
    // The wallpaper is a sibling of the keyboard-avoiding content, so it never moves with the keyboard.
    const screen = view.getByTestId('thread-screen');
    expect(screen.props.children[0].props.appearance).toEqual(wallpaper());

    const header = flattenStyle(view.getByTestId('thread-screen-header').props.style);
    expect(header.position).toBe('absolute');
    expect(header.backgroundColor).toBeUndefined();
    expect(flattenStyle(view.getByTestId('thread-screen-header-scrim').props.style)).toMatchObject({ top: 0, bottom: -Space.xl });
    expect(flattenStyle(view.getByTestId('thread-screen-back').props.style)).toMatchObject({
      backgroundColor: glass.backgroundColor, borderColor: glass.borderColor, borderWidth: glass.borderWidth,
    });
    expect(flattenStyle(view.getByTestId('thread-screen-sessions').props.style).backgroundColor).toBe(glass.backgroundColor);
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style)).toMatchObject({
      backgroundColor: glass.backgroundColor, borderColor: glass.borderColor,
    });
    expect(flattenStyle(view.getByTestId('thread-date:message:timed').props.style).backgroundColor).toBe(glass.backgroundColor);

    const region = flattenStyle(view.getByTestId('thread-screen-composer-region').props.style);
    expect(region.backgroundColor).toBeUndefined();
    expect(view.getByTestId('thread-screen-composer-scrim')).toBeTruthy();
    expect(flattenStyle(view.getByTestId('thread-screen-composer').props.style)).toMatchObject({
      borderRadius: Radius.bubble, backgroundColor: glass.backgroundColor, borderColor: glass.borderColor,
    });
  });

  it('returns the composer dock to the canvas for full-screen composition', () => {
    const view = render(<ThreadView {...createProps({ chatAppearance: wallpaper(), input: 'First\nSecond\nThird' })} />);
    fireEvent.press(view.getByTestId('thread-screen-composer-expand'));
    expect(flattenStyle(view.getByTestId('thread-screen-composer-region').props.style).backgroundColor).toBe(theme().colors.canvas);
    expect(view.queryByTestId('thread-screen-composer-scrim')).toBeNull();
    expect(flattenStyle(view.getByTestId('thread-screen-composer').props.style).backgroundColor).toBe(theme().colors.canvas);
  });
});
