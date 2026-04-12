import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { RefreshCw } from 'lucide-react-native';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { EmptyState, HeaderActionButton } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import type { AgentInfo } from '../../types/agent';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import { SessionInfo } from '../../types';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import { relativeTime, sanitizeSilentPreviewText, sessionLabel } from '../../utils/chat-message';
import type { ConsoleStackParamList } from './ConsoleTab';
import {
  buildSessionBoardRows,
  type SessionBoardKind,
  type SessionBoardRow,
} from './sessions-board';

type AgentSessionsBoardNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'AgentSessionsBoard'>;

type SessionListPayload = {
  sessions?: SessionInfo[];
  defaults?: {
    contextTokens?: number;
  };
};

type OverviewMode = 'agents' | 'sessions';
type OverviewStatus = 'running' | 'ready' | 'recent' | 'idle';

type AgentOverviewCard = {
  agentId: string;
  displayName: string;
  emoji: string;
  isCurrent: boolean;
  updatedAt: number;
  status: OverviewStatus;
  preview: string;
  sessionKey: string;
};

type SessionOverviewCard = {
  key: string;
  agentId: string | null;
  title: string;
  preview: string;
  updatedAt: number;
  status: OverviewStatus;
  primaryBadge: string | null;
  secondaryBadge: string | null;
};

const REFRESH_INTERVAL_MS = 3_000;
const RUNNING_WINDOW_MS = 90_000;
const READY_WINDOW_MS = 15 * 60_000;
const RECENT_WINDOW_MS = 4 * 60 * 60_000;

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

function agentIdFromSessionKey(key: string): string | null {
  if (!key.startsWith('agent:')) return null;
  const [, agentId] = key.split(':');
  return agentId || null;
}

function normalizeChannelLabel(channel?: string): string | null {
  const normalized = channel?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'feishu' || normalized === 'lark') return 'Feishu';
  if (normalized === 'whatsapp') return 'WhatsApp';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function kindLabel(kind: SessionBoardKind, t: ReturnType<typeof useTranslation<'console'>>['t']): string {
  if (kind === 'main') return t('Main');
  if (kind === 'subagent') return t('Subagent');
  if (kind === 'cron') return t('Cron');
  if (kind === 'direct') return t('Direct');
  if (kind === 'group') return t('Group');
  return t('Other');
}

function resolveOverviewStatus(updatedAt: number, now: number): OverviewStatus {
  const age = Math.max(0, now - updatedAt);
  if (age <= RUNNING_WINDOW_MS) return 'running';
  if (age <= READY_WINDOW_MS) return 'ready';
  if (age <= RECENT_WINDOW_MS) return 'recent';
  return 'idle';
}

function sortStatus(status: OverviewStatus): number {
  return { running: 4, ready: 3, recent: 2, idle: 1 }[status];
}

function statusLabel(status: OverviewStatus, t: ReturnType<typeof useTranslation<'console'>>['t']): string {
  if (status === 'running') return t('Running');
  if (status === 'ready') return t('Ready');
  if (status === 'recent') return t('Recent');
  return t('Idle');
}

function statusTone(
  status: OverviewStatus,
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): { background: string; border: string; text: string; dot: string } {
  if (status === 'running') {
    return {
      background: colors.primarySoft,
      border: colors.primary,
      text: colors.primary,
      dot: colors.primary,
    };
  }
  if (status === 'ready') {
    return {
      background: colors.surfaceMuted,
      border: colors.warning,
      text: colors.warning,
      dot: colors.warning,
    };
  }
  if (status === 'recent') {
    return {
      background: colors.surfaceMuted,
      border: colors.borderStrong,
      text: colors.textMuted,
      dot: colors.textMuted,
    };
  }
  return {
    background: colors.surfaceMuted,
    border: colors.border,
    text: colors.textSubtle,
    dot: colors.textSubtle,
  };
}

function titleForSession(session: SessionInfo, agentsById: Map<string, AgentInfo>): string {
  const ownerAgentId = agentIdFromSessionKey(session.key);
  const ownerName = ownerAgentId
    ? (agentsById.get(ownerAgentId)?.identity?.name?.trim()
      || agentsById.get(ownerAgentId)?.name?.trim()
      || null)
    : null;
  return sessionLabel(session, { currentAgentName: ownerName });
}

function buildAgentCards(params: {
  rows: SessionBoardRow[];
  agents: AgentInfo[];
  currentAgentId: string;
  query: string;
  t: ReturnType<typeof useTranslation<'console'>>['t'];
  now: number;
}): AgentOverviewCard[] {
  const grouped = new Map<string, SessionBoardRow[]>();
  for (const row of params.rows) {
    const agentId = agentIdFromSessionKey(row.key);
    if (!agentId) continue;
    const existing = grouped.get(agentId);
    if (existing) existing.push(row);
    else grouped.set(agentId, [row]);
  }

  const query = params.query.trim().toLowerCase();
  const ids = new Set<string>([
    ...params.agents.map((agent) => agent.id),
    ...grouped.keys(),
  ]);

  return Array.from(ids)
    .map((agentId) => {
      const agent = params.agents.find((item) => item.id === agentId);
      const sessions = (grouped.get(agentId) ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
      const lead = sessions[0];
      const displayName = agent?.identity?.name?.trim() || agent?.name?.trim() || agentId;
      const preview = lead?.preview || params.t('No recent message');
      const updatedAt = lead?.updatedAt ?? 0;
      const status = resolveOverviewStatus(updatedAt, params.now);
      const card = {
        agentId,
        displayName,
        emoji: getDisplayAgentEmoji(agent?.identity?.emoji),
        isCurrent: agentId === params.currentAgentId,
        updatedAt,
        status,
        preview,
        sessionKey: `agent:${agentId}:main`,
      } satisfies AgentOverviewCard;
      return card;
    })
    .filter((card) => {
      if (!query) return true;
      return [
        card.displayName,
        card.preview,
      ]
        .join('\n')
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      if (sortStatus(a.status) !== sortStatus(b.status)) return sortStatus(b.status) - sortStatus(a.status);
      return b.updatedAt - a.updatedAt;
    });
}

function buildSessionCards(params: {
  sessions: SessionInfo[];
  agents: AgentInfo[];
  query: string;
  now: number;
  t: ReturnType<typeof useTranslation<'console'>>['t'];
}): SessionOverviewCard[] {
  const agentsById = new Map(params.agents.map((agent) => [agent.id, agent]));
  const rows = buildSessionBoardRows(params.sessions).map((row) => {
    const source = params.sessions.find((session) => session.key === row.key);
    const agentId = agentIdFromSessionKey(row.key);
    return {
      key: row.key,
      agentId,
      title: source ? titleForSession(source, agentsById) : row.title,
      preview: row.preview || params.t('No recent message'),
      updatedAt: row.updatedAt,
      status: resolveOverviewStatus(row.updatedAt, params.now),
      primaryBadge: row.channelLabel || kindLabel(row.kind, params.t),
      secondaryBadge: row.modelLabel,
    } satisfies SessionOverviewCard;
  });

  const query = params.query.trim().toLowerCase();
  return rows
    .filter((card) => {
      if (!query) return true;
      return [
        card.title,
        card.preview,
        card.primaryBadge,
        card.secondaryBadge,
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => {
      if (sortStatus(a.status) !== sortStatus(b.status)) return sortStatus(b.status) - sortStatus(a.status);
      return b.updatedAt - a.updatedAt;
    });
}

function SegmentedControl({
  value,
  onChange,
  styles,
  colors,
  t,
}: {
  value: OverviewMode;
  onChange: (next: OverviewMode) => void;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
  t: ReturnType<typeof useTranslation<'console'>>['t'];
}): React.JSX.Element {
  const items: OverviewMode[] = ['agents', 'sessions'];
  return (
    <View style={[styles.segmentedWrap, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      {items.map((item) => {
        const active = value === item;
        return (
          <Pressable
            key={item}
            style={[
              styles.segmentedItem,
              {
                backgroundColor: active ? colors.surfaceElevated : 'transparent',
                borderColor: active ? colors.borderStrong : 'transparent',
              },
            ]}
            onPress={() => onChange(item)}
          >
            <Text style={[styles.segmentedText, { color: active ? colors.text : colors.textMuted }]}>
              {item === 'agents' ? t('Agents') : t('Sessions')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionTitle({
  title,
  styles,
  colors,
}: {
  title: string;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
}): React.JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
    </View>
  );
}

function AgentCard({
  card,
  styles,
  colors,
  t,
  onPress,
  onSettingsPress,
}: {
  card: AgentOverviewCard;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
  t: ReturnType<typeof useTranslation<'console'>>['t'];
  onPress: () => void;
  onSettingsPress?: () => void;
}): React.JSX.Element {
  const tone = statusTone(card.status, colors);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.agentCard,
        {
          backgroundColor: card.isCurrent ? colors.surfaceElevated : colors.surface,
          borderColor: card.isCurrent ? colors.borderStrong : colors.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.agentIdentity}>
          <View style={[styles.agentEmojiWrap, { backgroundColor: colors.primarySoft }]}>
            <Text style={styles.agentEmoji}>{card.emoji}</Text>
          </View>
          <View style={styles.agentMeta}>
            <View style={styles.agentNameRow}>
              <Text style={[styles.agentName, { color: colors.text }]} numberOfLines={1}>
                {card.displayName}
              </Text>
              <Text style={[styles.agentTime, { color: colors.textSubtle }]}>
                {card.updatedAt > 0 ? relativeTime(card.updatedAt) : t('Unknown')}
              </Text>
            </View>
            <View style={styles.agentStatusRow}>
              <View style={[styles.agentStatusDot, { backgroundColor: tone.dot }]} />
              <Text style={[styles.agentStatusText, { color: colors.textMuted }]} numberOfLines={1}>
                {statusLabel(card.status, t)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.agentDivider, { backgroundColor: colors.border }]} />

      <Text style={[styles.agentPreview, { color: colors.text }]} numberOfLines={2}>
        {card.preview}
      </Text>

      {onSettingsPress ? (
        <Pressable
          style={({ pressed }) => [
            styles.agentSettingsButton,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
          onPress={onSettingsPress}
        >
          <Text style={[styles.agentSettingsButtonText, { color: colors.text }]}>
            {t('Edit Agent')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function SessionCard({
  card,
  compact = false,
  styles,
  colors,
  t,
  onPress,
}: {
  card: SessionOverviewCard;
  compact?: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAppTheme>['theme']['colors'];
  t: ReturnType<typeof useTranslation<'console'>>['t'];
  onPress: () => void;
}): React.JSX.Element {
  const tone = statusTone(card.status, colors);
  return (
    <Pressable
      style={({ pressed }) => [
        compact ? styles.sessionCardCompact : styles.sessionCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={styles.sessionTopRow}>
        <Text style={[styles.sessionTitle, { color: colors.text }]} numberOfLines={1}>
          {card.title}
        </Text>
        <Text style={[styles.sessionTime, { color: colors.textSubtle }]}>
          {card.updatedAt > 0 ? relativeTime(card.updatedAt) : t('Unknown')}
        </Text>
      </View>

      <Text
        style={[compact ? styles.sessionPreviewCompact : styles.sessionPreview, { color: colors.textMuted }]}
        numberOfLines={compact ? 2 : 3}
      >
        {card.preview}
      </Text>

      <View style={styles.sessionFootRow}>
        <View style={styles.sessionBadges}>
          {card.primaryBadge ? (
            <View style={[styles.metaPill, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={[styles.metaPillText, { color: colors.textMuted }]} numberOfLines={1}>
                {card.primaryBadge}
              </Text>
            </View>
          ) : null}
          {card.secondaryBadge && !compact ? (
            <View style={[styles.metaPill, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={[styles.metaPillText, { color: colors.textMuted }]} numberOfLines={1}>
                {card.secondaryBadge}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[
          styles.statusPill,
          { backgroundColor: tone.background, borderColor: tone.border },
        ]}
        >
          <View style={[styles.statusDot, { backgroundColor: tone.dot }]} />
          <Text style={[styles.statusPillText, { color: tone.text }]}>
            {statusLabel(card.status, t)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function AgentSessionsBoardScreen(): React.JSX.Element {
  const navigation = useNavigation<AgentSessionsBoardNavigation>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { gateway, currentAgentId, agents, requestOfficeChat, switchAgent } = useAppContext();
  const capabilities = useMemo(() => gateway.getBackendCapabilities(), [gateway]);
  const canOpenAgentDetail = capabilities.consoleAgentDetail;
  const isFocused = useIsFocused();
  const stylesMemo = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<OverviewMode>('agents');

  const load = useCallback(async (loadMode: 'initial' | 'manual' | 'poll' = 'manual') => {
    if (loadMode === 'initial') setLoading(true);
    else if (loadMode === 'manual') setRefreshing(true);
    try {
      const payload = await gateway.request<SessionListPayload>('sessions.list', {
        limit: 200,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
      setSessions(normalizeSessions(payload));
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load sessions board');
      setError(message);
    } finally {
      setLoading(false);
      if (loadMode === 'manual') setRefreshing(false);
    }
  }, [gateway, t]);

  useNativeStackModalHeader({
    navigation,
    title: t('Agent & Session Board'),
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

  const now = Date.now();
  const agentCards = useMemo(
    () => buildAgentCards({
      rows: buildSessionBoardRows(sessions),
      agents,
      currentAgentId,
      query,
      t,
      now,
    }),
    [agents, currentAgentId, now, query, sessions, t],
  );
  const sessionCards = useMemo(
    () => buildSessionCards({
      sessions,
      agents,
      query,
      now,
      t,
    }),
    [agents, now, query, sessions, t],
  );

  const readySessions = sessionCards.filter((card) => card.status === 'ready').length;
  const nowSessions = sessionCards.filter((card) => card.status === 'running' || card.status === 'ready').slice(0, 3);
  const recentSessions = sessionCards.filter((card) => card.status === 'recent' || card.status === 'idle');
  const featuredRecent = recentSessions.slice(0, 4);

  const openSession = useCallback((sessionKey: string, agentId?: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    navigation.getParent()?.navigate('Chat' as never);
    requestAnimationFrame(() => {
      if (agentId && agentId !== currentAgentId) {
        switchAgent(agentId);
      }
      requestOfficeChat(sessionKey);
    });
  }, [currentAgentId, navigation, requestOfficeChat, switchAgent]);

  const openAgent = useCallback((agentId: string, sessionKey: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    navigation.getParent()?.navigate('Chat' as never);
    requestAnimationFrame(() => {
      if (agentId !== currentAgentId) {
        switchAgent(agentId);
      }
      requestOfficeChat(sessionKey);
    });
  }, [currentAgentId, navigation, requestOfficeChat, switchAgent]);

  const openAgentSettings = useCallback((agentId: string) => {
    if (!canOpenAgentDetail) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('AgentDetail', { agentId });
  }, [canOpenAgentDetail, navigation]);

  return (
    <View style={[stylesMemo.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={stylesMemo.scrollContent}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing && !loading}
            onRefresh={() => {
              void load('manual');
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        )}
        showsVerticalScrollIndicator={false}
      >
        <SegmentedControl
          value={mode}
          onChange={setMode}
          styles={stylesMemo}
          colors={theme.colors}
          t={t}
        />

        {error ? (
          <Text style={[stylesMemo.errorText, { color: theme.colors.error }]}>
            {error}
          </Text>
        ) : null}

        {loading && sessions.length === 0 ? (
          <EmptyState
            title={t('Loading sessions board...')}
            subtitle={t('Fetching sessions and latest messages.')}
          />
        ) : mode === 'agents' ? (
          <>
            <SectionTitle
              title={t('Focus')}
              styles={stylesMemo}
              colors={theme.colors}
            />
            <View style={stylesMemo.agentGrid}>
              {agentCards.slice(0, 4).map((card) => (
                <View key={card.agentId} style={stylesMemo.agentGridCell}>
                  <AgentCard
                    card={card}
                    styles={stylesMemo}
                    colors={theme.colors}
                    t={t}
                    onPress={() => openAgent(card.agentId, card.sessionKey)}
                    onSettingsPress={canOpenAgentDetail ? () => openAgentSettings(card.agentId) : undefined}
                  />
                </View>
              ))}
            </View>

            {agentCards.length > 4 ? (
              <>
                <SectionTitle
                  title={t('Recent')}
                  styles={stylesMemo}
                  colors={theme.colors}
                />
                <View style={stylesMemo.agentGrid}>
                  {agentCards.slice(4, 8).map((card) => (
                    <View key={card.agentId} style={stylesMemo.agentGridCell}>
                      <AgentCard
                        card={card}
                        styles={stylesMemo}
                        colors={theme.colors}
                        t={t}
                        onPress={() => openAgent(card.agentId, card.sessionKey)}
                        onSettingsPress={() => openAgentSettings(card.agentId)}
                      />
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {agentCards.length === 0 ? (
              <EmptyState
                title={t('No agents matched')}
                subtitle={t('Try a different search term.')}
              />
            ) : null}
          </>
        ) : (
          <>
            <SectionTitle
              title={t('Now')}
              styles={stylesMemo}
              colors={theme.colors}
            />
            <View style={stylesMemo.cardsColumn}>
              {nowSessions.map((card) => (
                <SessionCard
                  key={card.key}
                  card={card}
                  styles={stylesMemo}
                  colors={theme.colors}
                  t={t}
                  onPress={() => openSession(card.key, card.agentId)}
                />
              ))}
            </View>

            <SectionTitle
              title={t('Recent')}
              styles={stylesMemo}
              colors={theme.colors}
            />
            <View style={stylesMemo.compactGrid}>
              {featuredRecent.map((card) => (
                <View key={card.key} style={stylesMemo.compactCell}>
                  <SessionCard
                    card={card}
                    compact
                    styles={stylesMemo}
                    colors={theme.colors}
                    t={t}
                    onPress={() => openSession(card.key, card.agentId)}
                  />
                </View>
              ))}
            </View>

            {sessionCards.length === 0 ? (
              <EmptyState
                title={t('No sessions matched')}
                subtitle={t('Try a different search term.')}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xxxl,
      gap: Space.lg,
    },
    segmentedWrap: {
      flexDirection: 'row',
      borderWidth: 1,
      borderRadius: Radius.full,
      padding: 3,
      gap: Space.xs,
    },
    segmentedItem: {
      flex: 1,
      minHeight: 38,
      borderRadius: Radius.full,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.md,
    },
    segmentedText: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    errorText: {
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: Space.sm,
    },
    sectionTitle: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.semibold,
    },
    cardsColumn: {
      gap: Space.md,
    },
    agentGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -Space.xs,
    },
    agentGridCell: {
      width: '50%',
      paddingHorizontal: Space.xs,
      marginBottom: Space.sm,
    },
    agentCard: {
      borderWidth: 1,
      borderRadius: Radius.lg,
      padding: Space.md,
      gap: 10,
      minHeight: 178,
      ...Shadow.sm,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
    },
    agentIdentity: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
      flex: 1,
      minWidth: 0,
    },
    agentEmojiWrap: {
      width: 42,
      height: 42,
      borderRadius: Radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentEmoji: {
      fontSize: 22,
    },
    agentMeta: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    agentNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    agentName: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    agentTime: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
      flexShrink: 0,
    },
    agentStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    agentStatusDot: {
      width: 8,
      height: 8,
      borderRadius: Radius.full,
    },
    agentStatusText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    agentDivider: {
      height: StyleSheet.hairlineWidth,
      width: '100%',
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 5,
      flexShrink: 0,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: Radius.full,
    },
    statusPillText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    agentPreview: {
      fontSize: FontSize.lg,
      lineHeight: 24,
      minHeight: 44,
    },
    agentSettingsButton: {
      minHeight: 32,
      borderWidth: 1,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.md,
    },
    agentSettingsButtonText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    sessionCard: {
      borderWidth: 1,
      borderRadius: Radius.lg,
      padding: Space.lg,
      gap: Space.md,
      ...Shadow.sm,
    },
    sessionCardCompact: {
      borderWidth: 1,
      borderRadius: Radius.lg,
      padding: Space.md,
      gap: Space.sm,
      ...Shadow.sm,
    },
    sessionTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.sm,
    },
    sessionTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
    },
    sessionTime: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    sessionPreview: {
      fontSize: FontSize.base,
      lineHeight: 22,
      minHeight: 44,
    },
    sessionPreviewCompact: {
      fontSize: FontSize.md,
      lineHeight: 18,
    },
    sessionFootRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.sm,
    },
    sessionBadges: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
      flex: 1,
      minWidth: 0,
    },
    metaPill: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 5,
      maxWidth: '100%',
    },
    metaPillText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    compactGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -Space.xs,
    },
    compactCell: {
      width: '50%',
      paddingHorizontal: Space.xs,
      marginBottom: Space.sm,
    },
  });
}
