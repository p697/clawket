import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  SkillStatusEntry,
  SkillStatusReport,
  SkillsOperations,
} from '@clawket/agent-protocol';
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
  canRemoveSkill,
  canToggleSkill,
  filterInstalledSkills,
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

export type SkillsSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  refreshKey?: number;
  /** Opens the skill's SKILL.md on the full-page document reader once the detail sheet has dismissed. */
  onOpenSource?: (skill: SkillStatusEntry) => void;
}>;

/** Installed skills only; discovery is the ClawHub page (`SkillDiscoverScreen`) behind the header action. */
export function SkillsSection(props: SkillsSectionProps): React.JSX.Element {
  return <SkillsContent key={`${props.agent.connectionId}:${props.agent.agentId}`} {...props} />;
}

function SkillsContent({
  adapter,
  agent,
  online,
  refreshKey = 0,
  onOpenSource,
}: SkillsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.skills;
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SkillStatusEntry | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<SkillStatusEntry | null>(null);
  const installedRequest = useRef(0);
  const hasReport = useRef(false);
  const mutation = useRef(false);
  const pendingSource = useRef<SkillStatusEntry | null>(null);
  const pendingRemove = useRef<SkillStatusEntry | null>(null);
  const scope = useMemo(() => ({ active: true }), [adapter]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const isCurrent = useCallback(() => scope.active && currentScope.current === scope, [scope]);
  useEffect(() => {
    scope.active = true;
    pendingSource.current = null;
    setReport(null);
    hasReport.current = false;
    setError(null);
    setLoadingInstalled(online);
    setSelection(null);
    setRemoveCandidate(null);
    setBusyKey(null);
    mutation.current = false;
    pendingRemove.current = null;
    return () => { scope.active = false; };
  }, [scope]);

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
    if (online) void loadInstalled(true);
    else setLoadingInstalled(false);
  }, [loadInstalled, online, refreshKey]);

  const installed = useMemo(
    () => filterInstalledSkills(report?.skills ?? [], query),
    [query, report?.skills],
  );
  // The sheet follows the live report so a toggle or removal shows immediately.
  const selected = selection
    ? report?.skills.find((skill) => skill.skillKey === selection.skillKey) ?? null
    : null;
  const openSkill = useCallback((item: SkillStatusEntry) => {
    Keyboard.dismiss();
    setSelection(item);
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
              if (mutation.current || !online) return;
              void loadInstalled(Boolean(report));
            }}
          />
        ) : null}
        {loadingInstalled ? <SkillsLoading /> : (
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
        )}
      </View>

      <SkillDetailSheet
        skill={selected}
        adapter={adapter}
        online={online}
        busyKey={busyKey}
        operations={operations}
        error={error}
        onClose={() => setSelection(null)}
        onSource={onOpenSource ? (skill) => { pendingSource.current = skill; setSelection(null); } : undefined}
        onAfterClose={() => {
          if (!isCurrent()) return;
          if (pendingSource.current) { onOpenSource?.(pendingSource.current); pendingSource.current = null; }
          if (pendingRemove.current) {
            setRemoveCandidate(pendingRemove.current);
            pendingRemove.current = null;
          }
        }}
        onToggle={(skill) => { void toggleSkill(skill); }}
        onRemove={(skill) => { pendingRemove.current = skill; setSelection(null); }}
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
  skill: installed,
  adapter,
  online,
  busyKey,
  operations,
  error,
  onClose,
  onAfterClose,
  onToggle,
  onRemove,
  onSource,
}: Readonly<{
  skill: SkillStatusEntry | null;
  adapter: AgentAdapter;
  online: boolean;
  busyKey: string | null;
  operations: SkillsOperations | undefined;
  error: string | null;
  onClose: () => void;
  onAfterClose: () => void;
  onToggle: (skill: SkillStatusEntry) => void;
  onRemove: (skill: SkillStatusEntry) => void;
  onSource?: (skill: SkillStatusEntry) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const itemKey = installed?.skillKey ?? null;
  const canToggle = installed
    ? canToggleSkill(installed, adapter.capabilities, operations)
    : false;
  const canRemove = installed
    ? canRemoveSkill(installed, adapter.capabilities, operations)
    : false;
  const issues = useSkillIssues(installed);

  return (
    <Sheet
      testID="agent-skill-detail"
      visible={installed !== null}
      title={installed?.name ?? t('Skill', { ns: 'settings' })}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      dismissOnBackdropPress={!busyKey}
      onClose={onClose}
      onAfterClose={onAfterClose}
      snapPoints={['68%', '92%']}
    >
      <BottomSheetScrollView testID="agent-skill-detail-scroll" contentContainerStyle={styles.detailContent}>
        {error ? <Banner testID="agent-skill-detail-error" tone="bad" message={error} /> : null}
        <Text testID="agent-skill-description" style={styles.detailText}>
          {installed?.description ?? ''}
        </Text>
        <SettingsGroup chrome="plain">
          {installed ? (
            <>
              <SettingsRow style={styles.detailRow}
                title={t('Enabled', { ns: 'settings' })}
                trailing={canToggle ? <SkillSwitch skill={installed} testID="agent-skill-toggle" disabled={!online || Boolean(busyKey)} busy={busyKey === itemKey} onToggle={onToggle} /> : undefined}
                value={canToggle ? undefined : installed.always ? t('Always on', { ns: 'settings' }) : t(installed.disabled ? 'Disabled' : 'Enabled', { ns: 'settings' })}
              />
              <SettingsDivider inset="none" />
              <SettingsRow style={styles.detailRow}
                title={t('Status', { ns: 'settings' })}
                value={issues.length ? t('Unavailable', { ns: 'settings' }) : translateSkillAvailability(skillAvailability(installed), t)}
              />
              <SettingsDivider inset="none" />
              <SettingsRow style={styles.detailRow} title={t('Source', { ns: 'settings' })}
                value={installed.source === 'clawhub' ? t('ClawHub')
                  : installed.source === 'managed' || installed.source === 'workspace' ? t('Local', { ns: 'config' }) : installed.source} />
              {adapter.capabilities.skills && operations?.get && onSource ? <>
                <SettingsDivider inset="none" />
                <SettingsRow style={styles.detailRow} testID="agent-skill-source" title="SKILL.md" showChevron disabled={!online || Boolean(busyKey)} onPress={() => onSource(installed)} />
              </> : null}
            </>
          ) : null}
        </SettingsGroup>
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
      gap: Space.lg,
    },
    detailRow: { minHeight: ControlSize.settingsRowComfortable },
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
