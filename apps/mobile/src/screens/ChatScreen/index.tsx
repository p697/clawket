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
  const { debugMode, gateway } = useAppContext();
  const isFocused = useIsFocused();
  const capabilities = React.useMemo(() => gateway.getBackendCapabilities(), [gateway]);
  const handledRequestRef = React.useRef<number | null>(null);
  const handledBoardRequestRef = React.useRef<number | null>(null);
  const checkedModeRef = React.useRef<string | null>(null);
  const [announcement, setAnnouncement] = React.useState<AppUpdateAnnouncement | null>(null);
  const [announcementVisible, setAnnouncementVisible] = React.useState(false);
  const currentVersion = React.useMemo(() => getCurrentAppVersion(), []);

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

  const handleOpenCustomConnection = React.useCallback(() => {
    const requestedAt = Date.now();
    const parentNavigation = navigation.getParent();
    if (parentNavigation) {
      parentNavigation.dispatch(
        CommonActions.navigate({
          name: 'My',
          params: {
            state: {
              routes: [
                {
                  name: 'ConfigHome',
                  params: {
                    addConnectionRequestAt: requestedAt,
                    addConnectionTab: 'manual',
                  },
                },
              ],
            },
          },
        }),
      );
      return;
    }
    navigation.navigate('My' as never);
  }, [navigation]);

  const handleOpenAddGatewayConnection = React.useCallback(() => {
    const requestedAt = Date.now();
    const parentNavigation = navigation.getParent();
    if (parentNavigation) {
      parentNavigation.dispatch(
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
      return;
    }
    navigation.navigate('My' as never);
  }, [navigation]);

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
    const parentNavigation = navigation.getParent();

    if (entry.action.type === 'open_url') {
      await openExternalUrl(entry.action.url, () => {
        Alert.alert(t('Unable to open link', { ns: 'common' }), t('Please try again later.'));
      });
      return;
    }

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
  }, [closeAnnouncement, navigation, t]);

  return (
    <>
      <ChatScreenLayout
        controller={controller}
        insets={insets}
        onOpenSidebar={() => navigation.openDrawer()}
        onAddGatewayConnection={handleOpenAddGatewayConnection}
        onOpenCustomConnection={handleOpenCustomConnection}
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
