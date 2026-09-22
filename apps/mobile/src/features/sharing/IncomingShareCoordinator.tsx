import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, AppState, Image, Keyboard, TextInput, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { getSharedPayloads, clearSharedPayloads } from 'expo-sharing';
import type { AgentDescriptor } from '@clawket/agent-protocol';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/ui/Sheet';
import { SettingsDivider, SettingsRow } from '../../components/ui/SettingsGroup';
import { Banner } from '../../components/ui/Banner';
import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { Button } from '../../components/ui/Button';
import { IncomingShareStore, type IncomingShare } from '../../services/incoming-share';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, LineHeight, Radius, Space } from '../../theme/tokens';

const SNAP_POINTS = ['52%', '92%'];
export function IncomingShareCoordinator({ ready, targets, onChoose, onConnect }: Readonly<{
  ready: boolean; targets: readonly AgentDescriptor[];
  onChoose: (agent: AgentDescriptor, shareId: string, onHandedOff: () => void) => void;
  onConnect: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common', 'config']);
  const { theme } = useAppTheme();
  const [share, setShare] = useState<IncomingShare | null>(null);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const presented = useRef(new Set<string>());
  const after = useRef<(() => void) | null>(null);
  const dismissEditor = () => {
    // The paste-capable native editor owns its blur command. Capture it before
    // Keyboard.dismiss clears RN's focused-input registry.
    const focused = TextInput.State.currentlyFocusedInput();
    focused?.blur();
    Keyboard.dismiss();
  };
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const payloads = getSharedPayloads();
      const next = payloads.length ? await IncomingShareStore.capture(payloads) : (await IncomingShareStore.list())[0];
      if (payloads.length) clearSharedPayloads();
      if (alive.current) {
        if (next && !payloads.length && presented.current.has(next.id)) return;
        if (next) { presented.current.add(next.id); dismissEditor(); }
        setShare(next ?? null); setVisible(Boolean(next)); setError('');
      }
    } catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : 'share_failed'); setVisible(true); } }
    finally { busy.current = false; }
  }, []);
  useEffect(() => { if (visible && ready) dismissEditor(); }, [visible, ready]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    const links = Linking.addEventListener('url', () => { void refresh(); });
    return () => { alive.current = false; subscription.remove(); links.remove(); };
  }, [refresh]);
  const choose = (action: () => void) => { after.current = action; setVisible(false); };
  return <Sheet visible={visible && ready} onClose={() => setVisible(false)} title={t('Share to Agent')}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={SNAP_POINTS} testID="incoming-share"
    onAfterClose={() => { const action = after.current; after.current = null; action?.(); }}>
    <BottomSheetScrollView contentContainerStyle={styles.content}>
      {error ? <Banner message={error === 'share_storage_full' ? t('Shared files are full. Clear the app cache to continue.') : t('Unable to receive shared content')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => { void refresh(); }} /> : null}
      {share ? <View style={styles.preview}>
        {share.files.some(file => file.mimeType.startsWith('image/')) ? <View style={styles.images}>
          {share.files.filter(file => file.mimeType.startsWith('image/')).map(file => <Image key={file.uri}
            source={{ uri: file.uri }} style={styles.image} resizeMode="cover" testID="incoming-share-image" />)}
        </View> : null}
        {share.text || share.files.some(file => !file.mimeType.startsWith('image/')) ? <Text numberOfLines={3}
          style={[styles.text, { color: theme.colors.inkSecondary }]}>
          {share.text || share.files.filter(file => !file.mimeType.startsWith('image/')).map(file => file.name).join(', ')}
        </Text> : null}
      </View> : null}
      {share ? targets.map((agent, index) => <React.Fragment key={`${agent.connectionId}:${agent.agentId}`}>
        {index ? <SettingsDivider inset="content" /> : null}
        <SettingsRow title={agent.name} leading={<AgentAvatar agentId={agent.agentId} name={agent.name} emoji={agent.emoji} avatarUrl={agent.avatarUrl} variant="sheet" />} onPress={() => choose(() => { setVisible(true); onChoose(agent, share.id, () => setVisible(false)); })} showChevron testID={`share-target-${agent.connectionId}-${agent.agentId}`} />
      </React.Fragment>) : null}
      {!targets.length ? <Button label={t('Connect', { ns: 'config' })} onPress={() => choose(onConnect)} /> : null}
      {share ? <Button label={t('Discard', { ns: 'config' })} variant="ghost" onPress={() => { void IncomingShareStore.remove(share.id, true).then(() => { setShare(null); setVisible(false); }).catch(() => setError('share_failed')); }} /> : null}
    </BottomSheetScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl },
  preview: { paddingVertical: Space.md, gap: Space.sm },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  image: { width: ControlSize.floatingButton + Space.md, height: ControlSize.floatingButton + Space.md, borderRadius: Radius.avatarSheet },
  text: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
});
