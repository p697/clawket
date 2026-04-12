import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ChevronLeft, ChevronRight, Clock, MessageSquareText, Tag, X } from 'lucide-react-native';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  NativeStackNavigationOptions,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { HeaderActionButton, HeaderTextAction, LoadingState } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { AppTheme } from '../../theme';
import type { HermesCronJob, HermesCronJobUpsert } from '../../types/hermes-cron';
import type { ConsoleStackParamList } from './ConsoleTab';

type WizardNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronWizard'>;
type WizardRoute = RouteProp<ConsoleStackParamList, 'CronWizard'>;

type FrequencyKind = 'daily' | 'weekly' | 'interval' | 'once';
type IntervalUnit = 'minutes' | 'hours' | 'days';
type Phase = 'templates' | 'form';

type CronTemplate = {
  key: string;
  emoji: string;
  defaultFrequency: FrequencyKind;
  defaultTimeHour?: number;
  defaultTimeMinute?: number;
  defaultWeekday?: string;
  defaultIntervalAmount?: string;
  defaultIntervalUnit?: IntervalUnit;
};

type FormState = {
  prompt: string;
  frequency: FrequencyKind;
  time: Date;
  weekday: string;
  intervalAmount: string;
  intervalUnit: IntervalUnit;
  onceDate: Date;
  taskName: string;
};

const HOUR_MS = 60 * 60 * 1000;

const TEMPLATES: CronTemplate[] = [
  { key: 'custom', emoji: '\u26A1', defaultFrequency: 'daily', defaultTimeHour: 9 },
  { key: 'daily-briefing', emoji: '\uD83D\uDCCB', defaultFrequency: 'daily', defaultTimeHour: 9 },
  { key: 'weekly-report', emoji: '\uD83D\uDCCA', defaultFrequency: 'weekly', defaultWeekday: '1', defaultTimeHour: 9 },
  { key: 'check-reminders', emoji: '\uD83D\uDD14', defaultFrequency: 'daily', defaultTimeHour: 8 },
  { key: 'morning-motivation', emoji: '\uD83C\uDF05', defaultFrequency: 'daily', defaultTimeHour: 7 },
  { key: 'evening-summary', emoji: '\uD83C\uDF19', defaultFrequency: 'daily', defaultTimeHour: 18 },
  { key: 'weekly-cleanup', emoji: '\uD83E\uDDF9', defaultFrequency: 'weekly', defaultWeekday: '0', defaultTimeHour: 10 },
  { key: 'health-check', emoji: '\uD83D\uDC9A', defaultFrequency: 'interval', defaultIntervalAmount: '6', defaultIntervalUnit: 'hours' },
  { key: 'news-digest', emoji: '\uD83D\uDCF0', defaultFrequency: 'daily', defaultTimeHour: 8 },
];

const WEEKDAYS = [
  { key: '1', short: 'Mon' },
  { key: '2', short: 'Tue' },
  { key: '3', short: 'Wed' },
  { key: '4', short: 'Thu' },
  { key: '5', short: 'Fri' },
  { key: '6', short: 'Sat' },
  { key: '0', short: 'Sun' },
] as const;

function makeTime(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function defaultFormState(): FormState {
  return {
    prompt: '',
    frequency: 'daily',
    time: makeTime(9),
    weekday: '1',
    intervalAmount: '30',
    intervalUnit: 'minutes',
    onceDate: new Date(Date.now() + HOUR_MS),
    taskName: '',
  };
}

function getTemplateTitle(key: string, t: (key: string) => string): string {
  switch (key) {
    case 'custom': return t('Custom');
    case 'daily-briefing': return t('Daily Briefing');
    case 'weekly-report': return t('Weekly Report');
    case 'check-reminders': return t('Check Reminders');
    case 'morning-motivation': return t('Morning Motivation');
    case 'evening-summary': return t('Evening Summary');
    case 'weekly-cleanup': return t('Weekly Cleanup');
    case 'health-check': return t('Health Check');
    case 'news-digest': return t('News Digest');
    default: return key;
  }
}

function getTemplateDesc(key: string, t: (key: string) => string): string {
  switch (key) {
    case 'custom': return t('Build from scratch');
    case 'daily-briefing': return t('Morning daily briefing');
    case 'weekly-report': return t('Monday weekly report');
    case 'check-reminders': return t('Check pending reminders');
    case 'morning-motivation': return t('Inspirational quote on weekdays');
    case 'evening-summary': return t('End-of-day recap');
    case 'weekly-cleanup': return t('Archive old tasks on Sundays');
    case 'health-check': return t('Periodic system status check');
    case 'news-digest': return t('Daily news summary on your topics');
    default: return '';
  }
}

function getTemplatePrompt(key: string, t: (key: string) => string): string {
  switch (key) {
    case 'daily-briefing':
      return t('Give me a morning briefing: summarize my pending tasks, upcoming events, and any important updates.');
    case 'weekly-report':
      return t('Write a weekly report summarizing the key accomplishments, challenges, and plans for next week.');
    case 'check-reminders':
      return t('Check all pending reminders and notify me of any that are due or overdue.');
    case 'morning-motivation':
      return t('Share an inspirational quote and a motivational thought to start the day.');
    case 'evening-summary':
      return t('Summarize what happened today: key events, completed tasks, and anything that needs follow-up tomorrow.');
    case 'weekly-cleanup':
      return t('Archive old tasks, clean up completed items, and organize the backlog for the new week.');
    case 'health-check':
      return t('Run a system health check: verify all services are running, check error rates, and report any anomalies.');
    case 'news-digest':
      return t('Summarize the top news from the past 24 hours on my topics of interest. List the most important items.');
    default:
      return '';
  }
}

function getTemplateInitialTaskName(key: string, t: (key: string) => string): string {
  return key === 'custom' ? '' : getTemplateTitle(key, t);
}

function formFromTemplate(tpl: CronTemplate, t: (key: string) => string): FormState {
  const base = defaultFormState();
  base.prompt = getTemplatePrompt(tpl.key, t);
  base.taskName = getTemplateInitialTaskName(tpl.key, t);
  base.frequency = tpl.defaultFrequency;
  if (tpl.defaultTimeHour !== undefined) {
    base.time = makeTime(tpl.defaultTimeHour, tpl.defaultTimeMinute ?? 0);
  }
  if (tpl.defaultWeekday) base.weekday = tpl.defaultWeekday;
  if (tpl.defaultIntervalAmount) base.intervalAmount = tpl.defaultIntervalAmount;
  if (tpl.defaultIntervalUnit) base.intervalUnit = tpl.defaultIntervalUnit;
  return base;
}

function formFromHermesJob(job: HermesCronJob): FormState {
  const base = defaultFormState();
  base.taskName = job.name;
  base.prompt = job.prompt || '';
  if (job.schedule.kind === 'at' && job.schedule.run_at) {
    const parsed = Date.parse(job.schedule.run_at);
    base.frequency = 'once';
    if (Number.isFinite(parsed)) {
      base.onceDate = new Date(parsed);
    }
    return base;
  }
  if (job.schedule.kind === 'every' && typeof job.schedule.minutes === 'number' && job.schedule.minutes > 0) {
    const minutes = job.schedule.minutes;
    base.frequency = 'interval';
    if (minutes % (60 * 24) === 0) {
      base.intervalAmount = String(minutes / (60 * 24));
      base.intervalUnit = 'days';
    } else if (minutes % 60 === 0) {
      base.intervalAmount = String(minutes / 60);
      base.intervalUnit = 'hours';
    } else {
      base.intervalAmount = String(minutes);
      base.intervalUnit = 'minutes';
    }
    return base;
  }
  if (job.schedule.kind === 'cron' && job.schedule.expr) {
    const parts = job.schedule.expr.trim().split(/\s+/);
    if (parts.length === 5) {
      const [min, hour, day, mon, dow] = parts;
      const h = Number(hour);
      const m = Number(min);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        base.time = makeTime(h, m);
      }
      if (day === '*' && mon === '*' && dow !== '*') {
        base.frequency = 'weekly';
        base.weekday = dow;
      } else {
        base.frequency = 'daily';
      }
    }
  }
  return base;
}

function buildHermesSchedule(form: FormState): string {
  if (form.frequency === 'daily') {
    return `${form.time.getMinutes()} ${form.time.getHours()} * * *`;
  }
  if (form.frequency === 'weekly') {
    return `${form.time.getMinutes()} ${form.time.getHours()} * * ${form.weekday}`;
  }
  if (form.frequency === 'interval') {
    const amount = Math.max(Number.parseFloat(form.intervalAmount), 1);
    const normalizedAmount = Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(2)));
    const unit = form.intervalUnit === 'minutes'
      ? 'm'
      : form.intervalUnit === 'hours'
        ? 'h'
        : 'd';
    return `${normalizedAmount}${unit}`;
  }
  const runAt = new Date(form.onceDate);
  runAt.setSeconds(0, 0);
  return runAt.toISOString();
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getNextDailyStart(time: Date): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(time.getHours(), time.getMinutes(), 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function getNextWeeklyStart(weekday: string, time: Date): Date {
  const now = new Date();
  const targetWeekday = Number.parseInt(weekday, 10);
  const next = new Date(now);
  next.setHours(time.getHours(), time.getMinutes(), 0, 0);
  const currentWeekday = next.getDay();
  let offset = (targetWeekday - currentWeekday + 7) % 7;
  if (offset === 0 && next.getTime() <= now.getTime()) {
    offset = 7;
  }
  next.setDate(next.getDate() + offset);
  return next;
}

function buildHermesWizardPayload(form: FormState): HermesCronJobUpsert {
  if (form.frequency === 'daily') {
    const startAt = getNextDailyStart(form.time);
    return {
      name: form.taskName.trim(),
      schedule: 'every 1d',
      scheduleDisplay: `Every day at ${formatTime(form.time)}`,
      startAt: startAt.toISOString(),
      prompt: form.prompt.trim(),
      deliver: 'local',
    };
  }

  if (form.frequency === 'weekly') {
    const startAt = getNextWeeklyStart(form.weekday, form.time);
    const weekdayLabel = WEEKDAYS.find((w) => w.key === form.weekday)?.short ?? 'Mon';
    return {
      name: form.taskName.trim(),
      schedule: 'every 7d',
      scheduleDisplay: `Every ${weekdayLabel} at ${formatTime(form.time)}`,
      startAt: startAt.toISOString(),
      prompt: form.prompt.trim(),
      deliver: 'local',
    };
  }

  return {
    name: form.taskName.trim(),
    schedule: buildHermesSchedule(form),
    prompt: form.prompt.trim(),
    deliver: 'local',
  };
}

export function HermesCronWizardScreen(): React.JSX.Element {
  const { gateway } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<WizardNavigation>();
  const route = useRoute<WizardRoute>();
  const headerHeight = useHeaderHeight();
  const colors = theme.colors;
  const styles = useMemo(() => createStyles(colors), [colors]);

  const jobId = route.params?.jobId;
  const editMode = Boolean(jobId);

  const [phase, setPhase] = useState<Phase>(editMode ? 'form' : 'templates');
  const [selectedTemplate, setSelectedTemplate] = useState<CronTemplate | null>(null);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editMode);
  const handleSaveRef = useRef<() => void>(() => {});

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showOnceDatePicker, setShowOnceDatePicker] = useState(false);
  const [androidOncePickerMode, setAndroidOncePickerMode] = useState<'date' | 'time'>('date');
  const [androidDatePart, setAndroidDatePart] = useState<Date | null>(null);

  const patch = useCallback((partial: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const job = await gateway.getHermesCronJob(jobId);
        if (!cancelled && job) {
          setForm(formFromHermesJob(job));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, jobId]);

  const handleSelectTemplate = useCallback((tpl: CronTemplate) => {
    setSelectedTemplate(tpl);
    setForm(formFromTemplate(tpl, t));
    setPhase('form');
  }, [t]);

  const handleOpenAdvancedEditor = useCallback(() => {
    analyticsEvents.cronCreateTapped({ source: 'hermes_cron_template_advanced' });
    navigation.navigate('CronEditor');
  }, [navigation]);

  const handleSave = useCallback(async () => {
    if (!form.taskName.trim()) {
      Alert.alert(t('Validation'), t('Name is required.'));
      return;
    }
    if (!form.prompt.trim()) {
      Alert.alert(t('Validation'), t('Payload text is required.'));
      return;
    }
    if (form.frequency === 'interval') {
      const amount = Number.parseFloat(form.intervalAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        Alert.alert(t('Validation'), t('Interval schedule must be greater than zero.'));
        return;
      }
    }

    setSaving(true);
    try {
      const payload = buildHermesWizardPayload(form);
      if (editMode && jobId) {
        await gateway.updateHermesCronJob(jobId, payload);
        Alert.alert(t('common:Saved'), t('Cron job updated.'));
        navigation.goBack();
      } else {
        const created = await gateway.createHermesCronJob(payload);
        Alert.alert(t('common:Saved'), t('Cron job created.'));
        if (created?.id) {
          navigation.replace('CronDetail', { jobId: created.id });
        } else {
          navigation.goBack();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to save cron job');
      Alert.alert(t('Save failed'), message);
    } finally {
      setSaving(false);
    }
  }, [editMode, form, gateway, jobId, navigation, t]);

  useEffect(() => {
    handleSaveRef.current = () => { void handleSave(); };
  }, [handleSave]);

  useLayoutEffect(() => {
    const isFormPhase = phase === 'form';
    const headerTitle = isFormPhase
      ? editMode
        ? t('Edit Cron Job')
        : selectedTemplate
          ? getTemplateTitle(selectedTemplate.key, t)
          : t('New Cron Job')
      : t('New Cron Job');

    const options: NativeStackNavigationOptions = {
      headerShown: true,
      headerBackVisible: false,
      headerShadowVisible: false,
      headerTitle,
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: colors.surface },
      headerTitleStyle: {
        color: colors.text,
        fontSize: 16,
        fontWeight: '600',
      },
      headerLeft: () => (
        <View style={headerStyles.slotStart}>
          {isFormPhase && !editMode ? (
            <HeaderActionButton icon={ChevronLeft} onPress={() => setPhase('templates')} size={20} />
          ) : (
            <HeaderActionButton icon={X} onPress={() => navigation.goBack()} size={20} />
          )}
        </View>
      ),
      headerRight: isFormPhase
        ? () => (
            <View style={headerStyles.slotEnd}>
              <HeaderTextAction
                label={saving ? t('common:Saving...') : editMode ? t('common:Save') : t('Create Task')}
                onPress={() => handleSaveRef.current()}
                disabled={saving}
              />
            </View>
          )
        : undefined,
    };
    navigation.setOptions(options);
  }, [colors, editMode, navigation, phase, saving, selectedTemplate, t]);

  const handleTimeChange = useCallback((_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
      if (date) patch({ time: date });
      return;
    }
    if (date) patch({ time: date });
  }, [patch]);

  const handleOnceDateChange = useCallback((event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        setShowOnceDatePicker(false);
        setAndroidOncePickerMode('date');
        return;
      }
      const picked = date ?? form.onceDate;
      if (androidOncePickerMode === 'date') {
        setAndroidDatePart(picked);
        setAndroidOncePickerMode('time');
        return;
      }
      const base = androidDatePart ?? form.onceDate;
      const merged = new Date(base);
      merged.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      patch({ onceDate: merged });
      setShowOnceDatePicker(false);
      setAndroidOncePickerMode('date');
      return;
    }
    if (date) patch({ onceDate: date });
  }, [androidDatePart, androidOncePickerMode, form.onceDate, patch]);

  const frequencyOptions = useMemo<{ key: FrequencyKind; label: string }[]>(
    () => [
      { key: 'daily', label: t('wizard_freq_daily_short') },
      { key: 'weekly', label: t('wizard_freq_weekly_short') },
      { key: 'interval', label: t('wizard_freq_interval_short') },
      { key: 'once', label: t('wizard_freq_once_short') },
    ],
    [t],
  );

  const weekdayActions = useMemo<MenuAction[]>(
    () => WEEKDAYS.map((wd) => ({
      id: wd.key,
      title: t(`weekday_${wd.short}`),
      state: form.weekday === wd.key ? ('on' as const) : ('off' as const),
    })),
    [form.weekday, t],
  );

  const intervalUnitActions = useMemo<MenuAction[]>(
    () => (['minutes', 'hours', 'days'] as IntervalUnit[]).map((unit) => ({
      id: unit,
      title: unit === 'minutes'
        ? t('wizard_unit_minutes')
        : unit === 'hours'
          ? t('wizard_unit_hours')
          : t('wizard_unit_days'),
      state: form.intervalUnit === unit ? ('on' as const) : ('off' as const),
    })),
    [form.intervalUnit, t],
  );

  const renderTemplateItem = useCallback(({ item }: { item: CronTemplate }) => (
    <View style={styles.templateRow}>
      <TouchableOpacity
        style={styles.templatePrimaryAction}
        activeOpacity={0.7}
        onPress={() => handleSelectTemplate(item)}
      >
        <View style={styles.templateEmojiWrap}>
          <Text style={styles.templateEmoji}>{item.emoji}</Text>
        </View>
        <View style={styles.templateTextWrap}>
          <Text style={styles.templateTitle}>{getTemplateTitle(item.key, t)}</Text>
          <Text style={styles.templateDesc} numberOfLines={1}>
            {getTemplateDesc(item.key, t)}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.textSubtle} />
      </TouchableOpacity>
      {item.key === 'custom' ? (
        <TouchableOpacity
          style={styles.templateAdvancedButton}
          activeOpacity={0.7}
          onPress={handleOpenAdvancedEditor}
        >
          <Text style={styles.templateAdvancedButtonText}>{t('Advanced')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  ), [colors.textSubtle, handleOpenAdvancedEditor, handleSelectTemplate, styles, t]);

  const renderTemplatePhase = () => (
    <View style={styles.container}>
      <Text style={styles.templateSubtitle}>
        {t('Choose a template or start from scratch')}
      </Text>
      <FlatList
        data={TEMPLATES}
        keyExtractor={(item) => item.key}
        renderItem={renderTemplateItem}
        contentContainerStyle={styles.templateList}
      />
    </View>
  );

  const renderFormPhase = () => (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Clock size={15} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.sectionLabel}>{t('When should it run')}</Text>
        </View>
        <View style={styles.segmentRow}>
          {frequencyOptions.map((opt) => {
            const active = form.frequency === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                activeOpacity={0.7}
                onPress={() => patch({ frequency: opt.key })}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.card, { marginTop: Space.sm }]}>
          {form.frequency === 'weekly' ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('wizard_weekday')}</Text>
              <MenuView
                actions={weekdayActions}
                shouldOpenOnLongPress={false}
                title={t('wizard_weekday')}
                themeVariant={theme.scheme}
                onPressAction={({ nativeEvent }) => patch({ weekday: nativeEvent.event })}
              >
                <TouchableOpacity style={styles.menuTrigger} activeOpacity={0.7}>
                  <Text style={styles.menuTriggerText}>
                    {t(`weekday_${WEEKDAYS.find((w) => w.key === form.weekday)?.short ?? 'Mon'}`)}
                  </Text>
                  <ChevronRight size={14} color={colors.textSubtle} />
                </TouchableOpacity>
              </MenuView>
            </View>
          ) : null}

          {(form.frequency === 'daily' || form.frequency === 'weekly') ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('wizard_time')}</Text>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={form.time}
                  mode="time"
                  display="compact"
                  onChange={handleTimeChange}
                  themeVariant={theme.scheme}
                  style={{ width: 90 }}
                />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.menuTrigger}
                    activeOpacity={0.7}
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Text style={styles.menuTriggerText}>{formatTime(form.time)}</Text>
                  </TouchableOpacity>
                  {showTimePicker ? (
                    <DateTimePicker
                      value={form.time}
                      mode="time"
                      display="default"
                      onChange={handleTimeChange}
                    />
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          {form.frequency === 'interval' ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('Interval')}</Text>
              <View style={styles.intervalRow}>
                <TextInput
                  style={styles.intervalInput}
                  value={form.intervalAmount}
                  onChangeText={(text) => patch({ intervalAmount: text })}
                  keyboardType="numeric"
                  placeholderTextColor={colors.textSubtle}
                />
                <MenuView
                  actions={intervalUnitActions}
                  shouldOpenOnLongPress={false}
                  title={t('wizard_unit_label')}
                  themeVariant={theme.scheme}
                  onPressAction={({ nativeEvent }) =>
                    patch({ intervalUnit: nativeEvent.event as IntervalUnit })
                  }
                >
                  <TouchableOpacity style={styles.menuTrigger} activeOpacity={0.7}>
                    <Text style={styles.menuTriggerText}>
                      {form.intervalUnit === 'minutes'
                        ? t('wizard_unit_minutes')
                        : form.intervalUnit === 'hours'
                          ? t('wizard_unit_hours')
                          : t('wizard_unit_days')}
                    </Text>
                    <ChevronRight size={14} color={colors.textSubtle} />
                  </TouchableOpacity>
                </MenuView>
              </View>
            </View>
          ) : null}

          {form.frequency === 'once' ? (
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('wizard_date_time')}</Text>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={form.onceDate}
                  mode="datetime"
                  display="compact"
                  onChange={handleOnceDateChange}
                  themeVariant={theme.scheme}
                  minimumDate={new Date()}
                  style={{ width: 200 }}
                />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.menuTrigger}
                    activeOpacity={0.7}
                    onPress={() => {
                      setAndroidOncePickerMode('date');
                      setShowOnceDatePicker(true);
                    }}
                  >
                    <Text style={styles.menuTriggerText}>
                      {formatDate(form.onceDate)} {formatTime(form.onceDate)}
                    </Text>
                  </TouchableOpacity>
                  {showOnceDatePicker ? (
                    <DateTimePicker
                      value={form.onceDate}
                      mode={androidOncePickerMode}
                      display="default"
                      onChange={handleOnceDateChange}
                      minimumDate={androidOncePickerMode === 'date' ? new Date() : undefined}
                    />
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <MessageSquareText size={15} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.sectionLabel}>{t('What should it do')}</Text>
        </View>
        <TextInput
          style={styles.promptInput}
          multiline
          value={form.prompt}
          onChangeText={(text) => patch({ prompt: text })}
          placeholder={t('Describe what the agent should do...')}
          placeholderTextColor={colors.textSubtle}
          textAlignVertical="top"
        />

        <View style={styles.sectionHeader}>
          <Tag size={15} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.sectionLabel}>{t('Task Name')}</Text>
        </View>
        <TextInput
          style={styles.nameInput}
          value={form.taskName}
          onChangeText={(text) => patch({ taskName: text })}
          placeholder={t('Enter task name...')}
          placeholderTextColor={colors.textSubtle}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <LoadingState message={t('Loading cron job...')} />
      </View>
    );
  }

  return phase === 'templates' ? renderTemplatePhase() : renderFormPhase();
}

const headerStyles = StyleSheet.create({
  slotStart: { minWidth: 44, alignItems: 'flex-start' },
  slotEnd: { minWidth: 44, alignItems: 'flex-end' },
});

function createStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    templateSubtitle: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.md,
    },
    templateList: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xxxl,
      gap: Space.sm,
    },
    templateRow: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.sm,
    },
    templatePrimaryAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    templateEmojiWrap: {
      width: 52,
      height: 52,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    templateEmoji: {
      fontSize: 26,
    },
    templateTextWrap: {
      flex: 1,
      gap: 2,
    },
    templateTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    templateDesc: {
      fontSize: FontSize.md,
      color: colors.textMuted,
    },
    templateAdvancedButton: {
      alignSelf: 'flex-start',
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingHorizontal: Space.md,
      paddingVertical: Space.xs + 2,
      marginLeft: 52 + Space.md,
      backgroundColor: colors.surface,
    },
    templateAdvancedButtonText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    formContent: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xxxl,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      marginTop: Space.xl,
      marginBottom: Space.sm,
    },
    sectionLabel: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      overflow: 'hidden',
    },
    segmentRow: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: Radius.sm,
      padding: 3,
    },
    segmentItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Space.sm,
      borderRadius: Radius.sm - 2,
    },
    segmentItemActive: {
      backgroundColor: colors.primary,
    },
    segmentText: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    segmentTextActive: {
      color: colors.primaryText,
      fontWeight: FontWeight.semibold,
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
    },
    settingLabel: {
      fontSize: FontSize.base,
      color: colors.text,
    },
    menuTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    menuTriggerText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    intervalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    intervalInput: {
      width: 72,
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
      textAlign: 'center',
    },
    promptInput: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      padding: Space.md,
      fontSize: FontSize.base,
      color: colors.text,
      minHeight: 120,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nameInput: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
      fontSize: FontSize.base,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
}
