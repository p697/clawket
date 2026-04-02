import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { ToolsView, ToolsViewHandle } from '../../components/console/ToolsView';
import { useTranslation } from 'react-i18next';
import { HeaderActionButton, SegmentedTabs } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppTheme } from '../../theme';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { useGatewayToolSettings } from '../ConfigScreen/hooks/useGatewayToolSettings';
import { ToolSettingsContent, openOpenClawPermissions } from '../ConfigScreen/GatewayToolsScreen';
import { getGatewayDisabledToolIds } from '../../utils/gateway-tool-settings';
import type { ConsoleStackParamList } from './ConsoleTab';

type ToolsNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'ToolList'>;

type ToolsTab = 'settings' | 'catalog';

export function ToolsScreen(): React.JSX.Element {
  const { gateway, gatewayEpoch, currentAgentId, agents, config: initialConfig } = useAppContext();
  const { t } = useTranslation('console');
  const toolsTabs = useMemo<{ key: ToolsTab; label: string }[]>(() => [
    { key: 'settings', label: t('Basics') },
    { key: 'catalog', label: t('All Tools') },
  ], [t]);
  const currentAgentName = useMemo(
    () => agents.find((a) => a.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );
  const { requirePro } = useProPaywall();
  const { theme } = useAppTheme();
  const tabBarHeight = useTabBarHeight();
  const navigation = useNavigation<ToolsNavigation>();
  const [tab, setTab] = useState<ToolsTab>('settings');
  const toolsViewRef = useRef<ToolsViewHandle>(null);

  const hasActiveGateway = Boolean(initialConfig?.url);
  const toolSettings = useGatewayToolSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway,
  });

  const gatewayDisabledToolIds = useMemo(
    () => getGatewayDisabledToolIds({
      webSearchEnabled: toolSettings.webSearchEnabled,
      webFetchEnabled: toolSettings.webFetchEnabled,
      execSecurity: toolSettings.execSecurity,
      execAsk: toolSettings.execAsk,
      mediaImageEnabled: toolSettings.mediaImageEnabled,
      mediaAudioEnabled: toolSettings.mediaAudioEnabled,
      mediaVideoEnabled: toolSettings.mediaVideoEnabled,
      linksEnabled: toolSettings.linksEnabled,
    }),
    [
      toolSettings.webSearchEnabled,
      toolSettings.webFetchEnabled,
      toolSettings.execSecurity,
      toolSettings.mediaImageEnabled,
      toolSettings.mediaAudioEnabled,
      toolSettings.mediaVideoEnabled,
      toolSettings.linksEnabled,
    ],
  );

  const handleRefresh = useCallback(() => {
    if (tab === 'settings') {
      void toolSettings.loadToolSettings();
    } else {
      toolsViewRef.current?.refresh();
    }
  }, [tab, toolSettings]);

  const handleOpenPermissions = useCallback(() => {
    if (!requirePro('openclawPermissions')) return;
    openOpenClawPermissions(navigation);
  }, [navigation, requirePro]);

  const styles = useMemo(() => createStyles(theme.colors.background), [theme]);
  const headerRight = useMemo(
    () => (
      <HeaderActionButton icon={RefreshCw} onPress={handleRefresh} />
    ),
    [handleRefresh],
  );

  useNativeStackModalHeader({
    navigation,
    title: t('Tools'),
    rightContent: headerRight,
    onClose: () => navigation.goBack(),
  });

  return (
    <View style={styles.root}>
      <SegmentedTabs tabs={toolsTabs} active={tab} onSwitch={setTab} />

      {tab === 'settings' ? (
        <ToolSettingsContent
          colors={theme.colors}
          toolSettings={toolSettings}
          hasActiveGateway={hasActiveGateway}
          tabBarHeight={tabBarHeight}
          onOpenPermissions={handleOpenPermissions}
        />
      ) : (
        <ToolsView
          ref={toolsViewRef}
          gateway={gateway}
          agentId={currentAgentId}
          agentName={currentAgentName}
          topInset={0}
          onBack={() => navigation.goBack()}
          hideHeader
          gatewayDisabledToolIds={gatewayDisabledToolIds}
        />
      )}
    </View>
  );
}

function createStyles(background: string) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: background,
    },
  });
}
