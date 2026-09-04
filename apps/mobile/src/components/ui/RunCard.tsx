import React, { useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  BorderWidth,
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
  detail?: string;
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
  detail,
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
      <View
        testID={testID ? `${testID}-status` : undefined}
        style={[styles.status, { backgroundColor: theme.colors[tone] }]}
      />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
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
      paddingRight: Space.md,
    },
    status: {
      alignSelf: 'stretch',
      width: BorderWidth.emphasis,
      borderRadius: Radius.full,
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
