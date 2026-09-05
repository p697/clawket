import 'react-native-get-random-values';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { DeepLinkConfirmationModal } from './src/components/DeepLinkConfirmationModal';
import { ProPaywallOverlay } from './src/components/pro/ProPaywallOverlay';
import { loadAgentAvatars } from './src/services/agent-avatar';
import {
  getConnectionRuntime,
  loadConnectionIdentityDetail,
  useConnections,
} from './src/connection';
import {
  CAPABILITY_KEYS,
  resolveCapabilities,
  type Capabilities,
} from '@clawket/agent-protocol';
import { NodeClient } from './src/services/node-client';
import { dispatchNodeInvoke } from './src/services/node-invoke-dispatcher';
import {
  NodeCapabilityToggles,
  shouldStartNodeSidecar,
} from './src/services/node-capabilities';
import { shouldProbeGatewayOnForegroundResume } from './src/services/foregroundReconnectPolicy';
import { logAppTelemetry } from './src/services/app-telemetry';
import {
  extractChatNotificationOpenPayload,
  getChatNotificationResponseIdentifier,
  loadChatReplyNotificationsEnabled,
  scheduleChatReplyNotification,
  setChatReplyNotificationsEnabled,
  shouldShowChatReplyNotification,
} from './src/services/chat-notifications';
import { StorageService } from './src/services/storage';
import {
  clearAccountCache,
  resetAccountDevice,
} from './src/services/account-maintenance';
import { resolveGlobalMainSessionKey } from '@clawket/agent-protocol';
import {
  SessionPreferencesService,
  type AgentRosterPreferences,
} from './src/services/session-preferences';
import { analyticsEvents } from './src/services/analytics/events';
import {
  requestManualAppReview,
  scheduleAutomaticAppReviewForColdStart,
} from './src/services/auto-app-review';
import i18n from './src/i18n';
import {
  useDeepLinkHandler,
  type DeepLinkConfirmationRequest,
  type DeepLinkDeps,
} from './src/hooks/useDeepLinkHandler';
import { useProEntitlement } from './src/hooks/useProEntitlement';
import { usePostHogIdentity } from './src/hooks/usePostHogIdentity';
import { usePostHogScreenTracking } from './src/hooks/usePostHogScreenTracking';
import { ChatAppearanceSettings, SpeechRecognitionLanguage } from './src/types';
import type { AgentInfo } from './src/types/agent';
import { buildTheme, builtInAccents, defaultAccentId, useAppTheme } from './src/theme';
import { APP_PACKAGE_VERSION } from './src/constants/app-version';
import { getCurrentAppIconAsync, type AppIconVariant } from './src/services/app-icon';
import {
  getCurrentAppVersion,
  markCurrentAppUpdateAnnouncementShown,
  shouldShowCurrentAppUpdateAnnouncement,
} from './src/services/app-update-announcement';
import { AppProviders } from './src/bootstrap/AppProviders';
import { useAppBootstrap } from './src/bootstrap/useAppBootstrap';
import { getActiveLeafRouteName } from './src/utils/posthog-navigation';
import {
  extractAssistantDisplayText,
  isAssistantSilentReplyMessage,
  sanitizeSilentPreviewText,
} from './src/utils/chat-message';
import {
  resolveConnectedThreadTarget,
  resolveMainSessionKey,
} from './src/connection/session-scope';
import {
  canAddGatewayConnection,
  canCreateAgent as canCreateProAgent,
  canUseAgent,
  canUseConnection,
  isGraceActive,
  normalizeProFeature,
} from './src/utils/pro';
import type {
  AccountSettingsSection,
  AgentSettingsSection,
  RootStackParamList,
} from './src/navigation/root-stack';
import {
  buildRosterRows,
  isRosterAgentMuted,
  renameRosterSession,
  resolveRosterCreateAgentTarget,
  RosterScreen,
  type RosterDisplayRow,
} from './src/screens/Roster';
import {
  findPendingApprovalTarget,
  isApprovalScanFresh,
  remainingLaunchPaywallDelay,
  resolveStartupNavigation,
  type StartupThreadTarget,
} from './src/navigation/launch-paywall';
import {
  consumeAcceptedPaywallPresentation,
  PaywallContinuationCoordinator,
} from './src/navigation/paywall-continuation';
import { ThreadScreen } from './src/screens/Thread';
import {
  SessionPanel,
  type SessionPanelAction,
  type SessionPanelRow,
} from './src/screens/SessionPanel';
import {
  AgentSettingsRuntimeScreen,
  AgentSettingsRouteLoading,
  AgentSettingsSectionScreen,
  type AgentSettingsSectionActionResolver,
} from './src/screens/AgentSettings';
import {
  AccountSettingsScreen,
  AccountSettingsSectionScreen,
  ChatAppearanceScreen,
  ReleaseNotesHistoryScreen,
  resolveAccountSettingsRuntimeStatus,
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
  const [connectionRuntime] = useState(() => getConnectionRuntime());
  const connectionSnapshot = useConnections();
  const activeConnection = connectionSnapshot.connections.find(
    (connection) => connection.id === connectionSnapshot.activeConnectionId,
  ) ?? null;
  const [nodeClient] = useState(() => new NodeClient());
  const {
    accentId,
    chatFontSize,
    chatAppearance,
    debugMode,
    execApprovalEnabled,
    initialAgentId,
    initialChatPreview,
    loading,
    nodeCapabilityToggles,
    nodeEnabled,
    setAccentId,
    setChatFontSize,
    setChatAppearance,
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
  } = useAppBootstrap({
    nodeClient,
    connection: activeConnection,
    connectionsInitialized: connectionSnapshot.initialized,
  });

  useEffect(() => () => {
    void connectionRuntime.stop();
  }, [connectionRuntime]);

  useEffect(() => {
    void scheduleAutomaticAppReviewForColdStart();
  }, []);

  if (loading) {
    return (
      <View style={[loadingStyles.loading, { backgroundColor: LOADING_THEME.colors.canvas }]}>
        <ActivityIndicator size="large" color={LOADING_THEME.colors.accent} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <AppProviders
      mode={themeMode}
      accentId={accentId}
      onModeChange={setThemeMode}
      onAccentChange={setAccentId}
    >
      <ProPaywallProvider>
        <AppContent
          nodeClient={nodeClient}
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
        />
      </ProPaywallProvider>
    </AppProviders>
  );
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
  nodeClient: NodeClient;
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
};

function AppContent({
  nodeClient,
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
}: AppContentProps): React.JSX.Element {
  const { theme, mode: activeThemeMode, accentId: activeAccentId } = useAppTheme();
  const {
    isPro,
    isLoading: accountPermissionsLoading,
    visible: paywallVisible,
    hidePaywall,
    restorePurchases,
    showPaywall,
    showThreePointZeroIntro,
  } = useProPaywall();
  const connections = useConnections();
  const rootNavigationRef = useMemo(() => createNavigationContainerRef<RootStackParamList>(), []);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentAvatars, setAgentAvatars] = useState<Record<string, string>>({});
  const [currentAgentId, setCurrentAgentIdState] = useState<string>(initialAgentId ?? 'main');
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<string | null>(null);
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const activeRouteRef = useRef<keyof RootStackParamList>('Roster');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);

  // Load saved agent avatars on mount
  useEffect(() => { loadAgentAvatars().then(setAgentAvatars).catch(() => {}); }, []);
  const [chatSessionRequest, setChatSessionRequest] = useState<{
    sessionKey: string;
    requestedAt: number;
    sourceRole?: string;
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
  const [agentPreferences, setAgentPreferences] = useState<Readonly<
    Record<string, AgentRosterPreferences>
  >>({});
  const [replyNotificationsEnabled, setReplyNotificationsEnabled] = useState(false);
  const [currentAppIcon, setCurrentAppIcon] = useState<AppIconVariant>('default');
  const [navigationReady, setNavigationReady] = useState(false);
  const [activeRouteName, setActiveRouteName] = useState<keyof RootStackParamList | null>(null);
  const [rosterRenderedAt, setRosterRenderedAt] = useState<number | null>(null);
  const [pendingAutoOpen, setPendingAutoOpen] = useState<StartupThreadTarget | null>(null);
  const [startupAnnouncementLoading, setStartupAnnouncementLoading] = useState(true);
  const [threePointZeroIntroPending, setThreePointZeroIntroPending] = useState(false);
  const handledNotificationResponseIdsRef = useRef(new Set<string>());
  const launchPaywallPhaseRef = useRef<'idle' | 'opening' | 'visible'>('idle');
  const launchPaywallKindRef = useRef<Readonly<{
    kind: 'generic' | 'threePointZeroIntro';
    firstRun: boolean;
  }> | null>(null);
  const initialConnectionCountRef = useRef(connections.connections.length);
  const paywallContinuationCoordinatorRef = useRef(new PaywallContinuationCoordinator());
  const rosterViewTrackedRef = useRef(false);
  const presentPaywall = useCallback((
    feature: ProFeature,
    onContinue?: () => void | Promise<void>,
  ): boolean => {
    if (paywallVisible) return false;
    if (isPro) {
      if (onContinue) void Promise.resolve(onContinue()).catch(() => undefined);
      return false;
    }
    return paywallContinuationCoordinatorRef.current.tryPresent(
      () => showPaywall(feature),
      onContinue,
    );
  }, [isPro, paywallVisible, showPaywall]);
  const dismissPaywall = useCallback(() => {
    paywallContinuationCoordinatorRef.current.clear();
    hidePaywall();
  }, [hidePaywall]);
  const continueAfterPaywall = useCallback(() => {
    const continuation = paywallContinuationCoordinatorRef.current.take();
    if (continuation) void Promise.resolve(continuation()).catch(() => undefined);
  }, []);
  const {
    entitlement,
    loading: entitlementLoading,
    switching: freeConnectionSwitching,
    nextFreeConnectionSwitchAt,
    switchFreeConnection,
  } = useProEntitlement({
    isPro,
    subscriptionLoading: accountPermissionsLoading,
    connections: connections.connections,
    activeConnectionId: connections.activeConnectionId,
    registryFreeConnectionId: connections.freeConnectionId,
    roster: connections.roster,
    foregroundEpoch,
  });
  const permissionsLoading = accountPermissionsLoading || entitlementLoading;
  const canAddConnectionWithEntitlement = canAddGatewayConnection(
    connections.connections.length,
    entitlement,
  );
  const canAccessConnection = useCallback((connectionId: string) => {
    const connection = connections.connections.find(({ id }) => id === connectionId);
    return Boolean(connection && canUseConnection(connection, entitlement));
  }, [connections.connections, entitlement]);
  const canAccessRosterAgent = useCallback((connectionId: string, targetAgentId: string) => {
    const connection = connections.connections.find(({ id }) => id === connectionId);
    if (!connection) return false;
    if (entitlement.isPro) return true;
    const agent = connections.roster.find((group) => (
      group.connection.id === connectionId
    ))?.agents.find(({ agent: candidate }) => candidate.agentId === targetAgentId)?.agent;
    return Boolean(agent && canUseAgent(agent, connection, entitlement));
  }, [connections.connections, connections.roster, entitlement]);
  const rosterAnalyticsRows = useMemo(() => buildRosterRows(connections.roster, {
    pinnedSessionKeys,
    agentPreferences,
    canAccessAgent: canAccessRosterAgent,
  }), [agentPreferences, canAccessRosterAgent, connections.roster, pinnedSessionKeys]);
  const activeConnection = useMemo(() => connections.connections.find(
    (connection) => connection.id === connections.activeConnectionId,
  ) ?? null, [connections.activeConnectionId, connections.connections]);

  useEffect(() => {
    let active = true;
    void loadChatReplyNotificationsEnabled().then((enabled) => {
      if (active) setReplyNotificationsEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const version = getCurrentAppVersion();
    if (debugMode || !/^3\.0(?:\.|$)/.test(version)) {
      setStartupAnnouncementLoading(false);
      return () => {
        active = false;
      };
    }
    void (async () => {
      const shouldShow = await shouldShowCurrentAppUpdateAnnouncement(false);
      if (!shouldShow) return;
      if (initialConnectionCountRef.current === 0) {
        await markCurrentAppUpdateAnnouncementShown();
        return;
      }
      if (
        active
        && !getConnectionRuntime().getSnapshot().launchPaywallShownThisProcess
      ) {
        setThreePointZeroIntroPending(true);
      }
    })().catch(() => undefined).finally(() => {
      if (active) setStartupAnnouncementLoading(false);
    });
    return () => {
      active = false;
    };
  }, [debugMode]);

  useEffect(() => {
    let active = true;
    void getCurrentAppIconAsync().then((icon) => {
      if (active) setCurrentAppIcon(icon);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const preferenceScopes = useMemo(() => connections.roster.flatMap((group) => (
    group.agents.map(({ agent }) => ({
      connectionId: group.connection.id,
      agentId: agent.agentId,
    }))
  )), [connections.roster]);

  useEffect(() => {
    let active = true;
    void Promise.all(preferenceScopes.map(async ({ connectionId, agentId }) => {
      const preferences = await SessionPreferencesService.getAgentPreferences(connectionId, agentId);
      return [`${connectionId}:${agentId}`, preferences] as const;
    })).then((entries) => {
      if (!active) return;
      setAgentPreferences(Object.fromEntries(entries));
      setPinnedSessionKeys(Object.fromEntries(entries.map(([scope, preferences]) => (
        [scope, preferences.pinnedSessionKeys] as const
      ))));
    });
    return () => {
      active = false;
    };
  }, [preferenceScopes]);

  const { trackInitialScreen, trackScreenState, trackManualScreen } = usePostHogScreenTracking({
    rootNavigationRef,
    activeBackend: activeConnection?.backendKind,
  });
  const manualScreenVisibilityRef = useRef({ sessionPanel: false, paywall: false });

  useEffect(() => {
    if (sessionPanelVisible && !manualScreenVisibilityRef.current.sessionPanel) {
      trackManualScreen('SessionPanel');
    }
    manualScreenVisibilityRef.current.sessionPanel = sessionPanelVisible;
  }, [sessionPanelVisible, trackManualScreen]);

  useEffect(() => {
    if (paywallVisible && !manualScreenVisibilityRef.current.paywall) {
      trackManualScreen('Paywall');
    }
    manualScreenVisibilityRef.current.paywall = paywallVisible;
  }, [paywallVisible, trackManualScreen]);

  const activeAdapter = connections.activeAdapter;
  const activeCapabilities = activeAdapter?.capabilities
    ?? (activeConnection ? resolveCapabilities(activeConnection.backendKind) : NO_CAPABILITIES);

  useEffect(() => {
    if (entitlementLoading || entitlement.isPro || isGraceActive(entitlement)) return;
    if (!activeConnection || canUseConnection(activeConnection, entitlement)) return;
    const freeConnectionId = entitlement.freeConnectionId;
    if (!freeConnectionId || freeConnectionId === activeConnection.id) return;
    void getConnectionRuntime().activate(freeConnectionId).catch(() => undefined);
  }, [activeConnection, entitlement, entitlementLoading]);

  usePostHogIdentity({
    connections: connections.connections,
    activeConnectionId: connections.activeConnectionId,
    isPro,
    graceActive: isGraceActive(entitlement),
  });

  const handleNavigationStateChange = useCallback((state: NavigationState | undefined) => {
    if (!state) return;
    trackScreenState(state);
    const routeName = getActiveLeafRouteName(state);
    if (routeName) {
      activeRouteRef.current = routeName as keyof RootStackParamList;
      setActiveRouteName(routeName as keyof RootStackParamList);
    }
  }, [trackScreenState]);

  useEffect(() => {
    if (activeRouteName !== 'Roster') {
      rosterViewTrackedRef.current = false;
      return;
    }
    if (
      rosterViewTrackedRef.current
      || !connections.initialized
      || (connections.connections.length > 0 && connections.roster.length === 0)
    ) {
      return;
    }
    rosterViewTrackedRef.current = true;
    analyticsEvents.rosterViewed({
      connection_count: connections.connections.length,
      agent_count: connections.roster.reduce((total, group) => total + group.agents.length, 0),
      pinned_count: rosterAnalyticsRows.filter((row) => row.kind === 'pinned_session').length,
      unread_count: connections.roster.reduce((total, group) => (
        total + group.agents.reduce((subtotal, summary) => subtotal + summary.unreadCount, 0)
      ), 0),
      attention_count: connections.roster.reduce((total, group) => (
        total + group.agents.reduce((subtotal, summary) => subtotal + summary.attentionCount, 0)
      ), 0),
    });
  }, [
    activeRouteName,
    connections.connections.length,
    connections.initialized,
    connections.roster,
    rosterAnalyticsRows,
  ]);

  const mainSessionKey = useMemo(
    () => resolveMainSessionKey(currentAgentId, {
      mainSessionKey: resolveGlobalMainSessionKey(activeConnection?.backendKind),
    }),
    [activeConnection?.backendKind, currentAgentId],
  );
  const isMultiAgent = agents.length > 1;

  const setCurrentAgentId = useCallback((id: string) => {
    setCurrentAgentIdState(id);
    StorageService.setCurrentAgentId(id);
  }, []);

  useEffect(() => {
    if (!activeConnection || entitlementLoading) return;
    const group = connections.roster.find(({ connection }) => connection.id === activeConnection.id);
    const currentAgent = group?.agents.find(({ agent }) => agent.agentId === currentAgentId)?.agent;
    if (!currentAgent || canUseAgent(currentAgent, activeConnection, entitlement)) return;
    const accessibleMain = group?.agents.find(({ agent }) => (
      agent.isMain && canUseAgent(agent, activeConnection, entitlement)
    ))?.agent.agentId;
    if (!accessibleMain || accessibleMain === currentAgentId) return;
    setCurrentAgentIdState(accessibleMain);
    StorageService.setCurrentAgentId(accessibleMain);
  }, [
    activeConnection,
    connections.roster,
    currentAgentId,
    entitlement,
    entitlementLoading,
  ]);

  const switchAgent = useCallback((id: string) => {
    setCurrentAgentIdState(id);
    StorageService.setCurrentAgentId(id);
    setPendingAgentSwitch(id);
  }, []);

  const clearPendingAgentSwitch = useCallback(() => {
    setPendingAgentSwitch(null);
  }, []);

  // Refresh device-local avatar state once the single active adapter becomes ready.
  const prevReadyRef = useRef(true);
  useEffect(() => {
    if (connections.activeState === 'ready') {
      if (!prevReadyRef.current) {
        loadAgentAvatars().then(setAgentAvatars).catch(() => {});
      }
      prevReadyRef.current = true;
      return;
    }
    prevReadyRef.current = false;
  }, [connections.activeConnectionId, connections.activeState]);

  // Ask the coordinator to verify the only live transport after foreground resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      logAppTelemetry('app_lifecycle', 'app_state_change', {
        prevState,
        nextState,
        hasGatewayConfig: Boolean(connections.activeConnectionId),
        connectionState: connections.activeState,
      });

      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (nextState !== 'active' || prevState === 'active') return;
      if (!connections.activeConnectionId || !activeAdapter) return;

      const awayMs = backgroundedAtRef.current ? Date.now() - backgroundedAtRef.current : 0;
      backgroundedAtRef.current = null;
      setForegroundEpoch((prev) => prev + 1);
      const state = connections.activeState;
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
        void getConnectionRuntime().probeActive(undefined, 'foreground');
      }
    });
    return () => sub.remove();
  }, [activeAdapter, connections.activeConnectionId, connections.activeState]);

  // The node sidecar receives a defensive credential clone from the registry;
  // credentials never enter the React connection snapshot.
  useEffect(() => {
    let cancelled = false;
    nodeClient.setCapabilityToggles(nodeCapabilityToggles);
    nodeClient.disconnect();
    nodeClient.configure(null);

    const connectionId = connections.activeConnectionId;
    if (!connectionId || !shouldStartNodeSidecar({
      activeConnectionId: connectionId,
      activeState: connections.activeState,
      nodeEnabled,
      supportsNodes: activeAdapter?.capabilities.nodes === true,
    })) {
      return () => {
        cancelled = true;
        nodeClient.disconnect();
      };
    }

    void getConnectionRuntime().getRuntimeConnectionRecord(connectionId)
      .then((record) => {
        if (cancelled) return;
        nodeClient.configure(record);
        nodeClient.connect();
      })
      .catch(() => {
        if (cancelled) return;
        nodeClient.configure(null);
        nodeClient.disconnect();
      });

    return () => {
      cancelled = true;
      nodeClient.disconnect();
    };
  }, [
    activeAdapter,
    connections.activeConnectionId,
    connections.activeState,
    connections.connectionsRevision,
    nodeCapabilityToggles,
    nodeClient,
    nodeEnabled,
  ]);

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
    if (
      Platform.OS !== 'ios'
      || !activeCapabilities.chat
      || activeCapabilities.replyNotifications !== true
    ) return;

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
  }, [activeCapabilities.chat, activeCapabilities.replyNotifications, openChatFromNotification]);

  useEffect(() => {
    if (
      Platform.OS !== 'ios'
      || !activeAdapter
      || !activeCapabilities.chat
      || activeCapabilities.replyNotifications !== true
    ) return;

    const off = activeAdapter.on('update', (update) => {
      if (update.type !== 'run_finished' || !update.message) return;
      const { sessionKey, message, runId } = update;
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

      const targetAgentId = agentIdFromSessionKey(sessionKey) ?? currentAgentId;
      if (!connections.activeConnectionId
        || !canAccessRosterAgent(connections.activeConnectionId, targetAgentId)) {
        return;
      }
      if (isRosterAgentMuted({
        preferences: agentPreferences,
        connectionId: connections.activeConnectionId,
        agentId: targetAgentId,
      })) {
        return;
      }
      const agentId = targetAgentId || undefined;
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
  }, [
    activeAdapter,
    activeCapabilities.chat,
    activeCapabilities.replyNotifications,
    agentPreferences,
    agents,
    canAccessRosterAgent,
    connections.activeConnectionId,
    currentAgentId,
  ]);

  useEffect(() => {
    if (entitlementLoading || !navigationReady || !pendingChatNotificationOpen) return;
    if (!rootNavigationRef.isReady()) return;
    if (!connections.activeConnectionId) return;
    const targetAgentId = pendingChatNotificationOpen.agentId
      ?? agentIdFromSessionKey(pendingChatNotificationOpen.sessionKey)
      ?? currentAgentId;
    if (!canAccessRosterAgent(connections.activeConnectionId, targetAgentId)) {
      const target: RootStackParamList['Thread'] = {
        connectionId: connections.activeConnectionId,
        agentId: targetAgentId,
        sessionKey: pendingChatNotificationOpen.sessionKey,
        from: 'notification',
      };
      setPendingChatNotificationOpen(null);
      presentPaywall(
        canAccessConnection(connections.activeConnectionId)
          ? 'agents'
          : 'gatewayConnections',
        () => {
          if (rootNavigationRef.isReady()) rootNavigationRef.navigate('Thread', target);
        },
      );
      return;
    }
    rootNavigationRef.navigate('Thread', {
      connectionId: connections.activeConnectionId,
      agentId: targetAgentId,
      sessionKey: pendingChatNotificationOpen.sessionKey,
      from: 'notification',
    });
  }, [
    canAccessConnection,
    canAccessRosterAgent,
    connections.activeConnectionId,
    currentAgentId,
    entitlementLoading,
    navigationReady,
    pendingChatNotificationOpen,
    rootNavigationRef,
    presentPaywall,
  ]);

  const appContextValue = useMemo(
    () => ({
      foregroundEpoch,
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
        if (!connections.activeConnectionId
          || !canAccessRosterAgent(connections.activeConnectionId, currentAgentId)) {
          if (connections.activeConnectionId) {
            presentPaywall(canAccessConnection(connections.activeConnectionId)
              ? 'agents'
              : 'gatewayConnections');
          }
          return;
        }
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
        if (!canAddConnectionWithEntitlement) {
          presentPaywall('gatewayConnections', () => setPendingAddGateway(true));
          return;
        }
        setPendingAddGateway(true);
      },
      clearPendingAddGateway: () => {
        setPendingAddGateway(false);
      },
      onSpeechRecognitionLanguageChange,
    }),
    [
      agentAvatars,
      agents,
      chatAppearance,
      chatFontSize,
      canAddConnectionWithEntitlement,
      canAccessConnection,
      canAccessRosterAgent,
      connections.activeConnectionId,
      currentAgentId,
      debugMode,
      execApprovalEnabled,
      showAgentAvatar,
      presentPaywall,
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
        primary: theme.colors.accent,
        background: theme.colors.canvas,
        card: theme.colors.surface,
        text: theme.colors.ink,
        border: theme.colors.line,
        notification: theme.colors.accent,
      },
    };
  }, [theme]);

  const settingsConnections = useMemo(() => connections.connections.map((connection) => ({
    ...connection,
    locked: !canUseConnection(connection, entitlement),
  })), [connections.connections, entitlement]);
  const canAddSettingsConnection = canAddConnectionWithEntitlement;
  const accountSettingsStatus = useMemo(() => resolveAccountSettingsRuntimeStatus({
    connectionInitialized: connections.initialized,
    connectionSwitching: connections.switching,
    connectionCount: settingsConnections.length,
    activeConnectionId: connections.activeConnectionId,
    activeState: connections.activeState,
    connectionErrorCode: connections.error?.operation,
    permissionsLoading,
    permissionReason: canAddSettingsConnection ? null : 'gatewayConnections',
  }), [
    permissionsLoading,
    canAddSettingsConnection,
    connections.activeConnectionId,
    connections.activeState,
    connections.error?.operation,
    connections.initialized,
    connections.switching,
    settingsConnections.length,
  ]);

  const accountSettingsLabels = useMemo(() => {
    const themeLabels = {
      system: i18n.t('Follow System', { ns: 'config' }),
      light: i18n.t('Light', { ns: 'config' }),
      dark: i18n.t('Dark', { ns: 'config' }),
    } as const;
    const accentLabels = {
      iceBlue: i18n.t('Blue', { ns: 'config' }),
      jadeGreen: i18n.t('Green', { ns: 'config' }),
      oceanTeal: i18n.t('Teal', { ns: 'config' }),
      sunsetOrange: i18n.t('Orange', { ns: 'config' }),
      rosePink: i18n.t('Pink', { ns: 'config' }),
      royalPurple: i18n.t('Purple', { ns: 'config' }),
    } as const;
    const speechLabels = {
      system: i18n.t('Follow System', { ns: 'config' }),
      en: i18n.t('English', { ns: 'config' }),
      'zh-Hans': i18n.t('Simplified Chinese', { ns: 'config' }),
      ja: i18n.t('Japanese', { ns: 'config' }),
      ko: i18n.t('Korean', { ns: 'config' }),
      de: i18n.t('German', { ns: 'config' }),
      es: i18n.t('Spanish', { ns: 'config' }),
    } as const;
    const appearanceLabels = {
      solid: i18n.t('Solid', { ns: 'config' }),
      soft: i18n.t('Soft', { ns: 'config' }),
      glass: i18n.t('Glass', { ns: 'config' }),
    } as const;
    return {
      theme: themeLabels[activeThemeMode],
      accent: accentLabels[activeAccentId],
      chatAppearance: appearanceLabels[chatAppearance.bubbles.style],
      appIcon: i18n.t(currentAppIcon === 'black' ? 'Dark' : 'Light', { ns: 'config' }),
      speechLanguage: speechLabels[speechRecognitionLanguage],
      appVersion: APP_PACKAGE_VERSION,
      previewEnvironment: i18n.t(debugMode ? 'Preview' : 'Production', { ns: 'config' }),
    };
  }, [
    activeAccentId,
    activeThemeMode,
    chatAppearance.bubbles.style,
    currentAppIcon,
    debugMode,
    speechRecognitionLanguage,
  ]);

  const settingsSectionConnections = useMemo(() => settingsConnections.map((connection) => ({
    ...connection,
    state: connection.id === connections.activeConnectionId ? connections.activeState : 'idle' as const,
    supportsRelayStats: connection.transportKind === 'relay',
    isFreeConnection: connection.id === entitlement.freeConnectionId,
    freeSwitchAvailable: nextFreeConnectionSwitchAt === null
      || entitlement.now >= nextFreeConnectionSwitchAt,
    freeSwitchStatus: nextFreeConnectionSwitchAt !== null
      && entitlement.now < nextFreeConnectionSwitchAt
      ? i18n.t('Available {{time}}', {
          ns: 'config',
          time: new Date(nextFreeConnectionSwitchAt).toLocaleString(i18n.language),
        })
      : undefined,
    freeSwitching: freeConnectionSwitching,
  })), [
    connections.activeConnectionId,
    connections.activeState,
    entitlement.freeConnectionId,
    entitlement.now,
    freeConnectionSwitching,
    nextFreeConnectionSwitchAt,
    settingsConnections,
  ]);

  const graceDaysLeft = isGraceActive(entitlement)
    ? Math.max(1, Math.ceil(((entitlement.graceUntil ?? entitlement.now) - entitlement.now)
      / (24 * 60 * 60 * 1_000)))
    : null;
  const rosterGraceBanner = graceDaysLeft === null ? undefined : {
    message: i18n.t('{{count}} days of Pro access left', {
      ns: 'common',
      count: graceDaysLeft,
    }),
    actionLabel: i18n.t('View Pro', { ns: 'common' }),
  };
  const graceAnalyticsRef = useRef<{
    graceUntil: number | null;
    wasActive: boolean | null;
    viewedFor: number | null;
  }>({ graceUntil: null, wasActive: null, viewedFor: null });
  useEffect(() => {
    if (entitlementLoading) return;
    const active = isGraceActive(entitlement);
    const previous = graceAnalyticsRef.current;
    if (active && entitlement.graceUntil !== null && previous.viewedFor !== entitlement.graceUntil) {
      analyticsEvents.graceBannerViewed({ days_left: graceDaysLeft ?? 1 });
      previous.viewedFor = entitlement.graceUntil;
    }
    if (previous.wasActive === true && !active) {
      analyticsEvents.graceExpired({ days_left: 0 });
    }
    previous.graceUntil = entitlement.graceUntil;
    previous.wasActive = active;
  }, [entitlement, entitlementLoading, graceDaysLeft]);

  const pendingApprovalTarget = useMemo(() => findPendingApprovalTarget(
    connections.roster,
    connections.activeConnectionId,
  ), [connections.activeConnectionId, connections.roster]);
  const activeRosterGroup = connections.roster.find((group) => (
    group.connection.id === connections.activeConnectionId
  ));
  const activeConnectionReadyAt = connections.activeConnectionId
    ? connections.connectionDetails[connections.activeConnectionId]?.lastReadyAt ?? null
    : null;
  const approvalScanReady = isApprovalScanFresh(
    activeRosterGroup?.source,
    activeRosterGroup?.syncedAt,
    activeConnectionReadyAt,
  );

  useEffect(() => {
    if (activeRouteName === 'Roster' && rosterRenderedAt === null) {
      setRosterRenderedAt(Date.now());
    }
  }, [activeRouteName, rosterRenderedAt]);

  const openStartupThread = useCallback((target: StartupThreadTarget) => {
    if (!rootNavigationRef.isReady()) return;
    activeRouteRef.current = 'Thread';
    setActiveRouteName('Thread');
    setPendingAutoOpen(null);
    rootNavigationRef.navigate('Thread', target);
  }, [rootNavigationRef]);

  useEffect(() => {
    if (!navigationReady || activeRouteName !== 'Roster') return;
    if (paywallVisible || launchPaywallPhaseRef.current !== 'idle') return;

    const action = resolveStartupNavigation({
      rosterRendered: rosterRenderedAt !== null,
      approvalScanReady,
      activeState: connections.activeState,
      subscriptionLoading: permissionsLoading || startupAnnouncementLoading,
      isPro,
      launchPaywallShownThisProcess: connections.launchPaywallShownThisProcess,
      pendingAutoOpen,
      pendingApproval: pendingApprovalTarget,
      threePointZeroIntroPending,
    });

    if (action.type === 'open_thread') {
      if (action.skipLaunchPaywall) {
        getConnectionRuntime().markLaunchPaywallShown();
        setThreePointZeroIntroPending(false);
        openStartupThread(action.target);
        return;
      }
    }
    if (action.type === 'show_three_point_zero_intro') {
      consumeAcceptedPaywallPresentation(showThreePointZeroIntro, () => {
        getConnectionRuntime().markLaunchPaywallShown();
        setThreePointZeroIntroPending(false);
        launchPaywallKindRef.current = { kind: 'threePointZeroIntro', firstRun: false };
        launchPaywallPhaseRef.current = 'opening';
        void markCurrentAppUpdateAnnouncementShown().catch(() => undefined);
      });
      return;
    }
    if (action.type === 'open_thread') {
      openStartupThread(action.target);
      return;
    }
    if (action.type !== 'show_launch_paywall') return;

    const firstRun = pendingAutoOpen?.from === 'onboarding';
    const timer = setTimeout(() => {
      if (activeRouteRef.current !== 'Roster') return;
      const runtime = getConnectionRuntime();
      const latest = runtime.getSnapshot();
      if (latest.activeState !== 'ready' || latest.launchPaywallShownThisProcess) return;
      const latestReadyAt = latest.activeConnectionId
        ? latest.connectionDetails[latest.activeConnectionId]?.lastReadyAt ?? null
        : null;
      const latestRosterGroup = latest.roster.find((group) => (
        group.connection.id === latest.activeConnectionId
      ));
      if (!isApprovalScanFresh(
        latestRosterGroup?.source,
        latestRosterGroup?.syncedAt,
        latestReadyAt,
      )) return;
      const latestApprovalTarget = findPendingApprovalTarget(
        latest.roster,
        latest.activeConnectionId,
      );
      if (latestApprovalTarget) {
        runtime.markLaunchPaywallShown();
        setThreePointZeroIntroPending(false);
        openStartupThread(latestApprovalTarget);
        return;
      }
      consumeAcceptedPaywallPresentation(() => presentPaywall('launch'), () => {
        if (!runtime.markLaunchPaywallShown()) return;
        launchPaywallKindRef.current = { kind: 'generic', firstRun };
        launchPaywallPhaseRef.current = 'opening';
        analyticsEvents.paywallLaunchShown({ variant: 'generic', first_run: firstRun });
      });
    }, remainingLaunchPaywallDelay(
      Date.now(),
      activeConnectionReadyAt,
      rosterRenderedAt,
    ));
    return () => clearTimeout(timer);
  }, [
    activeRouteName,
    activeConnectionReadyAt,
    approvalScanReady,
    connections.activeState,
    connections.launchPaywallShownThisProcess,
    isPro,
    navigationReady,
    openStartupThread,
    paywallVisible,
    pendingApprovalTarget,
    pendingAutoOpen,
    permissionsLoading,
    presentPaywall,
    rosterRenderedAt,
    showThreePointZeroIntro,
    startupAnnouncementLoading,
    threePointZeroIntroPending,
  ]);

  useEffect(() => {
    const phase = launchPaywallPhaseRef.current;
    if (phase === 'opening' && paywallVisible) {
      launchPaywallPhaseRef.current = 'visible';
      return;
    }
    if (phase === 'opening' && isPro) {
      launchPaywallPhaseRef.current = 'idle';
      launchPaywallKindRef.current = null;
      if (pendingAutoOpen) openStartupThread(pendingAutoOpen);
      return;
    }
    if (phase !== 'visible' || paywallVisible) return;
    launchPaywallPhaseRef.current = 'idle';
    const launch = launchPaywallKindRef.current;
    launchPaywallKindRef.current = null;
    if (launch?.kind === 'generic') {
      analyticsEvents.paywallLaunchClosed({
        variant: 'generic',
        first_run: launch.firstRun,
      });
    }
    if (pendingAutoOpen) openStartupThread(pendingAutoOpen);
  }, [isPro, openStartupThread, paywallVisible, pendingAutoOpen]);

  const handleToggleRosterAgentPinned = useCallback(async (row: RosterDisplayRow) => {
    if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
      presentPaywall(canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections');
      return;
    }
    const scope = `${row.connectionId}:${row.agentId}`;
    const preferences = await SessionPreferencesService.toggleAgentPinned(
      row.connectionId,
      row.agentId,
    );
    setAgentPreferences((current) => ({ ...current, [scope]: preferences }));
    analyticsEvents.rosterPinToggled({
      action: row.agentPinned ? 'unpin' : 'pin',
      kind: 'agent',
    });
  }, [canAccessConnection, canAccessRosterAgent, presentPaywall]);

  const handleToggleRosterAgentMuted = useCallback(async (row: RosterDisplayRow) => {
    if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
      presentPaywall(canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections');
      return;
    }
    const scope = `${row.connectionId}:${row.agentId}`;
    const preferences = await SessionPreferencesService.toggleAgentMuted(
      row.connectionId,
      row.agentId,
    );
    setAgentPreferences((current) => ({ ...current, [scope]: preferences }));
  }, [canAccessConnection, canAccessRosterAgent, presentPaywall]);

  const handleRosterSessionUnpin = useCallback(async (row: RosterDisplayRow) => {
    if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
      presentPaywall(canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections');
      return;
    }
    const scope = `${row.connectionId}:${row.agentId}`;
    const keys = await SessionPreferencesService.setPinnedSession(
      row.connectionId,
      row.agentId,
      row.sessionKey,
      false,
    );
    setPinnedSessionKeys((current) => ({ ...current, [scope]: keys }));
    analyticsEvents.rosterPinToggled({ action: 'unpin', kind: 'session' });
  }, [canAccessConnection, canAccessRosterAgent, presentPaywall]);

  const handleRosterSessionRename = useCallback(async (
    row: RosterDisplayRow,
    title: string,
  ) => {
    if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
      presentPaywall(canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections');
      return;
    }
    const adapter = getConnectionRuntime().getAdapter(row.connectionId);
    await renameRosterSession({
      adapter,
      row,
      title,
      refreshRoster: () => getConnectionRuntime().refreshRoster(),
    });
  }, [canAccessConnection, canAccessRosterAgent, presentPaywall]);

  const handleRosterConnectionRemove = useCallback(async (row: RosterDisplayRow) => {
    const wasLastConnection = connections.connections.length === 1;
    const removed = await getConnectionRuntime().removeConnection(row.connectionId);
    if (!removed || !wasLastConnection || !rootNavigationRef.isReady()) return;
    rootNavigationRef.reset({
      index: 0,
      routes: [{ name: 'Onboarding', params: { presentation: 'root' } }],
    });
  }, [connections.connections.length, rootNavigationRef]);

  const handleSessionAction = useCallback(async (
    row: SessionPanelRow,
    action: SessionPanelAction,
    payload?: { title: string },
  ) => {
    if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
      presentPaywall(canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections');
      return;
    }
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
  }, [canAccessConnection, canAccessRosterAgent, presentPaywall]);

  const openExternalUrl = useCallback((url: string | null | undefined) => {
    if (url) void Linking.openURL(url).catch(() => undefined);
  }, []);

  const updateReplyNotifications = useCallback((enabled: boolean) => {
    setReplyNotificationsEnabled(enabled);
    void setChatReplyNotificationsEnabled(enabled).catch(() => {
      setReplyNotificationsEnabled(!enabled);
    });
  }, []);

  const handleAccountSectionAction = useCallback((
    request: AccountSettingsSectionActionRequest,
    navigation: { navigate: typeof rootNavigationRef.navigate },
  ) => {
    switch (request.action) {
      case 'set-reply-notifications':
        updateReplyNotifications(request.enabled === true);
        return;
      case 'set-debug-mode':
        onDebugToggle(request.enabled === true);
        return;
      case 'view-pro':
        presentPaywall('settingsMembershipPreview');
        return;
      case 'restore-purchases':
        void restorePurchases();
        return;
      case 'add-connection':
        navigation.navigate('Onboarding', { presentation: 'modal' });
        return;
      case 'chat-appearance':
        navigation.navigate('ChatAppearance');
        return;
      case 'release-notes':
        navigation.navigate('ReleaseNotes');
        return;
      case 'reconnect-connection':
        if (request.connectionId) {
          void getConnectionRuntime().activate(request.connectionId)
            .then(() => getConnectionRuntime().probeActive());
        }
        return;
      case 'set-free-connection':
        if (request.connectionId) {
          void switchFreeConnection(request.connectionId).then(async (result) => {
            if (result.ok) {
              if (result.changed) await getConnectionRuntime().activate(request.connectionId!);
              return;
            }
            Alert.alert(
              i18n.t('Unable to switch free connection', { ns: 'config' }),
              result.reason === 'cooldown' && result.retryAt !== null
                ? i18n.t('You can switch again at {{time}}.', {
                    ns: 'config',
                    time: new Date(result.retryAt).toLocaleString(i18n.language),
                  })
                : i18n.t('Please try again later.', { ns: 'common' }),
            );
          }).catch(() => {
            Alert.alert(
              i18n.t('Unable to switch free connection', { ns: 'config' }),
              i18n.t('Please try again later.', { ns: 'common' }),
            );
          });
        }
        return;
      case 'remove-connection':
        if (request.connectionId) {
          const wasLastConnection = connections.connections.length === 1;
          void getConnectionRuntime().removeConnection(request.connectionId).then((removed) => {
            if (removed && wasLastConnection && rootNavigationRef.isReady()) {
              rootNavigationRef.reset({
                index: 0,
                routes: [{ name: 'Onboarding', params: { presentation: 'root' } }],
              });
            }
          });
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
      case 'rate':
        void requestManualAppReview().then((result) => {
          analyticsEvents.appRatingTapped({ source: 'config_support', result });
          if (result === 'unavailable' || result === 'error') {
            Alert.alert(
              i18n.t('Unable to open rating', { ns: 'config' }),
              i18n.t('Rating is temporarily unavailable on this device. Please try again later.', {
                ns: 'config',
              }),
            );
          }
        });
        return;
      case 'clear-cache':
        void clearAccountCache().then(() => {
          Alert.alert(
            i18n.t('Done', { ns: 'common' }),
            i18n.t('Cache cleared.', { ns: 'config' }),
          );
        });
        return;
      case 'reset-device':
        void (async () => {
          const runtime = getConnectionRuntime();
          await resetAccountDevice({
            connectionIds: connections.connections.map((connection) => connection.id),
            removeConnection: (connectionId) => runtime.removeConnection(connectionId),
          });
          if (rootNavigationRef.isReady()) {
            rootNavigationRef.reset({
              index: 0,
              routes: [{ name: 'Onboarding', params: { presentation: 'root' } }],
            });
          }
        })();
        return;
      default:
        return;
    }
  }, [
    connections.connections,
    onDebugToggle,
    openExternalUrl,
    restorePurchases,
    rootNavigationRef.navigate,
    presentPaywall,
    switchFreeConnection,
    updateReplyNotifications,
  ]);

  const resolveAgentSettingsAction = useCallback<AgentSettingsSectionActionResolver>(async (
    request,
    context,
  ) => {
    if (request.action === 'connection.reconnect') {
      if (!canAccessRosterAgent(context.connection.id, context.agent.agentId)) {
        presentPaywall(
          canAccessConnection(context.connection.id) ? 'agents' : 'gatewayConnections',
          async () => {
            await getConnectionRuntime().activate(context.connection.id);
            await getConnectionRuntime().probeActive();
          },
        );
        return;
      }
      await getConnectionRuntime().activate(context.connection.id);
      await getConnectionRuntime().probeActive();
      return;
    }
    if (request.action === 'connection.remove') {
      const removed = await getConnectionRuntime().removeConnection(context.connection.id);
      if (!removed || !rootNavigationRef.isReady()) return;
      if (connections.connections.length === 1) {
        rootNavigationRef.reset({
          index: 0,
          routes: [{ name: 'Onboarding', params: { presentation: 'root' } }],
        });
        return;
      }
      rootNavigationRef.navigate('Roster');
    }
  }, [
    canAccessConnection,
    canAccessRosterAgent,
    connections.connections.length,
    rootNavigationRef,
    presentPaywall,
  ]);

  if (!connections.initialized) {
    return (
      <View style={[loadingStyles.loading, { backgroundColor: theme.colors.canvas }]}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      </View>
    );
  }

  return (
    <AppContextProvider value={appContextValue}>
      <GlobalLoadingOverlayProvider>
        <GatewayScannerProvider>
          {!permissionsLoading ? (
            <AppDeepLinkHandler
              rootNavigationRef={rootNavigationRef}
              activeConnectionId={connections.activeConnectionId}
              activeAdapter={connections.activeAdapter}
              currentAgentId={currentAgentId}
              mainSessionKey={mainSessionKey}
              canAddConnection={canAddSettingsConnection}
              activeAccessDeniedReason={activeConnection && !canAccessConnection(activeConnection.id)
                ? 'gatewayConnections'
                : activeConnection && !canAccessRosterAgent(activeConnection.id, currentAgentId)
                  ? 'agents'
                  : null}
              onOpenPaywall={presentPaywall}
            />
          ) : null}
          <NodeCameraCaptureProvider>
            <NavigationContainer
              ref={rootNavigationRef}
              theme={navigationTheme}
              onReady={() => {
                setNavigationReady(true);
                const routeName = rootNavigationRef.getCurrentRoute()?.name;
                if (routeName) {
                  activeRouteRef.current = routeName;
                  setActiveRouteName(routeName);
                }
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
                      onViewed={() => analyticsEvents.onboardingViewed({
                        source: props.route.params?.presentation === 'modal'
                          ? 'add_connection'
                          : 'first_run',
                      })}
                      onPairingCodeSubmitted={({ lengthOk }) => {
                        analyticsEvents.pairingCodeSubmitted({ length_ok: lengthOk });
                      }}
                      onDocsOpened={(backend) => analyticsEvents.onboardingDocsOpened({ backend })}
                      onScanQrTapped={() => analyticsEvents.gatewayScanQrTapped({
                        source: props.route.params?.presentation === 'modal'
                          ? 'add_connection'
                          : 'first_run',
                      })}
                      onOpenPaywall={(reason, onContinue) => presentPaywall(reason, onContinue)}
                      onConnected={({ connectionId, backendKind }) => {
                        const rosterGroup = getConnectionRuntime().getSnapshot().roster.find((group) => (
                          group.connection.id === connectionId
                        ));
                        const target = resolveConnectedThreadTarget(
                          backendKind,
                          rosterGroup?.agents.map((summary) => summary.agent),
                        );
                        setCurrentAgentId(target.agentId);
                        setPendingAutoOpen({
                          connectionId,
                          agentId: target.agentId,
                          sessionKey: target.sessionKey,
                          from: 'onboarding',
                        });
                        props.navigation.reset({
                          index: 0,
                          routes: [{ name: 'Roster' }],
                        });
                      }}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="Roster">
                  {({ navigation }) => (
                    <RosterScreen
                      pinnedSessionKeys={pinnedSessionKeys}
                      agentPreferences={agentPreferences}
                      canAccessAgent={canAccessRosterAgent}
                      graceBanner={rosterGraceBanner}
                      canCreateAgent={activeCapabilities.agentCreate === true
                        && Boolean(activeAdapter?.management?.agents?.create)}
                      canRenamePinnedSession={connections.activeState === 'ready'
                        && activeCapabilities.sessionRename === true
                        && Boolean(activeAdapter?.patchSession)}
                      isPro={isPro}
                      onOpenAccount={() => navigation.navigate('AccountSettings')}
                      onSearch={() => navigation.navigate('Search')}
                      onAdd={() => {
                        if (!canAddSettingsConnection) {
                          presentPaywall('gatewayConnections', () => {
                            navigation.navigate('Onboarding', { presentation: 'modal' });
                          });
                          return;
                        }
                        navigation.navigate('Onboarding', { presentation: 'modal' });
                      }}
                      onCreateAgent={() => {
                        const target = resolveRosterCreateAgentTarget({
                          activeConnectionId: connections.activeConnectionId,
                          currentAgentId,
                          roster: connections.roster,
                        });
                        if (!target) return;
                        const openCreateAgent = () => navigation.navigate('AgentSettingsSection', {
                          connectionId: target.connectionId,
                          agentId: target.agentId,
                          section: 'identity',
                          action: 'create-agent',
                        });
                        if (!canCreateProAgent(entitlement)) {
                          presentPaywall('agents', openCreateAgent);
                          return;
                        }
                        openCreateAgent();
                      }}
                      onCreateAgentLocked={() => {
                        const target = resolveRosterCreateAgentTarget({
                          activeConnectionId: connections.activeConnectionId,
                          currentAgentId,
                          roster: connections.roster,
                        });
                        presentPaywall('agents', target ? () => {
                          navigation.navigate('AgentSettingsSection', {
                            connectionId: target.connectionId,
                            agentId: target.agentId,
                            section: 'identity',
                            action: 'create-agent',
                          });
                        } : undefined);
                      }}
                      onOpenRow={(row: RosterDisplayRow) => {
                        analyticsEvents.rosterRowOpened({
                          kind: row.kind,
                          unread: row.unreadCount > 0,
                          attention: Boolean(row.attention),
                          locked: row.locked,
                          cached: row.cached,
                        });
                        if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
                          presentPaywall(
                            canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections',
                            () => navigation.navigate('Thread', {
                              connectionId: row.connectionId,
                              agentId: row.agentId,
                              sessionKey: row.sessionKey,
                              from: 'roster',
                            }),
                          );
                          return;
                        }
                        navigation.navigate('Thread', {
                          connectionId: row.connectionId,
                          agentId: row.agentId,
                          sessionKey: row.sessionKey,
                          from: 'roster',
                        });
                      }}
                      onOpenLockedRow={(row: RosterDisplayRow) => {
                        analyticsEvents.rosterRowOpened({
                          kind: row.kind,
                          unread: row.unreadCount > 0,
                          attention: Boolean(row.attention),
                          locked: true,
                          cached: row.cached,
                        });
                        presentPaywall(
                          canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections',
                          () => navigation.navigate('Thread', {
                            connectionId: row.connectionId,
                            agentId: row.agentId,
                            sessionKey: row.sessionKey,
                            from: 'roster',
                          }),
                        );
                      }}
                      onToggleAgentPinned={handleToggleRosterAgentPinned}
                      onToggleAgentMuted={handleToggleRosterAgentMuted}
                      onRemoveConnection={handleRosterConnectionRemove}
                      onUnpinSession={handleRosterSessionUnpin}
                      onRenameSession={handleRosterSessionRename}
                      onGraceAction={() => presentPaywall('settingsMembershipPreview')}
                      onOpenPro={() => presentPaywall('settingsMembershipPreview')}
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
                      lockedReason={canAccessConnection(props.route.params.connectionId)
                        ? 'agents'
                        : 'gatewayConnections'}
                      onOpenSessionPanel={() => {
                        if (!canAccessRosterAgent(
                          props.route.params.connectionId,
                          props.route.params.agentId,
                        )) {
                          presentPaywall(
                            canAccessConnection(props.route.params.connectionId)
                              ? 'agents'
                              : 'gatewayConnections',
                            () => {
                              setThreadContext(props.route.params);
                              setSessionPanelVisible(true);
                            },
                          );
                          return;
                        }
                        setThreadContext(props.route.params);
                        setSessionPanelVisible(true);
                      }}
                      onOpenRunSession={(sessionKey, agentId) => {
                        const targetAgentId = agentId ?? props.route.params.agentId;
                        if (!canAccessRosterAgent(props.route.params.connectionId, targetAgentId)) {
                          presentPaywall(
                            canAccessConnection(props.route.params.connectionId)
                              ? 'agents'
                              : 'gatewayConnections',
                            () => {
                              const target: RootStackParamList['Thread'] = {
                                connectionId: props.route.params.connectionId,
                                agentId: targetAgentId,
                                sessionKey,
                                from: 'panel',
                              };
                              setThreadContext(target);
                              setCurrentAgentId(target.agentId);
                              props.navigation.push('Thread', target);
                            },
                          );
                          return;
                        }
                        const target: RootStackParamList['Thread'] = {
                          connectionId: props.route.params.connectionId,
                          agentId: targetAgentId,
                          sessionKey,
                          from: 'panel',
                        };
                        setThreadContext(target);
                        setCurrentAgentId(target.agentId);
                        props.navigation.push('Thread', target);
                      }}
                      onOpenRunLogs={(_sessionKey, agentId) => {
                        props.navigation.push('AgentSettingsSection', {
                          connectionId: props.route.params.connectionId,
                          agentId: agentId ?? props.route.params.agentId,
                          section: 'logs',
                        });
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
                      return <AgentSettingsRouteLoading onBack={navigation.goBack} />;
                    }
                    const permissionDenied = Boolean(agent && !canAccessRosterAgent(
                      connection.id,
                      agent.agentId,
                    ));
                    return (
                      <AgentSettingsRuntimeScreen
                        adapter={adapter}
                        connection={connection}
                        agent={agent}
                        capabilities={adapter?.capabilities ?? resolveCapabilities(connection.backendKind)}
                        isPro={isPro}
                        loadIdentityDetail={loadConnectionIdentityDetail}
                        permissionDenied={permissionDenied}
                        onBack={navigation.goBack}
                        onNavigate={navigation.navigate}
                        onOpenPro={(section, onContinue) => presentPaywall(
                          permissionDenied
                            ? (canAccessConnection(connection.id) ? 'agents' : 'gatewayConnections')
                            : resolveAgentPaywallFeature(section),
                          onContinue,
                        )}
                        onRetry={() => {
                          if (!canAccessRosterAgent(connection.id, agent?.agentId ?? route.params.agentId)) {
                            presentPaywall(
                              canAccessConnection(connection.id) ? 'agents' : 'gatewayConnections',
                              async () => {
                                await getConnectionRuntime().activate(connection.id);
                                await getConnectionRuntime().probeActive();
                              },
                            );
                            return;
                          }
                          void getConnectionRuntime().activate(connection.id)
                            .then(() => getConnectionRuntime().probeActive());
                        }}
                      />
                    );
                  }}
                </RootStack.Screen>
                <RootStack.Screen name="AgentSettingsSection">
                  {(props) => {
                    const permissionDenied = !canAccessRosterAgent(
                      props.route.params.connectionId,
                      props.route.params.agentId,
                    );
                    return (
                      <AgentSettingsSectionScreen
                        {...props}
                        isPro={isPro}
                        permissionDenied={permissionDenied}
                        resolveAction={resolveAgentSettingsAction}
                        onOpenPaywall={(reason, onContinue) => presentPaywall(
                          permissionDenied
                            ? (canAccessConnection(props.route.params.connectionId)
                              ? 'agents'
                              : 'gatewayConnections')
                            : normalizePaywallFeature(reason),
                          onContinue,
                        )}
                      />
                    );
                  }}
                </RootStack.Screen>
                <RootStack.Screen name="AccountSettings">
                  {({ navigation }) => (
                    <AccountSettingsScreen
                      status={accountSettingsStatus}
                      connections={settingsConnections}
                      labels={accountSettingsLabels}
                      isPro={isPro}
                      canAddConnection={canAddSettingsConnection}
                      replyNotificationsEnabled={replyNotificationsEnabled}
                      debugMode={debugMode}
                      onBack={navigation.goBack}
                      onRetry={() => { void getConnectionRuntime().probeActive(); }}
                      onOpenAction={(action) => {
                        if (action === 'view-pro') {
                          presentPaywall('settingsMembershipPreview');
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
                      onOpenPaywall={(reason, onContinue) => presentPaywall(
                        normalizePaywallFeature(reason),
                        onContinue,
                      )}
                      onReplyNotificationsChange={updateReplyNotifications}
                      onDebugModeChange={onDebugToggle}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="AccountSettingsSection">
                  {({ navigation, route }) => (
                    <AccountSettingsSectionScreen
                      section={route.params.section}
                      status={accountSettingsStatus}
                      data={{
                        connections: settingsSectionConnections,
                        isPro,
                        canAddConnection: canAddSettingsConnection,
                        replyNotificationsEnabled,
                        debugMode,
                        labels: accountSettingsLabels,
                      }}
                      onBack={navigation.goBack}
                      onRetry={() => { void getConnectionRuntime().probeActive(); }}
                      onAction={(request) => handleAccountSectionAction(request, navigation)}
                      onPreferenceChanged={(preference, value) => {
                        if (preference === 'app-icon' && (value === 'default' || value === 'black')) {
                          setCurrentAppIcon(value);
                        }
                      }}
                      onOpenPaywall={(reason, onContinue) => presentPaywall(
                        normalizePaywallFeature(reason),
                        onContinue,
                      )}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="ChatAppearance">
                  {({ navigation }) => (
                    <ChatAppearanceScreen onBack={navigation.goBack} />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="ReleaseNotes">
                  {({ navigation }) => (
                    <ReleaseNotesHistoryScreen
                      onBack={navigation.goBack}
                      onOpenPaywall={(feature) => presentPaywall(feature)}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="Search">
                  {(props) => (
                    <SearchScreen
                      {...props}
                      resolveThreadLockedReason={(connectionId, agentId) => {
                        if (!canAccessConnection(connectionId)) return 'gatewayConnections';
                        if (!canAccessRosterAgent(connectionId, agentId)) return 'agents';
                        return null;
                      }}
                      onOpenPaywall={(reason, onContinue) => presentPaywall(
                        normalizePaywallFeature(reason),
                        onContinue,
                      )}
                    />
                  )}
                </RootStack.Screen>
                <RootStack.Screen name="MessageDetail" component={MessageDetailScreen} />
                <RootStack.Screen
                  name="Paywall"
                  component={PaywallRouteBridge}
                  options={{ presentation: 'fullScreenModal', gestureEnabled: true }}
                />
              </RootStack.Navigator>
              <SessionPanel
                visible={sessionPanelVisible}
                currentAgentId={threadContext?.agentId ?? currentAgentId}
                currentSessionKey={threadContext?.sessionKey ?? mainSessionKey}
                permissionDenied={threadContext
                  ? !canAccessRosterAgent(threadContext.connectionId, threadContext.agentId)
                  : false}
                onClose={() => setSessionPanelVisible(false)}
                onSelectSession={(row) => {
                  if (!canAccessRosterAgent(row.connectionId, row.agentId)) {
                    presentPaywall(
                      canAccessConnection(row.connectionId) ? 'agents' : 'gatewayConnections',
                      () => {
                        const params: RootStackParamList['Thread'] = {
                          connectionId: row.connectionId,
                          agentId: row.agentId,
                          sessionKey: row.key,
                          from: 'panel',
                        };
                        setThreadContext(params);
                        setCurrentAgentId(row.agentId);
                        if (rootNavigationRef.isReady()) rootNavigationRef.navigate('Thread', params);
                      },
                    );
                    return;
                  }
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
                onOpenPermission={() => presentPaywall(
                  threadContext && !canAccessConnection(threadContext.connectionId)
                    ? 'gatewayConnections'
                    : 'agents',
                )}
              />
            </NavigationContainer>
            <GlobalGatewayOverlay />
            <GlobalProPaywallOverlay
              onDismiss={dismissPaywall}
              onContinue={continueAfterPaywall}
            />
          </NodeCameraCaptureProvider>
        </GatewayScannerProvider>
      </GlobalLoadingOverlayProvider>
    </AppContextProvider>
  );
}

function AppDeepLinkHandler(
  props: Omit<DeepLinkDeps, 'requestConfirmation'>,
): React.JSX.Element | null {
  const [request, setRequest] = useState<DeepLinkConfirmationRequest | null>(null);
  const requestConfirmation = useCallback((next: DeepLinkConfirmationRequest) => {
    setRequest(next);
  }, []);
  useDeepLinkHandler({ ...props, requestConfirmation });

  return (
    <DeepLinkConfirmationModal
      request={request}
      onClose={() => setRequest(null)}
    />
  );
}

function normalizePaywallFeature(reason: string): ProFeature {
  switch (reason) {
    case 'gatewayConnections':
    case 'appIcons':
    case 'configBackups':
    case 'configManage':
    case 'configBackupCreate':
    case 'configBackupRestore':
    case 'openclawDiagnostics':
    case 'openclawPermissions':
    case 'agents':
    case 'coreFileEditing':
    case 'logs':
    case 'usage':
    case 'messageHistory':
    case 'launch':
    case 'settingsMembershipPreview':
      return normalizeProFeature(reason);
    default:
      return 'settingsMembershipPreview';
  }
}

function resolveAgentPaywallFeature(section: AgentSettingsSection): ProFeature {
  if (section === 'files') return 'coreFileEditing';
  if (section === 'logs') return 'logs';
  if (section === 'usage') return 'usage';
  if (section === 'openclaw') return 'configManage';
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

function GlobalProPaywallOverlay({
  onDismiss,
  onContinue,
}: Readonly<{
  onDismiss: () => void;
  onContinue: () => void;
}>): React.JSX.Element | null {
  const { visible } = useProPaywall();
  return (
    <ProPaywallOverlay
      visible={visible}
      onClose={onDismiss}
      onContinue={onContinue}
    />
  );
}

const loadingStyles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
