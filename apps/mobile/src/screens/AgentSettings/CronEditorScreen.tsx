import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MenuView } from '@react-native-menu/menu';
import { PencilLine, Play, Trash2 } from 'lucide-react-native';
import type { AgentAdapter, AgentDescriptor, CronJob, CronRunLogEntry, ModelInfo } from '@clawket/agent-protocol';
import type { RootStackParamList } from '../../navigation/root-stack';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { RenameSheet } from '../../components/ui/RenameSheet';
import { SettingsDivider, SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { ChoiceRow } from '../../components/ui/SetupPrimitives';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { analyticsEvents } from '../../services/analytics/events';
import { describeScheduleHuman } from '../../utils/cron';
import { explicitModelReference } from '../../utils/model-catalog';
import { ModelPickerModal } from '../../components/chat/ModelPickerModal';
import { buildCronJobCreate, buildCronJobPatch, cronDraftFromJob, cronModelLabel, validateCronDraft, type CronDraft } from './cron-model';
import { deviceTimeZone, formatCronDate, scheduleDraft, scheduleFromDraft, upcomingRuns, type ScheduleDraft } from './cron-schedule';
import { CronScheduleFields, CronSchedulePreview } from './CronScheduleFields';
import { CronRunSheet } from './CronRunSheet';
import { cronTemplates } from './cron-templates';
import { useCronJobs } from './useCronJobs';
import { useCronModels } from './useCronModels';

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
/** `prompt`, `schedule` and `advanced` are edit-page sub-pages inside this route; Done returns to `form`. */
type Page = 'templates' | 'form' | 'prompt' | 'schedule' | 'advanced';
/** The edit page shows the newest runs only; Load more pages in tens. */
const RUNS_FIRST_PAGE = 3;
const RUNS_PAGE = 10;

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
  const compactImportedPrompt = (initialPrompt?.length ?? 0) > 240;
  const [page, setPage] = useState<Page>(jobId || initialPrompt?.trim() ? 'form' : 'templates');
  const [more, setMore] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState<'save' | 'run' | 'delete' | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<NavigationAction | 'templates' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<NavigationAction | null>(null);
  const createdNotice = useRef<string | null>(null);
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
  // New jobs are always isolated agent turns; only existing main-session system events lack a per-job model.
  const isAgentTurn = original ? original.payload.kind === 'agentTurn' : true;
  const showModel = Boolean(adapter.capabilities.cronModel) && form !== null && (isAgentTurn || Boolean(jobId));
  const modelOptions = useCronModels(adapter, showModel && online);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const modelValue = !isAgentTurn ? t('Follows main session')
    : form?.task.model?.trim() ? cronModelLabel(form.task.model, modelOptions.models)
      : modelOptions.defaultModel ? t('Default · {{model}}', { model: cronModelLabel(modelOptions.defaultModel, modelOptions.models) }) : t('Default');

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
    if (createdNotice.current) {
      const title = createdNotice.current;
      createdNotice.current = null;
      // Present on the previous screen after the native pop animation finishes.
      const unsubscribe = navigation.addListener('transitionEnd', event => {
        if (!event.data.closing) return;
        unsubscribe();
        Alert.alert(title);
      });
    }
    if (leaveAction.current) navigation.dispatch(leaveAction.current);
    else navigation.goBack();
  }, [leaving, navigation]);

  const loadRuns = async (offset = 0) => {
    if (!jobId || !online || !operations?.runs) return;
    const request = ++runRequest.current;
    setRunsBusy(true);
    try {
      const result = await operations.runs({ scope: 'job', id: jobId, offset, limit: offset ? RUNS_PAGE : RUNS_FIRST_PAGE, sortDir: 'desc' });
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
      if (!original) createdNotice.current = t('Scheduled task created');
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
  const subPage = page === 'prompt' || page === 'schedule' || page === 'advanced';
  const back = () => {
    if (busyRef.current) return;
    if (subPage) setPage('form');
    else if (!jobId && page === 'form' && !initialPrompt?.trim()) {
      if (dirty) setPendingLeave('templates');
      else setPage('templates');
    } else if (dirty) setPendingLeave({ type: 'GO_BACK' });
    else navigation.goBack();
  };
  // Edit page schedule row: the rule on top, next run (server value while the draft is untouched,
  // a local estimate once it changed) and the timezone underneath, so no second block repeats them.
  const scheduleSubtitle = (current: Form): string => {
    const schedule = scheduleFromDraft(current.time);
    const unchanged = JSON.stringify(current.time) === JSON.stringify(originalForm.current?.time);
    const next = unchanged && original ? original.state.nextRunAtMs : upcomingRuns(schedule)[0]?.getTime();
    const parts: string[] = [];
    if (!current.task.enabled) parts.push(t('Paused'));
    else if (next !== undefined) parts.push(`${t('Next run')} ${formatCronDate(next, i18n?.resolvedLanguage, unchanged || schedule.kind !== 'cron' ? undefined : schedule.tz)}`);
    if (current.time.frequency === 'once') parts.push(deviceTimeZone());
    else if (current.time.frequency !== 'interval') parts.push(current.time.timezone || t('Agent timezone'));
    return parts.join(' · ');
  };
  const title = page === 'prompt' ? t('What should the Agent do?') : page === 'schedule' ? t('Schedule')
    : page === 'advanced' ? t('Advanced settings', { ns: 'config' }) : jobId ? t('Edit Task') : t('New cron job', { ns: 'config' });
  // The edit page is a grouped settings page (white cards on the grouped canvas, like Models);
  // create and the sub-pages stay plain forms on the white canvas.
  const grouped = Boolean(jobId) && page === 'form';
  return <View testID="agent-cron-editor" style={[styles.screen, grouped ? styles.grouped : null]}>
    <ScreenHeader title={title} topInset={insets.top} onBack={back} style={grouped ? styles.grouped : undefined}
      status={!online && reconnecting ? <ConnectionStatusPill placement="inline" status="reconnecting" message={t('Reconnecting…', { ns: 'common' })} />
        : !online ? <ConnectionStatusPill testID="agent-cron-editor-offline" placement="inline" status="offline" message={t('Offline · reconnecting')} /> : undefined}
      rightContent={subPage
      ? <Button testID={`cron-${page}-done`} label={t('Done', { ns: 'common' })} variant="ghost" onPress={() => setPage('form')} />
      : jobId && form && canWrite ? <Button testID="agent-cron-save" label={t('Save', { ns: 'common' })} variant="primary" loading={busy === 'save'} disabled={locked || !dirty} onPress={() => { void save(); }} /> : undefined} />
    <KeyboardAwareScrollView testID="cron-editor-scroll" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.content, page === 'prompt' ? styles.grow : null, { paddingBottom: insets.bottom + Space.xl }]}>
      {error ? <Banner testID="agent-cron-editor-error" tone="bad" message={error} /> : null}
      {notice ? <Banner message={notice} /> : null}
      {!form ? data.loading || (!data.jobs && !data.error && online) ? <ListSkeleton testID="cron-editor-loading" detail trailing="none" rows={4} />
        : <Banner message={data.error ? message(data.error) : t('Failed to load scheduled task')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => { void data.reload(); }} />
        : !canWrite && !jobId ? <Banner message={t('Unavailable')} />
        : page === 'templates' ? <View style={styles.stack}>
          <Text accessibilityRole="header" style={styles.heading}>{t('What should the Agent do?')}</Text>
          <ChoiceRow testID="cron-template-custom" icon={PencilLine} title={t('Custom task')}
            description={t('Describe what you want in your own words.')} onPress={() => chooseTemplate('custom')} />
          {cronTemplates(t).slice(0, more ? 8 : 4).map(template => <ChoiceRow key={template.id}
            testID={`cron-template-${template.id}`} icon={template.icon} title={template.name} description={template.prompt} onPress={() => chooseTemplate(template.id)} />)}
          <Button testID="cron-templates-more" label={more ? t('Show less') : t('More templates')} variant="ghost" onPress={() => setMore(value => !value)} />
        </View> : page === 'prompt' ? <FormTextInput testID="agent-cron-prompt" accessibilityLabel={t('Task prompt')} value={form.task.prompt} multiline autoFocus
          placeholder={t('Describe what you want in your own words.')} containerStyle={styles.editor} inputStyle={styles.editorInput}
          minHeight={ControlSize.rosterRow * 3} editable={!locked} onChangeText={prompt => patch({ prompt })} />
        : page === 'schedule' ? <>
          <CronScheduleFields draft={form.time} onChange={changeTime} editableTimeZone={Boolean(adapter.capabilities.cronTimeZone)} disabled={locked} />
          <CronSchedulePreview draft={form.time} />
        </> : page === 'advanced' ? <>
          {form.time.frequency !== 'custom' ? <SettingsRow testID="cron-use-expression" title={t('Use Cron expression')} disabled={locked} showChevron
            onPress={() => {
              const schedule = scheduleFromDraft(form.time);
              changeTime({ ...form.time, frequency: 'custom', expression: schedule.kind === 'cron' ? schedule.expr : '' });
              setPage('schedule');
            }} /> : null}
          {adapter.capabilities.cronAdvanced ? <>
            <View style={styles.section}><Text style={styles.label}>{t('Description')}</Text>
              <FormTextInput testID="cron-description" accessibilityLabel={t('Description')} value={form.task.description ?? ''} editable={!locked} onChangeText={description => patch({ description })} />
            </View>
            {isAgentTurn ? <View style={styles.section}>
              <MenuView themeVariant={theme.scheme} actions={[
                { id: 'none', title: t('Run history only') }, { id: 'announce', title: t('Send to channel') }, { id: 'webhook', title: 'Webhook' },
              ]} onPressAction={({ nativeEvent }) => {
                if (!locked && ['none', 'announce', 'webhook'].includes(nativeEvent.event)) patch({ delivery: { ...form.task.delivery, mode: nativeEvent.event as 'none' | 'announce' | 'webhook' } });
              }}><SettingsRow testID="cron-delivery" title={t('Notifications')} disabled={locked} showChevron value={form.task.delivery?.mode === 'announce' ? t('Send to channel') : form.task.delivery?.mode === 'webhook' ? 'Webhook' : t('Run history only')} /></MenuView>
              {form.task.delivery?.mode === 'announce' ? <FormTextInput testID="cron-channel" accessibilityLabel={t('Channel')} placeholder={t('Channel')} value={form.task.delivery.channel ?? ''}
                editable={!locked} onChangeText={channel => patch({ delivery: { ...form.task.delivery!, channel } })} /> : null}
              {form.task.delivery && form.task.delivery.mode !== 'none' ? <FormTextInput testID="cron-delivery-target" accessibilityLabel={t('Destination')} placeholder={t('Destination')} value={form.task.delivery.to ?? ''}
                editable={!locked} autoCapitalize="none" onChangeText={to => patch({ delivery: { ...form.task.delivery!, to } })} /> : null}
              <Text style={styles.label}>{!form.task.delivery || form.task.delivery.mode === 'none' ? t('Results are available in run history.') : t('Existing delivery settings are preserved.')}</Text>
            </View> : null}
          </> : null}
          {original?.payload.kind === 'agentTurn' && original.payload.timeoutSeconds != null ? <SettingsRow title={t('Timeout')} value={String(original.payload.timeoutSeconds)} /> : null}
        </> : jobId ? <>
          <SettingsGroup testID="cron-edit-task">
            <SettingsRow testID="agent-cron-name" title={t('Task name')} value={form.task.name} tailWidth="wide" disabled={locked} showChevron onPress={() => setRenaming(true)} />
            <SettingsDivider inset="content" />
            <SettingsRow testID="cron-prompt-summary" title={t('What should the Agent do?')} subtitle={form.task.prompt || t('Describe what you want in your own words.')}
              accessibilityLabel={t('Task prompt')} showChevron onPress={() => setPage('prompt')} />
          </SettingsGroup>
          <SettingsGroup testID="cron-edit-when">
            <SettingsRow testID="cron-edit-schedule" title={describeScheduleHuman(scheduleFromDraft(form.time), t)} subtitle={scheduleSubtitle(form)}
              disabled={locked} showChevron onPress={() => setPage('schedule')} />
            <SettingsDivider inset="content" />
            <SettingsRow title={t('Enabled')} trailing={<ThemedSwitch testID="agent-cron-enabled" accessibilityLabel={t('Enabled')} value={form.task.enabled} disabled={locked} onValueChange={enabled => patch({ enabled })} />} />
          </SettingsGroup>
          <SettingsGroup testID="cron-edit-options">
            {showModel ? <>
              <SettingsRow testID="cron-model" title={t('Model')} value={modelValue} tailWidth="wide"
                disabled={locked} showChevron={isAgentTurn} onPress={isAgentTurn ? () => setModelPickerVisible(true) : undefined} />
              <SettingsDivider inset="content" />
            </> : null}
            <SettingsRow testID="cron-advanced" title={t('Advanced settings', { ns: 'config' })} showChevron onPress={() => setPage('advanced')} />
          </SettingsGroup>
          {operations?.runs ? <View style={styles.section}>
            <View style={styles.listHeader}><Text accessibilityRole="header" style={styles.label}>{t('Runs')}</Text>
              <Button testID="cron-refresh-runs" label={t('Refresh', { ns: 'common' })} variant="ghost" size="sm" style={styles.labelAction} disabled={!online || runsBusy} onPress={() => setRunRefresh(value => value + 1)} />
            </View>
            {runsError ? <Banner message={runsError} actionLabel={t('Retry', { ns: 'common' })} onAction={() => setRunRefresh(value => value + 1)} /> : null}
            {!runs.length && !runsBusy && !runsError ? <Text style={[styles.placeholder, styles.inset]}>{t('No runs yet')}</Text> : null}
            {runs.length ? <SettingsGroup testID="cron-edit-runs">
              {runs.map((run, index) => <React.Fragment key={`${run.ts}:${index}`}>
                {index ? <SettingsDivider inset="content" /> : null}
                <SettingsRow testID={`cron-editor-run-${run.ts}`}
                  title={formatCronDate(run.runAtMs ?? run.ts, i18n?.resolvedLanguage)} subtitle={run.status === 'error' ? run.error : undefined}
                  value={run.status === 'ok' ? t('Succeeded') : run.status === 'error' ? t('Failed') : run.status === 'skipped' ? t('Skipped') : t('Unknown', { ns: 'common' })}
                  attention={run.status === 'error'} showChevron onPress={() => setSelectedRun(run)} />
              </React.Fragment>)}
            </SettingsGroup> : null}
            {runOffset !== null ? <Button testID="cron-runs-more" label={t('Load more')} variant="ghost" size="sm" style={styles.more} disabled={!online || runsBusy} onPress={() => { void loadRuns(runOffset); }} /> : null}
          </View> : null}
          <View style={styles.actions}>
            {operations?.run ? <Button testID="agent-cron-run" icon={Play} label={t('Run now')} variant="secondary" disabled={!online || Boolean(busy)} loading={busy === 'run'} style={styles.flex} onPress={() => { void runNow(); }} /> : null}
            {operations?.remove ? <Button testID="agent-cron-delete" icon={Trash2} label={t('Delete', { ns: 'common' })} variant="destructive" disabled={!online || Boolean(busy)} loading={busy === 'delete'} style={styles.flex} onPress={() => setConfirmDelete(true)} /> : null}
          </View>
        </> : <>
          <View style={styles.section}><Text style={styles.label}>{t('Task name')}</Text>
            <FormTextInput testID="agent-cron-name" accessibilityLabel={t('Task name')} value={form.task.name} editable={!locked} onChangeText={name => patch({ name })} />
          </View>
          {compactImportedPrompt ? <SettingsRow testID="cron-prompt-summary" title={t('What should the Agent do?')}
            subtitle={form.task.prompt || t('Describe what you want in your own words.')} accessibilityLabel={t('Task prompt')}
            disabled={locked} showChevron onPress={() => setPage('prompt')} /> : <View style={styles.section}><Text style={styles.label}>{t('What should the Agent do?')}</Text>
            <FormTextInput testID="agent-cron-prompt" accessibilityLabel={t('Task prompt')} value={form.task.prompt} multiline
              placeholder={t('Describe what you want in your own words.')} minHeight={ControlSize.rosterRow} editable={!locked} onChangeText={prompt => patch({ prompt })} />
          </View>}
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.label}>{t('When should it run?')}</Text>
            <CronScheduleFields draft={form.time} onChange={changeTime} editableTimeZone={Boolean(adapter.capabilities.cronTimeZone)} disabled={locked} />
            <CronSchedulePreview draft={form.time} />
          </View>
          {showModel ? <SettingsRow testID="cron-model" title={t('Model')} value={modelValue} tailWidth="wide"
            disabled={locked} showChevron onPress={() => setModelPickerVisible(true)} /> : null}
          {canWrite ? <Button testID="agent-cron-save" label={t('Create Task')} disabled={locked} loading={busy === 'save'} onPress={() => { void save(); }} /> : null}
        </>}
    </KeyboardAwareScrollView>
    <CronRunSheet run={selectedRun} loadContent={operations?.runContent} onClose={() => setSelectedRun(null)}
      onOpenSession={(sessionKey) => navigation.navigate('Thread', { connectionId: agent.connectionId, agentId: agent.agentId, sessionKey, from: 'panel' })} />
    {jobId && form ? <RenameSheet testID="cron-rename" visible={renaming} value={form.task.name} title={t('Task name')}
      onClose={() => setRenaming(false)} onSubmit={name => patch({ name })} /> : null}
    {showModel ? <ModelPickerModal visible={modelPickerVisible} title={t('Model')} showDefault
      models={modelOptions.models as ModelInfo[]} loading={modelOptions.loading && modelOptions.models.length === 0}
      error={modelOptions.error && modelOptions.models.length === 0 ? message(modelOptions.error) : null} onRetry={modelOptions.reload}
      selectedModelId={form?.task.model?.trim() ?? ''} configuredDefaultModel={modelOptions.defaultModel || undefined}
      onClose={() => setModelPickerVisible(false)}
      onSelectModel={model => patch({ model: model.id ? explicitModelReference(model.provider, model.id) : undefined })} /> : null}
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

// Edit page: grouped cards 24 apart on the grouped canvas; the runs label sits on the card text
// edge. Create / sub-pages: 24 between sections, 8 from a label to its content, rows bleed to
// the screen edge so their text aligns with labels and inputs.
function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    grouped: { backgroundColor: colors.canvasGrouped },
    content: { paddingHorizontal: Space.lg, paddingTop: Space.md, gap: Space.xl },
    grow: { flexGrow: 1 },
    stack: { gap: Space.lg },
    section: { gap: Space.sm },
    listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md, paddingStart: Space.lg },
    labelAction: { marginVertical: -Space.sm, marginEnd: -Space.md + Space.lg },
    inset: { paddingHorizontal: Space.lg },
    more: { alignSelf: 'flex-start', marginStart: Space.xs },
    editor: { flex: 1, backgroundColor: colors.canvas },
    editorInput: { flex: 1, paddingHorizontal: 0, fontSize: FontSize.body, lineHeight: LineHeight.body },
    heading: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
    label: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    placeholder: { color: colors.inkTertiary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    actions: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingTop: Space.sm },
    flex: { flex: 1 },
  });
}
