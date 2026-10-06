import React, { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { CornerUpLeft, ListPlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../../components/ui/Sheet';
import { SettingsDivider, SettingsGroup, SettingsRow } from '../../../components/ui/SettingsGroup';
import { IconSize, Space } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme';

export function RunInputSheet({ visible, scope, onClose, onCurrent, onNext, canSteer, steeringPending = false }: Readonly<{
  visible: boolean; scope: string; onClose: () => void; onCurrent: () => void; onNext: () => void; canSteer: boolean;
  steeringPending?: boolean;
}>) {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const currentScope = useRef(scope); currentScope.current = scope;
  const pending = useRef<(() => void) | null>(null);
  const choose = (action: () => void) => { pending.current = () => { if (currentScope.current === scope) action(); }; onClose(); };
  return <Sheet visible={visible} title={t('Send', { ns: 'chat' })} onClose={onClose}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} tone="grouped" contentStyle={styles.body} testID="run-input-sheet"
    onAfterClose={() => { const action = pending.current; pending.current = null; action?.(); }}>
    <SettingsGroup density="comfortable">
      <SettingsRow title={t('Current task')} leading={<CornerUpLeft color={theme.colors.ink} size={IconSize.md} />}
        value={steeringPending ? t('Sending…') : undefined}
        disabled={!canSteer} onPress={() => choose(onCurrent)} testID="run-input-current" />
      <SettingsDivider />
      <SettingsRow title={t('Next message')} leading={<ListPlus color={theme.colors.ink} size={IconSize.md} />}
        onPress={() => choose(onNext)} testID="run-input-next" />
    </SettingsGroup>
  </Sheet>;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Space.lg },
});
