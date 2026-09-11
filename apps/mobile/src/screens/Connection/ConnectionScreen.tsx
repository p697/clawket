import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pause, Play, RotateCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectionDescriptor, ConnectionState } from '@clawket/agent-protocol';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';

type Props = {
  connection: ConnectionDescriptor;
  state: ConnectionState;
  paused: boolean;
  agentNames: string[];
  onBack: () => void;
  onReconnect: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onDetails: () => void;
};

export function ConnectionScreen({ connection, state, paused, agentNames, onBack, onReconnect, onResume, onPause, onRemove, onDetails }: Props): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [confirmation, setConfirmation] = useState<'pause' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try { await action(); } catch { setFailed(true); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const status = paused ? t('Connection paused') : state === 'ready' ? t('Online', { ns: 'common' })
    : ['connecting', 'handshaking', 'reconnecting'].includes(state) ? t('Connecting', { ns: 'common' }) : t('Offline', { ns: 'common' });
  return (
    <View testID="connection-screen" style={[styles.screen, { backgroundColor: colors.canvasGrouped }]}>
      <ScreenHeader title={t('Connection', { ns: 'common' })} topInset={insets.top} onBack={onBack} showBorder={false} style={{ backgroundColor: colors.canvasGrouped }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
        <View style={styles.hero}>
          <View style={[styles.symbol, { backgroundColor: colors.surfaceFloating }]}><PlatformMark platform={connection.backendKind} /></View>
          <Text style={[styles.name, { color: colors.ink }]}>{connection.label}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.detail, { color: colors.inkSecondary }]}>{status}</Text>
          {agentNames.length > 0 ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{agentNames.join(' · ')}</Text> : null}
        </View>
        {failed ? <Banner tone="bad" message={t('Please try again later.', { ns: 'common' })} /> : null}
        <View style={styles.actions}>
          <Button testID="connection-reconnect" label={paused ? t('Resume connection') : t('Reconnect', { ns: 'common' })}
            icon={paused ? Play : RotateCw} loading={busy} disabled={busy}
            onPress={() => { void run(paused ? onResume : onReconnect); }} />
          {!paused ? <Button testID="connection-pause" label={t('Pause connection')} icon={Pause} variant="ghost" disabled={busy}
            onPress={() => setConfirmation('pause')} /> : null}
        </View>
        <SettingsGroup>
          <SettingsRow testID="connection-details" title={t('Advanced settings')} showChevron onPress={onDetails} />
        </SettingsGroup>
        <Button testID="connection-remove" label={t('Remove connection')} variant="destructive" disabled={busy} onPress={() => setConfirmation('remove')} />
      </ScrollView>
      <ConfirmationModal visible={confirmation !== null} destructive={confirmation === 'remove'}
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
  content: { paddingHorizontal: Space.xl, gap: Space.xl },
  hero: { alignItems: 'center', paddingVertical: Space.xxl, gap: Space.md },
  symbol: { padding: Space.lg, borderRadius: Radius.xl },
  name: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold, textAlign: 'center' },
  detail: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
  actions: { gap: Space.sm },
});
