import React, { Fragment, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
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
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';
import { AccountSettingsPageHeader } from './AccountSettingsPageHeader';

export type ReleaseNotesHistoryScreenProps = Readonly<{
  onBack: () => void;
  onOpenPaywall?: (feature: 'settingsMembershipPreview') => void;
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

function translateReleaseCopy(
  t: ReturnType<typeof useTranslation>['t'],
  key: string,
): string {
  if (key === 'Clawket 3.0') return t('Clawket 3.0', { ns: 'chat' });
  if (key === 'Every agent and session in one roster.') {
    return t('Every agent and session in one roster.', { ns: 'chat' });
  }
  if (key === 'Clawket 3.0 + Pro') return t('Clawket 3.0 + Pro', { ns: 'chat' });
  if (key === 'Unlimited connections, agents, management, logs, files, and search.') {
    return t('Unlimited connections, agents, management, logs, files, and search.', { ns: 'chat' });
  }
  return key;
}

export function ReleaseNotesHistoryScreen({
  onBack,
  onOpenPaywall,
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
            <SettingsGroup testID={`release-notes-${release.version}-entries`}>
              {release.entries.map((entry, index) => {
                const title = translateReleaseCopy(tChat, entry.title);
                const paywallFeature = entry.action.type === 'open_paywall'
                  ? entry.action.feature
                  : null;
                const opensPaywall = paywallFeature !== null && Boolean(onOpenPaywall);
                const content = (
                  <>
                    <View style={styles.entryCopy}>
                      <Text style={[styles.entryTitle, { color: theme.colors.ink }]}>
                        {title}
                      </Text>
                      {entry.subtitle ? (
                        <Text
                          style={[
                            styles.entryBody,
                            { color: theme.colors.inkSecondary },
                          ]}
                        >
                          {translateReleaseCopy(tChat, entry.subtitle)}
                        </Text>
                      ) : null}
                    </View>
                    {opensPaywall ? (
                      <ChevronRight
                        size={IconSize.sm}
                        color={theme.colors.inkTertiary}
                        strokeWidth={2}
                      />
                    ) : null}
                  </>
                );
                return (
                  <Fragment key={entry.id}>
                    {index > 0 ? <SettingsDivider inset="content" /> : null}
                    {paywallFeature && onOpenPaywall ? (
                      <Pressable
                        testID={`release-notes-entry-${entry.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={title}
                        onPress={() => onOpenPaywall(paywallFeature)}
                        style={({ pressed }) => [
                          styles.entry,
                          pressed ? { backgroundColor: theme.colors.surface } : null,
                        ]}
                      >
                        {content}
                      </Pressable>
                    ) : (
                      <View testID={`release-notes-entry-${entry.id}`} style={styles.entry}>
                        {content}
                      </View>
                    )}
                  </Fragment>
                );
              })}
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
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
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
