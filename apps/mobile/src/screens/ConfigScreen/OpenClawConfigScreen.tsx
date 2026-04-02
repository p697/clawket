import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Archive,
  ChevronRight,
  CircleAlert,
  Eye,
  RotateCcw,
  Shield,
  Stethoscope,
  Wrench,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { CopyableCommand } from '../../components/config/CopyableCommand';
import { createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayOverlay } from '../../contexts/GatewayOverlayContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { StorageService } from '../../services/storage';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConfigStackParamList } from './ConfigTab';
import { useGatewayRuntimeSettings } from './hooks/useGatewayRuntimeSettings';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawConfig'>;

const UPDATE_CLAWKET_CLI_COMMAND = 'npm install -g @p697/clawket@latest';
const RESTART_CLAWKET_CLI_COMMAND = 'clawket restart';

type ActionRowProps = {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  styles: ReturnType<typeof createStyles>;
  chevronColor: string;
};

function ActionRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
  styles,
  chevronColor,
}: ActionRowProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      disabled={disabled}
    >
      <View style={styles.rowLead}>
        {icon}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={chevronColor} strokeWidth={2} />
    </Pressable>
  );
}

export function OpenClawConfigScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const { gateway, config: activeGatewayConfig, gatewayEpoch } = useAppContext();
  const { showOverlay, hideOverlay } = useGatewayOverlay();
  const { requirePro } = useProPaywall();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [backingUpConfig, setBackingUpConfig] = useState(false);
  const [runningDoctor, setRunningDoctor] = useState(false);
  const [runningAutoFix, setRunningAutoFix] = useState(false);
  const [actionLoadingVisible, setActionLoadingVisible] = useState(false);
  const runtimeSettings = useGatewayRuntimeSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway: Boolean(activeGatewayConfig?.url),
  });

  const handleViewConfigPress = useCallback(() => {
    if (!activeGatewayConfig?.url) {
      Alert.alert(t('No Active Gateway'), t('Please add and activate a gateway connection first.'));
      return;
    }
    navigation.navigate('GatewayConfigViewer');
  }, [activeGatewayConfig?.url, navigation, t]);

  const handleBackupConfigPress = useCallback(async () => {
    if (backingUpConfig) return;
    if (!requirePro('configBackupCreate')) return;
    if (!activeGatewayConfig?.url) {
      Alert.alert(t('No Active Gateway'), t('Please add and activate a gateway connection first.'));
      return;
    }

    setBackingUpConfig(true);
    try {
      const result = await gateway.getConfig();
      if (!result.config) {
        Alert.alert(t('Settings Unavailable'), t('No config returned from Gateway.'));
        return;
      }

      await StorageService.saveGatewayConfigBackup(result.config);
      const backups = await StorageService.listGatewayConfigBackups();
      analyticsEvents.gatewayConfigBackupCreated({
        source: 'config_screen',
        backup_count: backups.length,
      });
      Alert.alert(t('Saved'), t('Config backup created.'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to create config backup');
      Alert.alert(t('Failed to create config backup'), message);
    } finally {
      setBackingUpConfig(false);
    }
  }, [activeGatewayConfig?.url, backingUpConfig, gateway, requirePro, t]);

  const handleRestoreConfigPress = useCallback(() => {
    if (!requirePro('configBackupRestore')) return;
    navigation.navigate('GatewayConfigBackups');
  }, [navigation, requirePro]);

  const handlePermissionsPress = useCallback(() => {
    if (!requirePro('openclawPermissions')) return;
    navigation.navigate('OpenClawPermissions');
  }, [navigation, requirePro]);

  const handleRestartGatewayConfirm = useCallback(() => {
    Alert.alert(
      t('Restart Current Gateway?'),
      t('This will temporarily disconnect the app while the Gateway restarts.'),
      [
        { text: t('common:Cancel'), style: 'cancel' as const },
        {
          text: t('Restart'),
          onPress: () => {
            void runtimeSettings.restartGateway();
          },
        },
      ],
    );
  }, [runtimeSettings, t]);

  const handleDoctorPress = useCallback(async () => {
    if (runningDoctor) return;
    if (!requirePro('openclawDiagnostics')) return;
    setRunningDoctor(true);
    setActionLoadingVisible(true);
    showOverlay(t('Running openclaw doctor...'));

    const openDiagnostics = (params: ConfigStackParamList['OpenClawDiagnostics']) => {
      hideOverlay();
      setActionLoadingVisible(false);
      requestAnimationFrame(() => {
        navigation.navigate('OpenClawDiagnostics', params);
      });
    };

    try {
      const result = await gateway.requestDoctor();
      openDiagnostics({ mode: 'doctor', doctorResult: result });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      let doctorError = raw || t('Doctor command failed.');
      if (raw === 'NOT_RELAY') {
        doctorError = t('Diagnostics require a relay connection. Connect via Clawket Bridge to use this feature.');
      } else if (raw === 'NOT_CONNECTED') {
        doctorError = t('Not connected to gateway.');
      }
      openDiagnostics({ mode: 'doctor', doctorError });
    } finally {
      hideOverlay();
      setRunningDoctor(false);
    }
  }, [gateway, hideOverlay, navigation, requirePro, runningDoctor, showOverlay, t]);

  const handleAutoFixPress = useCallback(async () => {
    if (runningAutoFix) return;
    if (!requirePro('openclawDiagnostics')) return;
    setRunningAutoFix(true);
    setActionLoadingVisible(true);
    showOverlay(t('Running openclaw doctor --fix...'));

    const openDiagnostics = (params: ConfigStackParamList['OpenClawDiagnostics']) => {
      hideOverlay();
      setActionLoadingVisible(false);
      requestAnimationFrame(() => {
        navigation.navigate('OpenClawDiagnostics', params);
      });
    };

    try {
      const result = await gateway.requestDoctorFix();
      openDiagnostics({ mode: 'fix', fixResult: result });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      let fixError = raw || t('Fix command failed.');
      if (raw === 'NOT_RELAY') {
        fixError = t('Diagnostics require a relay connection. Connect via Clawket Bridge to use this feature.');
      } else if (raw === 'NOT_CONNECTED') {
        fixError = t('Not connected to gateway.');
      }
      openDiagnostics({ mode: 'fix', fixError });
    } finally {
      hideOverlay();
      setRunningAutoFix(false);
    }
  }, [gateway, hideOverlay, navigation, requirePro, runningAutoFix, showOverlay, t]);

  const confirmAbortRunning = useCallback((onConfirm: () => void) => {
    Alert.alert(
      t('Confirm Exit?'),
      t('Exit now? This will interrupt the current operation.'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('common:Exit'),
          style: 'destructive',
          onPress: onConfirm,
        },
      ],
    );
  }, [t]);

  usePreventRemove(actionLoadingVisible, ({ data }) => {
    confirmAbortRunning(() => {
      hideOverlay();
      setActionLoadingVisible(false);
      navigation.dispatch(data.action);
    });
  });

  useNativeStackModalHeader({
    navigation,
    title: t('OPENCLAW CONFIG'),
    onClose: () => {
      if (actionLoadingVisible) {
        confirmAbortRunning(() => {
          hideOverlay();
          setActionLoadingVisible(false);
          navigation.goBack();
        });
        return;
      }
      navigation.goBack();
    },
  });

  const hasActiveGateway = Boolean(activeGatewayConfig?.url);
  const isRelayRoute = hasActiveGateway && gateway.getConnectionRoute() === 'relay';
  const updateAgentPrompt = t('Please first upgrade the installed clawket client on this computer by running `npm install -g @p697/clawket@latest`, then run `clawket restart` after the installation completes.');

  return (
    <ScrollView contentContainerStyle={createCardContentStyle()}>
      <View style={styles.card}>
        <ActionRow
          title={t('View Config')}
          subtitle={t('View the current complete OpenClaw config')}
          onPress={handleViewConfigPress}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#E7F0FF' }]}>
              <Eye size={17} strokeWidth={2.2} color="#2F6BFF" />
            </View>
          )}
        />

        <View style={styles.divider} />

        <ActionRow
          title={backingUpConfig ? t('Creating backup...') : t('Back Up Config')}
          subtitle={t('Back up the current complete OpenClaw config')}
          onPress={() => {
            void handleBackupConfigPress();
          }}
          disabled={backingUpConfig}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#FFF1E5' }]}>
              <Archive size={17} strokeWidth={2.2} color="#D96C1F" />
            </View>
          )}
        />

        <View style={styles.divider} />

        <ActionRow
          title={t('Restore Backup')}
          subtitle={t('Restore the OpenClaw config from a backup')}
          onPress={handleRestoreConfigPress}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#E9F8EE' }]}>
              <RotateCcw size={17} strokeWidth={2.25} color="#248A4D" />
            </View>
          )}
        />
      </View>

      {activeGatewayConfig?.url ? (
        <View style={styles.secondaryCard}>
          <Pressable
            onPress={handleRestartGatewayConfirm}
            style={({ pressed }) => [
              styles.row,
              pressed && !runtimeSettings.restartingGateway && styles.rowPressed,
              (runtimeSettings.loadingGatewaySettings
                || runtimeSettings.savingGatewaySettings
                || runtimeSettings.restartingGateway)
                && styles.rowDisabled,
            ]}
            disabled={
              runtimeSettings.loadingGatewaySettings
              || runtimeSettings.savingGatewaySettings
              || runtimeSettings.restartingGateway
            }
          >
            <View style={styles.rowLead}>
              <View style={[styles.rowIconBadge, { backgroundColor: '#FFF4D6' }]}>
                <RotateCcw size={17} strokeWidth={2.25} color="#D79A00" />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {runtimeSettings.restartingGateway ? t('common:Loading...') : t('Restart Current Gateway')}
                </Text>
                <Text style={styles.rowSubtitle}>
                  {t('Restart after changing config or making certain updates to ensure they take effect')}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.secondaryCard}>
        <ActionRow
          title={t('OpenClaw Permission Management')}
          subtitle={t('View and adjust common OpenClaw permissions')}
          onPress={handlePermissionsPress}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#E8F1FF' }]}>
              <Shield size={17} strokeWidth={2.2} color="#2563EB" />
            </View>
          )}
        />

        <View style={styles.divider} />

        <Pressable
          onPress={() => { void handleDoctorPress(); }}
          style={({ pressed }) => [
            styles.row,
            pressed && !runningDoctor && styles.rowPressed,
            (runningDoctor || runningAutoFix || !hasActiveGateway) && styles.rowDisabled,
          ]}
          disabled={runningDoctor || runningAutoFix || !hasActiveGateway}
        >
          <View style={styles.rowLead}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#EDE9FE' }]}>
              <Stethoscope size={17} strokeWidth={2.2} color="#7C3AED" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {runningDoctor ? t('Running diagnostics...') : t('Status Diagnostics')}
              </Text>
              <Text style={styles.rowSubtitle}>
                {isRelayRoute
                  ? t('Remotely run diagnostics on your OpenClaw instance')
                  : t('Requires relay connection to bridge')}
              </Text>
            </View>
          </View>
          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        </Pressable>

        <View style={styles.divider} />

        <Pressable
          onPress={() => { void handleAutoFixPress(); }}
          style={({ pressed }) => [
            styles.row,
            pressed && !runningAutoFix && styles.rowPressed,
            (runningDoctor || runningAutoFix || !hasActiveGateway) && styles.rowDisabled,
            ]}
          disabled={runningDoctor || runningAutoFix || !hasActiveGateway}
        >
          <View style={styles.rowLead}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#E9F8EE' }]}>
              <Wrench size={17} strokeWidth={2.25} color="#248A4D" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {runningAutoFix ? t('Running fix...') : t('Auto Fix')}
              </Text>
              <Text style={styles.rowSubtitle}>{t('Run openclaw doctor --fix')}</Text>
            </View>
          </View>
          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.secondaryCard}>
        <View style={styles.noticeCard}>
          <View style={styles.noticeHeader}>
            <CircleAlert size={16} strokeWidth={2} color={theme.colors.primary} />
            <Text style={styles.noticeTitle}>{t('Keep Clawket CLI up to date')}</Text>
          </View>
          <Text style={styles.noticeBody}>
            {t('When using advanced features, make sure your Clawket CLI is on the latest version.')}
          </Text>
          <Text style={styles.noticeBody}>
            {t('If an advanced feature fails, try updating the package first. You can copy the command below and ask Agent to run it, or run it manually yourself.')}
          </Text>
          <Text style={styles.noticeLabel}>{t('Upgrade command')}</Text>
          <CopyableCommand command={UPDATE_CLAWKET_CLI_COMMAND} />
          <Text style={styles.noticeBody}>
            {t('After the update finishes, please run `clawket restart` as well to ensure the new version takes effect.')}
          </Text>
          <Text style={styles.noticeLabel}>{t('Restart command')}</Text>
          <CopyableCommand command={RESTART_CLAWKET_CLI_COMMAND} />
          <Text style={styles.noticeBody}>
            {t('If you want Agent to handle the whole process, copy the prompt below and send it directly.')}
          </Text>
          <Text style={styles.noticeLabel}>{t('Prompt for Agent')}</Text>
          <CopyableCommand command={updateAgentPrompt} multiline />
        </View>
      </View>

    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      marginTop: Space.xs,
    },
    secondaryCard: {
      marginTop: Space.lg,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    row: {
      minHeight: 72,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    rowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    rowLead: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      minWidth: 0,
    },
    rowIconBadge: {
      width: 32,
      height: 32,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowSubtitle: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
      lineHeight: 18,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
      marginLeft: Space.lg,
    },
    noticeCard: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.lg,
      gap: Space.sm,
      backgroundColor: colors.surface,
    },
    noticeHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    noticeTitle: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    noticeBody: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    noticeLabel: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      marginTop: 2,
    },
  });
}
