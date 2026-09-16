import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MenuView } from '@react-native-menu/menu';
import { PencilLine, Play, Trash2 } from 'lucide-react-native';
import type { AgentAdapter, AgentDescriptor, CronJob, CronRunLogEntry } from '@clawket/agent-protocol';
import type { RootStackParamList } from '../../navigation/root-stack';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SettingsRow } from '../../components/ui/SettingsGroup';
import { ChoiceRow } from '../../components/ui/SetupPrimitives';
import { Skeleton } from '../../components/ui/Skeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { analyticsEvents } from '../../services/analytics/events';
import { describeScheduleHuman } from '../../utils/cron';
import { buildCronJobCreate, buildCronJobPatch, cronDraftFromJob, validateCronDraft, type CronDraft } from './cron-model';
import { deviceTimeZone, formatCronDate, scheduleDraft, scheduleFromDraft, type ScheduleDraft } from './cron-schedule';
import { CronScheduleFields, CronSchedulePreview } from './CronScheduleFields';
import { CronRunSheet } from './CronSection';
import { cronTemplates } from './cron-templates';
import { useCronJobs } from './useCronJobs';

type Props = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  jobId?: string;
  initialPrompt?: string;
  navigation: NativeStackNavigationProp<RootStackParamList, 'AgentSettingsSection'>;
}>;
type Form = { task: CronDraft; time: ScheduleDraft };
type Page = 'templates' | 'form' | 'schedule';

export function CronEditorScreen(props: Props): React.JSX.Element {
  const identity = useRef({ adapter: props.adapter, revision: 0 });
  if (identity.current.adapter !== props.adapter) identity.current = { adapter: props.adapter, revision: identity.current.revision + 1 };
  return <CronEditor key={`${identity.current.revision}:${props.agent.connectionId}:${props.agent.agentId}:${props.jobId ?? 'new'}`} {...props} />;
}

function CronEditor({ adapter, agent, online, reconnecting = false, jobId, initialPrompt, navigation }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation(['settings', 'common', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const data = useCronJobs(adapter, agent, online && Boolean(jobId));
  const [original, setOriginal] = useState<CronJob | null>(null);
  const [form, setForm] = useState<Form | null>(() => jobId ? null : {
    task: { ...cronDraftFromJob(), prompt: initialPrompt ?? '' },
    time: scheduleDraft(undefined, adapter.capabilities.cronTimeZone ? deviceTimeZone() : ''),
  });
  const originalForm = useRef(form);
  const [page, setPage] = useState<Page>(jobId || initialPrompt?.trim() ? 'form' : 'templates');
  const [more, setMore] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<'save' | 'run' | 'delete' | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<NavigationAction | 'templates' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<NavigationAction | null>(null);
  const [runs, setRuns] = useState<ReadonlyArray<CronRunLogEntry>>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runOffset, setRunOffset] = useState<number | null>(null);
  const [runsBusy, setRunsBusy] = useState(false);
  const [runRefresh, setRunRefresh] = useState(0);
  const [selectedRun, setSelectedRun] = useState<CronRunLogEntry | null>(null);
  const runRequest = useRef(0);
  const operations = adapter.management?.cron;
  const canWrite = jobId ? Boolean(operations?.update) : adapter.capabilities.cronCreate && Boolean(operations?.add);
  const locked = !online || !canWrite || Boolean(busy);
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(originalForm.current);
  const isAgentTurn = original ? original.payload.kind === 'agentTurn' : !agent.isMain;

  useEffect(() => {
    if (form || !jobId || !data.jobs) return;
    const job = data.jobs.find(candidate => candidate.id === jobId);
    if (!job) return;
    const initial = { task: cronDraftFromJob(job), time: scheduleDraft(job.schedule) };
    setOriginal(job);
    setForm(initial);
    originalForm.current = initial;
  }, [data.jobs, form, jobId]);

  usePreventRemove((dirty || Boolean(busy)) && !leaving, ({ data: removal }) => {
    if (!busyRef.current) setPendingLeave(removal.action);
  });
  useEffect(() => {
    if (!leaving) return;
    if (leaveAction.current) navigation.dispatch(leaveAction.current);
    else navigation.goBack();
  }, [leaving, navigation]);

  const loadRuns = async (offset = 0) => {
    if (!jobId || !online || !operations?.runs) return;
    const request = ++runRequest.current;
    setRunsBusy(true);
    try {
      const result = await operations.runs({ scope: 'job', id: jobId, offset, limit: 10, sortDir: 'desc' });
      if (!data.isCurrent() || runRequest.current !== request) return;
      const owned = result.entries.filter(run => run.jobId === jobId);
      setRuns(current => offset ? [...current, ...owned] : owned);
      setRunOffset(result.hasMore ? result.nextOffset : null);
      setRunsError(null);
    } catch (reason) {
      if (data.isCurrent() && runRequest.current === request) setRunsError(message(reason));
    } finally {
      if (data.isCurrent() && runRequest.current === request) setRunsBusy(false);
    }
  };
  useEffect(() => {
    // Records load independently: a history failure must never hide the editor.
    void loadRuns();
    return () => { runRequest.current++; };
    // A draft edit must not refetch the history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, jobId, online, runRefresh]);

  function message(reason: unknown): string {
    return reason instanceof Error ? reason.message : t('Failed to save scheduled task');
  }
  const patch = (task: Partial<CronDraft>) => setForm(current => current ? { ...current, task: { ...current.task, ...task } } : current);
  const changeTime = (time: ScheduleDraft) => setForm(current => current ? { ...current, time } : current);
  const chooseTemplate = (id: string) => {
    if (!form) return;
    const template = cronTemplates(t).find(item => item.id === id);
    const next: Form = template ? {
      task: { ...form.task, name: template.name, prompt: template.prompt },
      time: { ...scheduleDraft(undefined, form.time.timezone), ...template.schedule },
    } : form;
    setForm(next);
    originalForm.current = next;
    setError(null);
    setPage('form');
  };
  const save = async () => {
    if (!form || locked || busyRef.current) return;
    const draft = { ...form.task, schedule: scheduleFromDraft(form.time) };
    const invalid = validateCronDraft(draft, Date.now(), original);
    if (!adapter.capabilities.cronAdvanced && draft.schedule.kind === 'every' && draft.schedule.everyMs % 60_000 !== 0
      && JSON.stringify(draft.schedule) !== JSON.stringify(original?.schedule)) {
      setError(t('Invalid schedule.'));
      return;
    }
    if (invalid) {
      if (invalid === 'Task name is required.') setError(t('Task name is required.'));
      else if (invalid === 'Prompt is required.') setError(t('Prompt is required.'));
      else if (invalid === 'Choose a future date.') setError(t('Choose a future date.'));
      else setError(t('Invalid schedule.'));
      return;
    }
    if (draft.delivery?.mode === 'webhook' && (!original || JSON.stringify(draft.delivery) !== JSON.stringify(original.delivery))) {
      try {
        const url = new URL(draft.delivery.to ?? '');
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
      } catch { setError(t('Enter a valid webhook URL.')); return; }
    }
    busyRef.current = true;
    setBusy('save');
    setError(null);
    data.invalidate();
    try {
      const saved = original
        ? await operations!.update!(original.id, buildCronJobPatch(draft, original))
        : await operations!.add!(buildCronJobCreate(draft, agent));
      if (!data.isCurrent()) return;
      data.accept(saved);
      analyticsEvents.cronSaveSucceeded({ is_editing: Boolean(original), payload_kind: saved.payload.kind,
        schedule_kind: saved.schedule.kind, has_model_override: saved.payload.kind === 'agentTurn' && Boolean(saved.payload.model),
        delivery_mode: saved.delivery?.mode ?? 'none', source: 'guided_editor' });
      setLeaving(true);
    } catch (reason) {
      if (data.isCurrent()) setError(message(reason));
    } finally {
      if (data.isCurrent()) { busyRef.current = false; setBusy(null); }
    }
  };
  const runNow = async () => {
    if (!original || !online || busyRef.current || !operations?.run) return;
    busyRef.current = true;
    setBusy('run');
    setError(null);
    try {
      await operations.run(original.id, 'force');
      if (!data.isCurrent()) return;
      setNotice(t('Run requested. Check the run history.'));
      setRunRefresh(value => value + 1);
    } catch (reason) {
      if (data.isCurrent()) setError(message(reason));
    } finally {
      if (data.isCurrent()) { busyRef.current = false; setBusy(null); }
    }
  };
  const remove = async () => {
    if (!original || !online || busyRef.current || !operations?.remove) return;
    busyRef.current = true;
    setConfirmDelete(false);
    setBusy('delete');
    try {
      const result = await operations.remove(original.id);
      if (!data.isCurrent()) return;
      if (!result.ok) throw new Error(t('Failed to save scheduled task'));
      data.remove(original.id);
      setLeaving(true);
    } catch (reason) {
      if (data.isCurrent()) setError(message(reason));
    } finally {
      if (data.isCurrent()) { busyRef.current = false; setBusy(null); }
    }
  };
  const back = () => {
    if (busyRef.current) return;
    if (page === 'schedule') setPage('form');
    else if (!jobId && page === 'form' && !initialPrompt?.trim()) {
      if (dirty) setPendingLeave('templates');
      else setPage('templates');
    } else if (dirty) setPendingLeave({ type: 'GO_BACK' });
    else navigation.goBack();
  };
  const title = page === 'schedule' ? t('Schedule') : jobId ? t('Edit Task') : t('New cron job', { ns: 'config' });
  return <View testID="agent-cron-editor" style={styles.screen}>
    <ScreenHeader title={title} topInset={insets.top} onBack={back}
      status={!online && reconnecting ? <ConnectionStatusPill placement="inline" status="reconnecting" message={t('Reconnecting…', { ns: 'common' })} />
        : !online ? <ConnectionStatusPill testID="agent-cron-editor-offline" placement="inline" status="offline" message={t('Offline · reconnecting')} /> : undefined}
      rightContent={page === 'schedule'
      ? <Button testID="cron-schedule-done" label={t('Done', { ns: 'common' })} variant="ghost" onPress={() => setPage('form')} />
      : jobId && form && canWrite ? <Button testID="agent-cron-save" label={t('Save', { ns: 'common' })} variant="ghost" loading={busy === 'save'} disabled={locked} onPress={() => { void save(); }} /> : undefined} />
    <KeyboardAwareScrollView testID="cron-editor-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
      {error ? <Banner testID="agent-cron-editor-error" tone="bad" message={error} /> : null}
      {notice ? <Banner message={notice} /> : null}
      {!form ? data.loading || (!data.jobs && !data.error && online) ? <Skeleton testID="cron-editor-loading" style={styles.loading} />
        : <Banner message={data.error ? message(data.error) : t('Failed to load scheduled task')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => { void data.reload(); }} />
        : !canWrite && !jobId ? <Banner message={t('Unavailable')} />
        : page === 'templates' ? <>
          <Text style={styles.secondary}>{t('1 Choose a starting point')}</Text>
          <Text accessibilityRole="header" style={styles.heading}>{t('What should the Agent do?')}</Text>
          <Text style={styles.secondary}>{t('Choose a template, then adjust the task.')}</Text>
          <ChoiceRow testID="cron-template-custom" icon={PencilLine} title={t('Custom task')}
            description={t('Describe what you want in your own words.')} onPress={() => chooseTemplate('custom')} />
          {cronTemplates(t).slice(0, more ? 8 : 4).map(template => <ChoiceRow key={template.id}
            testID={`cron-template-${template.id}`} icon={template.icon} title={template.name} description={template.prompt} onPress={() => chooseTemplate(template.id)} />)}
          <Button testID="cron-templates-more" label={more ? t('Show less') : t('More templates')} variant="ghost" onPress={() => setMore(value => !value)} />
        </> : page === 'schedule' ? <>
          <CronScheduleFields draft={form.time} onChange={changeTime} editableTimeZone={Boolean(adapter.capabilities.cronTimeZone)} disabled={locked} />
          <CronSchedulePreview draft={form.time} />
        </> : <>
          {!jobId && !initialPrompt?.trim() ? <Text style={styles.secondary}>{t('2 Configure the task')}</Text> : null}
          <View style={styles.field}><Text style={styles.secondary}>{t('Task name')}</Text>
            <FormTextInput testID="agent-cron-name" accessibilityLabel={t('Task name')} value={form.task.name} editable={!locked} onChangeText={name => patch({ name })} />
          </View>
          <View style={styles.field}><Text style={styles.secondary}>{t('What should the Agent do?')}</Text>
            <FormTextInput testID="agent-cron-prompt" accessibilityLabel={t('Task prompt')} value={form.task.prompt} multiline
              minHeight={ControlSize.rosterRow} editable={!locked} onChangeText={prompt => patch({ prompt })} />
          </View>
          <Text accessibilityRole="header" style={styles.heading}>{t('When should it run?')}</Text>
          {jobId ? <SettingsRow testID="cron-edit-schedule" title={describeScheduleHuman(scheduleFromDraft(form.time), t)}
            subtitle={form.time.timezone || t('Agent timezone')} disabled={locked} showChevron onPress={() => setPage('schedule')} />
            : <CronScheduleFields draft={form.time} onChange={changeTime} editableTimeZone={Boolean(adapter.capabilities.cronTimeZone)} disabled={locked} />}
          <CronSchedulePreview draft={form.time} />
          {jobId || adapter.capabilities.cronAdvanced ? <SettingsRow title={t('Enabled')} trailing={<ThemedSwitch testID="agent-cron-enabled" accessibilityLabel={t('Enabled')} value={form.task.enabled} disabled={locked} onValueChange={enabled => patch({ enabled })} />} /> : null}
          <SettingsRow testID="cron-advanced" title={t('Advanced settings')} showChevron onPress={() => setAdvanced(value => !value)} />
          {advanced ? <View style={styles.field}>
            {form.time.frequency !== 'custom' ? <Button testID="cron-use-expression" label={t('Use Cron expression')} variant="ghost" disabled={locked}
              onPress={() => {
                const schedule = scheduleFromDraft(form.time);
                changeTime({ ...form.time, frequency: 'custom', expression: schedule.kind === 'cron' ? schedule.expr : '' });
                if (jobId) setPage('schedule');
              }} /> : null}
            {adapter.capabilities.cronAdvanced ? <>
              <Text style={styles.secondary}>{t('Description')}</Text>
              <FormTextInput testID="cron-description" accessibilityLabel={t('Description')} value={form.task.description ?? ''} editable={!locked} onChangeText={description => patch({ description })} />
              {isAgentTurn ? <>
                <Text style={styles.secondary}>{t('Model')}</Text>
                <FormTextInput testID="cron-model" accessibilityLabel={t('Model')} value={form.task.model ?? ''} editable={!locked}
                  autoCapitalize="none" onChangeText={model => patch({ model })} />
                <MenuView themeVariant={theme.scheme} actions={[
                  { id: 'none', title: t('Run history only') }, { id: 'announce', title: t('Send to channel') }, { id: 'webhook', title: 'Webhook' },
                ]} onPressAction={({ nativeEvent }) => {
                  if (!locked && ['none', 'announce', 'webhook'].includes(nativeEvent.event)) patch({ delivery: { ...form.task.delivery, mode: nativeEvent.event as 'none' | 'announce' | 'webhook' } });
                }}><SettingsRow testID="cron-delivery" title={t('Notifications')} disabled={locked} showChevron value={form.task.delivery?.mode === 'announce' ? t('Send to channel') : form.task.delivery?.mode === 'webhook' ? 'Webhook' : t('Run history only')} /></MenuView>
                {form.task.delivery?.mode === 'announce' ? <FormTextInput testID="cron-channel" accessibilityLabel={t('Channel')} placeholder={t('Channel')} value={form.task.delivery.channel ?? ''}
                  editable={!locked} onChangeText={channel => patch({ delivery: { ...form.task.delivery!, channel } })} /> : null}
                {form.task.delivery && form.task.delivery.mode !== 'none' ? <FormTextInput testID="cron-delivery-target" accessibilityLabel={t('Destination')} placeholder={t('Destination')} value={form.task.delivery.to ?? ''}
                  editable={!locked} autoCapitalize="none" onChangeText={to => patch({ delivery: { ...form.task.delivery!, to } })} /> : null}
              </> : null}
            </> : null}
            <Text style={styles.secondary}>{!form.task.delivery || form.task.delivery.mode === 'none' ? t('Results are available in run history.') : t('Existing delivery settings are preserved.')}</Text>
            {original?.payload.kind === 'agentTurn' && original.payload.timeoutSeconds != null ? <SettingsRow title={t('Timeout')} value={String(original.payload.timeoutSeconds)} /> : null}
          </View> : null}
          {!jobId && canWrite ? <Button testID="agent-cron-save" label={t('Create Task')} disabled={locked} loading={busy === 'save'} onPress={() => { void save(); }} /> : null}
          {jobId ? <>
            <SettingsRow title={t('Last run')} value={formatCronDate(original?.state.lastRunAtMs, i18n?.resolvedLanguage)} />
            <SettingsRow title={t('Next run')} value={original?.enabled ? formatCronDate(original.state.nextRunAtMs, i18n?.resolvedLanguage) : t('Paused')} />
            {operations?.runs ? <>
              <View style={styles.actions}><Text accessibilityRole="header" style={[styles.heading, styles.flex]}>{t('Runs')}</Text>
                <Button testID="cron-refresh-runs" label={t('Refresh', { ns: 'common' })} variant="ghost" disabled={!online || runsBusy} onPress={() => setRunRefresh(value => value + 1)} />
              </View>
              {runsError ? <Banner message={runsError} actionLabel={t('Retry', { ns: 'common' })} onAction={() => setRunRefresh(value => value + 1)} /> : null}
              {!runs.length && !runsBusy && !runsError ? <Text style={styles.secondary}>{t('No runs yet')}</Text> : null}
              {runs.map((run, index) => <SettingsRow key={`${run.ts}:${index}`} testID={`cron-editor-run-${run.ts}`}
                title={formatCronDate(run.runAtMs ?? run.ts, i18n?.resolvedLanguage)} subtitle={run.error ?? run.summary}
                value={run.status === 'ok' ? t('Succeeded') : run.status === 'error' ? t('Failed') : run.status === 'skipped' ? t('Skipped') : t('Unknown', { ns: 'common' })}
                attention={run.status === 'error'} showChevron onPress={() => setSelectedRun(run)} />)}
              {runOffset !== null ? <Button label={t('Load more')} variant="ghost" disabled={!online || runsBusy} onPress={() => { void loadRuns(runOffset); }} /> : null}
            </> : null}
            <View style={styles.actions}>
              {operations?.run ? <Button testID="agent-cron-run" icon={Play} label={t('Run now')} variant="secondary" disabled={!online || Boolean(busy)} loading={busy === 'run'} style={styles.flex} onPress={() => { void runNow(); }} /> : null}
              {operations?.remove ? <Button testID="agent-cron-delete" icon={Trash2} label={t('Delete', { ns: 'common' })} variant="destructive" disabled={!online || Boolean(busy)} loading={busy === 'delete'} style={styles.flex} onPress={() => setConfirmDelete(true)} /> : null}
            </View>
          </> : null}
        </>}
    </KeyboardAwareScrollView>
    <CronRunSheet run={selectedRun} onClose={() => setSelectedRun(null)} />
    <ConfirmationModal testID="agent-cron-delete-confirm" visible={confirmDelete} title={t('Delete Task')} message={t('Delete this scheduled task?')}
      confirmLabel={t('Delete', { ns: 'common' })} cancelLabel={t('Cancel', { ns: 'common' })} destructive onClose={() => setConfirmDelete(false)} onConfirm={() => { void remove(); }} />
    <ConfirmationModal testID="cron-discard" visible={pendingLeave !== null} title={t('Discard changes?')} message={t('Unsaved changes will be lost.')}
      confirmLabel={t('Discard')} cancelLabel={t('Keep editing')} destructive onClose={() => setPendingLeave(null)} onConfirm={() => {
        if (pendingLeave === 'templates') {
          setForm(originalForm.current);
          setPage('templates');
          setPendingLeave(null);
        } else {
          leaveAction.current = pendingLeave;
          setPendingLeave(null);
          setLeaving(true);
        }
      }} />
  </View>;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    content: { paddingHorizontal: Space.lg, paddingTop: Space.lg, gap: Space.lg },
    field: { gap: Space.sm },
    heading: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
    secondary: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    actions: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
    flex: { flex: 1 },
    loading: { height: ControlSize.rosterRow },
  });
}
