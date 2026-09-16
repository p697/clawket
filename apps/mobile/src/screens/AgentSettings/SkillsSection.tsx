import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  DiscoverSkillItem,
  SkillStatusEntry,
  SkillStatusReport,
  SkillsOperations,
} from '@clawket/agent-protocol';
import { SkillSourceSheet } from './SkillSourceSheet';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { SkillRow, SkillSwitch, useSkillIssues } from './SkillRow';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  buildSkillInstallPrompt,
  canRemoveSkill,
  canToggleSkill,
  filterInstalledSkills,
  groupDiscoveredSkills,
  skillAvailability,
} from './skills-model';

function translateSkillAvailability(
  availability: ReturnType<typeof skillAvailability>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (availability === 'Active') return t('Active', { ns: 'settings' });
  if (availability === 'Disabled') return t('Disabled', { ns: 'settings' });
  return t('Unavailable', { ns: 'settings' });
}

type SkillsView = 'installed' | 'discover';
type SkillSelection =
  | Readonly<{ kind: 'installed'; item: SkillStatusEntry }>
  | Readonly<{ kind: 'discover'; item: DiscoverSkillItem }>;

export type SkillsSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  isPro?: boolean;
  onOpenPaywall?: (reason: string, onContinue?: () => void) => void;
  view?: SkillsView;
  refreshKey?: number;
  onInstallRequested?: () => void;
}>;

export function SkillsSection(props: SkillsSectionProps): React.JSX.Element {
  return <SkillsContent key={`${props.agent.connectionId}:${props.agent.agentId}:${props.view ?? 'installed'}`} {...props} />;
}

function SkillsContent({
  adapter,
  agent,
  online,
  isPro = false,
  onOpenPaywall,
  view = 'installed',
  refreshKey = 0,
  onInstallRequested,
}: SkillsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.skills;
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [discovered, setDiscovered] = useState<ReadonlyArray<DiscoverSkillItem>>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SkillSelection | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [removeCandidate, setRemoveCandidate] = useState<SkillStatusEntry | null>(null);
  const [discoverEpoch, setDiscoverEpoch] = useState(0);
  const discoverRequest = useRef(0);
  const installedRequest = useRef(0);
  const hasReport = useRef(false);
  const mutation = useRef(false);
  const [sourceSkill, setSourceSkill] = useState<SkillStatusEntry | null>(null);
  const pendingSource = useRef<SkillStatusEntry | null>(null);
  const pendingRemove = useRef<SkillStatusEntry | null>(null);
  const pendingInstall = useRef(false);
  const scope = useMemo(() => ({ active: true }), [adapter]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const isCurrent = useCallback(() => scope.active && currentScope.current === scope, [scope]);
  useEffect(() => {
    scope.active = true;
    setSourceSkill(null);
    pendingSource.current = null;
    setReport(null);
    hasReport.current = false;
    setError(null);
    setDiscovered([]);
    setLoadingInstalled(online && view === 'installed');
    setSelection(null);
    setRemoveCandidate(null);
    setBusyKey(null);
    mutation.current = false;
    pendingRemove.current = null;
    pendingInstall.current = false;
    return () => { scope.active = false; };
  }, [scope]);
  const canDiscover = adapter.capabilities.skillDiscover && Boolean(operations?.discover);

  const loadInstalled = useCallback(async (quiet = false) => {
    const request = ++installedRequest.current;
    if (!operations?.status) {
      setLoadingInstalled(false);
      return;
    }
    if (!quiet || !hasReport.current) setLoadingInstalled(true);
    try {
      const next = await operations.status(agent.agentId);
      if (!isCurrent() || request !== installedRequest.current) return;
      hasReport.current = true;
      setReport(next);
      setError(null);
    } catch (loadError: unknown) {
      if (!isCurrent() || request !== installedRequest.current) return;
      setError(errorMessage(loadError, t('Failed to load skills', { ns: 'settings' })));
    } finally {
      if (isCurrent() && request === installedRequest.current) setLoadingInstalled(false);
    }
  }, [agent.agentId, isCurrent, operations, t]);

  useEffect(() => {
    if (view === 'installed' && online) void loadInstalled(true);
    else setLoadingInstalled(false);
  }, [loadInstalled, online, refreshKey, view]);

  useEffect(() => {
    if (view !== 'discover' || !canDiscover) return undefined;
    const discover = operations?.discover;
    if (!discover) return undefined;
    const request = ++discoverRequest.current;
    let active = true;
    setLoadingDiscover(true);
    const timeout = setTimeout(() => {
      void discover(query.trim()).then(
        (result) => {
          if (!active || !isCurrent() || request !== discoverRequest.current) return;
          setDiscovered(result.items);
          setError(null);
        },
        (discoverError: unknown) => {
          if (!active || !isCurrent() || request !== discoverRequest.current) return;
          setDiscovered([]);
          setError(errorMessage(discoverError, t('Failed to load skills', { ns: 'settings' })));
        },
      ).finally(() => {
        if (active && isCurrent() && request === discoverRequest.current) setLoadingDiscover(false);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [canDiscover, discoverEpoch, isCurrent, operations, query, t, view]);

  const installed = useMemo(
    () => filterInstalledSkills(report?.skills ?? [], query),
    [query, report?.skills],
  );
  const discoverGroups = useMemo(
    () => groupDiscoveredSkills(discovered),
    [discovered],
  );
  const selected = selection?.kind === 'installed'
    ? report?.skills.find((skill) => skill.skillKey === selection.item.skillKey)
    : null;
  const currentSelection: SkillSelection | null = selection?.kind === 'installed'
    ? selected ? { kind: 'installed', item: selected } : null
    : selection;
  const openSkill = useCallback((item: SkillStatusEntry) => {
    setSelection({ kind: 'installed', item });
  }, []);

  const toggleSkill = useCallback(async (skill: SkillStatusEntry) => {
    if (!online || mutation.current || !canToggleSkill(skill, adapter.capabilities, operations)) return;
    mutation.current = true;
    installedRequest.current += 1;
    setBusyKey(skill.skillKey);
    setError(null);
    try {
      const result = await operations?.update?.(skill.skillKey, { enabled: skill.disabled });
      if (!result?.ok) throw new Error(t('Failed to update skill', { ns: 'settings' }));
      if (!isCurrent()) return;
      // Commit the acknowledged value even if the follow-up status read fails.
      setReport((previous) => previous ? { ...previous, skills: previous.skills.map((item) => (
        item.skillKey === skill.skillKey ? { ...item, disabled: !skill.disabled } : item
      )) } : previous);
      await loadInstalled(true);
    } catch (updateError: unknown) {
      if (isCurrent()) setError(errorMessage(updateError, t('Failed to update skill', { ns: 'settings' })));
    } finally {
      if (isCurrent()) { mutation.current = false; setBusyKey(null); }
    }
  }, [adapter.capabilities, isCurrent, loadInstalled, online, operations, t]);

  const removeSkill = useCallback(async () => {
    const skill = removeCandidate;
    if (!skill || !online || mutation.current
      || !canRemoveSkill(skill, adapter.capabilities, operations)) return;
    mutation.current = true;
    installedRequest.current += 1;
    setRemoveCandidate(null);
    setBusyKey(skill.skillKey);
    setError(null);
    try {
      const result = await operations?.remove?.(skill.skillKey, agent.agentId);
      if (!result?.ok) throw new Error(t('Failed to uninstall skill', { ns: 'settings' }));
      if (!isCurrent()) return;
      setReport((previous) => previous ? { ...previous, skills: previous.skills.filter((item) => item.skillKey !== skill.skillKey) } : previous);
      setRemoveCandidate(null);
      setSelection(null);
      await loadInstalled(true);
    } catch (removeError: unknown) {
      if (!isCurrent()) return;
      setError(errorMessage(removeError, t('Failed to uninstall skill', { ns: 'settings' })));
      setRemoveCandidate(null);
    } finally {
      if (isCurrent()) { mutation.current = false; setBusyKey(null); }
    }
  }, [adapter.capabilities, agent.agentId, isCurrent, loadInstalled, online, operations, removeCandidate, t]);

  const installSkill = useCallback(async (item: DiscoverSkillItem) => {
    if (!online || mutation.current || !adapter.capabilities.skillInstall) return;
    const prompt = buildSkillInstallPrompt(item);
    if (!prompt) return;
    mutation.current = true;
    setBusyKey(item.id);
    setError(null);
    try {
      await adapter.prompt(agent.mainSessionKey, {
        text: prompt,
        idempotencyKey: `skill-install:${Date.now()}:${item.id}`,
      });
      if (!isCurrent()) return;
      // Closing or changing the detail while the request runs cancels navigation,
      // not the already-issued installation request.
      if (selectionRef.current?.kind === 'discover' && selectionRef.current.item.id === item.id) {
        pendingInstall.current = true;
        setSelection(null);
      }
    } catch (installError: unknown) {
      if (isCurrent()) setError(errorMessage(installError, t('Failed to request installation', { ns: 'settings' })));
    } finally {
      if (isCurrent()) { mutation.current = false; setBusyKey(null); }
    }
  }, [adapter, agent.mainSessionKey, isCurrent, online, t]);

  const loading = view === 'installed' ? loadingInstalled : loadingDiscover;
  return (
    <>
      <View testID="agent-skills-section" style={styles.root}>
        <SearchInput
          testID="agent-skills-search"
          appearance="quiet"
          value={query}
          onChangeText={setQuery}
          placeholder={t('Search skills...', { ns: 'settings' })}
        />
        {error ? (
          <Banner
            testID="agent-skills-error"
            tone="bad"
            message={error}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => {
              if (mutation.current) return;
              if (view === 'installed' && online) void loadInstalled(Boolean(report));
              else setDiscoverEpoch((current) => current + 1);
            }}
          />
        ) : null}
        {view === 'discover' && !canDiscover ? (
          <Banner message={t('Not supported by this backend', { ns: 'config' })} />
        ) : loading ? <SkillsLoading /> : view === 'installed' ? (
          report ? (
            <View testID="agent-skills-installed-list">
              <Text testID="agent-skills-summary" accessibilityLiveRegion="polite" style={styles.groupTitle}>
                {t('{{total}} skills · {{enabled}} enabled', { ns: 'settings', total: report.skills.length, enabled: report.skills.filter((skill) => skill.always || !skill.disabled).length })}
              </Text>
              {installed.map((skill) => (
                <SkillRow
                  key={skill.skillKey}
                  skill={skill}
                  canToggle={canToggleSkill(skill, adapter.capabilities, operations)}
                  disabled={!online || Boolean(busyKey)}
                  busy={busyKey === skill.skillKey}
                  onPress={openSkill}
                  onToggle={toggleSkill}
                />
              ))}
              {!installed.length ? <Text testID="agent-skills-empty" style={styles.emptyText}>{t('No skills found', { ns: 'settings' })}</Text> : null}
            </View>
          ) : !error ? (
            <Text testID="agent-skills-empty" style={styles.emptyText}>
              {online ? t('No skills found', { ns: 'settings' }) : t('Offline', { ns: 'common' })}
            </Text>
          ) : null
        ) : discoverGroups.length ? (
          <View style={styles.groups}>
            {discoverGroups.map((group) => (
              <View key={group.source} style={styles.groupWrap}>
                <Text style={styles.groupTitle}>
                  {group.source === 'clawhub' ? 'ClawHub' : 'skills.sh'}
                </Text>
                <View>
                  {group.items.map((item) => (
                      <SettingsRow
                        key={item.id}
                        testID={`agent-skill-discover-${item.id}`}
                        title={item.title}
                        style={styles.discoverRow}
                        subtitle={item.summary}
                        showChevron
                        onPress={() => setSelection({ kind: 'discover', item })}
                      />
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text testID="agent-skills-discover-empty" style={styles.emptyText}>
            {t('No discover results', { ns: 'common' })}
          </Text>
        )}
      </View>

      {sourceSkill ? <SkillSourceSheet key={sourceSkill.skillKey} adapter={adapter} agentId={agent.agentId}
        skill={sourceSkill} online={online} isPro={isPro} onOpenPaywall={onOpenPaywall} onClose={() => setSourceSkill(null)} /> : null}
      <SkillDetailSheet
        selection={currentSelection}
        adapter={adapter}
        online={online}
        busyKey={busyKey}
        operations={operations}
        error={error}
        onClose={() => { selectionRef.current = null; setSelection(null); }}
        onSource={(skill) => { pendingSource.current = skill; setSelection(null); }}
        onAfterClose={() => {
          if (!isCurrent()) return;
          if (pendingSource.current) { setSourceSkill(pendingSource.current); pendingSource.current = null; }
          if (pendingRemove.current) {
            setRemoveCandidate(pendingRemove.current);
            pendingRemove.current = null;
          }
          if (pendingInstall.current) {
            pendingInstall.current = false;
            onInstallRequested?.();
          }
        }}
        onToggle={(skill) => { void toggleSkill(skill); }}
        onRemove={(skill) => { pendingRemove.current = skill; setSelection(null); }}
        onInstall={(item) => { void installSkill(item); }}
      />
      <ConfirmationModal
        testID="agent-skill-remove-confirm"
        visible={removeCandidate !== null}
        title={t('Uninstall skill?', { ns: 'common' })}
        message={`${removeCandidate?.name ?? ''}\n${t('This cannot be undone.', { ns: 'common' })}`}
        cancelLabel={t('Cancel', { ns: 'common' })}
        confirmLabel={t('Uninstall', { ns: 'common' })}
        destructive
        onClose={() => { if (!mutation.current) setRemoveCandidate(null); }}
        onConfirm={() => { void removeSkill(); }}
      />
    </>
  );
}

function SkillDetailSheet({
  selection,
  adapter,
  online,
  busyKey,
  operations,
  error,
  onClose,
  onAfterClose,
  onToggle,
  onRemove,
  onInstall,
  onSource,
}: Readonly<{
  selection: SkillSelection | null;
  adapter: AgentAdapter;
  online: boolean;
  busyKey: string | null;
  operations: SkillsOperations | undefined;
  error: string | null;
  onClose: () => void;
  onAfterClose: () => void;
  onToggle: (skill: SkillStatusEntry) => void;
  onRemove: (skill: SkillStatusEntry) => void;
  onInstall: (item: DiscoverSkillItem) => void;
  onSource: (skill: SkillStatusEntry) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const installed = selection?.kind === 'installed' ? selection.item : null;
  const discovered = selection?.kind === 'discover' ? selection.item : null;
  const itemKey = installed?.skillKey ?? discovered?.id ?? null;
  const canToggle = installed
    ? canToggleSkill(installed, adapter.capabilities, operations)
    : false;
  const canRemove = installed
    ? canRemoveSkill(installed, adapter.capabilities, operations)
    : false;
  const issues = useSkillIssues(installed);
  const canInstall = discovered !== null && adapter.capabilities.skillInstall;

  return (
    <Sheet
      testID="agent-skill-detail"
      visible={selection !== null}
      title={installed?.name ?? discovered?.title ?? t('Skill', { ns: 'settings' })}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      dismissOnBackdropPress={!busyKey}
      onClose={onClose}
      onAfterClose={onAfterClose}
      snapPoints={['68%', '92%']}
    >
      <BottomSheetScrollView contentContainerStyle={styles.detailContent}>
        {error ? <Banner testID="agent-skill-detail-error" tone="bad" message={error} /> : null}
        <Text style={styles.detailText}>
          {installed?.description ?? discovered?.summary ?? ''}
        </Text>
        <SettingsGroup>
          {installed ? (
            <>
              <SettingsRow
                title={t('Enabled', { ns: 'settings' })}
                trailing={canToggle ? <SkillSwitch skill={installed} testID="agent-skill-toggle" disabled={!online || Boolean(busyKey)} busy={busyKey === itemKey} onToggle={onToggle} /> : undefined}
                value={canToggle ? undefined : installed.always ? t('Always on', { ns: 'settings' }) : t(installed.disabled ? 'Disabled' : 'Enabled', { ns: 'settings' })}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                title={t('Status', { ns: 'settings' })}
                value={issues.length ? t('Unavailable', { ns: 'settings' }) : translateSkillAvailability(skillAvailability(installed), t)}
              />
              <SettingsDivider inset="content" />
              <SettingsRow title={t('Source', { ns: 'settings' })} value={installed.source} />
            </>
          ) : discovered ? (
            <>
              <SettingsRow title={discovered.author} value={discovered.source === 'clawhub' ? 'ClawHub' : 'skills.sh'} />
              {discovered.installs !== null && discovered.installs !== undefined ? (
                <>
                  <SettingsDivider inset="content" />
                  <SettingsRow
                    title={t('Installs', { ns: 'common' })}
                    value={String(discovered.installs)}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </SettingsGroup>
        {installed && adapter.capabilities.skills && operations?.get ? <SettingsGroup>
          <SettingsRow testID="agent-skill-source" title="SKILL.md" showChevron disabled={!online || Boolean(busyKey)} onPress={() => onSource(installed)} />
        </SettingsGroup> : null}
        {issues.map((issue) => <Banner key={issue} tone="warn" message={issue} />)}
        {installed && canRemove ? (
          <View style={styles.actionRow}>
              <Button
                testID="agent-skill-remove"
                label={t('Uninstall', { ns: 'common' })}
                variant="destructive"
                disabled={!online || Boolean(busyKey)}
                onPress={() => onRemove(installed)}
                style={styles.actionButton}
              />
          </View>
        ) : null}
        {discovered && canInstall ? (
          <Button
            testID="agent-skill-install"
            label={t('Install via Chat', { ns: 'common' })}
            disabled={!online || Boolean(busyKey)}
            loading={busyKey === itemKey}
            onPress={() => onInstall(discovered)}
          />
        ) : null}
      </BottomSheetScrollView>
    </Sheet>
  );
}

function SkillsLoading(): React.JSX.Element {
  return (
    <View testID="agent-skills-loading" style={stylesStatic.loading}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={stylesStatic.skeletonRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonValue} />
        </View>
      ))}
    </View>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const stylesStatic = StyleSheet.create({
  loading: { gap: Space.sm },
  skeletonRow: {
    minHeight: ControlSize.rosterRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  skeletonTitle: { flex: 1, height: LineHeight.body },
  skeletonValue: { width: '20%', height: LineHeight.secondary },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { gap: Space.lg },
    discoverRow: { minHeight: ControlSize.rosterRow, paddingHorizontal: 0 },
    groups: { gap: Space.xl },
    groupWrap: { gap: Space.sm },
    groupTitle: {
      paddingHorizontal: Space.xs,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    detailContent: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xxl,
      gap: Space.xl,
    },
    detailText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    actionRow: {
      flexDirection: 'row',
      gap: Space.md,
    },
    actionButton: { flex: 1 },
  });
}
