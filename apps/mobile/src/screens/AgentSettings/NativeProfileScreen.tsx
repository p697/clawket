import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useIsFocused } from '@react-navigation/native';
import { Check, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AgentAdapter, AgentProfileOperations, ProfileDefaults, ProfileInstruction, ProfileMcp, ProfilePlugin, ProfileProject, ProfileSkill, ProfileSkills, ProfileUsage } from '@clawket/agent-protocol';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SettingsDivider, SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { SearchInput } from '../../components/ui/SearchInput';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import type { RootStackParamList, AgentSettingsSection } from '../../navigation/root-stack';
import { useProfileRead } from './useProfileRead';
import { DocumentScreen } from './DocumentScreen';
import { nativeProfileDocument, quotaRemaining } from './native-profile-model';

export type NativeProfileSection = 'models' | 'skills' | 'files' | 'usage' | 'tools' | 'plugins';
export const isNativeProfileSection = (section: AgentSettingsSection): section is NativeProfileSection => ['models', 'skills', 'files', 'usage', 'tools', 'plugins'].includes(section);

const identities = new WeakMap<AgentProfileOperations, number>();
let nextIdentity = 0;
function profileIdentity(profile: AgentProfileOperations) {
  if (!identities.has(profile)) identities.set(profile, ++nextIdentity);
  return identities.get(profile);
}

type Props = {
  adapter: AgentAdapter; section: NativeProfileSection; online: boolean; isPro: boolean;
  navigation: NativeStackNavigationProp<RootStackParamList, 'AgentSettingsSection'>;
  params: RootStackParamList['AgentSettingsSection'];
  onOpenPaywall: (reason: string, onContinue?: () => void) => void;
};

export function NativeProfileScreen(props: Props) {
  const { t } = useTranslation('settings');
  const profile = props.adapter.management?.profile;
  const source = useMemo(() => profile && props.params.profileDocument
    ? nativeProfileDocument(profile, props.params.connectionId, props.params.profileDocument.id, props.section === 'skills', {
      changed: t('This file changed. Reopen it before saving.'), load: t('Failed to load file'), save: t('Save failed'),
    }) : null,
  [profile, props.params.connectionId, props.params.profileDocument?.id, props.section, t]);
  if (props.params.profileDocument) return <DocumentScreen title={props.params.profileDocument.name} source={source} online={props.online} isPro={props.isPro} navigation={props.navigation} onOpenPaywall={props.onOpenPaywall} />;
  if (!profile) return null;
  return <ProfilePage key={`${profileIdentity(profile)}:${props.params.connectionId}:${props.section}`} {...props} profile={profile} />;
}

type Detail = { kind: 'project' | 'model' | 'thinking' } | { kind: 'skill'; skill: ProfileSkill } | { kind: 'mcp'; server: ProfileMcp } | null;
function ProfilePage({ adapter, profile, section, online, navigation, params }: Props & { profile: AgentProfileOperations }) {
  const { t, i18n } = useTranslation(['settings', 'common', 'config']);
  const { theme } = useAppTheme(); const insets = useSafeAreaInsets(); const focused = useIsFocused();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const scoped = ['skills', 'files', 'plugins'].includes(section);
  const [projectId, setProjectId] = useState<string | undefined>(params.profileProjectId);
  const [refresh, setRefresh] = useState(0); const [detail, setDetail] = useState<Detail>(null);
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false); const [writeError, setWriteError] = useState(false);
  const lock = useRef(false); const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const loadProjects = useCallback(() => profile.projects(), [profile]);
  const projects = useProfileRead(loadProjects, online && focused && scoped, refresh);
  const selectedProject = projects.value?.find(row => row.id === projectId) ?? projects.value?.find(row => row.available);
  const selectedId = selectedProject?.id;
  const load = useCallback(async () => {
    if (section === 'models') return profile.defaults();
    if (section === 'usage') return profile.usage();
    if (section === 'tools') return profile.mcp();
    if (!selectedId) throw new Error('Project unavailable');
    if (section === 'skills') return profile.skills(selectedId, true);
    if (section === 'files') return profile.instructions(selectedId);
    return profile.plugins(selectedId);
  }, [profile, section, selectedId]);
  const read = useProfileRead<ProfileDefaults | ProfileUsage | ProfileSkills | ProfileInstruction[] | ProfileMcp[] | ProfilePlugin[]>(load, online && focused && (!scoped || !!selectedId), refresh);
  const context = useRef({ profile, selectedId, section, online, focused }); context.current = { profile, selectedId, section, online, focused };
  const mutate = async (operation: () => Promise<unknown>, confirmed?: (value: unknown) => void) => {
    if (lock.current || !online || !focused) return;
    const before = context.current; lock.current = true; setBusy(true); setWriteError(false);
    try {
      const value = await operation();
      const now = context.current;
      if (live.current && now.profile === before.profile && now.selectedId === before.selectedId && now.section === before.section && now.online && now.focused) confirmed?.(value);
    } catch { if (live.current && context.current.profile === before.profile && context.current.selectedId === before.selectedId && context.current.focused) setWriteError(true); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const levelLabel = (level: string) => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra'].includes(level) ? t(`profile.level.${level}`) : level;
  const defaults = section === 'models' ? read.value as ProfileDefaults | undefined : undefined;
  const selectedModel = defaults?.models.find(row => row.id === defaults.model) ?? defaults?.models.find(row => row.isDefault);
  const chooseModel = (model: string | null) => {
    if (!defaults?.editable) return;
    const chosen = defaults.models.find(row => row.id === model);
    const thinking = defaults.thinking && chosen?.levels.includes(defaults.thinking) ? defaults.thinking : null;
    void mutate(() => profile.setDefaults({ model, thinking, version: defaults.version }), value => read.replace(value as ProfileDefaults));
  };
  const openDocument = (id: string, name: string) => {
    setDetail(null);
    navigation.push('AgentSettingsSection', { ...params, profileProjectId: selectedId, profileDocument: { id, name } });
  };
  const skills = section === 'skills' ? read.value as ProfileSkills | undefined : undefined;
  const visibleSkills = skills?.skills.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(query.toLowerCase()));
  const usage = section === 'usage' ? read.value as ProfileUsage | undefined : undefined;
  const instructions = section === 'files' ? read.value as ProfileInstruction[] | undefined : undefined;
  const mcp = section === 'tools' ? read.value as ProfileMcp[] | undefined : undefined;
  const plugins = section === 'plugins' ? read.value as ProfilePlugin[] | undefined : undefined;
  const titles: Record<NativeProfileSection, string> = { models: t('profile.defaults'), usage: t('profile.usage'), skills: t('Skills', { ns: 'common' }), files: 'AGENTS.md', tools: 'MCP', plugins: t('profile.plugins') };
  const empty = read.value && (Array.isArray(read.value) ? read.value.length === 0 : section === 'skills' && skills?.skills.length === 0);
  return <View style={styles.screen} testID={`native-profile-${section}`}>
    <ScreenHeader title={titles[section]} topInset={insets.top} onBack={() => navigation.goBack()} rightContent={<FloatingButton icon={RefreshCw} appearance="plain" accessibilityLabel={t('Refresh', { ns: 'common' })} disabled={busy} onPress={() => { setWriteError(false); setRefresh(value => value + 1); }} />} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={read.pending && !!read.value} onRefresh={() => setRefresh(value => value + 1)} tintColor={theme.colors.inkSecondary} />}>
      {scoped ? <SettingsGroup><SettingsRow title={t('profile.project')} value={selectedProject?.name ?? '—'} tailWidth="wide" showChevron disabled={busy || !online} onPress={() => setDetail({ kind: 'project' })} /></SettingsGroup> : null}
      {section === 'models' ? <Text style={styles.note}>{t('profile.newChats')}</Text> : section === 'tools' || section === 'plugins' ? <Text style={styles.note}>{t('profile.desktopManage')}</Text> : section === 'files' ? <Text style={styles.note}>{t('profile.instructionsHint')}</Text> : null}
      {writeError || read.failed || projects.failed ? <Banner message={t('profile.loadError')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => { setWriteError(false); setRefresh(value => value + 1); }} /> : null}
      {!online ? <Text style={styles.note}>{t('profile.offline')}</Text> : null}
      {(!read.value && (read.pending || scoped && projects.pending)) ? <SettingsGroup><Skeleton style={styles.loading} /><Skeleton style={styles.loading} /></SettingsGroup> : null}
      {scoped && !projects.pending && !projects.failed && !selectedId ? <Text style={styles.note}>{t('profile.noProjects')}</Text> : null}
      {defaults?.editable === false ? <Text style={styles.note}>{t('profile.desktopManage')}</Text> : null}
      {defaults ? <SettingsGroup>
        <SettingsRow title={t('Default model', { ns: 'config' })} value={defaults.models.find(row => row.id === defaults.model)?.name ?? defaults.model ?? t('profile.nativeDefault')} tailWidth="wide" showChevron disabled={busy || !online || !defaults.editable} onPress={() => setDetail({ kind: 'model' })} testID="native-default-model" />
        <SettingsDivider inset="content" />
        <SettingsRow title={t('Thinking level', { ns: 'config' })} value={defaults.thinking ? levelLabel(defaults.thinking) : t('profile.nativeDefault')} showChevron disabled={busy || !online || !defaults.editable} onPress={() => setDetail({ kind: 'thinking' })} testID="native-default-thinking" />
        {busy ? <ActivityIndicator color={theme.colors.inkSecondary} style={styles.busy} /> : null}
      </SettingsGroup> : null}
      {skills ? <>
        <SearchInput value={query} onChangeText={setQuery} placeholder={t('profile.searchSkills')} />
        {skills.errorCount ? <Text style={styles.note}>{t('profile.skillErrors', { count: skills.errorCount })}</Text> : null}
        <SettingsGroup>{visibleSkills?.map((skill, index) => <React.Fragment key={skill.id}>{index ? <SettingsDivider inset="content" /> : null}
          <SettingsRow title={skill.name} subtitle={skill.description || t(`profile.scope.${skill.scope}`)} value={t(`profile.scope.${skill.scope}`)} onPress={() => setDetail({ kind: 'skill', skill })} testID={`native-skill-${skill.name}`} trailing={<ThemedSwitch testID={`native-skill-toggle-${skill.name}`} value={skill.enabled} disabled={busy || !online} accessibilityLabel={`${t('Enable', { ns: 'settings' })}: ${skill.name}`} onValueChange={enabled => void mutate(() => profile.setSkillEnabled(skill.id, enabled), value => read.replace(value as ProfileSkills))} />} />
        </React.Fragment>)}</SettingsGroup>
        {visibleSkills?.length === 0 && skills.skills.length > 0 ? <Text style={styles.note}>{t('profile.noMatches')}</Text> : null}
      </> : null}
      {instructions ? <SettingsGroup>{instructions.map((file, index) => <React.Fragment key={file.id}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow title={file.name} subtitle={t(`profile.scope.${file.scope}`)} value={!file.exists ? t('profile.create') : undefined} showChevron onPress={() => openDocument(file.id, file.name)} /></React.Fragment>)}</SettingsGroup> : null}
      {usage ? <>
        <SettingsGroup><SettingsRow title={t('profile.quota')} value={quotaRemaining(usage) === null ? '—' : `${Math.floor(quotaRemaining(usage)!)}%`} /><SettingsDivider inset="content" /><SettingsRow title={t('profile.plan')} value={usage.plan ?? t('profile.unknown')} /></SettingsGroup>
        {usage.quotas.flatMap(quota => quota.windows.map((window, index) => <SettingsGroup key={`${quota.id}:${index}`}>
          <View style={styles.quotaCopy}><Text style={styles.label}>{quota.name}</Text><Text style={styles.number}>{Math.floor(Math.max(0, 100 - window.usedPercent))}%</Text><Text style={styles.caption}>{t('profile.window', { count: window.minutes })}</Text>
            <View style={styles.rail}><View style={[styles.fill, { width: `${Math.max(0, Math.min(100, 100 - window.usedPercent))}%` }]} /></View>
            <Text style={styles.caption}>{window.resetsAt === null ? t('profile.resetUnknown') : t('profile.resets', { time: new Date(window.resetsAt * 1000).toLocaleString(i18n.resolvedLanguage ?? i18n.language) })}</Text>
          </View>
        </SettingsGroup>))}
        {!usage.quotas.some(row => row.windows.length) ? <Text style={styles.note}>{t('profile.quotaUnavailable')}</Text> : null}
        <SettingsGroup><SettingsRow title={t('profile.lifetimeTokens')} value={usage.lifetimeTokens === null ? '—' : usage.lifetimeTokens.toLocaleString(i18n.language)} /></SettingsGroup>
        {usage.daily.length ? <SettingsGroup>{usage.daily.slice(-30).reverse().map((day, index) => <React.Fragment key={day.date}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow title={day.date} value={day.tokens.toLocaleString(i18n.language)} /></React.Fragment>)}</SettingsGroup> : null}
      </> : null}
      {mcp ? <SettingsGroup>{mcp.map((server, index) => <React.Fragment key={server.name}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow title={server.name} subtitle={t(`profile.auth.${server.auth}`)} value={server.toolsAvailable ? t('profile.toolCount', { count: server.tools.length }) : t('profile.unavailable')} showChevron onPress={() => setDetail({ kind: 'mcp', server })} /></React.Fragment>)}</SettingsGroup> : null}
      {plugins ? <SettingsGroup>{plugins.map((plugin, index) => <React.Fragment key={plugin.id}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow title={plugin.name} subtitle={plugin.description} value={t(plugin.enabled ? 'Enabled' : 'Disabled', { ns: 'settings' })} /></React.Fragment>)}</SettingsGroup> : null}
      {empty ? <Text style={styles.note}>{t('profile.empty')}</Text> : null}
    </ScrollView>
    <Sheet visible={detail !== null} onClose={() => { if (!busy) setDetail(null); }} closeAccessibilityLabel={t('Close', { ns: 'common' })} title={detail?.kind === 'skill' ? detail.skill.name : detail?.kind === 'mcp' ? detail.server.name : detail?.kind === 'model' ? t('Default model', { ns: 'config' }) : detail?.kind === 'thinking' ? t('Thinking level', { ns: 'config' }) : t('profile.project')} tone="grouped" snapPoints={['70%', '90%']} dismissOnBackdropPress={!busy}>
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {detail?.kind === 'project' ? <SettingsGroup>{projects.value?.map((project: ProfileProject, index) => <React.Fragment key={project.id}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow testID={`native-project-choice-${project.id}`} title={project.name} value={!project.available ? t('profile.unavailable') : undefined} disabled={!project.available || busy} selected={project.id === selectedId} onPress={() => { setProjectId(project.id); setDetail(null); setQuery(''); }} /></React.Fragment>)}</SettingsGroup> : null}
        {detail?.kind === 'model' && defaults ? <SettingsGroup>{[{ id: null, name: t('profile.nativeDefault') }, ...defaults.models].map((model, index) => <React.Fragment key={model.id ?? 'default'}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow testID={`native-model-choice-${model.id ?? "default"}`} title={model.name} selected={defaults.model === model.id} trailing={defaults.model === model.id ? <Check color={theme.colors.ink} /> : undefined} disabled={busy || !online || !defaults.editable} onPress={() => chooseModel(model.id)} /></React.Fragment>)}</SettingsGroup> : null}
        {detail?.kind === 'thinking' && defaults ? <SettingsGroup>{[null, ...(selectedModel?.levels ?? [])].map((level, index) => <React.Fragment key={level ?? 'default'}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow testID={`native-thinking-choice-${level ?? "default"}`} title={level ? levelLabel(level) : t('profile.nativeDefault')} selected={defaults.thinking === level} disabled={busy || !online || !defaults.editable} onPress={() => void mutate(() => profile.setDefaults({ model: defaults.model, thinking: level, version: defaults.version }), value => read.replace(value as ProfileDefaults))} /></React.Fragment>)}</SettingsGroup> : null}
        {detail?.kind === 'skill' ? <>
          <Text style={styles.body}>{detail.skill.description}</Text><Text style={styles.note}>{t(`profile.scope.${detail.skill.scope}`)}</Text>
          <SettingsGroup><SettingsRow title="SKILL.md" value={!detail.skill.editable ? t('Read only', { ns: 'config' }) : undefined} showChevron onPress={() => openDocument(detail.skill.id, 'SKILL.md')} /></SettingsGroup>
          <Button label={t('profile.useSkill')} disabled={busy || !detail.skill.enabled || !online || !adapter.createSession} onPress={() => {
            const skill = detail.skill;
            void mutate(() => adapter.createSession!(params.agentId, { projectId: selectedId }), value => {
              setDetail(null); navigation.navigate('Thread', { connectionId: params.connectionId, agentId: params.agentId, sessionKey: (value as { key: string }).key, from: 'panel', composerDraft: { id: `skill:${Date.now()}`, text: `$${skill.name} `, skill: { name: skill.name, invocation: `$${skill.name}` } } });
            });
          }} />
        </> : null}
        {detail?.kind === 'mcp' && !detail.server.toolsAvailable ? <Text style={styles.note}>{t('profile.unavailable')}</Text> : null}
        {detail?.kind === 'mcp' ? <SettingsGroup>{detail.server.tools.map((tool, index) => <React.Fragment key={tool.name}>{index ? <SettingsDivider inset="content" /> : null}<SettingsRow title={tool.name} subtitle={tool.description} subtitleLines={4} /></React.Fragment>)}</SettingsGroup> : null}
        {busy ? <ActivityIndicator color={theme.colors.inkSecondary} /> : null}
        {writeError ? <Text style={styles.note}>{t('profile.loadError')}</Text> : null}
      </BottomSheetScrollView>
    </Sheet>
  </View>;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvasGrouped },
    content: { padding: Space.lg, gap: Space.xl },
    label: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    note: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    body: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body },
    caption: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    quotaCopy: { flex: 1, padding: Space.lg, gap: Space.sm },
    number: { color: colors.ink, fontSize: FontSize.display, lineHeight: LineHeight.display, fontWeight: FontWeight.semibold, fontVariant: ['tabular-nums'] },
    numberSkeleton: { height: LineHeight.display, width: '40%' },
    loading: { margin: Space.lg, height: LineHeight.body }, busy: { padding: Space.md },
    rail: { height: Space.xs, backgroundColor: colors.canvasGrouped, borderRadius: Radius.full, overflow: 'hidden', marginVertical: Space.sm },
    fill: { height: '100%', backgroundColor: colors.ink, borderRadius: Radius.full },
  });
}
