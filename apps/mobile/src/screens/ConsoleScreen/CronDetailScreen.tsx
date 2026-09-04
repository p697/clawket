import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MessageCircleQuestion, Pencil, Play, Trash2 } from 'lucide-react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import {
  HeaderActionButton,
  LoadingState,
  ScreenHeader,
  ThemedSwitch,
  createCardContentStyle,
} from '../../components/ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { CronDeliveryStatus, CronJob, CronRunLogEntry, CronRunStatus } from '../../types';
import {
  describeScheduleHuman,
  formatDurationMs,
  formatRelativeTime,
  formatTimestamp,
  formatRunStatusSymbol,
  truncateText,
} from '../../utils/cron';
import type { ConsoleStackParamList } from './ConsoleTab';
import { findCronJobById } from './cronData';

type CronDetailNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronDetail'>;
type CronDetailRoute = RouteProp<ConsoleStackParamList, 'CronDetail'>;

const RUNS_PAGE_SIZE = 20;

function deliveryStatusText(
  status: CronDeliveryStatus | undefined,
  delivered: boolean | undefined,
  t: (key: string) => string,
): string {
  if (status === 'delivered' || (status == null && delivered === true)) return t('Delivered');
  if (status === 'not-requested') return t('No delivery configured');
  if (status === 'not-delivered') return t('Delivery not completed');
  return t('Delivery unconfirmed');
}

function deliveryStatusColor(
  status: CronDeliveryStatus | undefined,
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): string {
  if (status === 'delivered') return colors.success;
  return colors.textSubtle;
}

function runStatusColor(
  status: CronRunStatus | undefined,
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): string {
  if (status === 'ok') return colors.success;
  if (status === 'error') return colors.error;
  return colors.textSubtle;
}

function payloadPreview(job: CronJob): string {
  if (job.payload.kind === 'systemEvent') return job.payload.text;
  return job.payload.message;
}

export function CronDetailScreen(): React.JSX.Element {
  const { gateway, currentAgentId, requestChatWithInput } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<CronDetailNavigation>();
  const route = useRoute<CronDetailRoute>();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { jobId } = route.params;

  const [job, setJob] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<CronRunLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runsHasMore, setRunsHasMore] = useState(false);
  const [runsNextOffset, setRunsNextOffset] = useState<number | null>(null);
  const [runsLoadingMore, setRunsLoadingMore] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadRuns = useCallback(async (offset: number, append: boolean) => {
    const page = await gateway.listCronRuns({
      scope: 'job',
      id: jobId,
      limit: RUNS_PAGE_SIZE,
      offset,
      sortDir: 'desc',
    });
    setRuns((prev) => (append ? [...prev, ...page.entries] : page.entries));
    setRunsHasMore(page.hasMore);
    setRunsNextOffset(page.nextOffset);
  }, [gateway, jobId]);

  const loadDetail = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const found = await findCronJobById(gateway, jobId, currentAgentId);
      if (!found) throw new Error('Cron job not found');
      setJob(found);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load cron job';
      setError(message);
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
      return;
    }

    try {
      await loadRuns(0, false);
      setRunsError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load run history';
      setRuns([]);
      setRunsHasMore(false);
      setRunsNextOffset(null);
      setRunsError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [currentAgentId, gateway, jobId, loadRuns]);

  useFocusEffect(
    useCallback(() => {
      loadDetail('initial').catch(() => {
        // Error state is handled in loadDetail.
      });
    }, [loadDetail]),
  );

  const handleToggleEnabled = useCallback(async () => {
    if (!job || togglingEnabled) return;
    const nextEnabled = !job.enabled;
    setTogglingEnabled(true);
    try {
      const updated = await gateway.updateCronJob(job.id, { enabled: nextEnabled });
      setJob(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      Alert.alert(t('Update failed'), message);
    } finally {
      setTogglingEnabled(false);
    }
  }, [gateway, job, togglingEnabled]);

  const handleRunNow = useCallback(async () => {
    if (!job || running) return;
    setRunning(true);
    try {
      await gateway.runCronJob(job.id, 'force');
      Alert.alert(t('Run requested'), t('Cron job has been triggered.'));
      await loadDetail('refresh');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run cron job';
      Alert.alert(t('Run failed'), message);
    } finally {
      setRunning(false);
    }
  }, [gateway, job, loadDetail, running]);

  const deleteJob = useCallback(async () => {
    if (!job || deleting) return;
    setDeleting(true);
    try {
      await gateway.removeCronJob(job.id);
      navigation.goBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete cron job';
      Alert.alert(t('Delete failed'), message);
    } finally {
      setDeleting(false);
    }
  }, [deleting, gateway, job, navigation]);

  const handleDeletePress = useCallback(() => {
    if (!job || deleting) return;
    Alert.alert(
      t('Delete cron job "{{name}}"?', { name: job.name }),
      t('This cannot be undone.'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('common:Delete'),
          style: 'destructive',
          onPress: () => {
            deleteJob().catch(() => {
              // Error state is handled in deleteJob.
            });
          },
        },
      ],
    );
  }, [deleteJob, deleting, job]);

  const handleLoadMoreRuns = useCallback(async () => {
    if (!runsHasMore || runsNextOffset === null || runsLoadingMore) return;
    setRunsLoadingMore(true);
    try {
      await loadRuns(runsNextOffset, true);
      setRunsError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load more runs';
      setRunsError(message);
    } finally {
      setRunsLoadingMore(false);
    }
  }, [loadRuns, runsHasMore, runsLoadingMore, runsNextOffset]);

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="" topInset={insets.top} onBack={() => navigation.goBack()} dismissStyle="close" />
        <LoadingState message={t('Loading cron job...')} />
      </View>
    );
  }

  if (error || !job) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="" topInset={insets.top} onBack={() => navigation.goBack()} dismissStyle="close" />
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>{t('Failed to load cron job')}</Text>
          <Text style={styles.stateText}>{error ?? t('Unknown error')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadDetail('initial')}>
            <Text style={styles.retryText}>{t('common:Retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title=""
        topInset={insets.top}
        onBack={() => navigation.goBack()}
        dismissStyle="close"
        rightSlotStyle={styles.headerActions}
        rightContent={(
          <View style={styles.headerActionsRow}>
            <HeaderActionButton
              icon={Pencil}
              onPress={() => navigation.navigate('CronEditor', { jobId: job.id })}
              size={20}
              buttonSize={40}
            />
            <HeaderActionButton
              icon={Play}
              onPress={() => handleRunNow()}
              disabled={running || deleting}
              tone="default"
              size={20}
              buttonSize={40}
            />
            <HeaderActionButton
              icon={Trash2}
              onPress={() => handleDeletePress()}
              disabled={deleting}
              size={20}
              buttonSize={40}
            />
          </View>
        )}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadDetail('refresh')}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeadingRow}>
            <Text style={styles.heroTitle}>{job.name}</Text>
            {job.deleteAfterRun ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t('Deletes after run')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.heroMeta}>{t('Cron {{id}}', { id: job.id })}</Text>
          <Text style={styles.heroSummary}>{describeScheduleHuman(job.schedule, t)}</Text>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('Info')}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Status')}</Text>
            <View style={styles.statusToggleWrap}>
              <Text style={styles.infoValue}>{job.enabled ? t('Enabled') : t('Disabled')}</Text>
              <ThemedSwitch
                value={job.enabled}
                onValueChange={handleToggleEnabled}
                disabled={togglingEnabled || deleting}
              />
            </View>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Schedule')}</Text>
            <Text style={styles.infoValue}>{describeScheduleHuman(job.schedule, t)}</Text>
          </View>

          {job.delivery?.channel ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('Delivery Channel')}</Text>
              <Text style={styles.infoValue}>{job.delivery.channel}</Text>
            </View>
          ) : null}

          {job.wakeMode !== 'now' ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('Wake mode')}</Text>
              <Text style={styles.infoValue}>{job.wakeMode}</Text>
            </View>
          ) : null}

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Payload')}</Text>
            <Text style={styles.infoValue}>{truncateText(payloadPreview(job), 220)}</Text>
          </View>

          {job.payload.kind === 'agentTurn' && job.payload.model ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('Model')}</Text>
              <Text style={styles.infoValue}>{job.payload.model}</Text>
            </View>
          ) : null}

          {job.payload.kind === 'agentTurn' && job.payload.timeoutSeconds != null ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('wizard_timeout')}</Text>
              <Text style={styles.infoValue}>{formatDurationMs(job.payload.timeoutSeconds * 1000)}</Text>
            </View>
          ) : null}

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Created')}</Text>
            <Text style={styles.infoValue}>{formatTimestamp(job.createdAtMs)}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Updated')}</Text>
            <Text style={styles.infoValue}>{formatTimestamp(job.updatedAtMs)}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Last run')}</Text>
            <Text style={styles.infoValue}>{job.state.lastRunAtMs ? formatRelativeTime(job.state.lastRunAtMs) : t('Never')}</Text>
          </View>

          <View style={styles.infoRowLast}>
            <Text style={styles.infoLabel}>{t('Next run')}</Text>
            <Text style={styles.infoValue}>
              {job.enabled && job.state.nextRunAtMs ? formatRelativeTime(job.state.nextRunAtMs) : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('Run History')}</Text>

          {runsError ? (
            <View style={styles.runsErrorWrap}>
              <Text style={styles.errorTitle}>{t('Failed to load run history')}</Text>
              <Text style={styles.stateText}>{runsError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => loadDetail('refresh')}>
                <Text style={styles.retryText}>{t('common:Retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : runs.length === 0 ? (
            <View style={styles.emptyRuns}>
              <Text style={styles.emptyRunsText}>{t('No runs yet.')}</Text>
            </View>
          ) : (
            runs.map((entry) => {
              const status = entry.status;
              const statusColor = runStatusColor(status, theme.colors);
              const deliveryText = deliveryStatusText(entry.deliveryStatus, entry.delivered, t);
              return (
                <View key={`${entry.ts}_${entry.jobId}_${entry.runAtMs ?? 0}`} style={styles.runCard}>
                  <View style={styles.runHead}>
                    <Text style={styles.runTime}>{formatTimestamp(entry.ts)}</Text>
                    <View style={[styles.runStatusBadge, { borderColor: statusColor }]}>
                      <Text style={[styles.runStatusText, { color: statusColor }]}>
                        {formatRunStatusSymbol(status)} {status ?? 'unknown'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.runMetaRow}>
                    <Text style={styles.runMetaLabel}>{t('Duration')}</Text>
                    <Text style={styles.runMetaValue}>{formatDurationMs(entry.durationMs)}</Text>
                  </View>
                  <View style={styles.runMetaRow}>
                    <Text style={styles.runMetaLabel}>{t('Model')}</Text>
                    <Text style={styles.runMetaValue}>{entry.model ? `${entry.provider ? `${entry.provider}/` : ''}${entry.model}` : '—'}</Text>
                  </View>
                  <View style={styles.runMetaRow}>
                    <Text style={styles.runMetaLabel}>{t('Delivery')}</Text>
                    <Text style={[styles.runMetaValue, { color: deliveryStatusColor(entry.deliveryStatus, theme.colors) }]}>
                      {deliveryText}
                    </Text>
                  </View>
                  {status === 'error' && (
                    <View style={styles.runErrorRow}>
                      {!!entry.error && (
                        <Text style={styles.runError} numberOfLines={2}>
                          {entry.error}
                        </Text>
                      )}
                      <TouchableOpacity
                        style={styles.askAiBtn}
                        activeOpacity={0.7}
                        onPress={() => {
                          const jobLabel = job.name;
                          const errorDetail = entry.error ? ` Error: ${entry.error}` : '';
                          const prompt = `Cron job "${jobLabel}" (ID: ${job.id}) failed.${errorDetail} Please help me investigate why this cron job is failing and suggest a fix.`;
                          navigation.popToTop();
                          setTimeout(() => requestChatWithInput(prompt), 50);
                        }}
                      >
                        <MessageCircleQuestion size={13} color={theme.colors.primary} strokeWidth={2} />
                        <Text style={styles.askAiLabel}>{t('Ask AI')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}

          {runsHasMore ? (
            <TouchableOpacity style={styles.loadMoreButton} onPress={() => handleLoadMoreRuns()} disabled={runsLoadingMore}>
              <Text style={styles.loadMoreText}>{runsLoadingMore ? t('common:Loading...') : t('Load more')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerActions: {
      width: 132,
    },
    headerActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 6,
    },
    content: {
      ...createCardContentStyle(),
      gap: Space.md,
    },
    heroCard: {
      gap: Space.xs,
      paddingTop: Space.xs,
    },
    heroHeadingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    heroTitle: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.xxl,
      fontWeight: FontWeight.bold,
      lineHeight: 34,
    },
    heroMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    heroSummary: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      lineHeight: 20,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Space.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
    },
    badge: {
      borderRadius: Radius.sm + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    badgeText: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    infoRow: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 4,
    },
    infoRowLast: {
      paddingTop: 8,
      gap: 4,
    },
    infoLabel: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    infoValue: {
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: 19,
    },
    statusToggleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    runCard: {
      marginTop: Space.md - 2,
      borderRadius: Radius.sm + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      padding: Space.md - 2,
      gap: 6,
    },
    runHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    runTime: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      flex: 1,
    },
    runStatusBadge: {
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      backgroundColor: colors.surface,
    },
    runStatusText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
      textTransform: 'lowercase',
    },
    runMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
    },
    runMetaLabel: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    runMetaValue: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      flexShrink: 1,
      textAlign: 'right',
    },
    runErrorRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
      marginTop: 2,
    },
    runError: {
      flex: 1,
      color: colors.error,
      fontSize: FontSize.sm,
    },
    askAiBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      borderRadius: Radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    askAiLabel: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    loadMoreButton: {
      marginTop: Space.md,
      borderRadius: Radius.sm + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceMuted,
      paddingVertical: 9,
      alignItems: 'center',
    },
    loadMoreText: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
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
      fontSize: FontSize.bodySm,
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
    runsErrorWrap: {
      paddingVertical: Space.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyRuns: {
      paddingVertical: Space.xl,
      alignItems: 'center',
    },
    emptyRunsText: {
      color: colors.textMuted,
      fontSize: FontSize.md,
    },
  });
}
