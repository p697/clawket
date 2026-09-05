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
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.inkSecondary }]}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={[styles.action, { backgroundColor: colors.accent }]} onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.actionText, { color: colors.onAccent }]}>{actionLabel}</Text>
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
    paddingVertical: Space.xxl,
  },
  icon: {
    fontSize: FontSize.display,
    marginBottom: Space.md,
  },
  title: {
    fontSize: FontSize.secondary,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.caption,
    textAlign: 'center',
    marginTop: Space.xs,
  },
  action: {
    marginTop: Space.lg,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.sm + 2,
    borderRadius: Radius.full,
  },
  actionText: {
    fontSize: FontSize.secondary,
    fontWeight: FontWeight.semibold,
  },
});
