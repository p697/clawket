import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import type { SharedValue } from 'react-native-reanimated';
import { ArrowUp, Lock, Square } from 'lucide-react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Shadow,
  Space,
} from '../../theme/tokens';
import { triggerLightImpact } from '../../services/haptics';
import { ApprovalCard } from './ApprovalCard';
import { BUBBLE_TAIL_WIDTH, Bubble } from './Bubble';
import { chatWallpaperPalettes } from '../../theme/chat-wallpaper';
import { Composer } from './Composer';
import { FloatingButton } from './FloatingButton';
import { createChatGlassStyle } from '../../features/chat-appearance/resolver';
import { RunCard } from './RunCard';
import { SettingsDivider, SettingsGroup, SettingsRow } from './SettingsGroup';
import {
  SHEET_TIMING_CONFIG,
  Sheet,
  resolveSheetContentHeightLimit,
  resolveSheetMaxHeight,
} from './Sheet';

let mockScheme: 'light' | 'dark' = 'light';
let mockReducedMotion = false;
let mockFontScale = 1;
let mockComposerAnimatedHeight: number | undefined;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    DynamicColorIOS: (variants: unknown) => ({ dynamic: variants }),
    Keyboard: { dismiss: jest.fn() },
    PanResponder: { create: (config: Record<string, unknown>) => ({ panHandlers: { __config: config } }) },
    Modal: primitive('Modal'),
    ActivityIndicator: primitive('ActivityIndicator'),
    Platform: {
      OS: 'ios',
      isMacCatalyst: false,
      isPad: false,
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: primitive('Pressable'),
    StyleSheet: {
      absoluteFill: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    TextInput: primitive('TextInput'),
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 3, fontScale: mockFontScale }),
    View: primitive('View'),
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const animatedPrimitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    __esModule: true,
    Easing: {
      cubic: (value: number) => value ** 3,
      out: (easing: (value: number) => number) => (
        (value: number) => 1 - easing(1 - value)
      ),
    },
    default: {
      View: animatedPrimitive('AnimatedView'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    FadeIn: { duration: () => ({ name: 'FadeIn' }) },
    LinearTransition: { duration: () => ({ name: 'LinearTransition' }) },
    useAnimatedProps: (factory: () => unknown) => factory(),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => {
      const style = factory();
      return mockComposerAnimatedHeight !== undefined && style.flexBasis !== undefined
        ? { ...style, height: mockComposerAnimatedHeight } : style;
    },
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: -1 }),
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (value: unknown) => ({ value }),
    withSpring: jest.fn((value: unknown) => value),
    withTiming: jest.fn((value: unknown) => value),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return {
    ArrowUp: icon('ArrowUp'),
    Check: icon('Check'),
    CircleAlert: icon('CircleAlert'),
    Clock3: icon('Clock3'),
    Maximize2: icon('Maximize2'),
    Minimize2: icon('Minimize2'),
    ChevronDown: icon('ChevronDown'),
    ChevronRight: icon('ChevronRight'),
    Lock: icon('Lock'),
    Mic: icon('Mic'),
    Plus: icon('Plus'),
    Square: icon('Square'),
    X: icon('X'),
  };
});

jest.mock('../../theme', () => {
  const ReactRuntime = require('react');
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return {
    ThemeContext: ReactRuntime.createContext(null),
    useAppTheme: () => ({
      theme: createTheme(mockScheme, mockScheme, accents.iceBlue),
    }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../services/haptics', () => ({
  triggerLightImpact: jest.fn(),
}));

let consoleErrorSpy: jest.SpyInstance;

beforeAll(() => {
  const originalConsoleError = console.error;
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
    if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    originalConsoleError(message, ...rest);
  });
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

type StyleValue = Record<string, unknown> | ReadonlyArray<unknown> | null | false | undefined;

function flattenStyle(style: StyleValue | ((state: { pressed: boolean }) => StyleValue), pressed = false) {
  const result: Record<string, unknown> = {};
  const append = (value: StyleValue | ((state: { pressed: boolean }) => StyleValue)): void => {
    if (!value) return;
    if (typeof value === 'function') {
      append(value({ pressed }));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => append(entry as StyleValue));
      return;
    }
    Object.assign(result, value);
  };
  append(style);
  return result;
}

function activeTheme(scheme: 'light' | 'dark') {
  return buildTheme(scheme, scheme, builtInAccents.iceBlue);
}

describe.each(['light', 'dark'] as const)('%s thread primitives', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('renders the two canonical bubble variants without surface borders', () => {
    const theme = activeTheme(scheme);
    const palette = chatWallpaperPalettes.iceBlue[scheme];
    const assistant = render(<Bubble testID="assistant" role="assistant">Hello</Bubble>);
    const assistantStyle = flattenStyle(assistant.getByTestId('assistant').props.style);
    // Over the built-in wallpaper the Agent speaks on white (tinted charcoal in dark).
    expect(assistantStyle).toMatchObject({
      maxWidth: '92%',
      borderRadius: Radius.bubble,
      backgroundColor: palette.incoming,
      alignSelf: 'flex-start',
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    });
    expect(assistantStyle.borderWidth).toBe(0);
    expect(flattenStyle(assistant.getByText('Hello').props.style)).toMatchObject({
      color: theme.colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    });

    // The user's own words: the solid accent with white text.
    const user = render(<Bubble testID="user" role="user">Hi</Bubble>);
    expect(flattenStyle(user.getByTestId('user').props.style)).toMatchObject({
      backgroundColor: palette.outgoing,
      alignSelf: 'flex-end',
      borderRadius: Radius.bubble,
    });
    expect(flattenStyle(user.getByText('Hi').props.style).color).toBe(palette.onOutgoing);
  });

  it('joins a speaker\'s bubbles and gives only the last of a group a tail', () => {
    const palette = chatWallpaperPalettes.iceBlue[scheme];
    const alone = render(<Bubble testID="alone" role="assistant">One</Bubble>);
    expect(flattenStyle(alone.getByTestId('alone').props.style)).toMatchObject({
      borderTopLeftRadius: Radius.bubble, borderBottomLeftRadius: Radius.bubbleTail,
    });
    const tail = alone.getByTestId('alone-tail');
    expect(flattenStyle(tail.props.style)).toMatchObject({ position: 'absolute', bottom: 0, left: -BUBBLE_TAIL_WIDTH });
    expect(tail.findAll((node) => (node.type as unknown) === 'Path')[0]?.props.fill).toBe(palette.incoming);

    const first = render(<Bubble testID="first" role="user" joinsNewer>One</Bubble>);
    expect(flattenStyle(first.getByTestId('first').props.style)).toMatchObject({
      borderTopRightRadius: Radius.bubble, borderBottomRightRadius: Radius.bubbleJoined,
    });
    expect(first.queryByTestId('first-tail')).toBeNull();

    const last = render(<Bubble testID="last" role="user" joinsOlder>Two</Bubble>);
    expect(flattenStyle(last.getByTestId('last').props.style)).toMatchObject({
      borderTopRightRadius: Radius.bubbleJoined, borderBottomRightRadius: Radius.bubbleTail,
    });
    expect(flattenStyle(last.getByTestId('last-tail').props.style)).toMatchObject({ right: -BUBBLE_TAIL_WIDTH });
  });

  it('renders a borderless run event without a status rail', () => {
    const theme = activeTheme(scheme);
    const onPress = jest.fn();
    const result = render(
      <RunCard
        testID="run"
        title="Nightly sync"
        statusLabel="Failed"
        statusTone="bad"
        detail="2m"
        tone="bad"
        onPress={onPress}
      />,
    );
    const cardStyle = flattenStyle(result.getByTestId('run').props.style);
    expect(cardStyle).toMatchObject({
      backgroundColor: theme.colors.surface,
      borderRadius: Radius.card,
    });
    expect(cardStyle).not.toHaveProperty('borderWidth');
    expect(result.queryByTestId('run-status')).toBeNull();
    expect(flattenStyle(result.getByTestId('run-detail').props.style)).toMatchObject({
      color: theme.colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    });
    expect(flattenStyle(result.getByTestId('run-detail-status').props.style)).toMatchObject({
      color: theme.colors.bad,
    });
    fireEvent.press(result.getByTestId('run'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('asks for approval in the Agent\'s bubble with Telegram-style buttons under it', () => {
    const theme = activeTheme(scheme);
    const palette = chatWallpaperPalettes.iceBlue[scheme];
    const Glyph = jest.fn((_props: { size: number; color: string; strokeWidth: number }) => null);
    const allow = jest.fn();
    const alwaysAllow = jest.fn();
    const reject = jest.fn();
    const result = render(
      <ApprovalCard
        testID="approval"
        icon={Glyph}
        title="Allow exec?"
        command="npm test"
        detail="Run the unit tests"
        primaryAction={{ label: 'Allow', onPress: allow, onLongPress: alwaysAllow }}
        secondaryAction={{ label: 'Reject', onPress: reject }}
      />,
    );
    expect(flattenStyle(result.getByTestId('approval').props.style)).toMatchObject({ alignSelf: 'flex-start', width: '88%' });
    expect(result.getByTestId('approval').props.accessibilityState).toEqual({ disabled: false });
    // The question is the Agent's own bubble, tail and all.
    expect(flattenStyle(result.getByTestId('approval-bubble').props.style)).toMatchObject({
      backgroundColor: palette.incoming, borderRadius: Radius.bubble, alignSelf: 'stretch',
    });
    expect(result.getByTestId('approval-bubble-tail')).toBeTruthy();
    expect(flattenStyle(result.getByTestId('approval-glyph').props.style)).toMatchObject({
      backgroundColor: theme.colors.warnSoft, borderRadius: Radius.full,
    });
    expect(Glyph.mock.calls[0]?.[0]).toMatchObject({ size: IconSize.sm, color: theme.colors.warn });
    expect(flattenStyle(result.getByTestId('approval-well').props.style)).toMatchObject({
      backgroundColor: scheme === 'dark' ? theme.colors.canvas : theme.colors.surface,
      borderRadius: Radius.avatarSheet,
    });
    // iOS resolves no family called `monospace`; the command must name a real monospaced face.
    expect(flattenStyle(result.getByTestId('approval-command').props.style)).toMatchObject({
      fontFamily: 'Menlo',
      fontSize: FontSize.caption,
      lineHeight: LineHeight.secondary,
    });
    expect(result.getByTestId('approval-command').props.selectable).toBe(true);
    expect(flattenStyle(result.getByTestId('approval-detail').props.style)).toMatchObject({
      color: theme.colors.inkSecondary,
      fontSize: FontSize.secondary,
    });
    // Reject on the service tint beside the solid accent Allow, 44 points tall.
    expect(flattenStyle(result.getByTestId('approval-primary').props.style)).toMatchObject({
      minHeight: ControlSize.floatingButton,
      borderRadius: Radius.settingsGroup,
      backgroundColor: palette.outgoing,
    });
    expect(flattenStyle(result.getByTestId('approval-secondary').props.style).backgroundColor).toBe(palette.service);
    fireEvent.press(result.getByTestId('approval-primary'));
    fireEvent(result.getByTestId('approval-primary'), 'longPress');
    fireEvent.press(result.getByTestId('approval-secondary'));
    expect(allow).toHaveBeenCalledTimes(1);
    expect(alwaysAllow).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it('spins only the pressed approval button and releases both after a failed resolution', () => {
    const theme = activeTheme(scheme);
    const palette = chatWallpaperPalettes.iceBlue[scheme];
    const props = {
      testID: 'approval',
      title: 'Allow exec?',
      command: 'npm test',
      detail: 'Run the unit tests',
      primaryAction: { label: 'Allow', onPress: jest.fn() },
      secondaryAction: { label: 'Reject', onPress: jest.fn() },
    };
    const result = render(<ApprovalCard {...props} />);
    fireEvent.press(result.getByTestId('approval-primary'));
    result.rerender(<ApprovalCard {...props} busy />);

    expect(result.getByTestId('approval-primary-busy').props.color).toBe(palette.onOutgoing);
    expect(result.queryByText('Allow')).toBeNull();
    expect(result.getByTestId('approval-primary').props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(flattenStyle(result.getByTestId('approval-primary').props.style)).not.toHaveProperty('opacity');
    expect(result.getByTestId('approval-secondary').props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(flattenStyle(result.getByTestId('approval-secondary').props.style).opacity).toBe(0.55);

    result.rerender(<ApprovalCard {...props} error="Could not update this request. Try again." />);
    expect(result.queryByTestId('approval-primary-busy')).toBeNull();
    expect(result.getByTestId('approval-primary').props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(flattenStyle(result.getByText('Could not update this request. Try again.').props.style))
      .toMatchObject({ color: theme.colors.bad, fontSize: FontSize.secondary });
    expect(result.queryByTestId('approval-detail')).toBeNull();

    // Without a new press the card cannot know which button a later confirmation belongs to.
    result.rerender(<ApprovalCard {...props} busy />);
    expect(result.queryByTestId('approval-primary-busy')).toBeNull();
    expect(result.queryByTestId('approval-secondary-busy')).toBeNull();
  });

  it('collapses a settled approval to its title, outcome and command', () => {
    const result = render(
      <ApprovalCard
        testID="approval"
        title="Allow exec?"
        command="npm test"
        detail="Run the unit tests"
        outcome={{ kind: 'allowed', label: 'Allowed' }}
        primaryAction={{ label: 'Allow', onPress: jest.fn() }}
        secondaryAction={{ label: 'Reject', onPress: jest.fn() }}
      />,
    );

    expect(result.getByTestId('approval').props.accessibilityState).toEqual({ disabled: true });
    expect(result.getByTestId('approval-outcome')).toBeTruthy();
    expect(result.getByText('Allowed')).toBeTruthy();
    expect(result.getByTestId('approval-command')).toBeTruthy();
    expect(result.queryByTestId('approval-detail')).toBeNull();
    expect(result.queryByTestId('approval-primary')).toBeNull();
    expect(result.queryByTestId('approval-secondary')).toBeNull();
    expect(result.queryByTestId('approval-actions')).toBeNull();
  });

  it('previews a long approval command in three lines and expands the whole well', () => {
    const command = `npx jest ${'src/components/ui/ThreadPrimitives.test.tsx '.repeat(4)}--runInBand`;
    const result = render(
      <ApprovalCard
        testID="approval"
        title="Allow exec?"
        command={command}
        primaryAction={{ label: 'Allow', onPress: jest.fn() }}
        secondaryAction={{ label: 'Reject', onPress: jest.fn() }}
      />,
    );

    expect(result.getByTestId('approval-command').props.numberOfLines).toBe(3);
    expect(result.getByTestId('approval-show-more').props.accessibilityState).toEqual({ expanded: false });
    expect(result.getByTestId('approval-show-more').props.accessibilityLabel).toBe(command);
    fireEvent.press(result.getByTestId('approval-show-more'));
    expect(result.queryByTestId('approval-show-more')).toBeNull();
    expect(result.getByTestId('approval-command').props.numberOfLines).toBeUndefined();
    expect(result.getByTestId('approval-command').props.selectable).toBe(true);
  });

  it('uses 44pt floating actions and a five-line composition field', () => {
    const theme = activeTheme(scheme);
    const send = jest.fn();
    const stop = jest.fn();
    const onPasteFiles = jest.fn();
    const onPasteFailed = jest.fn();
    const labels = { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' };
    const result = render(
      <Composer
        testID="composer"
        value="Draft"
        placeholder="Ask Main"
        accessibilityLabels={labels}
        onChangeText={jest.fn()}
        onAddPress={jest.fn()}
        onVoicePress={jest.fn()}
        onPasteFiles={onPasteFiles}
        onPasteFailed={onPasteFailed}
        onSend={send}
        onStop={stop}
      />,
    );
    const inputShell = flattenStyle(result.getByTestId('composer-input-shell').props.style);
    expect(inputShell).toMatchObject({ minHeight: ControlSize.pill });
    // One row (A+): add circle, the draft's capsule, the send circle.
    expect(flattenStyle(result.getByTestId('composer-row').props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'flex-end' });
    expect(flattenStyle(result.getByTestId('composer').props.style).backgroundColor).toBeUndefined();
    expect(flattenStyle(result.getByTestId('composer-capsule').props.style)).toMatchObject({
      borderRadius: Radius.xl, backgroundColor: theme.colors.surface, minHeight: ControlSize.floatingButton,
    });
    expect(flattenStyle(result.getByTestId('composer-add-surface').props.style)).toMatchObject({
      width: ControlSize.floatingButton, backgroundColor: theme.colors.surface,
    });
    const input = result.getByTestId('composer-input');
    expect(input.type).toBe('PasteInput');
    expect(input.props).toMatchObject({ multiline: true, scrollEnabled: false });
    expect(flattenStyle(input.props.style)).toMatchObject({
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      paddingVertical: Space.sm,
    });
    const pastedFile = {
      uri: 'file:///tmp/pasted.png',
      fileName: 'pasted.png',
      fileSize: 512,
      type: 'image/png',
    };
    fireEvent(input, 'paste', null, [pastedFile]);
    fireEvent(input, 'paste', 'native error', []);
    expect(onPasteFiles).toHaveBeenCalledWith([pastedFile]);
    expect(onPasteFailed).toHaveBeenCalledTimes(1);
    expect(flattenStyle(result.getByTestId('composer-add').props.style).width)
      .toBe(ControlSize.floatingButton);
    // Send wears the user's own bubble color.
    expect(flattenStyle(result.getByTestId('composer-primary-surface').props.style).backgroundColor)
      .toBe(chatWallpaperPalettes.iceBlue[scheme].outgoing);
    expect(result.UNSAFE_getByType(ArrowUp)).toBeTruthy();
    fireEvent.press(result.getByTestId('composer-primary'));
    expect(send).toHaveBeenCalledTimes(1);

    result.rerender(
      <Composer
        testID="composer"
        value=""
        placeholder="Ask Main"
        accessibilityLabels={labels}
        onChangeText={jest.fn()}
        onSend={send}
        onStop={stop}
        isRunning
      />,
    );
    expect(result.getByTestId('composer-input').type).toBe('TextInput');
    expect(flattenStyle(result.getByTestId('composer-primary-surface').props.style).backgroundColor)
      .toBe(theme.colors.ink);
    expect(result.UNSAFE_getByType(Square)).toBeTruthy();
    fireEvent.press(result.getByTestId('composer-primary'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps Stop reachable and adds a queue Send once a draft exists during a run', () => {
    const theme = activeTheme(scheme);
    const send = jest.fn();
    const stop = jest.fn();
    const labels = { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop', queue: 'Send after this reply' };
    const props = {
      testID: 'composer', placeholder: 'Ask Main', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend: send, onStop: stop, onVoicePress: jest.fn(), isRunning: true,
    };
    const view = render(<Composer {...props} value="" />);
    // No draft: Stop stays the single primary control, no dictation entry.
    expect(view.queryByTestId('composer-stop')).toBeNull();
    expect(view.queryByTestId('composer-voice')).toBeNull();
    expect(view.getByTestId('composer-primary').props.accessibilityLabel).toBe('Stop');

    view.rerender(<Composer {...props} value="also check the tests" />);
    const stopAction = view.getByTestId('composer-stop');
    expect(stopAction.props.accessibilityLabel).toBe('Stop');
    expect(flattenStyle(view.getByTestId('composer-stop-surface').props.style).backgroundColor)
      .toBe(theme.colors.surface);
    const primary = view.getByTestId('composer-primary');
    expect(primary.props.accessibilityLabel).toBe('Send after this reply');
    expect(primary.props.accessibilityState).toEqual({ disabled: false });
    expect(flattenStyle(view.getByTestId('composer-primary-surface').props.style).backgroundColor)
      .toBe(chatWallpaperPalettes.iceBlue[scheme].outgoing);
    expect(view.UNSAFE_getByType(ArrowUp)).toBeTruthy();
    expect(view.UNSAFE_getByType(Square)).toBeTruthy();
    fireEvent.press(primary);
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.press(stopAction);
    expect(stop).toHaveBeenCalledTimes(1);

    // Without queue capacity the queue Send waits, but Stop remains available.
    view.rerender(<Composer {...props} value="also check the tests" canSend={false} />);
    expect(view.getByTestId('composer-primary').props.accessibilityState).toEqual({ disabled: true });
    expect(view.getByTestId('composer-stop')).toBeTruthy();

    // Without an abort capability the draft still reaches the queue.
    view.rerender(<Composer {...props} value="also check the tests" onStop={undefined} />);
    expect(view.queryByTestId('composer-stop')).toBeNull();
    expect(view.getByTestId('composer-primary').props.accessibilityLabel).toBe('Send after this reply');
  });

  it('keeps the mic target through capture and finalization and returns the model chip after it', () => {
    const onVoiceStart = jest.fn(), onVoiceStop = jest.fn(), onVoiceCancel = jest.fn();
    const labels = { add: 'Add', voice: 'Voice', stopVoice: 'Stop voice input', send: 'Send', stop: 'Stop' };
    const props = { testID: 'composer', placeholder: 'Ask', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend: jest.fn(), onVoicePress: jest.fn(), onVoiceStart, onVoiceStop, onVoiceCancel,
      accessory: <Text testID="model-picker">Model</Text>, value: '' };
    const view = render(<Composer {...props} />);
    // The mic's touch-down starts recording; releasing a tap keeps dictating.
    fireEvent(view.getByTestId('composer-voice'), 'pressIn', { nativeEvent: { pageY: 500 } });
    expect(onVoiceStart).toHaveBeenCalledTimes(1);
    view.rerender(<Composer {...props} voiceState="listening" />);
    expect(view.queryByTestId('composer-voice-stop')).toBeNull();
    fireEvent(view.getByTestId('composer-voice'), 'pressOut'); fireEvent.press(view.getByTestId('composer-voice'));
    expect(onVoiceStart).toHaveBeenCalledTimes(1); expect(onVoiceStop).not.toHaveBeenCalled();
    // The waveform owns the capsule while dictating; the chip steps aside.
    expect(view.queryByTestId('model-picker')).toBeNull();
    expect(view.getByTestId('composer-voice').props.accessibilityState.busy).toBe(false);
    expect(view.getByTestId('composer-input', { includeHiddenElements: true }).props.editable).toBe(false);
    fireEvent.press(view.getByTestId('composer-voice-stop')); expect(onVoiceStop).toHaveBeenCalledWith(false);
    fireEvent.press(view.getByTestId('composer-voice-cancel')); expect(onVoiceCancel).toHaveBeenCalledTimes(1);
    view.rerender(<Composer {...props} voiceState="transcribing" />);
    expect(view.getByTestId('composer-voice').props.accessibilityState.busy).toBe(true);
    expect(view.queryByTestId('composer-primary')).toBeNull();
    view.rerender(<Composer {...props} />);
    expect(view.getByTestId('model-picker')).toBeTruthy();
    expect(view.getByTestId('composer-accessory')).toBeTruthy();
  });

  it('tells a sizing accessory the room left beside the whole placeholder', () => {
    const accessory = jest.fn(({ drafting, room }: { drafting: boolean; room: number | null }) => (
      <Text testID="chip">{`${drafting}:${room}`}</Text>
    ));
    const props = { testID: 'composer', placeholder: 'Message', accessibilityLabels: { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' },
      onChangeText: jest.fn(), onSend: jest.fn(), accessory };
    const view = render(<Composer {...props} value="" />);
    // Unmeasured, the chip keeps its own width.
    expect(view.getByTestId('chip').props.children).toBe('false:null');
    fireEvent(view.getByTestId('composer-input-shell'), 'layout', { nativeEvent: { layout: { width: 220, height: 40 } } });
    const measurement = () => view.getByTestId('composer-placeholder-measurement', { includeHiddenElements: true });
    fireEvent(measurement(), 'textLayout', { nativeEvent: { lines: [{ width: 120.4 }] } });
    expect(measurement().props.children).toBe('Message');
    // The shell's two paddings and the whole placeholder come first.
    expect(view.getByTestId('chip').props.children).toBe(`false:${220 - Space.sm * 2 - 121}`);
    view.rerender(<Composer {...props} value="Hi" />);
    expect(view.getByTestId('chip').props.children).toMatch(/^true:/);
    // Full-screen editing has room: its toolbar gets the full chip.
    view.rerender(<Composer {...props} value="Hi" expanded onExpandedChange={jest.fn()} />);
    expect(view.getByTestId('chip').props.children).toBe('false:null');
  });

  it('limits input hold-to-talk to an empty unfocused editor', () => {
    const start = jest.fn();
    const props = { testID: 'composer', placeholder: 'Message', accessibilityLabels: { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' },
      onChangeText: jest.fn(), onSend: jest.fn(), onVoicePress: jest.fn(), onVoiceStart: start, value: '' };
    const view = render(<Composer {...props} />);
    expect(view.getByTestId('composer-input').props.placeholder).toBe('Type or hold to talk');
    const target = view.getByTestId('composer-voice-input-target');
    expect(target.props.pointerEvents).toBe('auto');
    fireEvent(target, 'pressIn', { nativeEvent: { pageY: 500 } });
    expect(start).not.toHaveBeenCalled();
    fireEvent(target, 'longPress'); expect(start).toHaveBeenCalledTimes(1);
    view.rerender(<Composer {...props} voiceState="listening" />);
    expect(view.getByTestId('composer-voice-input-target')).toBe(target);
    view.rerender(<Composer {...props} />);
    const input = view.getByTestId('composer-input');
    fireEvent(input, 'focus', {});
    // Empty focused inputs must receive native paste/selection touches too.
    expect(view.getByTestId('composer-voice-input-target').props.pointerEvents).toBe('none');
    expect(input.props.placeholder).toBe('Message');
    expect(input.props.editable).toBe(true);
    expect(input.props.contextMenuHidden).not.toBe(true);
    view.rerender(<Composer {...props} value="Editing a draft" />);
    fireEvent(input, 'blur', {});
    // A saved draft remains directly selectable even before focusing it.
    expect(view.getByTestId('composer-voice-input-target').props.pointerEvents).toBe('none');
    expect(view.getByTestId('composer-input').props.placeholder).toBe('Message');
    view.rerender(<Composer {...props} />);
    expect(view.getByTestId('composer-voice-input-target').props.pointerEvents).toBe('auto');
    fireEvent(input, 'focus', {});
    expect(view.getByTestId('composer-voice-input-target').props.pointerEvents).toBe('none');
    view.rerender(<Composer {...props} expanded />);
    expect(view.getByTestId('composer-voice-input-target').props.pointerEvents).toBe('none');
    expect(view.getByTestId('composer-input')).toBe(input);
  });

  it('keeps keyboard-dismiss capture outside native text selection', () => {
    const props = { testID: 'composer', placeholder: 'Message',
      accessibilityLabels: { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' },
      onChangeText: jest.fn(), onSend: jest.fn(), value: 'Select this draft' };
    const view = render(<Composer {...props} />);
    expect(view.getByTestId('composer').props.__config).toBeUndefined();
    expect(view.getByTestId('composer-input-shell').props.__config).toBeUndefined();
    fireEvent(view.getByTestId('composer-input'), 'focus', {});
    // The circles beside the capsule catch a downward swipe; the draft keeps its own touches.
    expect(view.getByTestId('composer-capsule').props.__config).toBeUndefined();
    const capture = view.getByTestId('composer-trailing').props.__config.onMoveShouldSetPanResponderCapture;
    expect(capture({}, { dx: 0, dy: 24, numberActiveTouches: 1 })).toBe(true);
    expect(view.getByTestId('composer-leading').props.__config.onMoveShouldSetPanResponderCapture).toBe(capture);
    view.rerender(<Composer {...props} expanded />);
    expect(view.queryByTestId('composer-trailing')).toBeNull();
    expect(view.getByTestId('composer-toolbar').props.__config).toBeUndefined();
  });

  it('renders bottom sheet chrome with one 40 percent backdrop and a visible close action', () => {
    const theme = activeTheme(scheme);
    const onClose = jest.fn();
    const result = render(
      <Sheet
        testID="sheet"
        visible
        title="Sessions"
        closeAccessibilityLabel="Close"
        onClose={onClose}
      >
        <></>
      </Sheet>,
    );
    const sheetStyle = flattenStyle(result.getByTestId('sheet').props.style);
    expect(sheetStyle).toMatchObject({
      backgroundColor: theme.colors.canvas,
      borderTopLeftRadius: Radius.bottomSheet,
      borderTopRightRadius: Radius.bottomSheet,
    });
    expect(sheetStyle).not.toHaveProperty('borderWidth');
    expect(result.UNSAFE_getByType(BottomSheetView).props.testID).toBe('sheet');
    expect(result.UNSAFE_getByType(BottomSheetModal).props).toMatchObject({
      keyboardBehavior: 'interactive',
      android_keyboardInputMode: 'adjustPan',
    });
    expect(sheetStyle.maxHeight).toBeCloseTo(resolveSheetContentHeightLimit(812 * 0.9));
    expect(flattenStyle(result.getByTestId('sheet-handle', {
      includeHiddenElements: true,
    }).props.style)).toMatchObject({
      width: 36,
      height: Space.xs,
      backgroundColor: theme.colors.line,
    });
    expect(flattenStyle(result.UNSAFE_getByType(BottomSheetBackdrop).props.style)).toMatchObject({
      backgroundColor: theme.colors.scrim,
    });
    expect(result.getByTestId('sheet-close')).toBeTruthy();
    fireEvent.press(result.getByTestId('sheet-backdrop', {
      includeHiddenElements: true,
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses one 320ms timing and keeps disabled backdrop dismissal inert', () => {
    const onClose = jest.fn();
    const result = render(
      <Sheet
        testID="locked-sheet"
        visible
        title="Locked"
        closeAccessibilityLabel="Close"
        dismissOnBackdropPress={false}
        onClose={onClose}
      >
        <></>
      </Sheet>,
    );

    expect(SHEET_TIMING_CONFIG).toMatchObject({
      duration: Motion.duration.slow,
      reduceMotion: 'system',
    });
    expect((SHEET_TIMING_CONFIG.easing as (value: number) => number)(0.5)).toBeGreaterThan(0.5);
    expect(Motion.duration.slow).toBe(320);
    expect(resolveSheetMaxHeight('75%', 800)).toBe(600);
    expect(resolveSheetMaxHeight(900, 800)).toBe(800);
    expect(resolveSheetMaxHeight('auto', 800)).toBe(800);
    expect(resolveSheetContentHeightLimit(600)).toBe(600 - Space.lg);
    expect(resolveSheetContentHeightLimit(900, 720)).toBe(720 - Space.lg);
    const backdrop = result.getByTestId('locked-sheet-backdrop', {
      includeHiddenElements: true,
    });
    expect(backdrop.props.disabled).toBe(true);
    fireEvent.press(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('supports fixed detents with a fill-height body and caller keyboard behavior', () => {
    const result = render(
      <Sheet
        testID="fixed-sheet"
        visible
        title="Models"
        closeAccessibilityLabel="Close"
        onClose={jest.fn()}
        snapPoints={['58%', '92%']}
        keyboardBehavior="extend"
        keyboardBlurBehavior="none"
        androidKeyboardInputMode="adjustResize"
      >
        <></>
      </Sheet>,
    );

    expect(result.UNSAFE_getByType(BottomSheetModal).props).toMatchObject({
      enableDynamicSizing: false,
      index: 0,
      snapPoints: ['58%', '92%'],
      keyboardBehavior: 'extend',
      keyboardBlurBehavior: 'none',
      android_keyboardInputMode: 'adjustResize',
      overrideReduceMotion: 'system',
    });
    expect(flattenStyle(result.getByTestId('fixed-sheet').props.style)).toMatchObject({
      flex: 1,
    });
    expect(result.UNSAFE_queryAllByType(BottomSheetView)).toHaveLength(0);
  });

  it('keeps settings rows borderless and reserves the hairline for dividers', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <SettingsGroup testID="settings">
        <SettingsRow
          testID="settings-row"
          title="Connection"
          value="Offline"
          attention
          locked
          onPress={jest.fn()}
        />
        <SettingsDivider testID="settings-divider" inset="content" />
      </SettingsGroup>,
    );
    expect(flattenStyle(result.getByTestId('settings').props.style)).toMatchObject({
      backgroundColor: theme.colors.surfaceFloating,
      borderRadius: Radius.settingsGroup,
    });
    const restingRow = flattenStyle(result.getByTestId('settings-row').props.style);
    const pressedRow = flattenStyle(result.getByTestId('settings-row').props.style, true);
    expect(restingRow.minHeight).toBe(ControlSize.settingsRow);
    expect(restingRow).not.toHaveProperty('borderWidth');
    expect(pressedRow.backgroundColor).toBe(theme.colors.surface);
    expect(flattenStyle(result.getByText('Connection').props.style)).toMatchObject({
      color: theme.colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    });
    expect(flattenStyle(result.getByText('Offline').props.style)).toMatchObject({
      color: theme.colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    });
    expect(result.UNSAFE_getByType(Lock)).toBeTruthy();
    expect(flattenStyle(result.getByTestId('settings-row-attention').props.style).backgroundColor)
      .toBe(theme.colors.bad);
    expect(flattenStyle(result.getByTestId('settings-divider').props.style)).toMatchObject({
      height: BorderWidth.hairline,
      backgroundColor: theme.colors.line,
      marginStart: Space.lg,
    });
  });

  it('puts plain rows on the content edge and fades them on press instead of painting a fill', () => {
    const theme = activeTheme(scheme);
    // Outside any group a row is plain; a plain group drops the card chrome too.
    const result = render(
      <>
        <SettingsRow testID="bare-row" title="Heartbeat" value="30m" onPress={jest.fn()} />
        <SettingsDivider testID="bare-divider" />
        <SettingsGroup testID="plain-group" chrome="plain">
          <SettingsRow testID="plain-row" title="Source" onPress={jest.fn()} />
          <SettingsDivider testID="plain-divider" />
          <SettingsRow testID="plain-static" title="Status" value="Enabled" />
        </SettingsGroup>
        <SettingsGroup testID="card-group">
          <SettingsRow testID="card-row" title="Connection" onPress={jest.fn()} />
        </SettingsGroup>
      </>,
    );
    for (const id of ['bare-row', 'plain-row', 'plain-static']) {
      expect(flattenStyle(result.getByTestId(id).props.style).paddingHorizontal).toBe(0);
    }
    for (const id of ['bare-row', 'plain-row']) {
      const pressed = flattenStyle(result.getByTestId(id).props.style, true);
      expect(pressed.opacity).toBe(Motion.pressedOpacity);
      expect(pressed).not.toHaveProperty('backgroundColor');
    }
    for (const id of ['bare-divider', 'plain-divider']) {
      expect(flattenStyle(result.getByTestId(id).props.style)).not.toHaveProperty('marginStart');
    }
    const plainGroup = flattenStyle(result.getByTestId('plain-group').props.style);
    expect(plainGroup).not.toHaveProperty('backgroundColor');
    expect(plainGroup).not.toHaveProperty('borderRadius');
    // Card rows keep the 16-point inset and the clipped full-width fill.
    expect(flattenStyle(result.getByTestId('card-row').props.style).paddingHorizontal).toBe(Space.lg);
    const cardPressed = flattenStyle(result.getByTestId('card-row').props.style, true);
    expect(cardPressed.backgroundColor).toBe(theme.colors.surface);
    expect(cardPressed).not.toHaveProperty('opacity');
  });

  it('marks an expanded disclosure row with a down chevron and a firm title, never a selected fill', () => {
    const result = render(
      <SettingsGroup>
        <SettingsRow testID="closed" title="meta" subtitle="lastTouchedVersion, migrations" showChevron expanded={false} onPress={jest.fn()} />
        <SettingsRow testID="open" title="channels" subtitle="telegram, discord" showChevron expanded onPress={jest.fn()} />
      </SettingsGroup>,
    );
    expect(result.getByTestId('closed').props.accessibilityState).toMatchObject({ expanded: false });
    expect(result.queryByTestId('closed-chevron-down')).toBeNull();
    expect(flattenStyle(result.getByText('meta').props.style).fontWeight).toBe(FontWeight.regular);

    expect(result.getByTestId('open').props.accessibilityState).toMatchObject({ expanded: true });
    expect(result.getByTestId('open-chevron-down')).toBeTruthy();
    expect(flattenStyle(result.getByText('channels').props.style).fontWeight).toBe(FontWeight.semibold);
    // Expansion is a disclosure, not a choice: no inset fill behind the row.
    expect(result.queryByTestId('open-selected-fill')).toBeNull();
    expect(flattenStyle(result.getByTestId('open').props.style)).not.toHaveProperty('backgroundColor');
  });
});

describe('long-form composer', () => {
  const labels = { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' };

  it.each(['android', 'ios'] as const)('bounds a cleared %s editor despite a stale animated height or text measurement', platform => {
    const { Platform } = require('react-native');
    const previousPlatform = Platform.OS;
    Platform.OS = platform;
    const props = { testID: 'editor', value: 'A long wrapped draft', placeholder: 'Message', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend: jest.fn(), onExpandedChange: jest.fn() };
    const view = render(<Composer {...props} />);
    try {
      const nativeInput = view.getByTestId('editor-input');
      fireEvent(view.getByTestId('editor-measurement', { includeHiddenElements: true }), 'textLayout', {
        nativeEvent: { lines: [{}, {}, {}, {}, {}] },
      });
      // Simulate the measured native failure: the UI thread keeps the previous
      // five-line height even though React has committed the empty draft.
      mockComposerAnimatedHeight = LineHeight.body * 5 + Space.sm * 2;
      view.rerender(<Composer {...props} value="" />);
      const shellStyle = () => flattenStyle(view.getByTestId('editor-input-shell').props.style);
      expect(shellStyle()).toMatchObject({
        height: mockComposerAnimatedHeight, minHeight: ControlSize.pill, maxHeight: ControlSize.pill,
      });
      fireEvent(view.getByTestId('editor-measurement', { includeHiddenElements: true }), 'textLayout', {
        nativeEvent: { lines: [{}, {}, {}, {}, {}, {}] },
      });
      expect(shellStyle()).toMatchObject({ minHeight: ControlSize.pill, maxHeight: ControlSize.pill });
      expect(view.getByTestId('editor-input')).toBe(nativeInput);

      mockComposerAnimatedHeight = undefined;
      view.rerender(<Composer {...props} value="New draft" />);
      expect(shellStyle().maxHeight).toBeUndefined();
      expect(view.getByTestId('editor-input')).toBe(nativeInput);
      fireEvent(view.getByTestId('editor-measurement', { includeHiddenElements: true }), 'textLayout', {
        nativeEvent: { lines: [{}] },
      });
      expect(shellStyle().height).toBe(ControlSize.pill);
    } finally {
      view.unmount();
      mockComposerAnimatedHeight = undefined;
      Platform.OS = previousPlatform;
    }
  });

  it('keeps the empty editor tall enough for enlarged text without changing its native input', () => {
    const props = { testID: 'editor', value: '', placeholder: 'Message', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend: jest.fn() };
    const view = render(<Composer {...props} />);
    try {
      const nativeInput = view.getByTestId('editor-input');
      mockFontScale = 2;
      view.rerender(<Composer {...props} />);
      expect(flattenStyle(view.getByTestId('editor-input-shell').props.style)).toMatchObject({
        minHeight: LineHeight.body * 2 + Space.sm * 2,
        maxHeight: LineHeight.body * 2 + Space.sm * 2,
      });
      expect(view.getByTestId('editor-input')).toBe(nativeInput);
    } finally { view.unmount(); mockFontScale = 1; }
  });

  it('releases empty-editor bounds while expanded or presenting voice capture', () => {
    const props = { testID: 'editor', value: '', placeholder: 'Message', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend: jest.fn(), onVoicePress: jest.fn(), onExpandedChange: jest.fn() };
    const view = render(<Composer {...props} />);
    const nativeInput = view.getByTestId('editor-input');
    const shellStyle = () => flattenStyle(view.getByTestId('editor-input-shell').props.style);
    expect(shellStyle().maxHeight).toBe(ControlSize.pill);
    view.rerender(<Composer {...props} expanded />);
    expect(shellStyle().maxHeight).toBeUndefined();
    expect(shellStyle()).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: 0 });
    for (const voiceState of ['listening', 'transcribing'] as const) {
      view.rerender(<Composer {...props} voiceState={voiceState} />);
      expect(shellStyle().maxHeight).toBeUndefined();
      expect(view.getByTestId('editor-input', { includeHiddenElements: true })).toBe(nativeInput);
    }
    view.rerender(<Composer {...props} />);
    expect(shellStyle().maxHeight).toBe(ControlSize.pill);
    expect(view.getByTestId('editor-input')).toBe(nativeInput);
    view.unmount();
  });

  it('keeps saved voice recovery reachable with an existing text draft', () => {
    const recover = jest.fn();
    const view = render(<Composer testID="voice-recovery" value="typed draft" placeholder="Message"
      onChangeText={jest.fn()} onSend={jest.fn()} onVoicePress={jest.fn()}
      onVoiceRecover={recover} voiceRecoveryCount={1}
      accessibilityLabels={{ add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' }} />);
    fireEvent.press(view.getByTestId('voice-recovery-voice-recover'));
    expect(recover).toHaveBeenCalledTimes(1);
  });
  it('offers expansion from the third visual line and retains the same native input', () => {
    const onExpandedChange = jest.fn();
    const onSend = jest.fn();
    const props = { testID: 'editor', value: 'A wrapped draft', placeholder: 'Message', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend, onExpandedChange };
    const view = render(<Composer {...props} />);
    const nativeInput = view.getByTestId('editor-input');
    fireEvent(view.getByTestId('editor-measurement', { includeHiddenElements: true }), 'textLayout', { nativeEvent: { lines: [{}, {}] } });
    expect(view.queryByTestId('editor-expand')).toBeNull();
    fireEvent(view.getByTestId('editor-measurement', { includeHiddenElements: true }), 'textLayout', { nativeEvent: { lines: [{}, {}, {}] } });
    fireEvent.press(view.getByTestId('editor-expand'));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    view.rerender(<Composer {...props} expanded />);
    expect(view.getByTestId('editor-input')).toBe(nativeInput);
    expect(nativeInput.props.submitBehavior).toBe('newline');
    expect(nativeInput.props.scrollEnabled).toBe(true);
    fireEvent.press(view.getByTestId('editor-collapse'));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    view.rerender(<Composer {...props} />);
    expect(view.getByTestId('editor-input')).toBe(nativeInput);
    expect(flattenStyle(view.getByTestId('editor-input-shell').props.style)).toMatchObject({ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' });
    expect(flattenStyle(view.getByTestId('editor-measurement', { includeHiddenElements: true }).props.style).height).toBe(LineHeight.body * 6);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('counts a trailing Return as its own visual line so the caret line is never clipped', () => {
    const props = { testID: 'editor', value: 'a wrapped draft\n', placeholder: 'Message', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend: jest.fn(), onExpandedChange: jest.fn() };
    const view = render(<Composer {...props} />);
    const measurement = view.getByTestId('editor-measurement', { includeHiddenElements: true });
    // iOS reports only the two laid-out fragments; the empty line holding the caret makes three.
    fireEvent(measurement, 'textLayout', { nativeEvent: { lines: [{ text: 'a wrapped ' }, { text: 'draft\n' }] } });
    expect(view.getByTestId('editor-expand')).toBeTruthy();
    expect(view.getByTestId('editor-input').props.scrollEnabled).toBe(false);
    // Six visible lines exceed the five-line compact cap, so the draft scrolls.
    fireEvent(measurement, 'textLayout', { nativeEvent: { lines: [{}, {}, {}, {}, { text: 'draft\n' }] } });
    expect(view.getByTestId('editor-input').props.scrollEnabled).toBe(true);
    // Android already lists the empty trailing line; it must not be counted twice.
    fireEvent(measurement, 'textLayout', { nativeEvent: { lines: [{}, {}, {}, { text: 'draft\n' }, { text: '' }] } });
    expect(view.getByTestId('editor-input').props.scrollEnabled).toBe(false);
  });
  it('keeps the primary action slot stable and supports attachment-only messages', () => {
    const onSend = jest.fn();
    const props = { testID: 'editor', value: '', placeholder: 'Message', accessibilityLabels: labels,
      onChangeText: jest.fn(), onSend };
    const view = render(<Composer {...props} />);
    expect(view.getByTestId('editor-primary').props.accessibilityState.disabled).toBe(true);
    view.rerender(<Composer {...props} hasAttachments />);
    fireEvent.press(view.getByTestId('editor-primary'));
    expect(onSend).toHaveBeenCalledTimes(1);
    view.rerender(<Composer {...props} hasAttachments canSend={false} />);
    expect(view.getByTestId('editor-primary').props.accessibilityState.disabled).toBe(true);
  });
});

describe('composer slot morph', () => {
  const labels = { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' };
  const props = { testID: 'composer', placeholder: 'Message', accessibilityLabels: labels,
    onChangeText: jest.fn(), onSend: jest.fn(), onStop: jest.fn(), onVoicePress: jest.fn(), onVoiceStart: jest.fn() };
  afterEach(() => { mockReducedMotion = false; });

  it('pops a control in when it replaces another, never the one already on screen', () => {
    const view = render(<Composer {...props} value="" />);
    // The mic was there when the composer mounted: a later re-render does not make it pop.
    view.rerender(<Composer {...props} value="" />);
    expect(view.getByTestId('composer-slot-mic').props.entering).toBeUndefined();
    view.rerender(<Composer {...props} value="Hi" />);
    const entering = view.getByTestId('composer-slot-send').props.entering as () => {
      initialValues: { opacity: number; transform: Array<{ scale: number }> };
    };
    expect(entering().initialValues).toEqual({ opacity: 0, transform: [{ scale: Motion.morph.startScale }] });
    // Sending turns send into stop, which pops in the same way.
    view.rerender(<Composer {...props} value="" isRunning />);
    expect(view.queryByTestId('composer-slot-send')).toBeNull();
    expect(view.getByTestId('composer-slot-stop').props.entering).toBe(entering);
  });

  it('fades a replacing control in place under reduced motion', () => {
    mockReducedMotion = true;
    const view = render(<Composer {...props} value="" />);
    view.rerender(<Composer {...props} value="Hi" />);
    expect(view.getByTestId('composer-slot-send').props.entering).toEqual({ name: 'FadeIn' });
  });

  it('keeps the held voice target mounted while only its surface turns into send', () => {
    const view = render(<Composer {...props} value="" />);
    const target = view.getByTestId('composer-voice');
    fireEvent(target, 'pressIn', { nativeEvent: { pageY: 500 } });
    view.rerender(<Composer {...props} value="" voiceState="listening" />);
    // The finger that started dictation is still down on the same target.
    expect(view.getByTestId('composer-voice')).toBe(target);
    const surface = view.getByTestId('composer-slot-voice-send');
    expect(surface.props.pointerEvents).toBe('none');
    expect(typeof surface.props.entering).toBe('function');
  });
});

describe.each(['light', 'dark'] as const)('%s glass chrome over a wallpaper', (scheme) => {
  beforeEach(() => { mockScheme = scheme; });

  it('floats the compact capsule and circles on translucent chrome and keeps full-screen editing on the canvas', () => {
    const theme = activeTheme(scheme);
    const glass = createChatGlassStyle(theme);
    const labels = { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' };
    const props = { testID: 'composer', placeholder: 'Ask Main', accessibilityLabels: labels, onChangeText: jest.fn(), onSend: jest.fn() };
    const result = render(<Composer {...props} value="Draft" appearance="glass" onAddPress={jest.fn()} />);
    expect(flattenStyle(result.getByTestId('composer-capsule').props.style)).toMatchObject({
      borderRadius: Radius.xl, backgroundColor: glass.backgroundColor,
      borderColor: glass.borderColor, borderWidth: BorderWidth.hairline,
    });
    expect(flattenStyle(result.getByTestId('composer-add-surface').props.style)).toMatchObject({
      backgroundColor: glass.backgroundColor, borderColor: glass.borderColor, borderWidth: BorderWidth.hairline,
    });
    result.rerender(<Composer {...props} value="Draft" appearance="glass" expanded onExpandedChange={jest.fn()} />);
    expect(flattenStyle(result.getByTestId('composer').props.style).backgroundColor).toBe(theme.colors.canvas);
  });

  it('gives glass floating buttons the same chrome as the composer card', () => {
    const theme = activeTheme(scheme);
    const glass = createChatGlassStyle(theme);
    const result = render(<FloatingButton testID="glass-button" icon={ArrowUp} appearance="glass" accessibilityLabel="Back" onPress={jest.fn()} />);
    expect(flattenStyle(result.getByTestId('glass-button').props.style)).toMatchObject({
      width: ControlSize.floatingButton, borderRadius: ControlSize.floatingButton / 2,
      backgroundColor: glass.backgroundColor, borderColor: glass.borderColor, borderWidth: BorderWidth.hairline,
    });
    if (scheme === 'light') expect(flattenStyle(result.getByTestId('glass-button').props.style)).toMatchObject(Shadow.floating);
    else expect(flattenStyle(result.getByTestId('glass-button').props.style)).toMatchObject({ elevation: 0, shadowOpacity: 0 });
  });
});
