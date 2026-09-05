import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
  type PressableProps,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { triggerLightImpact } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  HitSize,
  Radius,
  Space,
  createSurfaceStyle,
} from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  haptic?: boolean;
  /** Layout-only override: margin, width, flex, and alignment. */
  style?: StyleProp<ViewStyle>;
  /** Typography-only override. Component chrome remains centralized. */
  textStyle?: StyleProp<TextStyle>;
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  haptic = false,
  disabled = false,
  onPress,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityState,
  ...rest
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const isDisabled = disabled || loading;
  const contentColor = variant === 'primary'
    ? theme.colors.onAccent
    : variant === 'destructive'
      ? theme.colors.bad
      : variant === 'ghost'
        ? theme.colors.ink
        : theme.colors.accent;
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;

  const handlePress = useCallback<NonNullable<PressableProps['onPress']>>((event) => {
    if (haptic) triggerLightImpact();
    onPress?.(event);
  }, [haptic, onPress]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        styles[`size${size.toUpperCase()}` as 'sizeSM' | 'sizeMD' | 'sizeLG'],
        styles[variant],
        pressed && !isDisabled
          ? variant === 'primary' ? styles.primaryPressed : styles.surfacePressed
          : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      <View style={[styles.content, loading ? styles.contentHidden : null]}>
        {Icon ? <Icon size={iconSize} color={contentColor} strokeWidth={2} /> : null}
        <Text style={[styles.label, size === 'sm' ? styles.labelSM : size === 'lg' ? styles.labelLG : null, { color: contentColor }, textStyle]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {loading ? <ActivityIndicator color={contentColor} style={styles.spinner} /> : null}
    </Pressable>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    base: {
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      borderRadius: Radius.full,
      paddingHorizontal: Space.lg,
    },
    sizeSM: { minHeight: HitSize.sm, paddingHorizontal: Space.md },
    sizeMD: { minHeight: ControlSize.floatingButton },
    sizeLG: { minHeight: HitSize.lg, paddingHorizontal: Space.xl },
    primary: {
      ...createSurfaceStyle(colors, scheme, 'raised'),
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    secondary: {
      ...createSurfaceStyle(colors, scheme, 'flat'),
    },
    ghost: {
      backgroundColor: 'transparent',
    },
    destructive: {
      ...createSurfaceStyle(colors, scheme, 'flat'),
      backgroundColor: colors.badSoft,
    },
    primaryPressed: { opacity: 0.84 },
    surfacePressed: { backgroundColor: colors.surface },
    disabled: { opacity: 0.45 },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    contentHidden: { opacity: 0 },
    spinner: { position: 'absolute' },
    label: { fontSize: FontSize.secondary, fontWeight: FontWeight.semibold },
    labelSM: { fontSize: FontSize.caption },
    labelLG: { fontSize: FontSize.body },
  });
}
