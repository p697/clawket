import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Bot, Brain, ChartColumnIncreasing, Files, Infinity as InfinityIcon, MessagesSquare, Network, Search, Wrench, type LucideIcon } from 'lucide-react-native';
import type { PaywallBenefitKind } from '../../screens/Paywall/model';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, IconSize, LineHeight, Space } from '../../theme/tokens';

const ICONS: Readonly<Record<PaywallBenefitKind, LucideIcon>> = {
  connections: Network, agents: Bot, manage: Wrench, logsFiles: Files,
  search: Search, combined: InfinityIcon, memory: Brain, sessions: MessagesSquare, usage: ChartColumnIncreasing,
};

/** Intrinsic-width group for short copy; long translations wrap within the screen margins. */
export function PaywallBenefits({ items }: { items: readonly { kind: PaywallBenefitKind; label: string }[] }): React.JSX.Element {
  const { theme: { colors } } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  return (
    <View testID="paywall-benefits" style={styles.group}>
      {items.map(item => {
        const Icon = ICONS[item.kind];
        return (
          <View key={item.kind} style={styles.row}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.icon, { paddingTop: Math.max(0, (LineHeight.body * fontScale - IconSize.sm) / 2) }]}>
              <Icon size={IconSize.sm} color={colors.inkSecondary} strokeWidth={1.65}/>
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { alignSelf: 'center', maxWidth: '100%', gap: Space.lg, marginTop: Space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, maxWidth: '100%' },
  icon: { flexShrink: 0 },
  label: { flexShrink: 1, minWidth: 0, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.regular, textAlign: 'left' },
});
