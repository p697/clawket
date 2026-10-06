import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pause, Play, RotateCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectionDescriptor, ConnectionState } from '@clawket/agent-protocol';
import { getConnectionRuntime } from '../../connection';
import type { ConnectionRuntimeDetails } from '../../connection/runtime-details';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import { AccountSettingsPageHeader } from '../AccountSettings/AccountSettingsPageHeader';
import { translateAccountSettingsKey } from '../AccountSettings/translation';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { RenameSheet } from '../../components/ui/RenameSheet';
import { SettingsDivider, SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import {
  buildConnectionDetailRows,
  parseConnectionServerHost,
  resolveConnectionPresence,
  summarizeConnectionAgents,
  translateConnectionPresence,
} from './connection-details';

/** Free tier only: which connection the free allowance is bound to. */
export type ConnectionFreeSlot = Readonly<{
  current: boolean;
  switchAvailable: boolean;
  switchStatus?: string;
  switching: boolean;
}>;

type Props = {
  connection: ConnectionDescriptor;
  /** Whether this is the active connection; `state` describes only the active one. */
  active: boolean;
  state: ConnectionState;
  paused: boolean;
  agentNames: string[];
  details?: ConnectionRuntimeDetails;
  freeSlot?: ConnectionFreeSlot;
  onBack: () => void;
  onUpgradeBridge?: () => void;
  onReconnect: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onRename: (label: string) => Promise<unknown>;
  onUseAsFreeConnection?: () => void;
};

/** The host is read from the credential-bearing record on demand and never stored in a descriptor. */
function useConnectionServerHost(connectionId: string): string | undefined {
  const [host, setHost] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setHost(undefined);
    getConnectionRuntime().getRuntimeConnectionRecord(connectionId)
      .then((record) => { if (active) setHost(parseConnectionServerHost(record.url)); })
      .catch(() => { if (active) setHost(undefined); });
    return () => { active = false; };
  }, [connectionId]);
  return host;
}

/**
 * The one page for everything connection-level: lifecycle, the local name, the
 * read-only facts a person checks when something is wrong, the free-tier slot
 * and removal. Roster rows and the Agent profile only link here.
 */
export function ConnectionScreen({
  connection,
  active,
  state,
  paused,
  agentNames,
  details,
  freeSlot,
  onBack,
  onUpgradeBridge,
  onReconnect,
  onResume,
  onPause,
  onRemove,
  onRename,
  onUseAsFreeConnection,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation(['config', 'common', 'settings', 'chat']);
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const serverHost = useConnectionServerHost(connection.id);
  const [confirmation, setConfirmation] = useState<'pause' | 'remove' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  // A failure notice stays in place while the next attempt runs and changes only with its outcome:
  // clearing it first pulled Reconnect up under the finger and back down (owner rule 2026-09-29).
  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await action(); setFailed(false); } catch { setFailed(true); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const presence = resolveConnectionPresence({ active, paused, state });
  const agentSummary = summarizeConnectionAgents(connection.label, agentNames);
  const status = translateConnectionPresence(t, presence);
  // Healthy connections keep Reconnect quiet (an ink button read as "something is wrong", device
  // review 2026-09-27); it is the page's ink action only when the user has something to fix, and an
  // inactive connection offers Connect, which switches to it.
  const lifecycleAction = paused
    ? { label: t('Resume connection'), icon: Play, variant: 'primary' as const }
    : presence === 'not_connected'
      ? { label: t('Connect'), icon: RotateCw, variant: 'primary' as const }
      : { label: t('Reconnect', { ns: 'common' }), icon: RotateCw, variant: presence === 'offline' ? 'primary' as const : 'card' as const };
  const locale = i18n?.resolvedLanguage;
  const detailRows = useMemo(() => buildConnectionDetailRows({
    connection,
    ...(serverHost ? { serverHost } : {}),
    ...(details ? { details } : {}),
    ...(locale ? { locale } : {}),
  }), [connection, details, locale, serverHost]);
  return (
    <View testID="connection-screen" style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
      <AccountSettingsPageHeader testID="connection" title={t('Connection', { ns: 'common' })} onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
        {onUpgradeBridge ? <Banner testID="connection-bridge-upgrade" message={t('New Bridge version', { ns: 'chat' })} actionLabel={t('Update', { ns: 'common' })} onAction={onUpgradeBridge} /> : null}
        <View style={styles.hero}>
          <View style={[styles.symbol, { backgroundColor: colors.surfaceFloating }]}><PlatformMark platform={connection.backendKind} /></View>
          <Text testID="connection-label" style={[styles.name, { color: colors.ink }]}>{connection.label}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.detail, { color: colors.inkSecondary }]}>{status}</Text>
          {agentSummary ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{agentSummary}</Text> : null}
        </View>
        {failed ? <Banner tone="bad" message={t('Please try again later.', { ns: 'common' })} /> : null}
        {/* One row of equal capsules (owner decision 2026-09-30: a full-width bordered button above a
            text link read as a form); Pause keeps its full name for screen readers, and a paused
            connection offers Resume alone across the row. Long labels wrap instead of truncating. */}
        <View style={styles.actions}>
          <Button testID="connection-reconnect" label={lifecycleAction.label} icon={lifecycleAction.icon}
            variant={lifecycleAction.variant} multiline loading={busy} disabled={busy} style={styles.action}
            onPress={() => { void run(paused ? onResume : onReconnect); }} />
          {!paused ? <Button testID="connection-pause" label={t('Pause', { ns: 'common' })} accessibilityLabel={t('Pause connection')}
            icon={Pause} variant="card" multiline disabled={busy} style={styles.action}
            onPress={() => setConfirmation('pause')} /> : null}
        </View>
        <SettingsGroup density="comfortable">
          <SettingsRow testID="connection-name" title={t('Name', { ns: 'common' })} value={connection.label}
            showChevron onPress={() => setRenaming(true)} />
        </SettingsGroup>
        <SettingsGroup density="comfortable" testID="connection-details">
          {detailRows.map((row, index) => (
            <Fragment key={row.id}>
              {index > 0 ? <SettingsDivider inset="content" /> : null}
              <SettingsRow testID={`connection-detail-${row.id}`}
                title={translateAccountSettingsKey(t, row.titleKey, row.titleNamespace)}
                value={row.value ?? (row.valueKey ? translateAccountSettingsKey(t, row.valueKey) : undefined)}
                subtitle={row.detail} subtitleLines={row.detail ? row.detail.split('\n').length : undefined}
                tailWidth={row.wide ? 'wide' : 'default'} />
            </Fragment>
          ))}
        </SettingsGroup>
        {freeSlot ? (
          <SettingsGroup density="comfortable" testID="connection-free-slot">
            {freeSlot.current ? (
              <SettingsRow testID="connection-free-current" title={t('Free connection')} value={t('Current')} />
            ) : (
              <SettingsRow testID="connection-set-free" title={t('Use as free connection')} value={freeSlot.switchStatus}
                disabled={!freeSlot.switchAvailable || freeSlot.switching || !onUseAsFreeConnection}
                showChevron={freeSlot.switchAvailable && !freeSlot.switching} onPress={onUseAsFreeConnection} />
            )}
          </SettingsGroup>
        ) : null}
        <Button testID="connection-remove" label={t('Remove connection')} variant="destructive" disabled={busy} onPress={() => setConfirmation('remove')} />
      </ScrollView>
      <RenameSheet testID="connection-rename" visible={renaming} value={connection.label}
        title={t('Name', { ns: 'common' })} onClose={() => setRenaming(false)} onSubmit={onRename} />
      <ConfirmationModal testID="connection-confirmation" visible={confirmation !== null} destructive={confirmation === 'remove'}
        title={confirmation === 'pause' ? t('Pause this connection?') : t('Remove connection')}
        message={confirmation === 'pause' ? t('All agents on this connection will go offline until you resume.') : t('All local data for this connection will be removed.')}
        cancelLabel={t('Cancel', { ns: 'common' })} confirmLabel={confirmation === 'pause' ? t('Pause connection') : t('Remove', { ns: 'common' })}
        onClose={() => setConfirmation(null)} onConfirm={() => {
          const action = confirmation === 'pause' ? onPause : onRemove;
          setConfirmation(null);
          void run(action);
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.lg, gap: Space.xl },
  hero: { alignItems: 'center', paddingVertical: Space.xxl, gap: Space.md },
  symbol: { padding: Space.lg, borderRadius: Radius.xl },
  name: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold, textAlign: 'center' },
  detail: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Space.md },
  action: { flex: 1 },
});
