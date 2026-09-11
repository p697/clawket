import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  AgentDescriptor,
  CronJob,
  CronRunLogEntry,
  HeartbeatSettings,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import { formatDurationMs } from '../../utils/cron';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  buildCronJobCreate,
  buildCronJobPatch,
  cronDraftFromJob,
  cronJobStatus,
  cronRunStatus,
  filterAgentCronRuns,
  formatCronSchedule,
  loadAgentCronJobs,
  validateCronDraft,
  type CronDraft,
} from './cron-model';

type CronView = 'jobs' | 'runs';
type EditorSelection = 'new' | CronJob | null;
type BusyAction = 'save' | 'run' | 'toggle' | 'delete' | 'heartbeat' | null;

export type CronSectionProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  /** Opens the create editor once after mount (Thread Add sheet → Schedule a task). */
  openCreateOnMount?: boolean;
  /** Seeds the create editor's prompt with the Thread draft. */
  initialPrompt?: string;
}>;

function translateCronDraftError(
  error: ReturnType<typeof validateCronDraft>,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (error === 'Task name is required.') return t('Task name is required.', { ns: 'settings' });
  if (error === 'Schedule is required.') return t('Schedule is required.', { ns: 'settings' });
  if (error === 'Prompt is required.') return t('Prompt is required.', { ns: 'settings' });
  return null;
}

function translateCronJobStatus(
  status: ReturnType<typeof cronJobStatus>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (status === 'Failed') return t('Failed', { ns: 'settings' });
  if (status === 'Running') return t('Running', { ns: 'settings' });
  if (status === 'Enabled') return t('Enabled', { ns: 'settings' });
  return t('Disabled', { ns: 'settings' });
}

function translateCronRunStatus(
  status: ReturnType<typeof cronRunStatus>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (status === 'Succeeded') return t('Succeeded', { ns: 'settings' });
  if (status === 'Failed') return t('Failed', { ns: 'settings' });
  return t('Skipped', { ns: 'settings' });
}

export function CronSection({
  adapter,
  agent,
  online,
  openCreateOnMount = false,
  initialPrompt,
}: CronSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.cron;
  const canCreate = adapter.capabilities.cronCreate && Boolean(operations?.add);
  const canShowRuns = Boolean(operations?.runs);
  const canShowHeartbeat = adapter.capabilities.heartbeat && Boolean(operations?.heartbeat?.get);
  const [view, setView] = useState<CronView>('jobs');
  const [jobs, setJobs] = useState<ReadonlyArray<CronJob> | null>(null);
  const [runs, setRuns] = useState<ReadonlyArray<CronRunLogEntry>>([]);
  const [heartbeat, setHeartbeat] = useState<HeartbeatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const [selectedRun, setSelectedRun] = useState<CronRunLogEntry | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelection>(null);
  const [heartbeatVisible, setHeartbeatVisible] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<CronJob | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  // The Thread draft seeds only the editor opened on arrival; later "New cron
  // job" taps start blank.
  const [seedPrompt, setSeedPrompt] = useState<string | undefined>(undefined);
  const handledOpenCreateRef = useRef(false);

  useEffect(() => {
    if (!openCreateOnMount || !canCreate || handledOpenCreateRef.current) return;
    handledOpenCreateRef.current = true;
    setSeedPrompt(initialPrompt);
    setEditorSelection('new');
  }, [canCreate, initialPrompt, openCreateOnMount]);

  const closeEditor = useCallback(() => {
    setEditorSelection(null);
    setSeedPrompt(undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextJobs = await loadAgentCronJobs(operations, agent);
      const [runPage, nextHeartbeat] = await Promise.all([
        operations?.runs
          ? operations.runs({ scope: 'all', limit: 100, sortDir: 'desc' })
          : Promise.resolve(null),
        canShowHeartbeat && operations?.heartbeat?.get
          ? operations.heartbeat.get()
          : Promise.resolve(null),
      ]);
      setJobs(nextJobs);
      setRuns(filterAgentCronRuns(runPage?.entries ?? [], nextJobs));
      setHeartbeat(nextHeartbeat);
      setError(null);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, t('Failed to load scheduled tasks', { ns: 'settings' })));
      setJobs((current) => current ?? []);
    } finally {
      setLoading(false);
    }
  }, [agent, canShowHeartbeat, operations, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canShowRuns && view === 'runs') setView('jobs');
  }, [canShowRuns, view]);

  const tabs = useMemo(() => [
    { key: 'jobs' as const, label: t('Jobs', { ns: 'settings' }) },
    ...(canShowRuns
      ? [{ key: 'runs' as const, label: t('Runs', { ns: 'settings' }) }]
      : []),
  ], [canShowRuns, t]);

  const saveJob = useCallback(async (draft: CronDraft, job: CronJob | null) => {
    if (!online || busyAction) return;
    const validationError = validateCronDraft(draft);
    if (validationError) throw new Error(translateCronDraftError(validationError, t) ?? validationError);
    setBusyAction('save');
    try {
      if (job) {
        if (!operations?.update) return;
        await operations.update(job.id, buildCronJobPatch(draft, job));
      } else {
        if (!canCreate || !operations?.add) return;
        await operations.add(buildCronJobCreate(draft, agent));
      }
      closeEditor();
      setSelectedJob(null);
      await load();
    } finally {
      setBusyAction(null);
    }
  }, [agent, busyAction, canCreate, closeEditor, load, online, operations, t]);

  const runJob = useCallback(async (job: CronJob) => {
    if (!online || busyAction || !operations?.run) return;
    setBusyAction('run');
    try {
      await operations.run(job.id, 'force');
      await load();
    } catch (runError: unknown) {
      setError(errorMessage(runError, t('Failed to load scheduled task', { ns: 'settings' })));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, load, online, operations, t]);

  const toggleJob = useCallback(async (job: CronJob) => {
    if (!online || busyAction || !operations?.update) return;
    setBusyAction('toggle');
    try {
      const updated = await operations.update(job.id, { enabled: !job.enabled });
      setSelectedJob(updated);
      await load();
    } catch (toggleError: unknown) {
      setError(errorMessage(toggleError, t('Failed to save scheduled task', { ns: 'settings' })));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, load, online, operations, t]);

  const removeJob = useCallback(async () => {
    const job = deleteCandidate;
    if (!job || !online || busyAction || !operations?.remove) return;
    setBusyAction('delete');
    try {
      await operations.remove(job.id);
      setDeleteCandidate(null);
      setSelectedJob(null);
      await load();
    } catch (removeError: unknown) {
      setError(errorMessage(removeError, t('Failed to save scheduled task', { ns: 'settings' })));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, deleteCandidate, load, online, operations, t]);

  const saveHeartbeat = useCallback(async (settings: HeartbeatSettings) => {
    if (!online || busyAction || !adapter.capabilities.heartbeat || !operations?.heartbeat?.set) return;
    setBusyAction('heartbeat');
    try {
      await operations.heartbeat.set(settings);
      setHeartbeat(settings);
      setHeartbeatVisible(false);
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, t('Failed to save scheduled task', { ns: 'settings' })));
    } finally {
      setBusyAction(null);
    }
  }, [adapter.capabilities.heartbeat, busyAction, online, operations, t]);

  if (loading && jobs === null) return <CronLoading />;

  return (
    <>
      <View testID="agent-cron-section" style={styles.root}>
        <SegmentedTabs
          testID="agent-cron-tabs"
          tabs={tabs}
          active={view}
          onSwitch={setView}
        />
        {error ? (
          <Banner
            testID="agent-cron-error"
            tone="bad"
            message={error}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : null}

        {view === 'jobs' ? (
          <View style={styles.groups}>
            {canShowHeartbeat ? (
              <SettingsGroup testID="agent-cron-heartbeat-group">
                <SettingsRow
                  testID="agent-cron-heartbeat"
                  title={t('Heartbeat', { ns: 'settings' })}
                  value={heartbeat?.every}
                  showChevron
                  onPress={() => setHeartbeatVisible(true)}
                />
              </SettingsGroup>
            ) : null}
            {(jobs?.length ?? 0) > 0 ? (
              <SettingsGroup testID="agent-cron-job-list">
                {jobs?.map((job, index) => (
                  <React.Fragment key={job.id}>
                    {index ? <SettingsDivider inset="content" /> : null}
                    <SettingsRow
                      testID={`agent-cron-job-${job.id}`}
                      title={job.name}
                      value={translateCronJobStatus(cronJobStatus(job), t)}
                      attention={(job.state.lastRunStatus ?? job.state.lastStatus) === 'error'}
                      showChevron
                      onPress={() => setSelectedJob(job)}
                    />
                  </React.Fragment>
                ))}
              </SettingsGroup>
            ) : (
              <Text testID="agent-cron-empty" style={styles.emptyText}>
                {t('No cron jobs configured', { ns: 'settings' })}
              </Text>
            )}
            {canCreate ? (
              <Button
                testID="agent-cron-create"
                label={t('New cron job', { ns: 'config' })}
                disabled={!online}
                onPress={() => setEditorSelection('new')}
              />
            ) : null}
          </View>
        ) : runs.length ? (
          <SettingsGroup testID="agent-cron-run-list">
            {runs.map((run, index) => (
              <React.Fragment key={`${run.jobId}:${run.ts}:${index}`}>
                {index ? <SettingsDivider inset="content" /> : null}
                <SettingsRow
                  testID={`agent-cron-run-${run.jobId}-${run.ts}`}
                  title={run.jobName ?? jobs?.find((job) => job.id === run.jobId)?.name ?? run.jobId}
                  subtitle={formatTimestamp(run.runAtMs ?? run.ts)}
                  value={translateCronRunStatus(cronRunStatus(run), t)}
                  attention={run.status === 'error'}
                  showChevron
                  onPress={() => setSelectedRun(run)}
                />
              </React.Fragment>
            ))}
          </SettingsGroup>
        ) : (
          <Text testID="agent-cron-runs-empty" style={styles.emptyText}>
            {t('No runs yet', { ns: 'settings' })}
          </Text>
        )}
      </View>

      <CronJobSheet
        job={deleteCandidate ? null : selectedJob}
        online={online}
        busyAction={busyAction}
        canEdit={Boolean(operations?.update)}
        canRun={Boolean(operations?.run)}
        canDelete={Boolean(operations?.remove)}
        onClose={() => setSelectedJob(null)}
        onEdit={(job) => {
          setSelectedJob(null);
          setEditorSelection(job);
        }}
        onRun={(job) => { void runJob(job); }}
        onToggle={(job) => { void toggleJob(job); }}
        onDelete={setDeleteCandidate}
      />
      <CronEditorSheet
        selection={editorSelection}
        initialPrompt={seedPrompt}
        online={online}
        saving={busyAction === 'save'}
        onClose={() => {
          if (!busyAction) closeEditor();
        }}
        onSave={saveJob}
      />
      <HeartbeatSheet
        visible={heartbeatVisible}
        settings={heartbeat}
        online={online}
        saving={busyAction === 'heartbeat'}
        canSave={adapter.capabilities.heartbeat && Boolean(operations?.heartbeat?.set)}
        onClose={() => {
          if (!busyAction) setHeartbeatVisible(false);
        }}
        onSave={(settings) => { void saveHeartbeat(settings); }}
      />
      <CronRunSheet run={selectedRun} onClose={() => setSelectedRun(null)} />
      <Sheet
        testID="agent-cron-delete-confirm"
        visible={deleteCandidate !== null}
        title={t('Delete Task', { ns: 'settings' })}
        closeAccessibilityLabel={t('Cancel', { ns: 'common' })}
        dismissOnBackdropPress={!busyAction}
        onClose={() => {
          if (!busyAction) setDeleteCandidate(null);
        }}
      >
        <View style={styles.confirmContent}>
          <Text style={styles.detailText}>
            {t('Delete this scheduled task?', { ns: 'settings' })}
          </Text>
          <View style={styles.actionRow}>
            <Button
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              disabled={Boolean(busyAction)}
              onPress={() => setDeleteCandidate(null)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-cron-delete-confirm-action"
              label={t('Delete', { ns: 'common' })}
              variant="destructive"
              loading={busyAction === 'delete'}
              onPress={() => { void removeJob(); }}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>
    </>
  );
}

function CronJobSheet({
  job,
  online,
  busyAction,
  canEdit,
  canRun,
  canDelete,
  onClose,
  onEdit,
  onRun,
  onToggle,
  onDelete,
}: Readonly<{
  job: CronJob | null;
  online: boolean;
  busyAction: BusyAction;
  canEdit: boolean;
  canRun: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (job: CronJob) => void;
  onRun: (job: CronJob) => void;
  onToggle: (job: CronJob) => void;
  onDelete: (job: CronJob) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <Sheet
      testID="agent-cron-job-detail"
      visible={job !== null}
      title={job?.name}
      closeAccessibilityLabel={t('Back', { ns: 'common' })}
      dismissOnBackdropPress={!busyAction}
      onClose={onClose}
    >
      {job ? (
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <SettingsGroup>
            <SettingsRow
              title={t('Schedule', { ns: 'settings' })}
              subtitle={formatCronSchedule(job.schedule)}
            />
            <SettingsDivider inset="content" />
            <SettingsRow
              title={t('Last run', { ns: 'settings' })}
              value={formatTimestamp(job.state.lastRunAtMs)}
            />
            <SettingsDivider inset="content" />
            <SettingsRow
              title={t('Next run', { ns: 'settings' })}
              value={formatTimestamp(job.state.nextRunAtMs)}
            />
          </SettingsGroup>
          <View style={styles.actionRow}>
            {canEdit ? (
              <Button
                testID="agent-cron-edit"
                label={t('Edit', { ns: 'common' })}
                variant="secondary"
                disabled={!online || Boolean(busyAction)}
                onPress={() => onEdit(job)}
                style={styles.actionButton}
              />
            ) : null}
            {canRun ? (
              <Button
                testID="agent-cron-run"
                label={t('Run now', { ns: 'settings' })}
                disabled={!online || Boolean(busyAction)}
                loading={busyAction === 'run'}
                onPress={() => onRun(job)}
                style={styles.actionButton}
              />
            ) : null}
          </View>
          <View style={styles.actionRow}>
            {canEdit ? (
              <Button
                testID="agent-cron-toggle"
                label={t(job.enabled ? 'Pause' : 'Resume', { ns: 'settings' })}
                variant="secondary"
                disabled={!online || Boolean(busyAction)}
                loading={busyAction === 'toggle'}
                onPress={() => onToggle(job)}
                style={styles.actionButton}
              />
            ) : null}
            {canDelete ? (
              <Button
                testID="agent-cron-delete"
                label={t('Delete', { ns: 'common' })}
                variant="destructive"
                disabled={!online || Boolean(busyAction)}
                onPress={() => onDelete(job)}
                style={styles.actionButton}
              />
            ) : null}
          </View>
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

function CronEditorSheet({
  selection,
  initialPrompt,
  online,
  saving,
  onClose,
  onSave,
}: Readonly<{
  selection: EditorSelection;
  initialPrompt?: string;
  online: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: CronDraft, job: CronJob | null) => Promise<void>;
}>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const job = selection && selection !== 'new' ? selection : null;
  const seedDraft = useCallback((): CronDraft => {
    const base = cronDraftFromJob(job);
    return !job && initialPrompt ? { ...base, prompt: initialPrompt } : base;
  }, [initialPrompt, job]);
  const [draft, setDraft] = useState<CronDraft>(seedDraft);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seedDraft());
    setError(null);
  }, [seedDraft, selection]);

  const updateDraft = <Key extends keyof CronDraft>(key: Key, value: CronDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    const validationError = validateCronDraft(draft);
    if (validationError) {
      setError(translateCronDraftError(validationError, t) ?? validationError);
      return;
    }
    setError(null);
    try {
      await onSave(draft, job);
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, t('Failed to save scheduled task', { ns: 'settings' })));
    }
  };

  return (
    <Sheet
      testID="agent-cron-editor"
      visible={selection !== null}
      title={t(job ? 'Edit Task' : 'Create Task', { ns: 'settings' })}
      closeAccessibilityLabel={t('Cancel', { ns: 'common' })}
      dismissOnBackdropPress={!saving}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
        {error ? <Banner testID="agent-cron-editor-error" tone="bad" message={error} /> : null}
        <FormField
          testID="agent-cron-name"
          label={t('Task name', { ns: 'settings' })}
          value={draft.name}
          onChangeText={(value) => updateDraft('name', value)}
        />
        <FormField
          testID="agent-cron-schedule"
          label={t('Schedule', { ns: 'settings' })}
          value={draft.schedule}
          onChangeText={(value) => updateDraft('schedule', value)}
          placeholder={t('30m / every 2h / 0 9 * * *', { ns: 'settings' })}
        />
        <FormField
          testID="agent-cron-prompt"
          label={t('Task prompt', { ns: 'settings' })}
          value={draft.prompt}
          onChangeText={(value) => updateDraft('prompt', value)}
          multiline
        />
        <SettingsGroup>
          <SettingsRow
            title={t('Enabled', { ns: 'settings' })}
            trailing={(
              <ThemedSwitch
                testID="agent-cron-enabled"
                value={draft.enabled}
                disabled={saving}
                onValueChange={(value) => updateDraft('enabled', value)}
              />
            )}
          />
        </SettingsGroup>
        <Button
          testID="agent-cron-save"
          label={t('Save', { ns: 'common' })}
          disabled={!online}
          loading={saving}
          onPress={() => { void save(); }}
        />
      </ScrollView>
    </Sheet>
  );
}

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

function CronRunSheet({
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
