import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter } from '@clawket/agent-protocol';
import { Sheet } from '../../components/ui/Sheet';
import { SettingsGroup, SettingsRow, SettingsDivider } from '../../components/ui/SettingsGroup';
import { Banner } from '../../components/ui/Banner';
import { LoadingState } from '../../components/ui/LoadingState';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { ConversationArchives } from '../../services/conversation-archives';
import { formatConversationExport, loadConversationExport, type ConversationExport } from '../../services/conversation-export';

const SNAP_POINTS = ['42%', '80%'];
export function ConversationExportSheet({ target, adapter, onClose }: Readonly<{
  target: { key: string; title: string; connectionId?: string; agentId?: string } | null;
  adapter: AgentAdapter | null;
  onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const [data, setData] = useState<ConversationExport | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [nativeSharePending, setNativeSharePending] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  const operation = useRef<AbortController | null>(null);
  const shareInFlight = useRef(false);
  const ready = adapter?.state === 'ready';
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller;
    setData(null); setError(''); setSharing(false); setNativeSharePending(false); afterClose.current = null;
    if (target && adapter && ready) {
      void loadConversationExport(adapter, target.key, target.title, controller.signal)
        .then(value => { if (!controller.signal.aborted) setData(value); })
        .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'export_failed'); });
    }
    return () => { controller.abort(); if (afterClose.current) shareInFlight.current = false; afterClose.current = null; };
  }, [target, adapter, ready, revision]);
  const share = (format: 'markdown' | 'json') => {
    const controller = operation.current;
    if (!data || !controller || controller.signal.aborted || shareInFlight.current) return;
    shareInFlight.current = true; setSharing(true); setError('');
    afterClose.current = () => { void performShare(data, controller); };
    setNativeSharePending(true);
    async function performShare(snapshot: ConversationExport, active: AbortController) {
      let file: File | null = null;
      let directory: Directory | null = null;
      try {
        if (active.signal.aborted) return;
        if (!await Sharing.isAvailableAsync() || active.signal.aborted) throw new Error('export_failed');
        directory = new Directory(Paths.cache, 'conversation-exports', `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
        directory.create({ intermediates: true, idempotent: true });
        file = new File(directory, `Clawket.${format === 'markdown' ? 'md' : 'json'}`);
        file.write(formatConversationExport(snapshot, format, { user: t('User'), assistant: t('Assistant') }));
        if (active.signal.aborted) return;
        await Sharing.shareAsync(file.uri, { mimeType: format === 'markdown' ? 'text/markdown' : 'application/json', UTI: format === 'markdown' ? 'net.daringfireball.markdown' : 'public.json' });
        if (!active.signal.aborted) onClose();
      } catch { if (!active.signal.aborted) { setError('export_failed'); setNativeSharePending(false); } }
      finally {
        try { if (file?.exists) file.delete(); } catch { /* Owned cache cleanup can be retried by the OS. */ }
        try { if (directory?.exists) directory.delete(); } catch { /* Cache cleanup remains recoverable. */ }
        shareInFlight.current = false;
        if (!active.signal.aborted) setSharing(false);
      }
    }
  };
  const archive = async () => {
    const active = operation.current;
    if (!data || !target?.connectionId || !target.agentId || !active || active.signal.aborted || shareInFlight.current) return;
    shareInFlight.current = true; setSharing(true); setError('');
    try {
      await ConversationArchives.save({ connectionId: target.connectionId, agentId: target.agentId, sessionKey: target.key }, data);
      if (!active.signal.aborted) onClose();
    } catch (reason) { if (!active.signal.aborted) setError(reason instanceof Error ? reason.message : 'export_failed'); }
    finally { shareInFlight.current = false; if (!active.signal.aborted) setSharing(false); }
  };
  const errorText = error === 'archive_full' ? t('Saved conversations are full.') : error === 'export_running' ? t('Wait until the task finishes.')
    : error === 'export_changed' ? t('Conversation changed. Try again.')
      : error === 'export_too_large' ? t('Conversation is too large to export.') : t('Failed to save');
  return <Sheet visible={Boolean(target) && !nativeSharePending} onClose={onClose} title={t('Export conversation')}
    onAfterClose={() => { const action = afterClose.current; afterClose.current = null; action?.(); }}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={SNAP_POINTS} testID="conversation-export">
    <BottomSheetScrollView contentContainerStyle={styles.content}>
      {!ready ? <Banner message={t('Offline', { ns: 'common' })} /> : error ? <Banner message={errorText} actionLabel={t('Retry')} onAction={() => setRevision(value => value + 1)} /> : null}
      {!data && !error && ready ? <View style={styles.loading}><LoadingState message={t('Loading history')} /></View> : null}
      {data ? <View style={styles.form}><Text style={[styles.caption, { color: theme.colors.inkSecondary }]}>{t('Text and attachment names')}</Text><SettingsGroup>
        {target?.connectionId && target.agentId ? <><SettingsRow title={t('Save conversation')} showChevron disabled={sharing} onPress={() => void archive()} testID="conversation-export-archive" /><SettingsDivider /></> : null}
        <SettingsRow title="Markdown" value=".md" showChevron disabled={sharing} onPress={() => void share('markdown')} testID="conversation-export-markdown" />
        <SettingsDivider />
        <SettingsRow title="JSON" value=".json" showChevron disabled={sharing} onPress={() => void share('json')} testID="conversation-export-json" />
      </SettingsGroup></View> : null}
      {sharing ? <LoadingState /> : null}
    </BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({ content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.md }, loading: { paddingVertical: Space.xl }, form: { gap: Space.sm }, caption: { fontSize: FontSize.caption, lineHeight: LineHeight.caption } });
