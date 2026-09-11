import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../theme/tokens';
import { Companion } from './Companion';
import { resolveFloatingButtonChrome } from './FloatingButton';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Component-owned 32-point capsule; hitSlop restores the 44-point floating-button target. */
export const PRO_ENTRY_HEIGHT = 32;
export const PRO_ENTRY_HIT_SLOP = (ControlSize.floatingButton - PRO_ENTRY_HEIGHT) / 2;
export const PRO_ENTRY_COMPANION_SIZE = IconSize.md;

const PRESSED_OPACITY = 0.88;

export type ProEntryButtonProps = Readonly<{
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}>;

/**
 * Header-level subscription entry: a 32-point ink capsule that sits beside the
 * 44-point floating navigation buttons. The brand Companion looks around and
 * blinks inside it in inverse (canvas) tone; the shared reduced-motion and
 * background rules of `Companion` apply. It is the only text badge allowed in
 * a page header and is rendered only while the user is not subscribed.
 */
export function ProEntryButton({
  label,
  onPress,
  accessibilityLabel,
  testID,
}: ProEntryButtonProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressedOpacity = useSharedValue(1);
  const chrome = useMemo(
    () => resolveFloatingButtonChrome(theme.colors, theme.scheme, 'ink'),
    [theme.colors, theme.scheme],
  );
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pressedOpacity.value,
    transform: [{ scale: scale.value }],
  }));
  const handlePressIn = useCallback(() => {
    pressedOpacity.value = withTiming(PRESSED_OPACITY, { duration: Motion.duration.fast });
    if (!reduceMotion) {
      scale.value = withTiming(Motion.pressedScale, { duration: Motion.duration.fast });
    }
  }, [pressedOpacity, reduceMotion, scale]);
  const handlePressOut = useCallback(() => {
    pressedOpacity.value = withTiming(1, { duration: Motion.duration.fast });
    scale.value = withTiming(1, { duration: Motion.duration.fast });
  }, [pressedOpacity, scale]);

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={PRO_ENTRY_HIT_SLOP}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.pill, chrome.surface, animatedStyle]}
    >
      <Companion
        testID={testID ? `${testID}-companion` : undefined}
        size={PRO_ENTRY_COMPANION_SIZE}
        pose="curious"
        tone="inverse"
      />
      <Text style={[styles.label, { color: chrome.iconColor }]} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: PRO_ENTRY_HEIGHT,
    borderRadius: Radius.full,
    paddingLeft: Space.sm,
    paddingRight: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  label: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
});
