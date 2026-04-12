import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Pencil, Play, Pause, RefreshCw, Trash2 } from 'lucide-react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { EmptyState, HeaderActionButton, LoadingState, ModalSheet, ScreenHeader, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { loadGatewayHermesCronDetail } from '../../services/gateway-hermes-cron';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { HermesCronJob, HermesCronOutputDetail, HermesCronOutputEntry } from '../../types/hermes-cron';
import { formatRelativeTime } from '../../utils/cron';
import {
  describeHermesCronSchedule,
  formatHermesCronRepeat,
  getHermesCronStateLabel,
  getHermesCronStatusTone,
} from '../../utils/hermes-cron';
import type { ConsoleStackParamList } from './ConsoleTab';
import { HermesCronOutputSheetContent } from './HermesCronOutputSheetContent';

type Navigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronDetail'>;
type Route = RouteProp<ConsoleStackParamList, 'CronDetail'>;

export function HermesCronDetailScreen(): React.JSX.Element {
  const { gateway } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [job, setJob] = useState<HermesCronJob | null>(null);
  const [outputs, setOutputs] = useState<HermesCronOutputEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<HermesCronOutputDetail | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const bundle = await loadGatewayHermesCronDetail(gateway, route.params.jobId);
      setJob(bundle.job);
      setOutputs(bundle.outputs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load scheduled task'));
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, route.params.jobId, t]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const headerRight = useMemo(() => (
    <>
      <HeaderActionButton
        icon={Pencil}
        onPress={() => navigation.navigate('CronEditor', { jobId: route.params.jobId })}
        size={19}
      />
      <HeaderActionButton
        icon={RefreshCw}
        onPress={() => { void load('refresh'); }}
        disabled={refreshing || busyAction !== null}
        size={19}
      />
    </>
  ), [busyAction, load, navigation, refreshing, route.params.jobId]);

  const runAction = useCallback(async (action: 'run' | 'pause' | 'resume' | 'delete') => {
    if (!job) return;
    try {
      setBusyAction(action);
      if (action === 'run') {
        await gateway.runHermesCronJob(job.id);
      } else if (action === 'pause') {
        await gateway.pauseHermesCronJob(job.id);
      } else if (action === 'resume') {
        await gateway.resumeHermesCronJob(job.id);
      } else {
        const removed = await gateway.removeHermesCronJob(job.id);
        if (removed) {
          navigation.goBack();
          return;
        }
      }
      await load('refresh');
    } finally {
      setBusyAction(null);
    }
  }, [gateway, job, load, navigation]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      t('Delete Task'),
      t('Delete this scheduled task?'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        { text: t('common:Delete'), style: 'destructive', onPress: () => { void runAction('delete'); } },
      ],
    );
  }, [runAction, t]);

  const openOutput = useCallback(async (entry: HermesCronOutputEntry) => {
    try {
      setOutputLoading(true);
      const detail = await gateway.getHermesCronOutput(entry.jobId, entry.fileName);
      setSelectedOutput(detail);
    } finally {
      setOutputLoading(false);
    }
  }, [gateway]);

  if (loading) {
    return <LoadingState message={t('Loading scheduled task...')} />;
  }

  if (!job) {
    return (
      <EmptyState
        icon="⏰"
        title={error ? t('Failed to load scheduled task') : t('Scheduled task not found')}
        subtitle={error ?? undefined}
      />
    );
  }

  const tone = getHermesCronStatusTone(job);
  const toneColor = tone === 'error'
    ? theme.colors.error
    : tone === 'warning'
      ? theme.colors.warning
      : tone === 'success'
        ? theme.colors.success
        : theme.colors.textSubtle;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={job?.name || t('Scheduled Task')}
        topInset={insets.top}
        onBack={() => navigation.goBack()}
        dismissStyle="close"
        rightContent={headerRight}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load('refresh'); }} tintColor={theme.colors.primary} />}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>{job.name}</Text>
          <Text style={[styles.heroStatus, { color: toneColor }]}>{getHermesCronStateLabel(job)}</Text>
          <Text style={styles.heroMeta}>{describeHermesCronSchedule(job)}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.actionButton}
              activeOpacity={0.75}
              onPress={() => { void runAction('run'); }}
              disabled={busyAction !== null}
            >
              <Play size={14} color={theme.colors.primary} strokeWidth={2.2} />
              <Text style={styles.actionButtonLabel}>{t('Run now')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              activeOpacity={0.75}
              onPress={() => { void runAction(job.state === 'paused' ? 'resume' : 'pause'); }}
              disabled={busyAction !== null}
            >
              <Pause size={14} color={theme.colors.primary} strokeWidth={2.2} />
              <Text style={styles.actionButtonLabel}>{job.state === 'paused' ? t('Resume') : t('Pause')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              activeOpacity={0.75}
              onPress={confirmDelete}
              disabled={busyAction !== null}
            >
              <Trash2 size={14} color={theme.colors.error} strokeWidth={2.2} />
              <Text style={[styles.actionButtonLabel, { color: theme.colors.error }]}>{t('Delete')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('Configuration')}</Text>
          <DetailRow label={t('Schedule')} value={describeHermesCronSchedule(job)} />
          <DetailRow label={t('Delivery')} value={job.deliver || 'local'} />
          <DetailRow label={t('Repeat')} value={formatHermesCronRepeat(job)} />
          <DetailRow label={t('Created')} value={job.created_at ? new Date(job.created_at).toLocaleString() : t('Unavailable')} />
          <DetailRow label={t('Next run')} value={job.next_run_at ? new Date(job.next_run_at).toLocaleString() : t('Unavailable')} />
          <DetailRow label={t('Last run')} value={job.last_run_at ? new Date(job.last_run_at).toLocaleString() : t('Not yet run')} />
          <DetailRow label={t('Last status')} value={job.last_status || t('Unavailable')} />
          {job.last_error ? <DetailRow label={t('Last error')} value={job.last_error} danger /> : null}
          {job.last_delivery_error ? <DetailRow label={t('Delivery error')} value={job.last_delivery_error} danger /> : null}
          <DetailRow label={t('Skills')} value={job.skills.length > 0 ? job.skills.join(', ') : t('No skills attached')} />
          <DetailRow label={t('Script path')} value={job.script || t('No script attached')} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('Prompt')}</Text>
          <Text style={styles.bodyText}>{job.prompt || t('No prompt configured')}</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('Execution Records')}</Text>
          {outputs.length === 0 ? (
            <EmptyState icon="📄" title={t('No execution records yet')} />
          ) : (
            outputs.map((entry) => (
              <TouchableOpacity
                key={`${entry.jobId}:${entry.fileName}`}
                style={styles.outputCard}
                activeOpacity={0.75}
                onPress={() => { void openOutput(entry); }}
              >
                <View style={styles.outputHeader}>
                  <Text style={styles.outputTitle}>{formatRelativeTime(entry.createdAt)}</Text>
                  <Text style={[
                    styles.outputStatus,
                    { color: entry.status === 'error' ? theme.colors.error : theme.colors.success },
                  ]}
                  >
                    {entry.status === 'error' ? t('Failed') : t('Succeeded')}
                  </Text>
                </View>
                <Text style={styles.outputPreview} numberOfLines={3}>
                  {entry.preview || t('No response body saved')}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      <ModalSheet
        visible={Boolean(selectedOutput) || outputLoading}
        onClose={() => {
          setSelectedOutput(null);
          setOutputLoading(false);
        }}
        title={selectedOutput?.jobName ?? t('Execution Record')}
        maxHeight="80%"
      >
        {outputLoading ? (
          <LoadingState message={t('Loading execution record...')} />
        ) : selectedOutput ? (
          <HermesCronOutputSheetContent output={selectedOutput} />
        ) : (
          <EmptyState icon="📄" title={t('Execution record unavailable')} />
        )}
      </ModalSheet>
    </View>
  );
}

function DetailRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={[detailStyles.value, { color: danger ? theme.colors.error : theme.colors.text }]}>{value}</Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: {
    gap: 4,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: '#6B7280',
  },
  value: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    content: {
      ...createCardContentStyle({ bottom: Space.xxxl }),
      gap: Space.md,
    },
    heroCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.lg,
      padding: Space.lg,
      gap: Space.sm,
    },
    heroTitle: {
      color: colors.text,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
    },
    heroStatus: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      textTransform: 'capitalize',
    },
    heroMeta: {
      color: colors.textMuted,
      fontSize: FontSize.base,
    },
    buttonRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
      marginTop: Space.xs,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    deleteButton: {
      borderColor: colors.error,
    },
    actionButtonLabel: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.lg,
      padding: Space.lg,
      gap: Space.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
    },
    bodyText: {
      color: colors.text,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    outputCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.xs,
      backgroundColor: colors.background,
    },
    outputHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: Space.sm,
      alignItems: 'center',
    },
    outputTitle: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    outputStatus: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    outputPreview: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
  });
}
