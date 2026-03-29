import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { CommonActions, useIsFocused, useNavigation } from '@react-navigation/native';
import type { WebViewMessageEvent } from 'react-native-webview/lib/WebViewTypes';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { StorageService } from '../../services/storage';
import { useAppTheme } from '../../theme';
import type { ConsoleStackParamList } from '../ConsoleScreen/sharedNavigator';
import type {
  ChannelsStatusResult,
  OfficeChannelId,
  OfficeChannelSlotConfig,
  OfficeCharacterId,
  SessionInfo,
  UsageSessionEntry,
} from '../../types';
import {
  DEFAULT_OFFICE_CHANNEL_SLOT_CONFIG,
  isOfficeChannelSlotId,
  normalizeOfficeChannelId,
  OFFICE_CHANNEL_SLOT_IDS,
} from '../../types';

const POLL_INTERVAL_MS = 2_500;
const CHANNEL_STATUS_POLL_MS = 10_000;
const OFFICE_CHARACTER_IDS: ReadonlySet<string> = new Set<string>([
  'boss', 'assistant', 'subagent', 'cron', 'channel1', 'channel2', 'channel3', 'channel4',
]);

const OFFICE_CHANNEL_KEY_ALIASES: Record<OfficeChannelId, string[]> = {
  telegram: ['telegram'],
  discord: ['discord'],
  slack: ['slack'],
  feishu: ['feishu', 'lark'],
  whatsapp: ['whatsapp'],
  googlechat: ['googlechat', 'google-chat', 'google_chat', 'gchat'],
  signal: ['signal'],
  imessage: ['imessage', 'i_message'],
  webchat: ['webchat', 'web_chat'],
};

function isOfficeCharacterId(value: string): value is OfficeCharacterId {
  return OFFICE_CHARACTER_IDS.has(value);
}

function isSessionForOfficeChannel(session: SessionInfo, channelId: OfficeChannelId): boolean {
  const normalizedChannel = normalizeOfficeChannelId(session.channel);
  if (normalizedChannel === channelId) return true;
  return OFFICE_CHANNEL_KEY_ALIASES[channelId].some((alias) => session.key.includes(`:${alias}:`));
}

function resolveSlotConnectionStatus(
  channelId: OfficeChannelId,
  result: ChannelsStatusResult,
): 'connected' | 'configured' | 'none' {
  const summary = result.channels[channelId];
  const accounts = result.channelAccounts[channelId] ?? [];
  const anyConnected = summary?.connected === true || accounts.some((a) => a.connected === true);
  const anyRunning = summary?.running === true || accounts.some((a) => a.running === true);
  if (anyConnected || anyRunning) return 'connected';
  const anyConfigured = summary?.configured === true || accounts.some((a) => a.configured === true);
  const anyLinked = summary?.linked === true || accounts.some((a) => a.linked === true);
  if (anyConfigured || anyLinked) return 'configured';
  return 'none';
}

function sortByUpdatedAtDesc(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDefaultSessionKey(
  roleId: OfficeCharacterId,
  sessions: SessionInfo[],
  mainSessionKey: string,
  channelSlots: OfficeChannelSlotConfig,
): string | null {
  switch (roleId) {
    case 'boss':
    case 'assistant': {
      const main = sessions.find((s) => s.key === mainSessionKey);
      return main?.key ?? mainSessionKey;
    }
    case 'subagent': {
      const subs = sortByUpdatedAtDesc(
        sessions.filter((s) => s.key.includes(':subagent:') || s.key.includes(':sub:')),
      );
      return subs[0]?.key ?? null;
    }
    case 'cron': {
      const crons = sortByUpdatedAtDesc(sessions.filter((s) => s.key.includes(':cron:')));
      return crons[0]?.key ?? null;
    }
    case 'channel1':
    case 'channel2':
    case 'channel3':
    case 'channel4': {
      const channelId = channelSlots[roleId];
      const ch = sortByUpdatedAtDesc(
        sessions.filter((s) => isSessionForOfficeChannel(s, channelId)),
      );
      return ch[0]?.key ?? null;
    }
  }
}

function getSidebarPresetForRole(
  roleId: OfficeCharacterId,
  channelSlots: OfficeChannelSlotConfig,
): { tab: 'sessions' | 'subagents' | 'cron'; channel?: string } | null {
  switch (roleId) {
    case 'subagent':
      return { tab: 'subagents' };
    case 'cron':
      return { tab: 'cron' };
    case 'channel1':
    case 'channel2':
    case 'channel3':
    case 'channel4':
      return { tab: 'sessions', channel: channelSlots[roleId] };
    default:
      return null;
  }
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
  });
}

export function OfficeTab(): React.JSX.Element {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const {
    gateway, config, debugMode, requestOfficeChat, requestChatSidebar, mainSessionKey, currentAgentId, agents,
    officeWebViewRef, officeMessageHandlerRef, officeLoadEndHandlerRef, officeDebugAppendRef,
    foregroundEpoch,
  } = useAppContext();
  const latestSessionsRef = useRef<SessionInfo[]>([]);
  const lastForegroundEpochRef = useRef<number>(foregroundEpoch);
  const mainTypingRef = useRef(false);
  const [channelSlots, setChannelSlots] = useState<OfficeChannelSlotConfig>(DEFAULT_OFFICE_CHANNEL_SLOT_CONFIG);
  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const currentAgentName = currentAgent?.identity?.name?.trim() || currentAgent?.name?.trim() || null;

  useEffect(() => {
    let mounted = true;
    StorageService.getOfficeChannelSlots()
      .then((saved) => {
        if (!mounted) return;
        setChannelSlots(saved);
      })
      .catch(() => {
        if (!mounted) return;
        setChannelSlots(DEFAULT_OFFICE_CHANNEL_SLOT_CONFIG);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const appendDebug = useCallback((msg: string) => {
    officeDebugAppendRef.current?.(msg);
  }, [officeDebugAppendRef]);

  const openAddConnectionModal = useCallback(() => {
    const requestedAt = Date.now();
    navigation.dispatch(
      CommonActions.navigate({
        name: 'My',
        params: {
          state: {
            routes: [
              {
                name: 'ConfigHome',
                params: {
                  addConnectionRequestAt: requestedAt,
                  addConnectionTab: 'quick',
                },
              },
            ],
          },
        },
      }),
    );
  }, [navigation]);

  const sendSessions = useCallback((sessions: SessionInfo[]) => {
    const now = Date.now();
    const mapped = sessions.map((s) => ({
      key: s.key,
      kind: s.kind,
      channel: s.channel,
      active: true,
      label: s.label ?? s.displayName ?? s.title,
      updatedAt: s.updatedAt ?? null,
      lastMessage: s.lastMessagePreview,
      model: s.model,
    }));
    const message = JSON.stringify({ type: 'SESSION_UPDATE', sessions: mapped });
    officeWebViewRef.current?.postMessage(message);

    if (debugMode) {
      const summary = mapped.map((s) => {
        const age = s.updatedAt ? Math.round((now - s.updatedAt) / 1000) : '?';
        const shortKey = s.key.replace(/^agent:main:/, '');
        return `${shortKey}(${age}s)`;
      });
      appendDebug(`📡 ${mapped.length} sessions: ${summary.join(', ')}`);
    }
  }, [appendDebug, debugMode, officeWebViewRef]);

  const sendTypingState = useCallback((isTyping: boolean) => {
    if (mainTypingRef.current === isTyping) return;
    mainTypingRef.current = isTyping;
    const message = JSON.stringify({ type: 'TYPING_STATE', isTyping });
    officeWebViewRef.current?.postMessage(message);
    if (debugMode) appendDebug(`${isTyping ? '⌨️' : '💤'} main typing: ${isTyping}`);
  }, [appendDebug, debugMode]);

  const sendOfficeChannelConfig = useCallback(() => {
    const message = JSON.stringify({
      type: 'OFFICE_CHANNEL_CONFIG',
      slots: channelSlots,
    });
    officeWebViewRef.current?.postMessage(message);
  }, [channelSlots]);

  const sendGatewayState = useCallback(() => {
    const state = config?.url ? 'configured' : 'none';
    const msg = JSON.stringify({ type: 'GATEWAY_STATE', state });
    officeWebViewRef.current?.postMessage(msg);
  }, [config?.url, officeWebViewRef]);

  const fetchAndSendUsage = useCallback(async () => {
    const today = getTodayDateStr();
    const costData = await gateway.fetchCostSummary({ startDate: today, endDate: today });
    if (!costData.totals) return;
    // If usage is available, gateway is effectively configured for Office whiteboard purposes.
    sendGatewayState();
    officeWebViewRef.current?.postMessage(JSON.stringify({
      type: 'USAGE_UPDATE',
      todayCost: costData.totals.totalCost ?? 0,
      todayTokens: costData.totals.totalTokens ?? 0,
    }));
  }, [gateway, officeWebViewRef, sendGatewayState]);

  const fetchAndSendDailyReport = useCallback(async () => {
    const today = getTodayDateStr();
    const agentPrefix = `agent:${currentAgentId}:`;
    const usageResult = await gateway.fetchUsage({ startDate: today, endDate: today });
    const sessions: UsageSessionEntry[] = (usageResult.sessions ?? []).filter(
      (s) => s.key.startsWith(agentPrefix),
    );

    let mainMessages = 0;
    let mainUserMessages = 0;
    let dmMessages = 0;
    let dmUserMessages = 0;
    let subagentMessages = 0;
    let cronMessages = 0;
    const channelMessages: Record<string, number> = {};

    for (const s of sessions) {
      const msgTotal = s.usage?.messageCounts?.total ?? 0;
      const msgUser = s.usage?.messageCounts?.user ?? 0;
      if (/^agent:[^:]+:main$/.test(s.key)) {
        mainMessages += msgTotal;
        mainUserMessages += msgUser;
      } else if (s.key.includes(':subagent:') || s.key.includes(':sub:')) {
        subagentMessages += msgTotal;
      } else if (s.key.includes(':cron:')) {
        cronMessages += msgTotal;
      } else {
        // Check if this is a DM session (from dmScope routing)
        // DM sessions are kind=direct but NOT matched to a channel worker slot
        let matchedSlot = false;
        for (const slotId of OFFICE_CHANNEL_SLOT_IDS) {
          const chId = channelSlots[slotId];
          const normalized = normalizeOfficeChannelId(s.channel);
          const matched = normalized === chId
            || OFFICE_CHANNEL_KEY_ALIASES[chId].some((alias) => s.key.includes(`:${alias}:`));
          if (matched) {
            channelMessages[slotId] = (channelMessages[slotId] ?? 0) + msgTotal;
            matchedSlot = true;
            break;
          }
        }
        // Unmatched sessions with kind=direct count as DM (secretary scope)
        if (!matchedSlot) {
          dmMessages += msgTotal;
          dmUserMessages += msgUser;
        }
      }
    }

    officeWebViewRef.current?.postMessage(JSON.stringify({
      type: 'DAILY_REPORT_DATA',
      data: { mainMessages, mainUserMessages, dmMessages, dmUserMessages, subagentMessages, cronMessages, channelMessages },
    }));
  }, [channelSlots, currentAgentId, gateway, officeWebViewRef]);

  // Send agent name to office WebView
  useEffect(() => {
    if (currentAgentName) {
      officeWebViewRef.current?.postMessage(
        JSON.stringify({ type: 'AGENT_NAME', name: currentAgentName }),
      );
    }
  }, [currentAgentName, officeWebViewRef]);

  useEffect(() => {
    sendOfficeChannelConfig();
  }, [sendOfficeChannelConfig]);

  // Send gateway connection state to office WebView
  useEffect(() => {
    sendGatewayState();
  }, [sendGatewayState]);

  // Re-send gateway state whenever Office regains focus to avoid stale WebView bridge state.
  useEffect(() => {
    if (!isFocused) return;
    sendGatewayState();
  }, [isFocused, sendGatewayState]);

  // Track main session typing state via gateway events
  useEffect(() => {
    const offRunStart = gateway.on('chatRunStart', ({ sessionKey }: { sessionKey?: string }) => {
      if (!sessionKey || sessionKey === mainSessionKey) sendTypingState(true);
    });
    const offDelta = gateway.on('chatDelta', ({ sessionKey }: { sessionKey?: string }) => {
      if (!sessionKey || sessionKey === mainSessionKey) sendTypingState(true);
    });
    const offFinal = gateway.on('chatFinal', ({ sessionKey }: { sessionKey?: string }) => {
      if (!sessionKey || sessionKey === mainSessionKey) sendTypingState(false);
    });
    const offAborted = gateway.on('chatAborted', ({ sessionKey }: { sessionKey?: string }) => {
      if (!sessionKey || sessionKey === mainSessionKey) sendTypingState(false);
    });
    const offError = gateway.on('chatError', ({ sessionKey }: { sessionKey?: string }) => {
      if (!sessionKey || sessionKey === mainSessionKey) sendTypingState(false);
    });

    return () => { offRunStart(); offDelta(); offFinal(); offAborted(); offError(); };
  }, [gateway, mainSessionKey, sendTypingState]);

  useEffect(() => {
    if (!isFocused) return;

    let mounted = true;
    const agentPrefix = `agent:${currentAgentId}:`;

    const fetchAndSend = async () => {
      try {
        const allSessions = await gateway.listSessions({ limit: 200 });
        if (mounted) {
          const agentSessions = allSessions.filter((s) => s.key.startsWith(agentPrefix));
          latestSessionsRef.current = agentSessions;
          sendSessions(agentSessions);
        }
      } catch (err) {
        if (debugMode) appendDebug(`❌ listSessions error: ${String(err)}`);
      }
    };

    void fetchAndSend();
    const interval = setInterval(fetchAndSend, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [appendDebug, currentAgentId, debugMode, gateway, isFocused, sendSessions]);

  useEffect(() => {
    if (!isFocused) return;
    if (lastForegroundEpochRef.current === foregroundEpoch) return;
    lastForegroundEpochRef.current = foregroundEpoch;
    const agentPrefix = `agent:${currentAgentId}:`;
    gateway.listSessions({ limit: 200 })
      .then((allSessions) => {
        const agentSessions = allSessions.filter((s) => s.key.startsWith(agentPrefix));
        latestSessionsRef.current = agentSessions;
        sendSessions(agentSessions);
      })
      .catch((err) => {
        if (debugMode) appendDebug(`❌ foreground listSessions error: ${String(err)}`);
      });
  }, [appendDebug, currentAgentId, debugMode, foregroundEpoch, gateway, isFocused, sendSessions]);

  // Fetch today's usage cost/tokens for whiteboard display (separate effect)
  useEffect(() => {
    if (!isFocused) return;

    const fetchUsage = async () => {
      try {
        await fetchAndSendUsage();
      } catch {
        // Best-effort; don't block office rendering.
      }
    };

    void fetchUsage();
    const interval = setInterval(fetchUsage, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [fetchAndSendUsage, isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    if (lastForegroundEpochRef.current !== foregroundEpoch) return;
    fetchAndSendUsage()
      .catch(() => {});
  }, [fetchAndSendUsage, foregroundEpoch, isFocused]);

  // Fetch daily report data (usage per-session message counts) for KPI reports
  useEffect(() => {
    if (!isFocused) return;

    const fetch = async () => {
      try {
        await fetchAndSendDailyReport();
      } catch {
        // Best-effort; don't block office rendering.
      }
    };

    void fetch();
    const interval = setInterval(fetch, CHANNEL_STATUS_POLL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [fetchAndSendDailyReport, isFocused]);

  // Poll memory file count and forward to office WebView for filing cabinet sprite
  useEffect(() => {
    if (!isFocused) return;
    let mounted = true;

    const fetchFileCount = async () => {
      try {
        const files = await gateway.listAgentFiles(currentAgentId);
        if (!mounted) return;
        const msg = JSON.stringify({ type: 'MEMORY_FILE_COUNT', count: files.length });
        officeWebViewRef.current?.postMessage(msg);
      } catch {
        // Best-effort; don't block office rendering.
      }
    };

    void fetchFileCount();
    const interval = setInterval(fetchFileCount, CHANNEL_STATUS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [currentAgentId, gateway, isFocused, officeWebViewRef]);

  // Poll pending pair request count and forward to office WebView for mailbox sprite
  useEffect(() => {
    if (!isFocused) return;
    let mounted = true;

    const fetchPairCount = async () => {
      try {
        const [nodeResult, deviceResult] = await Promise.all([
          gateway.listNodePairRequests(),
          gateway.listDevices(),
        ]);
        if (!mounted) return;
        const count = (nodeResult.pending?.length ?? 0) + (deviceResult.pending?.length ?? 0);
        const msg = JSON.stringify({ type: 'PENDING_PAIR_COUNT', count });
        officeWebViewRef.current?.postMessage(msg);
      } catch {
        // Best-effort; don't block office rendering.
      }
    };

    void fetchPairCount();
    const interval = setInterval(fetchPairCount, CHANNEL_STATUS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [gateway, isFocused, officeWebViewRef]);

  // Poll channel connection statuses and forward to office WebView
  useEffect(() => {
    if (!isFocused) return;
    let mounted = true;

    const slotIds = OFFICE_CHANNEL_SLOT_IDS;

    const fetchChannelStatus = async () => {
      try {
        const result = await gateway.getChannelsStatus({ probe: false });
        if (!mounted) return;
        const statuses: Record<string, string> = {};
        for (const slotId of slotIds) {
          const channelId = channelSlots[slotId];
          statuses[slotId] = resolveSlotConnectionStatus(channelId, result);
        }
        const msg = JSON.stringify({ type: 'CHANNEL_STATUS_UPDATE', statuses });
        officeWebViewRef.current?.postMessage(msg);
      } catch {
        // Best-effort; don't block office rendering.
      }
    };

    void fetchChannelStatus();
    const interval = setInterval(fetchChannelStatus, CHANNEL_STATUS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [channelSlots, gateway, isFocused, officeWebViewRef]);

  // Poll cron failure count and forward to office WebView for calendar badge
  useEffect(() => {
    if (!isFocused) return;
    let mounted = true;

    const fetchCronFailures = async () => {
      try {
        const [result, ackedIds] = await Promise.all([
          gateway.listCronJobs(),
          StorageService.getAckedCronFailures(),
        ]);
        if (!mounted) return;
        const jobs = result.jobs ?? [];
        const unacked = jobs.filter((j: any) => j.state?.lastRunStatus === 'error' && !ackedIds.has(j.id)).length;
        officeWebViewRef.current?.postMessage(
          JSON.stringify({ type: 'CRON_FAILURE_COUNT', count: unacked }),
        );
      } catch {
        // Best-effort; don't block office rendering.
      }
    };

    void fetchCronFailures();
    const interval = setInterval(fetchCronFailures, CHANNEL_STATUS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [currentAgentId, gateway, isFocused, officeWebViewRef]);

  const openConsoleModal = useCallback(
    <RouteName extends Exclude<keyof ConsoleStackParamList, 'ConsoleMenu'>>(
      screen: RouteName,
      params?: ConsoleStackParamList[RouteName],
    ) => {
      const rootNavigation = navigation.getParent();
      if (rootNavigation) {
        rootNavigation.dispatch(
          CommonActions.navigate({
            name: screen,
            params,
          }),
        );
        return;
      }

      navigation.navigate('Console' as never);
    },
    [navigation],
  );

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'OFFICE_DEBUG') {
        if (debugMode) appendDebug(`🎮 ${data.message}`);
        return;
      }
      if (data.type === 'HAPTIC') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }
      if (data.type === 'MENU_ACTION' && typeof data.characterId === 'string' && isOfficeCharacterId(data.characterId)) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const roleId = data.characterId as OfficeCharacterId;
        if (data.action === 'chat') {
          const sessionKey = getDefaultSessionKey(roleId, latestSessionsRef.current, mainSessionKey, channelSlots) ?? mainSessionKey;
          analyticsEvents.officeOpenChatFromCharacter({
            action: 'chat',
            character_id: roleId,
            has_session_key: Boolean(sessionKey),
          });
          requestOfficeChat(sessionKey, roleId);
          navigation.navigate('Chat' as never);
        } else if (data.action === 'open_session' && typeof data.sessionKey === 'string') {
          analyticsEvents.officeOpenChatFromCharacter({
            action: 'open_session',
            character_id: roleId,
            has_session_key: true,
          });
          requestOfficeChat(data.sessionKey, roleId);
          navigation.navigate('Chat' as never);
        } else if (data.action === 'sessions') {
          const preset = getSidebarPresetForRole(roleId, channelSlots);
          analyticsEvents.officeOpenChatFromCharacter({
            action: 'sessions',
            character_id: roleId,
            has_session_key: false,
          });
          requestChatSidebar({
            tab: preset?.tab ?? 'sessions',
            channel: preset?.channel,
            openDrawer: true,
          });
        } else if (data.action === 'set_channel' && isOfficeChannelSlotId(roleId) && typeof data.channelId === 'string') {
          const nextChannel = normalizeOfficeChannelId(data.channelId);
          if (!nextChannel) return;
          const occupied = Object.entries(channelSlots).some(([slotId, channelId]) => (
            slotId !== roleId && channelId === nextChannel
          ));
          if (occupied) return;
          const nextSlots: OfficeChannelSlotConfig = {
            ...channelSlots,
            [roleId]: nextChannel,
          };
          setChannelSlots(nextSlots);
          void StorageService.setOfficeChannelSlots(nextSlots);
        } else if (data.action === 'console') {
          navigation.navigate('Console' as never);
        } else if (data.action === 'models') {
          openConsoleModal('ModelList');
        } else if (data.action === 'connections') {
          openConsoleModal('Channels');
        } else if (data.action === 'memory') {
          openConsoleModal('FileList');
        } else if (data.action === 'status') {
          openConsoleModal('Usage');
        } else if (data.action === 'management') {
          openConsoleModal('CronList');
        } else if (data.action === 'skills') {
          openConsoleModal('SkillList');
        } else if (data.action === 'logs') {
          openConsoleModal('Logs');
        } else if (data.action === 'tools') {
          openConsoleModal('ToolList');
        } else if (data.action === 'node_devices') {
          openConsoleModal('Nodes');
        } else if (data.action === 'add_gateway') {
          openAddConnectionModal();
        } else if (data.action === 'new_cron') {
          openConsoleModal('CronWizard');
        }
      }
    } catch {
      // Ignore invalid messages from WebView.
    }
  }, [appendDebug, channelSlots, debugMode, mainSessionKey, navigation, openAddConnectionModal, openConsoleModal, requestChatSidebar, requestOfficeChat]);

  const handleLoadEnd = useCallback(() => {
    if (currentAgentName) {
      officeWebViewRef.current?.postMessage(
        JSON.stringify({ type: 'AGENT_NAME', name: currentAgentName }),
      );
    }
    sendOfficeChannelConfig();
    // Re-send gateway state so whiteboard renders correctly after WebView load
    sendGatewayState();
    // Send usage immediately so whiteboard can leave placeholder without waiting for poll tick
    fetchAndSendUsage().catch(() => {});
    // Send daily report data so KPI is available immediately
    fetchAndSendDailyReport().catch(() => {});
    // Send memory file count so cabinet sprite is correct immediately
    gateway.listAgentFiles(currentAgentId)
      .then((files) => {
        officeWebViewRef.current?.postMessage(
          JSON.stringify({ type: 'MEMORY_FILE_COUNT', count: files.length }),
        );
      })
      .catch(() => {});
    // Send cron failure count so calendar badge is correct immediately
    Promise.all([gateway.listCronJobs(), StorageService.getAckedCronFailures()])
      .then(([result, ackedIds]) => {
        const jobs = result.jobs ?? [];
        const unacked = jobs.filter((j: any) => j.state?.lastRunStatus === 'error' && !ackedIds.has(j.id)).length;
        officeWebViewRef.current?.postMessage(
          JSON.stringify({ type: 'CRON_FAILURE_COUNT', count: unacked }),
        );
      })
      .catch(() => {});
    // Send pending pair count so mailbox sprite is correct immediately
    Promise.all([gateway.listNodePairRequests(), gateway.listDevices()])
      .then(([nodeResult, deviceResult]) => {
        const count = (nodeResult.pending?.length ?? 0) + (deviceResult.pending?.length ?? 0);
        officeWebViewRef.current?.postMessage(
          JSON.stringify({ type: 'PENDING_PAIR_COUNT', count }),
        );
      })
      .catch(() => {});
  }, [currentAgentId, currentAgentName, fetchAndSendDailyReport, fetchAndSendUsage, gateway, officeWebViewRef, sendGatewayState, sendOfficeChannelConfig]);

  // Register message handler on the shared ref so root WebView forwards events here
  useEffect(() => {
    officeMessageHandlerRef.current = handleMessage;
    return () => { officeMessageHandlerRef.current = null; };
  }, [handleMessage, officeMessageHandlerRef]);

  // Register loadEnd handler on the shared ref
  useEffect(() => {
    officeLoadEndHandlerRef.current = handleLoadEnd;
    return () => { officeLoadEndHandlerRef.current = null; };
  }, [handleLoadEnd, officeLoadEndHandlerRef]);

  return (
    <View style={styles.container} />
  );
}
