import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { ControlSize, FontSize, IconSize, Radius, Shadow, Space } from '../../theme/tokens';
import {
  ConnectionStatusPill,
  CONNECTION_STATUS_PILL_HIT_SLOP,
} from './ConnectionStatusPill';

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
    Pressable: primitive('Pressable'),
    StyleSheet: {
      absoluteFillObject: {},
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return {
    CircleAlert: icon('CircleAlert'),
    WifiOff: icon('WifiOff'),
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const animatedHost = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  const layoutAnimation = (name: string) => {
    const animation: Record<string, unknown> = { name };
    for (const method of ['duration', 'delay', 'easing', 'reduceMotion']) animation[method] = () => animation;
    return animation;
  };
  return {
    __esModule: true,
    default: {
      View: animatedHost('AnimatedView'),
      Text: animatedHost('AnimatedText'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    cancelAnimation: jest.fn(),
    Easing: {
      ease: 'ease',
      cubic: 'cubic',
      inOut: (value: unknown) => value,
      out: (value: unknown) => value,
    },
    FadeIn: layoutAnimation('FadeIn'),
    FadeOut: layoutAnimation('FadeOut'),
    ReduceMotion: { Always: 'always', Never: 'never', System: 'system' },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (value: unknown) => ({ value }),
    withRepeat: jest.fn((value: unknown) => value),
    withTiming: jest.fn((value: unknown) => value),
  };
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

const reanimatedMock = jest.requireMock('react-native-reanimated') as { withRepeat: jest.Mock };

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

describe.each(['light', 'dark'] as const)('%s ConnectionStatusPill', (scheme) => {
  const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);

  beforeEach(() => {
    mockScheme = scheme;
    mockReducedMotion = false;
    reanimatedMock.withRepeat.mockClear();
  });

  it('renders offline as a 40pt inline capsule whose whole body is the 44pt action', () => {
    const onAction = jest.fn();
    const view = render(
      <ConnectionStatusPill
        testID="pill"
        placement="inline"
        status="offline"
        message="Offline · reconnecting"
        actionLabel="Reconnect"
        onAction={onAction}
      />,
    );
    const action = view.getByTestId('pill-action');
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toBe('Offline · reconnecting, Reconnect');
    expect(action.props.hitSlop).toEqual({
      top: CONNECTION_STATUS_PILL_HIT_SLOP,
      bottom: CONNECTION_STATUS_PILL_HIT_SLOP,
    });
    expect(CONNECTION_STATUS_PILL_HIT_SLOP * 2 + ControlSize.pill).toBe(ControlSize.floatingButton);
    expect(flattenStyle(action.props.style)).toMatchObject({
      height: ControlSize.pill,
      borderRadius: Radius.full,
      paddingHorizontal: Space.md,
      backgroundColor: theme.colors.surface,
    });
    expect(flattenStyle(action.props.style)).not.toHaveProperty('position');
    expect(view.UNSAFE_getByType(require('lucide-react-native').WifiOff).props).toMatchObject({
      size: IconSize.sm,
      color: theme.colors.inkSecondary,
    });
    expect(flattenStyle(view.getByTestId('pill-message').props.style)).toMatchObject({
      fontSize: FontSize.caption,
      color: theme.colors.ink,
    });
    expect(view.getByText('Reconnect')).toBeTruthy();
    fireEvent.press(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(reanimatedMock.withRepeat).not.toHaveBeenCalled();
  });

  it('floats over content on the lifted surface without taking layout space', () => {
    const view = render(
      <ConnectionStatusPill testID="pill" status="error" message="Pairing required" actionLabel="Pair again" onAction={jest.fn()} />,
    );
    expect(flattenStyle(view.getByTestId('pill').props.style)).toMatchObject({
      position: 'absolute',
      top: Space.sm,
      left: 0,
      right: 0,
      alignItems: 'center',
    });
    expect(view.getByTestId('pill').props.pointerEvents).toBe('box-none');
    const capsule = flattenStyle(view.getByTestId('pill-action').props.style);
    expect(capsule.backgroundColor).toBe(theme.colors.surfaceFloating);
    if (scheme === 'light') {
      expect(capsule).toMatchObject({ shadowOpacity: Shadow.floating.shadowOpacity });
    } else {
      expect(capsule).toMatchObject({ borderColor: theme.colors.line, shadowOpacity: 0 });
    }
    expect(view.UNSAFE_getByType(require('lucide-react-native').CircleAlert).props.color).toBe(theme.colors.bad);
  });

  it('breathes the reconnecting label on the skeleton cadence, carries no action, and rests under reduced motion', () => {
    const view = render(
      <ConnectionStatusPill testID="pill" placement="inline" status="reconnecting" message="Reconnecting…" />,
    );
    expect(view.queryByTestId('pill-action')).toBeNull();
    expect(view.getByText('Reconnecting…')).toBeTruthy();
    expect(view.UNSAFE_queryByType(require('lucide-react-native').WifiOff)).toBeNull();
    expect(reanimatedMock.withRepeat).toHaveBeenCalledTimes(1);
    expect(reanimatedMock.withRepeat).toHaveBeenCalledWith(expect.anything(), -1, true);
    view.unmount();

    mockReducedMotion = true;
    reanimatedMock.withRepeat.mockClear();
    const still = render(
      <ConnectionStatusPill testID="pill" placement="inline" status="reconnecting" message="Reconnecting…" />,
    );
    expect(reanimatedMock.withRepeat).not.toHaveBeenCalled();
    expect(still.getByTestId('pill').props.entering).toBeUndefined();
  });

  it('keeps the full status in the accessibility label when the chrome only shows the action', () => {
    const view = render(
      <ConnectionStatusPill
        testID="pill"
        placement="inline"
        status="offline"
        actionLabel="Reconnect"
        accessibilityLabel="Offline · reconnecting, Reconnect"
        onAction={jest.fn()}
      />,
    );
    expect(view.queryByTestId('pill-message')).toBeNull();
    expect(view.getByTestId('pill-action').props.accessibilityLabel).toBe('Offline · reconnecting, Reconnect');
  });

  it('reads as text when a message has no action to take', () => {
    const view = render(
      <ConnectionStatusPill testID="pill" placement="inline" status="offline" message="Offline · showing cached results" />,
    );
    expect(view.queryByTestId('pill-action')).toBeNull();
    expect(view.getByText('Offline · showing cached results')).toBeTruthy();
    expect(view.getByLabelText('Offline · showing cached results').props.accessibilityRole).toBe('text');
  });
});
