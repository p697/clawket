import React, { useMemo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';

type Props = {
  approveCommand: string;
  copied: boolean;
  onCopy: () => void;
  connectionMode?: 'relay' | 'local' | 'tailscale' | 'cloudflare' | 'custom' | 'hermes';
  onRetry?: () => void;
};

export function PairingPendingCard({ approveCommand, copied, onCopy, connectionMode, onRetry }: Props): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const isRelayMode = connectionMode === 'relay';

  return (
    <View style={styles.pairingContainer}>
      <View style={styles.pairingCard}>
        <Text style={styles.pairingEmoji}>🔐</Text>
        <Text style={styles.pairingTitle}>{t('Device Pairing Required')}</Text>

        {isRelayMode ? (
          <Text style={styles.pairingDesc}>
            {t('Pairing instruction bridge')}
          </Text>
        ) : (
          <>
            <Text style={styles.pairingDesc}>
              {t('Pairing instruction gateway')}
            </Text>

            <View style={styles.commandContainer}>
              <Text style={styles.commandText} selectable>{approveCommand}</Text>
            </View>

            <TouchableOpacity style={styles.copyBtn} onPress={onCopy} activeOpacity={0.7}>
              <Text style={styles.copyBtnText}>{copied ? t('Copied!', { ns: 'common' }) : t('Copy Command')}</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.pairingStatusRow}>
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
          <Text style={styles.pairingStatusText}>{t('Waiting for approval\u2026')}</Text>
        </View>

        <Text style={styles.pairingHint}>{t('The app will connect automatically once approved.')}</Text>

        {onRetry && (
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
            <Text style={styles.retryBtnText}>{t('Retry Now', { ns: 'common' })}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    pairingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Space.xl,
    },
    pairingCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg - 4,
      padding: 28,
      width: '100%',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      ...Shadow.md,
    },
    pairingEmoji: {
      fontSize: 48,
      marginBottom: 16,
    },
    pairingTitle: {
      fontSize: FontSize.lg + 4,
      fontWeight: FontWeight.bold,
      color: colors.text,
      marginBottom: Space.sm,
    },
    pairingDesc: {
      fontSize: FontSize.md + 1,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: Space.lg + Space.xs,
    },
    commandContainer: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Space.lg - 2,
      paddingHorizontal: Space.lg,
      width: '100%',
      marginBottom: Space.md,
    },
    commandText: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      fontSize: FontSize.md,
      color: colors.textMuted,
      textAlign: 'center',
    },
    copyBtn: {
      backgroundColor: colors.primary,
      borderRadius: Radius.sm + 2,
      paddingVertical: Space.md,
      paddingHorizontal: Space.xl,
      width: '100%',
      alignItems: 'center',
      marginBottom: Space.xl,
    },
    copyBtnText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    pairingStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    pairingStatusText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      marginLeft: Space.sm,
    },
    pairingHint: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      textAlign: 'center',
    },
    retryBtn: {
      marginTop: Space.lg,
      paddingVertical: Space.sm + 2,
      paddingHorizontal: Space.xl,
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    retryBtnText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
  });
}
