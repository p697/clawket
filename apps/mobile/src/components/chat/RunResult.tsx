import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';

/** A real execution summary, including runs that do not own a child conversation. */
export function RunResult({ summary, statusLabel }: { summary?: string; statusLabel: string }) {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={[styles.status, { color: theme.colors.inkSecondary }]}>{statusLabel}</Text>
    <Text selectable style={[styles.body, { color: theme.colors.ink }]}>
      {summary?.trim() === 'NO_REPLY' ? t('Completed without a text reply.') : summary || t('No execution summary was recorded.')}
    </Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: Space.lg, gap: Space.md },
  status: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  body: { fontSize: FontSize.body, lineHeight: LineHeight.body },
});
