import React, { useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronRight } from './DirectionalIcon';
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

export type RunCardTone = 'accent' | 'bad' | 'warn';

export type RunCardProps = {
  title: string;
  icon?: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  detail?: string;
  statusLabel?: string;
  statusTone?: RunCardTone;
  tone?: RunCardTone;
  onPress?: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function RunCard({
  title,
  icon: Icon,
  detail,
  statusLabel,
  statusTone,
  tone = 'accent',
  onPress,
  disabled = false,
  trailing,
  accessibilityLabel,
  style,
  testID,
}: RunCardProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const content = (
    <>
      {Icon ? <Icon size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} /> : null}
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {statusLabel || detail ? (
          <Text
            testID={testID ? `${testID}-detail` : undefined}
            style={styles.detail}
            numberOfLines={1}
          >
            {statusLabel ? (
              <Text
                testID={testID ? `${testID}-detail-status` : undefined}
                style={statusTone ? { color: theme.colors[statusTone] } : undefined}
              >
                {statusLabel}
              </Text>
            ) : null}
            {statusLabel && detail ? ' · ' : null}
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? (
        <ChevronRight
          size={IconSize.sm}
          color={theme.colors.inkTertiary}
          strokeWidth={2}
        />
      ) : null)}
    </>
  );

  if (!onPress) {
    return <View testID={testID} style={[styles.card, style]}>{content}</View>;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
      paddingVertical: Space.md,
      paddingHorizontal: Space.md,
      minHeight: ControlSize.settingsRow,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: Space.xs,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    detail: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    pressed: {
      opacity: 0.82,
    },
    disabled: {
      opacity: 0.6,
    },
  });
}
