import React, { useRef } from 'react';
import { CornerUpLeft, ListPlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../../components/ui/Sheet';
import { SettingsRow } from '../../../components/ui/SettingsGroup';
import { IconSize } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme';

const SNAP_POINTS = ['32%'];
export function RunInputSheet({ visible, scope, onClose, onCurrent, onNext, canSteer }: Readonly<{
  visible: boolean; scope: string; onClose: () => void; onCurrent: () => void; onNext: () => void; canSteer: boolean;
}>) {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const currentScope = useRef(scope); currentScope.current = scope;
  const pending = useRef<(() => void) | null>(null);
  const choose = (action: () => void) => { pending.current = () => { if (currentScope.current === scope) action(); }; onClose(); };
  return <Sheet visible={visible} title={t('Send', { ns: 'chat' })} onClose={onClose}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={SNAP_POINTS} testID="run-input-sheet"
    onAfterClose={() => { const action = pending.current; pending.current = null; action?.(); }}>
    <SettingsRow title={t('Current task')} leading={<CornerUpLeft color={theme.colors.ink} size={IconSize.md} />}
      disabled={!canSteer} onPress={() => choose(onCurrent)} testID="run-input-current" />
    <SettingsRow title={t('Next message')} leading={<ListPlus color={theme.colors.ink} size={IconSize.md} />}
      onPress={() => choose(onNext)} testID="run-input-next" />
  </Sheet>;
}
