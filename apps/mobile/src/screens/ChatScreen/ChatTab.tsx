import React from 'react';
import { InteractionManager, Platform, StyleSheet, View } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { DrawerContentComponentProps, createDrawerNavigator, useDrawerProgress } from '@react-navigation/drawer';
import Animated, { useAnimatedStyle, interpolate } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionSidebar } from '../../components/chat/SessionSidebar';
import { useAppContext } from '../../contexts/AppContext';
import { resolveGatewayCacheScopeId } from '../../services/gateway-cache-scope';
import { analyticsEvents } from '../../services/analytics/events';
import { ChatCacheService } from '../../services/chat-cache';
import { useAppTheme } from '../../theme';
import { Space } from '../../theme/tokens';
import { ChatControllerProvider, useChatControllerContext } from './ChatControllerContext';
import { useChatController } from './hooks/useChatController';
import { ChatScreen } from './index';
import { YouMindChatTab } from './YouMindChatTab';

export type ChatDrawerParamList = {
  ChatMain: undefined;
};

const ChatDrawer = createDrawerNavigator<ChatDrawerParamList>();

function describeSessionKeyPrefix(sessionKey: string): string {
  const match = sessionKey.match(/^agent:[^:]+:([^:]+)/);
  return match?.[1] ?? 'unknown';
}

async function patchGatewaySession(
  gateway: import('../../services/gateway').GatewayClient,
  key: string,
  patch: { label?: string | null },
): Promise<void> {
  const candidate = gateway as import('../../services/gateway').GatewayClient & {
    patchSession?: (sessionKey: string, nextPatch: { label?: string | null }) => Promise<unknown>;
  };
  if (typeof candidate.patchSession === 'function') {
    await candidate.patchSession(key, patch);
    return;
  }
  await gateway.request('sessions.patch', { key, ...patch });
}

async function resetGatewaySession(
  gateway: import('../../services/gateway').GatewayClient,
  key: string,
): Promise<void> {
  const candidate = gateway as import('../../services/gateway').GatewayClient & {
    resetSession?: (sessionKey: string, reason?: 'new' | 'reset') => Promise<unknown>;
  };
  if (typeof candidate.resetSession === 'function') {
    await candidate.resetSession(key, 'reset');
    return;
  }
  await gateway.request('sessions.reset', { key, reason: 'reset' });
}

async function deleteGatewaySession(
  gateway: import('../../services/gateway').GatewayClient,
  key: string,
): Promise<void> {
  const candidate = gateway as import('../../services/gateway').GatewayClient & {
    deleteSession?: (sessionKey: string) => Promise<unknown>;
  };
  if (typeof candidate.deleteSession === 'function') {
    await candidate.deleteSession(key);
    return;
  }
  await gateway.request('sessions.delete', { key });
}

type ChatDrawerContentProps = DrawerContentComponentProps & {
  bottomPadding: number;
  gatewayConfigId: string;
  sidebarPreset: {
    requestedAt: number;
    tab: 'sessions' | 'subagents' | 'cron';
    channel?: string;
  } | null;
  onAgentSwitch: () => void;
};

const ChatDrawerContent = React.memo(function ChatDrawerContent({
  navigation,
  bottomPadding,
  gatewayConfigId,
  sidebarPreset,
  onAgentSwitch,
}: ChatDrawerContentProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const controller = useChatControllerContext();
  const progress = useDrawerProgress();
  const { gateway, currentAgentId, mainSessionKey } = useAppContext();

  // Refresh sessions only after the open animation finishes,
  // so the JS thread stays free during the slide-in transition.
  const refreshSessions = controller.refreshSessions;
  const prevProgressRef = React.useRef(0);
  React.useEffect(() => {
    const id = setInterval(() => {
      const cur = progress.get();
      const prev = prevProgressRef.current;
      prevProgressRef.current = cur;
      // Drawer just finished opening (progress crossed 1.0)
      if (cur === 1 && prev < 1) {
        InteractionManager.runAfterInteractions(() => {
          void refreshSessions();
        });
      }
    }, 200);
    return () => clearInterval(id);
  }, [progress, refreshSessions]);

  // Stable callbacks to prevent child re-renders
  const handleClose = React.useCallback(() => navigation.closeDrawer(), [navigation]);
  const switchSession = controller.switchSession;
  const handleSelect = React.useCallback((session: import('../../types').SessionInfo) => {
    analyticsEvents.chatSessionSelected({
      source: 'session_sidebar',
      session_kind: session.kind ?? 'unknown',
      session_key_prefix: describeSessionKeyPrefix(session.key),
    });
    switchSession(session);
    navigation.closeDrawer();
  }, [navigation, switchSession]);

  const handleAgentSwitch = React.useCallback(() => {
    navigation.closeDrawer();
    onAgentSwitch();
  }, [navigation, onAgentSwitch]);

  const handleRenameSession = React.useCallback(async (session: import('../../types').SessionInfo, label: string | null) => {
    await patchGatewaySession(gateway, session.key, { label });
    if (controller.sessionKey === session.key) {
      controller.reloadSession({ ...session, label: label ?? undefined }, { clearInput: false, clearWhenEmpty: false });
    }
    await controller.refreshSessions();
  }, [controller, gateway]);

  const handleResetSession = React.useCallback(async (session: import('../../types').SessionInfo) => {
    await resetGatewaySession(gateway, session.key);
    if (controller.sessionKey === session.key) {
      controller.reloadSession(session, { clearInput: false, clearWhenEmpty: true });
    }
    await controller.refreshSessions();
  }, [controller, gateway]);

  const handleDeleteSession = React.useCallback(async (session: import('../../types').SessionInfo) => {
    await deleteGatewaySession(gateway, session.key);
    await ChatCacheService.deleteMessages(gatewayConfigId, currentAgentId, session.key);
    await controller.refreshSessions();

    if (controller.sessionKey === session.key) {
      controller.switchSession({
        key: mainSessionKey,
        kind: 'unknown',
        label: 'Main session',
      });
    }
  }, [controller, currentAgentId, gateway, gatewayConfigId, mainSessionKey]);

  const handleCreateCronJob = React.useCallback(() => {
    analyticsEvents.cronCreateTapped({ source: 'chat_session_sidebar' });
    const root = navigation.getParent();
    if (root) {
      root.dispatch(CommonActions.navigate({ name: 'CronWizard' }));
    }
  }, [navigation]);

  const handleOpenSessionsBoard = React.useCallback(() => {
    navigation.closeDrawer();
    const root = navigation.getParent();
    if (root) {
      root.dispatch(CommonActions.navigate({ name: 'SessionsBoard' }));
    }
  }, [navigation]);

  const { theme } = useAppTheme();

  // Drive shadow entirely on the UI thread via reanimated —
  // no React state change during animation.
  const shadowAnimatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      shadowColor: theme.colors.shadow,
      shadowOffset: { width: 4, height: 0 },
      shadowOpacity: interpolate(
        p,
        [0, 0.15],
        [0, theme.scheme === 'dark' ? 0.5 : 0.12],
      ),
      shadowRadius: interpolate(p, [0, 0.15], [0, 20]),
      elevation: p > 0.05 ? 24 : 0,
    };
  }, [theme.colors.shadow, theme.scheme]);

  return (
    <Animated.View style={[styles.drawerShadowWrap, shadowAnimatedStyle]}>
      <SessionSidebar
        sessions={controller.sessions}
        activeSessionKey={controller.sessionKey}
        topPadding={insets.top + (Platform.OS === 'android' ? 12 : 0)}
        bottomPadding={Platform.OS === 'android' ? 12 : bottomPadding}
        gatewayConfigId={gatewayConfigId}
        onClose={handleClose}
        onSelectSession={handleSelect}
        onAgentSwitch={handleAgentSwitch}
        onRefresh={refreshSessions}
        onRenameSession={handleRenameSession}
        onResetSession={handleResetSession}
        onDeleteSession={handleDeleteSession}
        onCreateCronJob={handleCreateCronJob}
        onOpenSessionsBoard={handleOpenSessionsBoard}
        externalSelection={sidebarPreset}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  drawerShadowWrap: {
    flex: 1,
  },
});

export function ChatTab(): React.JSX.Element {
  const { theme } = useAppTheme();
  const {
    activeGatewayConfigId,
    gateway,
    config,
    debugMode,
    showAgentAvatar,
    chatSessionRequest,
    clearChatSessionRequest,
    chatSidebarRequest,
    clearChatSidebarRequest,
  } = useAppContext();
  if (config?.backendKind === 'youmind') {
    return <YouMindChatTab />;
  }
  const [sidebarPreset, setSidebarPreset] = React.useState<{
    requestedAt: number;
    tab: 'sessions' | 'subagents' | 'cron';
    channel?: string;
  } | null>(null);
  const [openSidebarRequestAt, setOpenSidebarRequestAt] = React.useState<number | null>(null);
  const [openAgentSessionsBoardRequestAt, setOpenAgentSessionsBoardRequestAt] = React.useState<number | null>(null);
  const handleAgentSwitchFromSidebar = React.useCallback(() => {
    setOpenAgentSessionsBoardRequestAt(Date.now());
  }, []);

  React.useEffect(() => {
    if (!chatSidebarRequest) return;
    setSidebarPreset({
      requestedAt: chatSidebarRequest.requestedAt,
      tab: chatSidebarRequest.tab,
      channel: chatSidebarRequest.channel,
    });
    if (chatSidebarRequest.openDrawer) {
      setOpenSidebarRequestAt(chatSidebarRequest.requestedAt);
    }
    clearChatSidebarRequest();
  }, [chatSidebarRequest, clearChatSidebarRequest]);

  const controller = useChatController({
    gateway,
    config,
    debugMode,
    showAgentAvatar,
    chatSessionRequest,
    clearChatSessionRequest,
  });

  const bottomPadding = Space.md;
  const gatewayConfigId = React.useMemo(
    () => resolveGatewayCacheScopeId({ activeConfigId: activeGatewayConfigId, config }),
    [activeGatewayConfigId, config],
  );

  // Stable drawerContent callback — avoids recreating on every ChatTab render
  const renderDrawerContent = React.useCallback(
    (props: DrawerContentComponentProps) => (
        <ChatDrawerContent
          {...props}
          bottomPadding={bottomPadding}
          gatewayConfigId={gatewayConfigId}
          sidebarPreset={sidebarPreset}
          onAgentSwitch={handleAgentSwitchFromSidebar}
        />
      ),
    [bottomPadding, gatewayConfigId, handleAgentSwitchFromSidebar, sidebarPreset],
  );

  // Stable screen render to avoid remounting ChatScreen on parent re-renders
  const renderChatScreen = React.useCallback(
    () => <ChatScreen openSidebarRequestAt={openSidebarRequestAt} openAgentSessionsBoardRequestAt={openAgentSessionsBoardRequestAt} />,
    [openSidebarRequestAt, openAgentSessionsBoardRequestAt],
  );

  const screenOptions = React.useMemo(() => ({
    headerShown: false as const,
    drawerType: 'front' as const,
    drawerPosition: 'left' as const,
    swipeEnabled: true,
    swipeEdgeWidth: 40,
    drawerStyle: {
      width: '85%' as const,
      backgroundColor: theme.colors.surface,
      shadowOpacity: 0,
      elevation: 0,
    },
    overlayColor: theme.scheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.3)',
  }), [theme.colors.surface, theme.scheme]);

  return (
    <ChatControllerProvider controller={controller}>
      <View style={{ flex: 1 }}>
        <ChatDrawer.Navigator
          drawerContent={renderDrawerContent}
          screenOptions={screenOptions}
        >
          <ChatDrawer.Screen name="ChatMain">
            {renderChatScreen}
          </ChatDrawer.Screen>
        </ChatDrawer.Navigator>
      </View>
    </ChatControllerProvider>
  );
}
