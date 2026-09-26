import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/ui/Button';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, IconSize, Radius, Space } from '../../../theme/tokens';

/** Decorative history only: hidden messages never enter the native/accessibility tree. */
export function SessionPreviewNotice({ onUpgrade }: { onUpgrade: () => void }): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  return <View testID="session-preview-history" style={styles.container}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      pointerEvents="none" style={styles.history}>
      <View style={[styles.line, { width: '64%', opacity: 0.12, backgroundColor: theme.colors.inkTertiary }]} />
      <View style={[styles.line, { width: '42%', opacity: 0.08, alignSelf: 'flex-end', backgroundColor: theme.colors.inkTertiary }]} />
      <View style={[styles.line, { width: '76%', opacity: 0.04, backgroundColor: theme.colors.inkTertiary }]} />
    </View>
    <LockKeyhole size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} />
    <Text style={[styles.title, { color: theme.colors.ink }]}>{t('View the full conversation')}</Text>
    <Text style={[styles.detail, { color: theme.colors.inkSecondary }]}>
      {t('Unlock complete channel, task and subagent conversations with Pro.')}
    </Text>
    <Button testID="session-preview-upgrade" label={t('Upgrade to Pro')} onPress={onUpgrade} />
  </View>;
}

export function SessionPreviewFooter({ onUpgrade, onMain, mainLabel, bottomInset, loading = false }: {
  onUpgrade: () => void; onMain: () => void; mainLabel?: string; bottomInset: number; loading?: boolean;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.2;
  return <View testID="session-preview-footer" style={[styles.footer, { paddingBottom: Math.max(bottomInset, Space.lg) }]}>
    <Text style={[styles.detail, { color: theme.colors.inkSecondary }]}>{loading ? t('Loading history') : t('Latest messages · read-only preview')}</Text>
    <View style={[styles.actions, stacked ? { flexDirection: 'column' } : null]}>
      <Button label={mainLabel ?? t('Main chat')} accessibilityLabel={mainLabel ?? t('Back to main chat')} variant="secondary" onPress={onMain} style={stacked ? undefined : styles.action} />
      <Button label={t('Upgrade to Pro')} accessibilityLabel={t('Unlock conversation')} onPress={onUpgrade} style={stacked ? undefined : styles.action} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { padding: Space.xl, gap: Space.md, alignItems: 'center' },
  history: { width: '100%', gap: Space.md, marginBottom: Space.sm },
  line: { height: Space.lg, borderRadius: Radius.full },
  title: { fontSize: FontSize.body, fontWeight: FontWeight.semibold, textAlign: 'center' },
  detail: { fontSize: FontSize.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
  footer: { paddingHorizontal: Space.lg, paddingTop: Space.md, gap: Space.md },
  actions: { flexDirection: 'row', gap: Space.sm },
  action: { flex: 1 },
});
