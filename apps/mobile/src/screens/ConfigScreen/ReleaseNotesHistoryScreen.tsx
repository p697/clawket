import React, { useCallback, useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, createCardContentStyle } from '../../components/ui';
import { AppUpdateAnnouncementEntryList } from '../../features/app-updates/AppUpdateAnnouncementEntryList';
import {
  type AppUpdateAnnouncementEntry,
  getAppUpdateReleaseHistory,
} from '../../features/app-updates/releases';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { requestConfigAddConnection } from '../../services/config-add-connection-request';
import type { ConfigStackParamList } from './ConfigTab';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'ReleaseNotesHistory'>;

export function ReleaseNotesHistoryScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t, i18n } = useTranslation('config');
  const { t: tChat } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const releases = useMemo(() => getAppUpdateReleaseHistory(), []);

  useNativeStackModalHeader({
    navigation,
    title: t('Release Notes'),
    onClose: () => navigation.goBack(),
  });

  const formatReleaseDate = useCallback((releasedAt: string) => {
    const match = releasedAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return releasedAt;

    const [, year, month, day] = match;
    const utcNoon = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(utcNoon);
  }, [i18n.language]);

  const handleEntryPress = useCallback((entry: AppUpdateAnnouncementEntry) => {
    if (entry.action.type === 'open_url') {
      void openExternalUrl(entry.action.url, () => {
        Alert.alert(t('Unable to open link', { ns: 'common' }), t('Please try again later.'));
      });
      return;
    }

    if (entry.action.type === 'navigate_tab') {
      navigation.getParent()?.dispatch(
        CommonActions.navigate({
          name: entry.action.screen,
        }),
      );
      return;
    }

    if (entry.action.type === 'navigate_console') {
      navigation.getParent()?.dispatch(
        CommonActions.navigate({
          name: 'Console',
          params: {
            state: {
              routes: [
                { name: 'ConsoleMenu' },
                { name: entry.action.screen },
              ],
            },
          },
        }),
      );
      return;
    }

    if (entry.action.type === 'navigate_config') {
      navigation.navigate(entry.action.screen);
      return;
    }

    if (entry.action.type === 'navigate_config_add_connection') {
      requestConfigAddConnection({
        tab: entry.action.tab === 'manual' ? 'manual' : 'quick',
        flow: entry.action.flow,
      });
      navigation.goBack();
      return;
    }
  }, [navigation, t]);

  if (releases.length === 0) {
    return (
      <ScrollView contentContainerStyle={[createCardContentStyle(), { flexGrow: 1 }]}>
        <EmptyState
          icon="📝"
          title={t('No release notes yet')}
          subtitle={t('Add a release entry to the unified app updates data source to populate this page.')}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={createCardContentStyle()}>
      <Text style={styles.pageSummary}>{t('Browse every product update in one place.')}</Text>

      <View style={styles.list}>
        {releases.map((release, index) => {
          const isLatest = index === 0;
          return (
            <Card key={release.version} style={styles.releaseCard}>
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <View style={styles.versionRow}>
                    <Text style={styles.versionText}>v{release.version}</Text>
                    {isLatest ? (
                      <View style={[styles.badge, styles.latestBadge]}>
                        <Text style={styles.latestBadgeText}>{t('Latest')}</Text>
                      </View>
                    ) : null}
                    {release.silent ? (
                      <View style={[styles.badge, styles.silentBadge]}>
                        <Text style={styles.silentBadgeText}>{t('Silent')}</Text>
                      </View>
                    ) : null}
                  </View>
                  {release.releasedAt ? (
                    <Text style={styles.dateText}>{t('Released {{date}}', { date: formatReleaseDate(release.releasedAt) })}</Text>
                  ) : null}
                </View>
              </View>

              <AppUpdateAnnouncementEntryList
                colors={theme.colors}
                entries={release.entries}
                onEntryPress={handleEntryPress}
                t={tChat}
              />

            </Card>
          );
        })}
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    pageSummary: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginBottom: Space.md,
    },
    list: {
      gap: Space.md,
    },
    releaseCard: {
      gap: Space.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    header: {
      gap: Space.sm,
    },
    headerCopy: {
      gap: Space.xs,
    },
    versionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    versionText: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    dateText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    badge: {
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      borderRadius: Radius.full,
    },
    latestBadge: {
      backgroundColor: colors.primarySoft,
    },
    latestBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    silentBadge: {
      backgroundColor: colors.surfaceMuted,
    },
    silentBadgeText: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
  });
}
