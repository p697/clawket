import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { CHAT_WALLPAPER_DRIFT_SCALE, chatWallpaperDriftPosition, chatWallpaperPalettes } from '../../theme/chat-wallpaper';
import { Motion } from '../../theme/tokens';
import { ChatWallpaper } from './ChatWallpaper';

let mockReducedMotion = false;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  const flatten = (style: unknown): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const append = (value: unknown): void => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(append);
      else if (typeof value === 'object') Object.assign(result, value);
    };
    append(style);
    return result;
  };
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    StyleSheet: {
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      create: <T,>(styles: T) => styles,
      flatten,
    },
    View: primitive('View'),
  };
});

// Shared values keep their identity across renders, and a timing animation is
// a marker object, so a test can tell a glide from a jump.
jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const View = ({ children, ...props }: { children?: React.ReactNode }) => ReactRuntime.createElement('AnimatedView', props, children);
  return {
    __esModule: true,
    default: { View },
    Easing: { bezier: (...points: number[]) => ({ bezier: points }) },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (initial: unknown) => ReactRuntime.useState(() => ({ value: initial }))[0],
    withTiming: (toValue: number, config: unknown) => ({ toValue, config }),
  };
});

const palette = chatWallpaperPalettes.iceBlue.light;
const size = { width: 400, height: 800 };
const travel = CHAT_WALLPAPER_DRIFT_SCALE - 1;

function translate(view: ReturnType<typeof render>) {
  const style = StyleSheet.flatten(view.getByTestId('wallpaper-gradient').props.style) as {
    transform: [{ translateX: unknown }, { translateY: unknown }];
  };
  return { x: style.transform[0].translateX, y: style.transform[1].translateY };
}

function layout(view: ReturnType<typeof render>) {
  fireEvent(view.getByTestId('wallpaper'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...size } } });
}

beforeEach(() => { mockReducedMotion = false; });

it('places the first window at once, glides one step per send, and an unrelated render never cuts the glide short', () => {
  const view = render(<ChatWallpaper testID="wallpaper" palette={palette} driftStep={0} />);
  act(() => layout(view));
  view.rerender(<ChatWallpaper testID="wallpaper" palette={{ ...palette }} driftStep={0} />);
  const rest = translate(view);
  expect([rest.x, rest.y].map((offset) => Math.abs(offset as number))).toEqual([0, 0]);

  view.rerender(<ChatWallpaper testID="wallpaper" palette={palette} driftStep={1} />);
  // The effect starts the glide after this render; the next render shows it.
  view.rerender(<ChatWallpaper testID="wallpaper" palette={{ ...palette }} driftStep={1} />);
  const [px, py] = chatWallpaperDriftPosition(1);
  const glide = translate(view);
  expect(glide.x).toEqual({ toValue: -px * travel * size.width, config: expect.objectContaining({ duration: Motion.wallpaper.duration }) });
  expect(glide.y).toEqual({ toValue: -py * travel * size.height, config: expect.objectContaining({ duration: Motion.wallpaper.duration }) });
  // A render with a new palette object mid-glide leaves the glide in flight.
  view.rerender(<ChatWallpaper testID="wallpaper" palette={{ ...palette }} driftStep={1} />);
  expect(translate(view)).toEqual(glide);
});

it('rests at the first window under reduced motion', () => {
  mockReducedMotion = true;
  const view = render(<ChatWallpaper testID="wallpaper" palette={palette} driftStep={3} />);
  act(() => layout(view));
  view.rerender(<ChatWallpaper testID="wallpaper" palette={palette} driftStep={4} />);
  view.rerender(<ChatWallpaper testID="wallpaper" palette={palette} driftStep={4} />);
  expect(translate(view)).toEqual({ x: -0, y: -0 });
});
