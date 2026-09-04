import React, { useMemo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import { Button, Card } from '../ui';

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
      <Card style={styles.pairingCard} elevation="floating" padding="lg">
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

            <Button label={copied ? t('Copied!', { ns: 'common' }) : t('Copy Command')} onPress={onCopy} style={styles.copyBtn} />
          </>
        )}

        <View style={styles.pairingStatusRow}>
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
          <Text style={styles.pairingStatusText}>{t('Waiting for approval\u2026')}</Text>
        </View>

        <Text style={styles.pairingHint}>{t('The app will connect automatically once approved.')}</Text>

        {onRetry && (
          <Button label={t('Retry Now', { ns: 'common' })} variant="secondary" size="sm" onPress={onRetry} style={styles.retryBtn} />
        )}
      </Card>
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
      borderRadius: Radius.md,
      width: '100%',
      alignItems: 'center',
    },
    pairingEmoji: {
      fontSize: FontSize.hero,
      marginBottom: 16,
    },
    pairingTitle: {
      fontSize: FontSize.displaySm,
      fontWeight: FontWeight.bold,
      color: colors.text,
      marginBottom: Space.sm,
    },
    pairingDesc: {
      fontSize: FontSize.bodySm,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: LineHeight.md,
      marginBottom: Space.lg + Space.xs,
    },
    commandContainer: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radius.sm + 2,
      borderWidth: StyleSheet.hairlineWidth,
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
      width: '100%',
      marginBottom: Space.xl,
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
    },
  });
}
