import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  icon?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { colors } = theme;
  return (
    <View style={styles.root}>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={[styles.action, { backgroundColor: colors.primary }]} onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.actionText, { color: colors.primaryText }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    paddingVertical: Space.xxxl,
  },
  icon: {
    fontSize: FontSize.displayLg,
    marginBottom: Space.md,
  },
  title: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Space.xs,
  },
  action: {
    marginTop: Space.lg,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.sm + 2,
    borderRadius: Radius.sm,
  },
  actionText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
});
