import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { useAppTheme } from '../../../theme';
import { FontSize, LineHeight, Space } from '../../../theme/tokens';
const SNAP_POINTS = ['52%', '88%'];
export function DraftRecoverySheet({ visible, text, busy, disabled, onClose, onRecover }: Readonly<{
  visible: boolean; text: string; busy: boolean; disabled: boolean; onClose: () => void; onRecover: () => void;
}>) {
  const { t } = useTranslation(['chat', 'common', 'config']); const { theme } = useAppTheme();
  return <Sheet visible={visible} title={t('Recover draft')} onClose={onClose} snapPoints={SNAP_POINTS}
    testID="draft-recovery" closeAccessibilityLabel={t('Close', { ns: 'common' })}
    footer={<View style={styles.footer}><Button label={t('Restore', { ns: 'config' })} onPress={onRecover} loading={busy} disabled={disabled} testID="draft-recovery-restore" /></View>}>
    <BottomSheetScrollView contentContainerStyle={styles.content}><Text selectable style={[styles.text, { color: theme.colors.ink }]}>{text}</Text></BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({ content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl }, footer: { paddingHorizontal: Space.lg, paddingVertical: Space.md }, text: { fontSize: FontSize.body, lineHeight: LineHeight.body } });
