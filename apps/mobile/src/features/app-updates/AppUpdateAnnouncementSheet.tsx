import React, { Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Companion } from '../../components/ui/Companion';
import { Sheet } from '../../components/ui/Sheet';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Motion, Space } from '../../theme/tokens';
import { AppUpdateAnnouncementEntryList } from './AppUpdateAnnouncementEntryList';
import { BRIDGE_UPGRADE_ENTRY, type AppUpdateAnnouncement, type AppUpdateAnnouncementEntry } from './releases';

export type AppUpdateAnnouncementSheetProps = Readonly<{
  visible: boolean;
  bridgeUpgradeAvailable?: boolean;
  announcement: AppUpdateAnnouncement | null;
  onClose: () => void;
  onAfterClose?: () => void;
  onContinue: () => void;
  onEntryPress: (entry: AppUpdateAnnouncementEntry) => void;
}>;

const SNAP_POINTS: string[] = ['92%'];
/** Large enough to read as the page's subject, like the Welcome artwork. */
export const ANNOUNCEMENT_COMPANION_SIZE = 148;

/**
 * What's New: the Companion greets the update, then the release entries.
 * Owner-approved 2026-09-16 as the third `curious` loop surface; the loop
 * stops with the sheet (content unmounts on dismiss) and under reduced motion.
 */
export function AppUpdateAnnouncementSheet({
  visible,
  bridgeUpgradeAvailable = false,
  announcement,
  onClose,
  onAfterClose,
  onContinue,
  onEntryPress,
}: AppUpdateAnnouncementSheetProps): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const { t } = useTranslation(['chat', 'common']);
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  if (!announcement) return null;

  const [latest] = announcement.releases;
  const multiple = announcement.releases.length > 1;
  const title = latest?.title ? t(latest.title) : t("What's New");
  const summary = latest?.summary ? t(latest.summary) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onAfterClose={onAfterClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      snapPoints={SNAP_POINTS}
      testID="app-update-announcement"
      footer={(
        <Button
          testID="app-update-announcement-continue"
          size="lg"
          label={t('Continue', { ns: 'common' })}
          onPress={onContinue}
        />
      )}
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          entering={reducedMotion ? undefined : FadeIn.duration(Motion.duration.slow)}
          style={styles.artwork}
        >
          <Companion size={ANNOUNCEMENT_COMPANION_SIZE} pose="curious" testID="app-update-announcement-companion" />
        </Animated.View>
        <Animated.View
          entering={reducedMotion ? undefined : FadeInDown.duration(Motion.duration.slow)}
          style={styles.heading}
        >
          <Text accessibilityRole="header" testID="app-update-announcement-title" style={styles.title}>{title}</Text>
          {summary ? <Text style={styles.summary}>{summary}</Text> : null}
          <Text testID="app-update-announcement-version" style={styles.version}>
            v{announcement.currentVersion}
          </Text>
        </Animated.View>

        <View style={styles.releases}>
          {announcement.releases.map((release) => (
            <Fragment key={release.version}>
              {multiple ? (
                <Text testID={`app-update-announcement-release-${release.version}`} style={styles.releaseLabel}>
                  v{release.version}
                </Text>
              ) : null}
              <AppUpdateAnnouncementEntryList
                colors={theme.colors}
                entries={release.version === '3.0.0' && bridgeUpgradeAvailable ? [BRIDGE_UPGRADE_ENTRY, ...release.entries] : release.entries}
                onEntryPress={onEntryPress}
              />
            </Fragment>
          ))}
        </View>

        {announcement.debugHint ? (
          <Text testID="app-update-announcement-debug-hint" style={styles.debugHint}>
            {announcement.debugHint === 'Debug mode is on, so this preview ignores the one-time cache.'
              ? t('Debug mode is on, so this preview ignores the one-time cache.')
              : announcement.debugHint}
          </Text>
        ) : null}
      </BottomSheetScrollView>
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: Space.xl,
      paddingBottom: Space.xl,
      gap: Space.xl,
    },
    artwork: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: Space.sm,
    },
    heading: {
      alignItems: 'center',
      gap: Space.sm,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.display,
      lineHeight: LineHeight.display,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    summary: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    version: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    releases: {
      gap: Space.lg,
    },
    releaseLabel: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    debugHint: {
      color: colors.warn,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
  });
}
