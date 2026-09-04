import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import { LineHeight, Motion, Radius } from '../../theme/tokens';

const SKELETON_RESTING_OPACITY = 0.48;

export type SkeletonProps = Readonly<{
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}>;

export function Skeleton({
  style,
  accessibilityLabel,
  testID,
}: SkeletonProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : SKELETON_RESTING_OPACITY);

  useEffect(() => {
    cancelAnimation(opacity);
    if (reduceMotion) {
      opacity.value = 1;
      return () => cancelAnimation(opacity);
    }
    opacity.value = SKELETON_RESTING_OPACITY;
    opacity.value = withRepeat(
      withTiming(1, {
        duration: Motion.avatarWorkingLoop,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      testID={testID}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.skeleton,
        { backgroundColor: theme.colors.surface },
        style,
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    minHeight: LineHeight.caption,
    borderRadius: Radius.card,
  },
});
