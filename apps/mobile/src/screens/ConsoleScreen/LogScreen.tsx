import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  FlatListProps,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronDown, RefreshCw } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CircleButton, EmptyState, HeaderActionButton, IconButton, LoadingState, SearchInput } from '../../components/ui';
import { ProBlurOverlay } from '../../components/pro/ProBlurOverlay';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { GatewayClient } from '../../services/gateway';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import { LOG_LEVELS, LogEntry, LOG_LEVEL_BADGE_COLORS, LogLevel } from '../../types/logs';
import { parseLogLine } from '../../utils/log-parser';
import type { ConsoleStackParamList } from './ConsoleTab';

const LOG_BUFFER_LIMIT = 2000;
const POLL_INTERVAL_MS = 2000;
const AUTO_FOLLOW_BREAKPOINT = 72;

type LogScreenNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'Logs'>;

function createDefaultLevelFilters(): Record<LogLevel, boolean> {
  return {
    trace: true,
    debug: true,
    info: true,
    warn: true,
    error: true,
    fatal: true,
  };
}

function formatLogTime(value?: string | null): string {
  if (!value) return '--:--:--';
  const directMatch = value.match(/\b\d{2}:\d{2}:\d{2}\b/);
  if (directMatch?.[0]) return directMatch[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function levelChipText(level: LogLevel): string {
  return level;
}

function useLogViewer(gateway: GatewayClient, gatewayEpoch: number) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>(createDefaultLevelFilters);
  const [autoFollow, setAutoFollow] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const cursorRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchLogs = useCallback(async (opts?: { reset?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const priorCursor = cursorRef.current;
      const result = await gateway.fetchLogs({
        cursor: opts?.reset ? undefined : (priorCursor ?? undefined),
      });
      const newEntries = result.lines.map(parseLogLine);
      const shouldReset = Boolean(opts?.reset || result.reset || priorCursor === null);

      if (mountedRef.current) {
        setEntries((prev) => {
          const combined = shouldReset ? newEntries : [...prev, ...newEntries];
          return combined.length > LOG_BUFFER_LIMIT
            ? combined.slice(-LOG_BUFFER_LIMIT)
            : combined;
        });
        setCursor(result.cursor);
        setError(null);
      }

      cursorRef.current = result.cursor;
    } catch (err: unknown) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [gateway, gatewayEpoch]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchLogs({ reset: true });
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [fetchLogs]);

  const toggleLevelFilter = useCallback((level: LogLevel) => {
    setLevelFilters((prev) => ({ ...prev, [level]: !prev[level] }));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchLogs({ reset: true })
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false);
        }
      });
  }, [fetchLogs]);

  useEffect(() => {
    setPolling(true);
    intervalRef.current = setInterval(() => {
      fetchLogs().catch(() => {
        // Error state is handled by fetchLogs.
      });
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [fetchLogs]);

  return {
    entries,
    loading,
    refreshing,
    error,
    filterText,
    setFilterText,
    levelFilters,
    toggleLevelFilter,
    autoFollow,
    setAutoFollow,
    cursor,
    polling,
    refresh,
  };
}

export function LogScreen(): React.JSX.Element {
  const { gateway, gatewayEpoch } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<LogScreenNavigation>();
  const { isPro, showPaywall } = useProPaywall();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const monospaceFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
  const listRef = useRef<FlatList<LogEntry>>(null);

  const {
    entries,
    loading,
    refreshing,
    error,
    filterText,
    setFilterText,
    levelFilters,
    toggleLevelFilter,
    autoFollow,
    setAutoFollow,
    refresh,
  } = useLogViewer(gateway, gatewayEpoch);

  const headerRight = useMemo(
    () => (
      <HeaderActionButton
        icon={RefreshCw}
        onPress={() => {
          refresh().catch(() => {
            // Error state is handled in hook.
          });
        }}
        disabled={refreshing}
      />
    ),
    [refresh, refreshing],
  );

  useNativeStackModalHeader({
    navigation,
    title: t('Logs'),
    rightContent: headerRight,
    onClose: () => navigation.goBack(),
  });

  const hasEnabledLevels = useMemo(
    () => LOG_LEVELS.some((level) => levelFilters[level]),
    [levelFilters],
  );

  const filteredEntries = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return entries.filter((entry) => {
      if (entry.level && !levelFilters[entry.level]) return false;
      if (!entry.level && !hasEnabledLevels) return false;
      if (!query) return true;
      const haystack = `${entry.message ?? ''}\n${entry.subsystem ?? ''}\n${entry.raw}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [entries, filterText, hasEnabledLevels, levelFilters]);

  const scrollToBottom = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const reEnableAutoFollow = useCallback(() => {
    setAutoFollow(true);
    requestAnimationFrame(() => {
      scrollToBottom(true);
    });
  }, [scrollToBottom, setAutoFollow]);

  const onListScroll: NonNullable<FlatListProps<LogEntry>['onScroll']> = useCallback((event) => {
    if (!autoFollow) return;
    const { contentOffset, contentSize, layoutMeasurement } = (event as {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }).nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    if (distanceFromBottom > AUTO_FOLLOW_BREAKPOINT) {
      setAutoFollow(false);
    }
  }, [autoFollow, setAutoFollow]);

  useEffect(() => {
    if (!autoFollow || filteredEntries.length === 0) return;
    const timer = setTimeout(() => {
      scrollToBottom(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [autoFollow, filteredEntries.length, scrollToBottom]);

  return (
    <View style={styles.root}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>{t('Failed to fetch logs')}</Text>
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.filtersWrap}>
        <SearchInput
          value={filterText}
          onChangeText={setFilterText}
          placeholder={t('Search logs...')}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.levelChips}
        >
          {LOG_LEVELS.map((level) => {
            const enabled = levelFilters[level];
            const levelColor = LOG_LEVEL_BADGE_COLORS[level];
            return (
              <TouchableOpacity
                key={level}
                onPress={() => toggleLevelFilter(level)}
                activeOpacity={0.75}
                style={[
                  styles.levelChip,
                  enabled ? styles.levelChipActive : styles.levelChipInactive,
                ]}
              >
                <View style={[styles.levelDot, { backgroundColor: levelColor.bg }]} />
                <Text
                  style={[
                    styles.levelChipText,
                    enabled ? styles.levelChipTextActive : styles.levelChipTextInactive,
                  ]}
                >
                  {levelChipText(level)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <LoadingState message={t('Loading logs...')} />
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            data={filteredEntries}
            keyExtractor={(item, index) => `${index}:${item.time ?? ''}:${item.raw}`}
            renderItem={({ item }) => {
              const levelStyle = item.level ? LOG_LEVEL_BADGE_COLORS[item.level] : null;
              return (
                <View style={styles.entryRow}>
                  <View style={styles.entryMetaRow}>
                    <Text style={[styles.entryTime, { fontFamily: monospaceFamily }]}>
                      {formatLogTime(item.time)}
                    </Text>
                    {item.level && levelStyle ? (
                      <View style={[styles.levelBadge, { backgroundColor: levelStyle.bg }]}>
                        <Text style={[styles.levelBadgeText, { color: levelStyle.text, fontFamily: monospaceFamily }]}>
                          {item.level}
                        </Text>
                      </View>
                    ) : null}
                    {item.subsystem ? (
                      <Text
                        style={[styles.entrySubsystem, { fontFamily: monospaceFamily }]}
                        numberOfLines={1}
                      >
                        {item.subsystem}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.entryMessage, { fontFamily: monospaceFamily }]}>
                    {item.message ?? item.raw}
                  </Text>
                </View>
              );
            }}
            contentContainerStyle={filteredEntries.length > 0 ? styles.listContent : styles.listContentEmpty}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  refresh().catch(() => {
                    // Error state is handled in hook.
                  });
                }}
                tintColor={theme.colors.primary}
              />
            )}
            onScroll={onListScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
              if (autoFollow) {
                scrollToBottom(false);
              }
            }}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={50}
            maxToRenderPerBatch={30}
            ListEmptyComponent={<EmptyState icon="📜" title={t('No log entries')} />}
          />

          {!autoFollow && filteredEntries.length > 0 ? (
            <CircleButton
              icon={<ChevronDown size={20} color={theme.colors.textMuted} strokeWidth={2.5} />}
              onPress={reEnableAutoFollow}
              size={36}
              color={theme.colors.surfaceElevated}
              shadow
              style={styles.scrollToBottomWrap}
            />
          ) : null}
        </View>
      )}

      {!isPro && (
        <ProBlurOverlay
          description={t('View full execution logs for your OpenClaw gateway')}
          onUpgrade={() => showPaywall('logs')}
        />
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    errorBanner: {
      marginHorizontal: Space.lg,
      marginTop: Space.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.error,
      borderRadius: Radius.sm,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.sm,
    },
    errorTitle: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.error,
    },
    errorText: {
      marginTop: 2,
      fontSize: FontSize.xs,
      color: colors.textMuted,
    },
    filtersWrap: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      gap: Space.sm,
    },
    levelChips: {
      paddingBottom: Space.xs,
      gap: Space.sm,
    },
    levelChip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: Space.md,
      paddingVertical: Space.xs + 2,
      gap: Space.xs + 2,
    },
    levelChipActive: {
      backgroundColor: colors.surface,
      borderColor: colors.borderStrong,
    },
    levelChipInactive: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
    },
    levelDot: {
      width: Space.sm - 1,
      height: Space.sm - 1,
      borderRadius: Radius.full,
    },
    levelChipText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      textTransform: 'lowercase',
    },
    levelChipTextActive: {
      color: colors.text,
    },
    levelChipTextInactive: {
      color: colors.textSubtle,
      textDecorationLine: 'line-through',
    },
    listWrap: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.xxxl,
      gap: Space.sm,
    },
    listContentEmpty: {
      flexGrow: 1,
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.xxxl,
    },
    entryRow: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: Radius.md,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: Space.sm,
      gap: Space.xs,
    },
    entryMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    entryTime: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    levelBadge: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.xs + 2,
      paddingVertical: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    levelBadgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      textTransform: 'lowercase',
    },
    entrySubsystem: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.xs,
      color: colors.textMuted,
    },
    entryMessage: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: LineHeight.xl,
    },
    scrollToBottomWrap: {
      position: 'absolute',
      right: Space.lg,
      bottom: Space.lg + Space.sm,
    },
  });
}
