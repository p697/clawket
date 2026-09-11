import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';

export function ReplyFailureSheet({ visible, summary, details, onClose, onDismiss }: {
  visible: boolean; summary: string; details: string; onClose: () => void; onDismiss: () => void;
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [visible, details]);
  return <Sheet testID="reply-failure-details" visible={visible} onClose={onClose}
    title={t('Reply failed')} closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={['68%', '92%']}>
    <ScrollView contentContainerStyle={{ padding: Space.lg, gap: Space.lg }}>
      <Text style={{ color: theme.colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold }}>{summary}</Text>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: Radius.card, padding: Space.md }}>
        <Text selectable testID="reply-failure-diagnostic" style={{ color: theme.colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary }}>{details}</Text>
      </View>
      <Button label={copied ? t('Copied') : t('Copy details')} variant="secondary" onPress={() => {
        void Clipboard.setStringAsync(details).then(() => setCopied(true)).catch(() => setCopied(false));
      }} />
      <Button label={t('Close', { ns: 'common' })} variant="text" onPress={onDismiss} />
    </ScrollView>
  </Sheet>;
}
