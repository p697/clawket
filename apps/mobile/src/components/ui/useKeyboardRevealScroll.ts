import { useCallback, useRef } from 'react';
import { type View, useWindowDimensions } from 'react-native';
import Reanimated, {
  scrollTo,
  useAnimatedRef,
  useScrollOffset,
  useSharedValue,
} from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';

/** Window-space bottom edge of the anchor and the scroll offset it was measured at. */
export type KeyboardRevealAnchor = Readonly<{ bottom: number; offset: number }>;

/**
 * Extra scroll needed so the anchor's bottom edge sits `clearance` points above
 * the keyboard. The anchor was measured once at `anchor.offset`; the live
 * `offset` re-derives its on-screen position, so repeated keyboard resizes
 * (third-party keyboards, accessory bars) only ever add the remaining delta.
 */
export function resolveKeyboardRevealDelta(input: Readonly<{
  anchor: KeyboardRevealAnchor | null;
  offset: number;
  clearance: number;
  windowHeight: number;
  keyboardHeight: number;
}>): number {
  'worklet';
  if (!input.anchor || input.keyboardHeight <= 0) return 0;
  const bottomNow = input.anchor.bottom - (input.offset - input.anchor.offset);
  return Math.max(0, bottomNow + input.clearance - (input.windowHeight - input.keyboardHeight));
}

/** Position of `height` between the keyboard's start and destination heights, clamped to 0–1. */
export function keyboardTransitionFraction(startHeight: number, endHeight: number, height: number): number {
  'worklet';
  const span = endHeight - startHeight;
  if (span === 0) return 1;
  return Math.min(1, Math.max(0, (height - startHeight) / span));
}

/**
 * Scrolls a Reanimated ScrollView in step with the keyboard so one anchored
 * region ends up just above it. Pair with a padding `KeyboardAvoidingView`
 * that shrinks the viewport; this hook only moves content by the measured
 * shortfall, interpolated over the keyboard's real height progress.
 */
export function useKeyboardRevealScroll({ clearance, enabled = true }: Readonly<{ clearance: number; enabled?: boolean }>) {
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  const offset = useScrollOffset(scrollRef);
  const anchorRef = useRef<View>(null);
  const anchor = useSharedValue<KeyboardRevealAnchor | null>(null);
  const startOffset = useSharedValue(0);
  const startHeight = useSharedValue(0);
  const endHeight = useSharedValue(0);
  const currentHeight = useSharedValue(0);
  const delta = useSharedValue(0);
  const { height: windowHeight } = useWindowDimensions();

  const measureAnchor = useCallback(() => {
    anchorRef.current?.measureInWindow((_x, y, _width, height) => {
      anchor.value = { bottom: y + height, offset: offset.value };
    });
  }, [anchor, offset]);

  useKeyboardHandler({
    onStart: (event) => {
      'worklet';
      startHeight.value = currentHeight.value;
      endHeight.value = event.height;
      startOffset.value = offset.value;
      delta.value = enabled
        ? resolveKeyboardRevealDelta({ anchor: anchor.value, offset: offset.value, clearance, windowHeight, keyboardHeight: event.height })
        : 0;
    },
    onMove: (event) => {
      'worklet';
      currentHeight.value = event.height;
      if (delta.value <= 0) return;
      const fraction = keyboardTransitionFraction(startHeight.value, endHeight.value, event.height);
      scrollTo(scrollRef, 0, startOffset.value + delta.value * fraction, false);
    },
    onEnd: (event) => {
      'worklet';
      currentHeight.value = event.height;
      if (delta.value > 0) scrollTo(scrollRef, 0, startOffset.value + delta.value, false);
      delta.value = 0;
    },
  }, [clearance, enabled, windowHeight]);

  return { scrollRef, anchorRef, measureAnchor };
}
