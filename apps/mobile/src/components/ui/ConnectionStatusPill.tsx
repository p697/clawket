import React, { useEffect, useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import { CircleAlert, WifiOff } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
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
import { createFloatingSurfaceStyle, FLOATING_BUTTON_STROKE_WIDTH } from './FloatingButton';

/**
 * Connection state lives in the chrome, not in the content: a quiet capsule
 * that never takes layout space, so a reconnect after backgrounding cannot
 * push the page around. `inline` sits in a header slot or list header;
 * `floating` overlays the top of a positioned content region.
 *
 * Reconnecting breathes its label on the Skeleton cadence and carries no
 * action; offline and error keep one action word and the whole capsule is
 * the 44-point target.
 */
export type ConnectionStatusPillStatus = 'reconnecting' | 'offline' | 'error';
export type ConnectionStatusPillPlacement = 'inline' | 'floating';

export type ConnectionStatusPillProps = Readonly<{
  status: ConnectionStatusPillStatus;
  /** Status copy; omit when the surrounding chrome already states it (Roster header, Thread subtitle). */
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  placement?: ConnectionStatusPillPlacement;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export const CONNECTION_STATUS_PILL_HEIGHT = ControlSize.pill;
/** Vertical slop that lifts the 40-point capsule to the 44-point touch target. */
export const CONNECTION_STATUS_PILL_HIT_SLOP = (ControlSize.floatingButton - ControlSize.pill) / 2;
export const CONNECTION_STATUS_PILL_ICON_SIZE = IconSize.sm;

/** Quiet recovery breath: the label is a loading surface while recovery runs. */
const RECONNECTING_RESTING_OPACITY = 0.36;
const RECONNECTING_PEAK_OPACITY = 0.9;
const PRESSED_OPACITY = 0.72;

const PILL_FADE_IN = FadeIn
  .duration(Motion.duration.normal)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
const PILL_FADE_OUT = FadeOut
  .duration(Motion.duration.fast)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);

export function ConnectionStatusPill({
  status,
  message,
  actionLabel,
  onAction,
  placement = 'floating',
  accessibilityLabel,
  style,
  testID,
}: ConnectionStatusPillProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const breathing = status === 'reconnecting';
  const labelOpacity = useSharedValue(breathing && !reduceMotion ? RECONNECTING_RESTING_OPACITY : 1);

  useEffect(() => {
    cancelAnimation(labelOpacity);
    if (!breathing || reduceMotion) {
      labelOpacity.value = breathing ? RECONNECTING_PEAK_OPACITY : 1;
      return () => cancelAnimation(labelOpacity);
    }
    labelOpacity.value = RECONNECTING_RESTING_OPACITY;
    labelOpacity.value = withRepeat(
      withTiming(RECONNECTING_PEAK_OPACITY, {
        duration: Motion.avatarWorkingLoop,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(labelOpacity);
  }, [breathing, labelOpacity, message, reduceMotion]);

  const labelAnimatedStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));
  const chrome = useMemo(
    () => (placement === 'floating'
      ? createFloatingSurfaceStyle(theme.colors, theme.scheme)
      : { backgroundColor: theme.colors.surface }),
    [placement, theme.colors, theme.scheme],
  );

  const Glyph = status === 'offline' ? WifiOff : status === 'error' ? CircleAlert : null;
  const glyphColor = status === 'error' ? theme.colors.bad : theme.colors.inkSecondary;
  const actionable = Boolean(actionLabel && onAction);
  const resolvedAccessibilityLabel = accessibilityLabel
    ?? [message, actionLabel].filter(Boolean).join(', ');

  const content = (
    <>
      {Glyph ? (
        <Glyph
          size={CONNECTION_STATUS_PILL_ICON_SIZE}
          color={glyphColor}
          strokeWidth={FLOATING_BUTTON_STROKE_WIDTH}
        />
      ) : null}
      {message ? (
        <Animated.View style={[styles.messageSlot, labelAnimatedStyle]}>
          <Text
            testID={testID ? `${testID}-message` : undefined}
            numberOfLines={1}
            style={[styles.message, { color: theme.colors.ink }]}
          >
            {message}
          </Text>
        </Animated.View>
      ) : null}
      {actionLabel ? (
        <Text
          testID={testID ? `${testID}-label` : undefined}
          numberOfLines={1}
          // With a message the action word stays whole and the message truncates first; a
          // lone action word (narrow header slots) must be able to shrink itself.
          style={[styles.action, message ? null : styles.messageSlot, { color: theme.colors.ink }]}
        >
          {actionLabel}
        </Text>
      ) : null}
    </>
  );

  const capsule = actionable ? (
    <Pressable
      testID={testID ? `${testID}-action` : undefined}
      accessibilityRole="button"
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityLiveRegion="polite"
      hitSlop={{ top: CONNECTION_STATUS_PILL_HIT_SLOP, bottom: CONNECTION_STATUS_PILL_HIT_SLOP }}
      onPress={onAction}
      style={({ pressed }) => [styles.pill, chrome, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  ) : (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.pill, chrome]}
    >
      {content}
    </View>
  );

  return (
    <Animated.View
      testID={testID}
      pointerEvents="box-none"
      entering={reduceMotion ? undefined : PILL_FADE_IN}
      exiting={reduceMotion ? undefined : PILL_FADE_OUT}
      style={[placement === 'floating' ? styles.floating : styles.inline, style]}
    >
      {capsule}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute',
    top: Space.sm,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  inline: {
    alignItems: 'center',
    maxWidth: '100%',
  },
  pill: {
    height: CONNECTION_STATUS_PILL_HEIGHT,
    maxWidth: '100%',
    borderRadius: Radius.full,
    paddingHorizontal: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  messageSlot: {
    flexShrink: 1,
    minWidth: 0,
  },
  message: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
  },
  action: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
