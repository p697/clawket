import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import { LineHeight, Motion, Radius, Space } from '../../theme/tokens';

/**
 * Three dots that lift one after another while the Agent is working — the
 * messaging convention for "the other side is composing". One shared progress
 * value drives every dot, so the row costs one animation and stays in phase.
 * Reduced motion keeps the three dots at their resting opacities.
 */
const DOT_COUNT = 3;
const DOT_SIZE = Space.xs;
const DOT_GAP = Space.xs;
const DOT_LIFT = -2;
const REST_OPACITY = 0.32;
/** One full cycle shares the avatar working cadence; each dot bounces for `slow`. */
const CYCLE_MS = Motion.avatarWorkingLoop;
const STEP_MS = CYCLE_MS / DOT_COUNT;
const BOUNCE_MS = Motion.duration.slow;

export type TypingDotsProps = Readonly<{
  /** Defaults to the secondary ink so the dots read as a caption, not a badge. */
  color?: string;
  /** Row height; defaults to the caption line so it can replace a subtitle. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/** 0 outside the dot's bounce window, rising to 1 at its peak and back. */
function bounce(value: number, start: number, peak: number, end: number): number {
  'worklet';
  if (value <= start || value >= end) return 0;
  return value < peak ? (value - start) / (peak - start) : (end - value) / (end - peak);
}

function Dot({ index, progress, color, animate }: {
  index: number; progress: SharedValue<number>; color: string; animate: boolean;
}): React.JSX.Element {
  const start = (index * STEP_MS) / CYCLE_MS;
  const peak = (index * STEP_MS + BOUNCE_MS / 2) / CYCLE_MS;
  const end = (index * STEP_MS + BOUNCE_MS) / CYCLE_MS;
  const animatedStyle = useAnimatedStyle(() => {
    if (!animate) return { opacity: REST_OPACITY, transform: [{ translateY: 0 }] };
    const amount = bounce(progress.value, start, peak, end);
    return {
      opacity: REST_OPACITY + (1 - REST_OPACITY) * amount,
      transform: [{ translateY: DOT_LIFT * amount }],
    };
  }, [animate, start, peak, end]);
  return (
    <Animated.View
      testID={`typing-dot-${index}`}
      style={[styles.dot, { backgroundColor: color }, animatedStyle]}
    />
  );
}

export function TypingDots({ color, height = LineHeight.caption, style, testID }: TypingDotsProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const animate = !reduceMotion;

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (!animate) return () => cancelAnimation(progress);
    progress.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [animate, progress]);

  const dotColor = color ?? theme.colors.inkSecondary;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={[styles.row, { height }, style]}
    >
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <Dot key={index} index={index} progress={progress} color={dotColor} animate={animate} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DOT_GAP,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: Radius.full,
  },
});
