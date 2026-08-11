import React from 'react';
import { Alert } from 'react-native';
import { CommonActions, useIsFocused, useNavigation } from '@react-navigation/native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { openExternalUrl } from '../../utils/openExternalUrl';
import {
  type AppUpdateAnnouncement,
  type AppUpdateAnnouncementEntry,
} from '../../features/app-updates/releases';
import {
  getCurrentAppUpdateAnnouncement,
  getCurrentAppVersion,
  markCurrentAppUpdateAnnouncementShown,
  shouldShowCurrentAppUpdateAnnouncement,
} from '../../services/app-update-announcement';
import { getGatewayBackendCapabilities } from '../../services/gateway-backends';
import { requestConfigAddConnection } from '../../services/config-add-connection-request';
import { ChatScreenLayout } from './ChatScreenLayout';
import { useChatControllerContext } from './ChatControllerContext';
import { AppUpdateAnnouncementModal } from './components/AppUpdateAnnouncementModal';
import type { ChatDrawerParamList } from './ChatTab';

type ChatScreenNavigation = DrawerNavigationProp<ChatDrawerParamList, 'ChatMain'>;

type ChatScreenProps = {
  openSidebarRequestAt?: number | null;
  openAgentSessionsBoardRequestAt?: number | null;
};

export function ChatScreen({ openSidebarRequestAt, openAgentSessionsBoardRequestAt }: ChatScreenProps): React.JSX.Element {
  const navigation = useNavigation<ChatScreenNavigation>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const controller = useChatControllerContext();
  const { config, debugMode, gateway } = useAppContext();
  const isFocused = useIsFocused();
  const capabilities = React.useMemo(() => getGatewayBackendCapabilities(config), [config]);
  const handledRequestRef = React.useRef<number | null>(null);
  const handledBoardRequestRef = React.useRef<number | null>(null);
  const checkedModeRef = React.useRef<string | null>(null);
  const [announcement, setAnnouncement] = React.useState<AppUpdateAnnouncement | null>(null);
  const [announcementVisible, setAnnouncementVisible] = React.useState(false);
  const currentVersion = React.useMemo(() => getCurrentAppVersion(), []);

  const navigateToConfigHome = React.useCallback(() => {
    const parentNavigation = navigation.getParent();
    if (parentNavigation) {
      parentNavigation.dispatch(
        CommonActions.navigate({
          name: 'My',
          params: { screen: 'ConfigHome' },
          merge: true,
        }),
      );
      return;
    }
    navigation.navigate('My' as never);
  }, [navigation]);

  React.useEffect(() => {
    if (!openSidebarRequestAt) return;
    if (handledRequestRef.current === openSidebarRequestAt) return;
    handledRequestRef.current = openSidebarRequestAt;
    navigation.openDrawer();
  }, [navigation, openSidebarRequestAt]);

  React.useEffect(() => {
    if (!capabilities.consoleAgentSessionsBoard) return;
    if (!openAgentSessionsBoardRequestAt) return;
    if (handledBoardRequestRef.current === openAgentSessionsBoardRequestAt) return;
    handledBoardRequestRef.current = openAgentSessionsBoardRequestAt;
    const parentNavigation = navigation.getParent();
    if (!parentNavigation) return;
    parentNavigation.dispatch(CommonActions.navigate({ name: 'AgentSessionsBoard' }));
  }, [capabilities.consoleAgentSessionsBoard, navigation, openAgentSessionsBoardRequestAt]);

  React.useEffect(() => {
    if (!isFocused) return;
    if (debugMode) {
      setAnnouncement(getCurrentAppUpdateAnnouncement(currentVersion));
      setAnnouncementVisible(false);
      return;
    }

    const checkKey = `${currentVersion}:${debugMode ? 'debug' : 'release'}`;
    if (checkedModeRef.current === checkKey) return;

    let cancelled = false;

    void (async () => {
      const nextAnnouncement = getCurrentAppUpdateAnnouncement(currentVersion);
      const visible = await shouldShowCurrentAppUpdateAnnouncement(debugMode);
      if (cancelled) return;
      checkedModeRef.current = checkKey;
      setAnnouncement(nextAnnouncement);
      setAnnouncementVisible(visible);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentVersion, debugMode, isFocused]);

  const handleOpenAddGatewayConnection = React.useCallback(() => {
    requestConfigAddConnection({
      tab: 'quick',
    });
    navigateToConfigHome();
  }, [navigateToConfigHome]);

  const handleOpenQuickConnectionFlow = React.useCallback((flow: 'local' | 'youmind' | 'tailscale' | 'bonjour' | 'multipeer' | 'airdrop') => {
    requestConfigAddConnection({
      tab: 'quick',
      flow: flow === 'youmind' ? 'youmind' : 'local',
    });
    navigateToConfigHome();
  }, [navigateToConfigHome]);

  const handleNavigateToConfigAddConnection = React.useCallback((options?: {
    tab?: 'quick' | 'manual';
    flow?: 'local' | 'youmind' | 'tailscale' | 'bonjour' | 'multipeer' | 'airdrop';
  }) => {
    requestConfigAddConnection({
      tab: options?.tab === 'manual' ? 'manual' : 'quick',
      flow: options?.flow === 'youmind' ? 'youmind' : options?.flow ? 'local' : undefined,
    });
    navigateToConfigHome();
  }, [navigateToConfigHome]);

  const handleOpenManageAgents = React.useCallback(() => {
    const parentNavigation = navigation.getParent();
    if (!parentNavigation) return;

    parentNavigation.dispatch(
      CommonActions.navigate({
        name: 'Console',
        params: {
          state: {
            routes: [
              { name: 'ConsoleMenu' },
              { name: 'AgentList' },
            ],
          },
        },
      }),
    );
  }, [navigation]);

  const handleOpenAgentSessionsBoard = React.useCallback(() => {
    if (!capabilities.consoleAgentSessionsBoard) return;
    const parentNavigation = navigation.getParent();
    if (!parentNavigation) return;
    parentNavigation.dispatch(CommonActions.navigate({ name: 'AgentSessionsBoard' }));
  }, [capabilities.consoleAgentSessionsBoard, navigation]);

  const closeAnnouncement = React.useCallback(async () => {
    if (!debugMode) {
      await markCurrentAppUpdateAnnouncementShown();
    }
    setAnnouncementVisible(false);
  }, [debugMode]);

  const handleAnnouncementEntryPress = React.useCallback(async (entry: AppUpdateAnnouncementEntry) => {
    await closeAnnouncement();

    if (entry.action.type === 'open_url') {
      await openExternalUrl(entry.action.url, () => {
        Alert.alert(t('Unable to open link', { ns: 'common' }), t('Please try again later.'));
      });
      return;
    }

    if (entry.action.type === 'navigate_config_add_connection') {
      handleNavigateToConfigAddConnection({
        tab: entry.action.tab,
        flow: entry.action.flow,
      });
      return;
    }

    const parentNavigation = navigation.getParent();
    if (!parentNavigation) return;

    if (entry.action.type === 'navigate_tab') {
      parentNavigation.dispatch(
        CommonActions.navigate({
          name: entry.action.screen,
        }),
      );
      return;
    }

    if (entry.action.type === 'navigate_console') {
      parentNavigation.dispatch(
        CommonActions.navigate({
          name: 'Console',
          params: {
            state: {
              routes: [
                { name: 'ConsoleMenu' },
                { name: entry.action.screen },
              ],
            },
          },
        }),
      );
      return;
    }

    if (entry.action.type === 'navigate_config') {
      parentNavigation.dispatch(
        CommonActions.navigate({
          name: 'My',
          params: {
            state: {
              routes: [
                { name: 'ConfigHome' },
                { name: entry.action.screen },
              ],
            },
          },
        }),
      );
      return;
    }

  }, [closeAnnouncement, handleNavigateToConfigAddConnection, navigation, t]);

  return (
    <>
      <ChatScreenLayout
        controller={controller}
        insets={insets}
        onOpenSidebar={() => navigation.openDrawer()}
        onAddGatewayConnection={handleOpenAddGatewayConnection}
        onOpenQuickConnectionFlow={handleOpenQuickConnectionFlow}
        onManageAgents={handleOpenManageAgents}
        onOpenAgentSessionsBoard={capabilities.consoleAgentSessionsBoard ? handleOpenAgentSessionsBoard : undefined}
      />
      <AppUpdateAnnouncementModal
        visible={announcementVisible}
        announcement={announcement}
        debugMode={debugMode}
        currentVersion={currentVersion}
        onClose={() => {
          void closeAnnouncement();
        }}
        onEntryPress={(entry) => {
          void handleAnnouncementEntryPress(entry);
        }}
      />
    </>
  );
}
