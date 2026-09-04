import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
} from '@react-navigation/native-stack';
import { NativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppTheme } from '../../theme';
import { ConfigScreen } from './index';
import { ChatAppearanceScreen } from './ChatAppearanceScreen';
import { HelpCenterScreen } from './HelpCenterScreen';
import { OpenClawReleasesScreen } from './OpenClawReleasesScreen';
import { GatewayConfigViewerScreen } from './GatewayConfigViewerScreen';
import { GatewayConfigBackupsScreen } from './GatewayConfigBackupsScreen';
import { ReleaseNotesHistoryScreen } from './ReleaseNotesHistoryScreen';
import { OpenClawConfigScreen } from './OpenClawConfigScreen';
import { OpenClawDiagnosticsScreen } from './OpenClawDiagnosticsScreen';
import { OpenClawPermissionRepairScreen } from './OpenClawPermissionRepairScreen';
import { OpenClawPermissionsScreen } from './OpenClawPermissionsScreen';
import { DesignSystemScreen } from './DesignSystemScreen';
import type { DoctorResult } from '@clawket/agent-protocol';

export type ConfigStackParamList = {
  ConfigHome: {
    addConnectionRequestAt?: number;
    addConnectionTab?: 'quick' | 'manual';
    addConnectionFlow?: 'local' | 'youmind';
  } | undefined;
  ChatAppearance: undefined;
  HelpCenter: undefined;
  ReleaseNotesHistory: undefined;
  OpenClawReleases: undefined;
  OpenClawConfig: undefined;
  OpenClawDiagnostics: {
    mode?: 'doctor' | 'fix';
    doctorResult?: DoctorResult;
    doctorError?: string;
    fixResult?: {
      ok: boolean;
      raw?: string;
    };
    fixError?: string;
  };
  OpenClawPermissionRepair: undefined;
  OpenClawPermissions: undefined;
  GatewayConfigViewer: undefined;
  GatewayConfigBackups: undefined;
  DesignSystem: undefined;
};

const ConfigStack = createNativeStackNavigator<ConfigStackParamList>();

export function ConfigTab(): React.JSX.Element {
  const { theme } = useAppTheme();
  const contentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );
  const modalContentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );

  const modalScreenOptions = useMemo(() => {
    if (Platform.OS !== 'ios') {
      return {
        animation: 'slide_from_right' as const,
        contentStyle: modalContentStyle,
        headerShown: true,
        header: (props: NativeStackHeaderProps) => (
          <NativeStackModalHeader {...props} dismissStyleOverride="close" />
        ),
      };
    }
    return {
      animation: 'slide_from_bottom' as const,
      presentation: 'modal' as const,
      contentStyle: modalContentStyle,
      gestureEnabled: true,
      headerShown: true,
      header: (props: NativeStackHeaderProps) => (
        <NativeStackModalHeader {...props} dismissStyleOverride="close" />
      ),
    };
  }, [modalContentStyle]);

  return (
    <ConfigStack.Navigator
      screenOptions={{
        headerShown: false,
        header: (props: NativeStackHeaderProps) => <NativeStackModalHeader {...props} />,
        headerBackTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        contentStyle,
      }}
    >
      <ConfigStack.Screen name="ConfigHome" component={ConfigScreen} />
      <ConfigStack.Screen name="ChatAppearance" component={ChatAppearanceScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="HelpCenter" component={HelpCenterScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="ReleaseNotesHistory" component={ReleaseNotesHistoryScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawReleases" component={OpenClawReleasesScreen} />
      <ConfigStack.Screen name="OpenClawConfig" component={OpenClawConfigScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawDiagnostics" component={OpenClawDiagnosticsScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawPermissionRepair" component={OpenClawPermissionRepairScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawPermissions" component={OpenClawPermissionsScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="GatewayConfigViewer" component={GatewayConfigViewerScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="GatewayConfigBackups" component={GatewayConfigBackupsScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="DesignSystem" component={DesignSystemScreen} options={modalScreenOptions} />
    </ConfigStack.Navigator>
  );
}
