import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { HeaderTextAction, LoadingState, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { parseHermesCronSkills } from '../../utils/hermes-cron';
import type { ConsoleStackParamList } from './ConsoleTab';

type Navigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronEditor'>;
type Route = RouteProp<ConsoleStackParamList, 'CronEditor'>;

export function HermesCronEditorScreen(): React.JSX.Element {
  const { gateway } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const jobId = route.params?.jobId;
  const isEditing = Boolean(jobId);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [prompt, setPrompt] = useState('');
  const [deliver, setDeliver] = useState('local');
  const [skillsInput, setSkillsInput] = useState('');
  const [repeatInput, setRepeatInput] = useState('');
  const [script, setScript] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!jobId) return;
    (async () => {
      try {
        const job = await gateway.getHermesCronJob(jobId);
        if (!job || cancelled) return;
        setName(job.name);
        setSchedule(job.schedule_display || job.schedule.expr || '');
        setPrompt(job.prompt || '');
        setDeliver(job.deliver || 'local');
        setSkillsInput(job.skills.join(', '));
        setRepeatInput(job.repeat.times != null ? String(job.repeat.times) : '');
        setScript(job.script || '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gateway, jobId]);

  const handleSave = useCallback(async () => {
    const normalizedName = name.trim();
    const normalizedSchedule = schedule.trim();
    const normalizedPrompt = prompt.trim();
    const normalizedSkills = parseHermesCronSkills(skillsInput);
    if (!normalizedName) {
      Alert.alert(t('Validation error'), t('Task name is required.'));
      return;
    }
    if (!normalizedSchedule) {
      Alert.alert(t('Validation error'), t('Schedule is required.'));
      return;
    }
    if (!normalizedPrompt && normalizedSkills.length === 0) {
      Alert.alert(t('Validation error'), t('Add a prompt or at least one skill.'));
      return;
    }

    const repeat = repeatInput.trim() ? Number(repeatInput.trim()) : null;
    try {
      setSaving(true);
      const payload = {
        name: normalizedName,
        schedule: normalizedSchedule,
        prompt: normalizedPrompt,
        deliver: deliver.trim() || 'local',
        skills: normalizedSkills,
        repeat: Number.isFinite(repeat) && repeat != null && repeat > 0 ? repeat : null,
        script: script.trim(),
      };
      const saved = isEditing && jobId
        ? await gateway.updateHermesCronJob(jobId, payload)
        : await gateway.createHermesCronJob(payload);
      analyticsEvents.cronSaveSucceeded({
        is_editing: isEditing,
        payload_kind: 'hermes',
        schedule_kind: normalizedSchedule.startsWith('every ')
          ? 'interval'
          : /^\d{4}-\d{2}-\d{2}|T/.test(normalizedSchedule)
            ? 'once'
            : normalizedSchedule.includes(' ')
              ? 'cron'
              : 'duration',
        has_model_override: false,
        delivery_mode: payload.deliver,
        source: isEditing ? 'hermes_cron_editor_edit' : 'hermes_cron_editor_create',
      });
      if (saved?.id) {
        navigation.replace('CronDetail', { jobId: saved.id });
      } else {
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert(
        t('Failed to save scheduled task'),
        err instanceof Error ? err.message : t('Unknown error'),
      );
    } finally {
      setSaving(false);
    }
  }, [deliver, gateway, isEditing, jobId, name, navigation, prompt, repeatInput, schedule, script, skillsInput, t]);

  const headerRight = useMemo(
    () => (
      <HeaderTextAction
        label={saving ? t('Saving...') : t('common:Save')}
        onPress={() => { void handleSave(); }}
        disabled={saving}
      />
    ),
    [handleSave, saving, t],
  );

  useNativeStackModalHeader({
    navigation,
    title: isEditing ? t('Edit Task') : t('Create Task'),
    rightContent: headerRight,
    onClose: () => navigation.goBack(),
  });

  if (loading) {
    return <LoadingState message={t('Loading scheduled task...')} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t('Task Basics')}</Text>
        <FormField
          label={t('Task name')}
          value={name}
          onChangeText={setName}
          placeholder={t('Morning digest')}
        />
        <FormField
          label={t('Schedule')}
          value={schedule}
          onChangeText={setSchedule}
          placeholder={t('30m / every 2h / 0 9 * * *')}
        />
        <Text style={styles.helperText}>{t('Use durations, "every ..." intervals, cron expressions, or ISO timestamps.')}</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t('Prompt')}</Text>
        <FormField
          label={t('Task prompt')}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder={t('Describe what Hermes should do each time this task runs.')}
        />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t('Options')}</Text>
        <FormField
          label={t('Delivery target')}
          value={deliver}
          onChangeText={setDeliver}
          placeholder={t('local / origin / telegram')}
        />
        <Text style={styles.helperText}>{t('Examples: local, origin, telegram, discord:#ops')}</Text>
        <FormField
          label={t('Skills (comma separated)')}
          value={skillsInput}
          onChangeText={setSkillsInput}
          placeholder={t('blogwatcher, morning-brief')}
        />
        <FormField
          label={t('Repeat count (optional)')}
          value={repeatInput}
          onChangeText={setRepeatInput}
          keyboardType="number-pad"
          placeholder={t('Leave blank to run forever')}
        />
        <FormField
          label={t('Script path')}
          value={script}
          onChangeText={setScript}
          placeholder={t('fetch_status.py')}
        />
        <Text style={styles.helperText}>{t('Scripts must live under ~/.hermes/scripts/.')}</Text>
      </View>
    </ScrollView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
}) {
  const { theme } = useAppTheme();
  return (
    <View style={fieldStyles.root}>
      <Text style={[fieldStyles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[
          fieldStyles.input,
          {
            color: theme.colors.text,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          },
          multiline ? fieldStyles.multiline : null,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textSubtle}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  root: {
    gap: 6,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    fontSize: FontSize.base,
  },
  multiline: {
    minHeight: 140,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      ...createCardContentStyle({ bottom: Space.xxxl }),
      gap: Space.md,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.lg,
      padding: Space.lg,
      gap: Space.md,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
    },
    helperText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
  });
}
