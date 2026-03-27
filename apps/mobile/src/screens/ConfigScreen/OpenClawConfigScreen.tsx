import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Archive, ChevronRight, Eye, RotateCcw, Stethoscope } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { CopyableCommand } from '../../components/config/CopyableCommand';
import { createCardContentStyle, ModalSheet } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { StorageService } from '../../services/storage';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConfigStackParamList } from './ConfigTab';
import { useGatewayRuntimeSettings } from './hooks/useGatewayRuntimeSettings';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawConfig'>;

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
  const { requirePro } = useProPaywall();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [backingUpConfig, setBackingUpConfig] = useState(false);
  const [doctorModalVisible, setDoctorModalVisible] = useState(false);
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
    if (!requirePro('configBackups')) return;
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
    if (!requirePro('configBackups')) return;
    navigation.navigate('GatewayConfigBackups');
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

  useNativeStackModalHeader({
    navigation,
    title: t('OPENCLAW CONFIG'),
    onClose: () => navigation.goBack(),
  });

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
              <Archive size={17} strokeWidth={2.2} color="#D96C1F" fill="#D96C1F" />
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
              </View>
            </View>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.secondaryCard}>
        <Pressable
          onPress={() => setDoctorModalVisible(true)}
          style={({ pressed }) => [
            styles.row,
            pressed && styles.rowPressed,
          ]}
        >
          <View style={styles.rowLead}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#EDE9FE' }]}>
              <Stethoscope size={17} strokeWidth={2.2} color="#7C3AED" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('Diagnose & Fix')}</Text>
              <Text style={styles.rowSubtitle}>
                {t('Auto-detect and repair common OpenClaw issues')}
              </Text>
            </View>
          </View>
          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        </Pressable>
      </View>

      <ModalSheet
        visible={doctorModalVisible}
        onClose={() => setDoctorModalVisible(false)}
        title={t('Diagnose & Fix')}
      >
        <View style={styles.doctorContent}>
          <Text style={styles.doctorDescription}>
            {t('Run the following command on your host machine to automatically detect and fix common OpenClaw configuration issues:')}
          </Text>
          <CopyableCommand command="openclaw doctor --fix" />
          <Text style={styles.doctorHint}>
            {t('This command checks gateway connectivity, config validity, port availability, and auth setup — then applies fixes automatically where possible.')}
          </Text>
          <Text style={styles.doctorDiagnoseOnly}>
            {t('To diagnose without applying fixes:')}
          </Text>
          <CopyableCommand command="openclaw doctor" />
        </View>
      </ModalSheet>
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
    doctorContent: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.lg,
      gap: Space.md,
    },
    doctorDescription: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: 22,
    },
    doctorHint: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    doctorDiagnoseOnly: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      marginTop: Space.sm,
    },
  });
}
