import React, { useCallback, useMemo, useState } from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { SegmentedTabs, SegmentedTabItem } from '../ui';
import { CopyableCommand } from './CopyableCommand';
import { ConnectionHelpStep, ConnectionHelpStepList } from './ConnectionHelpStepList';
import {
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
};

export function QuickConnectGuideCard({ style, variant = 'numbered' }: Props): React.JSX.Element {
  const { t } = useTranslation(['chat', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const guideSteps = getQuickConnectGuideSteps(t);
  const [pairMode, setPairMode] = useState<QuickConnectPairMode>('relay');
  const [manualExpanded, setManualExpanded] = useState(false);
  const quickConnectAgentPrompt = useMemo(
    () => getQuickConnectAgentPrompt(t, pairMode === 'local' ? MANUAL_PAIR_LOCAL_CMD : MANUAL_PAIR_CMD),
    [pairMode, t],
  );
  const pairModeTabs = useMemo<SegmentedTabItem<QuickConnectPairMode>[]>(() => [
    { key: 'relay', label: t('Remote', { ns: 'config' }) },
    { key: 'local', label: t('Same Wi-Fi', { ns: 'config' }) },
  ], [t]);
  const pairModeDescription = pairMode === 'relay'
    ? t('Remote connection description', { ns: 'config' })
    : t('Same Wi-Fi connection description', { ns: 'config' });

  const toggleManual = useCallback(() => {
    setManualExpanded((prev) => !prev);
  }, []);
  const promptModePicker = (
    <SegmentedTabs
      tabs={pairModeTabs}
      active={pairMode}
      onSwitch={setPairMode}
      containerStyle={styles.pairModeTabs}
    />
  );

  const numberedSteps = useMemo<ConnectionHelpStep[]>(() => [
    {
      title: guideSteps[0].description,
      body: (
        <>
          {promptModePicker}
          <Text style={styles.pairModeDescription}>{pairModeDescription}</Text>
          <CopyableCommand command={quickConnectAgentPrompt} multiline />
        </>
      ),
    },
    {
      title: guideSteps[1].description,
      body: null,
    },
  ], [guideSteps, pairModeDescription, promptModePicker, quickConnectAgentPrompt]);
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
          {promptModePicker}
          <Text style={styles.pairModeDescription}>{pairModeDescription}</Text>
          <CopyableCommand command={quickConnectAgentPrompt} multiline />
        </View>

        <View style={[styles.simpleStep, styles.simpleStepSpaced]}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>{guideSteps[1].title}</Text>
          </View>
          <Text style={styles.stepText}>{guideSteps[1].description}</Text>
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
    pairModeTabs: {
      marginHorizontal: 0,
      marginTop: 0,
      marginBottom: 0,
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
