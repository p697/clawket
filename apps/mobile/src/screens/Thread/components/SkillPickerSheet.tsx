import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SlidersHorizontal } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, SkillStatusEntry } from '@clawket/agent-protocol';
import { Sheet } from '../../../components/ui/Sheet';
import { SheetHeaderButton } from '../../../components/ui/SheetHeaderButton';
import { SearchInput } from '../../../components/ui/SearchInput';
import { SettingsDivider, SettingsRow } from '../../../components/ui/SettingsGroup';
import { Banner } from '../../../components/ui/Banner';
import { LoadingState } from '../../../components/ui/LoadingState';
import { useAppTheme } from '../../../theme';
import { FontSize, LineHeight, Space } from '../../../theme/tokens';

const SNAP_POINTS = ['62%', '92%'];

export function SkillPickerSheet({ visible, adapter, agentId, online, onClose, onSelect, onManage }: Readonly<{
  visible: boolean; adapter: AgentAdapter | null; agentId: string; online: boolean;
  onClose: () => void; onSelect: (skill: SkillStatusEntry) => void; onManage: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common', 'settings']);
  const { theme } = useAppTheme();
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<SkillStatusEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef<(() => void) | null>(null);
  const scope = `${adapter?.connection.id ?? ''}:${agentId}`;
  const currentScope = useRef({ scope, adapter, online });
  currentScope.current = { scope, adapter, online };
  useEffect(() => { pending.current = null; setSkills([]); setQuery(''); }, [scope, adapter]);
  useEffect(() => {
    let active = true;
    if (!visible || !adapter?.management?.skills?.status || !online) { setLoading(false); return; }
    setLoading(true); setError(false);
    void adapter.management.skills.status(agentId).then((report) => {
      if (active) setSkills(report.skills.filter((skill) => Boolean(skill.invocation) && skill.eligible && !skill.disabled && !skill.blockedByAllowlist));
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [adapter, agentId, visible, online, retry]);
  const filtered = useMemo(() => skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [skills, query]);
  const handoff = (action: () => void) => {
    const selectedScope = scope;
    pending.current = () => { if (currentScope.current.scope === selectedScope && currentScope.current.adapter === adapter && currentScope.current.online) action(); };
    onClose();
  };
  return <Sheet visible={visible} onClose={onClose} onAfterClose={() => { const action = pending.current; pending.current = null; action?.(); }}
    title={t('Use skill')} closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={SNAP_POINTS} testID="skill-picker"
    headerRight={<SheetHeaderButton icon={SlidersHorizontal} accessibilityLabel={t('Skills', { ns: 'common' })} onPress={() => handoff(onManage)} />}>
    <View style={styles.search}><SearchInput inSheet appearance="quiet" value={query} onChangeText={setQuery} placeholder={t('Search skills...', { ns: 'settings' })} testID="skill-picker-search" /></View>
    {error ? <Banner message={t('Failed to load skills', { ns: 'settings' })} actionLabel={t('Retry', { ns: 'common' })} onAction={() => setRetry((value) => value + 1)} /> : null}
    <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading && !skills.length ? <LoadingState /> : filtered.map((skill, index) => <React.Fragment key={skill.skillKey}>
        {index ? <SettingsDivider inset="content" /> : null}
        <SettingsRow title={skill.name} subtitle={skill.description} subtitleLines={1} disabled={!online} onPress={() => handoff(() => onSelect(skill))} testID={`use-skill-${skill.skillKey}`} />
      </React.Fragment>)}
      {!loading && !filtered.length && !error ? <Text style={[styles.empty, { color: theme.colors.inkSecondary }]}>{online ? t('No available skills') : t('Offline', { ns: 'common' })}</Text> : null}
    </BottomSheetScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: Space.lg, paddingBottom: Space.sm },
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl },
  empty: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center', paddingVertical: Space.xl },
});
