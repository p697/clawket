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
  compact?: boolean;
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
  compact = false,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={[title, price, detail].filter(Boolean).join(', ')}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.compact : null,
        selected ? styles.selected : styles.unselected,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View testID={testID ? `${testID}-copy` : undefined} style={compact ? styles.compactCopy : styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {!compact && detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <View testID={testID ? `${testID}-price` : undefined} style={[styles.priceGroup, compact ? styles.compactPriceGroup : null]}>
        <Text style={styles.price}>{price}</Text>
        {!compact && selected ? <Check size={IconSize.sm} color={theme.colors.accent} strokeWidth={2.5} /> : null}
      </View>
      {compact && detail ? <Text style={styles.detail}>{detail}</Text> : null}
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
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    selected: {
      borderWidth: BorderWidth.hairline,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    unselected: {
      borderWidth: BorderWidth.hairline,
      borderColor: colors.line,
      backgroundColor: colors.canvas,
    },
    compact: { flex: 1, minWidth: 0, flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch', justifyContent: 'flex-start', padding: Space.md, gap: Space.sm, borderRadius: Radius.card },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.78 },
    copy: { flex: 1, minWidth: 0 },
    // Never inherit flex: 1 into a vertical title block: Yoga can collapse its height.
    compactCopy: { flexShrink: 0, minWidth: 0 },
    compactPriceGroup: { flexShrink: 0 },
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.sm },
    title: {
      flexShrink: 1,
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    badge: {
      maxWidth: '100%',
      flexShrink: 0,
      backgroundColor: colors.surfaceFloating,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 0,
    },
    badgeText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    detail: {
      flexShrink: 0,
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    priceGroup: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    price: {
      flexShrink: 1,
      color: colors.ink,
      fontSize: FontSize.title,
      lineHeight: LineHeight.title,
      fontWeight: FontWeight.semibold,
    },
  });
}
