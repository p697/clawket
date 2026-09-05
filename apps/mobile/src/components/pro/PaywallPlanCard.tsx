import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

type Props = Readonly<{
  title: string;
  price: string;
  detail: string | null;
  badge?: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}>;

export function PaywallPlanCard({
  title,
  price,
  detail,
  badge = null,
  selected,
  disabled = false,
  onPress,
  testID,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={`${title}, ${price}`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected ? styles.selected : styles.unselected,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      <View style={styles.priceGroup}>
        <Text style={styles.price}>{price}</Text>
        {selected ? <Check size={IconSize.sm} color={theme.colors.accent} strokeWidth={2.5} /> : null}
      </View>
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      minHeight: ControlSize.settingsRow,
      borderRadius: Radius.settingsGroup,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    selected: {
      borderWidth: BorderWidth.strong,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    unselected: {
      backgroundColor: colors.surfaceFloating,
    },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.78 },
    copy: { flex: 1, minWidth: 0 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    title: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
    badge: {
      backgroundColor: colors.accent,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    badgeText: {
      color: colors.onAccent,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    detail: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    priceGroup: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    price: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
  });
}
