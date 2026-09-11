import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  DiscoverSkillItem,
  SkillStatusEntry,
  SkillStatusReport,
  SkillsOperations,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
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
}>;

export function SkillsSection({
  adapter,
  agent,
  online,
}: SkillsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.skills;
  const [view, setView] = useState<SkillsView>('installed');
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [discovered, setDiscovered] = useState<ReadonlyArray<DiscoverSkillItem>>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SkillSelection | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<SkillStatusEntry | null>(null);
  const [discoverEpoch, setDiscoverEpoch] = useState(0);
  const discoverRequest = useRef(0);
  const canDiscover = adapter.capabilities.skillDiscover && Boolean(operations?.discover);

  const loadInstalled = useCallback(async () => {
    if (!operations?.status) {
      setLoadingInstalled(false);
      return;
    }
    setLoadingInstalled(true);
    try {
      setReport(await operations.status(agent.agentId));
      setError(null);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, t('Failed to load skills', { ns: 'settings' })));
    } finally {
      setLoadingInstalled(false);
    }
  }, [agent.agentId, operations, t]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    if (canDiscover || view !== 'discover') return;
    setView('installed');
    setQuery('');
  }, [canDiscover, view]);

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
          if (!active || request !== discoverRequest.current) return;
          setDiscovered(result.items);
          setError(null);
        },
        (discoverError: unknown) => {
          if (!active || request !== discoverRequest.current) return;
          setDiscovered([]);
          setError(errorMessage(discoverError, t('Failed to load skills', { ns: 'settings' })));
        },
      ).finally(() => {
        if (active && request === discoverRequest.current) setLoadingDiscover(false);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [canDiscover, discoverEpoch, operations, query, t, view]);

  const installed = useMemo(
    () => filterInstalledSkills(report?.skills ?? [], query),
    [query, report?.skills],
  );
  const discoverGroups = useMemo(
    () => groupDiscoveredSkills(discovered),
    [discovered],
  );
  const tabs = useMemo(() => [
    { key: 'installed' as const, label: t('Installed', { ns: 'config' }) },
    ...(canDiscover
      ? [{ key: 'discover' as const, label: t('Discover', { ns: 'common' }) }]
      : []),
  ], [canDiscover, t]);

  const toggleSkill = useCallback(async (skill: SkillStatusEntry) => {
    if (!online || busyKey || !canToggleSkill(skill, adapter.capabilities, operations)) return;
    setBusyKey(skill.skillKey);
    setError(null);
    try {
      await operations?.update?.(skill.skillKey, { enabled: skill.disabled });
      setSelection(null);
      await loadInstalled();
    } catch (updateError: unknown) {
      setError(errorMessage(updateError, t('Failed to load skills', { ns: 'settings' })));
    } finally {
      setBusyKey(null);
    }
  }, [adapter.capabilities, busyKey, loadInstalled, online, operations, t]);

  const removeSkill = useCallback(async () => {
    const skill = removeCandidate;
    if (!skill || !online || busyKey
      || !canRemoveSkill(skill, adapter.capabilities, operations)) return;
    setBusyKey(skill.skillKey);
    setError(null);
    try {
      await operations?.remove?.(skill.skillKey, agent.agentId);
      setRemoveCandidate(null);
      setSelection(null);
      await loadInstalled();
    } catch (removeError: unknown) {
      setError(errorMessage(removeError, t('Failed to load skills', { ns: 'settings' })));
      setRemoveCandidate(null);
    } finally {
      setBusyKey(null);
    }
  }, [adapter.capabilities, agent.agentId, busyKey, loadInstalled, online, operations, removeCandidate, t]);

  const installSkill = useCallback(async (item: DiscoverSkillItem) => {
    if (!online || busyKey || !adapter.capabilities.skillInstall) return;
    const prompt = buildSkillInstallPrompt(item);
    if (!prompt) return;
    setBusyKey(item.id);
    setError(null);
    try {
      await adapter.prompt(agent.mainSessionKey, {
        text: prompt,
        idempotencyKey: `skill-install:${Date.now()}:${item.id}`,
      });
      setSelection(null);
    } catch (installError: unknown) {
      setError(errorMessage(installError, t('Failed to load skills', { ns: 'settings' })));
    } finally {
      setBusyKey(null);
    }
  }, [adapter, agent.mainSessionKey, busyKey, online, t]);

  const loading = view === 'installed' ? loadingInstalled : loadingDiscover;
  return (
    <>
      <View testID="agent-skills-section" style={styles.root}>
        <SegmentedTabs
          testID="agent-skills-tabs"
          tabs={tabs}
          active={view}
          onSwitch={(next) => {
            setQuery('');
            setError(null);
            if (next === 'discover') setLoadingDiscover(true);
            setView(next);
          }}
        />
        <SearchInput
          testID="agent-skills-search"
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
              if (view === 'installed') void loadInstalled();
              else setDiscoverEpoch((current) => current + 1);
            }}
          />
        ) : null}
        {loading ? <SkillsLoading /> : view === 'installed' ? (
          installed.length ? (
            <SettingsGroup testID="agent-skills-installed-list">
              {installed.map((skill, index) => (
                <React.Fragment key={skill.skillKey}>
                  {index ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`agent-skill-installed-${skill.skillKey}`}
                    title={skill.name}
                    value={translateSkillAvailability(skillAvailability(skill), t)}
                    showChevron
                    onPress={() => setSelection({ kind: 'installed', item: skill })}
                  />
                </React.Fragment>
              ))}
            </SettingsGroup>
          ) : (
            <Text testID="agent-skills-empty" style={styles.emptyText}>
              {t('No skills found', { ns: 'settings' })}
            </Text>
          )
        ) : discoverGroups.length ? (
          <View style={styles.groups}>
            {discoverGroups.map((group) => (
              <View key={group.source} style={styles.groupWrap}>
                <Text style={styles.groupTitle}>
                  {group.source === 'clawhub' ? 'ClawHub' : 'skills.sh'}
                </Text>
                <SettingsGroup>
                  {group.items.map((item, index) => (
                    <React.Fragment key={item.id}>
                      {index ? <SettingsDivider inset="content" /> : null}
                      <SettingsRow
                        testID={`agent-skill-discover-${item.id}`}
                        title={item.title}
                        value={item.author}
                        showChevron
                        onPress={() => setSelection({ kind: 'discover', item })}
                      />
                    </React.Fragment>
                  ))}
                </SettingsGroup>
              </View>
            ))}
          </View>
        ) : (
          <Text testID="agent-skills-discover-empty" style={styles.emptyText}>
            {t('No discover results', { ns: 'common' })}
          </Text>
        )}
      </View>

      <SkillDetailSheet
        selection={removeCandidate ? null : selection}
        adapter={adapter}
        online={online}
        busyKey={busyKey}
        operations={operations}
        onClose={() => setSelection(null)}
        onToggle={(skill) => { void toggleSkill(skill); }}
        onRemove={setRemoveCandidate}
        onInstall={(item) => { void installSkill(item); }}
      />
      <Sheet
        testID="agent-skill-remove-confirm"
        visible={removeCandidate !== null}
        title={t('Uninstall skill?', { ns: 'common' })}
        closeAccessibilityLabel={t('Cancel', { ns: 'common' })}
        dismissOnBackdropPress={!busyKey}
        onClose={() => {
          if (!busyKey) setRemoveCandidate(null);
        }}
      >
        <View style={styles.confirmContent}>
          <Text style={styles.detailText}>{t('This cannot be undone.', { ns: 'common' })}</Text>
          <View style={styles.actionRow}>
            <Button
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              disabled={Boolean(busyKey)}
              onPress={() => setRemoveCandidate(null)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-skill-remove-confirm-action"
              label={t('Uninstall', { ns: 'common' })}
              variant="destructive"
              loading={Boolean(busyKey)}
              onPress={() => { void removeSkill(); }}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>
    </>
  );
}

function SkillDetailSheet({
  selection,
  adapter,
  online,
  busyKey,
  operations,
  onClose,
  onToggle,
  onRemove,
  onInstall,
}: Readonly<{
  selection: SkillSelection | null;
  adapter: AgentAdapter;
  online: boolean;
  busyKey: string | null;
  operations: SkillsOperations | undefined;
  onClose: () => void;
  onToggle: (skill: SkillStatusEntry) => void;
  onRemove: (skill: SkillStatusEntry) => void;
  onInstall: (item: DiscoverSkillItem) => void;
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
  const canInstall = discovered !== null && adapter.capabilities.skillInstall;

  return (
    <Sheet
      testID="agent-skill-detail"
      visible={selection !== null}
      title={installed?.name ?? discovered?.title ?? t('Skill', { ns: 'settings' })}
      closeAccessibilityLabel={t('Back', { ns: 'common' })}
      dismissOnBackdropPress={!busyKey}
      onClose={onClose}
    >
      <View style={styles.detailContent}>
        <Text style={styles.detailText}>
          {installed?.description ?? discovered?.summary ?? ''}
        </Text>
        <SettingsGroup>
          {installed ? (
            <>
              <SettingsRow
                title={t('Status', { ns: 'settings' })}
                value={translateSkillAvailability(skillAvailability(installed), t)}
              />

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
        {installed && (canToggle || canRemove) ? (
          <View style={styles.actionRow}>
            {canToggle ? (
              <Button
                testID="agent-skill-toggle"
                label={t(installed.disabled ? 'Enable' : 'Disable', { ns: 'common' })}
                variant="secondary"
                disabled={!online || Boolean(busyKey)}
                loading={busyKey === itemKey}
                onPress={() => onToggle(installed)}
                style={styles.actionButton}
              />
            ) : null}
            {canRemove ? (
              <Button
                testID="agent-skill-remove"
                label={t('Uninstall', { ns: 'common' })}
                variant="destructive"
                disabled={!online || Boolean(busyKey)}
                onPress={() => onRemove(installed)}
                style={styles.actionButton}
              />
            ) : null}
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
      </View>
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
    minHeight: ControlSize.settingsRow,
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
      textAlign: 'center',
    },
    confirmContent: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xxl,
      gap: Space.xl,
    },
    actionRow: {
      flexDirection: 'row',
      gap: Space.md,
    },
    actionButton: { flex: 1 },
  });
}
