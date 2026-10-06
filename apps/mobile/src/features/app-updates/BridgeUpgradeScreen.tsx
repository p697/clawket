import React, { Fragment, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Share, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, CircleCheck, Copy, MonitorUp, Share as ShareIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { AccountSettingsPageHeader } from '../../screens/AccountSettings/AccountSettingsPageHeader';
import { Button } from '../../components/ui/Button';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import { SettingsGroup, SettingsRow, SettingsDivider } from '../../components/ui/SettingsGroup';
import { upgradeCommand, usesBridge, newerVersion, type BridgeRelease } from './bridge-release';
import type { RemoteUpdateView } from './useBridgeRemoteUpdate';

/** Phone-started update of the current connection's computer (owner decision 2026-10-06). */
export type BridgeRemoteUpdateProps = { available: boolean; connectionLabel: string; view: RemoteUpdateView; onStart: () => void };

/**
 * State-driven guide (owner decision 2026-10-06). With an outdated Bridge the page leads with
 * those connections, then the command, then the rest; otherwise it is a status page without
 * the command. Rows open the Connection page, whose reconnect refreshes saved evidence.
 */
export function BridgeUpgradeScreen({ onBack, connections, versions, outdatedIds, release, checking, failed: checkFailed, onCheck, onOpenConnection, remoteUpdate }: {
  onBack: () => void; connections: readonly ConnectionDescriptor[]; versions: Readonly<Record<string, string>>;
  /** Authenticated evidence of an older Bridge: the same set that marks the Settings row. */
  outdatedIds: readonly string[];
  release: BridgeRelease | null; checking: boolean; failed: boolean; onCheck: () => void;
  onOpenConnection: (connectionId: string) => void;
  remoteUpdate?: BridgeRemoteUpdateProps;
}) {
  const { t } = useTranslation('chat');
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const command = upgradeCommand(release);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const copied = command !== null && copiedCommand === command;
  const [actionFailed, setActionFailed] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const remote = remoteUpdate && (remoteUpdate.available || remoteUpdate.view.phase !== 'idle') ? remoteUpdate : undefined;
  // The phone action leads; the command stays one tap away and returns by itself after a failure.
  const commandVisible = !remote || showCommand || remote.view.phase === 'failed';
  // Remember what was outdated while the page is open, so a reconnect on the latest version reads as done.
  const [seenOutdated, setSeenOutdated] = useState<ReadonlySet<string>>(() => new Set(outdatedIds));
  useEffect(() => {
    setSeenOutdated(previous => outdatedIds.every(id => previous.has(id)) ? previous : new Set([...previous, ...outdatedIds]));
  }, [outdatedIds]);
  const latest = release?.version ?? null;
  const bridged = connections.filter(usesBridge);
  const outdated = bridged.filter(c => outdatedIds.includes(c.id));
  const others = bridged.filter(c => !outdatedIds.includes(c.id));
  const isCurrent = (id: string) => latest !== null && versions[id] !== undefined && !newerVersion(latest, versions[id]);
  const isUpdated = (id: string) => seenOutdated.has(id) && !outdatedIds.includes(id) && isCurrent(id);
  const allCurrent = others.length > 0 && others.every(c => isCurrent(c.id));
  const footnote = [styles.note, { color: colors.inkSecondary }];
  const copy = async () => { try { await Clipboard.setStringAsync(command ?? ''); setCopiedCommand(command); setActionFailed(false); } catch { setActionFailed(true); } };
  const share = async () => {
    try {
      await Share.share({ message: [t('Run on the computer with your Agent'), command ?? '', t('Replies still in progress are interrupted. Clawket reconnects on its own, no pairing needed.')].join('\n\n') });
      setActionFailed(false);
    } catch { setActionFailed(true); }
  };
  const rows = (list: readonly ConnectionDescriptor[]) => list.map((c, index) => {
    const old = outdatedIds.includes(c.id);
    const updated = isUpdated(c.id);
    const value = versions[c.id] ?? (old ? t('Old version') : t('Unknown', { ns: 'common' }));
    return <Fragment key={c.id}>
      {index > 0 ? <SettingsDivider inset="content" /> : null}
      <SettingsRow testID={`bridge-version-${c.id}`} title={c.label} value={value} attention={old}
        accessibilityLabel={[c.label, value, ...(old ? [t('New version')] : updated ? [t('Update complete')] : [])].join(', ')}
        trailing={updated ? <View style={styles.updated}>
          <Check testID={`bridge-version-${c.id}-updated`} size={IconSize.sm} color={colors.good} strokeWidth={2} />
          <ChevronRight size={IconSize.sm} color={colors.inkTertiary} strokeWidth={2} />
        </View> : undefined}
        showChevron onPress={() => onOpenConnection(c.id)} />
    </Fragment>;
  });
  const checkButton = (label: string) => <Button testID="bridge-check-updates" variant="ghost" label={label} loading={checking} onPress={onCheck} />;
  return <View testID="bridge-upgrade-screen" style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
    <AccountSettingsPageHeader title={t('Bridge updates')} testID="bridge-upgrade" onBack={onBack} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
      {outdated.length ? <>
        <Section title={latest ? t('Update to {{version}}', { version: latest }) : t('Needs update')} testID="bridge-outdated">
          <SettingsGroup density="comfortable" testID="bridge-outdated-list">{rows(outdated)}</SettingsGroup>
        </Section>
        {remote ? <RemoteUpdateBlock remote={remote} footnote={footnote} /> : null}
        {command && !commandVisible ? <Button testID="bridge-upgrade-manual" variant="ghost" label={t('Update with a command instead')} onPress={() => setShowCommand(true)} />
          : command ? <Section title={t('Run on the computer with your Agent')} testID="bridge-upgrade-steps">
          <View style={styles.stack}>
            <SettingsGroup density="comfortable">
              <Text testID="bridge-upgrade-command" selectable style={[styles.command, { color: colors.ink }]}>{command}</Text>
            </SettingsGroup>
            <View style={styles.actions}>
              <Button testID="bridge-upgrade-copy" variant="card" icon={copied ? Check : Copy} haptic multiline style={styles.action}
                label={copied ? t('Copied', { ns: 'config' }) : t('Copy command', { ns: 'config' })} onPress={() => { void copy(); }} />
              <Button testID="bridge-upgrade-share" variant="card" icon={ShareIcon} multiline style={styles.action}
                label={t('Send to computer')} onPress={() => { void share(); }} />
            </View>
            <Text style={footnote}>{t('Replies still in progress are interrupted. Clawket reconnects on its own, no pairing needed.')}</Text>
            {actionFailed ? <Text accessibilityRole="alert" style={footnote}>{t('Could not copy or share. You can select the commands above.')}</Text> : null}
          </View>
        </Section> : latest ? <Text style={footnote}>{t('The unified updater is available in newer Bridge releases. Use your original deployment method for this release.')}</Text>
          : <View style={styles.pending}>
            <Text accessibilityRole={checkFailed ? 'alert' : undefined} style={footnote}>{checkFailed ? t("Couldn't check for updates") : t('Checking for updates…')}</Text>
            {checkButton(checkFailed ? t('Retry') : t('Check for updates'))}
          </View>}
        {others.length ? <Section title={allCurrent ? t('Up to date') : t('Other connections')} testID="bridge-others">
          <SettingsGroup density="comfortable" testID="bridge-version-list">{rows(others)}</SettingsGroup>
        </Section> : null}
        <Text style={footnote}>{t('Docker or a custom setup? Update it the way you installed it.')}</Text>
      </> : <>
        <View testID="bridge-status" style={styles.hero}>
          <View style={[styles.symbol, { backgroundColor: colors.surfaceFloating }]}>
            {allCurrent
              ? <CircleCheck testID="bridge-status-current" size={IconSize.lg} color={colors.good} strokeWidth={1.75} />
              : <MonitorUp size={IconSize.lg} color={colors.inkSecondary} strokeWidth={1.75} />}
          </View>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.heroTitle, { color: colors.ink }]}>
            {latest === null ? (checkFailed ? t("Couldn't check for updates") : t('Checking for updates…'))
              : allCurrent ? (others.some(c => isUpdated(c.id)) ? t('Update complete') : t("You're up to date")) : t('Latest version')}
          </Text>
          {latest ? <Text style={[styles.heroDetail, { color: colors.inkSecondary }]}>{t('Bridge {{version}}', { version: latest })}</Text> : null}
        </View>
        {others.length ? <SettingsGroup density="comfortable" testID="bridge-version-list">{rows(others)}</SettingsGroup> : null}
        <View style={styles.pending}>
          {checkButton(latest === null && checkFailed ? t('Retry') : t('Check for updates'))}
          {checkFailed && latest ? <Text accessibilityRole="alert" style={[footnote, styles.centered]}>{t('Could not check Bridge updates. Try again later.')}</Text> : null}
          <Text style={[footnote, styles.centered]}>{t('Docker or a custom setup? Update it the way you installed it.')}</Text>
        </View>
      </>}
    </ScrollView>
  </View>;
}

function RemoteUpdateBlock({ remote, footnote }: { remote: BridgeRemoteUpdateProps; footnote: StyleProp<TextStyle> }) {
  const { t } = useTranslation('chat');
  const { theme: { colors } } = useAppTheme();
  const { view } = remote;
  if (view.phase === 'idle') {
    return <View testID="bridge-remote-update" style={styles.stack}>
      <Button testID="bridge-remote-update-start" label={t('Update now')} onPress={remote.onStart} />
      <Text style={footnote}>{t('Updates every Bridge on the computer running {{name}}. Replies still in progress are interrupted.', { name: remote.connectionLabel })}</Text>
    </View>;
  }
  if (view.phase === 'running' || view.phase === 'updated') {
    const status = view.status;
    const text = view.phase === 'updated' ? t('Updated to {{version}}', { version: status?.version ?? '' })
      : view.reconnecting || status?.state === 'restarting' ? t('Restarting Bridge…')
      : status?.state === 'installing' && status.version ? t('Downloading {{version}}…', { version: status.version })
      : t('Checking the new version…');
    return <SettingsGroup density="comfortable" testID="bridge-remote-update">
      <View style={styles.progress}>
        {view.phase === 'updated' ? <Check size={IconSize.md} color={colors.good} strokeWidth={2} /> : <ActivityIndicator color={colors.inkSecondary} />}
        <Text testID="bridge-remote-update-status" accessibilityLiveRegion="polite" style={[styles.progressText, { color: colors.ink }]}>{text}</Text>
      </View>
    </SettingsGroup>;
  }
  const reason = view.reason === 'download' ? t("Couldn't download the new version. Check the computer's network.")
    : view.reason === 'unsupported' ? t('This version can only be updated with the command below.')
    : view.reason === 'running' ? t('Another update is already running on this computer.')
    : view.reason === 'disabled' ? t('Phone updates are turned off on this computer.')
    : view.reason === 'interrupted' || view.reason === 'lost' ? t('The update stopped partway. Check the Bridge on the computer.')
    : t("The result couldn't be confirmed. Use the command below.");
  return <View testID="bridge-remote-update" style={styles.stack}>
    <SettingsGroup density="comfortable">
      <View accessibilityRole="alert" style={styles.failure}>
        <Text style={[styles.failureTitle, { color: colors.ink }]}>{t('The update did not finish')}</Text>
        <Text testID="bridge-remote-update-reason" style={[styles.failureReason, { color: colors.inkSecondary }]}>{reason}</Text>
      </View>
    </SettingsGroup>
    {view.reason !== 'disabled' ? <Button testID="bridge-remote-update-retry" variant="ghost" label={t('Retry')} onPress={remote.onStart} /> : null}
  </View>;
}

function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  const { theme: { colors } } = useAppTheme();
  return <View testID={testID} style={styles.section}>
    <Text accessibilityRole="header" style={[styles.note, { color: colors.inkSecondary }]}>{title}</Text>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.lg, paddingTop: Space.lg, gap: Space.xl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  // Section labels and footnotes sit on the card text edge, like the other grouped pages.
  section: { gap: Space.sm },
  note: { paddingHorizontal: Space.lg, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  centered: { textAlign: 'center' },
  stack: { gap: Space.md },
  command: { padding: Space.lg, fontSize: FontSize.caption, lineHeight: LineHeight.secondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  // One row of equal capsules, as on the Connection page (owner decision 2026-09-30).
  actions: { flexDirection: 'row', gap: Space.md },
  action: { flex: 1 },
  updated: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  progress: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  progressText: { flex: 1, fontSize: FontSize.body, lineHeight: LineHeight.body },
  failure: { padding: Space.lg, gap: Space.xs },
  failureTitle: { fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
  failureReason: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  pending: { gap: Space.sm },
  hero: { alignItems: 'center', paddingVertical: Space.xl, gap: Space.sm },
  symbol: { padding: Space.lg, borderRadius: Radius.xl, marginBottom: Space.xs },
  heroTitle: { fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold, textAlign: 'center' },
  heroDetail: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
});
