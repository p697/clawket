import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, HeaderActionButton, LoadingState, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { analyticsEvents } from '../../services/analytics/events';
import { GatewayConfigBackupSummary, StorageService } from '../../services/storage';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import type { ConfigStackParamList } from './ConfigTab';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'GatewayConfigBackups'>;

export function GatewayConfigBackupsScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t, i18n } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const { gateway, config: activeGatewayConfig } = useAppContext();
  const { requirePro } = useProPaywall();
  const { setWithRestart } = useGatewayPatch(gateway);
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [backups, setBackups] = useState<GatewayConfigBackupSummary[]>([]);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const nextBackups = await StorageService.listGatewayConfigBackups();
      setBackups(nextBackups);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Unable to load backups');
      Alert.alert(t('Unable to load backups'), message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleRestore = useCallback(async (backupId: string) => {
    if (!requirePro('configBackupRestore')) return;
    if (!activeGatewayConfig?.url) {
      Alert.alert(t('No Active Gateway'), t('Current Gateway connection is required to restore a backup.'));
      return;
    }
    setRestoringId(backupId);
    try {
      const backup = await StorageService.getGatewayConfigBackup(backupId);
      if (!backup) {
        Alert.alert(t('Backup unavailable'), t('This backup could not be read. It may be corrupted.'));
        return;
      }
      const latest = await gateway.getConfig();
      if (!latest.hash) {
        Alert.alert(t('Settings Unavailable'), t('Gateway config hash is missing. Please refresh and try again.'));
        return;
      }
      analyticsEvents.gatewayConfigRestoreTapped({
        source: 'config_backup_list',
        backup_count: backups.length,
      });
      await setWithRestart({
        config: backup.config,
        configHash: latest.hash,
        confirmation: {
          title: t('Restore Backup'),
          message: t('Restore this config backup to OpenClaw? This will replace the current OpenClaw config and restart Gateway.'),
          confirmText: t('Restore'),
          cancelText: t('common:Cancel'),
        },
        savingMessage: t('Restoring backup...'),
        onSuccess: async () => {
          await loadBackups();
        },
      });
    } finally {
      setRestoringId(null);
    }
  }, [activeGatewayConfig?.url, backups.length, gateway, loadBackups, requirePro, setWithRestart, t]);

  const handleDelete = useCallback((backup: GatewayConfigBackupSummary) => {
    Alert.alert(
      t('Delete Backup'),
      t('Delete this local config backup? This does not change the current Gateway config.'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingId(backup.id);
              try {
                await StorageService.deleteGatewayConfigBackup(backup.id);
                await loadBackups();
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : t('Unable to delete backup');
                Alert.alert(t('Unable to delete backup'), message);
              } finally {
                setDeletingId(null);
              }
            })();
          },
        },
      ],
    );
  }, [loadBackups, t]);

  useNativeStackModalHeader({
    navigation,
    title: t('Restore Backup'),
    onClose: () => navigation.goBack(),
    rightContent: (
      <HeaderActionButton
        icon={RefreshCw}
        onPress={() => {
          void loadBackups();
        }}
        size={20}
      />
    ),
  });

  const formatCreatedAt = useCallback((createdAt: number) => {
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(createdAt));
  }, [i18n.language]);

  if (loading) {
    return <LoadingState message={t('Loading...')} />;
  }

  return (
    <ScrollView contentContainerStyle={[createCardContentStyle(), backups.length === 0 ? { flexGrow: 1 } : null]}>
      {backups.length > 0 ? (
        <Text style={styles.sectionTitle}>{t('Choose the backup version you want to restore')}</Text>
      ) : null}

      {backups.length === 0 ? (
        <EmptyState
          icon="🗂"
          title={t('No backups yet')}
          subtitle={t('Create a backup from Settings to make rollback safer.')}
        />
      ) : (
        <View style={styles.listCard}>
          {backups.map((backup, index) => {
            const disabled = restoringId !== null || deletingId !== null;
            return (
              <React.Fragment key={backup.id}>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{formatCreatedAt(backup.createdAt)}</Text>
                    <Text style={styles.rowMeta}>{t('Created {{date}}', { date: formatCreatedAt(backup.createdAt) })}</Text>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => {
                        void handleRestore(backup.id);
                      }}
                      style={({ pressed }) => [
                        styles.restoreButton,
                        pressed && styles.restoreButtonPressed,
                        disabled && styles.restoreButtonDisabled,
                      ]}
                      disabled={disabled}
                    >
                      <Text style={styles.restoreButtonText}>{t('Restore')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        handleDelete(backup);
                      }}
                      style={({ pressed }) => [
                        styles.deleteButton,
                        pressed && styles.deleteButtonPressed,
                        disabled && styles.restoreButtonDisabled,
                      ]}
                      disabled={disabled}
                    >
                      <Text style={styles.deleteButtonText}>{t('Delete')}</Text>
                    </Pressable>
                  </View>
                </View>
                {index < backups.length - 1 ? <View style={styles.divider} /> : null}
              </React.Fragment>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sectionTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      marginBottom: Space.md,
      marginTop: Space.md,
    },
    listCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    row: {
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    rowText: {
      flex: 1,
      gap: Space.xs,
    },
    rowTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    rowMeta: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    restoreButton: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: 10,
    },
    restoreButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    restoreButtonDisabled: {
      opacity: 0.5,
    },
    restoreButtonText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    deleteButton: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: 10,
    },
    deleteButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    deleteButtonText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.error,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: Space.md,
    },
  });
}
