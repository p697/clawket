import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Folder, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ProjectDescriptor } from '@clawket/agent-protocol';
import { Sheet } from '../../components/ui/Sheet';
import { SearchInput } from '../../components/ui/SearchInput';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { useAppTheme } from '../../theme';
import { Space, IconSize } from '../../theme/tokens';

export function ProjectPicker({ visible, projects, selected, creating, onClose, onSelect }: {
  visible: boolean; projects: readonly ProjectDescriptor[]; selected: string | null; creating: boolean;
  onClose(): void; onSelect(id: string | null): void;
}): React.JSX.Element {
  const { t } = useTranslation('common'); const { theme } = useAppTheme(); const [query, setQuery] = useState('');
  return <Sheet visible={visible} stackBehavior="push" title={t(creating ? 'Choose a project' : 'Projects')} onClose={onClose} closeAccessibilityLabel={t('Close')} snapPoints={['70%', '90%']} testID="codex-project-picker">
    <View style={styles.search}><SearchInput inSheet appearance="quiet" value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('Search projects')} /></View>
    <BottomSheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <SettingsGroup chrome="plain">
        {!creating && !query ? <SettingsRow title={t('All projects')} onPress={() => onSelect(null)} trailing={!selected ? <Check size={IconSize.md} color={theme.colors.ink} /> : undefined} /> : null}
        {projects.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase())).map(p => <SettingsRow key={p.id} title={p.name} subtitle={p.path} disabled={creating && !p.available} leading={<Folder size={IconSize.md} color={theme.colors.inkSecondary} />} trailing={selected === p.id ? <Check size={IconSize.md} color={theme.colors.ink} /> : undefined} onPress={() => onSelect(p.id)} testID={`codex-project-${p.id}`} />)}
      </SettingsGroup>
    </BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({ search: { paddingHorizontal: Space.lg, paddingBottom: Space.md }, body: { paddingHorizontal: Space.lg, paddingBottom: Space.xl } });
