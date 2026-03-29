import 'react-native-get-random-values';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, AppStateStatus, NativeModules, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { WebViewErrorEvent, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createNavigationContainerRef,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  LinkingOptions,
  NavigationContainer,
  NavigatorScreenParams,
  NavigationState,
  Theme as NavigationTheme,
} from '@react-navigation/native';
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConfigTab } from './src/screens/ConfigScreen/ConfigTab';
import { ChatTab } from './src/screens/ChatScreen/ChatTab';
import { ConsoleTab } from './src/screens/ConsoleScreen/ConsoleTab';
import { OpenClawPermissionsScreen } from './src/screens/ConfigScreen/OpenClawPermissionsScreen';
import {
  renderConsoleModalScreens,
  type ConsoleStackParamList,
  useConsoleRootModalScreenOptions,
} from './src/screens/ConsoleScreen/sharedNavigator';
import { OfficeTab } from './src/screens/OfficeScreen/OfficeTab';
import {
  OfficeGuideButton,
  OfficeGuideOverlay,
} from './src/screens/OfficeScreen/OfficeGuideOverlay';
import { AppContextProvider, useAppContext } from './src/contexts/AppContext';
import { GlobalLoadingOverlayProvider, useGlobalLoadingOverlay } from './src/contexts/GlobalLoadingOverlayContext';
import { GatewayScannerProvider } from './src/contexts/GatewayScannerContext';
import { NodeCameraCaptureProvider } from './src/contexts/NodeCameraCaptureContext';
import { ProPaywallProvider, useProPaywall } from './src/contexts/ProPaywallContext';
import { GlobalLoadingOverlay } from './src/components/ui';
import { DebugOverlay } from './src/components/chat/DebugOverlay';
import { ProPaywallOverlay } from './src/components/pro/ProPaywallOverlay';
import { loadAgentAvatars } from './src/services/agent-avatar';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { GatewayClient } from './src/services/gateway';
import { NodeClient } from './src/services/node-client';
import { dispatchNodeInvoke } from './src/services/node-invoke-dispatcher';
import { NodeCapabilityToggles } from './src/services/node-capabilities';
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
import { resolveGatewayCacheScopeId } from './src/services/gateway-cache-scope';
import { analyticsEvents } from './src/services/analytics/events';
import { useDeepLinkHandler } from './src/hooks/useDeepLinkHandler';
import { usePostHogIdentity } from './src/hooks/usePostHogIdentity';
import { usePostHogScreenTracking } from './src/hooks/usePostHogScreenTracking';
import { ChatAppearanceSettings, GatewayConfig, SpeechRecognitionLanguage } from './src/types';
import type { AgentInfo } from './src/types/agent';
import { buildTheme, builtInAccents, defaultAccentId, useAppTheme } from './src/theme';
import { AppProviders } from './src/bootstrap/AppProviders';
import { useAppBootstrap } from './src/bootstrap/useAppBootstrap';
import i18next from './src/i18n';
import { getActiveLeafRouteName } from './src/utils/posthog-navigation';
import {
  extractAssistantDisplayText,
  isAssistantSilentReplyMessage,
  sanitizeSilentPreviewText,
} from './src/utils/chat-message';
import { normalizeAccessibleAgentId } from './src/utils/pro';

type RootTabParamList = {
  Chat: undefined;
  Office: undefined;
  Console: undefined;
  My: undefined;
};

type RootStackParamList = {
  MainTabs: NavigatorScreenParams<RootTabParamList> | undefined;
  OpenClawPermissions: undefined;
} & ConsoleStackParamList;

const RootStack = createNativeStackNavigator<RootStackParamList>();
const NativeTab = createNativeBottomTabNavigator<RootTabParamList>();
const JsTab = createBottomTabNavigator<RootTabParamList>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Tab = (Platform.OS === 'ios' ? NativeTab : JsTab) as any;
const LOADING_THEME = buildTheme('light', 'light', builtInAccents[defaultAccentId]);
export default function App(): React.JSX.Element {
  const [gateway] = useState(() => new GatewayClient());
  const [nodeClient] = useState(() => new NodeClient());
  const {
    accentId,
    activeGatewayConfigId,
    canvasEnabled,
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
    setCanvasEnabled,
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
  } = useAppBootstrap({ gateway, nodeClient });

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
          activeGatewayConfigId={activeGatewayConfigId}
          nodeClient={nodeClient}
          config={config}
          debugMode={debugMode}
          showAgentAvatar={showAgentAvatar}
          showModelUsage={showModelUsage}
          execApprovalEnabled={execApprovalEnabled}
          canvasEnabled={canvasEnabled}
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
          onCanvasToggle={(enabled) => {
            setCanvasEnabled(enabled);
            StorageService.setCanvasEnabled(enabled);
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
            gateway.configure(next);
            setActiveGatewayConfigId(
              nextGatewayScopeId
              ?? resolveGatewayCacheScopeId({ config: next }),
            );
          }}
          onReset={() => {
            setConfig(null);
            setActiveGatewayConfigId(null);
            gateway.configure(null);
          }}
        />
      </ProPaywallProvider>
    </AppProviders>
  );
}

const OFFICE_DEV_PORT = 5174;
const DEV_URL_OVERRIDE = process.env.EXPO_PUBLIC_OFFICE_DEV_URL;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const officeHtmlString: string = require('./office-game/dist/office-inline.js').html;

const OFFICE_HTML_BG_REGEX = /(html,\s*body\s*\{[^}]*background-color:\s*)([^;]+)(;)/;

const TAB_BAR_HEIGHT = Platform.OS === 'android' ? 60 : 49;
const GATEWAY_KEEPALIVE_INTERVAL_MS = 5_000;

function resolveDevHost(): string {
  const scriptURL = (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode?.scriptURL;
  if (!scriptURL) return 'localhost';
  try {
    const { hostname } = new URL(scriptURL);
    return hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

function resolveOfficeDevUrl(): string {
  const override = DEV_URL_OVERRIDE?.trim();
  if (override) return override;
  const host = resolveDevHost();
  return `http://${host}:${OFFICE_DEV_PORT}`;
}

function getOfficeLocale(): string {
  return i18next.resolvedLanguage ?? i18next.language ?? 'en';
}

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

function getMainTabsState(state: NavigationState | undefined): NavigationState | undefined {
  if (!state) return undefined;
  const mainTabsRoute = state.routes.find((route) => route.name === 'MainTabs');
  return mainTabsRoute?.state as NavigationState | undefined;
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
  activeGatewayConfigId: string | null;
  nodeClient: NodeClient;
  config: GatewayConfig | null;
  debugMode: boolean;
  showAgentAvatar: boolean;
  showModelUsage: boolean;
  execApprovalEnabled: boolean;
  canvasEnabled: boolean;
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
  onCanvasToggle: (enabled: boolean) => void;
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
  activeGatewayConfigId,
  nodeClient,
  config,
  debugMode,
  showAgentAvatar,
  showModelUsage,
  execApprovalEnabled,
  canvasEnabled,
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
  onCanvasToggle,
  onNodeEnabledToggle,
  onNodeCapabilityTogglesChange,
  onChatFontSizeChange,
  onChatAppearanceChange,
  onSpeechRecognitionLanguageChange,
  onSaved,
  onReset,
}: AppContentProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const { isPro } = useProPaywall();
  const rootNavigationRef = useMemo(() => createNavigationContainerRef<RootStackParamList>(), []);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentAvatars, setAgentAvatars] = useState<Record<string, string>>({});
  const [currentAgentId, setCurrentAgentIdState] = useState<string>(initialAgentId ?? 'main');
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<string | null>(null);
  const officeLazy = false;
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [gatewayEpoch, setGatewayEpoch] = useState(0);
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const hasUnreadChatRef = useRef(false);
  const activeTabRef = useRef<string>('Chat');
  const officeWebViewRef = useRef<WebView>(null);
  const officeWebViewLoadedRef = useRef(false);
  const officeMessageHandlerRef = useRef<((e: WebViewMessageEvent) => void) | null>(null);
  const officeLoadEndHandlerRef = useRef<(() => void) | null>(null);
  const officeDebugAppendRef = useRef<((msg: string) => void) | null>(null);
  const [isOfficeFocused, setIsOfficeFocused] = useState(false);
  const [shouldShowOfficeWebView, setShouldShowOfficeWebView] = useState(false);
  const [officeGuideVisible, setOfficeGuideVisible] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);
  const gatewayKeepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved agent avatars on mount
  useEffect(() => { loadAgentAvatars().then(setAgentAvatars).catch(() => {}); }, []);
  const [officeChatRequest, setOfficeChatRequest] = useState<{
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
  const [navigationReady, setNavigationReady] = useState(false);
  const handledNotificationResponseIdsRef = useRef(new Set<string>());

  // Office tab uses lazy: false from the start — WebView runs in a separate
  // process so it won't block the Chat tab's initial render.

  useEffect(() => {
    initializeChatNotifications();
  }, []);

  // Mark unread when chatFinal arrives while not on Chat tab
  useEffect(() => {
    const off = gateway.on('chatFinal', () => {
      if (activeTabRef.current !== 'Chat') {
        hasUnreadChatRef.current = true;
        setHasUnreadChat(true);
      }
    });
    return off;
  }, [gateway]);

  // Track whether a full-bleed WebView screen (e.g. Docs) is active
  const [isWebViewScreen, setIsWebViewScreen] = useState(false);
  const { trackInitialScreen, trackScreenState } = usePostHogScreenTracking({
    rootNavigationRef,
  });

  usePostHogIdentity({
    config,
    currentAgentId,
  });

  // Keep locale sync at the WebView host level so the first load does not
  // depend on OfficeTab registering handlers before the page finishes loading.
  const sendOfficeLocale = useCallback(() => {
    if (!officeWebViewLoadedRef.current) return;
    officeWebViewRef.current?.postMessage(
      JSON.stringify({ type: 'LOCALE', locale: getOfficeLocale() }),
    );
  }, []);

  // Track active tab and clear unread when navigating to Chat
  const handleNavigationStateChange = useCallback((state: NavigationState | undefined) => {
    if (!state) return;
    trackScreenState(state);
    const mainTabsState = getMainTabsState(state);
    const activeTabRoute = mainTabsState?.routes[mainTabsState.index ?? 0];
    const activeRootRoute = state.routes[state.index ?? 0];
    const officeTabFocused = activeTabRoute?.name === 'Office';
    if (activeTabRoute) {
      activeTabRef.current = activeTabRoute.name;
    }
    if (activeTabRoute?.name === 'Chat' && hasUnreadChatRef.current) {
      hasUnreadChatRef.current = false;
      setHasUnreadChat(false);
    }
    setIsOfficeFocused(officeTabFocused);
    setShouldShowOfficeWebView(
      Platform.OS === 'ios'
        ? officeTabFocused
        : officeTabFocused && activeRootRoute?.name === 'MainTabs',
    );
    setIsWebViewScreen(getActiveLeafRouteName(state) === 'Docs');
  }, [trackScreenState]);

  useEffect(() => {
    if (isOfficeFocused) return;
    setOfficeGuideVisible(false);
  }, [isOfficeFocused]);

  const handleOpenOfficeGuide = useCallback(() => {
    setOfficeGuideVisible(true);
  }, []);

  const handleCloseOfficeGuide = useCallback(() => {
    setOfficeGuideVisible(false);
  }, []);

  const mainSessionKey = useMemo(() => `agent:${currentAgentId}:main`, [currentAgentId]);
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
    const hasGatewayConfig = Boolean(config?.url);
    const shouldRun = hasGatewayConfig && shouldRunGatewayKeepAlive(gateway.getConnectionState(), appStateRef.current);
    if (!shouldRun) {
      clearGatewayKeepAliveTimer();
      return;
    }
    if (gatewayKeepAliveTimerRef.current) return;

    gatewayKeepAliveTimerRef.current = setInterval(() => {
      const stillRunnable = Boolean(config?.url) && shouldRunGatewayKeepAlive(gateway.getConnectionState(), appStateRef.current);
      if (!stillRunnable) {
        clearGatewayKeepAliveTimer();
        return;
      }
      gateway.request('last-heartbeat', {}).catch(() => {});
    }, GATEWAY_KEEPALIVE_INTERVAL_MS);
  }, [clearGatewayKeepAliveTimer, config?.url, gateway]);

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
      if (!config?.url) return;

      const awayMs = backgroundedAtRef.current ? Date.now() - backgroundedAtRef.current : 0;
      backgroundedAtRef.current = null;
      setForegroundEpoch((prev) => prev + 1);
      const state = gateway.getConnectionState();
      const shouldReconnect = state !== 'ready' || awayMs >= 60_000;
      logAppTelemetry('app_lifecycle', 'foreground_resume', {
        prevState,
        awayMs,
        connectionState: state,
        shouldReconnect,
      });
      if (shouldReconnect) gateway.reconnect();
      syncGatewayKeepAlive();
    });
    return () => sub.remove();
  }, [config?.url, gateway, syncGatewayKeepAlive]);

  useEffect(() => {
    syncGatewayKeepAlive();
    return () => {
      clearGatewayKeepAliveTimer();
    };
  }, [clearGatewayKeepAliveTimer, syncGatewayKeepAlive]);

  // NodeClient lifecycle — connect/disconnect based on config + nodeEnabled
  useEffect(() => {
    nodeClient.setCapabilityToggles(nodeCapabilityToggles);

    if (config?.url && nodeEnabled) {
      nodeClient.configure(config);
      nodeClient.disconnect();
      nodeClient.connect();
    } else {
      nodeClient.disconnect();
    }
  }, [nodeClient, config, nodeEnabled, nodeCapabilityToggles]);

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
    if (payload.agentId && payload.agentId !== currentAgentId) {
      setCurrentAgentId(payload.agentId);
    }
    setPendingChatNotificationOpen({
      requestedAt: Date.now(),
      sessionKey: payload.sessionKey,
      agentId: payload.agentId,
      runId: payload.runId,
    });
    if (navigationReady && rootNavigationRef.isReady()) {
      rootNavigationRef.navigate('MainTabs', { screen: 'Chat' });
    }
  }, [currentAgentId, navigationReady, rootNavigationRef, setCurrentAgentId]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

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
  }, [openChatFromNotification]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const off = gateway.on('chatFinal', ({ sessionKey, message, runId }) => {
      if (!sessionKey) return;
      if (isAssistantSilentReplyMessage(message)) return;
      const previewText = sanitizeSilentPreviewText(
        extractAssistantDisplayText(message?.content),
      );
      const appState = appStateRef.current;
      const activeTab = activeTabRef.current;
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
  }, [agents, currentAgentId, gateway]);

  useEffect(() => {
    if (!navigationReady || !pendingChatNotificationOpen) return;
    if (!rootNavigationRef.isReady()) return;
    rootNavigationRef.navigate('MainTabs', { screen: 'Chat' });
  }, [navigationReady, pendingChatNotificationOpen, rootNavigationRef]);

  const appContextValue = useMemo(
    () => ({
      gateway,
      activeGatewayConfigId,
      gatewayEpoch,
      foregroundEpoch,
      config,
      debugMode,
      showAgentAvatar,
      showModelUsage,
      execApprovalEnabled,
      canvasEnabled,
      nodeEnabled,
      onNodeEnabledToggle,
      nodeCapabilityToggles,
      onNodeCapabilityTogglesChange,
      chatFontSize,
      chatAppearance,
      speechRecognitionLanguage,
      officeChatRequest,
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
      onCanvasToggle,
      onChatFontSizeChange,
      onChatAppearanceChange,
      requestOfficeChat: (sessionKey: string, sourceRole?: string) => {
        setOfficeChatRequest({
          sessionKey,
          sourceRole,
          requestedAt: Date.now(),
        });
      },
      clearOfficeChatRequest: () => {
        setOfficeChatRequest(null);
      },
      requestChatSidebar: (params?: { tab?: 'sessions' | 'subagents' | 'cron'; channel?: string; openDrawer?: boolean }) => {
        const normalizedChannel = params?.channel?.trim().toLowerCase() || undefined;
        setChatSidebarRequest({
          requestedAt: Date.now(),
          tab: params?.tab ?? 'sessions',
          channel: normalizedChannel,
          openDrawer: params?.openDrawer ?? true,
        });
        if (rootNavigationRef.isReady()) {
          rootNavigationRef.navigate('MainTabs', { screen: 'Chat' });
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
        if (rootNavigationRef.isReady()) {
          rootNavigationRef.navigate('MainTabs', { screen: 'Chat' });
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
      officeWebViewRef,
      officeMessageHandlerRef,
      officeLoadEndHandlerRef,
      officeDebugAppendRef,
      isOfficeFocused,
    }),
    [
      agentAvatars,
      agents,
      activeGatewayConfigId,
      canvasEnabled,
      chatAppearance,
      chatFontSize,
      chatSidebarRequest,
      config,
      currentAgentId,
      debugMode,
      execApprovalEnabled,
      gateway,
      showAgentAvatar,
      isOfficeFocused,
      nodeEnabled,
      nodeCapabilityToggles,
      pendingAddGateway,
      isMultiAgent,
      mainSessionKey,
      officeChatRequest,
      pendingChatNotificationOpen,
      pendingChatInput,
      pendingMainSessionSwitch,
      openChatFromNotification,
      onDebugToggle,
      onCanvasToggle,
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
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.primary,
      },
    };
  }, [theme]);

  // Deep link handler for clawket:// scheme
  useDeepLinkHandler({
    rootNavigationRef,
    gateway,
    mainSessionKey,
    onSaved,
    requestChatSidebar: appContextValue.requestChatSidebar,
  });

  const insets = useSafeAreaInsets();

  const themedOfficeHtml = useMemo(
    () => officeHtmlString.replace(OFFICE_HTML_BG_REGEX, `$1${theme.colors.background}$3`),
    [theme.colors.background],
  );
  const officeSource = useMemo(() => {
    if (!__DEV__) return { html: themedOfficeHtml };
    return { uri: resolveOfficeDevUrl() };
  }, [themedOfficeHtml]);

  useEffect(() => {
    const handleLanguageChanged = () => {
      sendOfficeLocale();
    };
    i18next.on('languageChanged', handleLanguageChanged);
    return () => {
      i18next.off('languageChanged', handleLanguageChanged);
    };
  }, [sendOfficeLocale]);

  useEffect(() => {
    if (!isOfficeFocused) return;
    sendOfficeLocale();
  }, [isOfficeFocused, sendOfficeLocale]);

  useEffect(() => {
    sendOfficeLocale();
  }, [foregroundEpoch, sendOfficeLocale]);

  // Share intent linking config (excludes clawket:// deep links — handled by useDeepLinkHandler)
  const shareIntentLinking = useMemo<LinkingOptions<RootStackParamList>>(() => ({
    prefixes: [Linking.createURL('/')],
    config: {
      screens: {
        MainTabs: {
          screens: {
            Chat: 'handle-share',
          },
        },
      },
    },
    async getInitialURL() {
      const url = await Linking.getInitialURL();
      if (url && url.startsWith('clawket://')) return null;
      if (url && new URL(url).hostname === 'expo-sharing') {
        return Linking.createURL('/handle-share');
      }
      return url;
    },
    subscribe(listener: (url: string) => void) {
      const sub = Linking.addEventListener('url', ({ url }) => {
        if (url.startsWith('clawket://')) return;
        if (new URL(url).hostname === 'expo-sharing') {
          listener(Linking.createURL('/handle-share'));
        } else {
          listener(url);
        }
      });
      return () => sub.remove();
    },
  }), []);

  const rootConsoleModalScreenOptions = useConsoleRootModalScreenOptions();
  const rootModalScreenOptions = useMemo(() => {
    if (Platform.OS !== 'ios') {
      return {
        animation: 'slide_from_right' as const,
        contentStyle: { backgroundColor: theme.colors.background },
        headerShown: true,
      };
    }
    return {
      animation: 'slide_from_bottom' as const,
      presentation: 'modal' as const,
      contentStyle: { backgroundColor: theme.colors.background },
      gestureEnabled: true,
      headerShown: true,
    };
  }, [theme.colors.background]);

  return (
    <AppContextProvider value={appContextValue}>
    <GlobalLoadingOverlayProvider>
    <GatewayScannerProvider>
    <NodeCameraCaptureProvider>
      <NavigationContainer
        ref={rootNavigationRef}
        theme={navigationTheme}
        linking={shareIntentLinking}
        onReady={() => {
          setNavigationReady(true);
          trackInitialScreen();
        }}
        onStateChange={handleNavigationStateChange}
      >
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="MainTabs">
            {() => (
              <Tab.Navigator
                tabBarActiveTintColor={theme.colors.primary}
                tabBarInactiveTintColor={theme.colors.textMuted}
                {...(isWebViewScreen && Platform.OS === 'ios' ? {
                  tabBarStyle: { backgroundColor: theme.scheme === 'dark' ? '#000000' : '#FFFFFF' },
                } : {})}
                {...(Platform.OS === 'android' ? {
                  screenOptions: {
                    headerShown: false,
                    tabBarStyle: {
                      backgroundColor: isWebViewScreen ? (theme.scheme === 'dark' ? '#000000' : '#FFFFFF') : theme.colors.surface,
                      borderTopColor: theme.colors.border, height: 60, paddingTop: 8,
                    },
                    tabBarLabelStyle: { fontSize: 13, fontWeight: '600' as const },
                    tabBarIconStyle: { display: 'none' as const },
                  },
                } : {
                  screenOptions: {
                    sceneStyle: { backgroundColor: theme.colors.background },
                  },
                })}
              >
                <Tab.Screen
                  name="Chat"
                  component={ChatTab}
                  listeners={{
                    tabPress: () => {
                      hasUnreadChatRef.current = false;
                      setHasUnreadChat(false);
                    },
                  }}
                  options={{
                    tabBarLabel: t('Chat'),
                    tabBarBadge: hasUnreadChat ? '' : undefined,
                    ...(Platform.OS === 'ios' ? {
                      tabBarIcon: ({ focused }: { focused: boolean }) => ({ sfSymbol: focused ? 'message.fill' : 'message' }),
                    } : {}),
                  }}
                />
                <Tab.Screen
                  name="Office"
                  component={OfficeTab}
                  options={{
                    tabBarLabel: t('Office'),
                    lazy: officeLazy,
                    ...(Platform.OS === 'ios' ? {
                      tabBarIcon: ({ focused }: { focused: boolean }) => ({ sfSymbol: focused ? 'building.2.fill' : 'building.2' }),
                    } : {}),
                  }}
                />
                <Tab.Screen
                  name="Console"
                  component={ConsoleTab}
                  options={{
                    tabBarLabel: t('Console'),
                    ...(Platform.OS === 'ios' ? {
                      tabBarIcon: ({ focused }: { focused: boolean }) => ({ sfSymbol: focused ? 'terminal.fill' : 'terminal' }),
                    } : {}),
                  }}
                />
                <Tab.Screen
                  name="My"
                  component={ConfigTab}
                  options={{
                    tabBarLabel: t('Setting'),
                    ...(Platform.OS === 'ios' ? {
                      tabBarIcon: ({ focused }: { focused: boolean }) => ({ sfSymbol: focused ? 'gearshape.fill' : 'gearshape' }),
                    } : {}),
                  }}
                />
              </Tab.Navigator>
            )}
          </RootStack.Screen>
          <RootStack.Screen
            name="OpenClawPermissions"
            component={OpenClawPermissionsScreen}
            options={rootModalScreenOptions}
          />
          <React.Fragment>
            {renderConsoleModalScreens({
              ...rootConsoleModalScreenOptions,
              renderScreen: (name, component, options) => (
                <RootStack.Screen key={name} name={name} component={component} options={options} />
              ),
            })}
          </React.Fragment>
        </RootStack.Navigator>
      </NavigationContainer>
      <View
        pointerEvents={shouldShowOfficeWebView ? 'auto' : 'none'}
        style={shouldShowOfficeWebView
          ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: TAB_BAR_HEIGHT + insets.bottom }
          : { position: 'absolute', width: 1, height: 1, overflow: 'hidden' }
        }
      >
        <WebView
          ref={officeWebViewRef}
          source={officeSource}
          style={{ flex: 1, backgroundColor: 'transparent' }}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          javaScriptEnabled
          onMessage={(event: WebViewMessageEvent) => officeMessageHandlerRef.current?.(event)}
          onLoadStart={() => {
            officeWebViewLoadedRef.current = false;
          }}
          onLoadEnd={() => {
            officeWebViewLoadedRef.current = true;
            sendOfficeLocale();
            officeLoadEndHandlerRef.current?.();
          }}
          onError={(event: WebViewErrorEvent) => {
            officeDebugAppendRef.current?.(`❌ webview error: ${event.nativeEvent.description}`);
          }}
          onHttpError={(event: WebViewHttpErrorEvent) => {
            officeDebugAppendRef.current?.(`❌ webview http ${event.nativeEvent.statusCode}: ${event.nativeEvent.description}`);
          }}
          originWhitelist={['*']}
          contentInsetAdjustmentBehavior="never"
        />
      </View>
      {shouldShowOfficeWebView && !officeGuideVisible ? (
        <OfficeGuideButton
          top={Math.max(insets.top, 8) + 4}
          right={8}
          onPress={handleOpenOfficeGuide}
        />
      ) : null}
      <OfficeGuideOverlay
        visible={officeGuideVisible}
        onClose={handleCloseOfficeGuide}
      />
      <OfficeDebugOverlay />
      <GlobalGatewayOverlay />
      <GlobalProPaywallOverlay />
    </NodeCameraCaptureProvider>
    </GatewayScannerProvider>
    </GlobalLoadingOverlayProvider>
    </AppContextProvider>
  );
}

const DEBUG_LOG_LIMIT = 40;

function OfficeDebugOverlay(): React.JSX.Element | null {
  const { debugMode, isOfficeFocused, officeDebugAppendRef } = useAppContext();
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    officeDebugAppendRef.current = (msg: string) => {
      setLogs((prev) => [...prev.slice(-(DEBUG_LOG_LIMIT - 1)), `${new Date().toLocaleTimeString()} ${msg}`]);
    };
    return () => { officeDebugAppendRef.current = null; };
  }, [officeDebugAppendRef]);

  if (!debugMode || !isOfficeFocused || logs.length === 0) return null;

  return (
    <DebugOverlay
      logs={logs}
      style={{
        top: undefined,
        bottom: TAB_BAR_HEIGHT + insets.bottom + 8,
        zIndex: 9999,
      }}
    />
  );
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
