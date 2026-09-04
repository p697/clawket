import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, SectionList, SectionListData, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, MessageCircleQuestion, Plus } from 'lucide-react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import {
  Card,
  EmptyState,
  HeaderActionButton,
  LoadingState,
  SegmentedTabs,
  createListContentStyle,
} from '../../components/ui';
import { useAppTheme } from '../../theme';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { CronDeliveryStatus, CronJob, CronRunLogEntry, CronRunStatus } from '../../types';
import { describeScheduleHuman, formatDurationMs, formatRelativeTime, formatRunStatusSymbol } from '../../utils/cron';
import type { ConsoleStackParamList } from './ConsoleTab';
import { analyticsEvents } from '../../services/analytics/events';
import { StorageService } from '../../services/storage';
import { fetchAllCronJobs } from './cronData';

type CronListNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronList'>;
type Tab = 'runs' | 'jobs';
type RunSectionKey = 'today' | 'yesterday' | 'earlier';
type RunSection = {
  key: RunSectionKey;
  title: string;
  data: CronRunLogEntry[];
};

function resolveStatusColor(status: CronRunStatus | undefined, colors: ReturnType<typeof useAppTheme>['theme']['colors']): string {
  if (status === 'ok') return colors.success;
  if (status === 'error') return colors.error;
  return colors.textSubtle;
}

function getDeliveryDisplay(status: CronDeliveryStatus | undefined, t: (key: string) => string): string | null {
  if (status === 'not-requested') return t('No delivery configured');
  if (status === 'unknown') return t('Delivery unconfirmed');
  if (status === 'not-delivered') return t('Delivery not completed');
  return null;
}

// ---- Runs Tab ----

function RunsTab({ colors }: {
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  const { gateway, gatewayEpoch, currentAgentId, requestChatWithInput } = useAppContext();
  const { t } = useTranslation('console');
  const navigation = useNavigation<CronListNavigation>();
  const [runs, setRuns] = useState<CronRunLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<RunSectionKey>>(new Set());
  const styles = useMemo(() => createRunStyles(colors), [colors]);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [result, jobs] = await Promise.all([
        gateway.listCronRuns({ scope: 'all', limit: 50, sortDir: 'desc' }),
        fetchAllCronJobs(gateway, currentAgentId),
      ]);
      const allowedJobIds = new Set(jobs.map((job) => job.id));
      setRuns(result.entries.filter((entry) => allowedJobIds.has(entry.jobId)));
      const failedIds = jobs
        .filter((job) => job.state?.lastRunStatus === 'error')
        .map((job) => job.id);
      StorageService.ackCronFailures(failedIds).catch(() => {});
      setHasLoaded(true);
    } catch {
      // handled by empty state
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [currentAgentId, gateway, gatewayEpoch]);

  useFocusEffect(useCallback(() => {
    load(hasLoaded ? 'background' : 'initial').catch(() => {});
  }, [hasLoaded, load]));

  const groupedSections = useMemo<RunSection[]>(() => {
    if (runs.length === 0) return [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    const todayRuns: CronRunLogEntry[] = [];
    const yesterdayRuns: CronRunLogEntry[] = [];
    const earlierRuns: CronRunLogEntry[] = [];

    for (const run of runs) {
      if (run.ts >= startOfToday) {
        todayRuns.push(run);
      } else if (run.ts >= startOfYesterday) {
        yesterdayRuns.push(run);
      } else {
        earlierRuns.push(run);
      }
    }

    return [
      { key: 'today', title: t('Tasks executed today'), data: todayRuns },
      { key: 'yesterday', title: t('Tasks executed yesterday'), data: yesterdayRuns },
      { key: 'earlier', title: t('Tasks executed earlier'), data: earlierRuns },
    ];
  }, [runs, t]);

  const displaySections = useMemo(() => groupedSections.map((section) => ({
    ...section,
    data: collapsedSections.has(section.key) ? [] : section.data,
  })), [collapsedSections, groupedSections]);

  const toggleSection = useCallback((sectionKey: RunSectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  const renderSectionHeader = ({ section }: { section: SectionListData<CronRunLogEntry, RunSection> }) => {
    const isCollapsed = collapsedSections.has(section.key);
    const count = groupedSections.find((s) => s.key === section.key)?.data.length ?? 0;
    return (
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection(section.key)}
        activeOpacity={0.6}
      >
        {isCollapsed
          ? <ChevronRight size={16} color={colors.textMuted} strokeWidth={2.5} />
          : <ChevronDown size={16} color={colors.textMuted} strokeWidth={2.5} />
        }
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </TouchableOpacity>
    );
  };

  if (loading) return <LoadingState message={t('Loading run history...')} />;

  return (
    <SectionList
      sections={displaySections}
      keyExtractor={(item, idx) => `${item.jobId}_${item.ts}_${idx}`}
      contentContainerStyle={styles.content}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.primary} />
      }
      ListEmptyComponent={<EmptyState icon="📭" title={t('No runs yet')} />}
      renderSectionHeader={renderSectionHeader}
      renderItem={({ item }) => {
        const sc = resolveStatusColor(item.status, colors);
        const deliveryText = getDeliveryDisplay(item.deliveryStatus, t);
        return (
          <Card
            style={styles.card}
            onPress={() => navigation.navigate('CronDetail', { jobId: item.jobId })}
          >
            <View style={styles.row}>
              <Text style={[styles.statusIcon, { color: sc }]}>{formatRunStatusSymbol(item.status)}</Text>
              <Text style={styles.jobName} numberOfLines={1}>{item.jobName ?? item.jobId.slice(0, 8)}</Text>
              <Text style={styles.time}>{formatRelativeTime(item.ts)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detail}>
                {formatDurationMs(item.durationMs)}
                {item.model ? `  ·  ${item.model}` : ''}
              </Text>
              {deliveryText && (
                <Text style={styles.deliveryMeta}>{deliveryText}</Text>
              )}
            </View>
            {item.status === 'error' && (
              <View style={styles.errorRow}>
                {!!item.error && (
                  <Text style={styles.errorText} numberOfLines={2}>{item.error}</Text>
                )}
                <TouchableOpacity
                  style={styles.askAiBtn}
                  activeOpacity={0.7}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    const jobLabel = item.jobName ?? item.jobId.slice(0, 8);
                    const errorDetail = item.error ? ` Error: ${item.error}` : '';
                    const prompt = `Cron job "${jobLabel}" (ID: ${item.jobId}) failed.${errorDetail} Please help me investigate why this cron job is failing and suggest a fix.`;
                    navigation.popToTop();
                    setTimeout(() => requestChatWithInput(prompt), 50);
                  }}
                >
                  <MessageCircleQuestion size={13} color={colors.primary} strokeWidth={2} />
                  <Text style={styles.askAiLabel}>{t('Ask AI')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}

function createRunStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: { ...createListContentStyle({ grow: true, bottom: Space.xxxl }) },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Space.sm,
      marginBottom: Space.xs,
      gap: Space.sm,
    },
    sectionTitle: {
      flex: 1,
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    sectionCount: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    card: {
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: Radius.md,
      padding: Space.md, gap: Space.xs + 2, marginBottom: Space.sm - 2,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    statusIcon: { fontSize: FontSize.bodySm, fontWeight: FontWeight.bold, width: 16, textAlign: 'center' },
    jobName: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: colors.text },
    time: { fontSize: FontSize.sm, color: colors.textSubtle },
    detail: { flex: 1, fontSize: FontSize.sm, color: colors.textMuted, marginLeft: 16 + Space.sm },
    deliveryMeta: { fontSize: FontSize.xs, color: colors.textSubtle, fontWeight: FontWeight.semibold },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, marginLeft: 16 + Space.sm },
    errorText: { flex: 1, fontSize: FontSize.sm, color: colors.error },
    askAiBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: Space.sm, paddingVertical: 3,
      borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    askAiLabel: { fontSize: FontSize.xs, color: colors.primary, fontWeight: FontWeight.semibold },
  });
}

// ---- Jobs Tab ----

function JobsTab({ colors }: {
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  const { gateway, gatewayEpoch, currentAgentId } = useAppContext();
  const { t } = useTranslation('console');
  const navigation = useNavigation<CronListNavigation>();
  const styles = useMemo(() => createJobStyles(colors), [colors]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const fetchedJobs = await fetchAllCronJobs(gateway, currentAgentId);
      setJobs(fetchedJobs);
      const failedIds = fetchedJobs
        .filter((job) => job.state?.lastRunStatus === 'error')
        .map((job) => job.id);
      StorageService.ackCronFailures(failedIds).catch(() => {});
      setError(null);
      setHasLoaded(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Failed to load cron jobs'));
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [currentAgentId, gateway, gatewayEpoch]);

  useFocusEffect(useCallback(() => {
    load(hasLoaded ? 'background' : 'initial').catch(() => {});
  }, [hasLoaded, load]));

  if (loading) return <LoadingState message={t('Loading cron jobs...')} />;

  return (
    <FlatList
      data={jobs}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.primary} />
      }
      ListHeaderComponent={
        error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('Failed to load cron jobs')}</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => load(hasLoaded ? 'background' : 'initial')}>
              <Text style={styles.retryBtnText}>{t('common:Retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="⏰"
          title={t('No cron jobs configured')}
          actionLabel={t('common:Create')}
          onAction={() => {
            analyticsEvents.cronCreateTapped({ source: 'cron_empty_state' });
            navigation.navigate('CronWizard');
          }}
        />
      }
      renderItem={({ item }) => {
        const lastStatus = item.state.lastRunStatus ?? item.state.lastStatus;
        const sc = resolveStatusColor(lastStatus, colors);
        const lastRunText = item.state.lastRunAtMs ? formatRelativeTime(item.state.lastRunAtMs) : t('Never');
        const nextRunText = item.enabled && item.state.nextRunAtMs ? formatRelativeTime(item.state.nextRunAtMs) : '—';

        return (
          <Card style={styles.card} onPress={() => navigation.navigate('CronDetail', { jobId: item.id })}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
              <View style={styles.enabledWrap}>
                <View style={[styles.enabledDot, { backgroundColor: item.enabled ? colors.success : colors.textSubtle }]} />
                <Text style={styles.enabledText}>{item.enabled ? t('Enabled') : t('Disabled')}</Text>
              </View>
            </View>
            <Text style={styles.cardSchedule} numberOfLines={2}>{describeScheduleHuman(item.schedule, t)}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t('Last run')}</Text>
              <View style={styles.statusValueWrap}>
                <Text style={[styles.statusSymbol, { color: sc }]}>{formatRunStatusSymbol(lastStatus)}</Text>
                <Text style={styles.metaValue}>{lastRunText}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t('Next run')}</Text>
              <Text style={styles.metaValue}>{nextRunText}</Text>
            </View>
          </Card>
        );
      }}
    />
  );
}

function createJobStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: { ...createListContentStyle({ grow: true }), gap: Space.md - 2 },
    card: {
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: Radius.md,
      padding: Space.lg - 2, gap: Space.sm,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
    cardTitle: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: colors.text },
    enabledWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    enabledDot: { width: 8, height: 8, borderRadius: Space.xs },
    enabledText: { fontSize: FontSize.sm, color: colors.textMuted, fontWeight: FontWeight.semibold },
    cardSchedule: { fontSize: FontSize.md, color: colors.textMuted },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    statusValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusSymbol: { fontSize: FontSize.bodySm, fontWeight: FontWeight.bold },
    metaLabel: { fontSize: FontSize.sm, color: colors.textSubtle },
    metaValue: { fontSize: FontSize.sm, color: colors.textMuted, fontWeight: FontWeight.medium },
    errorCard: {
      backgroundColor: colors.surface, borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.error, padding: Space.md, marginBottom: Space.sm,
    },
    errorTitle: { color: colors.error, fontSize: FontSize.bodySm, fontWeight: FontWeight.bold },
    errorText: { color: colors.textMuted, fontSize: FontSize.sm, marginTop: Space.xs },
    retryButton: {
      marginTop: Space.md - 2, alignSelf: 'flex-start',
      backgroundColor: colors.primary, borderRadius: Radius.sm,
      paddingHorizontal: Space.md, paddingVertical: 6,
    },
    retryBtnText: { color: colors.primaryText, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  });
}

// ---- Main Screen ----

export function CronListScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<CronListNavigation>();
  const [tab, setTab] = useState<Tab>('runs');

  const cronTabs = useMemo<{ key: Tab; label: string }[]>(() => [
    { key: 'runs', label: t('Runs') },
    { key: 'jobs', label: t('Jobs') },
  ], [t]);

  const headerRight = useMemo(
    () => (
      <HeaderActionButton
        icon={Plus}
        onPress={() => {
          analyticsEvents.cronCreateTapped({ source: 'cron_header' });
          navigation.navigate('CronWizard');
        }}
        size={20}
      />
    ),
    [navigation],
  );

  useNativeStackModalHeader({
    navigation,
    title: t('Cron Jobs'),
    rightContent: headerRight,
    onClose: () => navigation.goBack(),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SegmentedTabs tabs={cronTabs} active={tab} onSwitch={setTab} />
      {tab === 'runs'
        ? <RunsTab colors={theme.colors} />
        : <JobsTab colors={theme.colors} />
      }
    </View>
  );
}
