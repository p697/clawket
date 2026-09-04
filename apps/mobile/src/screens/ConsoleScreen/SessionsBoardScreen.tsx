import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshCw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { EmptyState, HeaderActionButton, SearchInput, createListContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { SessionInfo } from '../../types';
import { sanitizeSilentPreviewText, relativeTime } from '../../utils/chat-message';
import type { ConsoleStackParamList } from './ConsoleTab';
import {
  buildSessionBoardRows,
  filterSessionBoardRows,
  summarizeSessionBoardRows,
  type SessionBoardKind,
  type SessionBoardRow,
  type SessionBoardStatus,
} from '../SessionPanel/list-model';

type SessionsBoardNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'SessionsBoard'>;

type SessionListPayload = {
  sessions?: SessionInfo[];
  defaults?: {
    contextTokens?: number;
  };
};

type StatusFilter = 'all' | SessionBoardStatus;
type KindFilter = 'all' | SessionBoardKind;

const REFRESH_INTERVAL_MS = 3_000;

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'recent', label: 'Recent' },
  { key: 'idle', label: 'Idle' },
];

const KIND_FILTERS: Array<{ key: KindFilter; label: string }> = [
  { key: 'all', label: 'All Types' },
  { key: 'main', label: 'Main' },
  { key: 'direct', label: 'Direct' },
  { key: 'group', label: 'Group' },
  { key: 'subagent', label: 'Subagent' },
  { key: 'cron', label: 'Cron' },
  { key: 'other', label: 'Other' },
];

function normalizeSessions(payload: SessionListPayload | null | undefined): SessionInfo[] {
  const defaultContextTokens = typeof payload?.defaults?.contextTokens === 'number'
    ? payload.defaults.contextTokens
    : undefined;
  return (payload?.sessions ?? []).map((session) => ({
    ...(
      typeof session.contextTokens === 'number' || defaultContextTokens === undefined
        ? session
        : { ...session, contextTokens: defaultContextTokens }
    ),
    lastMessagePreview: sanitizeSilentPreviewText(session.lastMessagePreview),
  }));
}

function SessionTag({
  label,
  styles,
  colors,
  tone,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
  tone: 'active' | 'recent' | 'idle' | 'kind';
}): React.JSX.Element {
  const palette = tone === 'active'
    ? { backgroundColor: colors.surfaceMuted, borderColor: colors.success, textColor: colors.success }
    : tone === 'recent'
      ? { backgroundColor: colors.surfaceMuted, borderColor: colors.warning, textColor: colors.warning }
      : tone === 'idle'
        ? { backgroundColor: colors.surfaceMuted, borderColor: colors.border, textColor: colors.textMuted }
        : { backgroundColor: colors.surfaceMuted, borderColor: colors.border, textColor: colors.text };

  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
      ]}
    >
      <Text style={[styles.tagText, { color: palette.textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  styles,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
}): React.JSX.Element {
  return (
    <Pressable
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? colors.primarySoft : colors.surface,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.filterChipText,
          { color: active ? colors.primary : colors.textMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SessionRow({
  row,
  styles,
  colors,
  t,
  onPress,
}: {
  row: SessionBoardRow;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
  t: ReturnType<typeof useTranslation<'console'>>['t'];
  onPress: () => void;
}): React.JSX.Element {
  const statusLabel = row.status === 'active'
    ? t('Active')
    : row.status === 'recent'
      ? t('Recent')
      : t('Idle');
  const kindLabel = row.kind === 'subagent'
    ? t('Subagent')
    : row.kind === 'cron'
      ? t('Cron')
      : row.kind === 'direct'
        ? t('Direct')
        : row.kind === 'group'
          ? t('Group')
          : row.kind === 'main'
            ? t('Main')
            : t('Other');

  return (
    <Pressable
      style={({ pressed }) => [
        styles.rowCard,
        { borderColor: colors.borderStrong, opacity: pressed ? 0.58 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={styles.rowLine}>
        <View style={styles.rowLead}>
          <SessionTag label={statusLabel} styles={styles} colors={colors} tone={row.status} />
          <SessionTag label={kindLabel} styles={styles} colors={colors} tone="kind" />
          {row.channelLabel ? <SessionTag label={row.channelLabel} styles={styles} colors={colors} tone="kind" /> : null}
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
            {row.title}
          </Text>
        </View>
        <View style={styles.rowTrail}>
          <Text style={[styles.rowTime, { color: colors.textSubtle }]}>
            {row.updatedAt > 0 ? relativeTime(row.updatedAt) : t('Unknown')}
          </Text>
        </View>
      </View>

      <View style={styles.rowSubline}>
        <Text style={[styles.rowPreview, { color: colors.textMuted }]} numberOfLines={1}>
          {row.preview || t('No recent message')}
        </Text>
        {row.modelLabel ? (
          <Text style={[styles.rowMeta, { color: colors.textSubtle }]} numberOfLines={1}>
            {row.modelLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SessionsBoardScreen(): React.JSX.Element {
  const navigation = useNavigation<SessionsBoardNavigation>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { gateway, currentAgentId, agents, requestChatSession } = useAppContext();
  const isFocused = useIsFocused();
  const stylesMemo = useMemo(() => createStyles(theme.colors), [theme]);
  const [rows, setRows] = useState<SessionBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const currentAgentName = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId)?.identity?.name
      ?? agents.find((agent) => agent.id === currentAgentId)?.name
      ?? null,
    [agents, currentAgentId],
  );

  const load = useCallback(async (mode: 'initial' | 'manual' | 'poll' = 'manual') => {
    if (mode === 'initial') setLoading(true);
    else if (mode === 'manual') setRefreshing(true);
    try {
      const payload = await gateway.request<SessionListPayload>('sessions.list', {
        limit: 200,
        includeLastMessage: true,
        includeDerivedTitles: true,
        agentId: currentAgentId,
      });
      setRows(buildSessionBoardRows(normalizeSessions(payload), { currentAgentName }));
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load sessions board');
      setError(message);
    } finally {
      setLoading(false);
      if (mode === 'manual') setRefreshing(false);
    }
  }, [currentAgentId, currentAgentName, gateway, t]);

  useNativeStackModalHeader({
    navigation,
    title: t('Sessions Board'),
    onClose: () => navigation.goBack(),
    rightContent: (
      <HeaderActionButton
        icon={RefreshCw}
        onPress={() => {
          void load('manual');
        }}
        disabled={refreshing}
      />
    ),
  });

  useEffect(() => {
    if (!isFocused) return;
    void load('initial');
  }, [isFocused, load]);

  useEffect(() => {
    if (!isFocused) return undefined;
    const timer = setInterval(() => {
      void load('poll');
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isFocused, load]);

  const filteredRows = useMemo(
    () => filterSessionBoardRows(rows, {
      query,
      status: statusFilter,
      kind: kindFilter,
    }),
    [kindFilter, query, rows, statusFilter],
  );
  const summary = useMemo(() => summarizeSessionBoardRows(rows), [rows]);
  const handleOpenSession = useCallback((sessionKey: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    navigation.getParent()?.navigate('Chat' as never);
    requestAnimationFrame(() => {
      requestChatSession(sessionKey);
    });
  }, [navigation, requestChatSession]);

  return (
    <View style={[stylesMemo.root, { backgroundColor: theme.colors.background }]}>
      <FlashList
        data={filteredRows}
        keyExtractor={(item) => item.key}
        maintainVisibleContentPosition={{ disabled: true }}
        ListHeaderComponent={(
          <View>
            <View style={stylesMemo.headerWrap}>
              <SearchInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('Search sessions board')}
                style={stylesMemo.search}
              />

              <View style={stylesMemo.summaryRow}>
                <Text style={[stylesMemo.summaryText, { color: theme.colors.text }]}>
                  {t('{{count}} active', { count: summary.active })}
                </Text>
                <Text style={[stylesMemo.summaryDivider, { color: theme.colors.textSubtle }]}>·</Text>
                <Text style={[stylesMemo.summaryText, { color: theme.colors.text }]}>
                  {t('{{count}} recent', { count: summary.recent })}
                </Text>
                <Text style={[stylesMemo.summaryDivider, { color: theme.colors.textSubtle }]}>·</Text>
                <Text style={[stylesMemo.summaryText, { color: theme.colors.text }]}>
                  {t('{{count}} idle', { count: summary.idle })}
                </Text>
              </View>

              <View style={stylesMemo.filterGroup}>
                {STATUS_FILTERS.map((item) => (
                  <FilterChip
                    key={item.key}
                    label={t(item.label)}
                    active={statusFilter === item.key}
                    onPress={() => setStatusFilter(item.key)}
                    styles={stylesMemo}
                    colors={theme.colors}
                  />
                ))}
              </View>

              <View style={stylesMemo.filterGroup}>
                {KIND_FILTERS.map((item) => (
                  <FilterChip
                    key={item.key}
                    label={t(item.label)}
                    active={kindFilter === item.key}
                    onPress={() => setKindFilter(item.key)}
                    styles={stylesMemo}
                    colors={theme.colors}
                  />
                ))}
              </View>

              {error ? (
                <Text style={[stylesMemo.errorText, { color: theme.colors.error }]}>
                  {error}
                </Text>
              ) : null}
            </View>
            <View style={[stylesMemo.headerDivider, { borderColor: theme.colors.border }]} />
          </View>
        )}
        ListEmptyComponent={(
          <EmptyState
            title={loading ? t('Loading sessions board...') : t('No sessions matched')}
            subtitle={loading ? t('Fetching sessions and latest messages.') : t('Try a different search term.')}
          />
        )}
        renderItem={({ item }) => (
          <SessionRow
            row={item}
            styles={stylesMemo}
            colors={theme.colors}
            t={t}
            onPress={() => handleOpenSession(item.key)}
          />
        )}
        contentContainerStyle={createListContentStyle({
          top: Space.sm,
          bottom: Space.xxxl,
          grow: filteredRows.length === 0,
        })}
        ItemSeparatorComponent={() => <View style={stylesMemo.separator} />}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    headerWrap: {
      paddingHorizontal: 0,
      paddingBottom: Space.xs,
      gap: Space.xs,
    },
    search: {
      minHeight: 36,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Space.xs,
      paddingVertical: Space.xs,
    },
    summaryText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    summaryDivider: {
      fontSize: FontSize.sm,
    },
    filterGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
    },
    filterChip: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
    },
    filterChipText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    tag: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.sm,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    tagText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    errorText: {
      fontSize: FontSize.xs,
    },
    separator: {
      height: 0,
    },
    headerDivider: {
      borderBottomWidth: 1,
    },
    rowCard: {
      borderBottomWidth: 1,
      paddingHorizontal: 0,
      paddingVertical: 6,
      gap: 3,
    },
    rowLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.xs,
    },
    rowLead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flex: 1,
      minWidth: 0,
    },
    rowTrail: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Space.xs,
      marginLeft: Space.xs,
      maxWidth: '20%',
    },
    rowTime: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
    rowTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    rowModel: {
      fontSize: FontSize.xs,
      flexShrink: 1,
    },
    rowSubline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    rowMeta: {
      fontSize: FontSize.xs,
      flexShrink: 1,
      maxWidth: '38%',
    },
    rowPreview: {
      flex: 1,
      fontSize: FontSize.xs,
      lineHeight: 13,
    },
  });
}
