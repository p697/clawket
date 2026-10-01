import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { View } from 'react-native';
import { MessageCircle, Search } from 'lucide-react-native';
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
import { ROSTER_ROW_MIN_HEIGHT, RosterRow } from './RosterRow';
import { Skeleton } from './Skeleton';
import { circleBadgeInset } from './StatusDot';
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
    ...require('../../../__mocks__/native-animated'),
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
      cubic: 'cubic',
      inOut: (value: unknown) => value,
      out: (value: unknown) => value,
    },
    FadeIn: { duration: () => 'fade-in' },
    FadeOut: { duration: () => 'fade-out' },
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

  it('wears the official mark in the header pill for a product Agent', () => {
    const result = render(<HeaderPill testID="header-pill" agentId="claude-code" name="Claude Code" subtitle=""
      platform="claude-code" />);
    expect(result.getByTestId('header-pill-avatar-face')).toBeTruthy();
    expect(result.queryByText('CC')).toBeNull();
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

  it('turns an accent ring and says what the Agent is doing while it works', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Running a command…" presence="working" />,
    );
    // The status sentence replaces the idle subtitle, in the conversation accent.
    expect(result.UNSAFE_getByProps({ children: 'Running a command…' }).props.style)
      .toEqual(expect.arrayContaining([expect.objectContaining({ color: theme.colors.accent })]));
    const ring = result.getByTestId('header-pill-working');
    expect(ring.props.pointerEvents).toBe('none');
    expect(ring.findAll((node) => (node.type as unknown) === 'Path')).toHaveLength(1);
    // No avatar badge competes with the ring.
    expect(result.queryByTestId('header-pill-avatar-working')).toBeNull();

    result.rerender(<HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Waiting for your approval" presence="attention" />);
    const attention = result.getByTestId('header-pill-attention');
    expect(attention.findAll((node) => (node.type as unknown) === 'Path')).toHaveLength(0);
    expect(attention.findAll((node) => (node.type as unknown) === 'Circle')[0]?.props.stroke).toBe(theme.colors.warn);
    expect(result.queryByTestId('header-pill-working')).toBeNull();

    result.rerender(<HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Model · 54%" />);
    expect(result.UNSAFE_getByProps({ children: 'Model · 54%' })).toBeTruthy();
    expect(result.queryByTestId('header-pill-working')).toBeNull();
    expect(result.queryByTestId('header-pill-attention')).toBeNull();
  });

  it('fades a new status sentence in as it rises, and fades the ring in and out', () => {
    const { withTiming } = jest.requireMock('react-native-reanimated') as { withTiming: jest.Mock };
    const result = render(<HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Online" />);
    // The sentence on screen when the header appears stays still, even after a re-render.
    result.rerender(<HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Online" />);
    expect(result.getByTestId('header-pill-subtitle-motion').props.entering).toBeUndefined();
    withTiming.mockClear();
    result.rerender(<HeaderPill testID="header-pill" agentId="main" name="Main" subtitle="Thinking…" presence="working" />);
    expect(result.getByTestId('header-pill-subtitle').props.children).toBe('Thinking…');
    // A+ motion: the new words enter from their first frame, 4 points low and transparent, over 200 ms.
    const entering = result.getByTestId('header-pill-subtitle-motion').props.entering as () => { initialValues: unknown };
    expect(entering().initialValues).toEqual({ opacity: 0, transform: [{ translateY: Motion.status.rise }] });
    expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: Motion.status.duration }));
    const ringLayer = result.UNSAFE_getAllByType('AnimatedView' as unknown as React.ComponentType)
      .find((node) => node.props.entering === 'fade-in');
    expect(ringLayer?.props.exiting).toBe('fade-out');
    expect(ringLayer?.findByProps({ testID: 'header-pill-working' })).toBeTruthy();
  });

  it('renders a borderless 84pt roster row with tokenized pressed feedback', () => {
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
        sessionIcon={MessageCircle}
        onPress={jest.fn()}
      />,
    );
    const root = result.getByTestId('roster-row');
    const resting = flattenStyle(root.props.style);

    // Four points tighter than the shared two-line row: 14 above and below the avatar (owner decision 2026-09-27).
    expect(ROSTER_ROW_MIN_HEIGHT).toBe(ControlSize.rosterRow - Space.xs);
    expect(ROSTER_ROW_MIN_HEIGHT - AGENT_AVATAR_METRICS.roster.size).toBe(28);
    expect(resting).toMatchObject({
      minHeight: ROSTER_ROW_MIN_HEIGHT,
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
    expect(result.getByTestId('roster-row-avatar').props.accessibilityLabel).toBe('Owning Agent');
    // A conversation row: a grey badge cut out by a canvas ring on the circle at 45°, and no pin.
    const badge = flattenStyle(result.getByTestId('roster-row-avatar-overlay').props.style);
    expect(badge).toMatchObject({
      width: IconSize.md,
      height: IconSize.md,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.canvas,
      borderWidth: BorderWidth.strong,
    });
    expect(badge.top).toBeCloseTo(circleBadgeInset(AGENT_AVATAR_METRICS.roster.size, IconSize.md));
    expect(badge.right).toBeCloseTo(badge.top as number);
    expect(result.getByTestId('roster-row-avatar-overlay-icon').props.color).toBe(theme.colors.inkSecondary);
    expect(result.queryByTestId('roster-row-pin-icon')).toBeNull();

    // Only a pinned Agent carries the pin glyph.
    const agent = render(<RosterRow testID="pinned-agent" agentId="main" name="Main" preview="Reply" pinned onPress={jest.fn()} />);
    expect(agent.getByTestId('pinned-agent-pin-icon')).toBeTruthy();
    expect(agent.queryByTestId('pinned-agent-avatar-overlay')).toBeNull();
  });

  it('can show an honest unread dot without inventing a message count', () => {
    const result = render(<RosterRow testID="unread" agentId="main" name="Main" preview="Reply"
      unreadCount={1} unreadIndicator="dot" onPress={jest.fn()} />);
    expect(result.getByTestId('unread-unread')).toBeTruthy();
    expect(result.queryByText('1')).toBeNull();
  });

  it('keeps the time on the name line and the marker on the preview line', () => {
    const lineOf = (node: ReactTestInstance): ReactTestInstance | null => {
      let current = node.parent;
      while (current) {
        const style = typeof current.type === 'string' ? flattenStyle(current.props.style) : {};
        if (style.flexDirection === 'row' && style.gap === Space.sm) return current;
        current = current.parent;
      }
      return null;
    };
    const result = render(<RosterRow testID="grid" agentId="main" name="Main" preview="Reply" timeLabel="2h"
      unreadCount={1} unreadIndicator="dot" onPress={jest.fn()} />);
    const nameLine = lineOf(result.getByText('Main'));
    const previewLine = lineOf(result.getByText('Reply'));
    expect(nameLine).not.toBeNull();
    expect(previewLine).not.toBe(nameLine);
    // A badge below the time used to push it up the row; each line now owns its trailing slot.
    expect(lineOf(result.getByTestId('grid-time'))).toBe(nameLine);
    expect(lineOf(result.getByTestId('grid-trailing'))).toBe(previewLine);
    expect(lineOf(result.getByTestId('grid-unread'))).toBe(previewLine);
  });

  it('passes the backend to the avatar: a product face, or a corner badge on an own avatar', () => {
    const product = render(<RosterRow testID="product" agentId="codex" name="Codex" preview="Reply"
      platform="codex" platformBadge onPress={jest.fn()} />);
    expect(product.getByTestId('product-avatar-face')).toBeTruthy();
    expect(product.queryByTestId('product-avatar-platform')).toBeNull();
    const own = render(<RosterRow testID="own" agentId="main" name="Main" emoji="C" preview="Reply"
      platform="openclaw" platformBadge onPress={jest.fn()} />);
    expect(own.getByText('C')).toBeTruthy();
    expect(own.getByTestId('own-avatar-platform')).toBeTruthy();
    const single = render(<RosterRow testID="single" agentId="main" name="Main" preview="Reply"
      platform="openclaw" onPress={jest.fn()} />);
    expect(single.queryByTestId('single-avatar-platform')).toBeNull();
  });

  it('marks a live row on the avatar corner and yields that corner to attention and lock', () => {
    const theme = activeTheme(scheme);
    const row = (patch: Partial<React.ComponentProps<typeof RosterRow>>) => render(
      <RosterRow testID="row" agentId="main" name="Main" preview="Reply" live onPress={jest.fn()} {...patch} />,
    );
    const live = row({});
    const liveDot = flattenStyle(live.getByTestId('row-avatar-live').props.style);
    expect(liveDot).toMatchObject({
      width: 12,
      height: 12,
      backgroundColor: theme.colors.good,
      borderColor: theme.colors.canvas,
      borderWidth: BorderWidth.strong,
    });
    // Centred on the round avatar's edge, not on its box corner (owner feedback 2026-09-27).
    expect(liveDot.right).toBeCloseTo(circleBadgeInset(AGENT_AVATAR_METRICS.roster.size, 12));
    expect(liveDot.bottom).toBeCloseTo(liveDot.right as number);
    live.unmount();

    // The runtime serves the live connection's rows from cache while it reconnects.
    const reconnecting = row({ cached: true, attention: true });
    expect(reconnecting.getByTestId('row-avatar-live')).toBeTruthy();
    expect(reconnecting.queryByTestId('row-avatar-attention')).toBeNull();
    reconnecting.unmount();

    const attention = row({ attention: true });
    expect(attention.getByTestId('row-avatar-attention')).toBeTruthy();
    expect(attention.queryByTestId('row-avatar-live')).toBeNull();
    attention.unmount();

    // One lock per row: the trailing marker, not a second badge on the avatar.
    const locked = row({ locked: true });
    expect(locked.queryByTestId('row-avatar-locked')).toBeNull();
    expect(locked.getByTestId('row-lock-icon')).toBeTruthy();
    expect(locked.queryByTestId('row-avatar-live')).toBeNull();
    locked.unmount();

    const quiet = row({ live: false });
    expect(quiet.queryByTestId('row-avatar-live')).toBeNull();
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

  it('centres corner badges on the avatar circle at 45 degrees for every avatar size', () => {
    for (const { size } of Object.values(AGENT_AVATAR_METRICS)) {
      for (const badge of [12, 16]) {
        const inset = circleBadgeInset(size, badge);
        const centreOffset = size - inset - badge / 2 - size / 2;
        expect(Math.SQRT2 * centreOffset).toBeCloseTo(size / 2);
      }
    }
    // A roster avatar's ring now cuts a notch: the dot's centre is on the edge, 2 points inside the box.
    expect(circleBadgeInset(56, 12)).toBeCloseTo(2.2, 1);

    const locked = render(<AgentAvatar testID="lock" agentId="main" name="Main" status="locked" />);
    const lockBadge = flattenStyle(locked.getByTestId('lock-locked').props.style);
    expect(lockBadge.right).toBeCloseTo(circleBadgeInset(56, Space.lg));
    expect(lockBadge.bottom).toBeCloseTo(circleBadgeInset(56, Space.lg));
    const attention = render(<AgentAvatar testID="sheet" agentId="main" name="Main" variant="sheet" status="attention" />);
    expect(flattenStyle(attention.getByTestId('sheet-attention').props.style).right)
      .toBeCloseTo(circleBadgeInset(AGENT_AVATAR_METRICS.sheet.size, 12));
  });

  it('paints a mounted live dot at once and fades one in when an Agent becomes live', () => {
    const mounted = render(<AgentAvatar testID="live-avatar" agentId="main" name="Main" status="live" />);
    const layer = mounted.UNSAFE_root.findAll((node) => String(node.type) === 'AnimatedView')[0];
    expect(flattenStyle(layer?.props.style).opacity).toBe(1);
    expect(mounted.getByTestId('live-avatar-live')).toBeTruthy();
    // The dot sits outside the fill, so offline/locked desaturation never greys it.
    expect(flattenStyle(mounted.getByTestId('live-avatar-fill').props.style).filter).toBeUndefined();

    const later = render(<AgentAvatar testID="later" agentId="main" name="Main" status="idle" />);
    expect(later.queryByTestId('later-live')).toBeNull();
    mockWithTiming.mockClear();
    later.rerender(<AgentAvatar testID="later" agentId="main" name="Main" status="live" />);
    expect(later.getByTestId('later-live')).toBeTruthy();
    expect(mockWithTiming).toHaveBeenCalledWith(1, { duration: Motion.duration.normal });
    later.rerender(<AgentAvatar testID="later" agentId="main" name="Main" status="idle" />);
    expect(later.queryByTestId('later-live')).toBeNull();
  });

  it('wears the official mark as the face of a product Agent', () => {
    const theme = activeTheme('light');
    const face = render(<AgentAvatar testID="cc" agentId="claude-code" name="Claude Code" emoji="C"
      avatarUrl="https://cdn.example.invalid/a.png" platform="claude-code" />);
    expect(face.getByTestId('cc-face')).toBeTruthy();
    // The adapter-assigned emoji, initials and image give way to the product's own mark.
    expect(face.queryByText('C')).toBeNull();
    expect(face.queryByText('CC')).toBeNull();
    expect(face.queryByTestId('cc-image')).toBeNull();
    expect(flattenStyle(face.getByTestId('cc-fill').props.style).backgroundColor).toBe(theme.colors.surfaceFloating);
    // A hairline edge keeps the white face from dissolving into the canvas.
    const edges = face.UNSAFE_root.findAll((node) => typeof node.type === 'string'
      && flattenStyle(node.props.style).borderColor === theme.colors.line
      && flattenStyle(node.props.style).borderWidth === 1);
    expect(edges).toHaveLength(1);

    for (const platform of ['codex', 'pi', 'hermes', 'local-model'] as const) {
      const other = render(<AgentAvatar testID="p" agentId={platform} name={platform} platform={platform} />);
      expect(other.getByTestId('p-face')).toBeTruthy();
      other.unmount();
    }
    // OpenClaw Agents and YouMind Sprites keep their own faces.
    for (const platform of ['openclaw', 'youmind'] as const) {
      const own = render(<AgentAvatar testID="own" agentId="main" name="Main" emoji="C" platform={platform} />);
      expect(own.queryByTestId('own-face')).toBeNull();
      expect(own.getByText('C')).toBeTruthy();
      own.unmount();
    }
    const offline = render(<AgentAvatar testID="off" agentId="codex" name="Codex" platform="codex" status="offline" />);
    expect(flattenStyle(offline.getByTestId('off-fill').props.style).filter).toEqual([{ saturate: 0.4 }]);
  });

  it('carries the backend badge on an own avatar and yields its corner to lock and attention', () => {
    const theme = activeTheme('light');
    const badge = render(<AgentAvatar testID="oc" agentId="main" name="Main" platform="openclaw" platformBadge />);
    const ring = flattenStyle(badge.getByTestId('oc-platform').props.style);
    // A canvas disc behind the mark cuts it out of the avatar, centred on the circle at 45°.
    expect(ring).toMatchObject({ width: Space.xl, height: Space.xl, borderRadius: Radius.full, backgroundColor: theme.colors.canvas });
    expect(ring.right).toBeCloseTo(circleBadgeInset(AGENT_AVATAR_METRICS.roster.size, Space.xl));
    expect(ring.bottom).toBeCloseTo(ring.right as number);
    // Grey, not white: a white disc vanished on the canvas (owner feedback 2026-09-27).
    expect(flattenStyle(badge.getByTestId('oc-platform-mark').props.style)).toMatchObject({
      width: IconSize.md, height: IconSize.md, borderRadius: Radius.full, backgroundColor: theme.colors.surface,
    });
    expect(badge.queryByTestId('oc-platform-live')).toBeNull();
    expect(badge.queryByTestId('oc-live')).toBeNull();

    // The live connection's badge rings in green instead of adding the separate dot.
    const live = render(<AgentAvatar testID="live" agentId="main" name="Main" platform="openclaw" platformBadge status="live" />);
    expect(flattenStyle(live.getByTestId('live-platform-live').props.style).backgroundColor).toBe(theme.colors.good);
    expect(live.queryByTestId('live-live')).toBeNull();

    const attention = render(<AgentAvatar testID="att" agentId="main" name="Main" platform="openclaw" platformBadge status="attention" />);
    expect(attention.queryByTestId('att-platform')).toBeNull();
    expect(attention.getByTestId('att-attention')).toBeTruthy();
    const locked = render(<AgentAvatar testID="lock" agentId="main" name="Main" platform="openclaw" platformBadge status="locked" />);
    expect(locked.queryByTestId('lock-platform')).toBeNull();
    expect(locked.getByTestId('lock-locked')).toBeTruthy();
    // Without its own lock badge the corner goes back to the backend mark.
    locked.rerender(<AgentAvatar testID="lock" agentId="main" name="Main" platform="openclaw" platformBadge status="locked" lockBadge={false} />);
    expect(locked.queryByTestId('lock-locked')).toBeNull();
    expect(locked.getByTestId('lock-platform')).toBeTruthy();

    // A product face already is the mark, so it keeps the plain live dot.
    const face = render(<AgentAvatar testID="face" agentId="codex" name="Codex" platform="codex" platformBadge status="live" />);
    expect(face.queryByTestId('face-platform')).toBeNull();
    expect(face.getByTestId('face-live')).toBeTruthy();
    // Without a backend there is nothing to mark.
    const unknown = render(<AgentAvatar testID="none" agentId="main" name="Main" platformBadge />);
    expect(unknown.queryByTestId('none-platform')).toBeNull();
  });

  it('stops skeleton pulse animation when reduced motion is enabled', () => {
    mockReducedMotion = true;
    mockWithRepeat.mockClear();
    const result = render(<Skeleton testID="reduced-skeleton" />);
    expect(flattenStyle(result.getByTestId('reduced-skeleton').props.style).opacity).toBe(1);
    expect(mockWithRepeat).not.toHaveBeenCalled();
  });
});
