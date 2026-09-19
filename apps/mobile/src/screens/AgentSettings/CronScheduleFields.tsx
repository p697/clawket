import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MenuView } from '@react-native-menu/menu';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SettingsRow } from '../../components/ui/SettingsGroup';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { describeScheduleHuman } from '../../utils/cron';
import { deviceTimeZone, formatCronDate, scheduleFromDraft, upcomingRuns, type Frequency, type ScheduleDraft } from './cron-schedule';

export function CronScheduleFields({ draft, onChange, editableTimeZone, disabled = false }: Readonly<{
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  editableTimeZone: boolean;
  disabled?: boolean;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation('settings');
  const { theme } = useAppTheme();
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [customZone, setCustomZone] = useState(false);
  const change = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const zones = [...new Set([draft.timezone, deviceTimeZone(), 'UTC', 'Asia/Tokyo', 'Asia/Shanghai', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Australia/Sydney'].filter(Boolean))];
  const time = new Date();
  time.setHours(draft.hour, draft.minute, 0, 0);
  const isOnce = draft.frequency === 'once';
  const pickerValue = isOnce ? new Date(draft.atMs) : time;
  const options: { key: Frequency; label: string }[] = [
    { key: 'daily', label: t('Daily') }, { key: 'weekly', label: t('Weekly') },
    { key: 'interval', label: t('Interval') }, { key: 'once', label: t('Once') },
  ];
  const days = [t('weekday_Mon'), t('weekday_Tue'), t('weekday_Wed'), t('weekday_Thu'), t('weekday_Fri'), t('weekday_Sat'), t('weekday_Sun')];
  return <View style={styles.section}>
    <View style={styles.options}>
      {options.map(option => <Button key={option.key} testID={`cron-frequency-${option.key}`} label={option.label}
        variant={draft.frequency === option.key ? 'primary' : 'secondary'} disabled={disabled}
        accessibilityState={{ selected: draft.frequency === option.key, disabled }}
        onPress={() => { setPicker(null); change({ frequency: option.key }); }} />)}
    </View>
    {draft.frequency === 'weekly' ? <View style={styles.section}>
      <Text style={[styles.label, { color: theme.colors.inkSecondary }]}>{t('Choose days')}</Text>
      <View style={styles.options}>{days.map((label, index) => {
        const day = (index + 1) % 7;
        const selected = draft.weekdays.includes(day);
        return <Button key={day} testID={`cron-weekday-${day}`} label={label}
          disabled={disabled} variant={selected ? 'primary' : 'secondary'}
          accessibilityState={{ selected, disabled }}
          onPress={() => change({ weekdays: selected ? draft.weekdays.filter(value => value !== day) : [...draft.weekdays, day] })} />;
      })}</View>
      <View style={styles.options}>
        <Button testID="cron-workdays" label={t('Workdays')} variant="ghost" disabled={disabled} onPress={() => change({ weekdays: [1, 2, 3, 4, 5] })} />
        <Button testID="cron-weekend" label={t('Weekend')} variant="ghost" disabled={disabled} onPress={() => change({ weekdays: [6, 0] })} />
      </View>
    </View> : null}
    {draft.frequency === 'interval' ? <View style={styles.interval}>
      <View style={styles.amount}><Text style={[styles.label, { color: theme.colors.inkSecondary }]}>{t('Every')}</Text>
        <FormTextInput testID="cron-interval-amount" accessibilityLabel={t('Every')} value={draft.amount}
          keyboardType="decimal-pad" editable={!disabled} onChangeText={amount => change({ amount })} />
      </View>
      <MenuView actions={[{ id: 'minutes', title: t('Minutes') }, { id: 'hours', title: t('Hours') }, { id: 'days', title: t('Days') }]}
        onPressAction={({ nativeEvent }) => {
          if (!disabled && ['minutes', 'hours', 'days'].includes(nativeEvent.event)) change({ unit: nativeEvent.event as ScheduleDraft['unit'] });
        }} themeVariant={theme.scheme}>
        <Button testID="cron-interval-unit" disabled={disabled} variant="secondary"
          label={draft.unit === 'minutes' ? t('Minutes') : draft.unit === 'hours' ? t('Hours') : t('Days')} />
      </MenuView>
    </View> : null}
    {draft.frequency === 'custom' ? <View style={styles.section}>
      <Text style={[styles.label, { color: theme.colors.inkSecondary }]}>{t('Cron expression')}</Text>
      <FormTextInput testID="agent-cron-schedule" accessibilityLabel={t('Cron expression')} value={draft.expression}
        autoCapitalize="none" autoCorrect={false} editable={!disabled} onChangeText={expression => change({ expression })} />
      <Text style={[styles.label, { color: theme.colors.inkSecondary }]}>{t('Use a five-field Cron expression.')}</Text>
    </View> : null}
    {isOnce ? <SettingsRow title={t('Date')} value={new Date(draft.atMs).toLocaleDateString(i18n?.resolvedLanguage)}
      testID="cron-date-open" disabled={disabled} showChevron onPress={() => setPicker('date')} /> : null}
    {['daily', 'weekly', 'once'].includes(draft.frequency) ? <SettingsRow title={t('Time')}
      testID="cron-time-open" disabled={disabled} showChevron onPress={() => setPicker('time')}
      value={isOnce ? new Date(draft.atMs).toLocaleTimeString(i18n?.resolvedLanguage, { hour: '2-digit', minute: '2-digit' }) : `${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`} /> : null}
    {picker ? <DateTimePicker testID="cron-date-time-picker" value={pickerValue} mode={picker}
      display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant={theme.scheme}
      minimumDate={picker === 'date' ? new Date() : undefined}
      onChange={(event, date) => {
        if (Platform.OS !== 'ios' || event.type === 'dismissed') setPicker(null);
        if (disabled || event.type === 'dismissed' || !date) return;
        if (isOnce) change({ atMs: date.getTime() });
        else change({ hour: date.getHours(), minute: date.getMinutes() });
      }} /> : null}
    {picker && Platform.OS === 'ios' ? <Button label={t('Done', { ns: 'common' })} variant="ghost" onPress={() => setPicker(null)} /> : null}
    {isOnce ? <SettingsRow title={t('Timezone')} value={deviceTimeZone()} />
      : draft.frequency !== 'interval' ? editableTimeZone ? <View>
        <MenuView themeVariant={theme.scheme} actions={[
          { id: '', title: t('Agent timezone') }, ...zones.map(zone => ({ id: zone, title: zone })), { id: 'custom', title: t('Custom') },
        ]} onPressAction={({ nativeEvent }) => {
          if (disabled) return;
          if (nativeEvent.event === 'custom') setCustomZone(true);
          else { setCustomZone(false); change({ timezone: nativeEvent.event }); }
        }}>
          <SettingsRow testID="cron-timezone-menu" title={t('Timezone')} value={draft.timezone || t('Agent timezone')} disabled={disabled} showChevron />
        </MenuView>
        {customZone ? <FormTextInput testID="cron-timezone" accessibilityLabel={t('Timezone')} value={draft.timezone}
          autoCapitalize="none" autoCorrect={false} editable={!disabled} onChangeText={timezone => change({ timezone })} /> : null}
      </View> : <SettingsRow title={t('Timezone')} value={t('Agent timezone')} /> : null}
  </View>;
}

export function CronSchedulePreview({ draft }: Readonly<{ draft: ScheduleDraft }>): React.JSX.Element {
  const { t, i18n } = useTranslation('settings');
  const { theme } = useAppTheme();
  const now = useMemo(() => Date.now(), [draft]);
  const schedule = useMemo(() => scheduleFromDraft(draft), [draft]);
  const dates = useMemo(() => upcomingRuns(schedule, now), [now, schedule]);
  // Borderless: the grey box is reserved for editable inputs; the timezone row above already names the zone.
  return <View testID="cron-schedule-preview" style={styles.preview} accessibilityLiveRegion="polite">
    <Text style={[styles.body, { color: theme.colors.ink }]}>{describeScheduleHuman(schedule, t)}</Text>
    <Text style={[styles.label, { color: theme.colors.inkSecondary }]}>{schedule.kind === 'cron' && !schedule.tz
      ? t('Execution times use the Agent timezone.') : t('Estimated next runs')}</Text>
    {dates.map(date => <Text key={date.getTime()} style={[styles.label, { color: theme.colors.ink }]}>
      {formatCronDate(date.getTime(), i18n?.resolvedLanguage, schedule.kind === 'cron' ? schedule.tz : undefined)}
    </Text>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Space.md },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  interval: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.md },
  amount: { flex: 1, gap: Space.sm },
  label: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  body: { fontSize: FontSize.body, lineHeight: LineHeight.body },
  preview: { gap: Space.xs },
});
