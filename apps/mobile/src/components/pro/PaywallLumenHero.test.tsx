import React from 'react';
import { act, render } from '@testing-library/react-native';
import { cancelAnimation, withRepeat } from 'react-native-reanimated';
import { Mask, Path, Rect } from 'react-native-svg';
import { PaywallLumenHero } from './PaywallLumenHero';

let mockReduced = false;
let mockStateListener: (state: string) => void;
const mockRemove = jest.fn();
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: (_event: string, listener: typeof mockStateListener) => { mockStateListener = listener; return { remove: mockRemove }; } },
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('react-native-svg', () => {
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => require('react').createElement(name, props, children);
  return Object.assign({ __esModule: true }, Object.fromEntries(['Svg', 'Circle', 'Defs', 'Ellipse', 'G', 'LinearGradient', 'Mask', 'Path', 'RadialGradient', 'Rect', 'Stop'].map(name => [name === 'Svg' ? 'default' : name, host(name)])));
});
jest.mock('react-native-reanimated', () => {
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: Record<string, unknown>) => require('react').createElement('AnimatedView', props, children),
      createAnimatedComponent: (component: unknown) => component,
    },
    cancelAnimation: jest.fn(), Easing: { sin: (x: number) => x, inOut: (x: unknown) => x, out: (x: unknown) => x, cubic: (x: number) => x },
    useReducedMotion: () => mockReduced, useSharedValue: (value: number) => require('react').useRef({ value }).current,
    useAnimatedProps: (f: () => unknown) => f(), withTiming: (x: number) => x, withRepeat: jest.fn((x: number) => x),
    withDelay: (_delay: number, x: number) => x, withSequence: (...values: number[]) => values.at(-1),
  };
});
beforeEach(() => { jest.clearAllMocks(); mockReduced = false; });

it('pauses decorative motion in the background and cleans up on unmount', () => {
  const screen = render(<PaywallLumenHero hero="generic" />);
  expect(withRepeat).toHaveBeenCalledTimes(8);
  act(() => mockStateListener('background'));
  expect(withRepeat).toHaveBeenCalledTimes(8);
  expect(cancelAnimation).toHaveBeenCalled();
  act(() => mockStateListener('active'));
  expect(withRepeat).toHaveBeenCalledTimes(16);
  screen.unmount();
  expect(mockRemove).toHaveBeenCalledTimes(1);
});
it('keeps the complete artwork static under reduced motion', () => {
  mockReduced = true;
  const screen = render(<PaywallLumenHero hero="connections" />);
  expect(screen.getByTestId('paywall-lumen-artwork', { includeHiddenElements: true })).toBeTruthy();
  expect(withRepeat).not.toHaveBeenCalled();
});
it('stops the loop after purchase success', () => {
  const screen = render(<PaywallLumenHero hero="generic" />);
  jest.clearAllMocks();
  screen.rerender(<PaywallLumenHero hero="generic" success />);
  expect(withRepeat).not.toHaveBeenCalled();
  expect(cancelAnimation).toHaveBeenCalledTimes(16);
});
it('uses one continuous material per silhouette with isolated masks for concurrent heroes', () => {
  const screen = render(<><PaywallLumenHero hero="generic"/><PaywallLumenHero hero="agents"/></>);
  const masks = screen.UNSAFE_getAllByType(Mask);
  expect(masks).toHaveLength(2);
  expect(masks[0].props.id).not.toBe(masks[1].props.id);
  for (const mask of masks) {
    const shapes = mask.findAllByType(Path);
    expect(shapes).toHaveLength(3);
    expect(shapes.every((shape: { props: { fill?: string } }) => shape.props.fill === '#FFFFFF')).toBe(true);
    expect(screen.UNSAFE_getAllByType(Rect).filter(rect => rect.props.mask === `url(#${mask.props.id})`)).toHaveLength(1);
  }
});
