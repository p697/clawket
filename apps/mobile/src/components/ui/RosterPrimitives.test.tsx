import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { Search } from 'lucide-react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Shadow,
  Space,
} from '../../theme/tokens';
import {
  AgentAvatar,
  AGENT_AVATAR_METRICS,
  getAgentInitials,
  getAgentPaletteIndex,
} from './AgentAvatar';
import { Banner } from './Banner';
import { Card } from './Card';
import { FloatingButton, FLOATING_BUTTON_ICON_SIZE } from './FloatingButton';
import { HeaderPill } from './HeaderPill';
import { createChatGlassStyle } from '../../features/chat-appearance/resolver';
import { Companion } from './Companion';
import { ProEntryButton, PRO_ENTRY_COMPANION_SIZE, PRO_ENTRY_HEIGHT, PRO_ENTRY_HIT_SLOP } from './ProEntryButton';
import { RosterRow } from './RosterRow';
import { Skeleton } from './Skeleton';
import { SystemEventRow, SYSTEM_EVENT_ICON_SIZE } from './SystemEventRow';

let mockScheme: 'light' | 'dark' = 'light';
let mockReducedMotion = false;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Image: primitive('Image'),
    Pressable: primitive('Pressable'),
    StyleSheet: {
      absoluteFill: {},
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
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
    default: {
      View: animatedPrimitive('AnimatedView'),
      Text: animatedPrimitive('AnimatedText'),
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
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: jest.fn((_delay: number, value: unknown) => value),
    withRepeat: jest.fn((value: unknown) => value),
    withTiming: jest.fn((value: unknown) => value),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return {
    Bot: icon('Bot'),
    ChevronRight: icon('ChevronRight'),
    Clock3: icon('Clock3'),
    Lock: icon('Lock'),
    MessageCircle: icon('MessageCircle'),
    Pin: icon('Pin'),
    Radio: icon('Radio'),
    Search: icon('Search'),
    UsersRound: icon('UsersRound'),
  };
});

jest.mock('./Companion', () => {
  const ReactRuntime = require('react');
  return { Companion: (props: Record<string, unknown>) => ReactRuntime.createElement('Companion', props) };
});

jest.mock('../../theme', () => {
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return {
    useAppTheme: () => ({
      theme: createTheme(mockScheme, mockScheme, accents.iceBlue),
    }),
  };
});

const reanimatedMock = jest.requireMock('react-native-reanimated') as {
  interpolateColor: jest.Mock;
  withDelay: jest.Mock;
  withRepeat: jest.Mock;
  withTiming: jest.Mock;
};
const mockInterpolateColor = reanimatedMock.interpolateColor;
const mockWithDelay = reanimatedMock.withDelay;
const mockWithRepeat = reanimatedMock.withRepeat;
const mockWithTiming = reanimatedMock.withTiming;

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

describe.each(['light', 'dark'] as const)('%s roster primitives', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
    mockReducedMotion = false;
    mockWithDelay.mockClear();
    mockInterpolateColor.mockClear();
    mockWithRepeat.mockClear();
    mockWithTiming.mockClear();
  });

  it('renders floating chrome from canonical tokens without Android ripple', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <FloatingButton
        testID="floating"
        icon={Search}
        onPress={jest.fn()}
        accessibilityLabel="Search"
        badge={{ tone: 'bad', count: 120 }}
      />,
    );
    const root = result.getByTestId('floating');
    const style = flattenStyle(root.props.style);

    expect(style).toMatchObject({
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
      borderRadius: ControlSize.floatingButton / 2,
      backgroundColor: 'transparent',
    });
    expect(root.props.android_ripple).toBeUndefined();
    expect(result.UNSAFE_getByType(Search).props).toMatchObject({
      size: FLOATING_BUTTON_ICON_SIZE,
      color: theme.colors.ink,
      strokeWidth: 1.75,
    });
    expect(result.getByText('99+')).toBeTruthy();
    expect(flattenStyle(result.getByTestId('floating-badge').props.style).backgroundColor).toBe(theme.colors.bad);
    expect(style.shadowOpacity ?? 0).toBe(0);
    expect(style.borderWidth ?? 0).toBe(0);

    const inkResult = render(
      <FloatingButton
        testID="ink-floating"
        icon={Search}
        onPress={jest.fn()}
        accessibilityLabel="Stop"
        appearance="ink"
        badge={{ tone: 'accent' }}
      />,
    );
    expect(flattenStyle(inkResult.getByTestId('ink-floating').props.style).backgroundColor).toBe(theme.colors.ink);
    expect(inkResult.UNSAFE_getByType(Search).props.color).toBe(theme.colors.canvas);
    expect(flattenStyle(inkResult.getByTestId('ink-floating-badge').props.style).backgroundColor).toBe(theme.colors.accent);
  });

  it('renders the Pro entry as a 32pt ink capsule with a 44pt target and the inverse curious Companion', () => {
    const theme = activeTheme(scheme);
    const onPress = jest.fn();
    const result = render(
      <ProEntryButton
        testID="pro-entry"
        label="Pro"
        accessibilityLabel="View Pro"
        onPress={onPress}
      />,
    );
    const root = result.getByTestId('pro-entry');
    const style = flattenStyle(root.props.style);

    expect(root.props.accessibilityRole).toBe('button');
    expect(root.props.accessibilityLabel).toBe('View Pro');
    expect(PRO_ENTRY_HEIGHT).toBe(32);
    expect(root.props.hitSlop).toBe(PRO_ENTRY_HIT_SLOP);
    expect(PRO_ENTRY_HEIGHT + 2 * PRO_ENTRY_HIT_SLOP).toBe(ControlSize.floatingButton);
    expect(PRO_ENTRY_COMPANION_SIZE).toBe(IconSize.md);
    expect(style).toMatchObject({
      height: PRO_ENTRY_HEIGHT,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.ink,
      paddingLeft: Space.sm,
      paddingRight: Space.md,
      gap: Space.sm,
    });
    if (scheme === 'dark') {
      expect(style).toMatchObject({ borderWidth: BorderWidth.hairline, borderColor: theme.colors.line });
    } else {
      expect(style).toMatchObject({ shadowOpacity: Shadow.floating.shadowOpacity });
    }
    expect(result.UNSAFE_getByType(Companion).props).toMatchObject({
      testID: 'pro-entry-companion',
      size: PRO_ENTRY_COMPANION_SIZE,
      pose: 'curious',
      tone: 'inverse',
    });
    expect(flattenStyle(result.getByText('Pro').props.style)).toMatchObject({
      color: theme.colors.canvas,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    });

    fireEvent(root, 'pressIn');
    fireEvent(root, 'pressOut');
    fireEvent.press(root);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockWithTiming).toHaveBeenCalledWith(Motion.pressedScale, { duration: Motion.duration.fast });
  });

  it('renders the header pill at 40pt with a 28pt Agent avatar', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <HeaderPill
        testID="header-pill"
        agentId="main"
        name="Main"
        subtitle="Model · 54%"
        onPress={jest.fn()}
      />,
    );
    const root = result.getByTestId('header-pill');
    const style = flattenStyle(root.props.style);
    const avatarStyle = flattenStyle(result.getByTestId('header-pill-avatar').props.style);

    expect(style).toMatchObject({
      height: ControlSize.pill,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.surface,
    });
    expect(avatarStyle).toMatchObject({
      width: AGENT_AVATAR_METRICS.header.size,
      height: AGENT_AVATAR_METRICS.header.size,
    });
    expect(root.props.android_ripple).toBeUndefined();
  });

  it('floats the header pill on glass over a wallpaper', () => {
    const theme = activeTheme(scheme);
    const glass = createChatGlassStyle(theme);
    const result = render(
      <HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Model · 54%" material="glass" onPress={jest.fn()} />,
    );
    expect(flattenStyle(result.getByTestId('header-pill').props.style)).toMatchObject({
      height: ControlSize.pill, borderRadius: Radius.full,
      backgroundColor: glass.backgroundColor, borderColor: glass.borderColor,
    });
  });

  it('replaces the header subtitle with lifting dots while the Agent works', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Thinking…" working />,
    );
    expect(result.queryByText('Thinking…')).toBeNull();
    const dots = result.getByTestId('header-pill-working');
    expect(dots.props.accessibilityRole).toBe('progressbar');
    expect(result.getAllByTestId(/typing-dot-\d/)).toHaveLength(3);
    expect(flattenStyle(result.getByTestId('typing-dot-0').props.style)).toMatchObject({
      width: Space.xs,
      height: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.inkSecondary,
    });
    // No avatar badge competes with the dots.
    expect(result.queryByTestId('header-pill-avatar-working')).toBeNull();

    result.rerender(<HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Model · 54%" />);
    // The subtitle is an Animated.Text host in this mock, so match it by props.
    expect(result.UNSAFE_getByProps({ children: 'Model · 54%' })).toBeTruthy();
    expect(result.queryByTestId('header-pill-working')).toBeNull();
  });

  it('renders a borderless 88pt roster row with tokenized pressed feedback', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <RosterRow
        testID="roster-row"
        agentId="main"
        name="Main"
        avatarName="Owning Agent"
        emoji="C"
        preview="Latest message"
        timeLabel="2h"
        pinned
        sessionKind="channel"
        onPress={jest.fn()}
      />,
    );
    const root = result.getByTestId('roster-row');
    const resting = flattenStyle(root.props.style);

    expect(resting).toMatchObject({
      minHeight: ControlSize.rosterRow,
      backgroundColor: theme.colors.canvas,
    });
    expect(resting.height).toBeUndefined();
    expect(mockInterpolateColor).toHaveBeenCalledWith(
      0,
      [0, 1],
      [theme.colors.canvas, theme.colors.surface],
    );
    root.props.onPressIn();
    expect(mockWithTiming).toHaveBeenCalledWith(1, { duration: Motion.duration.fast });
    root.props.onPressOut();
    expect(mockWithTiming).toHaveBeenCalledWith(0, { duration: Motion.duration.fast });
    expect(resting).not.toHaveProperty('borderWidth');
    expect(resting).not.toHaveProperty('borderColor');
    expect(root.props.android_ripple).toBeUndefined();
    expect(result.getByTestId('roster-row-pin-icon')).toBeTruthy();
    expect(result.getByTestId('roster-row-avatar').props.accessibilityLabel).toBe('Owning Agent');
    expect(result.getByTestId('roster-row-avatar-overlay')).toBeTruthy();
    expect(result.getByTestId('roster-row-avatar-overlay-icon')).toBeTruthy();
  });

  it('can show an honest unread dot without inventing a message count', () => {
    const result = render(<RosterRow testID="unread" agentId="main" name="Main" preview="Reply"
      unreadCount={1} unreadIndicator="dot" onPress={jest.fn()} />);
    expect(result.getByTestId('unread-unread')).toBeTruthy();
    expect(result.queryByText('1')).toBeNull();
  });

  it('shows cached activity time and lock state without stale attention or unread badges', () => {
    const result = render(
      <RosterRow
        testID="cached-row"
        agentId="main"
        name="Main"
        preview="Cached message"
        timeLabel="2h"
        unreadCount={8}
        attention
        cached
        locked
        accessibilityLabel="Main, Last synced"
        onPress={jest.fn()}
      />,
    );

    expect(result.getByTestId('cached-row-lock-icon')).toBeTruthy();
    expect(result.getByTestId('cached-row-time').props.children).toBe('2h');
    expect(result.getByTestId('cached-row').props.accessibilityLabel).toBe('Main, Last synced');
    expect(result.queryByTestId('cached-row-attention')).toBeNull();
    expect(result.queryByTestId('cached-row-unread')).toBeNull();
  });

  it('renders system events, skeletons, and banners with canonical semantic colors', () => {
    const theme = activeTheme(scheme);
    const eventResult = render(
      <SystemEventRow testID="event" icon={Search} label="Run completed" onPress={jest.fn()} />,
    );
    const eventStyle = flattenStyle(eventResult.getByTestId('event').props.style);
    expect(eventStyle.paddingVertical).toBe(12);
    expect(eventResult.UNSAFE_getByType(Search).props).toMatchObject({
      size: SYSTEM_EVENT_ICON_SIZE,
      color: theme.colors.inkSecondary,
    });
    expect(eventResult.getByTestId('event-disclosure')).toBeTruthy();

    const skeletonResult = render(<Skeleton testID="skeleton" />);
    expect(flattenStyle(skeletonResult.getByTestId('skeleton').props.style)).toMatchObject({
      minHeight: LineHeight.caption,
      borderRadius: Radius.card,
      backgroundColor: theme.colors.surface,
    });

    const warnResult = render(
      <Banner testID="warn" message="Offline" actionLabel="Reconnect" onAction={jest.fn()} />,
    );
    expect(flattenStyle(warnResult.getByTestId('warn').props.style)).toMatchObject({
      minHeight: ControlSize.floatingButton,
      borderRadius: Radius.card,
      backgroundColor: theme.colors.surface,
    });
    const retry = jest.fn();
    const neutral = render(<Banner testID="neutral" tone="neutral" message="Offline" actionLabel="Retry" onAction={retry} />);
    expect(flattenStyle(neutral.getByTestId('neutral').props.style).backgroundColor).toBe(theme.colors.surface);
    fireEvent.press(neutral.getByTestId('neutral-action'));
    expect(retry).toHaveBeenCalledTimes(1);
    const badResult = render(<Banner testID="bad" tone="bad" message="Connection failed" />);
    expect(flattenStyle(badResult.getByTestId('bad').props.style).backgroundColor).toBe(theme.colors.badSoft);
  });

  it('keeps Card on one canonical surface after removing tone variants', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <Card onPress={jest.fn()} padding="lg">
        <View testID="card-content" />
      </Card>,
    );
    const root = result.UNSAFE_root.findAll(
      (node: typeof result.UNSAFE_root) => flattenStyle(node.props.style).padding === Space.lg,
    )[0];

    expect(root).toBeDefined();
    expect(flattenStyle(root!.props.style)).toMatchObject({
      padding: Space.lg,
      borderRadius: Radius.card,
      backgroundColor: theme.colors.surface,
    });
  });
});

describe('AgentAvatar states and motion', () => {
  beforeEach(() => {
    mockScheme = 'light';
    mockReducedMotion = false;
    mockWithDelay.mockClear();
    mockInterpolateColor.mockClear();
    mockWithRepeat.mockClear();
    mockWithTiming.mockClear();
  });

  it('uses deterministic palette indices and one-to-two character initials', () => {
    expect(getAgentPaletteIndex('agent-main')).toBe(getAgentPaletteIndex('agent-main'));
    expect(getAgentPaletteIndex('agent-main')).toBeGreaterThanOrEqual(0);
    expect(getAgentPaletteIndex('agent-main')).toBeLessThan(8);
    expect(getAgentInitials('Ada Lovelace')).toBe('AL');
    expect(getAgentInitials('助手')).toBe('助');
    expect(getAgentInitials('小助手 二号')).toBe('小二');
    expect(getAgentInitials('Bo')).toBe('BO');
    expect(getAgentInitials('   ')).toBe('');
  });

  it('renders an image avatar with initials as its fallback and preserves an explicit emoji', () => {
    const image = render(
      <AgentAvatar
        testID="sprite-avatar"
        agentId="sprite"
        name="Sprite"
        avatarUrl=" https://cdn.example.invalid/sprite.png "
      />,
    );
    expect(image.getByTestId('sprite-avatar-image').props.source).toEqual({
      uri: 'https://cdn.example.invalid/sprite.png',
    });
    expect(image.getByText('SP')).toBeTruthy();

    image.rerender(
      <AgentAvatar
        testID="sprite-avatar"
        agentId="sprite"
        name="Sprite"
        emoji="✨"
        avatarUrl="https://cdn.example.invalid/sprite.png"
      />,
    );
    expect(image.queryByTestId('sprite-avatar-image')).toBeNull();
    expect(image.getByText('✨')).toBeTruthy();
  });

  it('keeps working avatars free of activity badges and rotating rings', () => {
    const result = render(<AgentAvatar testID="avatar" agentId="main" name="Main" status="working" />);
    expect(result.queryByTestId('avatar-working-ring')).toBeNull();
    expect(result.queryByTestId('avatar-working')).toBeNull();
    expect(mockWithRepeat).not.toHaveBeenCalled();
    result.rerender(<AgentAvatar testID="avatar" agentId="main" name="Main" status="idle" />);
    expect(result.queryByTestId('avatar-working')).toBeNull();
    mockReducedMotion = true;
    result.rerender(<AgentAvatar testID="avatar" agentId="main" name="Main" status="working" />);
    expect(result.queryByTestId('avatar-working')).toBeNull();
    expect(mockWithRepeat).not.toHaveBeenCalled();
  });

  it('renders attention, done, offline, and locked states', () => {
    const theme = activeTheme('light');
    const attention = render(
      <AgentAvatar
        testID="attention-avatar"
        agentId="main"
        name="Main"
        status="attention"
        attentionTone="bad"
      />,
    );
    expect(flattenStyle(attention.getByTestId('attention-avatar-attention').props.style)).toMatchObject({
      width: 12,
      height: 12,
      backgroundColor: theme.colors.bad,
      borderColor: theme.colors.canvas,
      borderWidth: BorderWidth.strong,
    });

    const done = render(
      <AgentAvatar testID="done-avatar" agentId="main" name="Main" status="done" />,
    );
    expect(flattenStyle(done.getByTestId('done-avatar-done').props.style).backgroundColor).toBe(theme.colors.good);
    expect(mockWithDelay).toHaveBeenCalledWith(Motion.avatarDoneFade, expect.anything());

    const offline = render(
      <AgentAvatar testID="offline-avatar" agentId="main" name="Main" status="offline" />,
    );
    expect(flattenStyle(offline.getByTestId('offline-avatar-fill').props.style).filter).toEqual([{ saturate: 0.4 }]);

    const locked = render(
      <AgentAvatar testID="locked-avatar" agentId="main" name="Main" status="locked" />,
    );
    expect(locked.getByTestId('locked-avatar-locked')).toBeTruthy();
    expect(flattenStyle(locked.getByTestId('locked-avatar-fill').props.style).filter).toEqual([{ saturate: 0.4 }]);
  });

  it('stops skeleton pulse animation when reduced motion is enabled', () => {
    mockReducedMotion = true;
    mockWithRepeat.mockClear();
    const result = render(<Skeleton testID="reduced-skeleton" />);
    expect(flattenStyle(result.getByTestId('reduced-skeleton').props.style).opacity).toBe(1);
    expect(mockWithRepeat).not.toHaveBeenCalled();
  });
});
