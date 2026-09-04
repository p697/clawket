import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

const PRESSED_OPACITY = 0.72;

export type BannerTone = 'warn' | 'bad';

export type BannerProps = Readonly<{
  message: string;
  tone?: BannerTone;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function Banner({
  message,
  tone = 'warn',
  icon: Icon,
  actionLabel,
  onAction,
  accessibilityLabel,
  style,
  testID,
}: BannerProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const backgroundColor = tone === 'bad' ? theme.colors.badSoft : theme.colors.warnSoft;
  const toneColor = tone === 'bad' ? theme.colors.bad : theme.colors.warn;

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={accessibilityLabel ?? message}
      style={[styles.banner, { backgroundColor }, style]}
    >
      {Icon ? <Icon size={IconSize.sm} color={toneColor} /> : null}
      <Text style={[styles.message, { color: theme.colors.ink }]}>
        {message}
      </Text>
      {actionLabel ? (
        onAction ? (
          <Pressable
            testID={testID ? `${testID}-action` : undefined}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={onAction}
            hitSlop={Space.sm}
            style={({ pressed }) => pressed ? styles.pressed : null}
          >
            <Text style={[styles.action, { color: theme.colors.ink }]} numberOfLines={1}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.action, { color: theme.colors.ink }]} numberOfLines={1}>
            {actionLabel}
          </Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: ControlSize.floatingButton,
    borderRadius: Radius.card,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  message: {
    flex: 1,
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
