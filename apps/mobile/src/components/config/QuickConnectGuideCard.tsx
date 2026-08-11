import React, { useCallback, useMemo, useState } from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { SegmentedTabs, SegmentedTabItem } from '../ui';
import { CopyableCommand } from './CopyableCommand';
import { ConnectionHelpStep, ConnectionHelpStepList } from './ConnectionHelpStepList';
import { PairingTransportLottie } from './PairingTransportLottie';
import {
  getPairingTransportOption,
  PAIRING_TRANSPORT_OPTIONS,
  type PairingTransportOptionId,
} from './pairingTransportOptions';
import {
  getPairCommandForMode,
  getQuickConnectAgentPrompt,
  getQuickConnectGuideSteps,
  MANUAL_INSTALL_CMD,
  MANUAL_PAIR_CMD,
  MANUAL_PAIR_LOCAL_CMD,
  QuickConnectPairMode,
} from './quickConnectGuide';

type Props = {
  style?: StyleProp<ViewStyle>;
  variant?: 'simple' | 'numbered';
  /** Optional initial transport (e.g. deep-link from Pair Device). */
  initialMode?: QuickConnectPairMode;
};

export function QuickConnectGuideCard({
  style,
  variant = 'numbered',
  initialMode = 'relay',
}: Props): React.JSX.Element {
  const { t } = useTranslation(['chat', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const guideSteps = getQuickConnectGuideSteps(t);
  const [pairMode, setPairMode] = useState<QuickConnectPairMode>(initialMode);
  const [manualExpanded, setManualExpanded] = useState(false);
  const activeOption = useMemo(() => getPairingTransportOption(pairMode), [pairMode]);
  const pairCommand = useMemo(() => getPairCommandForMode(pairMode), [pairMode]);
  const quickConnectAgentPrompt = useMemo(
    () => getQuickConnectAgentPrompt(t, pairCommand),
    [pairCommand, t],
  );

  // Primary tabs stay short; secondary chips cover new transports.
  const primaryTabs = useMemo<SegmentedTabItem<'relay' | 'local'>[]>(() => [
    { key: 'relay', label: t('Remote', { ns: 'config' }) },
    { key: 'local', label: t('Same Wi-Fi', { ns: 'config' }) },
  ], [t]);

  const onPrimarySwitch = useCallback((key: 'relay' | 'local') => {
    setPairMode(key);
  }, []);

  const onTransportChip = useCallback((id: PairingTransportOptionId) => {
    setPairMode(id);
  }, []);

  const toggleManual = useCallback(() => {
    setManualExpanded((prev) => !prev);
  }, []);

  const transportChooser = (
    <View style={styles.transportBlock}>
      <PairingTransportLottie source={activeOption.lottie} size={96} />
      <Text style={styles.transportTitle}>{activeOption.label}</Text>
      <Text style={styles.pairModeDescription}>{activeOption.description}</Text>
      {!activeOption.persistent ? (
        <Text style={styles.handoffNote}>
          {t('AirDrop only delivers the pairing link. The live connection still uses Tailscale, Bonjour, or LAN.', { ns: 'config' })}
        </Text>
      ) : null}

      <SegmentedTabs
        tabs={primaryTabs}
        active={pairMode === 'local' || pairMode === 'relay' ? pairMode : 'local'}
        onSwitch={onPrimarySwitch}
        containerStyle={styles.pairModeTabs}
      />

      <View style={styles.chipRow}>
        {PAIRING_TRANSPORT_OPTIONS.filter((item) => item.id !== 'relay' && item.id !== 'local').map((item) => {
          const active = pairMode === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => onTransportChip(item.id)}
              style={[styles.chip, active && styles.chipActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const numberedSteps = useMemo<ConnectionHelpStep[]>(() => [
    {
      title: guideSteps[0].description,
      body: (
        <>
          {transportChooser}
          <CopyableCommand command={quickConnectAgentPrompt} multiline />
        </>
      ),
    },
    {
      title: guideSteps[1].description,
      body: (
        <View style={styles.pairModeGroup}>
          <Text style={styles.pairModeHint}>{t('Host command for this path', { ns: 'config' })}</Text>
          <CopyableCommand command={pairCommand} />
        </View>
      ),
    },
  ], [guideSteps, pairCommand, quickConnectAgentPrompt, styles, t, transportChooser]);

  const manualSteps = useMemo<ConnectionHelpStep[]>(() => [
    {
      title: t('Run these commands in your terminal.'),
      body: <CopyableCommand command={MANUAL_INSTALL_CMD} />,
    },
    {
      title: t('Remote connection command'),
      body: (
        <>
          <CopyableCommand command={MANUAL_PAIR_CMD} />
          <Text style={styles.pairModeHint}>
            {t('Use this when your phone and your OpenClaw host device are not on the same Wi-Fi network.')}
          </Text>

          <View style={styles.pairModeGroup}>
            <Text style={styles.pairModeTitle}>{t('Same Wi-Fi pairing')}</Text>
            <CopyableCommand command={MANUAL_PAIR_LOCAL_CMD} />
            <Text style={styles.pairModeHint}>
              {t('Use this when your phone and host are on the same Wi-Fi for lower latency and a smoother experience.')}
            </Text>
          </View>

          {PAIRING_TRANSPORT_OPTIONS.filter((item) => !['relay', 'local'].includes(item.id)).map((item) => (
            <View key={item.id} style={styles.pairModeGroup}>
              <Text style={styles.pairModeTitle}>{item.label}</Text>
              <CopyableCommand command={item.pairCommand} />
              <Text style={styles.pairModeHint}>{item.description}</Text>
            </View>
          ))}
        </>
      ),
    },
    {
      title: t('Scan one of the generated QR codes.'),
      body: null,
    },
  ], [styles, t]);

  const manualSection = (
    <>
      <View style={styles.manualDivider} />
      <TouchableOpacity onPress={toggleManual} style={styles.manualHeader} activeOpacity={0.7}>
        <Text style={styles.manualHeaderText}>{t('Questions? Manual setup')}</Text>
        {manualExpanded
          ? <ChevronDown size={12} color={theme.colors.textSubtle} strokeWidth={2} />
          : <ChevronRight size={12} color={theme.colors.textSubtle} strokeWidth={2} />
        }
      </TouchableOpacity>
      {manualExpanded && (
        <View style={styles.manualContent}>
          <ConnectionHelpStepList steps={manualSteps} />
        </View>
      )}
    </>
  );

  if (variant === 'simple') {
    return (
      <View style={[styles.card, style]}>
        <View style={styles.simpleStep}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>{guideSteps[0].title}</Text>
          </View>
          <Text style={styles.stepText}>{guideSteps[0].description}</Text>
          {transportChooser}
          <CopyableCommand command={quickConnectAgentPrompt} multiline />
        </View>

        <View style={[styles.simpleStep, styles.simpleStepSpaced]}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>{guideSteps[1].title}</Text>
          </View>
          <Text style={styles.stepText}>{guideSteps[1].description}</Text>
          <CopyableCommand command={pairCommand} />
        </View>

        {manualSection}
      </View>
    );
  }

  return (
    <View style={[styles.card, style]}>
      <ConnectionHelpStepList steps={numberedSteps} />
      {manualSection}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
    },
    simpleStep: {
      gap: Space.sm,
    },
    simpleStepSpaced: {
      marginTop: Space.md,
    },
    transportBlock: {
      alignItems: 'center',
      gap: Space.sm,
      marginBottom: Space.sm,
    },
    transportTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    pairModeTabs: {
      marginHorizontal: 0,
      marginTop: Space.xs,
      marginBottom: 0,
      alignSelf: 'stretch',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: Space.xs,
      marginTop: Space.xs,
    },
    chip: {
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 6,
    },
    chipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    chipText: {
      color: colors.text,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    chipTextActive: {
      color: colors.primaryText,
    },
    stepBadge: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radius.full,
      paddingLeft: 0,
      paddingRight: Space.sm,
      paddingVertical: 4,
    },
    stepBadgeText: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    stepText: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: 21,
    },
    pairModeDescription: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: 18,
      textAlign: 'center',
    },
    handoffNote: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      lineHeight: 16,
      textAlign: 'center',
    },
    manualDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginTop: Space.lg,
      marginBottom: Space.md,
    },
    manualHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      justifyContent: 'flex-end',
      gap: Space.xs,
    },
    manualHeaderText: {
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: 18,
    },
    manualContent: {
      marginTop: Space.md,
    },
    pairModeGroup: {
      marginTop: Space.sm,
      gap: Space.xs,
    },
    pairModeTitle: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    pairModeHint: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: 17,
    },
  });
}
