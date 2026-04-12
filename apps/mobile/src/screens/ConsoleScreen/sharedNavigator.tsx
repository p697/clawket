import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { getGatewayBackendDescriptor } from '../../services/gateway-backends';
import { useAppTheme } from '../../theme';
import { isConsoleScreenSupported } from './console-screen-support';

// On iOS the native tab bar overlays content, so screens need paddingBottom.
// On Android the JS tab bar occupies layout space, so no extra padding is needed.
const needsTabBarPadding = Platform.OS === 'ios';
import { ConsoleMenuScreen } from './ConsoleMenuScreen';
import { ChannelsScreen } from './ChannelsScreen';
import { NodesScreen } from './NodesScreen';
import { DevicesScreen } from './DevicesScreen';
import { NodeDetailScreen } from './NodeDetailScreen';
import {
  CronDetailRouteScreen,
  CronEditorRouteScreen,
  CronListRouteScreen,
  CronWizardRouteScreen,
} from './HermesAwareCronScreens';
import { AgentUserInfoScreen } from './AgentUserInfoScreen';
import { FileEditorScreen } from './FileEditorScreen';
import { FileListScreen } from './FileListScreen';
import { LogScreen } from './LogScreen';
import { ModelsScreen } from './ModelsScreen';
import { SkillContentScreen } from './SkillContentScreen';
import { SkillDetailScreen } from './SkillDetailScreen';
import { SkillListScreen } from './SkillListScreen';
import { AgentListScreen } from './AgentListScreen';
import { AgentDetailScreen } from './AgentDetailScreen';
import { ClawHubScreen } from './ClawHubScreen';
import { DocsScreen } from './DocsScreen';
import { ToolsScreen } from './ToolsScreen';
import { UsageScreen } from './UsageScreen';
import { HeartbeatSettingsScreen } from './HeartbeatSettingsScreen';
import { ChatHistoryScreen } from './ChatHistoryScreen';
import { ChatHistoryDetailScreen } from './ChatHistoryDetailScreen';
import { FavoriteMessageDetailScreen } from './FavoriteMessageDetailScreen';
import { SessionsBoardScreen } from './SessionsBoardScreen';
import { AgentSessionsBoardScreen } from './AgentSessionsBoardScreen';
import { DiscoverTab } from '../DiscoverScreen/DiscoverTab';

export type ConsoleStackParamList = {
  ConsoleMenu: undefined;
  Discover: undefined;
  FileList: undefined;
  FileEditor: { fileName: string };
  CronList: undefined;
  CronDetail: { jobId: string };
  CronEditor: { jobId?: string } | undefined;
  CronWizard: { jobId?: string } | undefined;
  SkillList: undefined;
  SkillDetail: { skillKey: string };
  SkillContent: { skillKey: string; filePath?: string | null };
  Logs: undefined;
  Usage: undefined;
  ModelList: undefined;
  Channels: undefined;
  Nodes: undefined;
  Devices: undefined;
  NodeDetail: { nodeId: string; displayName?: string };
  ToolList: undefined;
  AgentList: { openCreate?: boolean } | undefined;
  AgentDetail: { agentId: string };
  AgentUserInfo: { agentId: string };
  ClawHub: undefined;
  Docs: { url?: string } | undefined;
  HeartbeatSettings: undefined;
  ChatHistory: undefined;
  SessionsBoard: undefined;
  AgentSessionsBoard: undefined;
  ChatHistoryDetail: {
    storageKey: string;
    initialQuery?: string;
    sessionRefs?: Array<{
      gatewayConfigId: string;
      agentId: string;
      sessionKey: string;
    }>;
  };
  FavoriteMessageDetail: { favoriteKey: string };
};

type ConsoleScreenOptions = {
  defaultScreenOptions: NativeStackNavigationOptions;
  detailScreenOptions: NativeStackNavigationOptions;
  editorScreenOptions: NativeStackNavigationOptions;
  nativeModalHeaderOptions: NativeStackNavigationOptions;
  nativeEditorHeaderOptions: NativeStackNavigationOptions;
};

function createConsoleScreenOptions(
  defaultContentStyle: {
    backgroundColor: string;
    paddingBottom?: number;
  },
  modalContentStyle: {
    backgroundColor: string;
  },
): ConsoleScreenOptions {
  const detailScreenOptions = buildDetailScreenOptions(modalContentStyle);
  const editorScreenOptions = buildEditorScreenOptions(modalContentStyle);

  return {
    defaultScreenOptions: {
      headerShown: false,
      animation: 'slide_from_right',
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
      contentStyle: defaultContentStyle,
    },
    detailScreenOptions,
    editorScreenOptions,
    nativeModalHeaderOptions: {
      ...detailScreenOptions,
      headerShown: true,
    },
    nativeEditorHeaderOptions: {
      ...editorScreenOptions,
      headerShown: true,
    },
  };
}

function buildDetailScreenOptions(contentStyle: {
  backgroundColor: string;
}): NativeStackNavigationOptions {
  if (Platform.OS !== 'ios') {
    return {
      animation: 'slide_from_right',
      contentStyle,
    };
  }

  return {
    animation: 'slide_from_bottom',
    presentation: 'modal',
    contentStyle,
    gestureEnabled: true,
  };
}

function buildEditorScreenOptions(contentStyle: {
  backgroundColor: string;
}): NativeStackNavigationOptions {
  if (Platform.OS !== 'ios') {
    return {
      animation: 'slide_from_right',
      contentStyle,
    };
  }

  return {
    animation: 'slide_from_bottom',
    presentation: 'modal',
    contentStyle,
    gestureEnabled: true,
  };
}

export function useConsoleTabScreenOptions(): ConsoleScreenOptions {
  const { theme } = useAppTheme();
  const tabBarHeight = useTabBarHeight();

  const defaultContentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
      paddingBottom: needsTabBarPadding ? tabBarHeight : 0,
    }),
    [tabBarHeight, theme.colors.background],
  );
  const modalContentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );
  return useMemo(
    () => createConsoleScreenOptions(defaultContentStyle, modalContentStyle),
    [defaultContentStyle, modalContentStyle],
  );
}

export function useConsoleRootModalScreenOptions(): ConsoleScreenOptions {
  const { theme } = useAppTheme();

  const contentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );

  return useMemo(
    () => createConsoleScreenOptions(contentStyle, contentStyle),
    [contentStyle],
  );
}

type ConsoleModalScreenListArgs = ConsoleScreenOptions & {
  renderScreen: (
    name: keyof ConsoleStackParamList,
    component: React.ComponentType,
    options?: NativeStackNavigationOptions,
  ) => React.ReactNode;
};

export function renderConsoleModalScreens({
  detailScreenOptions,
  editorScreenOptions,
  nativeModalHeaderOptions,
  nativeEditorHeaderOptions,
  renderScreen,
}: ConsoleModalScreenListArgs): React.ReactNode[] {
  return (
    [
      renderScreen('Discover', DiscoverTab, nativeModalHeaderOptions),
      renderScreen('FileList', FileListScreen, nativeModalHeaderOptions),
      renderScreen('FileEditor', FileEditorScreen, editorScreenOptions),
      renderScreen('CronList', CronListRouteScreen, nativeModalHeaderOptions),
      renderScreen('CronDetail', CronDetailRouteScreen, detailScreenOptions),
      renderScreen('CronEditor', CronEditorRouteScreen, nativeEditorHeaderOptions),
      renderScreen('CronWizard', CronWizardRouteScreen, {
        ...nativeEditorHeaderOptions,
        gestureEnabled: false,
      }),
      renderScreen('SkillList', SkillListScreen, nativeModalHeaderOptions),
      renderScreen('SkillDetail', SkillDetailScreen, nativeModalHeaderOptions),
      renderScreen('SkillContent', SkillContentScreen, editorScreenOptions),
      renderScreen('Logs', LogScreen, nativeModalHeaderOptions),
      renderScreen('Usage', UsageScreen, nativeModalHeaderOptions),
      renderScreen('ModelList', ModelsScreen, nativeModalHeaderOptions),
      renderScreen('Channels', ChannelsScreen, nativeModalHeaderOptions),
      renderScreen('Nodes', NodesScreen, nativeModalHeaderOptions),
      renderScreen('Devices', DevicesScreen, nativeModalHeaderOptions),
      renderScreen('NodeDetail', NodeDetailScreen, detailScreenOptions),
      renderScreen('ToolList', ToolsScreen, nativeModalHeaderOptions),
      renderScreen('AgentList', AgentListScreen, nativeModalHeaderOptions),
      renderScreen('AgentDetail', AgentDetailScreen, nativeModalHeaderOptions),
      renderScreen('AgentUserInfo', AgentUserInfoScreen, nativeEditorHeaderOptions),
      renderScreen('ClawHub', ClawHubScreen),
      renderScreen('Docs', DocsScreen),
      renderScreen('HeartbeatSettings', HeartbeatSettingsScreen, nativeEditorHeaderOptions),
      renderScreen('ChatHistory', ChatHistoryScreen, nativeModalHeaderOptions),
      renderScreen('SessionsBoard', SessionsBoardScreen, nativeModalHeaderOptions),
      renderScreen('AgentSessionsBoard', AgentSessionsBoardScreen, nativeModalHeaderOptions),
      renderScreen('ChatHistoryDetail', ChatHistoryDetailScreen, nativeModalHeaderOptions),
      renderScreen('FavoriteMessageDetail', FavoriteMessageDetailScreen, nativeModalHeaderOptions),
    ]
  );
}

const ConsoleStack = createNativeStackNavigator<ConsoleStackParamList>();

function withConsoleCapabilityGuard(
  screen: keyof ConsoleStackParamList,
  Component: React.ComponentType,
): React.ComponentType {
  function GuardedConsoleScreen(): React.JSX.Element {
    const { gateway } = useAppContext();
    const { t } = useTranslation('console');
    const { theme } = useAppTheme();
    const capabilities = gateway.getBackendCapabilities();
    if (isConsoleScreenSupported(screen, capabilities)) {
      return <Component />;
    }
    const backend = getGatewayBackendDescriptor(gateway.getBackendKind());
    return (
      <View style={[styles.unsupportedRoot, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="🧩"
          title={t('Not Available Yet')}
          subtitle={t('{{backend}} does not support this page yet.', { backend: backend.label })}
        />
      </View>
    );
  }

  GuardedConsoleScreen.displayName = `GuardedConsoleScreen(${String(screen)})`;
  return GuardedConsoleScreen;
}

export function ConsoleTabNavigator(): React.JSX.Element {
  const screenOptions = useConsoleTabScreenOptions();
  const guardedConsoleMenuScreen = useMemo(
    () => withConsoleCapabilityGuard('ConsoleMenu', ConsoleMenuScreen),
    [],
  );
  const guardedScreens = useMemo<Partial<Record<keyof ConsoleStackParamList, React.ComponentType>>>(
    () => ({
      Discover: withConsoleCapabilityGuard('Discover', DiscoverTab),
      FileList: withConsoleCapabilityGuard('FileList', FileListScreen),
      FileEditor: withConsoleCapabilityGuard('FileEditor', FileEditorScreen),
      CronList: withConsoleCapabilityGuard('CronList', CronListRouteScreen),
      CronDetail: withConsoleCapabilityGuard('CronDetail', CronDetailRouteScreen),
      CronEditor: withConsoleCapabilityGuard('CronEditor', CronEditorRouteScreen),
      CronWizard: withConsoleCapabilityGuard('CronWizard', CronWizardRouteScreen),
      SkillList: withConsoleCapabilityGuard('SkillList', SkillListScreen),
      SkillDetail: withConsoleCapabilityGuard('SkillDetail', SkillDetailScreen),
      SkillContent: withConsoleCapabilityGuard('SkillDetail', SkillContentScreen),
      Logs: withConsoleCapabilityGuard('Logs', LogScreen),
      Usage: withConsoleCapabilityGuard('Usage', UsageScreen),
      ModelList: withConsoleCapabilityGuard('ModelList', ModelsScreen),
      Channels: withConsoleCapabilityGuard('Channels', ChannelsScreen),
      Nodes: withConsoleCapabilityGuard('Nodes', NodesScreen),
      Devices: withConsoleCapabilityGuard('Devices', DevicesScreen),
      NodeDetail: withConsoleCapabilityGuard('NodeDetail', NodeDetailScreen),
      ToolList: withConsoleCapabilityGuard('ToolList', ToolsScreen),
      AgentList: withConsoleCapabilityGuard('AgentList', AgentListScreen),
      AgentDetail: withConsoleCapabilityGuard('AgentDetail', AgentDetailScreen),
      AgentUserInfo: withConsoleCapabilityGuard('AgentUserInfo', AgentUserInfoScreen),
      ClawHub: withConsoleCapabilityGuard('ClawHub', ClawHubScreen),
      Docs: withConsoleCapabilityGuard('Docs', DocsScreen),
      HeartbeatSettings: withConsoleCapabilityGuard('HeartbeatSettings', HeartbeatSettingsScreen),
      ChatHistory: withConsoleCapabilityGuard('ChatHistory', ChatHistoryScreen),
      SessionsBoard: withConsoleCapabilityGuard('SessionsBoard', SessionsBoardScreen),
      AgentSessionsBoard: withConsoleCapabilityGuard('AgentSessionsBoard', AgentSessionsBoardScreen),
      ChatHistoryDetail: withConsoleCapabilityGuard('ChatHistoryDetail', ChatHistoryDetailScreen),
      FavoriteMessageDetail: withConsoleCapabilityGuard('FavoriteMessageDetail', FavoriteMessageDetailScreen),
    }),
    [],
  );

  return (
    <ConsoleStack.Navigator screenOptions={screenOptions.defaultScreenOptions}>
      <ConsoleStack.Screen name="ConsoleMenu" component={guardedConsoleMenuScreen} />
      {renderConsoleModalScreens({
        ...screenOptions,
        renderScreen: (name, component, options) => (
          <ConsoleStack.Screen
            key={name}
            name={name}
            component={guardedScreens[name] ?? component}
            options={options}
          />
        ),
      })}
    </ConsoleStack.Navigator>
  );
}

const styles = StyleSheet.create({
  unsupportedRoot: {
    flex: 1,
    justifyContent: 'center',
  },
});
