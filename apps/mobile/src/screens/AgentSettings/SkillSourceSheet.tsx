import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, Pencil } from 'lucide-react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import type { AgentAdapter, SkillDetail, SkillStatusEntry } from '@clawket/agent-protocol';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/ui/Sheet';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { Banner } from '../../components/ui/Banner';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { CompositionSafeBottomSheetTextInput } from '../../components/ui/CompositionSafeBottomSheetTextInput';
import { createChatMarkdownStyle, getChatMarkdownFlavor, openChatMarkdownLink } from '../../components/chat/chatMarkdown';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, LineHeight, Space } from '../../theme/tokens';

export function SkillSourceSheet({ adapter, agentId, skill, online, isPro, onOpenPaywall, onClose }: {
  adapter: AgentAdapter;
  agentId: string;
  skill: SkillStatusEntry;
  online: boolean;
  isPro: boolean;
  onOpenPaywall?: (reason: string, onContinue?: () => void) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const markdownStyle = useMemo(() => createChatMarkdownStyle(theme.colors, FontSize.body), [theme.colors]);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(false);
  const lock = useRef(false);
  const current = useRef({ draft, online, editing, adapter, agentId });
  current.current = { draft, online, editing, adapter, agentId };
  const operations = adapter.management?.skills;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (detail) { setLoading(false); return; }
    if (!online) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    void operations?.get?.(skill.skillKey, { agentId }).then((value) => {
      if (cancelled) return;
      setDetail(value);
      setDraft(value.content);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : t('Settings could not load', { ns: 'common' }));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Connectivity changes must not overwrite an in-progress draft.
  }, [operations, agentId, skill.skillKey, retry, t, online, detail]);
  const editable = Boolean(adapter.capabilities.skills && detail?.editable && !detail.isBinary && operations?.updateContent);
  const changed = detail !== null && draft !== detail.content;
  const close = () => {
    if (lock.current) return;
    if (editing && changed) setDiscard(true);
    else onClose();
  };
  const commit = async () => {
    if (!active.current || current.current.adapter !== adapter || current.current.agentId !== agentId || lock.current || !editable || !current.current.online || !changed
      || current.current.draft !== draft || !current.current.editing) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await operations?.updateContent?.(skill.skillKey, draft, agentId);
      if (!active.current || current.current.adapter !== adapter || current.current.agentId !== agentId) return;
      if (!result?.ok) throw new Error(t('Save failed', { ns: 'settings' }));
      setDetail((value) => value ? { ...value, content: draft } : value);
      setEditing(false);
    } catch (reason: unknown) {
      if (active.current) setError(reason instanceof Error ? reason.message : t('Save failed', { ns: 'settings' }));
    } finally {
      lock.current = false;
      if (active.current) setSaving(false);
    }
  };
  const save = () => {
    if (!isPro) { onOpenPaywall?.('coreFileEditing', () => { void commit(); }); return; }
    void commit();
  };
  return <>
    <Sheet testID="skill-source" visible={!discard} title={skill.name} closeAccessibilityLabel={t('Close', { ns: 'common' })}
      onClose={close} dismissOnBackdropPress={!saving} snapPoints={['93%']}
      headerRight={saving ? <ActivityIndicator color={theme.colors.ink} /> : editable && !loading ? <FloatingButton
        testID={editing ? 'skill-source-save' : 'skill-source-edit'} icon={editing ? Check : Pencil}
        accessibilityLabel={t(editing ? 'Save' : 'Edit', { ns: 'common' })} appearance="plain"
        disabled={!online || (editing && !changed)} onPress={editing ? save : () => setEditing(true)} /> : undefined}>
      {error ? <View style={styles.notice}><Banner testID="skill-source-error" tone="bad" message={error}
        actionLabel={!detail ? t('Retry', { ns: 'common' }) : undefined} onAction={!detail && online ? () => setRetry((value) => value + 1) : undefined} /></View> : null}
      {loading ? <ActivityIndicator color={theme.colors.ink} /> : <BottomSheetScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {!online ? <Banner message={t('Offline', { ns: 'common' })} /> : null}
        {detail && !editable ? <Text style={{ color: theme.colors.inkSecondary }}>{t('Read only', { ns: 'config' })}</Text> : null}
        {detail?.isBinary ? null : detail ? editing ?
          <CompositionSafeBottomSheetTextInput testID="skill-source-input" value={draft} onChangeText={setDraft} multiline
            editable={!saving} autoCorrect={false} autoCapitalize="none" scrollEnabled={false} textAlignVertical="top"
            style={[styles.input, { color: theme.colors.ink }]} /> :
          <EnrichedMarkdownText markdown={detail.content} markdownStyle={markdownStyle} flavor={getChatMarkdownFlavor()} selectable onLinkPress={openChatMarkdownLink} /> : null}
      </BottomSheetScrollView>}
    </Sheet>
    <ConfirmationModal testID="skill-source-discard" visible={discard} title={t('Discard changes?', { ns: 'settings' })}
      message={t('You have unsaved changes.', { ns: 'settings' })} confirmLabel={t('Discard', { ns: 'settings' })}
      cancelLabel={t('Keep Editing', { ns: 'settings' })} onClose={() => setDiscard(false)} onConfirm={onClose} destructive />
  </>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: Space.lg, paddingBottom: Space.xxl, gap: Space.md },
  notice: { paddingHorizontal: Space.lg, paddingVertical: Space.sm },
  input: { minHeight: ControlSize.settingsRow * 6, fontSize: FontSize.body, lineHeight: LineHeight.body },
});
