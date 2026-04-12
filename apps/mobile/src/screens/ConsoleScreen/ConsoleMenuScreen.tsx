import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, Share2 } from 'lucide-react-native';
import { Animated, Easing, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { IconButton } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useConnectionState } from '../../hooks/useConnectionState';
import { logAppTelemetry } from '../../services/app-telemetry';
import { analyticsEvents } from '../../services/analytics/events';
import { readAgentAvatar } from '../../services/agent-avatar';
import { buildConsoleLibraryEntryDescriptors } from '../../services/console-entry-descriptors';
import { loadGatewayConsoleDashboardBundle } from '../../services/gateway-console-dashboard';
import { resolveGatewayBackendKind, selectByBackend } from '../../services/gateway-backends';
import { StorageService } from '../../services/storage';
import { resolveDashboardCostDisplay } from '../../services/usage-cost-display';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import { formatConsoleHeartbeatAge } from '../../utils/console-heartbeat';
import { parseGatewayRuntimeSettings } from '../../utils/gateway-settings';
import { getConsoleHeaderRefreshState } from './hooks/consoleHeaderRefreshPolicy';
import { HermesConsoleMenuScreen } from './HermesConsoleMenuScreen';
import { StatsPosterModal } from './StatsPosterModal';
import type { ConsoleStackParamList } from './ConsoleTab';
import { isCronJobForAgent } from './cronData';
import { isConsoleScreenSupported } from './console-screen-support';

type ConsoleMenuNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'ConsoleMenu'>;

// ---- Types ----

export type DashboardData = {
  agentName: string;
  agentEmoji: string;
  cost: string | null;
  costDisplayLabel: string | null;
  costBadge: string | null;
  tokens: string | null;
  agents: number | null;
  channels: number | null;
  cronTotal: number | null;
  cronFailed: number | null;
  skills: number | null;
  tools: number | null;
  models: number | null;
  sessions: number | null;
  files: number | null;
  messages: number | null;
  userMessages: number | null;
  toolCalls: number | null;
  lastHeartbeat: string | null;
  nodes: number | null;
  nodeSummary: string | null;
  nodeCounts: NodeSummary | null;
  pendingPairCount: number | null;
  devices: number | null;
  configDefaultModel: string | null;
  configHeartbeat: string | null;
  configActiveHours: string | null;
};

// ---- Helpers ----

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function classifyNodePlatform(node: { platform?: string; deviceFamily?: string }): 'mobile' | 'desktop' {
  const family = (node.deviceFamily ?? '').toLowerCase();
  if (family === 'iphone' || family === 'ipad' || family === 'android') return 'mobile';
  if (family === 'mac' || family === 'linux' || family === 'windows') return 'desktop';

  const platform = (node.platform ?? '').toLowerCase();
  if (platform.startsWith('ios') || platform.startsWith('ipados') || platform.startsWith('android')) return 'mobile';
  return 'desktop';
}

type NodeSummary = { mobile: number; desktop: number; total: number };

type ConsoleMenuStatItem = {
  key: string;
  screen: keyof ConsoleStackParamList;
  source: string;
  emoji: string;
  label: string;
  value: React.ReactNode;
  valueStyle?: object;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
};

type ConsoleMenuHeroItem = {
  key: string;
  screen: keyof ConsoleStackParamList;
  source: string;
  label: string;
  value: React.ReactNode;
  badge?: string | null;
};

type ConsoleMenuGridItem = {
  key: string;
  screen: keyof ConsoleStackParamList;
  source: string;
  emoji: string;
  label: string;
  value: React.ReactNode;
  badge?: { text: string; color: string } | null;
};

type ConsoleMenuListItem = {
  key: string;
  screen: keyof ConsoleStackParamList;
  source: string;
  emoji: string;
  title: string;
  description: string;
  hideBorderBottom?: boolean;
};

function summarizeNodes(nodes: { platform?: string; deviceFamily?: string }[]): NodeSummary {
  let mobile = 0;
  let desktop = 0;
  for (const node of nodes) {
    if (classifyNodePlatform(node) === 'mobile') mobile++;
    else desktop++;
  }
  return { mobile, desktop, total: nodes.length };
}

function formatNodeSummary(nodes: { platform?: string; deviceFamily?: string }[]): string {
  if (nodes.length === 0) return '0';
  const { mobile, desktop } = summarizeNodes(nodes);
  if (mobile > 0 && desktop > 0) return `${mobile}📱 ${desktop}💻`;
  if (mobile > 0) return `${mobile} 📱`;
  if (desktop > 0) return `${desktop} 💻`;
  return String(nodes.length);
}

function renderNodeGridValue(
  nodeCounts: NodeSummary | null,
  textColor: string,
): React.ReactNode {
  if (!nodeCounts) return '—';
  return (
    <>
      {nodeCounts.mobile > 0 && (
        <>
          <Text style={[styles.gridValue, { color: textColor }]}>{nodeCounts.mobile}</Text>
          <Text style={styles.nodeDeviceIcon}>📱</Text>
        </>
      )}
      {nodeCounts.mobile > 0 && nodeCounts.desktop > 0 && <Text style={styles.nodeDeviceSpacer}>{' '}</Text>}
      {nodeCounts.desktop > 0 && (
        <>
          <Text style={[styles.gridValue, { color: textColor }]}>{nodeCounts.desktop}</Text>
          <Text style={styles.nodeDeviceIcon}>💻</Text>
        </>
      )}
      {nodeCounts.total === 0 && <Text style={[styles.gridValue, { color: textColor }]}>0</Text>}
    </>
  );
}

function isSessionInAgentScope(sessionKey: string | undefined, currentAgentId: string): boolean {
  if (!sessionKey) return false;
  return sessionKey.startsWith(`agent:${currentAgentId}:`);
}

function normalizeCacheScopePart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function resolveDashboardCacheScope(config: { url?: string; relay?: { gatewayId?: string } } | null, agentId: string): string | null {
  const normalizedAgentId = agentId.trim() || 'main';
  const relayGatewayId = config?.relay?.gatewayId?.trim();
  if (relayGatewayId) {
    return `relay:${normalizeCacheScopePart(relayGatewayId)}:agent:${normalizeCacheScopePart(normalizedAgentId)}`;
  }
  const url = config?.url?.trim();
  if (!url) return null;
  return `url:${normalizeCacheScopePart(url.replace(/\/+$/, ''))}:agent:${normalizeCacheScopePart(normalizedAgentId)}`;
}

function formatRelativeSnapshotAge(savedAt: number, now: number, t: ReturnType<typeof useTranslation<'console'>>['t']): string {
  const diffMs = Math.max(0, now - savedAt);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t('just now');
  if (mins < 60) return t('{{count}}m ago', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('{{count}}h ago', { count: hours });
  const days = Math.floor(hours / 24);
  return t('{{count}}d ago', { count: days });
}

// ---- Dashboard Hook ----

const EMPTY_DASHBOARD: DashboardData = {
  agentName: 'Hello?', agentEmoji: '🤖', cost: null, costDisplayLabel: null, costBadge: null, tokens: null,
  messages: null, userMessages: null, toolCalls: null, lastHeartbeat: null,
  agents: null, channels: null, cronTotal: null, cronFailed: null,
  skills: null, tools: null, models: null, sessions: null, files: null,
  nodes: null, nodeSummary: null, nodeCounts: null, pendingPairCount: null, devices: null,
  configDefaultModel: null, configHeartbeat: null, configActiveHours: null,
};

function useDashboardData() {
  const { gateway, gatewayEpoch, foregroundEpoch, currentAgentId, config } = useAppContext();
  const { t, i18n } = useTranslation(['console', 'common']);
  const isFocused = useIsFocused();
  const hasGateway = config != null;
  const cacheScope = useMemo(() => resolveDashboardCacheScope(config, currentAgentId), [config, currentAgentId]);
  const [data, setData] = useState<DashboardData>({
    ...EMPTY_DASHBOARD,
    agentName: hasGateway ? t('Connecting') : t('Hello?'),
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastForegroundRefreshRef = useRef(0);
  const lastForegroundEpochRef = useRef<number>(foregroundEpoch);
  const refreshSequenceRef = useRef(0);
  const refreshInFlightRef = useRef(0);
  const latestDataRef = useRef(data);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  const [lastRefreshError, setLastRefreshError] = useState<string | null>(null);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    let mounted = true;
    setHydratedFromCache(false);
    setLastUpdatedAt(null);
    setLastRefreshError(null);

    if (!cacheScope) {
      setData({
        ...EMPTY_DASHBOARD,
        agentName: hasGateway ? t('Connecting') : t('Hello?'),
      });
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    setLoading(true);
    StorageService.getDashboardCache<DashboardData>(cacheScope)
      .then((cached) => {
        if (!mounted || !cached) return;
        setData((prev) => ({
          ...prev,
          ...cached.data,
          agentName: cached.data.agentName || prev.agentName,
          agentEmoji: cached.data.agentEmoji || prev.agentEmoji,
        }));
        setLastUpdatedAt(cached.savedAt > 0 ? cached.savedAt : null);
        setHydratedFromCache(true);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [cacheScope, hasGateway, t]);

  const refresh = useCallback(async (reason: 'focus' | 'foreground' | 'pull_to_refresh' | 'manual' = 'manual') => {
    const refreshId = ++refreshSequenceRef.current;
    const startedAt = Date.now();
    const currentData = latestDataRef.current;
    const hadVisibleData = currentData.cost !== null
      || currentData.agents !== null
      || currentData.cronTotal !== null
      || currentData.nodes !== null;
    logAppTelemetry('console_dashboard', 'refresh_start', {
      refreshId,
      reason,
      currentAgentId,
      hasGatewayConfig: hasGateway,
      connectionState: gateway.getConnectionState(),
      hadVisibleData,
    });
    refreshInFlightRef.current += 1;
    setRefreshing(true);
    setLastRefreshError(null);
    if (!gateway) {
      setData({
        ...EMPTY_DASHBOARD,
        agentName: hasGateway ? t('Connecting') : t('Hello?'),
      });
      setLoading(false);
      logAppTelemetry('console_dashboard', 'refresh_end', {
        refreshId,
        reason,
        currentAgentId,
        durationMs: Date.now() - startedAt,
        connectionState: 'disconnected',
        hasVisibleData: false,
      });
      return;
    }

    try {
      if (!hadVisibleData) setLoading(true);
      const today = getTodayDateStr();
      const [ackedIds, settledResults] = await Promise.all([
        StorageService.getAckedCronFailures(),
        loadGatewayConsoleDashboardBundle(gateway, currentAgentId, today),
      ]);

      const {
        identity,
        files,
        channels,
        cron,
        skills,
        modelCount,
        sessions,
        usage,
        lastHeartbeat,
        cost,
        agents,
        nodes,
        nodePairs,
        devices,
        config: gatewayConfig,
        tools,
      } = settledResults;

      const hasUsageData = Array.isArray(usage?.sessions);
      const usageValue = usage;
      const usageSessionsForAgent = hasUsageData
        ? (usageValue?.sessions ?? []).filter((session) => isSessionInAgentScope(session.key, currentAgentId))
        : [];
      const usageTotals = hasUsageData
        ? usageSessionsForAgent.reduce(
            (acc, session) => {
              acc.totalCost += session.usage?.totalCost ?? 0;
              acc.totalTokens += session.usage?.totalTokens ?? 0;
              acc.messages += session.usage?.messageCounts?.total ?? 0;
              acc.userMessages += session.usage?.messageCounts?.user ?? 0;
              acc.toolCalls += session.usage?.messageCounts?.toolCalls ?? 0;
              return acc;
            },
            { totalCost: 0, totalTokens: 0, messages: 0, userMessages: 0, toolCalls: 0 },
          )
        : null;
      const hasCronData = Array.isArray(cron?.jobs);
      const cronValue = cron;
      const jobsForAgent = hasCronData
        ? cronValue?.jobs?.filter((job) => isCronJobForAgent(job, currentAgentId)) ?? []
        : [];
      const hasSessionData = Array.isArray(sessions);
      const sessionsForAgent = hasSessionData
        ? sessions.filter((session) => isSessionInAgentScope(session.key, currentAgentId))
        : [];

      const fallbackCostLabel = (() => {
        if (cost?.totals?.totalCost != null) return formatCost(cost.totals.totalCost);
        if (usageTotals) return formatCost(usageTotals.totalCost);
        return null;
      })();
      const dashboardCostDisplay = resolveDashboardCostDisplay({
        usageResult: usage ?? null,
        costSummary: cost ?? null,
        fallbackCostLabel,
        t,
      });

      const nextData: DashboardData = {
        agentName: identity?.name
          ? identity.name
          : hasGateway ? t('Connecting') : t('Hello?'),
        agentEmoji: identity?.emoji
          ? identity.emoji
          : '🤖',
        cost: fallbackCostLabel,
        costDisplayLabel: dashboardCostDisplay.valueLabel,
        costBadge: dashboardCostDisplay.badge,
        tokens: (() => {
          if (cost?.totals?.totalTokens != null) return formatTokens(cost.totals.totalTokens);
          if (usageTotals) return formatTokens(usageTotals.totalTokens);
          return null;
        })(),
        agents: Array.isArray(agents?.agents) ? agents.agents.length : null,
        channels: Array.isArray(channels?.channelOrder) ? channels.channelOrder.length : null,
        cronTotal: hasCronData ? jobsForAgent.length : null,
        cronFailed: hasCronData ? jobsForAgent.filter((job) => job.state?.lastRunStatus === 'error' && !ackedIds.has(job.id)).length : null,
        skills: Array.isArray(skills?.skills) ? skills.skills.length : null,
        tools: Array.isArray(tools?.groups)
          ? tools.groups.reduce((sum, g) => sum + (g.tools?.length ?? 0), 0)
          : null,
        files: Array.isArray(files) ? files.length : null,
        models: modelCount,
        sessions: hasSessionData ? sessionsForAgent.length : null,
        lastHeartbeat: (() => {
          if (!lastHeartbeat) return null;
          const hb = lastHeartbeat as any;
          const ts = hb.lastHeartbeatAt || hb.ts || hb.timestamp;
          if (!ts) return null;
          const mins = Math.floor((Date.now() - ts) / 60_000);
          const formatted = formatConsoleHeartbeatAge(mins, i18n.resolvedLanguage ?? i18n.language ?? 'en');
          if (formatted.compactText) return formatted.compactText;
          if (formatted.count == null) return t(formatted.key);
          return t(formatted.key, { count: formatted.count });
        })(),
        messages: usageTotals?.messages ?? null,
        userMessages: usageTotals?.userMessages ?? null,
        toolCalls: usageTotals?.toolCalls ?? null,
        nodes: Array.isArray(nodes?.nodes) ? nodes.nodes.length : null,
        nodeSummary: Array.isArray(nodes?.nodes) ? formatNodeSummary(nodes.nodes) : null,
        nodeCounts: Array.isArray(nodes?.nodes) ? summarizeNodes(nodes.nodes) : null,
        pendingPairCount: (() => {
          const nodePending = nodePairs?.pending?.length ?? 0;
          const devicePending = devices?.pending?.length ?? 0;
          const total = nodePending + devicePending;
          return total > 0 ? total : null;
        })(),
        devices: Array.isArray(devices?.paired) ? devices.paired.length : null,
        ...(() => {
          if (!gatewayConfig?.config) {
            return { configDefaultModel: null, configHeartbeat: null, configActiveHours: null };
          }
          const parsed = parseGatewayRuntimeSettings(gatewayConfig.config);
          return {
            configDefaultModel: parsed.defaultModel || null,
            configHeartbeat: parsed.heartbeatEvery || null,
            configActiveHours: parsed.heartbeatActiveStart && parsed.heartbeatActiveEnd
              ? `${parsed.heartbeatActiveStart}–${parsed.heartbeatActiveEnd}`
              : null,
          };
        })(),
      };

      const hasAnyData = nextData.cost !== null || nextData.agents !== null || nextData.cronTotal !== null || nextData.nodes !== null;
      if (hasAnyData) {
        setData(nextData);
        const savedAt = Date.now();
        setLastUpdatedAt(savedAt);
        setHydratedFromCache(false);
        if (cacheScope) {
          void StorageService.setDashboardCache(cacheScope, {
            version: 2,
            cacheKey: cacheScope,
            savedAt,
            source: 'network',
            connectionStateAtSave: gateway.getConnectionState(),
            data: nextData,
          });
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard';
      setLastRefreshError(message);
    } finally {
      refreshInFlightRef.current = Math.max(0, refreshInFlightRef.current - 1);
      setRefreshing(refreshInFlightRef.current > 0);
      setLoading(false);
      const nextData = latestDataRef.current;
      const nextHadVisibleData = nextData.cost !== null
        || nextData.agents !== null
        || nextData.cronTotal !== null
        || nextData.nodes !== null;
      logAppTelemetry('console_dashboard', 'refresh_end', {
        refreshId,
        reason,
        currentAgentId,
        durationMs: Date.now() - startedAt,
        connectionState: gateway.getConnectionState(),
        hasVisibleData: nextHadVisibleData,
      });
    }
  }, [cacheScope, currentAgentId, gateway, hasGateway, t]);

  useEffect(() => {
    if (!isFocused) return;
    refresh('manual').catch(() => {});
  }, [gatewayEpoch, isFocused, refresh]);

  useFocusEffect(useCallback(() => { refresh('focus').catch(() => {}); }, [refresh]));

  useEffect(() => {
    if (!isFocused) return;
    if (lastForegroundEpochRef.current === foregroundEpoch) return;
    lastForegroundEpochRef.current = foregroundEpoch;
    const now = Date.now();
    if (now - lastForegroundRefreshRef.current < 2000) return;
    lastForegroundRefreshRef.current = now;
    refresh('foreground').catch(() => {});
  }, [foregroundEpoch, isFocused, refresh]);

  return { data, loading, refresh, refreshing, lastUpdatedAt, hydratedFromCache, lastRefreshError };
}

// ---- Components ----

function HeroCard({ label, value, onPress, colors, badge }: {
  label: string;
  value: React.ReactNode;
  onPress: () => void;
  colors: any;
  badge?: string | null;
}) {
  return (
    <TouchableOpacity
      style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.heroHeader}>
        <Text style={[styles.heroValue, { color: colors.text }]}>{value}</Text>
        <ChevronRight size={16} color={colors.textSubtle} strokeWidth={2} />
      </View>
      <View style={styles.heroLabelRow}>
        <Text style={[styles.heroLabel, { color: colors.textMuted }]}>{label}</Text>
        {badge ? <Text style={[styles.heroBadge, { color: colors.warning }]}>{badge}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function GridCard({ emoji, value, label, onPress, colors, badge }: {
  emoji: string;
  value: React.ReactNode;
  label: string;
  onPress: () => void;
  colors: any;
  badge?: { text: string; color: string } | null;
}) {
  return (
    <TouchableOpacity
      style={[styles.gridCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.gridTop}>
        <Text style={styles.gridEmoji}>{emoji}</Text>
        {badge ? (
          <Text style={[styles.gridBadge, { color: badge.color }]}>{badge.text}</Text>
        ) : (
          <ChevronRight size={14} color={colors.textSubtle} strokeWidth={2} />
        )}
      </View>
      {typeof value === 'string'
        ? <Text style={[styles.gridValue, { color: colors.text }]}>{value}</Text>
        : <View style={styles.gridValueRow}>{value}</View>}
      <Text style={[styles.gridLabel, { color: colors.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---- Main Screen ----

function OpenClawConsoleMenuScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t, i18n } = useTranslation('console');
  const { t: tCommon } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ConsoleMenuNavigation>();
  const { config, gateway, currentAgentId, agents, agentAvatars } = useAppContext();
  const backendKind = resolveGatewayBackendKind(config);
  const { data, refresh, refreshing, lastUpdatedAt, hydratedFromCache, lastRefreshError } = useDashboardData();
  const connectionState = useConnectionState();
  const colors = theme.colors;
  const capabilities = gateway.getBackendCapabilities();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const refreshSpin = useRef(new Animated.Value(0)).current;

  const handlePullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refresh('pull_to_refresh');
    } finally {
      setPullRefreshing(false);
    }
  }, [refresh]);
  const handleHeaderRefresh = useCallback(() => {
    void (async () => {
      if (connectionState !== 'ready') {
        const ok = await gateway.probeConnection();
        if (!ok) return;
      }
      await refresh('manual');
    })();
  }, [connectionState, gateway, refresh]);
  const [posterVisible, setPosterVisible] = useState(false);
  const posterAvatarUri = useMemo(() => {
    const agent = agents.find((a) => a.id === currentAgentId);
    const localAvatar = readAgentAvatar(agentAvatars, agent);
    if (localAvatar) return localAvatar;
    const remoteAvatar = agent?.identity?.avatar;
    if (!remoteAvatar) return undefined;
    const base = gateway.getBaseUrl();
    if (remoteAvatar.startsWith('data:') || remoteAvatar.startsWith('http')) return remoteAvatar;
    if (remoteAvatar.startsWith('/') && base) return `${base}${remoteAvatar}`;
    return undefined;
  }, [agents, currentAgentId, agentAvatars, gateway]);
  const headerRefreshState = useMemo(
    () => getConsoleHeaderRefreshState({ config, connectionState, refreshing }),
    [config, connectionState, refreshing],
  );
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const monthLabel = useMemo(
    () => new Date().toLocaleDateString(locale, { month: 'short' }).toUpperCase(),
    [locale],
  );
  const snapshotStatusLabel = useMemo(() => {
    if (!lastUpdatedAt) {
      if (lastRefreshError && connectionState !== 'ready') return t('Offline');
      return null;
    }
    const ageLabel = formatRelativeSnapshotAge(lastUpdatedAt, Date.now(), t);
    if (connectionState !== 'ready') {
      return hydratedFromCache
        ? t('Offline · Showing last snapshot ({{age}})', { age: ageLabel })
        : t('Offline · Updated {{age}}', { age: ageLabel });
    }
    if (refreshing) {
      return t('Refreshing · Updated {{age}}', { age: ageLabel });
    }
    return t('Updated {{age}}', { age: ageLabel });
  }, [connectionState, hydratedFromCache, lastRefreshError, lastUpdatedAt, refreshing, t]);
  const refreshIconStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: refreshSpin.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '360deg'],
          }),
        },
      ],
    }),
    [refreshSpin],
  );

  useEffect(() => {
    if (!headerRefreshState.spinning) {
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
      return;
    }

    refreshSpin.setValue(0);
    const spinLoop = Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinLoop.start();

    return () => {
      spinLoop.stop();
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
    };
  }, [headerRefreshState.spinning, refreshSpin]);

  const supportsScreen = useCallback(
    (screen: keyof ConsoleStackParamList) => isConsoleScreenSupported(screen, capabilities),
    [capabilities],
  );
  const nav = useCallback((screen: keyof ConsoleStackParamList, source: string) => {
    if (!supportsScreen(screen)) return;
    analyticsEvents.consoleEntryTapped({
      destination: screen,
      source,
    });
    navigation.navigate(screen as any);
  }, [navigation, supportsScreen]);
  const useCompactHeartbeatStat = locale === 'es'
    || locale.startsWith('es-')
    || locale === 'de'
    || locale.startsWith('de-');
  const statItems = useMemo<ConsoleMenuStatItem[]>(
    () => {
      const items: ConsoleMenuStatItem[] = [
      {
        key: 'tokens',
        screen: 'Usage',
        source: 'stats_tokens',
        emoji: '🌀',
        label: t('Tokens'),
        value: data.tokens ?? '—',
      },
      {
        key: 'messages',
        screen: 'ChatHistory',
        source: 'stats_messages',
        emoji: '💬',
        label: t('Messages'),
        value: data.messages != null ? String(data.messages) : '—',
      },
      {
        key: 'toolCalls',
        screen: 'ToolList',
        source: 'stats_tools',
        emoji: '🔧',
        label: t('Tool Calls'),
        value: data.toolCalls != null ? String(data.toolCalls) : '—',
      },
      {
        key: 'sessions',
        screen: 'SessionsBoard',
        source: 'stats_sessions',
        emoji: '🗂️',
        label: t('Sessions'),
        value: data.sessions != null ? String(data.sessions) : '—',
      },
      {
        key: 'heartbeat',
        screen: 'HeartbeatSettings',
        source: 'stats_heartbeat',
        emoji: '💓',
        label: t('Heartbeat'),
        value: data.lastHeartbeat ?? '—',
        valueStyle: useCompactHeartbeatStat ? styles.statValueCompact : undefined,
        numberOfLines: useCompactHeartbeatStat ? 1 : undefined,
        adjustsFontSizeToFit: useCompactHeartbeatStat,
        minimumFontScale: useCompactHeartbeatStat ? 0.85 : undefined,
      },
      ];
      return items.filter((item) => supportsScreen(item.screen));
    },
    [data.lastHeartbeat, data.messages, data.sessions, data.tokens, data.toolCalls, supportsScreen, t, useCompactHeartbeatStat],
  );
  const heroItems = useMemo<ConsoleMenuHeroItem[]>(
    () => {
      const items: ConsoleMenuHeroItem[] = [
      {
        key: 'cost',
        screen: 'Usage',
        source: 'hero_cost_today',
        label: t('Cost Today'),
        value: data.costDisplayLabel ?? '—',
        badge: data.costBadge,
      },
      {
        key: 'cron',
        screen: 'CronList',
        source: 'hero_cron_jobs',
        label: t('Cron Jobs'),
        value: <>{data.cronTotal != null ? String(data.cronTotal) : '—'} <Text style={styles.heroIcon}>⏰</Text></>,
        badge: data.cronFailed ? `⚠ ${t('{{count}} failed', { count: data.cronFailed })}` : null,
      },
      ];
      return items.filter((item) => supportsScreen(item.screen));
    },
    [data.cost, data.cronFailed, data.cronTotal, supportsScreen, t],
  );
  const gridRows = useMemo<ConsoleMenuGridItem[][]>(
    () => {
      const rows: ConsoleMenuGridItem[][] = [
        [
        {
          key: 'agents',
          screen: 'AgentList',
          source: 'grid_agents',
          emoji: '🤖',
          label: t('common:Agents'),
          value: data.agents ? String(data.agents) : '—',
        },
        {
          key: 'files',
          screen: 'FileList',
          source: 'grid_memory',
          emoji: '🧬',
          label: t('Memory'),
          value: data.files != null ? String(data.files) : '—',
        },
        {
          key: 'nodes',
          screen: 'Nodes',
          source: 'grid_nodes',
          emoji: '🌐',
          label: t('Nodes'),
          value: renderNodeGridValue(data.nodeCounts, colors.text),
          badge: data.pendingPairCount ? { text: t('{{count}} pending', { count: data.pendingPairCount }), color: colors.warning } : null,
        },
      ],
      [
        {
          key: 'models',
          screen: 'ModelList',
          source: 'grid_models',
          emoji: '🧩',
          label: t('Models'),
          value: data.models != null ? String(data.models) : '—',
        },
        {
          key: 'skills',
          screen: 'SkillList',
          source: 'grid_skills',
          emoji: '⚡',
          label: t('Skills'),
          value: data.skills != null ? String(data.skills) : '—',
        },
        {
          key: 'tools',
          screen: 'ToolList',
          source: 'grid_tools',
          emoji: '🧰',
          label: t('Available Tools'),
          value: data.tools != null ? String(data.tools) : '—',
        },
        ],
      ];
      return rows.map((row) => row.filter((item) => supportsScreen(item.screen)));
    },
    [
      colors.text,
      colors.warning,
      data.agents,
      data.files,
      data.models,
      data.nodeCounts,
      data.pendingPairCount,
      data.skills,
      data.tools,
      supportsScreen,
      t,
    ],
  );
  const listItems = useMemo<ConsoleMenuListItem[]>(
    () => {
      const items: ConsoleMenuListItem[] = [
      {
        key: 'agentSessionsBoard',
        screen: 'AgentSessionsBoard',
        source: 'list_agent_sessions_board',
        emoji: '🪟',
        title: t('Agent & Session Board'),
        description: t('A calmer overview for recent agent and session activity'),
      },
      {
        key: 'channels',
        screen: 'Channels',
        source: 'list_channels',
        emoji: '🔗',
        title: t('Channels'),
        description: t('Manage channel connections'),
      },
      {
        key: 'devices',
        screen: 'Devices',
        source: 'list_devices',
        emoji: '📱',
        title: t('Devices'),
        description: t('Manage paired devices'),
      },
      {
        key: 'logs',
        screen: 'Logs',
        source: 'list_logs',
        emoji: '🔍',
        title: t('Logs'),
        description: t('View gateway and agent logs'),
      },
      ...buildConsoleLibraryEntryDescriptors({
        backendKind,
        tConsole: t,
        tCommon,
      }),
      ];
      return items.filter((item) => supportsScreen(item.screen));
    },
    [backendKind, supportsScreen, t, tCommon],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerEmoji}>{getDisplayAgentEmoji(data.agentEmoji)}</Text>
        <View style={styles.headerInfo}>
          <View style={styles.headerNameRow}>
            <Text style={[styles.headerName, { color: colors.text }]}>{data.agentName}</Text>
            <View style={[styles.statusDot, { backgroundColor: connectionState === 'ready' ? colors.success : connectionState === 'pairing_pending' ? colors.warning : colors.warning }]} />
          </View>
          {snapshotStatusLabel ? (
            <Text style={[styles.headerMeta, { color: connectionState === 'ready' ? colors.textMuted : colors.warning }]}>
              {snapshotStatusLabel}
            </Text>
          ) : null}
        </View>
        <IconButton
          icon={(
            <Animated.View style={headerRefreshState.spinning ? refreshIconStyle : undefined}>
              <RefreshCw size={20} color={colors.textMuted} strokeWidth={2} />
            </Animated.View>
          )}
          onPress={handleHeaderRefresh}
          disabled={headerRefreshState.disabled}
        />
        <IconButton
          icon={<Share2 size={20} color={colors.textMuted} strokeWidth={2} />}
          onPress={() => setPosterVisible(true)}
        />
        <View style={styles.headerDate}>
          <Text style={[styles.headerDateDay, { color: colors.text }]}>{String(new Date().getDate())}</Text>
          <Text style={[styles.headerDateMonth, { color: colors.textMuted }]}>{monthLabel}</Text>
        </View>
      </View>

      <StatsPosterModal
        visible={posterVisible}
        onClose={() => setPosterVisible(false)}
        data={data}
        agentAvatarUri={posterAvatarUri}
      />

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        {statItems.map((item) => (
          <TouchableOpacity key={item.key} style={styles.statItem} onPress={() => nav(item.screen, item.source)} activeOpacity={0.6}>
            <Text style={styles.statEmoji}>{item.emoji}</Text>
            <Text
              style={[styles.statValue, { color: colors.text }, item.valueStyle]}
              numberOfLines={item.numberOfLines}
              adjustsFontSizeToFit={item.adjustsFontSizeToFit}
              minimumFontScale={item.minimumFontScale}
            >
              {item.value}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={handlePullToRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Hero Row: Cost + Nodes */}
        <View style={styles.heroRow}>
          {heroItems.map((item) => (
            <HeroCard
              key={item.key}
              label={item.label}
              value={item.value}
              onPress={() => nav(item.screen, item.source)}
              colors={colors}
              badge={item.badge}
            />
          ))}
        </View>

        {/* Grid: 3×2 */}
        {gridRows.map((row, index) => (
          <View key={index} style={styles.gridRow}>
            {row.map((item) => (
              <GridCard
                key={item.key}
                emoji={item.emoji}
                value={item.value}
                label={item.label}
                onPress={() => nav(item.screen, item.source)}
                colors={colors}
                badge={item.badge}
              />
            ))}
          </View>
        ))}

        {/* List items */}
        <View style={styles.listSection}>
          {listItems.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.listItem,
                { borderColor: colors.border },
                item.hideBorderBottom ? { borderBottomWidth: 0 } : null,
              ]}
              onPress={() => nav(item.screen, item.source)}
              activeOpacity={0.7}
            >
              <Text style={styles.listEmoji}>{item.emoji}</Text>
              <View style={styles.listText}>
                <Text style={[styles.listTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.listDesc, { color: colors.textMuted }]}>{item.description}</Text>
              </View>
              <ChevronRight size={16} color={colors.textSubtle} strokeWidth={2} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// Thin dispatcher: route to the backend-specific ConsoleMenu implementation.
// Backend branching lives in a single helper (`selectByBackend`) so we never
// spread `if (backend === 'hermes')` across screen files (see Backend
// Architecture Rule #3 in apps/mobile/CLAUDE.md). For OpenClaw configs this
// resolves to `OpenClawConsoleMenuScreen`, preserving the existing render
// path exactly.
export function ConsoleMenuScreen(): React.JSX.Element {
  const { config } = useAppContext();
  const Component = selectByBackend(config, {
    openclaw: OpenClawConsoleMenuScreen,
    hermes: HermesConsoleMenuScreen,
  });
  return <Component />;
}

// ---- Styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Space.lg,
    marginTop: Space.lg,
    marginBottom: Space.lg,
    marginRight: Space.lg,
  },
  headerEmoji: {
    fontSize: 36,
    marginRight: Space.md - 2,
  },
  headerInfo: {
    flex: 1,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerName: {
    fontSize: 22,
    fontWeight: FontWeight.bold,
  },
  headerMeta: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    marginTop: 2,
  },
  title: {
    fontSize: Space.xl,
    fontWeight: FontWeight.bold,
    marginLeft: Space.lg,
    marginTop: Space.lg,
    marginBottom: Space.md,
  },
  content: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxxl,
  },
  headerDate: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    marginLeft: Space.xs,
  },
  headerDateDay: {
    fontSize: 20,
    fontWeight: FontWeight.bold,
    lineHeight: 22,
  },
  headerDateMonth: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.5,
  },
  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    marginBottom: Space.lg,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  statValue: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
  statValueCompact: {
    fontSize: FontSize.md,
  },
  statLabel: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  // Hero cards
  heroRow: {
    flexDirection: 'row',
    gap: Space.sm + 2,
    marginBottom: Space.sm + 2,
  },
  heroCard: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
    paddingVertical: Space.lg + 4,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroValue: {
    fontSize: 28,
    fontWeight: FontWeight.bold,
    marginBottom: 4,
  },
  heroIcon: {
    fontSize: 26,
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  heroLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  heroBadge: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  // Grid cards
  gridRow: {
    flexDirection: 'row',
    gap: Space.sm + 2,
    marginBottom: Space.sm + 2,
  },
  gridCard: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.md,
    minHeight: 90,
  },
  gridTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Space.xs,
  },
  gridEmoji: {
    fontSize: 20,
  },
  gridBadge: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  gridValue: {
    fontSize: 22,
    fontWeight: FontWeight.bold,
    marginBottom: 2,
  },
  gridValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  nodeDeviceIcon: {
    fontSize: 16,
  },
  nodeDeviceSpacer: {
    width: 4,
  },
  gridLabel: {
    fontSize: FontSize.xs + 1,
    fontWeight: FontWeight.medium,
  },
  // List items
  listSection: {},
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listEmoji: {
    fontSize: 20,
    width: 32,
    textAlign: 'center',
  },
  listText: {
    flex: 1,
    marginLeft: Space.sm,
  },
  listTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  listDesc: {
    fontSize: FontSize.sm,
    marginTop: 2,
  },
});
