import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ImageUp, ScanLine } from 'lucide-react-native';
import { useGatewayScanner } from '../../contexts/GatewayScannerContext';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';
import { Button, FormTextInput } from '../ui';
import { CopyableCommand } from './CopyableCommand';

type Props = {
  serverUrl: string;
  pairCommand: string;
  onScanQr?: () => void;
  onUploadQr: () => void;
  onConnected: () => void;
};

export function PairingCodeCard({
  serverUrl,
  pairCommand,
  onScanQr,
  onUploadQr,
  onConnected,
}: Props): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const { connectPairingCode } = useGatewayScanner();
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [otherMethodsExpanded, setOtherMethodsExpanded] = useState(false);
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (await connectPairingCode({ serverUrl, pairingCode })) onConnected();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('Connect to your computer')}</Text>
      <Text style={styles.description}>{t('Run one command, then enter the pairing code it shows.')}</Text>

      <View style={styles.step}>
        <View style={styles.stepHeader}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>1</Text>
          </View>
          <Text style={styles.stepTitle}>{t('Get a pairing code')}</Text>
        </View>
        <Text style={styles.stepDescription}>
          {t('On the computer running OpenClaw, run this command:')}
        </Text>
        <CopyableCommand command={pairCommand} />
        <Text style={styles.hint}>
          {t('You can also ask the agent on that computer to run this command for you.')}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.step}>
        <View style={styles.stepHeader}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>2</Text>
          </View>
          <Text style={styles.stepTitle}>{t('Enter the pairing code')}</Text>
        </View>
        <FormTextInput
          accessibilityLabel={t('Pairing code')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          onChangeText={setPairingCode}
          onSubmitEditing={() => {
            void submit();
          }}
          placeholder={t('123456')}
          returnKeyType="go"
          surface="sunken"
          value={pairingCode}
          inputStyle={styles.input}
        />
        <Button
          label={t('Connect')}
          loading={loading}
          disabled={!pairingCode.trim()}
          onPress={() => {
            void submit();
          }}
        />
      </View>

      <View style={styles.otherMethodsDivider} />
      <TouchableOpacity
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: otherMethodsExpanded }}
        onPress={() => setOtherMethodsExpanded((expanded) => !expanded)}
        style={styles.otherMethodsHeader}
      >
        <Text style={styles.otherMethodsLabel}>{t('Other connection methods')}</Text>
        {otherMethodsExpanded
          ? <ChevronDown size={16} color={theme.colors.inkTertiary} strokeWidth={2} />
          : <ChevronRight size={16} color={theme.colors.inkTertiary} strokeWidth={2} />}
      </TouchableOpacity>

      {otherMethodsExpanded ? (
        <View style={styles.otherMethodsActions}>
          {onScanQr ? (
            <Button
              label={t('Scan QR Code')}
              icon={ScanLine}
              variant="secondary"
              onPress={onScanQr}
            />
          ) : null}
          <Button
            label={t('Upload QR Image')}
            icon={ImageUp}
            variant="secondary"
            onPress={onUploadQr}
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    card: {
      ...createSurfaceStyle(colors, scheme, 'flat'),
      borderRadius: Radius.card,
      padding: Space.lg,
      gap: Space.md,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      lineHeight: LineHeight.secondary,
    },
    description: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    },
    step: {
      gap: Space.md,
    },
    stepHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Space.sm,
    },
    stepBadge: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: Radius.full,
      height: 26,
      justifyContent: 'center',
      width: 26,
    },
    stepBadgeText: {
      color: colors.onAccent,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
    stepTitle: {
      color: colors.ink,
      flex: 1,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      lineHeight: LineHeight.secondary,
    },
    stepDescription: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    },
    hint: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: 18,
    },
    divider: {
      backgroundColor: colors.line,
      height: StyleSheet.hairlineWidth,
    },
    otherMethodsDivider: {
      backgroundColor: colors.line,
      height: StyleSheet.hairlineWidth,
      marginTop: Space.xs,
    },
    otherMethodsHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 36,
    },
    otherMethodsLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
    otherMethodsActions: {
      gap: Space.sm,
    },
    input: {
      fontWeight: FontWeight.semibold,
      letterSpacing: Space.xs,
      textTransform: 'uppercase',
    },
  });
}
