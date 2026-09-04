import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { triggerLightImpact } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import { ControlSize, createSurfaceStyle } from '../../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ActionButtonAppearance = 'bare' | 'surface' | 'accent' | 'destructive';
export type ActionButtonSize = 'sm' | 'md';

type Props = {
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  appearance?: ActionButtonAppearance;
  size?: ActionButtonSize;
  disabled?: boolean;
  haptic?: boolean;
  iconColor?: string;
  iconSize?: number;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
};

export function ActionButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  appearance = 'surface',
  size = 'md',
  disabled = false,
  haptic = false,
  iconColor,
  iconSize,
  strokeWidth = 2,
  style,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const scale = useSharedValue(1);
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const dimension = size === 'sm' ? ControlSize.compact : ControlSize.standard;
  const resolvedIconColor = iconColor ?? (appearance === 'accent'
    ? theme.colors.primaryText
    : appearance === 'destructive'
      ? theme.colors.error
      : theme.colors.text);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const handlePress = useCallback(() => {
    if (haptic) triggerLightImpact();
    onPress();
  }, [haptic, onPress]);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={() => { scale.value = withSpring(0.84); }}
      onPressOut={() => { scale.value = withSpring(1); }}
      style={[
        styles.base,
        styles[appearance],
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        disabled ? styles.disabled : null,
        style,
        animatedStyle,
      ]}
    >
      <Icon size={iconSize ?? (size === 'sm' ? 20 : 22)} color={resolvedIconColor} strokeWidth={strokeWidth} />
    </AnimatedPressable>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    base: { alignItems: 'center', justifyContent: 'center' },
    bare: { backgroundColor: 'transparent' },
    surface: { ...createSurfaceStyle(colors, scheme, 'raised') },
    accent: { backgroundColor: colors.primary },
    destructive: { backgroundColor: colors.errorSoft },
    disabled: { opacity: 0.4 },
  });
}
