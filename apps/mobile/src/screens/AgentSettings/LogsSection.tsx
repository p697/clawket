import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AgentAdapter } from '@clawket/agent-protocol';
import { useTranslation } from 'react-i18next';

import { ProGate } from '../../components/pro/ProGate';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import {
  filterLogEntries,
  formatLogTime,
  LOG_LEVELS,
  mergeLogLines,
  createDefaultLogLevelFilters,
  type LogEntry,
  type LogLevel,
  type LogLevelFilters,
} from './logs-model';
import {
  managementErrorDetail,
  managementErrorKey,
} from './openclaw-manage-model';
import { translateAgentSettingsKey } from './translation';

const LOG_BUFFER_LIMIT = 2_000;
const LOG_VISIBLE_LIMIT = 250;
/** Free users read the newest entries in full; the rest sit behind the last-step gate. */
export const LOGS_FREE_ENTRIES = 3;
const LOGS_TEASER_ENTRIES = 4;
const POLL_INTERVAL_MS = 2_000;
const LOG_FETCH_LIMIT = 500;
const LOG_FETCH_MAX_BYTES = 250_000;
const MONOSPACE_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export type LogsSectionProps = Readonly<{
  adapter: AgentAdapter;
  online: boolean;
  isPro?: boolean;
  onReconnect?: () => void;
  onOpenPaywall?: (reason: 'logs', onContinue?: () => void) => void;
}>;

export function LogsSection({
  adapter,
  online,
  isPro = true,
  onReconnect,
  onOpenPaywall,
}: LogsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['settings', 'common', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.logs;
  const supported = adapter.capabilities.logs && Boolean(operations?.fetch);
  const [entries, setEntries] = useState<ReadonlyArray<LogEntry>>([]);
  const [query, setQuery] = useState('');
  const [levelFilters, setLevelFilters] = useState<LogLevelFilters>(
    createDefaultLogLevelFilters,
  );
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const levelLabels = useMemo<Record<LogLevel, string>>(() => ({
    trace: t('Trace'),
    debug: t('Debug'),
    info: t('Info'),
    warn: t('Warn'),
    error: t('Error'),
    fatal: t('Fatal'),
  }), [t]);

  const translateError = useCallback((loadError: unknown) => {
    const key = managementErrorKey(loadError);
    return key
      ? translateAgentSettingsKey(t, key)
      : managementErrorDetail(loadError, t('Failed to fetch logs'));
  }, [t]);

  const fetchPage = useCallback(async (reset: boolean) => {
    const fetch = operations?.fetch;
    if (!supported || !online || !fetch || inFlightRef.current) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    const previousCursor = cursorRef.current;
    try {
      const page = await fetch({
        ...(!reset && previousCursor !== null ? { cursor: previousCursor } : {}),
        limit: LOG_FETCH_LIMIT,
        maxBytes: LOG_FETCH_MAX_BYTES,
      });
      if (generation !== generationRef.current) return;
      const shouldReset = reset || page.reset || previousCursor === null;
      setEntries((current) => mergeLogLines(
        current,
        page.lines,
        shouldReset,
        LOG_BUFFER_LIMIT,
      ));
      cursorRef.current = page.cursor;
      setError(null);
    } finally {
      if (generation === generationRef.current) inFlightRef.current = false;
    }
  }, [online, operations?.fetch, supported]);

  useEffect(() => {
    generationRef.current += 1;
    cursorRef.current = null;
    inFlightRef.current = false;
    setEntries([]);
    setQuery('');
    setLevelFilters(createDefaultLogLevelFilters());
    setLoaded(false);
    setLoading(true);
    setRefreshing(false);
    setError(null);
  }, [adapter]);

  useEffect(() => {
    let active = true;
    if (!supported) {
      setLoading(false);
      setLoaded(true);
      return undefined;
    }
    if (!online) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    void fetchPage(true).catch((loadError: unknown) => {
      if (active) setError(translateError(loadError));
    }).finally(() => {
      if (active) {
        setLoaded(true);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchPage, online, supported, translateError]);

  useEffect(() => {
    // Free users get a snapshot plus manual refresh; live tailing is the Pro value.
    if (!supported || !online || !loaded || !isPro) return undefined;
    const interval = setInterval(() => {
      void fetchPage(false).catch((loadError: unknown) => {
        setError(translateError(loadError));
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchPage, isPro, loaded, online, supported, translateError]);

  useEffect(() => () => {
    generationRef.current += 1;
  }, []);

  const refresh = useCallback(async () => {
    if (!supported || !online || refreshing) return;
    setRefreshing(true);
    try {
      await fetchPage(true);
    } catch (loadError: unknown) {
      setError(translateError(loadError));
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, [fetchPage, online, refreshing, supported, translateError]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevelFilters((current) => ({ ...current, [level]: !current[level] }));
  }, []);

  const filteredEntries = useMemo(() => filterLogEntries(
    entries,
    query,
    levelFilters,
  ).slice(-LOG_VISIBLE_LIMIT).reverse(), [entries, levelFilters, query]);
  const visibleEntries = isPro ? filteredEntries : filteredEntries.slice(0, LOGS_FREE_ENTRIES);
  const teaserEntries = isPro
    ? []
    : filteredEntries.slice(LOGS_FREE_ENTRIES, LOGS_FREE_ENTRIES + LOGS_TEASER_ENTRIES);

  if (!supported) {
    return (
      <SectionMessage
        testID="agent-logs-unsupported"
        message={t('Not supported by this backend', { ns: 'config' })}
      />
    );
  }

  if (loading && !loaded && entries.length === 0) {
    return (
      <View testID="agent-logs-loading" style={styles.stack}>
        <Skeleton style={styles.skeletonControl} />
        <Skeleton style={styles.skeletonRow} />
        <Skeleton style={styles.skeletonRow} />
      </View>
    );
  }

  return (
    <View testID="agent-logs-section" style={styles.stack}>
      {!online ? (
        <Banner
          testID="agent-logs-offline"
          message={t('Offline · showing cached settings', { ns: 'config' })}
          actionLabel={onReconnect ? t('Reconnect', { ns: 'common' }) : undefined}
          onAction={onReconnect}
        />
      ) : null}
      {error ? (
        <Banner
          testID="agent-logs-error"
          tone="bad"
          message={error}
          actionLabel={t('Retry', { ns: 'common' })}
          onAction={() => { void refresh(); }}
        />
      ) : null}
      <SearchInput
        testID="agent-logs-search"
        value={query}
        onChangeText={setQuery}
        placeholder={t('Search logs...')}
      />
      <ScrollView
        horizontal
        contentContainerStyle={styles.filters}
        showsHorizontalScrollIndicator={false}
      >
        {LOG_LEVELS.map((level) => (
          <Button
            key={level}
            testID={`agent-logs-filter-${level}`}
            label={levelLabels[level]}
            size="sm"
            variant={levelFilters[level] ? 'primary' : 'secondary'}
            onPress={() => toggleLevel(level)}
          />
        ))}
      </ScrollView>
      <Button
        testID="agent-logs-refresh"
        label={t('Refresh', { ns: 'common' })}
        variant="secondary"
        loading={refreshing}
        disabled={!online}
        onPress={() => { void refresh(); }}
      />
      {visibleEntries.length ? (
        <View testID="agent-logs-list" style={styles.logList}>
          {visibleEntries.map((entry, index) => (
            <LogRow
              key={`${entry.time ?? ''}:${entry.raw}:${index}`}
              entry={entry}
              index={index}
            />
          ))}
        </View>
      ) : error && entries.length === 0 ? null : !online && entries.length === 0 ? (
        <SectionMessage testID="agent-logs-offline-empty" message={t('Offline', { ns: 'common' })} />
      ) : (
        <SectionMessage testID="agent-logs-empty" message={t('No log entries')} />
      )}
      {!isPro && (loaded || entries.length > 0) ? (
        <ProGate
          testID="agent-logs-gate"
          title={t('Watch OpenClaw run in real time')}
          detail={t('Every request, error and restart, streamed to your phone.')}
          actionLabel={t('Unlock OpenClaw logs')}
          onUnlock={() => onOpenPaywall?.('logs')}
        >
          {teaserEntries.length ? (
            <View style={styles.logList}>
              {teaserEntries.map((entry, index) => (
                <LogRow
                  key={`${entry.time ?? ''}:${entry.raw}:${index}`}
                  entry={entry}
                  index={LOGS_FREE_ENTRIES + index}
                />
              ))}
            </View>
          ) : null}
        </ProGate>
      ) : null}
    </View>
  );
}

function LogRow({
  entry,
  index,
}: Readonly<{ entry: LogEntry; index: number }>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const metadata = [
    formatLogTime(entry.time),
    entry.level?.toUpperCase(),
    entry.subsystem,
  ].filter(Boolean).join(' · ');
  return (
    <View
      testID={`agent-log-entry-${index}`}
      style={[styles.logRow, { backgroundColor: theme.colors.surfaceFloating }]}
    >
      <Text style={[styles.logMeta, { color: levelColor(entry.level, theme.colors) }]}>
        {metadata}
      </Text>
      <Text selectable style={styles.logMessage}>{entry.message ?? entry.raw}</Text>
    </View>
  );
}

function SectionMessage({
  message,
  testID,
}: Readonly<{ message: string; testID: string }>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View testID={testID} style={stylesStatic.empty}>
      <Text style={[stylesStatic.emptyText, { color: theme.colors.inkSecondary }]}>
        {message}
      </Text>
    </View>
  );
}

function levelColor(
  level: LogLevel | null | undefined,
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): string {
  if (level === 'error' || level === 'fatal') return colors.bad;
  if (level === 'warn') return colors.warn;
  if (level === 'info') return colors.good;
  return colors.inkSecondary;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    stack: {
      gap: Space.lg,
    },
    filters: {
      gap: Space.sm,
      paddingRight: Space.lg,
    },
    logList: {
      gap: Space.sm,
    },
    logRow: {
      borderRadius: Radius.card,
      padding: Space.lg,
      gap: Space.xs,
    },
    logMeta: {
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
      fontFamily: MONOSPACE_FONT,
    },
    logMessage: {
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontFamily: MONOSPACE_FONT,
    },
    skeletonControl: {
      minHeight: ControlSize.floatingButton,
    },
    skeletonRow: {
      minHeight: ControlSize.settingsRow * 2,
    },
  });
}

const stylesStatic = StyleSheet.create({
  empty: {
    minHeight: ControlSize.settingsRow * 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
});
