// Keep the real attachment components; native file/share behavior has its own focused tests.
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' }, FileMode: { WriteOnly: 1 },
  Directory: jest.fn(), File: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, ...props }: any) => visible ? React.createElement(require('react-native').View, props, children) : null }));
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type Capabilities } from '@clawket/agent-protocol';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { ControlSize, FontSize, Motion, Radius, Space } from '../../theme/tokens';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import { resolveChatChromeAppearance } from '../../features/chat-appearance/resolver';
import { CHAT_PHOTO_SERVICE, chatWallpaperDriftScrims, chatWallpaperPalettes } from '../../theme/chat-wallpaper';
import type { SharedValue } from 'react-native-reanimated';
import type { ComposerHandle } from '../../components/ui/Composer';
import type { UiMessage } from '../../types/chat';
import { preserveHydratedMessageKeys } from '../../chat/historyMergePolicy';
import { ThreadView, resolveThreadHeaderHeight, type ThreadCopy, type ThreadViewProps } from './ThreadView';
import type { ThreadRunCard } from './model';
import { messageMetaSpacer } from '../../components/chat/MessageMeta';

it.each(['ios', 'android'])('uses the stable platform keyboard padding container with its safe-area offset on %s', (platform) => {
  const { Platform } = require('react-native');
  const previous = Platform.OS;
  Platform.OS = platform;
  try {
    const view = render(<ThreadView {...createProps({ bottomInset: 24 })} />);
    const avoidingType = platform === 'ios' ? require('react-native').KeyboardAvoidingView
      : require('../../components/chat/AndroidChatKeyboardAvoider').AndroidChatKeyboardAvoider;
    const avoiding = view.UNSAFE_getByType(avoidingType);
    expect(avoiding.props.behavior).toBe('padding');
    expect(avoiding.props.keyboardVerticalOffset).toBe(Space.md - Math.max(24, Space.lg));
  } finally {
    Platform.OS = previous;
  }
});

it.each(['ios', 'android'])('keeps the same avoider, editor and timeline across send and keyboard-related React commits on %s', (platform) => {
  const { Platform } = require('react-native');
  const KeyboardAvoidingView = platform === 'ios' ? require('react-native').KeyboardAvoidingView
    : require('../../components/chat/AndroidChatKeyboardAvoider').AndroidChatKeyboardAvoider;
  const { FlashList } = require('@shopify/flash-list');
  const previous = Platform.OS;
  Platform.OS = platform;
  try {
    const props = createProps({ bottomInset: 24 });
    const view = render(<ThreadView {...props} />);
    const avoider = view.UNSAFE_getByType(KeyboardAvoidingView);
    const input = view.getByTestId('thread-screen-composer-input');
    const list = view.UNSAFE_getByType(FlashList);
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    expect(props.onSend).toHaveBeenCalledTimes(1);
    // Native keyboard geometry is device-tested; this guards React reconciliation
    // when a send clears the draft and the keyboard/safe area changes concurrently.
    view.rerender(<ThreadView {...props} input="" isRunning bottomInset={0} />);
    expect(view.UNSAFE_getByType(KeyboardAvoidingView)).toBe(avoider);
    expect(avoider.props.behavior).toBe('padding');
    expect(avoider.props.enabled).not.toBe(false);
    expect(avoider.props.keyboardVerticalOffset).toBe(Space.md - Space.lg);
    expect(view.getByTestId('thread-screen-composer-input')).toBe(input);
    expect(view.UNSAFE_getByType(FlashList)).toBe(list);
    view.rerender(<ThreadView {...props} input="Next draft" isRunning={false} />);
    expect(view.getByTestId('thread-screen-composer-input')).toBe(input);
    expect(view.UNSAFE_getByType(require('../../components/ui/Composer').Composer).props.value).toBe('Next draft');
    fireEvent.changeText(input, 'Edited draft');
    expect(props.onChangeInput).toHaveBeenLastCalledWith('Edited draft');
    expect(view.UNSAFE_getByType(FlashList)).toBe(list);
    expect(avoider.props.keyboardVerticalOffset).toBe(Space.md - Math.max(24, Space.lg));
    expect(props.onSend).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally { Platform.OS = previous; }
});

it('reserves the user clock with nonbreaking whitespace, never another visible time', () => {
  for (const hasStatus of [false, true]) {
    const spacer = messageMetaSpacer('22:51', hasStatus);
    expect(spacer).not.toMatch(/[0-9:]/);
    expect(spacer.slice(1).split('\u2060')).toEqual([
      '\u2007', '\u2007', '\u2007', '\u2008', '\u2007', '\u2007',
      ...(hasStatus ? ['\u2007', '\u2007', '\u2007'] : []),
    ]);
  }
});

let mockScheme: 'light' | 'dark' = 'light';
let mockReducedMotion = false;
let mockPacedText: string | undefined;
const mockScrollToEnd = jest.fn();
/** Geometry the FlashList mock reports from its imperative handle. */
const mockListLayout = { content: 0, viewport: 0 };
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
    ...require('../../../__mocks__/native-animated'),
    DynamicColorIOS: (variants: unknown) => ({ dynamic: variants }),
    Keyboard: { dismiss: jest.fn() },
    I18nManager: { isRTL: false },
    KeyboardAvoidingView: host('NativeKeyboardAvoidingView'),
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
    Modal: ({ visible, children, ...props }: any) => visible
      ? ReactRuntime.createElement('Modal', props, children) : null,
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

// Tokens the copy under test fills in; others stay visible as keys.
const mockInterpolatedTokens = new Set(['count', 'percent', 'name', 'detail', 'first', 'second', 'minutes', 'seconds', 'hours']);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => key === 'Yesterday' ? require(`../../i18n/locales/${options?.lng === 'zh-Hans' ? 'zh-Hans' : String(options?.lng || 'en').split('-')[0]}/common.json`).Yesterday : key.replace(/\{\{(\w+)\}\}/g, (match, token: string) => (mockInterpolatedTokens.has(token) ? String(options?.[token] ?? '') : match)) }),
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

// The UI-thread follow is unit-tested beside its hook; here it records what the timeline asks of it.
const mockUiFollow = { bind: jest.fn(() => true), glide: jest.fn(), snap: jest.fn(), stop: jest.fn() };
let mockUiFollowCallbacks: { onSettled: (generation: number) => void; onUnavailable: () => void } | null = null;
jest.mock('./useUiThreadFollow', () => ({
  useUiThreadFollow: (callbacks: NonNullable<typeof mockUiFollowCallbacks>) => {
    mockUiFollowCallbacks = callbacks;
    return mockUiFollow;
  },
}));

// The word pacer is unit-tested in src/chat; here the stream renders as it arrives.
jest.mock('../../chat/useSmoothedStreamText', () => ({
  useSmoothedStreamText: (text: string) => mockPacedText ?? text,
}));

jest.mock('../../components/chat/AndroidChatKeyboardAvoider', () => {
  const ReactRuntime = require('react');
  return { AndroidChatKeyboardAvoider: ReactRuntime.forwardRef(({ children, ...props }: any, ref: any) =>
    ReactRuntime.createElement(require('react-native').View, { ...props, ref }, children)) };
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
    }, ref: unknown) => {
      // Like FlashList, one stable handle per list instance; follow corrections
      // reach the same scroll spy through the native scroll view.
      ReactRuntime.useImperativeHandle(ref, () => ({
        scrollToEnd: mockScrollToEnd,
        getNativeScrollRef: () => ({ scrollToEnd: mockScrollToEnd }),
        getChildContainerDimensions: () => ({ width: 393, height: mockListLayout.content }),
        getWindowSize: () => ({ width: 393, height: mockListLayout.viewport }),
      }), []);
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
  // Like Reanimated's builders, each modifier returns its own copy, so one
  // component's duration never leaks into another's.
  type LayoutAnimationMock = {
    name: string;
    durationMs?: number;
    easingValue?: unknown;
    reduceMotionMode?: string;
    duration(durationMs: number): LayoutAnimationMock;
    easing(easingValue: unknown): LayoutAnimationMock;
    reduceMotion(reduceMotionMode: string): LayoutAnimationMock;
  };
  const createLayoutAnimation = (name: string, fields: Partial<LayoutAnimationMock> = {}): LayoutAnimationMock => ({
    name,
    durationMs: undefined,
    easingValue: undefined,
    reduceMotionMode: undefined,
    ...fields,
    duration(durationMs: number) { return createLayoutAnimation(name, { ...this, durationMs }); },
    easing(easingValue: unknown) { return createLayoutAnimation(name, { ...this, easingValue }); },
    reduceMotion(reduceMotionMode: string) { return createLayoutAnimation(name, { ...this, reduceMotionMode }); },
  });
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
      quad: 'quad',
      inOut: (value: unknown) => value,
      out: (value: unknown) => ({ kind: 'out', value }),
      bezier: (...points: number[]) => ({ kind: 'bezier', points }),
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
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: -1 }),
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
  send: 'Send',
  stop: 'Stop',
  queueSend: 'Send after this reply',
  queued: 'Queued',
  sending: 'Sending…',
  paused: 'Paused',
  heldHint: 'Not sent · tap to review',
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

/**
 * One withTiming call per row entrance: a reply rises over `duration.normal`
 * (eased out cubically); a sent row's flight counts once, by its Y curve.
 */
function isEntranceTiming([target, options]: unknown[]): boolean {
  const config = options as { duration?: number; easing?: { kind?: string; value?: unknown; points?: number[] } } | undefined;
  if (target !== 1 || !config) return false;
  if (config.duration === Motion.duration.normal) return config.easing?.kind === 'out' && config.easing.value === 'cubic';
  return config.duration === Motion.send.duration && config.easing?.kind === 'bezier'
    && config.easing.points?.[1] === Motion.send.curveY[1];
}

describe('ThreadView', () => {

  it.each([undefined, null, 'custom', 'workspace', 'read-only', 'full-access'])('keeps permission mode %s out of the composer: the model sheet holds it', (permissionMode) => {
    // A+ model sheet (owner decision 2026-10-01): the capsule holds the model only.
    const callbacks = createProps({ capabilities: { ...CAPABILITY_MATRIX.codex }, permissionMode, onOpenModelPicker: jest.fn() });
    const view = render(<ThreadView {...callbacks} />);
    expect(view.queryByTestId('thread-permissions')).toBeNull();
    expect(view.getByTestId('thread-model-picker')).toBeTruthy();
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityState.disabled).toBe(false);
    // Only full access marks the header, beside the name.
    const warning = view.queryByTestId('thread-screen-header-pill-warning');
    if (permissionMode === 'full-access') {
      expect(warning).toBeTruthy();
      expect(view.getByTestId('thread-screen-header-pill').props.accessibilityLabel).toBe('Agent settings, Full access');
    } else {
      expect(warning).toBeNull();
    }
  });

  it('never marks the header for a backend without per-conversation permissions', () => {
    const view = render(<ThreadView {...createProps({ capabilities: { ...CAPABILITY_MATRIX.openclaw }, permissionMode: 'full-access' })} />);
    expect(view.queryByTestId('thread-screen-header-pill-warning')).toBeNull();
  });
  it('shows one actionable settings notice only while settings are unconfirmed and preserves the draft', () => {
    const onReviewRuntimeSettings = jest.fn();
    const props = createProps({ canSend: false, onReviewRuntimeSettings });
    const view = render(<ThreadView {...props} />);
    expect(view.getByText('Confirm settings before sending.')).toBeTruthy();
    fireEvent.press(view.getByTestId('thread-settings-unconfirmed-action'));
    expect(onReviewRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.onChangeInput).not.toHaveBeenCalled();
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityState.disabled).toBe(true);
    view.rerender(<ThreadView {...props} canSend onReviewRuntimeSettings={undefined} />);
    expect(view.queryByTestId('thread-settings-unconfirmed')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-primary').props.accessibilityState.disabled).toBe(false);
  });

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
    const palette = chatWallpaperPalettes.iceBlue[scheme];
    // A centred service pill over the wallpaper, Telegram style.
    expect(flattenStyle(label().props.style)).toMatchObject({ backgroundColor: palette.service, borderRadius: Radius.full, alignSelf: 'center' });
    expect(flattenStyle(within(label()).getByText('23:59').props.style)).toMatchObject({ color: palette.onService, textAlign: 'center' });
    act(() => jest.advanceTimersByTime(60_000));
    expect(within(label()).getByText('昨天 23:59')).toBeTruthy();
    view.rerender(<ThreadView {...props} locale="de" />);
    expect(within(label()).getByText('Gestern 23:59')).toBeTruthy();
    view.unmount();
  });

  it.each(['light', 'dark'] as const)('deep-renders canonical thread chrome in %s mode', (scheme) => {
    mockScheme = scheme;
    const props = createProps({
      topInset: Space.xl,
      bottomInset: Space.lg,
    });
    const view = render(<ThreadView {...props} />);
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);

    expect(flattenStyle(view.getByTestId('thread-screen').props.style)).toMatchObject({
      flex: 1,
      backgroundColor: theme.colors.canvas,
    });
    // The built-in wallpaper is on by default, so the header floats on glass.
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style)).toMatchObject({
      borderRadius: Radius.full,
      backgroundColor: resolveChatChromeAppearance(theme).backgroundColor,
    });
    expect(view.getByTestId('chat-background-layer-pattern')).toBeTruthy();
    // Idle reads "Online"; context left lives in the model sheet.
    expect(view.getByText('Online')).toBeTruthy();
    expect(view.queryByText('Context remaining: 54%')).toBeNull();
    expect(view.getByTestId('thread-markdown-message-1').props.markdownStyle.paragraph.fontSize)
      .toBe(FontSize.body);
    expect(view.getByTestId('thread-screen-timeline').props.inverted).toBeUndefined();
    // Chronological and top-anchored: a short conversation reads down from the
    // header; the list still opens on its newest row, clamped to the real end.
    const timeline = view.getByTestId('thread-screen-timeline');
    expect(timeline.props.maintainVisibleContentPosition).toBeUndefined();
    expect(timeline.props.initialScrollIndex).toBe(timeline.props.data.length - 1);
    expect(timeline.props.initialScrollIndexParams.viewOffset).toBeGreaterThan(100_000);
  });

  it.each(['light', 'dark'] as const)('updates manufacturer artwork and preserves model capability in %s mode', (scheme) => {
    mockScheme = scheme;
    const props = createProps({ model: 'openrouter/anthropic/claude-sonnet-4-6', onOpenModelPicker: jest.fn(), input: '' });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-model-icon').props.source).toBe(402);
    expect(view.getByTestId('thread-model-label').props.children).toBe('Sonnet 4.6');
    expect(view.getByTestId('thread-model-label').props.numberOfLines).toBe(1);
    expect(view.getByTestId('thread-model-picker').props.accessibilityLabel).toBe('Model settings: Sonnet 4.6');
    expect(view.getByTestId('thread-model-icon').props.accessible).toBe(false);
    fireEvent.press(view.getByTestId('thread-model-picker'));
    expect(props.onOpenModelPicker).toHaveBeenCalledTimes(1);
    // A draft keeps the room: only the model's mark stays in the chip.
    view.rerender(<ThreadView {...props} input="Hello" />);
    expect(view.queryByTestId('thread-model-label')).toBeNull();
    expect(view.getByTestId('thread-model-icon')).toBeTruthy();
    view.rerender(<ThreadView {...props} />);
    view.rerender(<ThreadView {...props} model="openai/gpt-5.4" modelDisplayName="GPT 5.4" />);
    expect(view.getByTestId('thread-model-label').props.children).toBe('GPT 5.4');
    expect(view.getByTestId('thread-model-icon').props.source).toBe(401);
    view.rerender(<ThreadView {...props} model="custom/private-model" />);
    expect(view.getByTestId('thread-model-icon').props.color).toBe(buildTheme(scheme, scheme, builtInAccents.iceBlue).colors.inkSecondary);
    view.rerender(<ThreadView {...props} capabilities={{ ...props.capabilities, models: false }} />);
    expect(view.queryByTestId('thread-model-picker')).toBeNull();
  });

  it('reads Online in the accent while idle and gives transient states priority', () => {
    const props = createProps({ onOpenModelPicker: jest.fn() });
    const view = render(<ThreadView {...props} />);
    const subtitle = () => view.getByTestId('thread-screen-header-pill-subtitle');
    expect(subtitle().props.children).toBe('Online');
    expect(flattenStyle(subtitle().props.style).color).not.toBe(buildTheme('light', 'light', builtInAccents.iceBlue).colors.inkSecondary);
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style).height).toBe(ControlSize.pill);
    view.rerender(<ThreadView {...props} isRunning />);
    expect(view.queryByText('Online')).toBeNull();
    expect(view.getByTestId('thread-screen-header-pill-working')).toBeTruthy();
    view.rerender(<ThreadView {...props} state={{ kind: 'reconnecting' }} />);
    expect(view.queryByText('Online')).toBeNull();
    expect(view.getByText('Reconnecting…')).toBeTruthy();
    view.rerender(<ThreadView {...props} state={{ kind: 'offline' }} />);
    expect(view.queryByText('Online')).toBeNull();
    view.rerender(<ThreadView {...props} />);
    expect(subtitle().props.children).toBe('Online');
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

  it('shows waiting for input without a thinking bubble or working animation', () => {
    const messages: UiMessage[] = [{ id: 'streaming', role: 'assistant', text: '', streaming: true }, { id: 'sent', role: 'user', text: 'Ask me' }];
    const view = render(<ThreadView {...createProps({ messages, isRunning: true, interactionAttention: 'input' })} />);
    expect(view.getByText('Agent needs your input')).toBeTruthy();
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
    expect(view.queryByTestId('thread-screen-header-pill-working')).toBeNull();
    expect(view.getByTestId('thread-message-sent')).toBeTruthy();
    view.rerender(<ThreadView {...createProps({ messages, isRunning: true, interactionAttention: null })} />);
    expect(view.getByTestId('thread-thinking-streaming')).toBeTruthy();
    expect(view.getByTestId('thread-screen-header-pill-working')).toBeTruthy();
  });

  it('keeps the reply present as a live pill from send until the first token', () => {
    const sent: UiMessage = { id: 'usr_1', role: 'user', text: 'Hello', timestampMs: Date.now() };
    const messageActions = { onCopy: jest.fn(), onToggleFavorite: jest.fn(), onShare: jest.fn() };
    const view = render(<ThreadView {...createProps({ messages: [sent], isRunning: true, activityLabel: null, input: '', messageActions })} />);
    // The placeholder shares the live stream id so the row never remounts; until
    // the first words it is a live pill (A+ chat design), not an empty bubble.
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Thinking…');
    expect(view.getByTestId('thread-thinking-streaming-busy')).toBeTruthy();
    expect(view.queryByTestId('thread-bubble-streaming')).toBeNull();
    // Nothing to copy or share yet, so the placeholder has no long-press menu while the sent turn keeps its own.
    expect(view.getByTestId('thread-message-streaming').props.onLongPress).toBeUndefined();
    expect(view.getByTestId('thread-message-usr_1').props.onLongPress).toBeDefined();
    // The header turns its ring and says it too, as the approved motion prototype does; no avatar badge.
    expect(view.getByTestId('thread-screen-header-pill-working')).toBeTruthy();
    expect(view.getByTestId('thread-screen-header-pill-subtitle').props.children).toBe('Thinking…');
    expect(view.queryByTestId('thread-screen-header-pill-avatar-working')).toBeNull();

    view.rerender(<ThreadView {...createProps({ messages: [sent], isRunning: true, activityLabel: 'Using exec…', input: '' })} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Using exec…');

    const streaming: UiMessage = { id: 'streaming', role: 'assistant', text: 'Partial **bo', streaming: true };
    view.rerender(<ThreadView {...createProps({ messages: [streaming, sent], isRunning: true, input: '' })} />);
    expect(view.queryByTestId('thread-thinking-streaming')).toBeNull();
    expect(view.getAllByTestId('thread-bubble-streaming')).toHaveLength(1);
    expect(view.getByTestId('thread-screen-header-pill-subtitle').props.children).toBe('Typing…');
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

  it.each([false, true])('says sending before the newest prompt is acknowledged (image-only: %s)', (imageOnly) => {
    const prompt: UiMessage = { id: 'pending-prompt', role: 'user', text: imageOnly ? '' : 'Hello',
      ...(imageOnly ? { imageUris: ['file:///qa.png'] } : {}) };
    const props = createProps({ messages: [prompt], input: '', isRunning: true,
      unconfirmedMessageIds: new Set([prompt.id]), runAcknowledged: false });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Sending…');
    view.rerender(<ThreadView {...props} runAcknowledged />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Thinking…');
  });

  it('keeps actual tool activity while a send acknowledgement is delayed', () => {
    const prompt: UiMessage = { id: 'pending-prompt', role: 'user', text: 'Hello' };
    const props = createProps({ messages: [prompt], input: '', isRunning: true,
      unconfirmedMessageIds: new Set([prompt.id]), activityLabel: 'Using exec…' });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Using exec…');
    view.rerender(<ThreadView {...props} activityLabel={null}
      messages={[{ id: 'tool', role: 'tool', text: 'Completed' }, prompt]} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Thinking…');
  });

  it('does not relabel recovered runs or a queued follow-up as sending', () => {
    const prompt: UiMessage = { id: 'accepted-prompt', role: 'user', text: 'Hello' };
    const props = createProps({ messages: [prompt], input: '', isRunning: true });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Thinking…');
    view.rerender(<ThreadView {...props}
      messages={[{ id: 'queued', role: 'user', text: 'Next', delivery: 'queued' }, prompt]}
      unconfirmedMessageIds={new Set(['queued'])} />);
    expect(view.getByTestId('thread-thinking-streaming')).toHaveTextContent('Thinking…');
  });

  it('slides a live pill\'s next step in from below, never its first', () => {
    const prompt: UiMessage = { id: 'accepted-prompt', role: 'user', text: 'Hello' };
    const props = createProps({ messages: [prompt], input: '', isRunning: true });
    const view = render(<ThreadView {...props} />);
    const step = () => view.getByTestId('thread-thinking-streaming-step');
    view.rerender(<ThreadView {...props} />);
    expect(step().props.entering).toBeUndefined();
    view.rerender(<ThreadView {...props} activityLabel="Using exec…" />);
    const entering = step().props.entering as () => { initialValues: unknown };
    expect(entering().initialValues).toEqual({ opacity: 0, transform: [{ translateY: Motion.step.rise }] });
    // A re-render on the same step, such as its elapsed time ticking, does not replay it.
    view.rerender(<ThreadView {...props} activityLabel="Using exec…" />);
    expect(step().props.entering).toBe(entering);
    // Reduced motion: the words fade in place and the spinner stands still.
    mockReducedMotion = true;
    view.rerender(<ThreadView {...props} activityLabel={null} />);
    expect(step().props.entering).toMatchObject({ name: 'FadeIn', durationMs: Motion.step.duration });
    expect(view.getByTestId('thread-thinking-streaming-busy').findAll((node) => String(node.type) === 'LoaderCircle')).toHaveLength(1);
  });

  it('turns send into a dimmed stop while the message is still leaving', () => {
    const onCancel = jest.fn();
    const prompt: UiMessage = { id: 'pending-prompt', role: 'user', text: 'Hello' };
    const props = createProps({ messages: [prompt], input: '', isRunning: false, sendInFlight: true, onCancel });
    const view = render(<ThreadView {...props} />);
    const primary = () => view.getByTestId('thread-screen-composer-primary');
    // No run to stop yet: Stop is already there, inert and dimmed, never a grey flash or the mic.
    expect(primary().props.accessibilityLabel).toBe('Stop');
    expect(primary().props.accessibilityState).toEqual({ disabled: true });
    expect(view.queryByTestId('thread-screen-composer-voice')).toBeNull();
    const surface = flattenStyle(view.getByTestId('thread-screen-composer-primary-surface').props.style);
    expect(surface.opacity).toBe(0.4);
    expect(surface.backgroundColor).toBe(buildTheme(mockScheme, mockScheme, builtInAccents.iceBlue).colors.ink);
    // The run starts: the same Stop becomes live.
    view.rerender(<ThreadView {...props} isRunning sendInFlight={false} />);
    expect(primary().props.accessibilityState).toEqual({ disabled: false });
    expect(flattenStyle(view.getByTestId('thread-screen-composer-primary-surface').props.style).opacity).toBe(1);
    fireEvent.press(primary());
    expect(onCancel).toHaveBeenCalledTimes(1);
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

  it.each(['android', 'ios'])('raises CJK words within the user’s bubble only on Android, leaving its clock in place on %s', (platform) => {
    const { Platform } = require('react-native');
    const previous = Platform.OS;
    Platform.OS = platform;
    try {
      const now = Date.now();
      const zh: UiMessage = { id: 'usr_zh', role: 'user', text: '在吗？', timestampMs: now };
      const en: UiMessage = { id: 'usr_en', role: 'user', text: 'Reply with one word: ok', timestampMs: now };
      const view = render(<ThreadView {...createProps({ messages: [en, zh] })} />);
      const words = (id: string, text: string) => flattenStyle(
        within(view.getByTestId(`thread-bubble-${id}`)).getByText(text, { exact: false }).props.style,
      );
      // Android CJK lines sit about 0.08 em low; iOS centers every line (device measure 2026-10-01).
      expect(words('usr_zh', '在吗？').transform)
        .toEqual(platform === 'android' ? [{ translateY: -FontSize.body * 0.08 }] : undefined);
      expect(words('usr_en', 'Reply with one word: ok').transform).toBeUndefined();
      expect(flattenStyle(view.getByTestId('thread-meta-usr_zh').props.style).transform).toBeUndefined();
      view.unmount();
    } finally { Platform.OS = previous; }
  });

  it('keeps hydrated scheduled results still and slides in only a digest that arrives while reading', () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    withTiming.mockClear();
    // The entrance is the only timing that drives a shared value to 1 over the normal duration
    // with the ease-out curve; the scroll button animates to 0 here and the header fade is shorter.
    const entranceCalls = () => withTiming.mock.calls.filter(isEntranceTiming);
    const now = new Date(new Date().setHours(12, 0, 0, 0)).getTime();
    const card = (id: string, updatedAt: number): ThreadRunCard => ({
      id, kind: 'cron', jobId: id, agentId: 'atlas', title: `Job ${id}`, status: 'succeeded',
      statusLabel: 'Succeeded', timeLabel: '11:00 AM', updatedAt,
    });
    const reply: UiMessage = { id: 'a0', role: 'assistant', text: 'Earlier', timestampMs: now - 3_600_000 };
    const view = render(<ThreadView {...createProps({ messages: [reply], runCards: [card('one', now - 5_400_000)] })} />);
    // Cache hydration lands with the first frame: full size, no offset, no timing.
    const hydrated = flattenStyle(view.getByTestId('thread-entrance-cron:one').props.style);
    expect(hydrated).toMatchObject({ opacity: 1, transform: [{ translateY: 0 }] });
    expect(entranceCalls()).toHaveLength(0);
    withTiming.mockClear();

    // A result after the reply starts a new digest, which slides in.
    view.rerender(<ThreadView {...createProps({ messages: [reply], runCards: [card('two', now - 60_000), card('one', now - 5_400_000)] })} />);
    expect(flattenStyle(view.getByTestId('thread-entrance-cron:two').props.style)).toMatchObject({ opacity: 1 });
    expect(entranceCalls()).toHaveLength(1);

    // The next result of the same day joins that digest as one more line.
    withTiming.mockClear();
    view.rerender(<ThreadView {...createProps({ messages: [reply], runCards: [
      card('three', now - 30_000), card('two', now - 60_000), card('one', now - 5_400_000),
    ] })} />);
    expect(view.getByTestId('thread-cron:two-run-three')).toBeTruthy();
    expect(view.queryByTestId('thread-entrance-cron:three')).toBeNull();
    expect(entranceCalls()).toHaveLength(0);

    // A burst is a reconciliation and lands still.
    view.rerender(<ThreadView {...createProps({ messages: [reply], runCards: [
      card('six', now - 1), card('five', now - 2), card('four', now - 3), card('three', now - 30_000),
      card('two', now - 60_000), card('one', now - 5_400_000),
    ] })} />);
    expect(entranceCalls()).toHaveLength(0);
  });

  it('arms an entrance only for rows that arrive at the tail after mount', () => {
    const older: UiMessage = { id: 'a0', role: 'assistant', text: 'Earlier' };
    const view = render(<ThreadView {...createProps({ messages: [older] })} />);
    expect(flattenStyle(view.getByTestId('thread-entrance-a0').props.style).opacity).toBe(1);

    const sent: UiMessage = { id: 'usr_2', role: 'user', text: 'New' };
    view.rerender(<ThreadView {...createProps({ messages: [sent, older], isRunning: true, input: '' })} />);
    // The new message is drawn at the start of its flight from its first frame (A+ motion),
    // never in place first; the reply placeholder and the history stay in full view.
    expect(flattenStyle(view.getByTestId('thread-entrance-usr_2').props.style).opacity).toBeCloseTo(Motion.send.startOpacity);
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
    expect(view.queryByTestId('thread-connection-unavailable')).toBeNull();
    expect(view.getByText('Ready to help.')).toBeTruthy();
    expect(view.getByTestId('thread-screen-offline')).toBeTruthy();
  });

  it.each(['openclaw', 'hermes'] as const)('keeps the already-read %s timeline during network loss without hiding new-scope or permission failures', (backend) => {
    const props = createProps({ capabilities: { ...CAPABILITY_MATRIX[backend] },
      connectionFailure: { scope: backend, name: 'Computer' }, sessionKey: 'read', onRetry: jest.fn() });
    const view = render(<ThreadView {...props} state={{ kind: 'ready' }} />);
    view.rerender(<ThreadView {...props} state={{ kind: 'error', code: 'network', message: 'Offline' }} />);
    expect(view.getByText('Ready to help.')).toBeTruthy();
    expect(view.queryByTestId('thread-connection-unavailable')).toBeNull();
    view.rerender(<ThreadView {...props} state={{ kind: 'error', code: 'pairing_expired', message: 'Pair again' }} />);
    expect(view.getByTestId('thread-connection-unavailable')).toBeTruthy();
    view.rerender(<ThreadView {...props} state={{ kind: 'offline' }} connectionFailure={{ scope: backend, name: 'Computer', message: 'Paused' }} />);
    expect(view.getByTestId('thread-connection-unavailable')).toBeTruthy();
    view.rerender(<ThreadView {...props} sessionKey="different" state={{ kind: 'offline' }} />);
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

  it.each([
    'Model authentication failed. Sign in again on your computer.',
    'The model account has insufficient credits or quota.',
    'The model is rate limited. Try again shortly.',
    "The agent couldn't complete this reply. Please try again.",
    'Session reset',
    'Context compacted',
  ])('localizes cold or cached fixed system notices without rewriting conversation text: %s', (text) => {
    const translated = `localized:${text}`;
    const translation = jest.spyOn(require('react-i18next'), 'useTranslation').mockReturnValue({
      t: (key: string) => key === text ? translated : key,
    });
    try {
      const messages: UiMessage[] = [
        { id: 'historical-user', role: 'user', text },
        { id: 'historical-assistant', role: 'assistant', text },
        { id: 'codex-turn-error:cold-native-turn', role: 'system', text },
        { id: 'ordinary-system', role: 'system', text: 'Connection restored' },
      ];
      const view = render(<ThreadView {...createProps({ messages })} />);
      expect(view.getAllByText(translated)).toHaveLength(1);
      expect(view.getByTestId('thread-markdown-historical-assistant').props.markdown).toBe(text);
      const userText = view.getByTestId('thread-bubble-historical-user')
        .findAllByType(require('react-native').Text)
        .find(node => Array.isArray(node.props.children) && node.props.children[0] === text);
      // The inline metadata spacer is another child; the message itself is exact.
      expect(userText?.props.children[0]).toBe(text);
      expect(view.getByText('Connection restored')).toBeTruthy();
      expect(messages[2]).toEqual({ id: 'codex-turn-error:cold-native-turn', role: 'system', text });
      view.unmount();
    } finally {
      translation.mockRestore();
    }
  });

  it.each(['ready', 'empty'] as const)('offers a local older-history retry without auto-looping or disturbing the %s composer', kind => {
    const onRetryHistory = jest.fn();
    const props = createProps({ state: { kind }, messages: kind === 'empty' ? [] : [{ id: 'current', role: 'user', text: 'Keep reading' }],
      historyLoadMoreError: true, onRetryHistory });
    const view = render(<ThreadView {...props} />);
    expect(view.getByTestId('thread-screen-history-error')).toBeTruthy();
    expect(view.getByText('Could not load older messages')).toBeTruthy();
    expect(view.getByTestId('thread-screen-timeline').props.onStartReached).toBeUndefined();
    fireEvent.press(view.getByTestId('thread-screen-history-error-action'));
    expect(onRetryHistory).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.onChangeInput).not.toHaveBeenCalled();
    view.rerender(<ThreadView {...props} historyLoadMoreError={false} />);
    expect(view.queryByTestId('thread-screen-history-error')).toBeNull();
    expect(view.getByTestId('thread-screen-timeline').props.onStartReached).toBe(props.onLoadMoreHistory);
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
    fireEvent.press(view.getByTestId('tools:tool-1'));
    fireEvent.press(view.getByTestId('thread-run-tool-1'));
    fireEvent.press(view.getByLabelText('Photo 1 of 1'));
    fireEvent.press(view.getByTestId('thread-approval-approval-1-primary'));
    fireEvent(view.getByTestId('thread-approval-approval-1-primary'), 'longPress');
    expect(onResolveApproval.mock.calls).toEqual([['request-1', 'allow-once']]);
    fireEvent.press(view.getByTestId('approval-always-confirm'));
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
    // Listening is the first dictation state; the microphone starts behind it without a preparing state.
    const view = render(<ThreadView {...createProps({ input: '', onVoice, voiceState: 'listening', voiceLevel: level })} />);
    expect(view.getByText('Listening…')).toBeTruthy();
    expect(view.queryByText('Preparing voice input…')).toBeNull();
    expect(view.getByTestId('thread-screen-composer-voice').props.accessibilityState.busy).toBe(false);

    view.rerender(<ThreadView {...createProps({ input: 'Dictated draft', onVoice, voiceState: 'listening', voiceLevel: level })} />);
    const input = view.getByTestId('thread-screen-composer-input', { includeHiddenElements: true });
    expect(view.getByText('Listening…')).toBeTruthy();
    expect(input.props.editable).toBe(false);
    expect(view.queryByTestId('thread-screen-composer-primary')).toBeNull();
    fireEvent.press(view.getByTestId('thread-screen-composer-voice-stop'));
    expect(onVoice).toHaveBeenCalledTimes(1);

    view.rerender(<ThreadView {...createProps({ input: 'Dictated draft', onVoice, voiceState: 'transcribing', voiceLevel: level })} />);
    expect(view.getByTestId('thread-screen-composer-voice').props.accessibilityState.busy).toBe(true);
    expect(view.queryByTestId('thread-screen-composer-voice-stop')).toBeNull();

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
    expect(allow.props.accessibilityState).toEqual({ disabled: false, busy: false });
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
    expect(timeline.props.maintainVisibleContentPosition).toBeUndefined();
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

  it.each(['drag', 'session', 'composer', 'unmount'])('cancels a pending layout correction on %s', (action) => {
    jest.useFakeTimers();
    const tool: UiMessage = { id: 'tool', role: 'tool', text: '', toolName: 'bash', toolStatus: 'success' };
    const props = createProps({ input: 'First\nSecond\nThird', messages: [tool, { ...tool, id: 'other-tool' }] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    fireEvent(timeline, 'load', { elapsedTimeInMs: 10 });
    mockScrollToEnd.mockClear();
    fireEvent(timeline, 'contentSizeChange', 400, 2000);
    if (action === 'drag') fireEvent(timeline, 'scrollBeginDrag');
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
    // Scheduled results read as digest messages from the Agent (A+ chat design),
    // one line per task with its own time; different days stay apart.
    expect(view.getByTestId('thread-cron:nightly-run-run-nightly-run').props.accessibilityLabel)
      .toBe('Nightly report, Failed, 11:00 PM');
    expect(view.getByTestId('thread-cron:hermes-digest-run-run-hermes-digest-run').props.accessibilityLabel)
      .toBe('Hermes digest, Succeeded, 10:55 AM');
    fireEvent.press(view.getByTestId('thread-cron:hermes-digest-run-run-hermes-digest-run'));
    expect(view.getByTestId('thread-run-result')).toBeTruthy();
    expect(view.getAllByTestId(/^thread-date:/)).toHaveLength(3);
    // A failed task says so in red after its name.
    expect(flattenStyle(view.getByText(' Failed').props.style))
      .toMatchObject({ color: buildTheme('light', 'light', builtInAccents.iceBlue).colors.bad });

    fireEvent.press(view.getByTestId('thread-subagent-run-agent:atlas:subagent:worker'));
    expect(onOpenRunSession).toHaveBeenCalledWith(
      'agent:atlas:subagent:worker',
      'atlas',
      'subagent',
    );

    // A Cron card with its run record opens the execution record, never a thread
    // (owner decision 2026-09-19); the record sheet decides whether a session opens.
    fireEvent.press(view.getByTestId('thread-cron:nightly-run-run-nightly-run'));
    expect(onOpenCronRun).toHaveBeenCalledWith(expect.objectContaining({
      id: 'nightly-run',
      cronRun: expect.objectContaining({ jobId: 'nightly' }),
    }));
    expect(onOpenRunSession).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByTestId('tools:tool-details'));
    fireEvent.press(view.getByTestId('thread-run-tool-details'));
    expect(view.getByTestId('thread-tool-detail').props.detail).toBe('package.json');
    expect(onOpenRunSession).toHaveBeenCalledTimes(1);

    // Logs hang under the failed digest; there is no Run again without the backend's run.
    fireEvent.press(view.getByTestId('thread-cron:nightly-run-logs'));
    expect(onOpenRunLogs).toHaveBeenCalledWith('nightly', 'atlas');
    expect(view.queryByTestId('thread-cron:nightly-run-rerun')).toBeNull();
  });

  it('merges a day\'s scheduled results into one digest and runs a failed task again from it', async () => {
    const onRerunCron = jest.fn<Promise<unknown>, [ThreadRunCard]>().mockResolvedValue(undefined);
    const day = new Date(2026, 8, 5).getTime();
    const run = (id: string, hour: number, status: ThreadRunCard['status']): ThreadRunCard => ({
      id, kind: 'cron', jobId: id, agentId: 'atlas', title: id, status, runnable: true,
      statusLabel: status === 'failed' ? 'Failed' : 'Succeeded', timeLabel: `${hour}:00`, updatedAt: day + hour * 3_600_000,
    });
    const view = render(<ThreadView {...createProps({
      messages: [{ id: 'reply', role: 'assistant', text: 'Morning', timestampMs: day + 6 * 3_600_000 }],
      runCards: [run('release-duty', 11, 'failed'), run('guard', 8, 'succeeded'), run('daily', 7, 'succeeded')],
      onRerunCron,
    })} />);
    const keys = view.getByTestId('thread-screen-timeline').props.data.map((row: { key: string }) => row.key);
    // Three results hours apart share one digest under one day label.
    expect(keys.filter((key: string) => key.startsWith('cron:'))).toEqual(['cron:daily']);
    expect(view.getByTestId('thread-cron:daily').props.children).toBeTruthy();
    expect(['daily', 'guard', 'release-duty'].map((id) => view.getByTestId(`thread-cron:daily-run-${id}`))).toHaveLength(3);
    expect(view.queryByTestId('thread-cron:daily-logs')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('thread-cron:daily-rerun')); });
    expect(onRerunCron).toHaveBeenCalledWith(expect.objectContaining({ id: 'release-duty' }));
    expect(view.getByTestId('thread-cron:daily-rerun').props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(view.getByText('Run started')).toBeTruthy();
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
      // A long press in the list belongs to the message actions; text is selected on the lifted clone.
      selectable: false,
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

  it('does not repeat the restored document name below its existing compact label', () => {
    const view = render(<ThreadView {...createProps({ messages: [{
      id: 'document-echo', role: 'user', text: 'Read this\n\n📎 notes.txt',
      fileAttachments: [{ fileName: 'notes.txt', mimeType: 'text/plain' }],
    }] })} />);
    expect(view.getByText(/^Read this/)).toBeTruthy();
    expect(view.queryByTestId('thread-file-document-echo-0')).toBeNull();
  });

  it('wires pending attachments, slash commands, favorites, and message actions', () => {
    const onOpenPendingAttachment = jest.fn();
    const onRemovePendingAttachment = jest.fn();
    const onPickImage = jest.fn();
    const onTakePhoto = jest.fn();
    const onChooseFile = jest.fn();
    const onSelectSlashCommand = jest.fn();
    const onDismissSlashSuggestions = jest.fn();
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

    // Thinking moved into the model sheet (A+ composer).
    expect(view.queryByTestId('thread-screen-thinking-level')).toBeNull();
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
    // Telegram style: the lifted message is where text can be selected.
    expect(clone.getByTestId(`thread-markdown-${message.id}`).props.selectable).toBe(true);
    expect(view.getByTestId(`thread-markdown-${message.id}`).props.selectable).toBe(false);
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
    expect(view.getByTestId('thread-held-usr_2_q1')).toHaveTextContent('Not sent · tap to review');
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

  it('renders earlier-history loading through the canonical skeleton once the reader scrolls', () => {
    const view = render(<ThreadView {...createProps({ loadingMoreHistory: true })} />);
    // A short conversation pages by itself on open; no placeholder pushes its rows around.
    expect(view.queryByTestId('thread-screen-history-more')).toBeNull();
    act(() => { view.getByTestId('thread-screen-timeline').props.onScrollBeginDrag?.(); });
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
    expect(view.queryByTestId('thread-approval-approval-deadline-primary')).toBeNull();
    expect(view.queryByTestId('thread-approval-approval-deadline-secondary')).toBeNull();
  });

  it('keeps settled exec approvals as compact records without actions', () => {
    const settled = (id: string, status: 'allowed' | 'denied'): UiMessage => ({
      id,
      role: 'tool',
      text: '',
      approval: {
        id: `${id}-request`,
        command: `echo ${id}`,
        reason: 'Needed to verify the build',
        expiresAtMs: null,
        status,
      },
    });
    const view = render(<ThreadView {...createProps({
      messages: [settled('approval-allowed', 'allowed'), settled('approval-denied', 'denied')],
      onResolveApproval: jest.fn(),
    })} />);

    expect(view.getByText('Allowed')).toBeTruthy();
    expect(view.getByText('Denied')).toBeTruthy();
    expect(view.getByText('echo approval-allowed')).toBeTruthy();
    expect(view.queryByText('Needed to verify the build')).toBeNull();
    for (const id of ['approval-allowed', 'approval-denied']) {
      expect(view.getByTestId(`thread-approval-${id}`).props.accessibilityState).toEqual({ disabled: true });
      expect(view.queryByTestId(`thread-approval-${id}-primary`)).toBeNull();
      expect(view.queryByTestId(`thread-approval-${id}-secondary`)).toBeNull();
    }
  });

  it('does not invent a deadline for a backend-managed approval', () => {
    jest.useFakeTimers();
    const view = render(<ThreadView {...createProps({ messages: [{ id: 'approval-native', role: 'tool', text: '',
      approval: { id: 'approval-native', command: 'test', expiresAtMs: null, status: 'pending' } }] })} />);
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(view.getByTestId('thread-approval-approval-native').props.accessibilityState).toEqual({ disabled: false });
    expect(view.queryByText('Expired')).toBeNull();
  });

  it.each(['openclaw', 'hermes'] as const)('confirms permanent approval and discards stale consent for %s', (backend) => {
    const resolve = jest.fn();
    const approval: Exclude<NonNullable<UiMessage['approval']>, { kind: 'pair' }> = {
      id: 'first-request', command: 'npm test', expiresAtMs: null, status: 'pending',
      decisions: ['allow-once', 'allow-always', 'deny'],
    };
    const message: UiMessage = { id: 'consent', role: 'tool', text: '', approval };
    const props = createProps({ capabilities: { ...CAPABILITY_MATRIX[backend], execApproval: true },
      messages: [message], onResolveApproval: resolve });
    const view = render(<ThreadView {...props} />);
    const open = () => fireEvent(view.getByTestId('thread-approval-consent-primary'), 'longPress');
    open();
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('approval-always-cancel'));
    expect(view.queryByTestId('approval-always-confirm')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    open();
    view.rerender(<ThreadView {...props} messages={[{ ...message,
      approval: { ...approval, id: 'replacement-request' } }]} />);
    expect(view.queryByTestId('approval-always-confirm')).toBeNull();
    open();
    view.rerender(<ThreadView {...props} messages={[{ ...message,
      approval: { ...approval, id: 'replacement-request', status: 'allowed' } }]} />);
    expect(view.queryByTestId('approval-always-confirm')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    view.rerender(<ThreadView {...props} messages={[{ ...message,
      approval: { ...approval, decisions: ['allow-once', 'deny'] } }]} />);
    expect(view.getByTestId('thread-approval-consent-primary').props.onLongPress).toBeUndefined();
  });
});

it('folds tool activity into one pill that opens the turn work record and each step\'s full details', () => {
  const prompt: UiMessage = { id: 'ask', role: 'user', text: 'Check the repo' };
  const first: UiMessage = { id: 'a', role: 'tool', text: '', toolName: 'bash', toolArgs: JSON.stringify({ command: 'git status' }), toolStatus: 'success' };
  const second: UiMessage = { ...first, id: 'b', toolArgs: JSON.stringify({ command: 'git log' }), toolStatus: 'running' };
  const props = createProps({ messages: [second, first, prompt] });
  const view = render(<ThreadView {...props} />);
  const timeline = () => view.getByTestId('thread-screen-timeline');
  // One live pill for the running step; the calls themselves stay off the timeline.
  expect(timeline().props.data.map((item: any) => item.key)).toEqual(['message:ask', 'tools:a']);
  expect(view.getByTestId('tools:a-busy')).toBeTruthy();
  expect(view.getByText('git log')).toBeTruthy();
  expect(view.queryByTestId('thread-run-a')).toBeNull();
  mockScrollToEnd.mockClear();

  fireEvent.press(view.getByTestId('tools:a'));
  expect(view.getByTestId('work-record-sheet').props.title).toBe('Work record');
  expect(view.getByTestId('thread-run-a')).toBeTruthy();
  expect(view.getByTestId('thread-run-b')).toBeTruthy();
  expect(mockScrollToEnd).not.toHaveBeenCalled();

  // The record follows the turn through updates: finished steps, new calls, a replaced id.
  view.rerender(<ThreadView {...props} messages={[{ ...first, id: 'c' }, { ...second, toolStatus: 'success' }, first, prompt]} />);
  expect(timeline().props.data.map((item: any) => item.key)).toEqual(['message:ask', 'tools:a']);
  expect(view.getByText('Ran 3 commands')).toBeTruthy();
  expect(view.getByTestId('work-record-sheet')).toBeTruthy();
  expect(view.getByTestId('thread-run-c')).toBeTruthy();
  fireEvent.press(view.getByTestId('thread-run-a'));
  expect(view.getByTestId('thread-tool-detail').props).toMatchObject({
    args: JSON.stringify({ command: 'git status' }),
    stackBehavior: 'push',
  });
});

it('gives a failed call its own red pill and keeps it in the work record', () => {
  const prompt: UiMessage = { id: 'ask', role: 'user', text: 'Check CI' };
  const ok: UiMessage = { id: 'a', role: 'tool', text: '', toolName: 'exec', toolArgs: JSON.stringify({ command: 'gh pr view 50' }), toolStatus: 'success' };
  const failed: UiMessage = { ...ok, id: 'b', toolArgs: JSON.stringify({ command: 'gh pr checks 50' }), toolStatus: 'error' };
  const view = render(<ThreadView {...createProps({ messages: [failed, ok, prompt] })} />);
  expect(view.getByTestId('thread-screen-timeline').props.data.map((item: any) => item.key))
    .toEqual(['message:ask', 'tools:a', 'tools:b']);
  expect(view.getByTestId('tools:b').props.accessibilityLabel).toBe('gh pr checks 50 failed');
  fireEvent.press(view.getByTestId('tools:b'));
  expect(view.getByTestId('thread-run-a')).toBeTruthy();
  expect(view.getByTestId('thread-run-b').props.accessibilityLabel).toContain('Failed');
});

it('uses a human title for a new session whose backend title is only its internal key', () => {
  const key = 'agent:main:dashboard:new-session';
  const view = render(<ThreadView {...createProps({ sessionKey: key, sessionTitle: key, isMainSession: false })} />);
  expect(view.getByText('Atlas · New session')).toBeTruthy();
  expect(view.queryByText(key)).toBeNull();
});

it('names a scheduled run with the localized kind instead of the Gateway prefix', () => {
  const key = 'agent:atlas:cron:nightly';
  const view = render(<ThreadView {...createProps({ sessionKey: key, sessionTitle: 'Automation: Nightly digest', isMainSession: false })} />);
  expect(view.getByText('Atlas · Scheduled task: Nightly digest')).toBeTruthy();
  view.rerender(<ThreadView {...createProps({ sessionKey: key, sessionTitle: key, isMainSession: false })} />);
  expect(view.getByText('Atlas · Scheduled task')).toBeTruthy();
  expect(view.queryByText(/Automation|New session/)).toBeNull();
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
  it('keeps the live pill when a reply that showed no words completes before the pacer publishes it', () => {
    const streaming: UiMessage = { id: 'streaming', renderKey: 'reply:1000:0', role: 'assistant', text: '', timestampMs: 1000, streaming: true };
    mockPacedText = '';
    const view = render(<ThreadView {...createProps({ messages: [streaming], isRunning: true })} />);
    expect(view.getByTestId('thread-thinking-streaming')).toBeTruthy();
    // The whole reply arrives with the run's end and is published a commit later:
    // never an empty bubble with its clock and tail in between.
    const final: UiMessage = { ...streaming, id: 'final_run', text: 'Done', streaming: false };
    view.rerender(<ThreadView {...createProps({ messages: [final] })} />);
    expect(view.getByTestId('thread-thinking-final_run')).toBeTruthy();
    expect(view.queryByTestId('thread-bubble-final_run')).toBeNull();
    mockPacedText = undefined;
    view.rerender(<ThreadView {...createProps({ messages: [final] })} />);
    expect(view.queryByTestId('thread-thinking-final_run')).toBeNull();
    expect(view.getByTestId('thread-markdown-final_run').props.markdown).toBe('Done');
  });

  it('keeps the live pill clock on the turn start it first saw when a history echo corrects the prompt time', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-01T08:00:12.000Z'));
    try {
      const sent: UiMessage = { id: 'usr_1', renderKey: 'send:1', role: 'user', text: 'Hello', timestampMs: Date.parse('2026-10-01T08:00:00.000Z') };
      const view = render(<ThreadView {...createProps({ messages: [sent], isRunning: true, input: '' })} />);
      const label = () => view.getByTestId('thread-thinking-streaming').props.accessibilityLabel as string;
      const before = label();
      expect(before).toContain(', ');
      // The echo keeps the row identity but carries the computer's clock, 10 s behind the phone.
      const echoed: UiMessage = { ...sent, id: 'history-1', timestampMs: sent.timestampMs! - 10_000 };
      view.rerender(<ThreadView {...createProps({ messages: [echoed], isRunning: true, input: '' })} />);
      expect(label()).toBe(before);
    } finally {
      jest.useRealTimers();
    }
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
    background: { ...DEFAULT_CHAT_APPEARANCE.background, kind: 'photo', enabled: true, imagePath: 'file:///documents/chat-appearance/background.jpg', blur: 4, dim: 0.2 },
  });
  const plain = (): ThreadViewProps['chatAppearance'] => ({
    ...DEFAULT_CHAT_APPEARANCE,
    background: { ...DEFAULT_CHAT_APPEARANCE.background, kind: 'plain' },
  });

  it('draws the built-in wallpaper by default and melts the scrims into its own colors', () => {
    jest.useFakeTimers();
    const view = render(<ThreadView {...createProps({ topInset: Space.xl })} />);
    const palette = chatWallpaperPalettes.iceBlue[scheme];
    expect(view.getByTestId('chat-background-layer-pattern')).toBeTruthy();
    const stops = (testID: string) => view.getByTestId(testID).findAll((node) => (node.type as unknown) === 'Stop')
      .map((node) => node.props.stopColor);
    // At rest the scrims fade from the wallpaper's colors at the screen's top and bottom.
    const rest = chatWallpaperDriftScrims(palette, [0, 0], 852 / 393);
    expect(new Set(stops('thread-screen-header-scrim'))).toEqual(new Set([rest.top]));
    expect(new Set(stops('thread-screen-composer-scrim'))).toEqual(new Set([rest.bottom]));
    // A send drifts the wallpaper one step: the scrims head for the colors of the next window.
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    expect(view.getByTestId('chat-background-layer-pattern-gradient')).toBeTruthy();
    const next = chatWallpaperDriftScrims(palette, [0.45, 0.35], 852 / 393);
    expect(next.top).not.toBe(rest.top);
    act(() => jest.advanceTimersByTime(700));
    expect(new Set(stops('thread-screen-header-scrim'))).toEqual(new Set([next.top]));
    expect(new Set(stops('thread-screen-composer-scrim'))).toEqual(new Set([next.bottom]));
    const glass = resolveChatChromeAppearance(theme());
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style).backgroundColor).toBe(glass.backgroundColor);
    // One row (A+): the capsule and both circles float on glass, the row itself stays clear.
    expect(flattenStyle(view.getByTestId('thread-screen-composer').props.style).backgroundColor).toBeUndefined();
    expect(flattenStyle(view.getByTestId('thread-screen-composer-capsule').props.style).backgroundColor).toBe(glass.backgroundColor);
    expect(flattenStyle(view.getByTestId('thread-screen-composer-add-surface').props.style).backgroundColor).toBe(glass.backgroundColor);
  });

  it('floats the header over the timeline and keeps the canvas chrome on the plain canvas', () => {
    const view = render(<ThreadView {...createProps({ topInset: Space.xl, chatAppearance: plain() })} />);
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
    // Plain header icons like the roster's (owner decision 2026-09-27); glass stays for wallpapers.
    expect(flattenStyle(view.getByTestId('thread-screen-back').props.style).backgroundColor).toBe('transparent');
    expect(flattenStyle(view.getByTestId('thread-screen-sessions').props.style).backgroundColor).toBe('transparent');
    expect(flattenStyle(view.getByTestId('thread-screen-header-pill').props.style).backgroundColor).toBe(theme().colors.surface);
    expect(flattenStyle(view.getByTestId('thread-screen-composer-region').props.style).backgroundColor).toBe(theme().colors.canvas);
    expect(view.queryByTestId('thread-screen-composer-scrim')).toBeNull();
    expect(flattenStyle(view.getByTestId('thread-screen-composer-capsule').props.style).backgroundColor).toBe(theme().colors.surface);
    expect(flattenStyle(view.getByTestId('thread-screen-composer-add-surface').props.style).backgroundColor).toBe(theme().colors.surface);
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
    // Over a photo a pill carries its own dark backing.
    expect(flattenStyle(view.getByTestId('thread-date:message:timed').props.style).backgroundColor).toBe(CHAT_PHOTO_SERVICE.service);

    const region = flattenStyle(view.getByTestId('thread-screen-composer-region').props.style);
    expect(region.backgroundColor).toBeUndefined();
    expect(view.getByTestId('thread-screen-composer-scrim')).toBeTruthy();
    expect(flattenStyle(view.getByTestId('thread-screen-composer-capsule').props.style)).toMatchObject({
      borderRadius: Radius.xl, backgroundColor: glass.backgroundColor, borderColor: glass.borderColor,
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


it('renders channel participants on the incoming side without delivery ticks and groups only the same person', () => {
  const attribution = { channel: 'slack', accountId: 'workspace', sender: { id: 'alice', name: 'Alice' } };
  const view = render(<ThreadView {...createProps({ messages: [
    { id: 'own', role: 'user', text: 'Mine', sentLocally: true, timestampMs: 105000 },
    { id: 'reply', role: 'assistant', text: 'Reply', timestampMs: 104000 },
    { id: 'bob', role: 'user', text: 'Hello', timestampMs: 103000,
      attribution: { ...attribution, sender: { id: 'bob', name: 'Bob' } } },
    { id: 'alice-2', role: 'user', text: 'Again', timestampMs: 102000, attribution },
    { id: 'alice-1', role: 'user', text: 'Hello', timestampMs: 101000, attribution,
      imageUris: ['https://example.com/photo.png'] },
  ] })} />);
  expect(view.getByTestId('thread-sender-alice-1')).toBeTruthy();
  expect(view.queryByTestId('thread-sender-alice-2')).toBeNull();
  expect(view.getByTestId('thread-sender-bob')).toBeTruthy();
  expect(flattenStyle(view.getByTestId('thread-bubble-alice-1').props.style).alignSelf).toBe('flex-start');
  expect(flattenStyle(view.getByTestId('thread-bubble-own').props.style).alignSelf).toBe('flex-end');
  expect(view.queryByTestId('thread-meta-alice-1-status')).toBeNull();
  expect(view.queryByTestId('thread-meta-bob-status')).toBeNull();
  expect(view.getByTestId('thread-meta-own-status')).toBeTruthy();
});

it('keeps a legible sender when a remote avatar fails and uses a platform ID without a name', () => {
  const { ParticipantIdentity } = require('../../components/chat/ParticipantIdentity');
  const { Image } = require('react-native');
  const view = render(<ParticipantIdentity attribution={{ channel: 'slack', sender: {
    id: 'U123', avatarUrl: 'https://cdn.example.com/avatar.png',
  } }} />);
  expect(view.getByLabelText('U123 · Slack · U123')).toBeTruthy();
  expect(view.getByText('U')).toBeTruthy();
  fireEvent(view.UNSAFE_getByType(Image), 'error', { nativeEvent: { error: 'unavailable' } });
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
  expect(view.getByLabelText('U123 · Slack · U123')).toBeTruthy();
  expect(view.getByText('U')).toBeTruthy();
});


it.each(['light', 'dark'] as const)('distinguishes participants from the Agent in %s without recoloring bubbles', scheme => {
  mockScheme = scheme;
  const { participantAvatarColors } = require('../../components/chat/ParticipantIdentity');
  const attribution = { channel: 'slack', accountId: 'workspace', sender: { id: 'alice', name: 'Alice' } };
  const palette = participantAvatarColors(attribution, scheme);
  expect(participantAvatarColors({ ...attribution, sender: { ...attribution.sender, name: 'Renamed' } }, scheme)).toEqual(palette);
  const view = render(<ThreadView {...createProps({ showAgentAvatar: false, messages: [
    { id: 'reply', role: 'assistant', text: 'Reply', timestampMs: 102000 },
    { id: 'alice', role: 'user', text: 'Hello', timestampMs: 101000, attribution },
  ] })} />);
  const colors = buildTheme(scheme, scheme, builtInAccents.iceBlue).colors;
  expect(view.getByTestId('chat-agent-role')).toBeTruthy();
  expect(flattenStyle(view.getByTestId('chat-agent-role').props.style).backgroundColor).toBe(colors.accentSoft);
  // A participant speaks on the same incoming bubble as the Agent.
  expect(flattenStyle(view.getByTestId('thread-bubble-alice').props.style).backgroundColor)
    .toBe(chatWallpaperPalettes.iceBlue[scheme].incoming);
  expect(flattenStyle(view.getByTestId('thread-bubble-reply').props.style).backgroundColor)
    .toBe(chatWallpaperPalettes.iceBlue[scheme].incoming);
  expect(flattenStyle(view.getByText('A').props.style).color).toBe(palette.color);
  view.rerender(<ThreadView {...createProps({ showAgentAvatar: true, messages: [
    { id: 'reply', role: 'assistant', text: 'Reply', timestampMs: 102000 },
  ] })} />);
  expect(view.queryByTestId('chat-agent-role')).toBeNull();
});

describe('messenger timeline layout', () => {
  const entranceCalls = () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    return withTiming.mock.calls.filter(isEntranceTiming);
  };
  const frameOpacity = (view: ReturnType<typeof render>) => (
    flattenStyle(view.getByTestId('thread-screen-timeline-frame').props.style).opacity
  );

  beforeEach(() => {
    mockListLayout.content = 0;
    mockListLayout.viewport = 0;
    mockScrollToEnd.mockClear();
    mockReducedMotion = false;
    for (const method of Object.values(mockUiFollow)) method.mockClear();
    mockUiFollow.bind.mockImplementation(() => true);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps one list from the empty conversation through its first message, which enters like any sent message', () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    const props = createProps({ state: { kind: 'empty' }, messages: [], input: '' });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    expect(timeline.props.data).toEqual([]);
    expect(timeline.props.initialScrollIndex).toBeUndefined();
    expect(frameOpacity(view)).toBe(1);
    const hint = view.getByTestId('thread-screen-empty');
    expect(hint.props.pointerEvents).toBe('none');
    expect(hint.props.exiting).toMatchObject({ name: 'FadeOut', durationMs: Motion.duration.fast });

    withTiming.mockClear();
    const sent: UiMessage = { id: 'usr_1', renderKey: 'usr_1', role: 'user', text: '滴', timestampMs: Date.now() };
    view.rerender(<ThreadView {...props} state={{ kind: 'ready' }} messages={[sent]} />);
    expect(view.getByTestId('thread-screen-timeline')).toBe(timeline);
    expect(view.queryByTestId('thread-screen-empty')).toBeNull();
    expect(view.getByTestId('thread-bubble-usr_1')).toBeTruthy();
    expect(frameOpacity(view)).toBe(1);
    expect(entranceCalls()).toHaveLength(1);
  });

  it('never slides in history that loads into a list that was still loading', () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    const view = render(<ThreadView {...createProps({ state: { kind: 'ready' }, messages: [] })} />);
    withTiming.mockClear();
    view.rerender(<ThreadView {...createProps({ messages: [{ id: 'h1', role: 'assistant', text: 'Earlier' }] })} />);
    expect(entranceCalls()).toHaveLength(0);
  });

  it('drops the empty hint without a fade under reduced motion', () => {
    mockReducedMotion = true;
    const view = render(<ThreadView {...createProps({ state: { kind: 'empty' }, messages: [] })} />);
    expect(view.getByTestId('thread-screen-empty').props.exiting).toBeUndefined();
  });

  const revealFades = () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    return withTiming.mock.calls.filter(([value, config]) => {
      const timing = config as { duration?: number; easing?: { value?: unknown } } | undefined;
      return value === 1 && timing?.duration === Motion.duration.normal && timing.easing?.value === 'quad';
    });
  };

  it('opens saved history hidden until its first load settles, then fades it in complete', () => {
    jest.useFakeTimers();
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    withTiming.mockClear();
    const view = render(<ThreadView {...createProps()} />);
    expect(frameOpacity(view)).toBe(0);
    fireEvent(view.getByTestId('thread-screen-timeline'), 'load', { elapsedTimeInMs: 5 });
    expect(frameOpacity(view)).toBe(0);
    expect(revealFades()).toHaveLength(0);
    act(() => jest.advanceTimersByTime(20));
    expect(frameOpacity(view)).toBe(1);
    expect(revealFades()).toEqual([[1, { duration: Motion.duration.normal, easing: { kind: 'out', value: 'quad' } }]]);
    // A later reply never hides the list again.
    view.rerender(<ThreadView {...createProps({ messages: [
      { id: 'message-2', role: 'assistant', text: 'More' },
      { id: 'message-1', role: 'assistant', text: 'Ready to help.' },
    ] })} />);
    expect(frameOpacity(view)).toBe(1);
    expect(revealFades()).toHaveLength(1);
  });

  it('reveals saved history even when the list never reports its load, at once under reduced motion', () => {
    jest.useFakeTimers();
    mockReducedMotion = true;
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    withTiming.mockClear();
    const view = render(<ThreadView {...createProps()} />);
    expect(frameOpacity(view)).toBe(0);
    act(() => jest.advanceTimersByTime(400));
    expect(frameOpacity(view)).toBe(1);
    expect(revealFades()).toHaveLength(0);
  });

  it('holds the composer at the sent draft height until the list lays out the sent row', () => {
    jest.useFakeTimers();
    const { Composer } = require('../../components/ui/Composer');
    const props = createProps({ input: 'Line one\nLine two' });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    const held = () => view.UNSAFE_getByType(Composer).props.holdHeight;
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    expect(props.onSend).toHaveBeenCalledTimes(1);
    const sent: UiMessage = { id: 'usr_sent', role: 'user', text: 'Line one\nLine two', timestampMs: Date.now() };
    view.rerender(<ThreadView {...props} input="" messages={[sent, ...props.messages]} />);
    expect(held()).toBe(true);
    // FlashList positions the new row in a later commit; the composer shrinks in that one.
    act(() => timeline.props.onCommitLayoutEffect());
    expect(held()).toBe(true);
    mockListLayout.content = 1010;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(held()).toBe(false);

    // A send whose row never lands in the measured list still lets the composer shrink.
    view.rerender(<ThreadView {...props} input="Again" messages={[sent, ...props.messages]} />);
    fireEvent.press(view.getByTestId('thread-screen-composer-primary'));
    expect(held()).toBe(true);
    act(() => jest.advanceTimersByTime(320));
    expect(held()).toBe(false);
  });

  it('pins the newest row in the same layout commit while the reader follows, never while reading history', () => {
    jest.useFakeTimers();
    const view = render(<ThreadView {...createProps()} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    // FlashList places the list itself until it has loaded.
    act(() => timeline.props.onCommitLayoutEffect());
    mockListLayout.content = 940;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    mockListLayout.content = 1010;
    act(() => timeline.props.onCommitLayoutEffect());
    // Synchronously, in the commit that grew the rows: no frame to wait for.
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    // A keyboard or composer that shrinks the viewport keeps the newest row in view.
    mockListLayout.viewport = 320;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);

    fireEvent(timeline, 'scrollBeginDrag');
    fireEvent.scroll(timeline, scrollEvent(800));
    mockListLayout.content = 1400;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);

    // Estimated row heights shrinking must not pull a reader back to the end.
    fireEvent.scroll(timeline, scrollEvent(40));
    mockListLayout.content = 1300;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
    act(() => jest.advanceTimersByTime(20));
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
  });

  it.each(['openclaw', 'hermes', 'claude-code'] as const)(
    'keeps a history drag and momentum authoritative as virtual row estimates change (%s)', (backend) => {
      jest.useFakeTimers();
      const view = render(<ThreadView {...createProps({ capabilities: CAPABILITY_MATRIX[backend] })} />);
      const timeline = view.getByTestId('thread-screen-timeline');
      mockListLayout.content = 20_000;
      mockListLayout.viewport = 600;
      act(() => timeline.props.onCommitLayoutEffect());
      fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
      const position = (height: number, remaining: number) => ({ nativeEvent: {
        contentSize: { height, width: 393 }, layoutMeasurement: { height: 600, width: 393 },
        contentOffset: { x: 0, y: height - 600 - remaining },
      } });
      // The first finger movement is still inside the old bottom-follow threshold.
      fireEvent(timeline, 'scrollBeginDrag');
      fireEvent.scroll(timeline, position(20_000, 15));
      mockListLayout.content = 20_600;
      act(() => timeline.props.onCommitLayoutEffect());
      expect(mockScrollToEnd).not.toHaveBeenCalled();
      // The real device re-estimated thousands of points while only 1,166 away.
      fireEvent.scroll(timeline, position(20_600, 1_166));
      mockListLayout.content = 17_600;
      act(() => timeline.props.onCommitLayoutEffect());
      expect(mockScrollToEnd).not.toHaveBeenCalled();
      fireEvent(timeline, 'scrollEndDrag', position(17_600, 900));
      fireEvent(timeline, 'momentumScrollBegin');
      act(() => jest.advanceTimersByTime(200));
      mockListLayout.content = 15_000;
      act(() => timeline.props.onCommitLayoutEffect());
      expect(mockScrollToEnd).not.toHaveBeenCalled();
      fireEvent(timeline, 'momentumScrollEnd', position(15_000, 1_200));
      // A late measurement and earlier-history prepend preserve the resting reader too.
      mockListLayout.content = 12_000;
      act(() => timeline.props.onCommitLayoutEffect());
      mockListLayout.content = 24_000;
      act(() => timeline.props.onCommitLayoutEffect());
      fireEvent(timeline, 'contentSizeChange', 393, 24_000);
      act(() => jest.advanceTimersByTime(200));
      expect(mockScrollToEnd).not.toHaveBeenCalled();
      expect(view.getByTestId('thread-screen-scroll-to-bottom-container').props.pointerEvents).toBe('auto');
    },
  );

  it('resumes following only after a slow drag settles at the end, and cancels settling on another drag', () => {
    jest.useFakeTimers();
    const view = render(<ThreadView {...createProps()} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 2000;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    fireEvent(timeline, 'scrollBeginDrag');
    fireEvent(timeline, 'scrollEndDrag', scrollEvent(0));
    act(() => jest.advanceTimersByTime(200));
    mockListLayout.content = 2050;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    mockScrollToEnd.mockClear();
    fireEvent(timeline, 'scrollBeginDrag');
    fireEvent(timeline, 'scrollEndDrag', scrollEvent(0));
    fireEvent(timeline, 'scrollBeginDrag');
    act(() => jest.advanceTimersByTime(200));
    mockListLayout.content = 2100;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    fireEvent(timeline, 'scrollEndDrag', scrollEvent(300));
    view.rerender(<ThreadView {...createProps({ sessionKey: 'another-session' })} />);
    act(() => jest.advanceTimersByTime(200));
    act(() => view.getByTestId('thread-screen-timeline').props.onCommitLayoutEffect());
    fireEvent(view.getByTestId('thread-screen-timeline'), 'load', { elapsedTimeInMs: 5 });
    mockListLayout.content = 2200;
    act(() => view.getByTestId('thread-screen-timeline').props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('glides a new row into view while following, and keeps the exact end for growth, the keyboard and big bursts', () => {
    jest.useFakeTimers();
    const buttonVisible = (view: ReturnType<typeof render>) => view.getByTestId('thread-screen-scroll-to-bottom-container', { includeHiddenElements: true }).props.pointerEvents === 'auto';
    const first: UiMessage = { id: 'm1', role: 'assistant', text: 'One' };
    const props = createProps({ messages: [first] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });

    // The send's own scroll request leaves the pinning to the commit that adds the row.
    const sent: UiMessage = { id: 'usr_2', renderKey: 'usr_2', role: 'user', text: 'Two' };
    view.rerender(<ThreadView {...props} messages={[sent, first]} scrollToBottomRequestAt={1} />);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    mockListLayout.content = 980;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: true });
    // Growth during the glide re-targets it, and its scroll events never reveal the return action.
    mockListLayout.content = 1004;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: true });
    fireEvent.scroll(timeline, scrollEvent(300));
    expect(buttonVisible(view)).toBe(false);
    // So does a composer that shrinks right after the send.
    mockListLayout.viewport = 560;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: true });

    // Once settled, a growing reply keeps the exact end.
    act(() => jest.advanceTimersByTime(500));
    mockListLayout.content = 1030;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });

    // A new row that arrives with a keyboard change snaps with the viewport.
    const third: UiMessage = { id: 'm3', role: 'assistant', text: 'Three' };
    view.rerender(<ThreadView {...props} messages={[third, sent, first]} />);
    mockListLayout.content = 1090;
    mockListLayout.viewport = 320;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });

    // A burst taller than the glide budget snaps.
    const fourth: UiMessage = { id: 'm4', role: 'assistant', text: 'Four' };
    view.rerender(<ThreadView {...props} messages={[fourth, third, sent, first]} />);
    mockListLayout.content = 1500;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  });

  it('never glides under reduced motion', () => {
    mockReducedMotion = true;
    const first: UiMessage = { id: 'm1', role: 'assistant', text: 'One' };
    const props = createProps({ messages: [first] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    view.rerender(<ThreadView {...props} messages={[{ id: 'm2', role: 'assistant', text: 'Two' }, first]} />);
    mockListLayout.content = 960;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  });

  const onPlatform = (platform: 'ios' | 'android', run: () => void) => {
    const { Platform } = require('react-native');
    const previous = Platform.OS;
    Platform.OS = platform;
    try { run(); } finally { Platform.OS = previous; }
  };
  const layoutEvent = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height } } });

  it('keeps an iOS glide going when its row reports its size, and jumps for a moved viewport', () => {
    jest.useFakeTimers();
    const first: UiMessage = { id: 'm1', role: 'assistant', text: 'One' };
    const props = createProps({ messages: [first] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    expect(mockUiFollow.bind).not.toHaveBeenCalled();
    fireEvent(timeline, 'layout', layoutEvent(600));
    fireEvent(timeline, 'contentSizeChange', 393, 900);
    act(() => jest.advanceTimersByTime(20));
    mockScrollToEnd.mockClear();

    const second: UiMessage = { id: 'm2', role: 'assistant', text: 'Two' };
    view.rerender(<ThreadView {...props} messages={[second, first]} />);
    mockListLayout.content = 980;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: true });
    // The native size report that follows the row re-targets the glide instead of cutting it short.
    fireEvent(timeline, 'contentSizeChange', 393, 980);
    act(() => jest.advanceTimersByTime(20));
    expect(mockScrollToEnd.mock.calls).toEqual([[{ animated: true }], [{ animated: true }]]);
    // A send while it glides leaves the pinning to the glide: no second, explicit return.
    fireEvent.scroll(timeline, scrollEvent(300));
    view.rerender(<ThreadView {...props} messages={[second, first]} scrollToBottomRequestAt={2} />);
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
    // A keyboard that moves the viewport keeps the exact end.
    fireEvent(timeline, 'layout', layoutEvent(320));
    act(() => jest.advanceTimersByTime(20));
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    expect(mockUiFollow.glide).not.toHaveBeenCalled();
  });

  it('glides a growing reply and each new row on the UI thread on Android, and ends that glide there', () => onPlatform('android', () => {
    jest.useFakeTimers();
    const first: UiMessage = { id: 'm1', role: 'assistant', text: 'One' };
    const props = createProps({ messages: [first] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    expect(mockUiFollow.bind).toHaveBeenCalledTimes(1);
    fireEvent(timeline, 'layout', layoutEvent(600));
    fireEvent.scroll(timeline, scrollEvent(0));

    // The reply's first words grow its row: a glide from where JS last saw the list.
    mockListLayout.content = 1004;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockUiFollow.glide).toHaveBeenLastCalledWith(1, 1400);
    // Its native size report re-targets the glide in flight.
    fireEvent(timeline, 'contentSizeChange', 393, 2104);
    act(() => jest.advanceTimersByTime(20));
    expect(mockUiFollow.glide).toHaveBeenLastCalledWith(2, 1400);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    // The settled report clears the glide: the next growth starts a new one.
    act(() => mockUiFollowCallbacks?.onSettled(1));
    fireEvent.scroll(timeline, scrollEvent(300));
    expect(view.getByTestId('thread-screen-scroll-to-bottom-container', { includeHiddenElements: true }).props.pointerEvents).not.toBe('auto');
    act(() => mockUiFollowCallbacks?.onSettled(2));
    const second: UiMessage = { id: 'm2', role: 'assistant', text: 'Two' };
    view.rerender(<ThreadView {...props} messages={[second, first]} />);
    mockListLayout.content = 1080;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockUiFollow.glide).toHaveBeenLastCalledWith(3, 1100);

    // A moved viewport ends the glide on the UI thread, after its last step.
    fireEvent(timeline, 'layout', layoutEvent(320));
    act(() => jest.advanceTimersByTime(20));
    expect(mockUiFollow.snap).toHaveBeenCalledTimes(1);
    // With no glide in flight, jumps stay native.
    mockListLayout.content = 1800;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    expect(mockUiFollow.snap).toHaveBeenCalledTimes(1);

    // The reader's drag takes a glide in flight over.
    mockListLayout.content = 1840;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockUiFollow.glide).toHaveBeenCalledTimes(4);
    fireEvent(timeline, 'scrollBeginDrag');
    expect(mockUiFollow.stop).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mockUiFollow.stop).toHaveBeenCalledTimes(1);
  }));

  it('follows natively on Android when the list cannot be followed on the UI thread', () => onPlatform('android', () => {
    jest.useFakeTimers();
    const first: UiMessage = { id: 'm1', role: 'assistant', text: 'One' };
    const props = createProps({ messages: [first] });
    const view = render(<ThreadView {...props} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    mockListLayout.content = 1004;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockUiFollow.glide).toHaveBeenCalledTimes(1);
    // The UI thread could not measure the list: jump natively, and keep following natively.
    act(() => mockUiFollowCallbacks?.onUnavailable());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    mockListLayout.content = 1040;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    expect(mockUiFollow.glide).toHaveBeenCalledTimes(1);

    // A list that cannot be bound follows like iOS from the start.
    mockUiFollow.bind.mockImplementation(() => false);
    view.rerender(<ThreadView {...createProps({ sessionKey: 'another-session', messages: [first] })} />);
    const next = view.getByTestId('thread-screen-timeline');
    act(() => next.props.onCommitLayoutEffect());
    fireEvent(next, 'load', { elapsedTimeInMs: 5 });
    mockListLayout.content = 1100;
    act(() => next.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    expect(mockUiFollow.glide).toHaveBeenCalledTimes(1);
  }));

  it('pulls an offset pushed past the end of a short list back, but never fights the reader', () => {
    const view = render(<ThreadView {...createProps()} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    const scrolledTo = (offset: number, height = 900) => ({ nativeEvent: {
      contentSize: { height, width: 393 }, layoutMeasurement: { height: 600, width: 393 }, contentOffset: { y: offset, x: 0 },
    } });
    // Older rows inserted above keep the visible rows in place and leave the offset past the end.
    fireEvent.scroll(timeline, scrolledTo(520));
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
    mockScrollToEnd.mockClear();
    fireEvent.scroll(timeline, scrolledTo(300));
    fireEvent.scroll(timeline, scrolledTo(40, 400));
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    // A reader's own bounce past the end belongs to the native view.
    mockScrollToEnd.mockClear();
    fireEvent(timeline, 'scrollBeginDrag');
    fireEvent.scroll(timeline, scrolledTo(360));
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('does not follow layout commits while composing full screen or returning to the bottom', () => {
    const view = render(<ThreadView {...createProps({ input: 'First\nSecond\nThird' })} />);
    const timeline = view.getByTestId('thread-screen-timeline');
    mockListLayout.content = 900;
    mockListLayout.viewport = 600;
    act(() => timeline.props.onCommitLayoutEffect());
    fireEvent(timeline, 'load', { elapsedTimeInMs: 5 });
    fireEvent.press(view.getByTestId('thread-screen-composer-expand'));
    mockListLayout.content = 1200;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('thread-screen-composer-collapse'));

    fireEvent(timeline, 'scrollBeginDrag');
    fireEvent.scroll(timeline, scrollEvent(900));
    fireEvent.press(view.getByTestId('thread-screen-scroll-to-bottom'));
    expect(mockScrollToEnd).toHaveBeenLastCalledWith({ animated: true });
    mockScrollToEnd.mockClear();
    mockListLayout.content = 1500;
    act(() => timeline.props.onCommitLayoutEffect());
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('hands the list the same row objects and renderer for rows a streamed chunk did not change', () => {
    const history: UiMessage[] = [
      { id: 'a1', role: 'assistant', text: 'Hello', timestampMs: 2_000 },
      { id: 'u1', role: 'user', text: 'Hi', timestampMs: 1_000 },
    ];
    const asked: UiMessage = { id: 'u2', role: 'user', text: 'More please', timestampMs: 2_500 };
    const live = (text: string): UiMessage => ({
      id: 'streaming', renderKey: 'reply:3000:0', role: 'assistant', text, streaming: true, timestampMs: 3_000,
    });
    const props = createProps({ isRunning: true, messages: [live('Wor'), asked, ...history] });
    const view = render(<ThreadView {...props} />);
    const timeline = () => view.getByTestId('thread-screen-timeline');
    const before = timeline().props.data as ReadonlyArray<{ key: string }>;
    const renderItem = timeline().props.renderItem;

    // The controller rebuilds every message object for each chunk.
    view.rerender(<ThreadView {...props} messages={[live('World'), { ...asked }, ...history.map((message) => ({ ...message }))]} />);
    const after = timeline().props.data as ReadonlyArray<{ key: string }>;
    expect(after.filter((row, index) => row !== before[index]).map((row) => row.key)).toEqual(['message:reply:3000:0']);
    expect(timeline().props.renderItem).toBe(renderItem);

    view.rerender(<ThreadView {...props} messages={[live('World'), { ...asked }, ...history]} />);
    expect(timeline().props.data).toBe(after);
  });

  it('lets the first streamed row of a run take over the reply placeholder cell', () => {
    const { withTiming } = require('react-native-reanimated') as { withTiming: jest.Mock };
    const earlier: UiMessage = { id: 'h1', role: 'assistant', text: 'Earlier', timestampMs: 1_000 };
    const props = createProps({ messages: [earlier], isRunning: true, pendingReplyRenderKey: 'reply:5000:0' });
    const view = render(<ThreadView {...props} />);
    const keys = () => (view.getByTestId('thread-screen-timeline').props.data as ReadonlyArray<{ key: string }>).map((row) => row.key);
    expect(keys().at(-1)).toBe('message:reply:5000:0');
    withTiming.mockClear();
    // A run the phone did not start: its first text arrives after the placeholder.
    const streamed: UiMessage = { id: 'streaming', renderKey: 'reply:5000:0', role: 'assistant', text: 'Checking the channel.', streaming: true, timestampMs: 5_000 };
    view.rerender(<ThreadView {...props} messages={[streamed, earlier]} />);
    expect(keys().at(-1)).toBe('message:reply:5000:0');
    expect(keys().filter((key) => key.startsWith('message:reply') || key === 'message:streaming')).toHaveLength(1);
    expect(entranceCalls()).toHaveLength(0);
  });

  it('lets the last streamed words finish in streaming mode, then settles without changing the text', () => {
    jest.useFakeTimers();
    const { STREAM_SETTLE_HOLD_MS } = require('../../chat/useStreamingSettleHold') as { STREAM_SETTLE_HOLD_MS: number };
    const streaming: UiMessage = {
      id: 'streaming', renderKey: 'reply:1:0', role: 'assistant', text: 'Scores:\n- > 25 wins', streaming: true, timestampMs: 1_000,
    };
    const view = render(<ThreadView {...createProps({ isRunning: true, messages: [streaming] })} />);
    const markdown = view.getByTestId('thread-markdown-streaming');
    // Complete text is never rewritten while streaming, so it matches the settled reply.
    expect(markdown.props.markdown).toBe('Scores:\n- > 25 wins');
    expect(markdown.props.streamingAnimation).toBe(true);

    const settled: UiMessage = { ...streaming, id: 'final_run', text: 'Scores:\n- > 25 wins\n- 20~25 ties', streaming: false };
    view.rerender(<ThreadView {...createProps({ messages: [settled] })} />);
    expect(view.getByTestId('thread-markdown-final_run')).toBe(markdown);
    expect(markdown.props.markdown).toBe(settled.text);
    expect(markdown.props.streamingAnimation).toBe(true);
    act(() => jest.advanceTimersByTime(STREAM_SETTLE_HOLD_MS));
    expect(markdown.props.streamingAnimation).toBe(false);
    expect(markdown.props.markdown).toBe(settled.text);
  });

  it('never puts a settled history reply in streaming mode', () => {
    const view = render(<ThreadView {...createProps({ messages: [{ id: 'h1', role: 'assistant', text: 'Done - > 25' }] })} />);
    expect(view.getByTestId('thread-markdown-h1').props.streamingAnimation).toBe(false);
    expect(view.getByTestId('thread-markdown-h1').props.markdown).toBe('Done - > 25');
  });
});
