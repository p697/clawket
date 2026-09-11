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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'neutral' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  /** Allow long translations and accessibility text sizes to grow the button vertically. */
  multiline?: boolean;
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
  multiline = false,
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
  const contentColor = variant === 'text' ? theme.colors.inkSecondary : variant === 'neutral' || variant === 'primary'
    ? disabled && !loading ? theme.colors.inkTertiary : theme.colors.canvas
    : variant === 'destructive'
      ? theme.colors.bad
      : variant === 'ghost'
        ? theme.colors.ink
        : theme.colors.ink;
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
        multiline ? styles.multiline : null,
        styles[`size${size.toUpperCase()}` as 'sizeSM' | 'sizeMD' | 'sizeLG'],
        styles[variant],
        pressed && !isDisabled
          ? variant === 'primary' || variant === 'neutral' ? styles.primaryPressed : styles.surfacePressed
          : null,
        isDisabled ? variant === 'neutral' || variant === 'primary' ? loading ? null : styles.neutralDisabled : styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      <View style={[styles.content, multiline ? styles.multilineContent : null, loading ? styles.contentHidden : null]}>
        {Icon ? <Icon size={iconSize} color={contentColor} strokeWidth={2} /> : null}
        <Text style={[styles.label, size === 'sm' ? styles.labelSM : size === 'lg' ? styles.labelLG : null, variant === 'text' ? styles.textLabel : null, { color: contentColor }, multiline ? styles.multilineLabel : null, textStyle]} numberOfLines={multiline ? undefined : 1}>
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
    multilineContent: { alignSelf: 'stretch' },
    multiline: { paddingVertical: Space.md },
    multilineLabel: { flexShrink: 1, textAlign: 'center' },
    sizeSM: { minHeight: HitSize.sm, paddingHorizontal: Space.md },
    sizeMD: { minHeight: ControlSize.floatingButton },
    sizeLG: { minHeight: ControlSize.settingsRow, paddingHorizontal: Space.xl },
    primary: { backgroundColor: colors.ink },
    neutral: { backgroundColor: colors.ink },
    neutralDisabled: { backgroundColor: colors.surface },
    secondary: { backgroundColor: colors.surface },
    ghost: {
      backgroundColor: 'transparent',
    },
    text: { backgroundColor: 'transparent' },
    textLabel: { fontWeight: FontWeight.regular },
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
