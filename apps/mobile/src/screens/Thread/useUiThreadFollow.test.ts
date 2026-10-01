import { act, renderHook } from '@testing-library/react-native';
import { FOLLOW_GLIDE_SPRING, READER_HOLD_STALE_MS, followEndOffset, readerHoldsList, useUiThreadFollow } from './useUiThreadFollow';

type MockSpring = {
  to: number;
  config: unknown;
  callback?: (finished: boolean) => void;
  from?: unknown;
  owner?: MockSharedValue;
  done: boolean;
};
type MockSharedValue = {
  value: unknown;
  animation: MockSpring | null;
  /** Moves the value the way a running animation does, leaving the animation in place. */
  drive: (next: unknown) => void;
};
type MockReaction = { prepare: () => unknown; react: (value: unknown, previous: unknown) => void; last: unknown };
type MockEventHandler = { handler: (event: unknown) => void; register: jest.Mock; unregister: jest.Mock };

const mockSprings: MockSpring[] = [];
const mockReactions: MockReaction[] = [];
const mockEventHandlers: MockEventHandler[] = [];
const mockScrollTo = jest.fn();
const mockLayout = { content: 1600, viewport: 600, measurable: true };
const mockContent = { kind: 'content' };
const mockScroller = { tag: 7, getInnerViewRef: () => mockContent };

function mockRunReactions(): void {
  // Mappers run after a shared value changes, as Reanimated's do each frame.
  for (const reaction of mockReactions) {
    const next = reaction.prepare();
    if (Object.is(next, reaction.last)) continue;
    const previous = reaction.last;
    reaction.last = next;
    reaction.react(next, previous);
  }
}

function mockInterrupt(sharedValue: MockSharedValue): void {
  const running = sharedValue.animation;
  sharedValue.animation = null;
  if (running && !running.done) {
    running.done = true;
    running.callback?.(false);
  }
}

function mockCreateSharedValue(initial: unknown): MockSharedValue {
  let current = initial;
  const sharedValue: MockSharedValue = {
    animation: null,
    get value() { return current; },
    set value(next: unknown) {
      mockInterrupt(sharedValue);
      const spring = (next as { mockSpring?: MockSpring } | null)?.mockSpring;
      if (spring) {
        spring.from = current;
        spring.owner = sharedValue;
        sharedValue.animation = spring;
        return;
      }
      current = next;
      mockRunReactions();
    },
    drive: (next) => {
      current = next;
      mockRunReactions();
    },
  };
  return sharedValue;
}

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const createAnimatedRef = () => {
    const observers = new Map<(tag: number | null) => (() => void) | undefined, (() => void) | undefined>();
    const ref = Object.assign((instance?: unknown) => {
      if (instance) {
        if ((instance as { unresolvable?: boolean }).unresolvable) throw new Error('[Reanimated] Failed to find host instance for a ref.');
        ref.current = instance;
        ref.getTag = () => (instance as { tag?: number }).tag ?? null;
        observers.forEach((cleanup, observer) => {
          cleanup?.();
          observers.set(observer, observer(ref.getTag()));
        });
      }
      return ref.current ? { wrapper: ref.current } : null;
    }, {
      current: null as unknown,
      getTag: (): number | null => null,
      observe: (observer: (tag: number | null) => (() => void) | undefined) => {
        observers.set(observer, observer(ref.getTag()));
        return () => {
          observers.get(observer)?.();
          observers.delete(observer);
        };
      },
    });
    return ref;
  };
  return {
    cancelAnimation: (sharedValue: MockSharedValue) => mockInterrupt(sharedValue),
    measure: (ref: { current: unknown }) => {
      if (!mockLayout.measurable) return null;
      if (ref.current === mockContent) return { x: 0, y: 0, width: 393, height: mockLayout.content, pageX: 0, pageY: 0 };
      if (ref.current === mockScroller) return { x: 0, y: 0, width: 393, height: mockLayout.viewport, pageX: 0, pageY: 0 };
      return null;
    },
    runOnJS: <T>(fn: T) => fn,
    runOnUI: <T>(fn: T) => fn,
    scrollTo: (...args: unknown[]) => mockScrollTo(...args),
    useAnimatedReaction: (prepare: () => unknown, react: MockReaction['react']) => {
      const entry = ReactRuntime.useRef(null as MockReaction | null);
      if (!entry.current) {
        entry.current = { prepare, react, last: prepare() };
        mockReactions.push(entry.current);
      }
    },
    useAnimatedRef: () => ReactRuntime.useState(createAnimatedRef)[0],
    useEvent: (handler: (event: unknown) => void) => ReactRuntime.useState(() => {
      const entry = { handler, register: jest.fn(), unregister: jest.fn() };
      mockEventHandlers.push(entry);
      return { workletEventHandler: { registerForEvents: entry.register, unregisterFromEvents: entry.unregister } };
    })[0],
    useSharedValue: (initial: unknown) => ReactRuntime.useState(() => mockCreateSharedValue(initial))[0],
    withSpring: (to: number, config: unknown, callback?: (finished: boolean) => void) => {
      const spring: MockSpring = { to, config, callback, done: false };
      mockSprings.push(spring);
      return { mockSpring: spring };
    },
  };
});

function step(spring: MockSpring, value: number): void {
  act(() => spring.owner?.drive(value));
}

function settle(spring: MockSpring): void {
  act(() => {
    spring.owner?.drive(spring.to);
    spring.done = true;
    if (spring.owner?.animation === spring) spring.owner.animation = null;
    spring.callback?.(true);
  });
}

function scrollEventFor(name: string, y: number) {
  return { eventName: `${mockScroller.tag}${name}`, contentOffset: { x: 0, y } };
}

function renderFollow() {
  const onSettled = jest.fn();
  const onUnavailable = jest.fn();
  const hook = renderHook(() => useUiThreadFollow({ onSettled, onUnavailable }));
  return { follow: hook.result.current, onSettled, onUnavailable, events: mockEventHandlers.at(-1)! };
}

const originalConsoleError = console.error;
let consoleErrorSpy: jest.SpyInstance;

afterEach(() => consoleErrorSpy.mockRestore());

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
    if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    originalConsoleError(message, ...rest);
  });
  mockSprings.length = 0;
  mockReactions.length = 0;
  mockEventHandlers.length = 0;
  mockScrollTo.mockClear();
  mockLayout.content = 1600;
  mockLayout.viewport = 600;
  mockLayout.measurable = true;
});

it('measures the end of the content against the viewport, never above the top', () => {
  const box = (height: number) => ({ x: 0, y: 0, width: 393, height, pageX: 0, pageY: 0 });
  expect(followEndOffset(box(1600), box(600))).toBe(1000);
  expect(followEndOffset(box(400), box(600))).toBe(0);
  expect(followEndOffset(null, box(600))).toBeNull();
  expect(followEndOffset(box(1600), null)).toBeNull();
});

it('binds the scroll view and its content, and listens to the bound scroll view only', () => {
  const { follow, events } = renderFollow();
  expect(follow.bind(null)).toBe(false);
  expect(follow.bind({ tag: 3, getInnerViewRef: () => null })).toBe(false);
  // Reanimated cannot resolve a host view for the content or the scroll view.
  expect(follow.bind({ tag: 4, getInnerViewRef: () => ({ unresolvable: true }) })).toBe(false);
  expect(follow.bind({ tag: 5, unresolvable: true, getInnerViewRef: () => mockContent })).toBe(false);
  expect(events.register).not.toHaveBeenCalled();
  expect(follow.bind(mockScroller)).toBe(true);
  expect(events.register).toHaveBeenLastCalledWith(7);
  // A new list moves the registration with it.
  const next = { tag: 9, getInnerViewRef: () => mockContent };
  expect(follow.bind(next)).toBe(true);
  expect(events.unregister).toHaveBeenCalledWith(7);
  expect(events.register).toHaveBeenLastCalledWith(9);
});

it('springs from the reported offset to the measured end, a step a frame, and reports its generation once settled', () => {
  const { follow, onSettled, events } = renderFollow();
  follow.bind(mockScroller);
  act(() => events.handler(scrollEventFor('onScroll', 940)));
  act(() => follow.glide(1, 0));
  const spring = mockSprings[0];
  expect(spring).toMatchObject({ to: 1000, from: 940, config: FOLLOW_GLIDE_SPRING });
  step(spring, 970);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.anything(), 0, 970, false);
  expect(onSettled).not.toHaveBeenCalled();
  settle(spring);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.anything(), 0, 1000, false);
  expect(onSettled).toHaveBeenCalledWith(1);
});

it('re-targets a glide in flight from where it is, and only the newest generation settles', () => {
  const { follow, onSettled, events } = renderFollow();
  follow.bind(mockScroller);
  act(() => events.handler(scrollEventFor('onScroll', 940)));
  act(() => follow.glide(1, 0));
  step(mockSprings[0], 980);
  // The reply grew again before the glide arrived.
  mockLayout.content = 1660;
  act(() => follow.glide(2, 0));
  expect(mockSprings[1]).toMatchObject({ to: 1060, from: 980 });
  expect(mockSprings[0].done).toBe(true);
  settle(mockSprings[1]);
  expect(onSettled.mock.calls).toEqual([[2]]);
});

it('starts from the offset JS knows until the scroll view reports one', () => {
  const { follow } = renderFollow();
  follow.bind(mockScroller);
  act(() => follow.glide(1, 912));
  expect(mockSprings[0]).toMatchObject({ to: 1000, from: 912 });
});

it('hands a glide to the reader the moment a drag begins', () => {
  const { follow, onSettled, events } = renderFollow();
  follow.bind(mockScroller);
  act(() => events.handler(scrollEventFor('onScroll', 940)));
  act(() => follow.glide(1, 0));
  step(mockSprings[0], 960);
  mockScrollTo.mockClear();
  act(() => events.handler(scrollEventFor('onScrollBeginDrag', 955)));
  expect(mockSprings[0].done).toBe(true);
  step(mockSprings[0], 990);
  expect(mockScrollTo).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
  // Once the finger lifts, the next glide starts from where the reader left the list.
  act(() => events.handler(scrollEventFor('onScroll', 700)));
  act(() => events.handler(scrollEventFor('onScrollEndDrag', 700)));
  act(() => follow.glide(2, 0));
  expect(mockSprings[1]).toMatchObject({ from: 700 });
});

it('leaves the list to a drag or fling that JS has not heard about yet', () => {
  const { follow, events } = renderFollow();
  follow.bind(mockScroller);
  act(() => events.handler(scrollEventFor('onScrollBeginDrag', 900)));
  // JS decided to follow before it saw the drag: the request does not move the list.
  act(() => follow.glide(1, 0));
  act(() => follow.snap());
  expect(mockSprings).toHaveLength(0);
  expect(mockScrollTo).not.toHaveBeenCalled();
  act(() => events.handler(scrollEventFor('onScrollEndDrag', 860)));
  act(() => events.handler(scrollEventFor('onMomentumScrollBegin', 860)));
  act(() => follow.glide(2, 0));
  expect(mockSprings).toHaveLength(0);
  act(() => events.handler(scrollEventFor('onMomentumScrollEnd', 640)));
  act(() => follow.glide(3, 0));
  expect(mockSprings[0]).toMatchObject({ to: 1000, from: 640 });
  // A fling that begins during a glide takes it over too.
  act(() => events.handler(scrollEventFor('onMomentumScrollBegin', 650)));
  expect(mockSprings[0].done).toBe(true);
});

it('stops holding the list for a drag whose end never arrived', () => {
  expect(readerHoldsList(true, false, 1_000, 1_000 + READER_HOLD_STALE_MS - 1)).toBe(true);
  expect(readerHoldsList(false, true, 1_000, 1_000 + READER_HOLD_STALE_MS - 1)).toBe(true);
  expect(readerHoldsList(true, true, 1_000, 1_000 + READER_HOLD_STALE_MS)).toBe(false);
  expect(readerHoldsList(false, false, 1_000, 1_001)).toBe(false);
  const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
  try {
    const { follow, events } = renderFollow();
    follow.bind(mockScroller);
    act(() => events.handler(scrollEventFor('onScrollBeginDrag', 900)));
    now.mockReturnValue(10_000 + READER_HOLD_STALE_MS);
    act(() => follow.glide(1, 0));
    expect(mockSprings[0]).toMatchObject({ to: 1000, from: 900 });
  } finally {
    now.mockRestore();
  }
});

it('ends a glide with one jump to the end, or where it is when stopped', () => {
  const { follow, onSettled, events } = renderFollow();
  follow.bind(mockScroller);
  act(() => events.handler(scrollEventFor('onScroll', 940)));
  act(() => follow.glide(1, 0));
  step(mockSprings[0], 960);
  mockScrollTo.mockClear();
  mockLayout.content = 1700;
  act(() => follow.snap());
  expect(mockScrollTo.mock.calls).toEqual([[expect.anything(), 0, 1100, false]]);
  expect(mockSprings[0].done).toBe(true);

  act(() => follow.glide(2, 0));
  mockScrollTo.mockClear();
  act(() => follow.stop());
  step(mockSprings[1], 1100);
  expect(mockScrollTo).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
});

it('reports a list it cannot measure instead of scrolling it', () => {
  const { follow, onUnavailable } = renderFollow();
  // Never bound: nothing to measure.
  act(() => follow.glide(1, 0));
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  follow.bind(mockScroller);
  mockLayout.measurable = false;
  act(() => follow.glide(2, 0));
  act(() => follow.snap());
  expect(onUnavailable).toHaveBeenCalledTimes(3);
  expect(mockSprings).toHaveLength(0);
  expect(mockScrollTo).not.toHaveBeenCalled();
});
