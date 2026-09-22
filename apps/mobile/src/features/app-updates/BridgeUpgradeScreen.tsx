import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { AccountSettingsPageHeader } from '../../screens/AccountSettings/AccountSettingsPageHeader';
import { PageIntro, FormStep, CommandBlock } from '../../components/ui/SetupPrimitives';
import { Button } from '../../components/ui/Button';

export const BRIDGE_UPGRADE_COMMAND = 'npm install -g @p697/clawket@3.0.0\nclawket restart';
export function BridgeUpgradeScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('chat');
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => { try { await Clipboard.setStringAsync(BRIDGE_UPGRADE_COMMAND); setCopied(true); setFailed(false); } catch { setFailed(true); } };
  const share = async () => { try { await Share.share({ message: `${t('Update your Bridge')}\n\n${t('Run these commands on the computer running your Agent, after its current reply finishes.')}\n\n${BRIDGE_UPGRADE_COMMAND}\n\n${t('Your connections stay saved. No need to scan or pair again.')}` }); setFailed(false); } catch { setFailed(true); } };
  return <View testID="bridge-upgrade-screen" style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
    <AccountSettingsPageHeader title="Bridge 3.0" testID="bridge-upgrade" onBack={onBack} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
      <PageIntro title={t('Update your Bridge')} description={t('Your connections stay saved. No need to scan or pair again.')} />
      <FormStep number="1" title={t('On your computer')}>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{t('Run these commands on the computer running your Agent, after its current reply finishes.')}</Text>
        <CommandBlock command={BRIDGE_UPGRADE_COMMAND} onCopy={() => { void copy(); }} copied={copied} testID="bridge-upgrade-command" copyTestID="bridge-upgrade-copy" accessibilityLabel={t('Update your Bridge')} />
        <Button variant="ghost" label={t('Send to computer')} onPress={() => { void share(); }} testID="bridge-upgrade-share" />
      </FormStep>
      <FormStep number="2" title={t('Return to Clawket')}>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{t('Once Bridge restarts, your existing connection reconnects automatically. You can keep chatting.')}</Text>
      </FormStep>
      <Text style={[styles.note, { color: colors.inkSecondary }]}>{t('Using Docker or a custom service? Update and restart Bridge with your usual deployment method.')}</Text>
      {failed ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.inkSecondary }]}>{t('Could not copy or share. You can select the commands above.')}</Text> : null}
      <Button label={t('Return to Clawket')} onPress={onBack} />
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.xl, gap: Space.xl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  body: { fontSize: FontSize.body, lineHeight: LineHeight.body },
  note: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
});
