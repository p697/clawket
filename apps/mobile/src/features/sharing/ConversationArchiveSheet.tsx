import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { MoreHorizontal, Pencil, Pin, Search, Share2, Trash2 } from 'lucide-react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import { Sheet } from '../../components/ui/Sheet';
import { SheetHeaderButton } from '../../components/ui/SheetHeaderButton';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Banner } from '../../components/ui/Banner';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { CompositionSafeBottomSheetTextInput } from '../../components/ui/CompositionSafeBottomSheetTextInput';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { createChatMarkdownStyle, getChatMarkdownFlavor, openChatMarkdownLink } from '../../components/chat/chatMarkdown';
import { ConversationArchives, conversationArchiveTitle, searchConversationArchives, type ArchiveFilter, type ConversationArchive } from '../../services/conversation-archives';
import { formatConversationExport } from '../../services/conversation-export';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';

export function ConversationArchiveSheet({ visible, suspended = false, isPro, onRequirePro, onClose }: Readonly<{
  visible: boolean; suspended?: boolean; isPro: boolean;
  onRequirePro: (continueAction: () => void) => void; onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const markdownStyle = useMemo(() => createChatMarkdownStyle(theme.colors, FontSize.body), [theme.colors]);
  const [entries, setEntries] = useState<ConversationArchive[] | null>(null);
  const [selected, setSelected] = useState<ConversationArchive | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nativePending, setNativePending] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setFilter('all'); setMenu(false); setRenaming(false); setUpdating(false);
    setSelected(null); setEntries(null); setError(false); setConfirmDelete(false); setSearching(false); setQuery(''); setNativePending(false); setDeleting(false);
    if (visible) void ConversationArchives.list().then(value => { if (generation.current === current) setEntries(value); })
      .catch(() => { if (generation.current === current) setError(true); });
    return () => { generation.current++; if (pendingAction.current) busy.current = false; pendingAction.current = null; };
  }, [visible, revision]);
  const matches = useMemo(() => searchConversationArchives(entries ?? [], isPro ? query : '', filter), [entries, isPro, query, filter]);
  const withPro = (action: () => void) => {
    if (isPro) { action(); return; }
    const current = generation.current;
    onRequirePro(() => { if (current === generation.current && visible) action(); });
  };
  const share = (values: readonly ConversationArchive[], bulk: boolean) => {
    if (busy.current || !values.length) return;
    const current = generation.current;
    busy.current = true; setError(false); setMenu(false); setNativePending(true);
    Keyboard.dismiss();
    pendingAction.current = () => { void (async () => {
      let directory: Directory | undefined;
      try {
        if (generation.current !== current || !await Sharing.isAvailableAsync()) throw new Error('unavailable');
        if (generation.current !== current) return;
        directory = new Directory(Paths.cache, 'conversation-exports', `archive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
        directory.create({ intermediates: true, idempotent: true });
        const file = new File(directory, bulk ? 'Clawket-archives.json' : 'Clawket.md');
        file.write(bulk ? JSON.stringify({ version: 1, archives: values.map(value => ({ savedAt: value.savedAt, pinned: value.pinned === true, ...value.transcript, title: conversationArchiveTitle(value) })) }, null, 2)
          : formatConversationExport({ ...values[0].transcript, title: conversationArchiveTitle(values[0]) }, 'markdown', { user: t('User'), assistant: t('Assistant') }));
        if (generation.current !== current) return;
        await Sharing.shareAsync(file.uri, { mimeType: bulk ? 'application/json' : 'text/markdown', UTI: bulk ? 'public.json' : 'net.daringfireball.markdown' });
      } catch { if (generation.current === current) setError(true); }
      finally {
        try { if (directory?.exists) directory.delete(); } catch { /* Owned cache remains removable. */ }
        busy.current = false;
        if (generation.current === current) setNativePending(false);
      }
    })(); };
  };
  const remove = async () => {
    if (!selected || busy.current) return;
    busy.current = true; setDeleting(true); const current = generation.current; const id = selected.id;
    try {
      await ConversationArchives.remove(id);
      if (current === generation.current) { setEntries(value => value?.filter(entry => entry.id !== id) ?? []); setSelected(null); setConfirmDelete(false); setMenu(false); }
    } catch { if (current === generation.current) setError(true); }
    finally { busy.current = false; if (current === generation.current) setDeleting(false); }
  };
  const update = async (action: 'rename' | 'pin') => {
    if (!selected || busy.current) return;
    const current = generation.current;
    busy.current = true; setUpdating(true); setError(false);
    try {
      const updated = action === 'rename' ? await ConversationArchives.rename(selected.id, name)
        : await ConversationArchives.setPinned(selected.id, !selected.pinned);
      if (current !== generation.current) return;
      setEntries(value => value?.map(entry => entry.id === updated.id ? updated : entry) ?? []);
      setSelected(updated); setMenu(false); setRenaming(false); Keyboard.dismiss();
    } catch { if (current === generation.current) setError(true); }
    finally { busy.current = false; if (current === generation.current) setUpdating(false); }
  };
  const back = () => {
    if (updating || deleting) return;
    if (menu || renaming) { setMenu(false); setRenaming(false); setConfirmDelete(false); }
    else setSelected(null);
    Keyboard.dismiss();
  };
  const caption = (text: string) => <Text style={[styles.caption, { color: theme.colors.inkSecondary }]}>{text}</Text>;
  const displayedTitle = selected ? conversationArchiveTitle(selected) : t('Saved conversations');
  const transcript = selected && !menu && !renaming;
  return <Sheet visible={visible && !suspended && !nativePending} onClose={onClose} title={renaming ? t('Rename', { ns: 'common' }) : displayedTitle}
    testID="conversation-archives" snapPoints={['93%']} closeAccessibilityLabel={t('Close', { ns: 'common' })}
    onAfterClose={() => { const action = pendingAction.current; pendingAction.current = null; action?.(); }}
    headerRight={!renaming ? <SheetHeaderButton icon={MoreHorizontal} accessibilityLabel={t('Archive actions')}
      onPress={() => { Keyboard.dismiss(); setMenu(value => !value); setConfirmDelete(false); }} disabled={updating || deleting} testID="archive-actions" /> : undefined}>
    {error ? <View style={styles.inset}><Banner message={t('Failed to save')} actionLabel={t('Retry')} onAction={() => setRevision(value => value + 1)} /></View> : null}
    {!entries && !error ? <LoadingState /> : null}
    {selected || menu ? <View style={styles.inset}><SettingsRow title={t('Back', { ns: 'common' })} leading={<ChevronLeft size={IconSize.md} color={theme.colors.inkSecondary} />}
      onPress={back} disabled={updating || deleting} testID="archive-back" /></View> : null}
    {renaming ? <View style={styles.content}>
      <CompositionSafeBottomSheetTextInput value={name} onChangeText={setName} autoFocus selectTextOnFocus maxLength={200} editable={!updating}
        accessibilityLabel={t('Rename', { ns: 'common' })} testID="archive-rename-input" returnKeyType="done"
        onSubmitEditing={() => { if (name.trim() && name.trim() !== displayedTitle) void update('rename'); }}
        style={[styles.input, { color: theme.colors.ink, backgroundColor: theme.colors.surface }]} />
      <Button label={t('Save', { ns: 'common' })} loading={updating} disabled={!name.trim() || name.trim() === displayedTitle}
        onPress={() => void update('rename')} testID="archive-rename-save" />
    </View> : menu ? <BottomSheetScrollView contentContainerStyle={styles.content}>
      <SettingsGroup chrome="plain">
        {selected ? <>
          <SettingsRow title={t('Rename', { ns: 'common' })} leading={<Pencil size={IconSize.md} color={theme.colors.ink} />}
            onPress={() => { setName(conversationArchiveTitle(selected)); setRenaming(true); setMenu(false); }} disabled={updating || deleting} testID="archive-rename" />
          <SettingsRow title={selected.pinned ? t('Unpin', { ns: 'common' }) : t('Pin', { ns: 'common' })} leading={<Pin size={IconSize.md} color={theme.colors.ink} />}
            onPress={() => void update('pin')} disabled={updating || deleting} testID="archive-pin" />
        </> : <SettingsRow title={t('Search saved conversations')} leading={<Search size={IconSize.md} color={theme.colors.ink} />}
          onPress={() => withPro(() => { setMenu(false); setSearching(true); })} testID="archive-search-toggle" />}
        <SettingsRow title={selected ? t('Export conversation') : t('Export all')} leading={<Share2 size={IconSize.md} color={theme.colors.ink} />}
          disabled={!matches.length && !selected || updating || deleting} onPress={() => selected ? share([selected], false) : withPro(() => share(matches, true))} testID="archive-export" />
        {selected ? <SettingsRow title={t('Delete', { ns: 'common' })} destructive leading={<Trash2 size={IconSize.md} color={theme.colors.bad} />}
          disabled={updating || deleting} onPress={() => setConfirmDelete(true)} testID="archive-delete" /> : null}
      </SettingsGroup>
      {confirmDelete ? <View style={styles.footer}>{caption(t('Delete this saved copy?'))}
        <Button label={t('Delete', { ns: 'common' })} variant="destructive" loading={deleting} onPress={() => void remove()} testID="archive-delete-confirm" />
        <Button label={t('Cancel', { ns: 'common' })} variant="ghost" disabled={deleting} onPress={() => setConfirmDelete(false)} /></View> : null}
    </BottomSheetScrollView> : transcript ? <BottomSheetFlatList key={selected.id} data={selected.transcript.messages} keyExtractor={(_, index) => `${selected.id}:${index}`} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.meta}>{caption(t('Saved on this device'))}{caption(new Date(selected.savedAt).toLocaleString())}</View>}
      renderItem={({ item }) => <View style={styles.message}>
        {caption(item.role === 'user' ? t('User') : t('Assistant'))}
        <EnrichedMarkdownText markdown={item.text} markdownStyle={markdownStyle} flavor={getChatMarkdownFlavor()} selectable onLinkPress={openChatMarkdownLink} />
        {item.attachments.length ? caption(item.attachments.join('\n')) : null}
      </View>} />
      : <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {caption(t('Saved on this device'))}
        {entries?.length ? <SegmentedTabs tabs={[{ key: 'all', label: t('All') }, { key: 'pinned', label: t('Pinned archives') }, { key: 'files', label: t('With files') }]}
          active={filter} onSwitch={setFilter} testID="archive-filter" /> : null}
        {searching && isPro ? <SearchInput inSheet autoFocus value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('Search saved conversations')} testID="archive-search" /> : null}
        {entries && !matches.length ? caption(entries.length ? t('No results', { ns: 'common' }) : t('No saved conversations')) : null}
        {matches.length ? <SettingsGroup chrome="plain">{matches.map(entry => <SettingsRow key={entry.id} title={conversationArchiveTitle(entry) || t('Saved conversations')} value={new Date(entry.savedAt).toLocaleDateString()}
          leading={entry.pinned ? <Pin size={IconSize.sm} color={theme.colors.inkSecondary} /> : undefined}
          showChevron onPress={() => { Keyboard.dismiss(); setSelected(entry); setConfirmDelete(false); }} testID={`archive-${entry.id}`} />)}</SettingsGroup> : null}
      </BottomSheetScrollView>}
  </Sheet>;
}
const styles = StyleSheet.create({ input: { minHeight: ControlSize.settingsRow, borderRadius: Radius.settingsGroup, padding: Space.md, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary }, content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.md },
  inset: { paddingHorizontal: Space.lg }, caption: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary }, meta: { gap: Space.xs, paddingBottom: Space.lg },
  message: { gap: Space.sm, paddingBottom: Space.xl }, footer: { gap: Space.sm, paddingVertical: Space.lg } });
