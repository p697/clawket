import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { CopyableCommand } from './CopyableCommand';
import { QuickConnectGuideCard } from './QuickConnectGuideCard';
import { ConnectionHelpStep, ConnectionHelpStepList } from './ConnectionHelpStepList';

type ManualConnectionMode = 'relay' | 'custom';

type Props = {
  activeMode: ManualConnectionMode;
};

function useSteps(
  activeMode: ManualConnectionMode,
  styles: ReturnType<typeof createStyles>,
  t: (key: string, options?: Record<string, unknown>) => string,
): ConnectionHelpStep[] {
  if (activeMode === 'relay') {
    return [
      {
        title: t('Pair your computer first'),
        body: (
          <Text style={styles.helpText}>
            {t('The recommended flow is to run {{command}} on your computer and scan one of the generated QR codes.', {
              command: 'clawket pair',
            })}
          </Text>
        ),
      },
      {
        title: 'Manual Relay details',
        body: (
          <Text style={styles.helpText}>
            If you are entering values manually, use the fixed Relay WebSocket URL, pair server URL, gateway ID, and auth credential from that paired machine.
          </Text>
        ),
      },
      {
        title: t('Save & Connect'),
        body: (
          <Text style={styles.helpText}>
            Tap <Text style={styles.helpBold}>{t('Save & Connect')}</Text>. Clawket will connect directly to Relay using the imported pairing details.
          </Text>
        ),
      },
    ];
  }

  return [
    {
      title: t('Enter the gateway URL'),
      body: (
        <>
          <Text style={styles.helpText}>{t('Use one of these common URL formats:')}</Text>
          <Text style={styles.urlExampleLabel}>{t('Connect over your local network.')}</Text>
          <CopyableCommand command="ws://192.168.x.x:18789" />
          <Text style={styles.urlExampleLabel}>{t('Connect via Tailscale or tunnel software.')}</Text>
          <CopyableCommand command="ws://100.x.x.x:18789" />
          <Text style={styles.urlExampleLabel}>{t('Connect via Cloudflare Tunnel.')}</Text>
          <CopyableCommand command="wss://xxx.trycloudflare.com" />
        </>
      ),
    },
    {
      title: t('Get {{label}}', { label: t('Auth Token or Password') }),
      body: (
        <>
          <Text style={styles.helpTextMuted}>
            {t('Open openclaw.json and find gateway.auth.token or gateway.auth.password to get this credential.')}
          </Text>
          <Text style={[styles.helpTextMuted, styles.helpTextMutedSpacing]}>
            {t(
              'Your auth credential is stored securely on this device and used only for handshakes with your OpenClaw Gateway over LAN, Tailscale, or your own Relay.',
            )}
          </Text>
        </>
      ),
    },
  ];
}

export function ConnectionHelpQuick(): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.title}>{t('How to Connect')}</Text>
      <QuickConnectGuideCard />
    </View>
  );
}

/** Manual tab — shows step-by-step instructions, always expanded */
export function ConnectionHelpManual({ activeMode }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('config');
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const steps = useSteps(activeMode, styles, t);

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.title}>{t('How to Connect')}</Text>
      <View style={styles.container}>
        <ConnectionHelpStepList steps={steps} />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sectionContainer: {
      marginTop: Space.lg,
      gap: Space.sm,
    },
    container: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      padding: Space.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    helpText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 18,
    },
    helpTextMuted: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      lineHeight: 17,
      marginTop: 3,
    },
    helpTextMutedSpacing: {
      marginTop: Space.sm,
    },
    urlExampleLabel: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      marginTop: Space.sm,
      marginBottom: Space.xs,
      lineHeight: 17,
    },
    helpBold: {
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
  });
}
