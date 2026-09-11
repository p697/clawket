import React, { useCallback, useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import type { CanonicalThemeColors, ThemeScheme } from '../../theme/theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Radius,
  Shadow,
  Space,
  StatusSize,
} from '../../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const FLOATING_BUTTON_ICON_SIZE = ControlSize.floatingButton / 2;
export const FLOATING_BUTTON_STROKE_WIDTH = 1.75;
export const FLOATING_PRIMARY_BUTTON_SIZE = 64;

const DISABLED_OPACITY = 0.4;
const PRESSED_OPACITY = 0.88;

export type FloatingButtonAppearance = 'surface' | 'quiet' | 'plain' | 'accent' | 'ink' | 'destructive';

export type FloatingButtonBadge = Readonly<{
  tone: 'accent' | 'bad';
  count?: number;
}>;

export type FloatingButtonProps = Readonly<{
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  appearance?: FloatingButtonAppearance;
  size?: 'default' | 'primary';
  disabled?: boolean;
  badge?: FloatingButtonBadge;
  iconSize?: number;
  iconColor?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

type FloatingButtonChrome = Readonly<{
  surface: ViewStyle;
  iconColor: string;
}>;

export function createFloatingSurfaceStyle(
  colors: CanonicalThemeColors,
  scheme: ThemeScheme,
): ViewStyle {
  if (scheme === 'dark') {
    return {
      backgroundColor: colors.surfaceFloating,
      borderWidth: BorderWidth.hairline,
      borderColor: colors.line,
      elevation: 0,
      shadowOpacity: 0,
    };
  }
  return {
    backgroundColor: colors.surfaceFloating,
    ...Shadow.floating,
  };
}

export function resolveFloatingButtonChrome(
  colors: CanonicalThemeColors,
  scheme: ThemeScheme,
  appearance: FloatingButtonAppearance,
): FloatingButtonChrome {
  const lifted = createFloatingSurfaceStyle(colors, scheme);
  if (appearance === 'plain') return { surface: { backgroundColor: 'transparent' }, iconColor: colors.ink };
  if (appearance === 'quiet') {
    return {
      surface: { backgroundColor: colors.surface },
      iconColor: colors.ink,
    };
  }
  if (appearance === 'accent') {
    return {
      surface: { ...lifted, backgroundColor: colors.accent },
      iconColor: colors.canvas,
    };
  }
  if (appearance === 'ink') {
    return {
      surface: { ...lifted, backgroundColor: colors.ink },
      iconColor: colors.canvas,
    };
  }
  if (appearance === 'destructive') {
    return {
      surface: { ...lifted, backgroundColor: colors.badSoft },
      iconColor: colors.bad,
    };
  }
  return {
    surface: lifted,
    iconColor: colors.ink,
  };
}

export function formatFloatingButtonBadgeCount(count: number): string {
  const normalized = Math.max(0, Math.trunc(count));
  return normalized > 99 ? '99+' : String(normalized);
}

export function FloatingButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  appearance = 'plain',
  size = 'default',
  disabled = false,
  badge,
  iconSize,
  iconColor,
  strokeWidth = FLOATING_BUTTON_STROKE_WIDTH,
  style,
  testID,
}: FloatingButtonProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressedOpacity = useSharedValue(1);
  const chrome = useMemo(
    () => resolveFloatingButtonChrome(theme.colors, theme.scheme, appearance),
    [appearance, theme.colors, theme.scheme],
  );
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: disabled ? (appearance === 'quiet' ? 1 : DISABLED_OPACITY) : pressedOpacity.value,
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

  const badgeBackground = badge?.tone === 'bad' ? theme.colors.bad : theme.colors.accent;

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.button,
        chrome.surface,
        size === 'primary' ? styles.primaryButton : null,
        style,
        animatedStyle,
      ]}
    >
      <Icon
        size={iconSize ?? (size === 'primary' ? FLOATING_PRIMARY_BUTTON_SIZE / 2 : FLOATING_BUTTON_ICON_SIZE)}
        color={disabled && appearance === 'quiet' ? theme.colors.inkTertiary : iconColor ?? chrome.iconColor}
        strokeWidth={strokeWidth}
      />
      {badge ? (
        badge.count === undefined ? (
          <View
            testID={testID ? `${testID}-badge` : undefined}
            style={[styles.dotBadge, { backgroundColor: badgeBackground }]}
          />
        ) : (
          <View
            testID={testID ? `${testID}-badge` : undefined}
            style={[styles.countBadge, { backgroundColor: badgeBackground }]}
          >
            <Text style={[styles.countText, { color: theme.colors.canvas }]}>
              {formatFloatingButtonBadgeCount(badge.count)}
            </Text>
          </View>
        )
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: ControlSize.floatingButton,
    height: ControlSize.floatingButton,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    width: FLOATING_PRIMARY_BUTTON_SIZE,
    height: FLOATING_PRIMARY_BUTTON_SIZE,
  },
  dotBadge: {
    position: 'absolute',
    top: -Space.xs,
    right: -Space.xs,
    width: StatusSize.attention,
    height: StatusSize.attention,
    borderRadius: Radius.full,
  },
  countBadge: {
    position: 'absolute',
    top: -Space.sm,
    right: -Space.sm,
    minWidth: LineHeight.caption,
    height: LineHeight.caption,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
});
