import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronRight, CircleHelp, X } from 'lucide-react-native';
import { RouteProp, useNavigation, usePreventRemove, useRoute } from '@react-navigation/native';
import { NativeStackNavigationOptions, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { HeaderActionButton, HeaderTextAction, LoadingState, createCardContentStyle } from '../../components/ui';
import { ModelPickerModal, resolveProviderModel } from '../../components/chat/ModelPickerModal';
import type { ModelInfo } from '../../components/chat/ModelPickerModal';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { scheduleAutomaticAppReview } from '../../services/auto-app-review';
import { loadGatewayModelPickerOptions } from '../../services/gateway-models';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, HitSize, Radius, Space } from '../../theme/tokens';
import type { CronJob, CronJobCreate, CronJobPatch, CronSchedule } from '../../types';
import { describeCronExpression } from '../../utils/cron';
import type { ConsoleStackParamList } from './ConsoleTab';
import { findCronJobById } from './cronData';

type CronEditorNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronEditor'>;
type CronEditorRoute = RouteProp<ConsoleStackParamList, 'CronEditor'>;

type IntervalUnit = 'minutes' | 'hours' | 'days';
type FormState = {
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: 'at' | 'every' | 'cron';
  scheduleAt: string;
  everyAmount: string;
  everyUnit: IntervalUnit;
  cronExpr: string;
  cronTz: string;
  sessionTarget: 'main' | 'isolated';
  wakeMode: 'next-heartbeat' | 'now';
  payloadKind: 'agentTurn' | 'systemEvent';
  payloadText: string;
  payloadModel: string;
  deliveryMode: 'none' | 'announce' | 'webhook';
  deliveryChannel: string;
  deliveryTo: string;
  deleteAfterRun: boolean;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_FORM: FormState = {
  name: '',
  description: '',
  enabled: true,
  scheduleKind: 'every',
  scheduleAt: zeroSeconds(new Date(Date.now() + 60 * MINUTE_MS)).toISOString(),
  everyAmount: '30',
  everyUnit: 'minutes',
  cronExpr: '0 9 * * *',
  cronTz: '',
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payloadKind: 'agentTurn',
  payloadText: '',
  payloadModel: '',
  deliveryMode: 'none',
  deliveryChannel: '',
  deliveryTo: '',
  deleteAfterRun: false,
};

type SegmentOption<T extends string> = {
  label: string;
  value: T;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  styles: ReturnType<typeof createStyles>;
};

function SegmentedControl<T extends string>({ value, options, onChange, styles }: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <View style={styles.segmentWrap}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(option.value)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const CRON_FIELD_LABELS = ['min', 'hour', 'day', 'mon', 'dow'] as const;

function splitCronFields(value: string): string[] {
  const parts = value.split(/\s+/);
  return CRON_FIELD_LABELS.map((_, i) => parts[i] ?? '');
}

function CronFieldsInput({
  value,
  onChange,
  styles: s,
}: {
  value: string;
  onChange: (expr: string) => void;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const fields = splitCronFields(value);
  const { theme } = useAppTheme();

  const handleChange = (index: number, text: string) => {
    const next = [...fields];
    next[index] = text;
    onChange(next.join(' '));
  };

  return (
    <View style={s.cronFieldsRow}>
      {CRON_FIELD_LABELS.map((label, i) => (
        <View key={label} style={s.cronFieldCol}>
          <Text style={s.cronFieldLabel}>{label}</Text>
          <TextInput
            style={s.cronFieldInput}
            value={fields[i]}
            onChangeText={(t) => handleChange(i, t)}
            placeholderTextColor={theme.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ))}
    </View>
  );
}

const CRON_GUIDE_ITEMS: { symbol: string; meaning: string }[] = [
  { symbol: '*', meaning: 'every' },
  { symbol: '5', meaning: 'only at 5' },
  { symbol: '1-5', meaning: '1 through 5' },
  { symbol: '*/15', meaning: 'every 15th' },
];

function CronGuide({ styles: s }: { styles: ReturnType<typeof createStyles> }): React.JSX.Element {
  return (
    <View style={s.cronGuideBox}>
      <View style={s.cronGuideRow}>
        {CRON_GUIDE_ITEMS.map((item, i) => (
          <View key={item.symbol} style={s.cronGuideItem}>
            <Text style={s.cronGuideSymbol}>{item.symbol}</Text>
            <Text style={s.cronGuideMeaning}>{item.meaning}</Text>
            {i < CRON_GUIDE_ITEMS.length - 1 ? <Text style={s.cronGuideSep}>{'·'}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={s.cronGuideExample}>
        {'e.g.  0 9 * * 1-5  →  weekdays at 09:00'}
      </Text>
    </View>
  );
}

function CronHint({ expr, styles: s }: { expr: string; styles: ReturnType<typeof createStyles> }): React.JSX.Element | null {
  const result = useMemo(() => {
    const trimmed = expr.trim();
    if (!trimmed) return null;
    return describeCronExpression(trimmed);
  }, [expr]);

  if (!result) return null;

  return (
    <View style={s.cronHintBox}>
      <Text style={result.valid ? s.cronHint : s.cronHintError}>
        {result.description}
      </Text>
    </View>
  );
}

function toFormEveryUnit(everyMs: number): { everyAmount: string; everyUnit: IntervalUnit } {
  if (everyMs % DAY_MS === 0) {
    return { everyAmount: String(everyMs / DAY_MS), everyUnit: 'days' };
  }
  if (everyMs % HOUR_MS === 0) {
    return { everyAmount: String(everyMs / HOUR_MS), everyUnit: 'hours' };
  }
  if (everyMs % MINUTE_MS === 0) {
    return { everyAmount: String(everyMs / MINUTE_MS), everyUnit: 'minutes' };
  }
  return { everyAmount: String(Number((everyMs / MINUTE_MS).toFixed(2))), everyUnit: 'minutes' };
}

function zeroSeconds(date: Date): Date {
  const d = new Date(date.getTime());
  d.setSeconds(0, 0);
  return d;
}

function parseScheduleAtToDate(scheduleAt: string): Date {
  const parsed = Date.parse(scheduleAt);
  if (!Number.isFinite(parsed)) return new Date();
  return new Date(parsed);
}

function formatScheduleAtLocal(scheduleAt: string): string {
  const parsed = Date.parse(scheduleAt);
  if (!Number.isFinite(parsed)) return scheduleAt;
  return new Date(parsed).toLocaleString();
}

function formFromJob(job: CronJob): FormState {
  const base: FormState = {
    ...DEFAULT_FORM,
    name: job.name,
    description: job.description ?? '',
    enabled: job.enabled,
    sessionTarget: job.sessionTarget,
    wakeMode: job.wakeMode,
    deleteAfterRun: !!job.deleteAfterRun,
    deliveryMode: job.delivery?.mode ?? 'none',
    deliveryChannel: job.delivery?.channel ?? '',
    deliveryTo: job.delivery?.to ?? '',
  };

  if (job.schedule.kind === 'at') {
    base.scheduleKind = 'at';
    base.scheduleAt = job.schedule.at;
  } else if (job.schedule.kind === 'every') {
    base.scheduleKind = 'every';
    const every = toFormEveryUnit(job.schedule.everyMs);
    base.everyAmount = every.everyAmount;
    base.everyUnit = every.everyUnit;
  } else {
    base.scheduleKind = 'cron';
    base.cronExpr = job.schedule.expr;
    base.cronTz = job.schedule.tz ?? '';
  }

  if (job.payload.kind === 'systemEvent') {
    base.payloadKind = 'systemEvent';
    base.payloadText = job.payload.text;
    base.payloadModel = '';
  } else {
    base.payloadKind = 'agentTurn';
    base.payloadText = job.payload.message;
    base.payloadModel = job.payload.model ?? '';
  }

  return base;
}

function validateForm(form: FormState, t: (key: string) => string): string | null {
  if (!form.name.trim()) return t('Name is required.');

  if (form.scheduleKind === 'at') {
    if (!form.scheduleAt.trim()) return t('One-time schedule requires a date/time.');
    const atMs = Date.parse(form.scheduleAt.trim());
    if (!Number.isFinite(atMs)) return t('One-time schedule must be a valid ISO date/time string.');
  }

  if (form.scheduleKind === 'every') {
    const amount = Number.parseFloat(form.everyAmount);
    if (!Number.isFinite(amount) || amount <= 0) return t('Interval schedule must be greater than zero.');
  }

  if (form.scheduleKind === 'cron' && !form.cronExpr.trim()) {
    return t('Cron expression is required.');
  }

  if (form.sessionTarget === 'main' && form.payloadKind !== 'systemEvent') {
    return t('Main session jobs must use System Event payload.');
  }

  if (form.sessionTarget === 'isolated' && form.payloadKind !== 'agentTurn') {
    return t('Isolated jobs must use Agent Turn payload.');
  }

  if (!form.payloadText.trim()) return t('Payload text is required.');

  if (form.deliveryMode === 'announce' && form.sessionTarget !== 'isolated') {
    return t('Announce delivery is only available for isolated jobs.');
  }

  if (form.deliveryMode === 'webhook' && !form.deliveryTo.trim()) {
    return t('Webhook delivery requires a target URL.');
  }

  if (form.deliveryMode === 'webhook') {
    try {
      const url = new URL(form.deliveryTo.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return t('Webhook delivery requires a valid HTTP(S) URL.');
      }
    } catch {
      return t('Webhook delivery requires a valid HTTP(S) URL.');
    }
  }

  return null;
}

function scheduleFromForm(form: FormState): CronSchedule {
  if (form.scheduleKind === 'at') {
    return { kind: 'at', at: form.scheduleAt.trim() };
  }
  if (form.scheduleKind === 'every') {
    const amount = Math.max(Number.parseFloat(form.everyAmount), 0);
    const unitMs = form.everyUnit === 'days' ? DAY_MS : form.everyUnit === 'hours' ? HOUR_MS : MINUTE_MS;
    return { kind: 'every', everyMs: Math.max(1, Math.round(amount * unitMs)) };
  }
  return {
    kind: 'cron',
    expr: form.cronExpr.trim(),
    ...(form.cronTz.trim() ? { tz: form.cronTz.trim() } : {}),
  };
}

function payloadFromForm(form: FormState): CronJobCreate['payload'] {
  if (form.payloadKind === 'systemEvent') {
    return { kind: 'systemEvent', text: form.payloadText.trim() };
  }
  return {
    kind: 'agentTurn',
    message: form.payloadText.trim(),
    ...(form.payloadModel.trim() ? { model: form.payloadModel.trim() } : {}),
  };
}

function deliveryFromForm(form: FormState): CronJobCreate['delivery'] {
  if (form.deliveryMode === 'none') {
    return { mode: 'none' };
  }
  if (form.deliveryMode === 'announce') {
    return {
      mode: 'announce',
      ...(form.deliveryChannel.trim() ? { channel: form.deliveryChannel.trim() } : {}),
      ...(form.deliveryTo.trim() ? { to: form.deliveryTo.trim() } : {}),
    };
  }
  return {
    mode: 'webhook',
    to: form.deliveryTo.trim(),
    ...(form.deliveryChannel.trim() ? { channel: form.deliveryChannel.trim() } : {}),
  };
}

export function CronEditorScreen(): React.JSX.Element {
  const { gateway, currentAgentId } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<CronEditorNavigation>();
  const route = useRoute<CronEditorRoute>();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const jobId = route.params?.jobId;
  const editMode = !!jobId;

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(editMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string>(JSON.stringify(DEFAULT_FORM));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAtPicker, setShowAtPicker] = useState(false);
  const [androidAtPickerMode, setAndroidAtPickerMode] = useState<'date' | 'time'>('date');
  const [androidDatePart, setAndroidDatePart] = useState<Date | null>(null);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const handleSaveRef = useRef<() => void>(() => {});

  const isDirty = useMemo(() => JSON.stringify(form) !== initialSnapshot, [form, initialSnapshot]);

  const patchForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      setModels(await loadGatewayModelPickerOptions(gateway));
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [gateway]);

  const openModelPicker = useCallback(() => {
    setModelPickerVisible(true);
    loadModels();
  }, [loadModels]);

  const selectModel = useCallback((selected: ModelInfo) => {
    const resolved = selected.id ? resolveProviderModel(selected) : '';
    patchForm({ payloadModel: resolved });
    setModelPickerVisible(false);
  }, [patchForm]);

  const openOneTimePicker = useCallback(() => {
    const current = parseScheduleAtToDate(form.scheduleAt);
    if (Platform.OS === 'android') {
      setAndroidDatePart(current);
      setAndroidAtPickerMode('date');
      setShowAtPicker(true);
      return;
    }
    setShowAtPicker((prev) => !prev);
  }, [form.scheduleAt]);

  const handleBackToNow = useCallback(() => {
    const now = new Date();
    patchForm({ scheduleAt: zeroSeconds(now).toISOString() });
    if (Platform.OS === 'android') {
      setAndroidDatePart(now);
    }
  }, [patchForm]);

  const handleOneTimePickerChange = useCallback((event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        setShowAtPicker(false);
        setAndroidAtPickerMode('date');
        return;
      }

      const picked = selectedDate ?? parseScheduleAtToDate(form.scheduleAt);
      if (androidAtPickerMode === 'date') {
        setAndroidDatePart(picked);
        setAndroidAtPickerMode('time');
        setShowAtPicker(true);
        return;
      }

      const base = androidDatePart ?? parseScheduleAtToDate(form.scheduleAt);
      const merged = new Date(base);
      merged.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      patchForm({ scheduleAt: zeroSeconds(merged).toISOString() });
      setShowAtPicker(false);
      setAndroidAtPickerMode('date');
      return;
    }

    if (selectedDate) {
      patchForm({ scheduleAt: zeroSeconds(selectedDate).toISOString() });
    }
  }, [androidAtPickerMode, androidDatePart, form.scheduleAt, patchForm]);

  const handlePayloadHelp = useCallback(() => {
    Alert.alert(
      t('Payload Types'),
      [
        t('Agent Turn:'),
        t('Spawns an isolated session to handle the task independently — like sending a clone to do the work.'),
        '',
        t('System Event:'),
        t('Injects a message into the main session — cuts in line to speak and act directly.'),
      ].join('\n'),
    );
  }, []);

  const loadEditJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const found = await findCronJobById(gateway, jobId, currentAgentId);
      if (!found) throw new Error('Cron job not found');
      const nextForm = formFromJob(found);
      setForm(nextForm);
      setInitialSnapshot(JSON.stringify(nextForm));
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load cron job';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentAgentId, gateway, jobId]);

  useEffect(() => {
    if (!editMode) {
      setForm(DEFAULT_FORM);
      setInitialSnapshot(JSON.stringify(DEFAULT_FORM));
      setLoading(false);
      setError(null);
      return;
    }
    loadEditJob().catch(() => {
      // Error state is handled in loadEditJob.
    });
  }, [editMode, loadEditJob]);

  usePreventRemove(isDirty && !saving, ({ data }) => {
    Alert.alert(t('Discard changes?'), t('You have unsaved changes.'), [
      { text: t('Keep Editing'), style: 'cancel' },
      {
        text: t('Discard'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const handleSave = useCallback(async () => {
    const validationMessage = validateForm(form, t);
    if (validationMessage) {
      Alert.alert(t('Validation'), validationMessage);
      return;
    }

    const schedule = scheduleFromForm(form);
    const payload = payloadFromForm(form);
    const delivery = deliveryFromForm(form);
    const name = form.name.trim();
    const description = form.description.trim();

    setSaving(true);
    try {
      if (editMode && jobId) {
        const patch: CronJobPatch = {
          name,
          description,
          enabled: form.enabled,
          deleteAfterRun: form.deleteAfterRun,
          schedule,
          sessionTarget: form.sessionTarget,
          wakeMode: form.wakeMode,
          payload,
          delivery,
        };
        await gateway.updateCronJob(jobId, patch);
        analyticsEvents.cronSaveSucceeded({
          is_editing: true,
          payload_kind: form.payloadKind,
          schedule_kind: schedule.kind,
          has_model_override: Boolean(
            form.payloadKind === 'agentTurn' && form.payloadModel.trim(),
          ),
          delivery_mode: form.deliveryMode,
          source: 'cron_editor',
        });
        Alert.alert(t('common:Saved'), t('Cron job updated.'));
        navigation.goBack();
      } else {
        const createPayload: CronJobCreate = {
          name,
          description: description || undefined,
          agentId: currentAgentId,
          enabled: form.enabled,
          deleteAfterRun: form.deleteAfterRun,
          schedule,
          sessionTarget: form.sessionTarget,
          wakeMode: form.wakeMode,
          payload,
          delivery,
        };
        const created = await gateway.addCronJob(createPayload);
        analyticsEvents.cronSaveSucceeded({
          is_editing: false,
          payload_kind: form.payloadKind,
          schedule_kind: schedule.kind,
          has_model_override: Boolean(
            form.payloadKind === 'agentTurn' && form.payloadModel.trim(),
          ),
          delivery_mode: form.deliveryMode,
          source: 'cron_editor',
        });
        Alert.alert(t('common:Saved'), t('Cron job created.'), [
          {
            text: t('common:Close'),
            onPress: () => {
              navigation.replace('CronDetail', { jobId: created.id });
              scheduleAutomaticAppReview('cron_created');
            },
          },
        ]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to save cron job');
      Alert.alert(t('Save failed'), message);
    } finally {
      setSaving(false);
    }
  }, [currentAgentId, editMode, form, gateway, jobId, navigation]);

  useEffect(() => {
    handleSaveRef.current = () => {
      void handleSave();
    };
  }, [handleSave]);

  useLayoutEffect(() => {
    const options: NativeStackNavigationOptions = {
      headerShown: true,
      headerBackVisible: false,
      headerShadowVisible: false,
      headerTitle: editMode ? t('Edit Cron Job') : t('New Cron Job'),
      headerTitleAlign: 'center',
      headerStyle: {
        backgroundColor: theme.colors.surface,
      },
      headerTitleStyle: {
        color: theme.colors.text,
        fontSize: 16,
        fontWeight: '600',
      },
      headerLeft: () => (
        <View style={styles.headerLeftSlot}>
          <HeaderActionButton icon={X} onPress={() => navigation.goBack()} size={20} />
        </View>
      ),
      headerRight: () => (
        <View style={styles.headerRightSlot}>
          <HeaderTextAction
            label={saving ? t('common:Saving...') : t('common:Save')}
            onPress={() => handleSaveRef.current()}
            disabled={saving}
          />
        </View>
      ),
    };

    navigation.setOptions(options);
  }, [editMode, navigation, saving, theme.colors.surface, theme.colors.text]);

  if (loading) {
    return (
      <View style={styles.root}>
        <LoadingState message={t('Loading cron job...')} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.root}>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>{t('Failed to load cron job')}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadEditJob()}>
            <Text style={styles.retryText}>{t('common:Retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('General')}</Text>

          <Text style={styles.fieldLabel}>{t('Name *')}</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(value) => patchForm({ name: value })}
            placeholder={t('Daily standup reminder')}
            placeholderTextColor={theme.colors.textSubtle}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('Schedule')}</Text>

          <Text style={styles.fieldLabel}>{t('Schedule Type')}</Text>
          <SegmentedControl
            value={form.scheduleKind}
            options={[
              { label: t('One-time'), value: 'at' },
              { label: t('Interval'), value: 'every' },
              { label: t('Cron Expr'), value: 'cron' },
            ]}
            onChange={(next) => patchForm({ scheduleKind: next })}
            styles={styles}
          />

          {form.scheduleKind === 'at' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Run At (Local)')}</Text>
              <View style={styles.localDateCard}>
                <Text style={styles.localDateText}>{formatScheduleAtLocal(form.scheduleAt)}</Text>
                <Text style={styles.localDateHint}>Stored as ISO (UTC): {form.scheduleAt}</Text>
              </View>
              <View style={styles.pickerWrap}>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={parseScheduleAtToDate(form.scheduleAt)}
                    mode="datetime"
                    display="spinner"
                    onChange={handleOneTimePickerChange}
                  />
                ) : (
                  <TouchableOpacity style={styles.pickerButton} onPress={() => openOneTimePicker()}>
                    <Text style={styles.pickerButtonText}>{t('Pick Date & Time')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {Platform.OS === 'android' && showAtPicker ? (
                <DateTimePicker
                  value={
                    androidAtPickerMode === 'time' && androidDatePart
                      ? androidDatePart
                      : parseScheduleAtToDate(form.scheduleAt)
                  }
                  mode={androidAtPickerMode}
                  display="default"
                  onChange={handleOneTimePickerChange}
                />
              ) : null}
            </>
          ) : null}

          {form.scheduleKind === 'every' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Interval')}</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={form.everyAmount}
                  onChangeText={(value) => patchForm({ everyAmount: value })}
                  placeholder="30"
                  placeholderTextColor={theme.colors.textSubtle}
                  keyboardType="decimal-pad"
                />
                <View style={styles.inlineSegmentWrap}>
                  <SegmentedControl
                    value={form.everyUnit}
                    options={[
                      { label: 'Min', value: 'minutes' },
                      { label: 'Hour', value: 'hours' },
                      { label: 'Day', value: 'days' },
                    ]}
                    onChange={(next) => patchForm({ everyUnit: next })}
                    styles={styles}
                  />
                </View>
              </View>
            </>
          ) : null}

          {form.scheduleKind === 'cron' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Cron Expression')}</Text>
              <CronFieldsInput
                value={form.cronExpr}
                onChange={(expr) => patchForm({ cronExpr: expr })}
                styles={styles}
              />
              <CronHint expr={form.cronExpr} styles={styles} />
              <CronGuide styles={styles} />
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>{t('Payload')}</Text>
            <TouchableOpacity
              style={styles.sectionHelpButton}
              onPress={() => handlePayloadHelp()}
              hitSlop={10}
            >
              <CircleHelp size={16} color={theme.colors.textMuted} strokeWidth={2.1} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>{t('Payload Type')}</Text>
          <SegmentedControl
            value={form.payloadKind}
            options={[
              { label: t('Agent Turn'), value: 'agentTurn' },
              { label: t('System Event'), value: 'systemEvent' },
            ]}
            onChange={(next) => patchForm({ payloadKind: next })}
            styles={styles}
          />

          <Text style={styles.fieldLabel}>{form.payloadKind === 'agentTurn' ? t('Message *') : t('Text *')}</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={form.payloadText}
            onChangeText={(value) => patchForm({ payloadText: value })}
            placeholder={form.payloadKind === 'agentTurn' ? t('Write the agent task...') : t('System event text...')}
            placeholderTextColor={theme.colors.textSubtle}
            multiline
            textAlignVertical="top"
          />

          {form.payloadKind === 'agentTurn' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Model Override')}</Text>
              <TouchableOpacity style={styles.modelPickerRow} onPress={() => openModelPicker()} activeOpacity={0.7}>
                <Text style={form.payloadModel ? styles.modelPickerValue : styles.modelPickerPlaceholder} numberOfLines={1}>
                  {form.payloadModel || 'Default'}
                </Text>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('Delivery')}</Text>

          <Text style={styles.fieldLabel}>{t('Mode')}</Text>
          <SegmentedControl
            value={form.deliveryMode}
            options={[
              { label: t('None'), value: 'none' },
              { label: t('Announce'), value: 'announce' },
              { label: t('Webhook'), value: 'webhook' },
            ]}
            onChange={(next) => patchForm({ deliveryMode: next })}
            styles={styles}
          />

          {form.deliveryMode !== 'none' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Channel')}</Text>
              <TextInput
                style={styles.input}
                value={form.deliveryChannel}
                onChangeText={(value) => patchForm({ deliveryChannel: value })}
                placeholder="last or channel id (optional)"
                placeholderTextColor={theme.colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : null}

          {form.deliveryMode === 'announce' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Target')}</Text>
              <TextInput
                style={styles.input}
                value={form.deliveryTo}
                onChangeText={(value) => patchForm({ deliveryTo: value })}
                placeholder={t('Optional target')}
                placeholderTextColor={theme.colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : null}

          {form.deliveryMode === 'webhook' ? (
            <>
              <Text style={styles.fieldLabel}>{t('Webhook URL *')}</Text>
              <TextInput
                style={styles.input}
                value={form.deliveryTo}
                onChangeText={(value) => patchForm({ deliveryTo: value })}
                placeholder="https://example.com/hook"
                placeholderTextColor={theme.colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : null}
        </View>

        <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowAdvanced((prev) => !prev)} activeOpacity={0.7}>
          {showAdvanced
            ? <ChevronDown size={16} color={theme.colors.textMuted} strokeWidth={2.1} />
            : <ChevronRight size={16} color={theme.colors.textMuted} strokeWidth={2.1} />}
          <Text style={styles.advancedToggleText}>{t('Advanced Settings')}</Text>
        </TouchableOpacity>

        {showAdvanced ? (
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>{t('Description')}</Text>
            <TextInput
              style={styles.input}
              value={form.description}
              onChangeText={(value) => patchForm({ description: value })}
              placeholder={t('Optional details')}
              placeholderTextColor={theme.colors.textSubtle}
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabelSwitch}>{t('Enabled')}</Text>
              <Switch
                value={form.enabled}
                onValueChange={(value) => patchForm({ enabled: value })}
                trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
                thumbColor={theme.colors.iconOnColor}
              />
            </View>

            {form.scheduleKind === 'cron' ? (
              <>
                <Text style={styles.fieldLabel}>{t('Timezone')}</Text>
                <TextInput
                  style={styles.input}
                  value={form.cronTz}
                  onChangeText={(value) => patchForm({ cronTz: value })}
                  placeholder={t('UTC (optional)')}
                  placeholderTextColor={theme.colors.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>{t('Session Target')}</Text>
            <SegmentedControl
              value={form.sessionTarget}
              options={[
                { label: t('Main'), value: 'main' },
                { label: t('Isolated'), value: 'isolated' },
              ]}
              onChange={(next) => patchForm({ sessionTarget: next })}
              styles={styles}
            />

            <Text style={styles.fieldLabel}>{t('Wake Mode')}</Text>
            <SegmentedControl
              value={form.wakeMode}
              options={[
                { label: t('Next Heartbeat'), value: 'next-heartbeat' },
                { label: t('Now'), value: 'now' },
              ]}
              onChange={(next) => patchForm({ wakeMode: next })}
              styles={styles}
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabelSwitch}>{t('Delete After Run')}</Text>
              <Switch
                value={form.deleteAfterRun}
                onValueChange={(value) => patchForm({ deleteAfterRun: value })}
                trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
                thumbColor={theme.colors.iconOnColor}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <ModelPickerModal
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        title={t('Model Override')}
        models={models}
        loading={modelsLoading}
        selectedModelId={form.payloadModel || undefined}
        showDefault
        onSelectModel={selectModel}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerLeftSlot: {
      minWidth: 44,
      alignItems: 'flex-start',
    },
    headerRightSlot: {
      width: 56,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    content: {
      ...createCardContentStyle({ bottom: HitSize.md }),
      gap: Space.md,
    },
    section: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.md,
      gap: 8,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
      marginBottom: 2,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    sectionHelpButton: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.sm + 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    fieldLabel: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      marginTop: 2,
    },
    fieldLabelSwitch: {
      color: colors.text,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.semibold,
    },
    input: {
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      color: colors.text,
      paddingHorizontal: Space.md,
      paddingVertical: 9,
      fontSize: FontSize.md + 1,
    },
    localDateCard: {
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: 10,
      gap: Space.xs,
    },
    localDateText: {
      color: colors.text,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.semibold,
    },
    localDateHint: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
    },
    nowButton: {
      marginTop: 2,
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      paddingVertical: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nowButtonText: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
    },
    pickerButton: {
      marginTop: 2,
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      paddingVertical: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerButtonText: {
      color: colors.primary,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
    },
    pickerWrap: {
      marginTop: 2,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      paddingTop: Platform.OS === 'ios' ? Space.sm : 0,
    },
    pickerDoneButton: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingVertical: Space.md - 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    pickerDoneText: {
      color: colors.primary,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
    },
    textarea: {
      minHeight: Space.xxxl * 2,
      paddingTop: 10,
    },
    modelPickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: 9,
    },
    modelPickerValue: {
      color: colors.text,
      fontSize: FontSize.md + 1,
      flex: 1,
    },
    modelPickerPlaceholder: {
      color: colors.textSubtle,
      fontSize: FontSize.md + 1,
      flex: 1,
    },
    advancedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingVertical: Space.xs,
    },
    advancedToggleText: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    switchRow: {
      marginTop: 4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    inlineInput: {
      width: 94,
    },
    inlineSegmentWrap: {
      flex: 1,
    },
    segmentWrap: {
      flexDirection: 'row',
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    segmentItem: {
      flex: 1,
      backgroundColor: colors.surfaceMuted,
      paddingVertical: Space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    segmentItemActive: {
      backgroundColor: colors.primarySoft,
    },
    segmentText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    segmentTextActive: {
      color: colors.primary,
      fontWeight: FontWeight.bold,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.lg + Space.xs,
    },
    stateText: {
      marginTop: 8,
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.bold,
      textAlign: 'center',
    },
    retryButton: {
      marginTop: Space.md,
      backgroundColor: colors.primary,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: 6,
    },
    retryText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    cronFieldsRow: {
      flexDirection: 'row',
      gap: Space.xs,
    },
    cronFieldCol: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    cronFieldLabel: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      textAlign: 'center',
    },
    cronFieldInput: {
      width: '100%',
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      color: colors.text,
      textAlign: 'center',
      paddingHorizontal: Space.xs,
      paddingVertical: 9,
      fontSize: FontSize.base,
    },
    cronGuideBox: {
      marginTop: Space.sm,
      borderRadius: Radius.sm,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Space.sm,
      paddingHorizontal: Space.md,
      gap: Space.xs,
      alignItems: 'center',
    },
    cronGuideRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
    },
    cronGuideItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    cronGuideSymbol: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.bold,
      color: colors.primary,
    },
    cronGuideMeaning: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginLeft: 3,
    },
    cronGuideSep: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      marginHorizontal: Space.sm,
    },
    cronGuideExample: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      textAlign: 'center',
    },
    cronHintBox: {
      marginTop: Space.xs,
      borderRadius: Radius.sm,
      backgroundColor: colors.surfaceMuted,
      paddingVertical: Space.sm,
      paddingHorizontal: Space.md,
      alignItems: 'center',
    },
    cronHint: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    cronHintError: {
      color: colors.error,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
  });
}
