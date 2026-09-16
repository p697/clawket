import React, { Fragment, useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsDivider,
  SettingsGroup,
} from '../../components/ui/SettingsGroup';
import {
  getAppUpdateReleaseHistory,
  type AppUpdateRelease,
} from '../../features/app-updates/releases';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import { AccountSettingsPageHeader } from './AccountSettingsPageHeader';

export type ReleaseNotesHistoryScreenProps = Readonly<{
  onBack: () => void;
  releases?: ReadonlyArray<AppUpdateRelease>;
}>;

export function formatReleaseDate(
  releasedAt: string,
  locale: string,
): string {
  const match = releasedAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return releasedAt;

  const [, year, month, day] = match;
  const utcNoon = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 12),
  );
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(utcNoon);
}

/**
 * Every release, newest first, as plain reading material. Entries never
 * navigate (owner decision 2026-09-16): 3.0 moved the destinations, and the
 * history is a record, not a menu.
 */
export function ReleaseNotesHistoryScreen({
  onBack,
  releases = getAppUpdateReleaseHistory(),
}: ReleaseNotesHistoryScreenProps): React.JSX.Element {
  const { t, i18n } = useTranslation('config');
  const { t: tChat } = useTranslation('chat');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const contentStyle = useMemo(
    () => ({ paddingBottom: insets.bottom + Space.xl }),
    [insets.bottom],
  );

  useEffect(() => {
    analyticsEvents.releaseNotesOpened({ release_count: releases.length });
  }, [releases.length]);

  return (
    <View
      testID="release-notes-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <AccountSettingsPageHeader
        testID="release-notes"
        title={t('Release Notes')}
        onBack={onBack}
      />
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
      >
        {releases.length === 0 ? (
          <Text
            testID="release-notes-empty"
            style={[styles.emptyText, { color: theme.colors.inkSecondary }]}
          >
            {t('No release notes yet')}
          </Text>
        ) : releases.map((release) => (
          <View
            key={release.version}
            testID={`release-notes-${release.version}`}
            style={styles.release}
          >
            <View style={styles.releaseHeading}>
              <Text style={[styles.version, { color: theme.colors.ink }]}>
                v{release.version}
              </Text>
              {release.releasedAt ? (
                <Text style={[styles.date, { color: theme.colors.inkSecondary }]}>
                  {t('Released {{date}}', {
                    date: formatReleaseDate(release.releasedAt, i18n.language),
                  })}
                </Text>
              ) : null}
            </View>
            <SettingsGroup density="comfortable" testID={`release-notes-${release.version}-entries`}>
              {release.entries.map((entry, index) => (
                <Fragment key={entry.id}>
                  {index > 0 ? <SettingsDivider inset="content" /> : null}
                  <View testID={`release-notes-entry-${entry.id}`} style={styles.entry}>
                    <View style={styles.entryCopy}>
                      <Text style={[styles.entryTitle, { color: theme.colors.ink }]}>
                        {tChat(entry.title)}
                      </Text>
                      {entry.subtitle ? (
                        <Text
                          style={[
                            styles.entryBody,
                            { color: theme.colors.inkSecondary },
                          ]}
                        >
                          {tChat(entry.subtitle)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Fragment>
              ))}
            </SettingsGroup>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.xl,
  },
  release: { gap: Space.sm },
  releaseHeading: {
    paddingHorizontal: Space.xs,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  version: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  date: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  entry: {
    minHeight: ControlSize.settingsRowComfortable,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  entryCopy: {
    flex: 1,
    justifyContent: 'center',
    gap: Space.xs,
  },
  entryTitle: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  entryBody: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
    paddingVertical: Space.xxl,
  },
});
