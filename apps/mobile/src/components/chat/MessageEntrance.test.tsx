import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageEntrance } from './MessageEntrance';
import { Motion } from '../../theme/tokens';

let mockReducedMotion = false;
const mockWrites: number[] = [];
const mockTiming = jest.fn((..._args: unknown[]) => 1);
jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true, default: { View: 'AnimatedView' },
    // Holds the last value written, so a re-render reads the frame a timing starts from.
    useSharedValue: (initial: number) => ReactRuntime.useRef((() => {
      let current = initial;
      return { get value() { return current; }, set value(next: number) { current = next; mockWrites.push(next); } };
    })()).current,
    useAnimatedStyle: (factory: () => unknown) => factory(), useReducedMotion: () => mockReducedMotion,
    cancelAnimation: jest.fn(), withTiming: (...args: unknown[]) => mockTiming(...args),
    Easing: { out: (value: unknown) => value, cubic: 'cubic', bezier: (...points: number[]) => `bezier(${points.join(',')})` },
  };
});
const row = (key: string, animate: boolean, motion: 'sent' | 'reply' = 'sent') => (
  <MessageEntrance animationKey={key} animate={animate} motion={motion} testID="row"><></></MessageEntrance>
);
const style = (view: ReturnType<typeof render>) => Object.assign({}, ...[view.getByTestId('row').props.style].flat()) as {
  opacity: number; transform: Array<Record<string, number>>; transformOrigin?: string;
};
const transform = (value: ReturnType<typeof style>) => Object.assign({}, ...value.transform) as Record<string, number>;

describe('recycled message entrance', () => {
  beforeEach(() => { mockWrites.length = 0; mockTiming.mockClear(); mockTiming.mockImplementation(() => 1); mockReducedMotion = false; });

  it('restores full visibility when a recycled animated row becomes history', () => {
    const view = render(row('new', true));
    expect(mockTiming).toHaveBeenCalledTimes(2);
    mockWrites.length = 0;
    view.rerender(row('history', false));
    expect(mockWrites).toEqual([1, 1]);
    expect(mockTiming).toHaveBeenCalledTimes(2);
  });

  it('latches entrance intent per identity and plays only once for a fresh row', () => {
    const view = render(row('history', false));
    view.rerender(row('history', true));
    expect(mockTiming).not.toHaveBeenCalled();
    view.rerender(row('new', true));
    view.rerender(row('new', false));
    expect(mockTiming).toHaveBeenCalledTimes(2);
  });

  it('flies a sent row in from the composer along separate X and Y curves', () => {
    mockTiming.mockImplementation(() => 0);
    const view = render(row('new', true));
    const send = Motion.send;
    expect(mockTiming).toHaveBeenNthCalledWith(1, 1, { duration: send.duration, easing: `bezier(${send.curveY.join(',')})` });
    expect(mockTiming).toHaveBeenNthCalledWith(2, 1, { duration: send.duration, easing: `bezier(${send.curveX.join(',')})` });
    view.rerender(row('new', true));
    const start = style(view);
    // Below the timeline's edge, to the leading side, small and faint: it emerges from the composer.
    expect(start.opacity).toBeCloseTo(send.startOpacity);
    expect(transform(start)).toEqual({ translateX: -send.offsetX, translateY: send.offsetY, scale: send.startScale });
    expect(start.transformOrigin).toBe('right bottom');
  });

  it('draws an entering row at the start of its motion from its first frame, even in a reused cell', () => {
    // The timing never writes here: what the first commit draws is what the list shows before the motion runs.
    mockTiming.mockImplementation(() => undefined as unknown as number);
    const view = render(row('history', false));
    expect(style(view).opacity).toBe(1);
    // The cell is reused for the new row: it must not show the row in place first.
    view.rerender(row('new', true));
    expect(style(view).opacity).toBeCloseTo(Motion.send.startOpacity);
    expect(transform(style(view))).toEqual({ translateX: -Motion.send.offsetX, translateY: Motion.send.offsetY, scale: Motion.send.startScale });
    const fresh = render(row('fresh', true, 'reply'));
    expect(transform(style(fresh)).translateY).toBe(8);
  });

  it('lands a sent row at its own place, size and opacity', () => {
    const view = render(row('new', true));
    view.rerender(row('new', true));
    const end = style(view);
    expect(end.opacity).toBe(1);
    expect(transform(end).scale).toBe(1);
    expect(transform(end).translateX).toBeCloseTo(0);
    expect(transform(end).translateY).toBeCloseTo(0);
  });

  it('does not replay after unmount/remount when the conversation has consumed its entrance', () => {
    const played = new Set<string>();
    const claim = (key: string) => { if (played.has(key)) return false; played.add(key); return true; };
    const element = <MessageEntrance animationKey="new" animate claimEntrance={claim} motion="sent"><></></MessageEntrance>;
    const view = render(element);
    view.unmount();
    mockWrites.length = 0;
    render(element);
    expect(mockTiming).toHaveBeenCalledTimes(2);
    expect(mockWrites).toEqual([1, 1]);
  });

  it('fades a sent row in place under reduced motion', () => {
    mockReducedMotion = true;
    mockTiming.mockImplementation(() => 0);
    const view = render(row('new', true));
    expect(mockTiming).toHaveBeenCalledTimes(1);
    expect(mockTiming).toHaveBeenCalledWith(1, { duration: Motion.morph.duration });
    view.rerender(row('new', true));
    expect(style(view).opacity).toBe(0);
    expect(transform(style(view))).toEqual({ translateX: 0, translateY: 0, scale: 1 });
  });

  it('raises a reply at full size, and shows it at once under reduced motion', () => {
    const view = render(row('reply', true, 'reply'));
    expect(mockTiming).toHaveBeenCalledTimes(1);
    expect(style(view).opacity).toBe(1);
    expect(style(view).transformOrigin).toBeUndefined();
    mockReducedMotion = true;
    mockTiming.mockClear();
    render(row('reply-2', true, 'reply'));
    expect(mockTiming).not.toHaveBeenCalled();
  });
});
