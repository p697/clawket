import 'react-native-get-random-values';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Linking,
  Platform,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import {
  createNavigationContainerRef,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
  NavigationState,
  Theme as NavigationTheme,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { AppContextProvider } from './src/contexts/AppContext';
import { GlobalLoadingOverlayProvider, useGlobalLoadingOverlay } from './src/contexts/GlobalLoadingOverlayContext';
import { GatewayScannerProvider } from './src/contexts/GatewayScannerContext';
import { NodeCameraCaptureProvider } from './src/contexts/NodeCameraCaptureContext';
import { ProPaywallProvider, useProPaywall } from './src/contexts/ProPaywallContext';
import { GlobalLoadingOverlay } from './src/components/ui';
import { ProPaywallOverlay } from './src/components/pro/ProPaywallOverlay';
import { loadAgentAvatars } from './src/services/agent-avatar';
import { GatewayClient } from './src/connection/protocol';
import {
  configureConnectionRuntimeGateway,
  getConnectionRuntime,
  useConnections,
} from './src/connection';
import {
  CAPABILITY_KEYS,
  resolveCapabilities,
  type AgentAdapter,
  type Capabilities,
} from '@clawket/agent-protocol';
import { NodeClient } from './src/services/node-client';
import { dispatchNodeInvoke } from './src/services/node-invoke-dispatcher';
import { NodeCapabilityToggles } from './src/services/node-capabilities';
import { shouldProbeGatewayOnForegroundResume } from './src/services/foregroundReconnectPolicy';
import { shouldRunGatewayKeepAlive } from './src/services/gatewayKeepAlivePolicy';
import { logAppTelemetry } from './src/services/app-telemetry';
import {
  extractChatNotificationOpenPayload,
  getChatNotificationResponseIdentifier,
  initializeChatNotifications,
  scheduleChatReplyNotification,
  shouldShowChatReplyNotification,
} from './src/services/chat-notifications';
import { StorageService } from './src/services/storage';
import { getGatewayBackendCapabilities, resolveGlobalMainSessionKey } from '@clawket/agent-protocol';
import { resolveGatewayCacheScopeId } from './src/services/gateway-cache-scope';
import { SessionPreferencesService } from './src/services/session-preferences';
import { analyticsEvents } from './src/services/analytics/events';
import { useDeepLinkHandler, type DeepLinkDeps } from './src/hooks/useDeepLinkHandler';
import { usePostHogIdentity } from './src/hooks/usePostHogIdentity';
import { usePostHogScreenTracking } from './src/hooks/usePostHogScreenTracking';
import { ChatAppearanceSettings, GatewayConfig, SpeechRecognitionLanguage } from './src/types';
import type { AgentInfo } from './src/types/agent';
import { buildTheme, builtInAccents, defaultAccentId, useAppTheme } from './src/theme';
import { AppProviders } from './src/bootstrap/AppProviders';
import { useAppBootstrap } from './src/bootstrap/useAppBootstrap';
import { getActiveLeafRouteName } from './src/utils/posthog-navigation';
import {
  extractAssistantDisplayText,
  isAssistantSilentReplyMessage,
  sanitizeSilentPreviewText,
} from './src/utils/chat-message';
import { resolveMainSessionKey } from './src/utils/agent-session-scope';
import { normalizeAccessibleAgentId } from './src/utils/pro';
import type {
  AccountSettingsSection,
  AgentSettingsSection,
  RootStackParamList,
} from './src/navigation/root-stack';
import { RosterScreen, type RosterDisplayRow } from './src/screens/Roster';
import { ThreadScreen } from './src/screens/Thread';
import {
  SessionPanel,
  type SessionPanelAction,
  type SessionPanelRow,
} from './src/screens/SessionPanel';
import {
  AgentSettingsScreen,
  AgentSettingsSectionScreen,
  type AgentSettingsSectionActionResolver,
} from './src/screens/AgentSettings';
import {
  AccountSettingsScreen,
  AccountSettingsSectionScreen,
  type AccountSettingsAction,
  type AccountSettingsSectionActionRequest,
} from './src/screens/AccountSettings';
import { SearchScreen, MessageDetailScreen } from './src/screens/Search';
import { OnboardingRoute } from './src/screens/Onboarding/OnboardingRoute';
import { publicAppLinks } from './src/config/public';
import { CLAWKET_GITHUB_REPO_URL } from './src/config/app-links';
import type { ProFeature } from './src/utils/pro';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const LOADING_THEME = buildTheme('light', 'light', builtInAccents[defaultAccentId]);
const NO_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((capability) => [capability, false]),
)) as unknown as Capabilities;

const ACCOUNT_ACTION_SECTION: Readonly<Partial<Record<
  AccountSettingsAction,
  AccountSettingsSection
>>> = Object.freeze({
  'theme': 'appearance',
  'accent': 'appearance',
  'chat-appearance': 'appearance',
  'app-icon': 'appearance',
  'speech-language': 'voice',
  'help-center': 'help',
  'openclaw-docs': 'help',
  'hermes-docs': 'help',
  'release-notes': 'help',
  'openclaw-releases': 'help',
  'feedback': 'help',
  'share': 'community',
  'rate': 'community',
  'discord': 'community',
  'wecom': 'community',
  'repository': 'about',
  'privacy': 'about',
  'terms': 'about',
  'preview-environment': 'developer',
  'design-system': 'developer',
  'clear-cache': 'developer',
  'reset-device': 'developer',
});
export default function App(): React.JSX.Element {
  const [gateway] = useState(() => new GatewayClient());
  const [connectionRuntime] = useState(() => configureConnectionRuntimeGateway(gateway));
  const connectionSnapshot = useConnections();
  const [nodeClient] = useState(() => new NodeClient());
  const {
    accentId,
    activeGatewayConfigId,
    chatFontSize,
    chatAppearance,
    config,
    customAccent,
    debugMode,
    execApprovalEnabled,
    initialAgentId,
    initialChatPreview,
    loading,
    nodeCapabilityToggles,
    nodeEnabled,
    setAccentId,
    setActiveGatewayConfigId,
    setChatFontSize,
    setChatAppearance,
    setConfig,
    setCustomAccent,
    setDebugMode,
    setExecApprovalEnabled,
    setNodeCapabilityToggles,
    setNodeEnabled,
    setShowAgentAvatar,
    setShowModelUsage,
    setSpeechRecognitionLanguage,
    setThemeMode,
    showAgentAvatar,
    showModelUsage,
    speechRecognitionLanguage,
    themeMode,
  } = useAppBootstrap({ nodeClient });

  useEffect(() => () => {
    void connectionRuntime.stop();
  }, [connectionRuntime]);

  if (loading) {
    return (
      <View style={[loadingStyles.loading, { backgroundColor: LOADING_THEME.colors.background }]}>
        <ActivityIndicator size="large" color={LOADING_THEME.colors.primary} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <AppProviders
      mode={themeMode}
      accentId={accentId}
      customAccent={customAccent}
      onModeChange={setThemeMode}
      onAccentChange={setAccentId}
    >
      <ProPaywallProvider>
        <AppContent
          gateway={gateway}
          activeAdapter={connectionSnapshot.activeAdapter}
          activeGatewayConfigId={activeGatewayConfigId}
          nodeClient={nodeClient}
          config={config}
          debugMode={debugMode}
          showAgentAvatar={showAgentAvatar}
          showModelUsage={showModelUsage}
          execApprovalEnabled={execApprovalEnabled}
          nodeEnabled={nodeEnabled}
          nodeCapabilityToggles={nodeCapabilityToggles}
          chatFontSize={chatFontSize}
          chatAppearance={chatAppearance}
          speechRecognitionLanguage={speechRecognitionLanguage}
          initialAgentId={initialAgentId}
          initialChatPreview={initialChatPreview}
          onDebugToggle={(enabled) => {
            setDebugMode(enabled);
            StorageService.setDebugMode(enabled);
          }}
          onShowAgentAvatarToggle={(show) => {
            setShowAgentAvatar(show);
            StorageService.setShowAgentAvatar(show);
          }}
          onShowModelUsageToggle={(enabled) => {
            setShowModelUsage(enabled);
            StorageService.setShowModelUsage(enabled);
          }}
          onExecApprovalToggle={(enabled) => {
            setExecApprovalEnabled(enabled);
            StorageService.setExecApprovalEnabled(enabled);
          }}
          onNodeEnabledToggle={(enabled) => {
            setNodeEnabled(enabled);
            StorageService.setNodeEnabled(enabled);
          }}
          onNodeCapabilityTogglesChange={(toggles) => {
            setNodeCapabilityToggles(toggles);
            StorageService.setNodeCapabilityToggles(toggles);
          }}
          onChatFontSizeChange={(size) => {
            setChatFontSize(size);
            StorageService.setChatFontSize(size);
          }}
          onChatAppearanceChange={(settings) => {
            setChatAppearance(settings);
            StorageService.setChatAppearance(settings);
          }}
          onSpeechRecognitionLanguageChange={(language) => {
            setSpeechRecognitionLanguage(language);
            StorageService.setSpeechRecognitionLanguage(language);
          }}
          onSaved={(next, nextGatewayScopeId) => {
            setConfig(next);
            setActiveGatewayConfigId(
              nextGatewayScopeId
              ?? resolveGatewayCacheScopeId({ config: next }),
            );
            void connectionRuntime.syncLegacyConnections();
          }}
          onReset={() => {
            setConfig(null);
            setActiveGatewayConfigId(null);
            void connectionRuntime.syncLegacyConnections();
          }}
        />
      </ProPaywallProvider>
    </AppProviders>
  );
}

const GATEWAY_KEEPALIVE_INTERVAL_MS = 5_000;

function resolveNodeInvokeSource(req: {
  source?: string;
  sessionKey?: string;
  requestedByDeviceId?: string;
  requestedByClientId?: string;
  requestedByConnId?: string;
}): string {
  if (req.source?.trim()) return req.source.trim();
  if (req.sessionKey?.trim()) return `session:${req.sessionKey.trim()}`;
  if (req.requestedByClientId?.trim()) return `client:${req.requestedByClientId.trim()}`;
  if (req.requestedByDeviceId?.trim()) return `device:${req.requestedByDeviceId.trim()}`;
  if (req.requestedByConnId?.trim()) return `conn:${req.requestedByConnId.trim()}`;
  return 'gateway';
}

function agentIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  if (!sessionKey) return null;
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match?.[1] ?? null;
}

function describeSessionKind(sessionKey: string | null | undefined): 'main' | 'subagent' | 'cron' | 'other' {
  if (!sessionKey) return 'other';
  if (/^agent:[^:]+:main$/.test(sessionKey)) return 'main';
  if (sessionKey.includes(':subagent:')) return 'subagent';
  if (sessionKey.includes(':cron:')) return 'cron';
  return 'other';
}

function resolveAgentNotificationName(sessionKey: string, agents: AgentInfo[], currentAgentId: string): string {
  const agentId = agentIdFromSessionKey(sessionKey) ?? currentAgentId;
  const agent = agents.find((item) => item.id === agentId);
  return agent?.identity?.name?.trim() || agent?.name?.trim() || 'Assistant';
}

type AppContentProps = {
  gateway: GatewayClient;
  activeAdapter: AgentAdapter | null;
  activeGatewayConfigId: string | null;
  nodeClient: NodeClient;
  config: GatewayConfig | null;
  debugMode: boolean;
  showAgentAvatar: boolean;
  showModelUsage: boolean;
  execApprovalEnabled: boolean;
  nodeEnabled: boolean;
  nodeCapabilityToggles: NodeCapabilityToggles;
  chatFontSize: number;
  chatAppearance: ChatAppearanceSettings;
  speechRecognitionLanguage: SpeechRecognitionLanguage;
  initialAgentId: string | null;
  initialChatPreview: import('./src/services/storage').LastOpenedSessionSnapshot | null;
  onDebugToggle: (enabled: boolean) => void;
  onShowAgentAvatarToggle: (show: boolean) => void;
  onShowModelUsageToggle: (enabled: boolean) => void;
  onExecApprovalToggle: (enabled: boolean) => void;
  onNodeEnabledToggle: (enabled: boolean) => void;
  onNodeCapabilityTogglesChange: (toggles: NodeCapabilityToggles) => void;
  onChatFontSizeChange: (size: number) => void;
  onChatAppearanceChange: (settings: ChatAppearanceSettings) => void;
  onSpeechRecognitionLanguageChange: (language: SpeechRecognitionLanguage) => void;
  onSaved: (next: GatewayConfig, nextGatewayScopeId?: string | null) => void;
  onReset: () => void;
};

function AppContent({
  gateway,
  activeAdapter,
  activeGatewayConfigId,
  nodeClient,
  config,
  debugMode,
  showAgentAvatar,
  showModelUsage,
  execApprovalEnabled,
  nodeEnabled,
  nodeCapabilityToggles,
  chatFontSize,
  chatAppearance,
  speechRecognitionLanguage,
  initialAgentId,
  initialChatPreview,
  onDebugToggle,
  onShowAgentAvatarToggle,
  onShowModelUsageToggle,
  onExecApprovalToggle,
  onNodeEnabledToggle,
  onNodeCapabilityTogglesChange,
  onChatFontSizeChange,
  onChatAppearanceChange,
  onSpeechRecognitionLanguageChange,
  onSaved,
  onReset,
}: AppContentProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const {
    isPro,
    restorePurchases,
    showPaywall,
  } = useProPaywall();
  const connections = useConnections();
  const rootNavigationRef = useMemo(() => createNavigationContainerRef<RootStackParamList>(), []);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentAvatars, setAgentAvatars] = useState<Record<string, string>>({});
  const [currentAgentId, setCurrentAgentIdState] = useState<string>(initialAgentId ?? 'main');
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<string | null>(null);
  const [gatewayEpoch, setGatewayEpoch] = useState(0);
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const activeRouteRef = useRef<keyof RootStackParamList>('Roster');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);
  const gatewayKeepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved agent avatars on mount
  useEffect(() => { loadAgentAvatars().then(setAgentAvatars).catch(() => {}); }, []);
  const [chatSessionRequest, setChatSessionRequest] = useState<{
    sessionKey: string;
    requestedAt: number;
    sourceRole?: string;
  } | null>(null);
  const [chatSidebarRequest, setChatSidebarRequest] = useState<{
    requestedAt: number;
    tab: 'sessions' | 'subagents' | 'cron';
    channel?: string;
    openDrawer: boolean;
  } | null>(null);
  const [pendingChatNotificationOpen, setPendingChatNotificationOpen] = useState<{
    requestedAt: number;
    sessionKey: string;
    agentId?: string;
    runId?: string;
  } | null>(null);
  const [pendingChatInput, setPendingChatInput] = useState<string | null>(null);
  const [pendingMainSessionSwitch, setPendingMainSessionSwitch] = useState(false);
  const [pendingAddGateway, setPendingAddGateway] = useState(false);
  const [sessionPanelVisible, setSessionPanelVisible] = useState(false);
  const [threadContext, setThreadContext] = useState<RootStackParamList['Thread'] | null>(null);
  const [pinnedSessionKeys, setPinnedSessionKeys] = useState<Readonly<
    Record<string, ReadonlyArray<string>>
  >>({});
  const [replyNotificationsEnabled, setReplyNotificationsEnabled] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  const handledNotificationResponseIdsRef = useRef(new Set<string>());

  useEffect(() => {
    initializeChatNotifications();
  }, []);

  const pinScopes = useMemo(() => connections.roster.flatMap((group) => (
    group.agents.map(({ agent }) => ({
      connectionId: group.connection.id,
      agentId: agent.agentId,
    }))
  )), [connections.roster]);

  useEffect(() => {
    let active = true;
    void Promise.all(pinScopes.map(async ({ connectionId, agentId }) => {
      const keys = await SessionPreferencesService.getPinnedSessionKeys(connectionId, agentId);
      return [`${connectionId}:${agentId}`, keys] as const;
    })).then((entries) => {
      if (active) setPinnedSessionKeys(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [pinScopes]);

  const { trackInitialScreen, trackScreenState } = usePostHogScreenTracking({
    rootNavigationRef,
  });

  usePostHogIdentity({
    config,
    currentAgentId,
  });

  const handleNavigationStateChange = useCallback((state: NavigationState | undefined) => {
    if (!state) return;
    trackScreenState(state);
    const routeName = getActiveLeafRouteName(state);
    if (routeName) {
      activeRouteRef.current = routeName as keyof RootStackParamList;
    }
  }, [trackScreenState]);

  const backendCapabilities = useMemo(() => getGatewayBackendCapabilities(config), [config]);
  const mainSessionKey = useMemo(
    () => resolveMainSessionKey(currentAgentId, { mainSessionKey: resolveGlobalMainSessionKey(config) }),
    [config, currentAgentId],
  );
  const isMultiAgent = agents.length > 1;

  const setCurrentAgentId = useCallback((id: string) => {
    setCurrentAgentIdState(id);
    StorageService.setCurrentAgentId(id);
  }, []);

  useEffect(() => {
    const normalized = normalizeAccessibleAgentId(currentAgentId, isPro);
    if (normalized === currentAgentId) return;
    setCurrentAgentIdState(normalized);
    StorageService.setCurrentAgentId(normalized);
  }, [currentAgentId, isPro]);

  const switchAgent = useCallback((id: string) => {
    setCurrentAgentIdState(id);
    StorageService.setCurrentAgentId(id);
    setPendingAgentSwitch(id);
  }, []);

  const clearPendingAgentSwitch = useCallback(() => {
    setPendingAgentSwitch(null);
  }, []);

  const clearGatewayKeepAliveTimer = useCallback(() => {
    if (!gatewayKeepAliveTimerRef.current) return;
    clearInterval(gatewayKeepAliveTimerRef.current);
    gatewayKeepAliveTimerRef.current = null;
  }, []);

  const syncGatewayKeepAlive = useCallback(() => {
    const hasGatewayConfig = Boolean(config?.url) && backendCapabilities.gatewayConnection;
    const shouldRun = hasGatewayConfig && shouldRunGatewayKeepAlive(gateway.getConnectionState(), appStateRef.current);
    if (!shouldRun) {
      clearGatewayKeepAliveTimer();
      return;
    }
    if (gatewayKeepAliveTimerRef.current) return;

    gatewayKeepAliveTimerRef.current = setInterval(() => {
      const stillRunnable = Boolean(config?.url)
        && backendCapabilities.gatewayConnection
        && shouldRunGatewayKeepAlive(gateway.getConnectionState(), appStateRef.current);
      if (!stillRunnable) {
        clearGatewayKeepAliveTimer();
        return;
      }
      gateway.request('last-heartbeat', {}).catch(() => {});
    }, GATEWAY_KEEPALIVE_INTERVAL_MS);
  }, [backendCapabilities.gatewayConnection, clearGatewayKeepAliveTimer, config?.url, gateway]);

  // Increment gatewayEpoch when connection becomes ready after a switch.
  // This ensures data-reload effects fire only after the new gateway is connected.
  const prevReadyRef = useRef(true);
  useEffect(() => {
    const off = gateway.on('connection', ({ state: connState }) => {
      if (connState === 'ready') {
        if (!prevReadyRef.current) {
          setGatewayEpoch(e => e + 1);
          loadAgentAvatars().then(setAgentAvatars).catch(() => {});
        }
        prevReadyRef.current = true;
      } else {
        prevReadyRef.current = false;
      }
      syncGatewayKeepAlive();
    });
    return off;
  }, [gateway, syncGatewayKeepAlive]);

  // Restore gateway transport when app returns to foreground.
  // This avoids stale sockets across all tabs without eagerly fetching tab data.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      logAppTelemetry('app_lifecycle', 'app_state_change', {
        prevState,
        nextState,
        hasGatewayConfig: Boolean(config?.url),
        connectionState: gateway.getConnectionState(),
      });

      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAtRef.current = Date.now();
        syncGatewayKeepAlive();
        return;
      }
      if (nextState !== 'active' || prevState === 'active') return;
      if (!config?.url || !backendCapabilities.gatewayConnection) return;

      const awayMs = backgroundedAtRef.current ? Date.now() - backgroundedAtRef.current : 0;
      backgroundedAtRef.current = null;
      setForegroundEpoch((prev) => prev + 1);
      const state = gateway.getConnectionState();
      const shouldProbe = shouldProbeGatewayOnForegroundResume({
        platformOs: Platform.OS,
        awayMs,
        connectionState: state,
      });
      logAppTelemetry('app_lifecycle', 'foreground_resume', {
        prevState,
        awayMs,
        connectionState: state,
        shouldProbe,
      });
      if (shouldProbe) {
        void gateway.probeConnection();
      }
      syncGatewayKeepAlive();
    });
    return () => sub.remove();
  }, [backendCapabilities.gatewayConnection, config?.url, gateway, syncGatewayKeepAlive]);

  useEffect(() => {
    syncGatewayKeepAlive();
    return () => {
      clearGatewayKeepAliveTimer();
    };
  }, [clearGatewayKeepAliveTimer, syncGatewayKeepAlive]);

  // NodeClient lifecycle — connect/disconnect based on config + nodeEnabled
  useEffect(() => {
    nodeClient.setCapabilityToggles(nodeCapabilityToggles);

    if (config?.url && nodeEnabled && backendCapabilities.gatewayConnection) {
      nodeClient.configure(config);
      nodeClient.disconnect();
      nodeClient.connect();
    } else {
      nodeClient.disconnect();
    }
  }, [backendCapabilities.gatewayConnection, nodeClient, config, nodeEnabled, nodeCapabilityToggles]);

  // NodeClient invoke dispatch
  useEffect(() => {
    const off = nodeClient.on('invokeRequest', (req) => {
      void (async () => {
        const result = await dispatchNodeInvoke(req.command, req.params, nodeCapabilityToggles);
        nodeClient.sendInvokeResult(req.id, result);
        void StorageService.appendNodeInvokeAudit({
          id: `${req.id}:${Date.now()}`,
          nodeId: req.nodeId,
          command: req.command,
          source: resolveNodeInvokeSource(req),
          timestampMs: Date.now(),
          result: result.ok ? 'success' : 'error',
          ...(result.ok
            ? {}
            : {
              errorCode: result.error.code,
              errorMessage: result.error.message,
            }),
        });
      })();
    });
    return off;
  }, [nodeClient, nodeCapabilityToggles]);

  const openChatFromNotification = useCallback((payload: {
    sessionKey: string;
    agentId?: string;
    runId?: string;
  }) => {
    const targetAgentId = payload.agentId ?? agentIdFromSessionKey(payload.sessionKey) ?? currentAgentId;
    if (targetAgentId !== currentAgentId) {
      setCurrentAgentId(targetAgentId);
    }
    setPendingChatNotificationOpen({
      requestedAt: Date.now(),
      sessionKey: payload.sessionKey,
      agentId: payload.agentId,
      runId: payload.runId,
    });
    if (navigationReady && rootNavigationRef.isReady() && connections.activeConnectionId) {
      rootNavigationRef.navigate('Thread', {
        connectionId: connections.activeConnectionId,
        agentId: targetAgentId,
        sessionKey: payload.sessionKey,
        from: 'notification',
      });
    }
  }, [connections.activeConnectionId, currentAgentId, navigationReady, rootNavigationRef, setCurrentAgentId]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !backendCapabilities.gatewayConnection) return;

    const handleNotificationResponse = (
      response: Notifications.NotificationResponse | null | undefined,
      source: 'listener' | 'launch',
    ) => {
      const payload = extractChatNotificationOpenPayload(response);
      if (!payload) return;
      const identifier = getChatNotificationResponseIdentifier(response)
        ?? `${payload.sessionKey}:${payload.runId ?? ''}:${source}`;
      if (handledNotificationResponseIdsRef.current.has(identifier)) return;
      handledNotificationResponseIdsRef.current.add(identifier);
      analyticsEvents.chatReplyNotificationOpened({
        source,
        session_kind: describeSessionKind(payload.sessionKey),
        has_agent_id: !!payload.agentId,
      });
      openChatFromNotification(payload);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response, 'listener');
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      handleNotificationResponse(response, 'launch');
    });

    return () => {
      subscription.remove();
    };
  }, [backendCapabilities.gatewayConnection, openChatFromNotification]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !backendCapabilities.gatewayConnection) return;

    const off = gateway.on('chatFinal', ({ sessionKey, message, runId }) => {
      if (!sessionKey) return;
      if (isAssistantSilentReplyMessage(message)) return;
      const previewText = sanitizeSilentPreviewText(
        extractAssistantDisplayText(message?.content),
      );
      const appState = appStateRef.current;
      const activeTab = activeRouteRef.current === 'Thread' ? 'Chat' : activeRouteRef.current;
      if (!shouldShowChatReplyNotification({ activeTab, appState })) {
        return;
      }

      const agentId = agentIdFromSessionKey(sessionKey) ?? undefined;
      const agentName = resolveAgentNotificationName(sessionKey, agents, currentAgentId);

      void scheduleChatReplyNotification({
        sessionKey,
        runId,
        agentId,
        agentName,
        previewText,
      }).then((scheduled) => {
        if (!scheduled) return;
        analyticsEvents.chatReplyNotificationShown({
          app_state: appState,
          source: appState === 'active' ? 'foreground_other_tab' : 'background',
          session_kind: describeSessionKind(sessionKey),
          has_preview_text: !!previewText,
        });
      });
    });

    return off;
  }, [agents, backendCapabilities.gatewayConnection, currentAgentId, gateway]);

  useEffect(() => {
    if (!navigationReady || !pendingChatNotificationOpen) return;
    if (!rootNavigationRef.isReady()) return;
    if (!connections.activeConnectionId) return;
    rootNavigationRef.navigate('Thread', {
      connectionId: connections.activeConnectionId,
      agentId: pendingChatNotificationOpen.agentId
        ?? agentIdFromSessionKey(pendingChatNotificationOpen.sessionKey)
        ?? currentAgentId,
      sessionKey: pendingChatNotificationOpen.sessionKey,
      from: 'notification',
    });
  }, [connections.activeConnectionId, currentAgentId, navigationReady, pendingChatNotificationOpen, rootNavigationRef]);

  const appContextValue = useMemo(
    () => ({
      gateway,
      activeAdapter,
      activeGatewayConfigId,
      gatewayEpoch,
      foregroundEpoch,
      config,
      debugMode,
      showAgentAvatar,
      showModelUsage,
      execApprovalEnabled,
      nodeEnabled,
      onNodeEnabledToggle,
      nodeCapabilityToggles,
      onNodeCapabilityTogglesChange,
      chatFontSize,
      chatAppearance,
      speechRecognitionLanguage,
      chatSessionRequest,
      chatSidebarRequest,
      pendingChatNotificationOpen,
      agents,
      agentAvatars,
      setAgentAvatars,
      currentAgentId,
      initialChatPreview,
      mainSessionKey,
      isMultiAgent,
      setCurrentAgentId,
      switchAgent,
      pendingAgentSwitch,
      clearPendingAgentSwitch,
      setAgents,
      onDebugToggle,
      onShowAgentAvatarToggle,
      onShowModelUsageToggle,
      onExecApprovalToggle,
      onChatFontSizeChange,
      onChatAppearanceChange,
      requestChatSession: (sessionKey: string, sourceRole?: string) => {
        setChatSessionRequest({
          sessionKey,
          sourceRole,
          requestedAt: Date.now(),
        });
      },
      clearChatSessionRequest: () => {
        setChatSessionRequest(null);
      },
      requestChatSidebar: (params?: { tab?: 'sessions' | 'subagents' | 'cron'; channel?: string; openDrawer?: boolean }) => {
        const normalizedChannel = params?.channel?.trim().toLowerCase() || undefined;
        setChatSidebarRequest({
          requestedAt: Date.now(),
          tab: params?.tab ?? 'sessions',
          channel: normalizedChannel,
          openDrawer: params?.openDrawer ?? true,
        });
        setSessionPanelVisible(true);
        if (rootNavigationRef.isReady() && connections.activeConnectionId && activeRouteRef.current !== 'Thread') {
          rootNavigationRef.navigate('Thread', {
            connectionId: connections.activeConnectionId,
            agentId: currentAgentId,
            sessionKey: mainSessionKey,
            from: 'panel',
          });
        }
      },
      clearChatSidebarRequest: () => {
        setChatSidebarRequest(null);
      },
      requestOpenChatFromNotification: (params: {
        sessionKey: string;
        agentId?: string;
        runId?: string;
      }) => {
        openChatFromNotification(params);
      },
      clearPendingChatNotificationOpen: () => {
        setPendingChatNotificationOpen(null);
      },
      pendingChatInput,
      pendingMainSessionSwitch,
      requestChatWithInput: (text: string) => {
        setPendingChatInput(text);
        setPendingMainSessionSwitch(true);
        if (rootNavigationRef.isReady() && connections.activeConnectionId) {
          rootNavigationRef.navigate('Thread', {
            connectionId: connections.activeConnectionId,
            agentId: currentAgentId,
            sessionKey: mainSessionKey,
            from: 'notification',
          });
        }
      },
      clearPendingChatInput: () => {
        setPendingChatInput(null);
      },
      clearPendingMainSessionSwitch: () => {
        setPendingMainSessionSwitch(false);
      },
      pendingAddGateway,
      requestAddGateway: () => {
        setPendingAddGateway(true);
      },
      clearPendingAddGateway: () => {
        setPendingAddGateway(false);
      },
      onSpeechRecognitionLanguageChange,
      onSaved,
      onReset,
    }),
    [
      agentAvatars,
      agents,
      activeAdapter,
      activeGatewayConfigId,
      chatAppearance,
      chatFontSize,
      chatSidebarRequest,
      connections.activeConnectionId,
      config,
      currentAgentId,
      debugMode,
      execApprovalEnabled,
      gateway,
      showAgentAvatar,
      nodeEnabled,
      nodeCapabilityToggles,
      pendingAddGateway,
      isMultiAgent,
      mainSessionKey,
      chatSessionRequest,
      pendingChatNotificationOpen,
      pendingChatInput,
      pendingMainSessionSwitch,
      openChatFromNotification,
      onDebugToggle,
      onChatAppearanceChange,
      onChatFontSizeChange,
      onNodeEnabledToggle,
      onNodeCapabilityTogglesChange,
      onExecApprovalToggle,
      onSpeechRecognitionLanguageChange,
      onShowAgentAvatarToggle,
      onShowModelUsageToggle,
      onReset,
      onSaved,
      gatewayEpoch,
      foregroundEpoch,
      rootNavigationRef,
      setCurrentAgentId,
      switchAgent,
      pendingAgentSwitch,
      clearPendingAgentSwitch,
      showModelUsage,
      speechRecognitionLanguage,
    ],
  );

  const navigationTheme = useMemo<NavigationTheme>(() => {
    const base = theme.scheme === 'dark' ? NavigationDarkTheme : NavigationDefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.canvas,
        card: theme.colors.surface,
        text: theme.colors.ink,
        border: theme.colors.border,
        notification: theme.colors.primary,
      },
    };
  }, [theme]);

  const settingsConnections = useMemo(() => connections.connections.map((connection) => ({
    ...connection,
    locked: !isPro
      && connections.freeConnectionId !== null
      && connection.id !== connections.freeConnectionId,
  })), [connections.connections, connections.freeConnectionId, isPro]);

  const settingsSectionConnections = useMemo(() => settingsConnections.map((connection) => ({
    ...connection,
    state: connection.id === connections.activeConnectionId ? connections.activeState : 'idle' as const,
    supportsRelayStats: connection.transportKind === 'relay',
  })), [connections.activeConnectionId, connections.activeState, settingsConnections]);

  const canAccessRosterAgent = useCallback((connectionId: string, targetAgentId: string) => {
    if (isPro) return true;
    if (connectionId !== connections.freeConnectionId) return false;
    return connections.roster.some((group) => (
      group.connection.id === connectionId
      && group.agents.some(({ agent }) => agent.agentId === targetAgentId && agent.isMain)
    ));
  }, [connections.freeConnectionId, connections.roster, isPro]);

  const handleSessionAction = useCallback(async (
    row: SessionPanelRow,
    action: SessionPanelAction,
    payload?: { title: string },
  ) => {
    if (action === 'pin') {
      const scope = `${row.connectionId}:${row.agentId}`;
      const keys = await SessionPreferencesService.togglePinnedSession(
        row.connectionId,
        row.agentId,
        row.key,
      );
      setPinnedSessionKeys((current) => ({ ...current, [scope]: keys }));
      return;
    }
    const adapter = getConnectionRuntime().getAdapter(row.connectionId);
    if (!adapter) return;
    if (action === 'rename' && payload?.title) {
      await adapter.patchSession?.(row.key, { title: payload.title });
    }
    if (action === 'reset') await adapter.resetSession?.(row.key);
    if (action === 'delete') {
      await adapter.deleteSession?.(row.key);
      await SessionPreferencesService.clearSession(row.connectionId, row.agentId, row.key);
    }
    await getConnectionRuntime().refreshRoster();
  }, []);

  const openExternalUrl = useCallback((url: string | null | undefined) => {
    if (url) void Linking.openURL(url).catch(() => undefined);
  }, []);

  const handleAccountSectionAction = useCallback((
    request: AccountSettingsSectionActionRequest,
    navigation: { navigate: typeof rootNavigationRef.navigate },
  ) => {
    switch (request.action) {
      case 'set-reply-notifications':
        setReplyNotificationsEnabled(request.enabled === true);
        return;
      case 'set-debug-mode':
        onDebugToggle(request.enabled === true);
        return;
      case 'view-pro':
        showPaywall('settingsMembershipPreview');
        return;
      case 'restore-purchases':
        void restorePurchases();
        return;
      case 'add-connection':
        navigation.navigate('Onboarding', { presentation: 'modal' });
        return;
      case 'reconnect-connection':
        if (request.connectionId) {
          void getConnectionRuntime().activate(request.connectionId)
            .then(() => getConnectionRuntime().probeActive());
        }
        return;
      case 'help-center':
      case 'openclaw-docs':
        openExternalUrl(publicAppLinks.docsUrl ?? 'https://docs.openclaw.ai');
        return;
      case 'hermes-docs':
        openExternalUrl('https://hermes-agent.nousresearch.com/docs/getting-started/quickstart');
        return;
      case 'openclaw-releases':
        openExternalUrl(publicAppLinks.openClawReleasesUrl);
        return;
      case 'feedback':
        openExternalUrl(publicAppLinks.supportEmail ? `mailto:${publicAppLinks.supportEmail}` : null);
        return;
      case 'discord':
        openExternalUrl(publicAppLinks.discordInviteUrl);
        return;
      case 'repository':
        openExternalUrl(CLAWKET_GITHUB_REPO_URL);
        return;
      case 'privacy':
        openExternalUrl(publicAppLinks.privacyPolicyUrl);
        return;
      case 'terms':
        openExternalUrl(publicAppLinks.termsOfUseUrl);
        return;
      case 'share':
        void Share.share({ message: CLAWKET_GITHUB_REPO_URL });
        return;
      default:
        return;
    }
  }, [onDebugToggle, openExternalUrl, restorePurchases, rootNavigationRef.navigate, showPaywall]);

  const resolveAgentSettingsAction = useCallback<AgentSettingsSectionActionResolver>(async (
    request,
    context,
  ) => {
    if (request.action === 'connection.reconnect') {
      await getConnectionRuntime().activate(context.connection.id);
      await getConnectionRuntime().probeActive();
    }
  }, []);

  if (!connections.initialized) {
    return (
      <View style={[loadingStyles.loading, { backgroundColor: theme.colors.canvas }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      </View>
    );
  }

  return (
    <AppContextProvider value={appContextValue}>
      <GlobalLoadingOverlayProvider>
        <GatewayScannerProvider>
          <AppDeepLinkHandler
            rootNavigationRef={rootNavigationRef}
            gateway={gateway}
            activeConnectionId={connections.activeConnectionId}
            currentAgentId={currentAgentId}
            mainSessionKey={mainSessionKey}
            onSaved={onSaved}
          />
          <NodeCameraCaptureProvider>
            <NavigationContainer
              ref={rootNavigationRef}
              theme={navigationTheme}
              onReady={() => {
                setNavigationReady(true);
                trackInitialScreen();
              }}
              onStateChange={handleNavigationStateChange}
            >
              <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
              <RootStack.Navigator
                initialRouteName={connections.connections.length > 0 ? 'Roster' : 'Onboarding'}
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: theme.colors.canvas },
                }}
              >
                <RootStack.Screen name="Onboarding">
                  {(props) => (
                    <OnboardingRoute
                      {...props}
                      onConnected={() => {
                        props.navigation.reset({ index: 0, routes: [{ name: 'Roster' }] });
                      }}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="Roster">
                  {({ navigation }) => (
                    <RosterScreen
                      pinnedSessionKeys={pinnedSessionKeys}
                      canAccessAgent={canAccessRosterAgent}
                      isPro={isPro}
                      onOpenAccount={() => navigation.navigate('AccountSettings')}
                      onSearch={() => navigation.navigate('Search')}
                      onAdd={() => navigation.navigate('Onboarding', { presentation: 'modal' })}
                      onOpenRow={(row: RosterDisplayRow) => {
                        navigation.navigate('Thread', {
                          connectionId: row.connectionId,
                          agentId: row.agentId,
                          sessionKey: row.sessionKey,
                          from: 'roster',
                        });
                      }}
                      onOpenLockedRow={(row: RosterDisplayRow) => {
                        showPaywall(row.connectionId === connections.freeConnectionId
                          ? 'agents'
                          : 'gatewayConnections');
                      }}
                      onOpenPro={() => showPaywall('agents')}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="Thread">
                  {(props) => (
                    <ThreadScreen
                      {...props}
                      locked={!canAccessRosterAgent(
                        props.route.params.connectionId,
                        props.route.params.agentId,
                      )}
                      onOpenSessionPanel={() => {
                        setThreadContext(props.route.params);
                        setSessionPanelVisible(true);
                      }}
                      onThreadOpened={setThreadContext}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="AgentSettings">
                  {({ navigation, route }) => {
                    const group = connections.roster.find((candidate) => (
                      candidate.connection.id === route.params.connectionId
                    ));
                    const connection = connections.connections.find((candidate) => (
                      candidate.id === route.params.connectionId
                    )) ?? group?.connection;
                    const agent = group?.agents.find((candidate) => (
                      candidate.agent.agentId === route.params.agentId
                    ))?.agent ?? null;
                    const adapter = connections.activeConnectionId === route.params.connectionId
                      ? connections.activeAdapter
                      : null;
                    if (!connection) {
                      return (
                        <View style={[loadingStyles.loading, { backgroundColor: theme.colors.canvas }]}>
                          <ActivityIndicator color={theme.colors.primary} />
                        </View>
                      );
                    }
                    return (
                      <AgentSettingsScreen
                        adapter={adapter}
                        connection={connection}
                        agent={agent}
                        capabilities={adapter?.capabilities ?? resolveCapabilities(connection.backendKind)}
                        isPro={isPro}
                        permissionDenied={Boolean(agent && !canAccessRosterAgent(
                          connection.id,
                          agent.agentId,
                        ))}
                        onBack={navigation.goBack}
                        onNavigate={navigation.navigate}
                        onOpenPro={(section) => showPaywall(resolveAgentPaywallFeature(section))}
                        onRetry={() => {
                          void getConnectionRuntime().activate(connection.id)
                            .then(() => getConnectionRuntime().probeActive());
                        }}
                      />
                    );
                  }}
                </RootStack.Screen>
                <RootStack.Screen name="AgentSettingsSection">
                  {(props) => (
                    <AgentSettingsSectionScreen
                      {...props}
                      isPro={isPro}
                      resolveAction={resolveAgentSettingsAction}
                      onOpenPaywall={(reason) => showPaywall(normalizePaywallFeature(reason))}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="AccountSettings">
                  {({ navigation }) => (
                    <AccountSettingsScreen
                      status={connections.error ? { kind: 'error', code: connections.error.message } : { kind: 'ready' }}
                      connections={settingsConnections}
                      isPro={isPro}
                      canAddConnection={isPro || connections.connections.length === 0}
                      replyNotificationsEnabled={replyNotificationsEnabled}
                      debugMode={debugMode}
                      onBack={navigation.goBack}
                      onRetry={() => { void getConnectionRuntime().probeActive(); }}
                      onOpenAction={(action) => {
                        if (action === 'view-pro') {
                          showPaywall('settingsMembershipPreview');
                          return;
                        }
                        if (action === 'restore-purchases') {
                          void restorePurchases();
                          return;
                        }
                        if (action === 'add-connection') {
                          navigation.navigate('Onboarding', { presentation: 'modal' });
                          return;
                        }
                        const section = ACCOUNT_ACTION_SECTION[action];
                        if (section) navigation.navigate('AccountSettingsSection', { section });
                      }}
                      onOpenConnection={(connectionId) => {
                        void getConnectionRuntime().activate(connectionId);
                        navigation.navigate('AccountSettingsSection', { section: 'connections' });
                      }}
                      onOpenPaywall={(reason) => showPaywall(normalizePaywallFeature(reason))}
                      onReplyNotificationsChange={setReplyNotificationsEnabled}
                      onDebugModeChange={onDebugToggle}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="AccountSettingsSection">
                  {({ navigation, route }) => (
                    <AccountSettingsSectionScreen
                      section={route.params.section}
                      data={{
                        connections: settingsSectionConnections,
                        isPro,
                        canAddConnection: isPro || connections.connections.length === 0,
                        replyNotificationsEnabled,
                        debugMode,
                      }}
                      onBack={navigation.goBack}
                      onRetry={() => { void getConnectionRuntime().probeActive(); }}
                      onAction={(request) => handleAccountSectionAction(request, navigation)}
                      onOpenPaywall={(reason) => showPaywall(normalizePaywallFeature(reason))}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="Search" component={SearchScreen} />
                <RootStack.Screen name="MessageDetail" component={MessageDetailScreen} />
                <RootStack.Screen name="Paywall" component={PaywallRouteBridge} />
              </RootStack.Navigator>
              <SessionPanel
                visible={sessionPanelVisible}
                currentAgentId={threadContext?.agentId ?? currentAgentId}
                currentSessionKey={threadContext?.sessionKey ?? mainSessionKey}
                onClose={() => setSessionPanelVisible(false)}
                onSelectSession={(row) => {
                  const params: RootStackParamList['Thread'] = {
                    connectionId: row.connectionId,
                    agentId: row.agentId,
                    sessionKey: row.key,
                    from: 'panel',
                  };
                  setThreadContext(params);
                  setCurrentAgentId(row.agentId);
                  if (rootNavigationRef.isReady()) rootNavigationRef.navigate('Thread', params);
                }}
                onSessionAction={handleSessionAction}
                onOpenPermission={() => showPaywall('agents')}
              />
            </NavigationContainer>
            <GlobalGatewayOverlay />
            <GlobalProPaywallOverlay />
          </NodeCameraCaptureProvider>
        </GatewayScannerProvider>
      </GlobalLoadingOverlayProvider>
    </AppContextProvider>
  );
}

function AppDeepLinkHandler(props: DeepLinkDeps): null {
  useDeepLinkHandler(props);
  return null;
}

function normalizePaywallFeature(reason: string): ProFeature {
  switch (reason) {
    case 'gatewayConnections':
    case 'appIcons':
    case 'configBackupCreate':
    case 'configBackupRestore':
    case 'openclawDiagnostics':
    case 'openclawPermissions':
    case 'agents':
    case 'coreFileEditing':
    case 'logs':
    case 'usage':
    case 'messageHistory':
    case 'settingsMembershipPreview':
      return reason;
    default:
      return 'settingsMembershipPreview';
  }
}

function resolveAgentPaywallFeature(section: AgentSettingsSection): ProFeature {
  if (section === 'files') return 'coreFileEditing';
  if (section === 'logs') return 'logs';
  if (section === 'usage') return 'usage';
  if (section === 'openclaw') return 'openclawDiagnostics';
  return 'agents';
}

function PaywallRouteBridge({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'Paywall'>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { isPro, showPaywall, visible } = useProPaywall();
  const openedRef = useRef(false);

  useEffect(() => {
    if (isPro) {
      navigation.goBack();
      return;
    }
    showPaywall(normalizePaywallFeature(route.params?.reason ?? 'settingsMembershipPreview'));
  }, [isPro, navigation, route.params?.reason, showPaywall]);

  useEffect(() => {
    if (visible) {
      openedRef.current = true;
      return;
    }
    if (openedRef.current && navigation.canGoBack()) navigation.goBack();
  }, [navigation, visible]);

  return <View style={[loadingStyles.loading, { backgroundColor: theme.colors.canvas }]} />;
}

function GlobalGatewayOverlay(): React.JSX.Element | null {
  const { loadingMessage } = useGlobalLoadingOverlay();
  return <GlobalLoadingOverlay visible={!!loadingMessage} message={loadingMessage ?? undefined} />;
}

function GlobalProPaywallOverlay(): React.JSX.Element | null {
  const { visible, hidePaywall } = useProPaywall();
  return <ProPaywallOverlay visible={visible} onClose={hidePaywall} />;
}

const loadingStyles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
