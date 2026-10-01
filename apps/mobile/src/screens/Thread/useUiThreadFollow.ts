import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  cancelAnimation,
  measure,
  runOnJS,
  runOnUI,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useEvent,
  useSharedValue,
  withSpring,
  type MeasuredDimensions,
} from 'react-native-reanimated';

/**
 * Critically damped (damping = 2 × √stiffness): a glide covers most of its
 * distance in about 200 ms, keeps its speed when a growing reply moves the end
 * again, and stops at the end instead of bouncing past it.
 */
export const FOLLOW_GLIDE_SPRING = { mass: 1, stiffness: 600, damping: 49, overshootClamping: true } as const;

const FOLLOW_SCROLL_EVENTS = ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag', 'onMomentumScrollBegin', 'onMomentumScrollEnd'];
/** A drag or fling with no event for this long no longer holds the list, so a lost end event cannot stop following. */
export const READER_HOLD_STALE_MS = 1_500;

/**
 * Whether the reader's drag or fling still owns the list. JS decides to follow
 * a frame or more after the UI thread sees a drag begin, so a request that
 * arrives while the reader holds the list is older than the drag.
 */
export function readerHoldsList(touching: boolean, flinging: boolean, lastEventAt: number, now: number): boolean {
  'worklet';
  return (touching || flinging) && now - lastEventAt < READER_HOLD_STALE_MS;
}

/** The offset that shows the end of the content, from committed layout. */
export function followEndOffset(content: MeasuredDimensions | null, viewport: MeasuredDimensions | null): number | null {
  'worklet';
  if (!content || !viewport) return null;
  return Math.max(0, content.height - viewport.height);
}

type FollowScroller = { getInnerViewRef?: () => unknown };
type AnimatedRefBinding = (instance?: unknown) => unknown;
/** What Reanimated's `useEvent` returns behind its function type (see its useScrollOffset). */
type WorkletEventHandle = {
  workletEventHandler?: {
    registerForEvents?: (viewTag: number) => void;
    unregisterFromEvents?: (viewTag: number) => void;
  };
};

export type UiThreadFollow = Readonly<{
  /** Attaches the list's native scroll view; false when it cannot be followed this way. */
  bind: (scroller: unknown) => boolean;
  /**
   * Springs to the end, re-targeting a glide in flight without losing its
   * speed. `knownOffset` stands in until the scroll view reports its own
   * offset; `generation` comes back through `onSettled`.
   */
  glide: (generation: number, knownOffset: number) => void;
  /** Ends a glide in flight and jumps to the end, after the glide's last step. */
  snap: () => void;
  /** Ends a glide in flight where it is. */
  stop: () => void;
}>;

/**
 * Android bottom follow on the UI thread. React Native runs a scroll command
 * from JS before the mount that grew the list, and the native animated
 * `scrollToEnd` aims past the end and finishes in about two frames, so a glide
 * issued from JS reaches the screen late and as a jump. Here the offset moves
 * every frame on the UI thread: the end is measured from the committed layout,
 * a critically damped spring carries the list there, a new end re-targets the
 * spring, and the reader's drag or fling stops it before JS hears about it;
 * a request JS made before hearing about the drag does not move the list.
 */
export function useUiThreadFollow(callbacks: Readonly<{
  onSettled: (generation: number) => void;
  /** The bound view could not be measured: the caller follows natively instead. */
  onUnavailable: () => void;
}>): UiThreadFollow {
  const scrollRef = useAnimatedRef();
  const contentRef = useAnimatedRef();
  // -1 until the bound scroll view reports an offset.
  const offset = useSharedValue(-1);
  const position = useSharedValue(0);
  const gliding = useSharedValue(false);
  const readerTouching = useSharedValue(false);
  const readerFlinging = useSharedValue(false);
  const readerEventAt = useSharedValue(0);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const settled = useCallback((generation: number) => callbacksRef.current.onSettled(generation), []);
  const unavailable = useCallback(() => callbacksRef.current.onUnavailable(), []);

  const scrollEvents = useEvent<NativeSyntheticEvent<NativeScrollEvent>>((event) => {
    'worklet';
    offset.value = event.contentOffset.y;
    const name = event.eventName;
    const dragBegins = name.endsWith('onScrollBeginDrag');
    const flingBegins = name.endsWith('onMomentumScrollBegin');
    if (dragBegins) readerTouching.value = true;
    else if (flingBegins) readerFlinging.value = true;
    else if (name.endsWith('onScrollEndDrag')) readerTouching.value = false;
    else if (name.endsWith('onMomentumScrollEnd')) readerFlinging.value = false;
    if (readerTouching.value || readerFlinging.value) readerEventAt.value = Date.now();
    // The reader takes a glide over before JS hears about the drag.
    if ((dragBegins || flingBegins) && gliding.value) {
      gliding.value = false;
      cancelAnimation(position);
    }
  }, FOLLOW_SCROLL_EVENTS);
  useEffect(() => {
    // Registered on the scroll view's tag whenever the ref is bound, as
    // Reanimated's own useScrollOffset does.
    const handler = (scrollEvents as unknown as WorkletEventHandle).workletEventHandler;
    if (!handler?.registerForEvents || !handler.unregisterFromEvents || typeof scrollRef.observe !== 'function') {
      return undefined;
    }
    // `observe` returns its unsubscribe function despite its declared type.
    const unsubscribe = scrollRef.observe((tag) => {
      if (!tag) return undefined;
      handler.registerForEvents?.(tag);
      return () => handler.unregisterFromEvents?.(tag);
    }) as unknown;
    return typeof unsubscribe === 'function' ? unsubscribe as () => void : undefined;
  }, [scrollEvents, scrollRef]);

  useAnimatedReaction(() => position.value, (y, previous) => {
    if (gliding.value && y !== previous) scrollTo(scrollRef, 0, y, false);
  });

  const bind = useCallback((scroller: unknown): boolean => {
    const view = scroller as FollowScroller | null | undefined;
    const content = view?.getInnerViewRef?.();
    if (!view || !content || typeof scrollRef !== 'function' || typeof contentRef !== 'function') return false;
    try {
      // The content first: binding the scroll view registers its scroll events.
      (contentRef as AnimatedRefBinding)(content);
      (scrollRef as AnimatedRefBinding)(view);
    } catch {
      // Reanimated could not resolve a host view for one of them.
      return false;
    }
    offset.value = -1;
    readerTouching.value = false;
    readerFlinging.value = false;
    return true;
  }, [contentRef, offset, readerFlinging, readerTouching, scrollRef]);

  const glide = useCallback((generation: number, knownOffset: number) => {
    runOnUI((nextGeneration: number, fallbackOffset: number) => {
      'worklet';
      if (readerHoldsList(readerTouching.value, readerFlinging.value, readerEventAt.value, Date.now())) {
        gliding.value = false;
        cancelAnimation(position);
        return;
      }
      const end = scrollRef() && contentRef() ? followEndOffset(measure(contentRef), measure(scrollRef)) : null;
      if (end === null) {
        gliding.value = false;
        cancelAnimation(position);
        runOnJS(unavailable)();
        return;
      }
      if (!gliding.value) {
        // A glide in flight keeps its own position and speed.
        position.value = offset.value >= 0 ? offset.value : fallbackOffset;
        gliding.value = true;
      }
      position.value = withSpring(end, FOLLOW_GLIDE_SPRING, (finished) => {
        'worklet';
        if (!finished) return;
        gliding.value = false;
        runOnJS(settled)(nextGeneration);
      });
    })(generation, knownOffset);
  }, [contentRef, gliding, offset, position, readerEventAt, readerFlinging, readerTouching, scrollRef, settled, unavailable]);

  const snap = useCallback(() => {
    runOnUI(() => {
      'worklet';
      gliding.value = false;
      cancelAnimation(position);
      if (readerHoldsList(readerTouching.value, readerFlinging.value, readerEventAt.value, Date.now())) return;
      const end = scrollRef() && contentRef() ? followEndOffset(measure(contentRef), measure(scrollRef)) : null;
      if (end === null) runOnJS(unavailable)();
      else scrollTo(scrollRef, 0, end, false);
    })();
  }, [contentRef, gliding, position, readerEventAt, readerFlinging, readerTouching, scrollRef, unavailable]);

  const stop = useCallback(() => {
    runOnUI(() => {
      'worklet';
      gliding.value = false;
      cancelAnimation(position);
    })();
  }, [gliding, position]);

  return useMemo(() => ({ bind, glide, snap, stop }), [bind, glide, snap, stop]);
}
