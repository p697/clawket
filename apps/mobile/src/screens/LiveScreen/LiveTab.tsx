import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CommonActions, useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useConnectionState } from '../../hooks/useConnectionState';
import { analyticsEvents } from '../../services/analytics/events';
import { selectByBackend } from '../../services/gateway-backends';
import {
  buildLiveDashboard,
  isLiveSessionInScope,
  type LiveAttentionItem,
  type LiveDailyReport,
  type LiveMember,
  type LiveOutcome,
  type LiveToolActivity,
  type LiveUsage,
} from '../../services/live-dashboard';
import { StorageService } from '../../services/storage';
import { useAppTheme } from '../../theme';
import type { SessionInfo, UsageSessionEntry } from '../../types';
import type { ConsoleStackParamList } from '../ConsoleScreen/sharedNavigator';
import { LiveOverview } from './LiveOverview';

const SESSION_POLL_INTERVAL_MS = 2_500;
const SUMMARY_POLL_INTERVAL_MS = 10_000;

function getTodayDateString(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
  });
}

export function LiveTab(): React.JSX.Element {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const connectionState = useConnectionState();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const {
    gateway,
    requestChatSession,
    mainSessionKey,
    currentAgentId,
    agents,
    foregroundEpoch,
    gatewayEpoch,
  } = useAppContext();
  const lastForegroundEpochRef = useRef(foregroundEpoch);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionKeys, setActiveSessionKeys] = useState<Set<string>>(() => new Set());
  const [toolActivityBySession, setToolActivityBySession] = useState<Record<string, LiveToolActivity>>({});
  const [outcomesBySession, setOutcomesBySession] = useState<Record<string, LiveOutcome>>({});
  const [usage, setUsage] = useState<LiveUsage>({
    todayCost: null,
    todayTokens: null,
    toolCalls: null,
  });
  const [dailyReport, setDailyReport] = useState<LiveDailyReport | null>(null);
  const [cronFailureCount, setCronFailureCount] = useState(0);
  const [pendingPairCount, setPendingPairCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentAgentName = currentAgent?.identity?.name?.trim()
    || currentAgent?.name?.trim()
    || null;
  const snapshot = useMemo(() => buildLiveDashboard({
    backendKind: gateway.getBackendKind(),
    currentAgentId,
    currentAgentName,
    mainSessionKey,
    sessions,
    activeSessionKeys,
    toolActivityBySession,
    outcomesBySession,
    dailyReport,
    usage,
    cronFailureCount,
    pendingPairCount,
  }), [
    activeSessionKeys,
    cronFailureCount,
    currentAgentId,
    currentAgentName,
    dailyReport,
    gateway,
    mainSessionKey,
    outcomesBySession,
    pendingPairCount,
    sessions,
    toolActivityBySession,
    usage,
  ]);

  useEffect(() => {
    setSessions([]);
    setActiveSessionKeys(new Set());
    setToolActivityBySession({});
    setOutcomesBySession({});
    setUsage({ todayCost: null, todayTokens: null, toolCalls: null });
    setDailyReport(null);
    setCronFailureCount(0);
    setPendingPairCount(0);
    setLoading(true);
  }, [currentAgentId, gatewayEpoch]);

  const fetchSessions = useCallback(async () => {
    const allSessions = await gateway.listSessions({ limit: 200 });
    setSessions(allSessions.filter((session) => (
      isLiveSessionInScope(gateway.getBackendKind(), currentAgentId, session)
    )));
    setLoading(false);
  }, [currentAgentId, gateway]);

  const fetchCost = useCallback(async () => {
    if (!gateway.getBackendCapabilities().consoleCost) return;
    const today = getTodayDateString();
    const result = await gateway.fetchCostSummary({ startDate: today, endDate: today });
    if (!result.totals) return;
    setUsage((current) => ({
      ...current,
      todayCost: result.totals?.totalCost ?? null,
      todayTokens: result.totals?.totalTokens ?? null,
    }));
  }, [gateway]);

  const fetchDailyReport = useCallback(async () => {
    if (!gateway.getBackendCapabilities().consoleUsage) return;
    const today = getTodayDateString();
    const result = await gateway.fetchUsage({ startDate: today, endDate: today });
    const usageSessions: UsageSessionEntry[] = (result.sessions ?? []).filter((session) => (
      selectByBackend<boolean>(gateway.getBackendKind(), {
        openclaw: session.key.startsWith(`agent:${currentAgentId}:`),
        hermes: true,
        youmind: false,
      })
    ));
    const report: LiveDailyReport = {
      mainMessages: 0,
      dmMessages: 0,
      subagentMessages: 0,
      cronMessages: 0,
      channelMessages: {},
    };

    for (const session of usageSessions) {
      const messageCount = session.usage?.messageCounts?.total ?? 0;
      if (session.key === mainSessionKey || /^agent:[^:]+:main$/.test(session.key)) {
        report.mainMessages += messageCount;
      } else if (session.key.includes(':subagent:') || session.key.includes(':sub:')) {
        report.subagentMessages += messageCount;
      } else if (session.key.includes(':cron:')) {
        report.cronMessages += messageCount;
      } else if (session.channel) {
        report.channelMessages[session.channel] = (report.channelMessages[session.channel] ?? 0) + messageCount;
      } else {
        report.dmMessages += messageCount;
      }
    }

    const toolCalls = result.aggregates?.tools.totalCalls
      ?? usageSessions.reduce(
        (sum, session) => sum + (session.usage?.messageCounts?.toolCalls ?? 0),
        0,
      );
    setDailyReport(report);
    setUsage((current) => ({
      ...current,
      toolCalls,
      todayCost: current.todayCost ?? result.totals?.totalCost ?? null,
      todayTokens: current.todayTokens ?? result.totals?.totalTokens ?? null,
    }));
  }, [currentAgentId, gateway, mainSessionKey]);

  const fetchAttention = useCallback(async () => {
    const capabilities = gateway.getBackendCapabilities();
    const cronPromise = capabilities.consoleCron
      ? Promise.all([gateway.listCronJobs(), StorageService.getAckedCronFailures()])
        .then(([result, acknowledgedIds]) => {
          setCronFailureCount((result.jobs ?? []).filter(
            (job) => job.state?.lastRunStatus === 'error' && !acknowledgedIds.has(job.id),
          ).length);
        })
      : Promise.resolve(setCronFailureCount(0));
    const pairPromise = capabilities.consoleNodes
      ? Promise.all([gateway.listNodePairRequests(), gateway.listDevices()])
        .then(([nodeResult, deviceResult]) => {
          setPendingPairCount(
            (nodeResult.pending?.length ?? 0) + (deviceResult.pending?.length ?? 0),
          );
        })
      : Promise.resolve(setPendingPairCount(0));
    await Promise.allSettled([cronPromise, pairPromise]);
  }, [gateway]);

  useEffect(() => {
    const resolveSessionKey = (sessionKey?: string) => sessionKey || mainSessionKey;
    const markActive = (sessionKey?: string) => {
      const key = resolveSessionKey(sessionKey);
      setActiveSessionKeys((current) => new Set(current).add(key));
      setOutcomesBySession((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
    const markOutcome = (sessionKey: string | undefined, status: LiveOutcome['status']) => {
      const key = resolveSessionKey(sessionKey);
      setActiveSessionKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setOutcomesBySession((current) => ({
        ...current,
        [key]: { status, updatedAt: Date.now() },
      }));
    };

    const offRunStart = gateway.on('chatRunStart', ({ sessionKey }) => markActive(sessionKey));
    const offDelta = gateway.on('chatDelta', ({ sessionKey }) => markActive(sessionKey));
    const offTool = gateway.on('chatTool', ({ sessionKey, name, status }) => {
      const key = resolveSessionKey(sessionKey);
      setToolActivityBySession((current) => ({
        ...current,
        [key]: { name, status, updatedAt: Date.now() },
      }));
      if (status === 'running') markActive(key);
    });
    const offFinal = gateway.on('chatFinal', ({ sessionKey }) => markOutcome(sessionKey, 'completed'));
    const offAborted = gateway.on('chatAborted', ({ sessionKey }) => markOutcome(sessionKey, 'aborted'));
    const offError = gateway.on('chatError', ({ sessionKey }) => markOutcome(sessionKey, 'error'));

    return () => {
      offRunStart();
      offDelta();
      offTool();
      offFinal();
      offAborted();
      offError();
    };
  }, [gateway, mainSessionKey]);

  useEffect(() => {
    if (!isFocused) return;
    let mounted = true;
    const refresh = () => {
      void fetchSessions().catch(() => {
        if (mounted) setLoading(false);
      });
    };
    refresh();
    const interval = setInterval(refresh, SESSION_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchSessions, isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    const refresh = () => {
      void Promise.allSettled([fetchCost(), fetchDailyReport(), fetchAttention()]);
    };
    refresh();
    const interval = setInterval(refresh, SUMMARY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAttention, fetchCost, fetchDailyReport, isFocused]);

  useEffect(() => {
    if (!isFocused || lastForegroundEpochRef.current === foregroundEpoch) return;
    lastForegroundEpochRef.current = foregroundEpoch;
    void Promise.allSettled([fetchSessions(), fetchCost(), fetchDailyReport(), fetchAttention()]);
  }, [fetchAttention, fetchCost, fetchDailyReport, fetchSessions, foregroundEpoch, isFocused]);

  const openConsoleScreen = useCallback(
    <RouteName extends Exclude<keyof ConsoleStackParamList, 'ConsoleMenu'>>(
      screen: RouteName,
      params?: ConsoleStackParamList[RouteName],
    ) => {
      navigation.dispatch(CommonActions.navigate({ name: screen, params }));
    },
    [navigation],
  );

  const openSession = useCallback((member: LiveMember) => {
    analyticsEvents.liveSessionOpened({
      role: member.role,
      status: member.status,
      source: 'team_activity',
    });
    requestChatSession(member.sessionKey, member.role);
    navigation.dispatch(CommonActions.navigate({ name: 'Chat' }));
  }, [navigation, requestChatSession]);

  const openAttention = useCallback((item: LiveAttentionItem) => {
    analyticsEvents.liveAttentionOpened({ kind: item.kind, count: item.count });
    if (item.kind === 'cron_failures') {
      openConsoleScreen('CronList');
      return;
    }
    if (item.kind === 'pair_requests') {
      openConsoleScreen('Nodes');
      return;
    }
    const member = snapshot.members.find((candidate) => candidate.sessionKey === item.sessionKey);
    analyticsEvents.liveSessionOpened({
      role: member?.role ?? 'session',
      status: 'error',
      source: 'attention',
    });
    requestChatSession(item.sessionKey, member?.role ?? 'session');
    navigation.dispatch(CommonActions.navigate({ name: 'Chat' }));
  }, [navigation, openConsoleScreen, requestChatSession, snapshot.members]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([fetchSessions(), fetchCost(), fetchDailyReport(), fetchAttention()]);
    setRefreshing(false);
    setLoading(false);
  }, [fetchAttention, fetchCost, fetchDailyReport, fetchSessions]);

  return (
    <View style={styles.container}>
      <LiveOverview
        snapshot={snapshot}
        connectionState={connectionState}
        topInset={insets.top}
        loading={loading}
        refreshing={refreshing}
        onRefresh={() => { void refresh(); }}
        onOpenSession={openSession}
        onOpenAttention={openAttention}
        onOpenConnection={() => navigation.dispatch(CommonActions.navigate({ name: 'My' }))}
      />
    </View>
  );
}
