import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, ModelHealthReport } from '@clawket/agent-protocol';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { LoadingState } from '../../components/ui/LoadingState';
import { SettingsGroup, SettingsRow, SettingsDivider } from '../../components/ui/SettingsGroup';
import { Space } from '../../theme/tokens';

const SNAP_POINTS = ['62%', '92%'];
export function ModelHealthSheet({ visible, adapter, online, onClose }: Readonly<{
  visible: boolean; adapter: AgentAdapter; online: boolean; onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['settings', 'common']);
  const [report, setReport] = useState<ModelHealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [probeCoolingDown, setProbeCoolingDown] = useState(false);
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const running = useRef(false);
  const load = useCallback(async (probe: boolean) => {
    if (!visible || !online || running.current || (probe && probeTimer.current) || !adapter.management?.models?.health) return;
    if (probe) {
      setProbeCoolingDown(true);
      probeTimer.current = setTimeout(() => { probeTimer.current = null; setProbeCoolingDown(false); }, 10_000);
    }
    const version = ++revision.current;
    running.current = true; setBusy(true); setFailed(false);
    try {
      const result = await adapter.management.models.health({ probe });
      if (revision.current === version) setReport(result);
    } catch { if (revision.current === version) setFailed(true); }
    finally { if (revision.current === version) { running.current = false; setBusy(false); } }
  }, [adapter, online, visible]);
  useEffect(() => {
    setReport(null); setFailed(false); setBusy(false); running.current = false;
    if (visible) void load(false);
    return () => {
      revision.current++; running.current = false;
      if (probeTimer.current) clearTimeout(probeTimer.current);
      probeTimer.current = null; setProbeCoolingDown(false);
    };
  }, [visible, load]);
  const statusLabel = (status: string) => status === 'configured' ? t('Configured')
    : status === 'missing' ? t('Not configured') : status === 'reachable' ? t('Connected')
      : status === 'failed' ? t('Failed') : t('Unknown');
  return <Sheet visible={visible} onClose={onClose} title={t('Model health')} snapPoints={SNAP_POINTS}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} testID="model-health">
    <BottomSheetScrollView contentContainerStyle={[styles.content, !report && busy ? styles.loading : null]}>
      {failed ? <Banner message={t('Failed to load models')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => void load(false)} /> : null}
      {!online ? <Banner message={t('Offline', { ns: 'common' })} /> : null}
      {busy && !report ? <LoadingState /> : null}
      {report ? <>
        <SettingsRow title={report.model || t('Unknown model')} subtitle={t('Global model')} subtitleLines={1} />
        <SettingsGroup>{report.providers.map((provider, index) => <React.Fragment key={provider.id}>
          {index ? <SettingsDivider /> : null}
          <SettingsRow title={provider.name} value={statusLabel(provider.credentials)} />
        </React.Fragment>)}</SettingsGroup>
        <Button label={t('Test connections')} onPress={() => void load(true)} loading={busy} disabled={!online || busy || probeCoolingDown} testID="model-health-probe" />
        {report.checks.length ? <View>{report.checks.map((check, index) => <SettingsRow key={`${check.name}:${index}`}
          title={check.name} value={statusLabel(check.status)} />)}</View> : null}
      </> : null}
    </BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.lg },
  loading: { flexGrow: 1, justifyContent: 'center' },
});
