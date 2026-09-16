import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, AgentDescriptor, CronJob, CronRunLogEntry, HeartbeatSettings } from '@clawket/agent-protocol';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { SettingsDivider, SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import { describeScheduleHuman, formatDurationMs } from '../../utils/cron';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Space } from '../../theme/tokens';
import { cronRunStatus, filterAgentCronRuns } from './cron-model';
import { formatCronDate } from './cron-schedule';
import { useCronJobs } from './useCronJobs';

export type CronSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  refreshKey?: number;
  onCreate: () => void;
  onEdit: (jobId: string) => void;
}>;

export function CronSection(props: CronSectionProps): React.JSX.Element {
  const identity = useRef({ adapter: props.adapter, revision: 0 });
  if (identity.current.adapter !== props.adapter) identity.current = { adapter: props.adapter, revision: identity.current.revision + 1 };
  return <CronSectionContent key={`${identity.current.revision}:${props.agent.connectionId}:${props.agent.agentId}`} {...props} />;
}

function CronSectionContent({ adapter, agent, online, refreshKey, onCreate, onEdit }: CronSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.cron;
  const { jobs, loading, error: loadError, reload, accept, invalidate, isCurrent } = useCronJobs(adapter, agent, online, refreshKey);
  const [view, setView] = useState<'jobs' | 'runs'>('jobs');
  const [runs, setRuns] = useState<ReadonlyArray<CronRunLogEntry>>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [heartbeat, setHeartbeat] = useState<HeartbeatSettings | null>(null);
  const [heartbeatVisible, setHeartbeatVisible] = useState(false);
  const [selectedRun, setSelectedRun] = useState<CronRunLogEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const runRequest = useRef(0);
  const canCreate = adapter.capabilities.cronCreate && Boolean(operations?.add);
  const canShowHeartbeat = adapter.capabilities.heartbeat && Boolean(operations?.heartbeat?.get);
  const loadRuns = useCallback(async (offset = 0) => {
    if (!online || !operations?.runs || !isCurrent()) return;
    const request = ++runRequest.current;
    setRunsLoading(true);
    try {
      const page = await operations.runs({ scope: 'all', limit: 100, offset, sortDir: 'desc' });
      if (!isCurrent() || request !== runRequest.current) return;
      setRuns(current => offset ? [...current, ...page.entries] : page.entries);
      setNextOffset(page.hasMore ? page.nextOffset : null);
      setError(null);
    } catch (reason) {
      if (isCurrent() && request === runRequest.current) setError(errorMessage(reason, t('Failed to load scheduled tasks', { ns: 'settings' })));
    } finally {
      if (isCurrent() && request === runRequest.current) setRunsLoading(false);
    }
  }, [isCurrent, online, operations, t]);
  useEffect(() => { if (view === 'runs') void loadRuns(); }, [loadRuns, refreshKey, view]);
  useEffect(() => {
    if (!online || !canShowHeartbeat) return;
    let active = true;
    void operations?.heartbeat?.get().then(value => {
      if (active && isCurrent()) setHeartbeat(value);
    }).catch(reason => {
      if (active && isCurrent()) setError(errorMessage(reason, t('Failed to load scheduled tasks', { ns: 'settings' })));
    });
    return () => { active = false; };
  }, [canShowHeartbeat, isCurrent, online, operations, refreshKey, t]);
  const toggle = async (job: CronJob) => {
    if (!online || busyRef.current || !operations?.update) return;
    busyRef.current = true;
    invalidate();
    setBusy(job.id);
    setError(null);
    try {
      const updated = await operations.update(job.id, { enabled: !job.enabled });
      if (!isCurrent()) return;
      accept(updated);
      await reload();
    } catch (reason) {
      if (isCurrent()) setError(errorMessage(reason, t('Failed to save scheduled task', { ns: 'settings' })));
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy(null); }
    }
  };
  const saveHeartbeat = async (settings: HeartbeatSettings) => {
    if (!online || busyRef.current || !canShowHeartbeat || !operations?.heartbeat?.set) return;
    busyRef.current = true;
    setBusy('heartbeat');
    try {
      await operations.heartbeat.set(settings);
      if (!isCurrent()) return;
      setHeartbeat(settings);
      setHeartbeatVisible(false);
    } catch (reason) {
      if (isCurrent()) setError(errorMessage(reason, t('Failed to save scheduled task', { ns: 'settings' })));
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy(null); }
    }
  };
  const message = error ?? (loadError ? errorMessage(loadError, t('Failed to load scheduled tasks', { ns: 'settings' })) : null);
  const visibleRuns = filterAgentCronRuns(runs, jobs ?? []);
  if (jobs === null && !message && online) return <CronLoading />;
  return <>
    <View testID="agent-cron-section" style={styles.root}>
      {operations?.runs ? <SegmentedTabs testID="agent-cron-tabs" tabs={[
        { key: 'jobs', label: t('Jobs', { ns: 'settings' }) }, { key: 'runs', label: t('Runs', { ns: 'settings' }) },
      ]} active={view} onSwitch={setView} /> : null}
      {message ? <Banner testID="agent-cron-error" tone="bad" message={message} actionLabel={t('Retry')}
        onAction={() => { setError(null); void reload(); if (view === 'runs') void loadRuns(); }} /> : null}
      {view === 'jobs' ? <View style={styles.groups}>
        <View style={styles.actionRow}>
          <Text style={[styles.fieldLabel, styles.actionButton]}>{t('{{total}} tasks · {{enabled}} enabled', { ns: 'settings', total: jobs?.length ?? 0, enabled: jobs?.filter(job => job.enabled).length ?? 0 })}</Text>
          <Button label={t('Refresh')} variant="ghost" size="sm" disabled={!online || loading || Boolean(busy)} onPress={() => { void reload(); }} />
        </View>
        <View testID="agent-cron-job-list">{jobs?.map(job => <View key={job.id} style={rowStyles.row}>
          <Pressable testID={`agent-cron-job-${job.id}`} accessibilityRole="button" accessibilityLabel={job.name}
            style={rowStyles.content} onPress={() => onEdit(job.id)}>
            <View style={rowStyles.titleRow}><Text style={[styles.runText, rowStyles.title]}>{job.name}</Text><ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} /></View>
            <Text style={styles.fieldLabel}>{describeScheduleHuman(job.schedule, t)}</Text>
            <Text style={styles.fieldLabel}>{job.enabled
              ? `${t('Next run', { ns: 'settings' })} · ${formatCronDate(job.state.nextRunAtMs, i18n?.resolvedLanguage)}`
              : t('Paused', { ns: 'settings' })}</Text>
            {job.state.runningAtMs ? <Text style={styles.fieldLabel}>{t('Running', { ns: 'settings' })}</Text>
              : (job.state.lastRunStatus ?? job.state.lastStatus) === 'error' ? <Text numberOfLines={2} style={[styles.fieldLabel, { color: theme.colors.bad }]}>
                {t('Failed', { ns: 'settings' })}{job.state.lastError ? ` · ${job.state.lastError}` : ''}
              </Text> : null}
          </Pressable>
          {operations?.update ? <View style={rowStyles.switchTarget}><ThemedSwitch testID={`agent-cron-switch-${job.id}`}
            value={job.enabled} disabled={!online || Boolean(busy)} accessibilityLabel={`${t('Enabled', { ns: 'settings' })}: ${job.name}`}
            accessibilityState={{ disabled: !online || Boolean(busy), busy: busy === job.id }} onValueChange={() => { void toggle(job); }} /></View> : null}
        </View>)}</View>
        {jobs?.length === 0 ? <View><Text testID="agent-cron-empty" style={styles.emptyText}>{t('No cron jobs configured', { ns: 'settings' })}</Text>
          {canCreate ? <Button testID="agent-cron-create" label={t('New cron job', { ns: 'config' })} disabled={!online} onPress={onCreate} /> : null}</View> : null}
        {canShowHeartbeat ? <SettingsRow testID="agent-cron-heartbeat" title={t('Heartbeat', { ns: 'settings' })} value={heartbeat?.every} showChevron onPress={() => setHeartbeatVisible(true)} /> : null}
      </View> : <View>
        {runsLoading && !runs.length ? <CronLoading /> : null}
        {visibleRuns.map((run, index) => <SettingsRow key={`${run.jobId}:${run.ts}:${index}`} testID={`agent-cron-run-${run.jobId}-${run.ts}`}
          title={run.jobName ?? jobs?.find(job => job.id === run.jobId)?.name ?? run.jobId}
          subtitle={formatTimestamp(run.runAtMs ?? run.ts)} value={translateCronRunStatus(cronRunStatus(run), t)}
          attention={run.status === 'error'} showChevron onPress={() => setSelectedRun(run)} />)}
        {!runsLoading && !visibleRuns.length ? <Text testID="agent-cron-runs-empty" style={styles.emptyText}>{t('No runs yet', { ns: 'settings' })}</Text> : null}
        {nextOffset !== null ? <Button testID="cron-runs-more" label={t('Load more', { ns: 'settings' })} variant="ghost" loading={runsLoading} disabled={!online}
          onPress={() => { if (!runsLoading) void loadRuns(nextOffset); }} /> : null}
      </View>}
    </View>
    <HeartbeatSheet visible={heartbeatVisible} settings={heartbeat} online={online} saving={busy === 'heartbeat'}
      canSave={canShowHeartbeat && Boolean(operations?.heartbeat?.set)} onClose={() => { if (!busy) setHeartbeatVisible(false); }} onSave={settings => { void saveHeartbeat(settings); }} />
    <CronRunSheet run={selectedRun} onClose={() => setSelectedRun(null)} />
  </>;
}

function translateCronRunStatus(status: ReturnType<typeof cronRunStatus>, t: ReturnType<typeof useTranslation>['t']): string {
  if (status === 'Succeeded') return t('Succeeded', { ns: 'settings' });
  if (status === 'Failed') return t('Failed', { ns: 'settings' });
  if (status === 'Skipped') return t('Skipped', { ns: 'settings' });
  return t('Unknown', { ns: 'common' });
}
const rowStyles = StyleSheet.create({
  row: { minHeight: ControlSize.rosterRow, paddingVertical: Space.lg, flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  content: { flex: 1, gap: Space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  title: { flexShrink: 1, fontWeight: FontWeight.semibold },
  switchTarget: { minHeight: ControlSize.floatingButton, justifyContent: 'center' },
});

function HeartbeatSheet({
  visible,
  settings,
  online,
  saving,
  canSave,
  onClose,
  onSave,
}: Readonly<{
  visible: boolean;
  settings: HeartbeatSettings | null;
  online: boolean;
  saving: boolean;
  canSave: boolean;
  onClose: () => void;
  onSave: (settings: HeartbeatSettings) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [draft, setDraft] = useState<HeartbeatSettings>(() => heartbeatDraft(settings));
  useEffect(() => setDraft(heartbeatDraft(settings)), [settings, visible]);
  const update = (key: keyof HeartbeatSettings, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <Sheet
      testID="agent-cron-heartbeat-editor"
      visible={visible}
      title={t('Heartbeat', { ns: 'settings' })}
      closeAccessibilityLabel={t('Cancel', { ns: 'common' })}
      dismissOnBackdropPress={!saving}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
        <FormField
          testID="agent-heartbeat-every"
          label={t('Every', { ns: 'settings' })}
          value={draft.every}
          onChangeText={(value) => update('every', value)}
        />
        <View style={styles.actionRow}>
          <FormField
            testID="agent-heartbeat-start"
            label={t('Active Start', { ns: 'settings' })}
            value={draft.activeStart}
            onChangeText={(value) => update('activeStart', value)}
            style={styles.actionButton}
          />
          <FormField
            testID="agent-heartbeat-end"
            label={t('Active End', { ns: 'settings' })}
            value={draft.activeEnd}
            onChangeText={(value) => update('activeEnd', value)}
            style={styles.actionButton}
          />
        </View>
        <FormField
          testID="agent-heartbeat-timezone"
          label={t('Timezone', { ns: 'settings' })}
          value={draft.activeTimezone}
          onChangeText={(value) => update('activeTimezone', value)}
        />
        <FormField
          testID="agent-heartbeat-session"
          label={t('Session', { ns: 'settings' })}
          value={draft.session}
          onChangeText={(value) => update('session', value)}
        />
        <FormField
          testID="agent-heartbeat-model"
          label={t('Model', { ns: 'settings' })}
          value={draft.model}
          onChangeText={(value) => update('model', value)}
        />
        {canSave ? (
          <Button
            testID="agent-heartbeat-save"
            label={t('Save', { ns: 'common' })}
            disabled={!online}
            loading={saving}
            onPress={() => onSave(draft)}
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

export function CronRunSheet({
  run,
  onClose,
}: Readonly<{
  run: CronRunLogEntry | null;
  onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <Sheet
      testID="agent-cron-run-detail"
      visible={run !== null}
      title={t('Execution Record', { ns: 'settings' })}
      maxHeight="85%"
      contentStyle={styles.runScroll}
      closeAccessibilityLabel={t('Back', { ns: 'common' })}
      onClose={onClose}
    >
      {run ? (
        <ScrollView style={styles.runScroll} contentContainerStyle={styles.sheetContent}>
          <SettingsGroup>
            <SettingsRow
              title={run.jobName ?? run.jobId}
              subtitle={formatTimestamp(run.runAtMs ?? run.ts)}
              value={translateCronRunStatus(cronRunStatus(run), t)}
            />
            <SettingsDivider inset="content" />
            <SettingsRow
              title={t('Duration', { ns: 'settings' })}
              value={formatDurationMs(run.durationMs)}
            />
            <SettingsDivider inset="content" />
            <SettingsRow
              title={t('Notifications', { ns: 'settings' })}
              value={run.deliveryStatus === 'delivered' || run.delivered === true ? t('Delivered', { ns: 'settings' })
                : run.deliveryStatus === 'not-delivered' || run.delivered === false ? t('Not delivered', { ns: 'settings' })
                : run.deliveryStatus === 'not-requested' ? t('Not requested', { ns: 'settings' }) : t('Unknown', { ns: 'common' })}
            />
            {run.model ? (
              <>
                <SettingsDivider inset="content" />
                <SettingsRow title={t('Model', { ns: 'settings' })} value={run.model} />
              </>
            ) : null}
          </SettingsGroup>
          {run.error || run.summary ? (
            <Text selectable style={styles.runText}>{run.error ?? run.summary}</Text>
          ) : null}
          {run.deliveryError ? <Text selectable style={styles.runText}>{run.deliveryError}</Text> : null}
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

function FormField({
  testID,
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  style,
}: Readonly<{
  testID: string;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  style?: object;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <FormTextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        minHeight={multiline ? ControlSize.settingsRow * 3 : undefined}
      />
    </View>
  );
}

function CronLoading(): React.JSX.Element {
  return (
    <View testID="agent-cron-loading" style={stylesStatic.loading}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={stylesStatic.skeletonRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonValue} />
        </View>
      ))}
    </View>
  );
}

function heartbeatDraft(settings: HeartbeatSettings | null): HeartbeatSettings {
  return settings ?? {
    every: '',
    activeStart: '',
    activeEnd: '',
    activeTimezone: '',
    session: '',
    model: '',
  };
}

function formatTimestamp(value?: number): string {
  if (!value || !Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString();
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
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    sheetContent: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xxl,
      gap: Space.xl,
    },
    confirmContent: {
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
    runScroll: { flexShrink: 1 },
    runText: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
    actionRow: {
      flexDirection: 'row',
      gap: Space.md,
    },
    actionButton: { flex: 1 },
    field: { gap: Space.sm },
    fieldLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
  });
}
