import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Download, FileText, RotateCw } from 'lucide-react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, SessionFile } from '@clawket/agent-protocol';
import { Sheet } from '../../../components/ui/Sheet';
import { SheetHeaderButton } from '../../../components/ui/SheetHeaderButton';
import { SettingsDivider, SettingsRow } from '../../../components/ui/SettingsGroup';
import { Banner } from '../../../components/ui/Banner';
import { LoadingState } from '../../../components/ui/LoadingState';
import { useAppTheme } from '../../../theme';
import { FontSize, IconSize, LineHeight, Space } from '../../../theme/tokens';
import { receiveSessionFile, validateSessionFiles } from '../../../services/session-files';

const SNAP_POINTS = ['62%', '92%'];
const remove = (directory: Directory) => { try { if (directory.exists) directory.delete(); } catch { /* Retry stale cleanup on the next open. */ } };

export function SessionFilesSheet({ visible, adapter, sessionKey, online, onClose }: Readonly<{
  visible: boolean; adapter: AgentAdapter | null; sessionKey: string; online: boolean; onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [transfer, setTransfer] = useState<{ id: string; fraction: number } | null>(null);
  const operation = useRef<AbortController | null>(null);
  const pending = useRef<{ directory: Directory; file: File; mimeType: string; adapter: AgentAdapter; key: string } | null>(null);
  const current = useRef({ adapter, sessionKey, online });
  current.current = { adapter, sessionKey, online };
  useEffect(() => {
    operation.current?.abort();
    if (pending.current) { remove(pending.current.directory); pending.current = null; }
    setFiles([]); setTransfer(null);
    return () => { operation.current?.abort(); if (pending.current) { remove(pending.current.directory); pending.current = null; } };
  }, [adapter, sessionKey, online]);
  useEffect(() => {
    let active = true;
    if (!visible || !online || !adapter?.sessionFiles) { operation.current?.abort(); return; }
    setLoading(true); setError(false); setFiles([]);
    void adapter.sessionFiles.list(sessionKey).then(value => { if (active) setFiles(validateSessionFiles(value)); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; operation.current?.abort(); };
  }, [visible, adapter, sessionKey, online, retry]);
  const download = async (item: SessionFile) => {
    if (!adapter?.sessionFiles || !online || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    let directory: Directory | null = null;
    setError(false); setTransfer({ id: item.id, fraction: 0 });
    try {
      if (!await Sharing.isAvailableAsync() || controller.signal.aborted) throw new Error('unavailable');
      const root = new Directory(Paths.cache, 'session-downloads');
      root.create({ intermediates: true, idempotent: true });
      // Only this feature's abandoned temporary directories, never user-saved documents.
      for (const child of root.list()) if (child instanceof Directory && /^transfer-\d+-[a-z0-9]+$/.test(child.name)) {
        const time = Number(child.name.split('-')[1]);
        if (Date.now() - time > 24 * 60 * 60 * 1000) remove(child);
      }
      directory = new Directory(root, `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      directory.create();
      const file = new File(directory, item.name); file.create();
      const handle = file.open(FileMode.WriteOnly);
      try { await receiveSessionFile(adapter.sessionFiles, sessionKey, item, controller.signal, bytes => handle.writeBytes(bytes), fraction => setTransfer({ id: item.id, fraction })); }
      finally { handle.close(); }
      if (controller.signal.aborted || current.current.adapter !== adapter || current.current.sessionKey !== sessionKey || !current.current.online) throw new Error('cancelled');
      pending.current = { directory, file, mimeType: item.mimeType, adapter, key: sessionKey };
      directory = null;
      onClose();
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (directory) remove(directory); if (operation.current === controller) { operation.current = null; setTransfer(null); } }
  };
  const afterClose = () => {
    const value = pending.current; pending.current = null;
    if (!value) return;
    if (current.current.adapter !== value.adapter || current.current.sessionKey !== value.key || !current.current.online) { remove(value.directory); return; }
    // Android's chooser can finish before the receiving app consumes its URI.
    // Keep that local cache grant usable; the next download prunes it after 24 hours.
    void Sharing.shareAsync(value.file.uri, { mimeType: value.mimeType })
      .then(() => { if (Platform.OS !== 'android') remove(value.directory); })
      .catch(() => remove(value.directory));
  };
  return <Sheet visible={visible} onClose={onClose} onAfterClose={afterClose} title={t('Session files')}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={SNAP_POINTS} testID="session-files"
    headerRight={<SheetHeaderButton icon={RotateCw} accessibilityLabel={t('Refresh', { ns: 'common' })} disabled={loading || Boolean(transfer) || !online} onPress={() => setRetry(value => value + 1)} />}>
    {error ? <Banner message={t('Could not retrieve files')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => setRetry(value => value + 1)} /> : null}
    <BottomSheetScrollView contentContainerStyle={styles.content}>
      {loading ? <LoadingState /> : files.map((file, index) => <React.Fragment key={file.id}>
        {index ? <SettingsDivider inset="content" /> : null}
        <SettingsRow title={file.name} subtitle={transfer?.id === file.id ? `${Math.round(transfer.fraction * 100)}%` : `${Math.ceil(file.size / 1024)} KB`}
          leading={<FileText size={IconSize.md} color={theme.colors.inkSecondary} />}
          trailing={transfer?.id === file.id ? <ActivityIndicator color={theme.colors.inkSecondary} /> : <Download size={IconSize.md} color={theme.colors.inkSecondary} />}
          disabled={!online || Boolean(transfer)} onPress={() => { void download(file); }} testID={`session-file-${index}`} />
      </React.Fragment>)}
      {!loading && !files.length && !error ? <Text style={[styles.empty, { color: theme.colors.inkSecondary }]}>{online ? t('No shared files yet') : t('Offline', { ns: 'common' })}</Text> : null}
    </BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl },
  empty: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center', paddingVertical: Space.xl },
});
