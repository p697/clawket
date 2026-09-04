import React, { useCallback } from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { triggerLightImpact } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import { HitSize, Shadow, createThemedShadowStyle } from '../../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  color?: string;
  disabledColor?: string;
  style?: StyleProp<ViewStyle>;
  shadow?: boolean;
};

const PRESS_SCALE = 0.78;
const SPRING_CONFIG = { damping: 12, stiffness: 400, mass: 0.6 };

export function CircleButton({
  icon,
  onPress,
  disabled,
  size = HitSize.sm,
  color,
  disabledColor,
  style,
  shadow,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const radius = size / 2;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(PRESS_SCALE, SPRING_CONFIG);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_CONFIG);
  }, [scale]);

  const handlePress = useCallback(() => {
    triggerLightImpact();
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius, backgroundColor: disabled ? (disabledColor ?? color) : color },
        disabled && styles.disabled,
        shadow && createThemedShadowStyle(theme.colors, theme.scheme, Shadow.md),
        style,
        animatedStyle,
      ]}
    >
      {icon}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
});
