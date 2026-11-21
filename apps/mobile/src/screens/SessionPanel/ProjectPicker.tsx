import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Folder, Folders, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ProjectDescriptor } from '@clawket/agent-protocol';
import { Sheet } from '../../components/ui/Sheet';
import { SearchInput } from '../../components/ui/SearchInput';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { useAppTheme } from '../../theme';
import { Space, IconSize, FontSize, LineHeight } from '../../theme/tokens';

/** A selected row shows its check; the others show how many conversations the choice would list. */
function countValue(count: number | undefined, selected: boolean): string | undefined {
  return !selected && count ? String(count) : undefined;
}

export function ProjectPicker({ visible, projects, counts, totalCount, selected, creating, onClose, onSelect }: {
  visible: boolean; projects: readonly ProjectDescriptor[]; selected: string | null; creating: boolean;
  /** Conversations per project id in the list the picker filters. */
  counts?: Readonly<Record<string, number>>; totalCount?: number;
  onClose(): void; onSelect(id: string | null): void;
}): React.JSX.Element {
  const { t } = useTranslation('common'); const { theme } = useAppTheme(); const [query, setQuery] = useState('');
  useEffect(() => { if (visible) setQuery(''); }, [visible]);
  // A folder that no longer exists cannot host a new chat. It stays out of the
  // way there until searched for; the filter picker still lists it for its history.
  const filtered = projects.filter(p => (!creating || p.available || !!query.trim())
    && `${p.name} ${p.path}`.toLowerCase().includes(query.trim().toLowerCase()));
  const check = <Check size={IconSize.md} color={theme.colors.ink} />;
  return <Sheet visible={visible} stackBehavior="push" title={t(creating ? 'Choose a project' : 'Projects')} onClose={onClose} closeAccessibilityLabel={t('Close')} snapPoints={['70%', '90%']} testID="codex-project-picker">
    <View style={styles.search}><SearchInput inSheet appearance="quiet" value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('Search projects')} /></View>
    <BottomSheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <SettingsGroup chrome="plain">
        {!creating && !query ? <SettingsRow testID="codex-project-all" title={t('All projects')} leading={<Folders size={IconSize.md} color={theme.colors.inkSecondary} />} value={countValue(totalCount, !selected)} trailing={!selected ? check : undefined} onPress={() => onSelect(null)} /> : null}
        {filtered.map(p => <SettingsRow key={p.id} title={p.name} subtitle={p.path} disabled={creating && !p.available} leading={<Folder size={IconSize.md} color={theme.colors.inkSecondary} />} value={countValue(counts?.[p.id], selected === p.id)} trailing={selected === p.id ? check : undefined} onPress={() => onSelect(p.id)} testID={`codex-project-${p.id}`} />)}
      </SettingsGroup>
      {filtered.length === 0 && query.trim() ? <Text style={[styles.empty, { color: theme.colors.inkSecondary }]}>{t('No results')}</Text> : null}
    </BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({ search: { paddingHorizontal: Space.lg, paddingBottom: Space.md }, body: { paddingHorizontal: Space.lg, paddingBottom: Space.xl }, empty: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center', paddingVertical: Space.xl } });
