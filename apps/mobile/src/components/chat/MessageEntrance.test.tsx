import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageEntrance } from './MessageEntrance';

let mockReducedMotion = false;
const mockWrites: number[] = [];
const mockTiming = jest.fn((..._args: unknown[]) => 1);
jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true, default: { View: 'AnimatedView' },
    useSharedValue: (initial: number) => ReactRuntime.useRef({
      get value() { return initial; }, set value(next: number) { mockWrites.push(next); },
    }).current,
    useAnimatedStyle: (factory: () => unknown) => factory(), useReducedMotion: () => mockReducedMotion,
    cancelAnimation: jest.fn(), withTiming: (...args: unknown[]) => mockTiming(...args),
    Easing: { out: (value: unknown) => value, cubic: 'cubic' },
  };
});
const row = (key: string, animate: boolean) => (
  <MessageEntrance animationKey={key} animate={animate} motion="sent"><></></MessageEntrance>
);
describe('recycled message entrance', () => {
  beforeEach(() => { mockWrites.length = 0; mockTiming.mockClear(); mockReducedMotion = false; });
  it('restores full visibility when a recycled animated row becomes history', () => {
    const view = render(row('new', true));
    expect(mockTiming).toHaveBeenCalledTimes(1);
    mockWrites.length = 0;
    view.rerender(row('history', false));
    expect(mockWrites).toEqual([1]);
    expect(mockTiming).toHaveBeenCalledTimes(1);
  });
  it('latches entrance intent per identity and plays only once for a fresh row', () => {
    const view = render(row('history', false));
    view.rerender(row('history', true));
    expect(mockTiming).not.toHaveBeenCalled();
    view.rerender(row('new', true));
    view.rerender(row('new', false));
    expect(mockTiming).toHaveBeenCalledTimes(1);
  });
  it('keeps the bubble visible and unscaled even at the start of its entrance', () => {
    const view = render(<MessageEntrance animationKey="new" animate motion="sent" testID="row"><></></MessageEntrance>);
    expect(view.getByTestId('row').props.style).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
    expect(mockWrites).toEqual([0, 1]);
  });
  it('does not replay after unmount/remount when the conversation has consumed its entrance', () => {
    const played = new Set<string>();
    const claim = (key: string) => { if (played.has(key)) return false; played.add(key); return true; };
    const element = <MessageEntrance animationKey="new" animate claimEntrance={claim} motion="sent"><></></MessageEntrance>;
    const view = render(element);
    view.unmount();
    mockWrites.length = 0;
    render(element);
    expect(mockTiming).toHaveBeenCalledTimes(1);
    expect(mockWrites).toEqual([1]);
  });
  it('honors reduced motion without hiding or moving the row', () => {
    mockReducedMotion = true;
    const view = render(<MessageEntrance animationKey="new" animate motion="sent" testID="row"><></></MessageEntrance>);
    expect(mockTiming).not.toHaveBeenCalled();
    expect(view.getByTestId('row').props.style).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  });
});
