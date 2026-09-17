import React from 'react';
import { act, render } from '@testing-library/react-native';
import { withRepeat, cancelAnimation } from 'react-native-reanimated';
import { Companion, CURIOUS_CHOREOGRAPHY, choreographyLength } from './Companion';
import { Motion } from '../../theme/tokens';
import { LoadingState } from './LoadingState';

let mockReducedMotion = false;
let mockLifecycle: (state: string) => void;
const mockRemove = jest.fn();
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: any) => ReactRuntime.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'),
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, flatten: (value: unknown) => value },
    AppState: { currentState: 'active', addEventListener: (_: string, callback: (state: string) => void) => { mockLifecycle = callback; return { remove: mockRemove }; } },
  };
});
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { ink: '#191b1d', canvas: '#ffffff' } } }) }));
jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const identity = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View: require('react-native').View },
    Easing: { inOut: identity, ease: identity, out: identity, cubic: identity },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ReactRuntime.useRef({ value }).current,
    useReducedMotion: () => mockReducedMotion,
    withTiming: identity,
    withDelay: (_delay: number, value: unknown) => value,
    withSequence: (...values: unknown[]) => values.at(-1),
    withRepeat: jest.fn(value => value),
    cancelAnimation: jest.fn(),
  };
});

beforeEach(() => { mockReducedMotion = false; jest.clearAllMocks(); });

it('stops decorative motion in the background and releases its listener', () => {
  const view = render(<Companion pose="connecting" />);
  expect(withRepeat).toHaveBeenCalledTimes(3);
  jest.mocked(withRepeat).mockClear();
  act(() => mockLifecycle('background'));
  expect(withRepeat).not.toHaveBeenCalled();
  expect(cancelAnimation).toHaveBeenCalled();
  act(() => mockLifecycle('active'));
  expect(withRepeat).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(mockRemove).toHaveBeenCalled();
});

it('keeps a readable loading state without motion and never animates errors', () => {
  mockReducedMotion = true;
  const view = render(<LoadingState message="Loading history" testID="loading" />);
  expect(view.getByTestId('loading').props.accessibilityState).toEqual({ busy: true });
  expect(withRepeat).not.toHaveBeenCalled();
  view.unmount();
  mockReducedMotion = false;
  render(<Companion pose="error" />);
  expect(withRepeat).not.toHaveBeenCalled();
});

it('inverts face and eye colors for ink chrome without changing geometry', () => {
  const ink = JSON.stringify(render(<Companion size={24} />).toJSON());
  const inverse = JSON.stringify(render(<Companion size={24} tone="inverse" />).toJSON());
  expect(ink).toContain('"fill":"#191b1d"');
  expect(ink).toContain('"backgroundColor":"#ffffff"');
  expect(inverse).toContain('"fill":"#ffffff"');
  expect(inverse).toContain('"backgroundColor":"#191b1d"');
  expect(inverse).not.toContain('"fill":"#191b1d"');
  expect(inverse.replace(/#ffffff|#191b1d/g, 'c')).toBe(ink.replace(/#ffffff|#191b1d/g, 'c'));
});

it('keeps every curious track on one seamless loop', () => {
  for (const track of Object.values(CURIOUS_CHOREOGRAPHY)) expect(choreographyLength(track)).toBe(Motion.companionCuriosity);
});

it('plays the curious loop only while foregrounded and leaves idle art still', () => {
  const view = render(<Companion pose="curious" testID="curious" />);
  expect(withRepeat).toHaveBeenCalledTimes(8);
  expect(JSON.stringify(view.toJSON())).not.toContain('transformOrigin');
  jest.mocked(withRepeat).mockClear();
  act(() => mockLifecycle('background'));
  expect(withRepeat).not.toHaveBeenCalled();
  expect(cancelAnimation).toHaveBeenCalled();
  view.unmount();
  render(<Companion pose="idle" />);
  expect(withRepeat).not.toHaveBeenCalled();
});
