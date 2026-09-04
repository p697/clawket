import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, type ViewStyle, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';

export const SYSTEM_EVENT_ICON_SIZE = 14;
export const SYSTEM_EVENT_STROKE_WIDTH = 1.75;

const PRESSED_OPACITY = 0.72;

export type SystemEventRowProps = Readonly<{
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function SystemEventRow({
  icon: Icon,
  label,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: SystemEventRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const content = (
    <>
      <Icon
        size={SYSTEM_EVENT_ICON_SIZE}
        color={theme.colors.inkSecondary}
        strokeWidth={SYSTEM_EVENT_STROKE_WIDTH}
      />
      <Text style={[styles.label, { color: theme.colors.inkSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      {onPress ? (
        <ChevronRight
          testID={testID ? `${testID}-disclosure` : undefined}
          size={SYSTEM_EVENT_ICON_SIZE}
          color={theme.colors.inkTertiary}
          strokeWidth={SYSTEM_EVENT_STROKE_WIDTH}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View testID={testID} style={[styles.row, style]}>{content}</View>;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'center',
    minHeight: LineHeight.caption,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
  },
  label: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
