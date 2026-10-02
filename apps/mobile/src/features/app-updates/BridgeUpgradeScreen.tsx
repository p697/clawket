import React, { Fragment, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { AccountSettingsPageHeader } from '../../screens/AccountSettings/AccountSettingsPageHeader';
import { PageIntro, FormStep, CommandBlock } from '../../components/ui/SetupPrimitives';
import { Button } from '../../components/ui/Button';

import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { SettingsGroup, SettingsRow, SettingsDivider } from '../../components/ui/SettingsGroup';
import { upgradeCommand, usesBridge, newerVersion, type BridgeRelease } from './bridge-release';
export function BridgeUpgradeScreen({ onBack, connections, versions, release, checking, failed: checkFailed, onCheck, readyId }: {
  onBack: () => void; connections: readonly ConnectionDescriptor[]; versions: Readonly<Record<string, string>>;
  release: BridgeRelease | null; checking: boolean; failed: boolean; onCheck: () => void; readyId: string | null;
}) {
  const { t } = useTranslation('chat');
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const command = upgradeCommand(release);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const copied = command !== null && copiedCommand === command;
  const [failed, setFailed] = useState(false);
  const copy = async () => { try { await Clipboard.setStringAsync(command ?? ''); setCopiedCommand(command); setFailed(false); } catch { setFailed(true); } };
  const share = async () => { try { await Share.share({ message: `${t('Update your Bridge')}\n\n${t('Run these commands on the computer running your Agent, after its current reply finishes.')}\n\n${command ?? ''}\n\n${t('Your connections stay saved. No need to scan or pair again.')}` }); setFailed(false); } catch { setFailed(true); } };
  return <View testID="bridge-upgrade-screen" style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
    <AccountSettingsPageHeader title={t('Bridge and updates')} testID="bridge-upgrade" onBack={onBack} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
      <PageIntro title={t('Update your Bridge')} description={t('Your connections stay saved. No need to scan or pair again.')} />
      <SettingsGroup density="comfortable" testID="bridge-version-list">
        {connections.filter(usesBridge).map((c, index) => <Fragment key={c.id}>
          {index > 0 ? <SettingsDivider inset="none" /> : null}
          <SettingsRow title={c.label} value={versions[c.id] ?? t('Unknown', { ns: 'common' })}
            subtitle={[c.id === readyId && versions[c.id] ? t('Current Bridge version') : t('Last confirmed Bridge version'), ...(release && versions[c.id] && newerVersion(release.version, versions[c.id]) ? [t('Bridge update available')] : [])].join(' · ')}
            subtitleLines={2}
            testID={`bridge-version-${c.id}`} />
        </Fragment>)}
      </SettingsGroup>
      {release ? <Text style={[styles.body, { color: colors.inkSecondary }]}>{t('Latest Bridge: {{version}}', { version: release.version })}</Text> : null}
      <Button variant="ghost" label={t('Check for Bridge updates')} onPress={onCheck} disabled={checking} testID="bridge-check-updates" />
      {checkFailed ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.inkSecondary }]}>{t('Could not check Bridge updates. Try again later.')}</Text> : null}
      {command ? <FormStep number="1" title={t('On your computer')}>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{t('Run these commands on the computer running your Agent, after its current reply finishes.')}</Text>
        <CommandBlock command={command} onCopy={() => { void copy(); }} copied={copied} testID="bridge-upgrade-command" copyTestID="bridge-upgrade-copy" accessibilityLabel={t('Update your Bridge')} />
        <Button variant="ghost" label={t('Send to computer')} onPress={() => { void share(); }} testID="bridge-upgrade-share" />
      </FormStep> : release ? <Text style={[styles.body, { color: colors.inkSecondary }]}>{t('The unified updater is available in newer Bridge releases. Use your original deployment method for this release.')}</Text> : null}
      <FormStep number="2" title={t('Return to Clawket')}>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{t('Once Bridge restarts, your existing connection reconnects automatically. You can keep chatting.')} {t('Confirm the current version here after reconnecting.')}</Text>
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
