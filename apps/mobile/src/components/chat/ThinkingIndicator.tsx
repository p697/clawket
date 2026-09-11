import React, { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Motion } from '../../theme/tokens';
import { useBubbleTypography } from '../ui/Bubble';

/** Same breath as `Skeleton`: the reply bubble is a loading surface until the first token. */
const THINKING_RESTING_OPACITY = 0.36;
const THINKING_PEAK_OPACITY = 0.9;

export type ThinkingIndicatorProps = Readonly<{
  /** Live activity ("Thinking…", "Using exec…"); a change restarts the breath from rest. */
  label: string;
  testID?: string;
}>;

/**
 * The Agent's "typing" state. It lives inside the reply bubble that will
 * carry the answer, so the wait and the reply are one object: the label
 * breathes in message typography while the run has produced no text, and
 * the markdown replaces it in place when the first token lands.
 */
export function ThinkingIndicator({ label, testID }: ThinkingIndicatorProps): React.JSX.Element {
  const typography = useBubbleTypography();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? THINKING_PEAK_OPACITY : THINKING_RESTING_OPACITY);

  useEffect(() => {
    cancelAnimation(opacity);
    if (reduceMotion) {
      opacity.value = THINKING_PEAK_OPACITY;
      return () => cancelAnimation(opacity);
    }
    opacity.value = THINKING_RESTING_OPACITY;
    opacity.value = withRepeat(
      withTiming(THINKING_PEAK_OPACITY, {
        duration: Motion.avatarWorkingLoop,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [label, opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text
      testID={testID}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      numberOfLines={1}
      style={[typography, animatedStyle]}
    >
      {label}
    </Animated.Text>
  );
}
