import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, LoadingState, ModalSheet, SegmentedTabs, createListContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { loadGatewayHermesCronList } from '../../services/gateway-hermes-cron';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { HermesCronOutputDetail, HermesCronOutputEntry, HermesCronJob } from '../../types/hermes-cron';
import { formatRelativeTime } from '../../utils/cron';
import {
  describeHermesCronSchedule,
  formatHermesCronRepeat,
  getHermesCronStateLabel,
  getHermesCronStatusTone,
} from '../../utils/hermes-cron';
import type { ConsoleStackParamList } from './ConsoleTab';
import { HermesCronOutputSheetContent } from './HermesCronOutputSheetContent';

type Navigation = NativeStackNavigationProp<ConsoleStackParamList, 'CronList'>;
type Tab = 'jobs' | 'records';

export function HermesCronListScreen(): React.JSX.Element {
  const { gateway } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<Navigation>();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobs, setJobs] = useState<HermesCronJob[]>([]);
  const [outputs, setOutputs] = useState<HermesCronOutputEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<HermesCronOutputDetail | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const bundle = await loadGatewayHermesCronList(gateway);
      setJobs(bundle.jobs);
      setOutputs(bundle.outputs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load scheduled tasks'));
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, t]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  useNativeStackModalHeader({
    navigation,
    title: t('Scheduled Tasks'),
    onClose: () => navigation.goBack(),
  });

  const tabs = useMemo(() => ([
    { key: 'jobs', label: t('Jobs') },
    { key: 'records', label: t('Records') },
  ]), [t]);

  const openOutput = useCallback(async (entry: HermesCronOutputEntry) => {
    try {
      setOutputLoading(true);
      const detail = await gateway.getHermesCronOutput(entry.jobId, entry.fileName);
      setSelectedOutput(detail);
    } catch {
      setSelectedOutput(null);
    } finally {
      setOutputLoading(false);
    }
  }, [gateway]);

  const renderJob = ({ item }: { item: HermesCronJob }) => {
    const tone = getHermesCronStatusTone(item);
    const toneColor = tone === 'error'
      ? theme.colors.error
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'success'
          ? theme.colors.success
          : theme.colors.textSubtle;

    return (
      <Card style={styles.card} onPress={() => navigation.navigate('CronDetail', { jobId: item.id })}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.stateBadge, { color: toneColor }]}>{getHermesCronStateLabel(item)}</Text>
          </View>
          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        </View>
        <Text style={styles.cardMeta}>{describeHermesCronSchedule(item)}</Text>
        <Text style={styles.cardSubtle}>
          {t('Next run')}: {item.next_run_at ? formatRelativeTime(Date.parse(item.next_run_at)) : t('Unavailable')}
        </Text>
        <Text style={styles.cardSubtle}>
          {t('Repeat')}: {formatHermesCronRepeat(item)}  ·  {t('Delivery')}: {item.deliver || 'local'}
        </Text>
        {item.last_error ? (
          <Text style={styles.errorText} numberOfLines={2}>{item.last_error}</Text>
        ) : null}
      </Card>
    );
  };

  const renderOutput = ({ item }: { item: HermesCronOutputEntry }) => (
    <Card style={styles.card} onPress={() => { void openOutput(item); }}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.jobName}</Text>
          <Text style={[
            styles.stateBadge,
            { color: item.status === 'error' ? theme.colors.error : theme.colors.success },
          ]}
          >
            {item.status === 'error' ? t('Failed') : t('Succeeded')}
          </Text>
        </View>
        <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
      </View>
      <Text style={styles.cardMeta}>{formatRelativeTime(item.createdAt)}</Text>
      <Text style={styles.previewText} numberOfLines={3}>
        {item.preview || t('No response body saved')}
      </Text>
    </Card>
  );

  if (loading) {
    return <LoadingState message={t('Loading scheduled tasks...')} />;
  }

  return (
    <View style={styles.root}>
      <SegmentedTabs tabs={tabs} active={tab} onSwitch={(next) => setTab(next as Tab)} />
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{t('Failed to load scheduled tasks')}</Text>
          <Text style={styles.errorBody}>{error}</Text>
        </View>
      ) : null}
      {tab === 'jobs' ? (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          renderItem={renderJob}
          contentContainerStyle={[styles.content, jobs.length === 0 ? styles.emptyContent : null]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load('refresh'); }} tintColor={theme.colors.primary} />}
          ListEmptyComponent={(
            <EmptyState
              icon="⏰"
              title={t('No scheduled tasks configured')}
              subtitle={t('Creating Hermes scheduled tasks in Clawket is not available yet.')}
            />
          )}
        />
      ) : (
        <FlatList
          data={outputs}
          keyExtractor={(item) => `${item.jobId}:${item.fileName}`}
          renderItem={renderOutput}
          contentContainerStyle={[styles.content, outputs.length === 0 ? styles.emptyContent : null]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load('refresh'); }} tintColor={theme.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="📄" title={t('No execution records yet')} />}
        />
      )}

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

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    content: {
      ...createListContentStyle({ bottom: Space.xxxl, top: Space.sm }),
      gap: Space.sm,
    },
    emptyContent: {
      flexGrow: 1,
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.xs,
      backgroundColor: colors.surface,
      marginBottom: Space.sm,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    cardTitleWrap: {
      flex: 1,
      gap: 2,
    },
    cardTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    stateBadge: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      textTransform: 'capitalize',
    },
    cardMeta: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
    },
    cardSubtle: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    previewText: {
      color: colors.text,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    errorCard: {
      marginHorizontal: Space.lg,
      marginTop: Space.sm,
      padding: Space.md,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.error,
      gap: Space.xs,
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    errorBody: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.sm,
    },
  });
}
