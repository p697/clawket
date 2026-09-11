import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet } from '../../../components/ui/Sheet';
import {
  type AppUpdateAnnouncement,
  type AppUpdateAnnouncementEntry,
} from '../../../features/app-updates/releases';
import { AppUpdateAnnouncementEntryList } from '../../../features/app-updates/AppUpdateAnnouncementEntryList';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../../theme/tokens';

type Props = {
  visible: boolean;
  announcement: AppUpdateAnnouncement | null;
  debugMode: boolean;
  currentVersion: string;
  onClose: () => void;
  onEntryPress: (entry: AppUpdateAnnouncementEntry) => void;
};

export function AppUpdateAnnouncementSheet({
  visible,
  announcement,
  debugMode,
  currentVersion,
  onClose,
  onEntryPress,
}: Props): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  if (!announcement) return null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t("What's New")}
      maxHeight="90%"
      testID="app-update-announcement"
      contentStyle={styles.content}
    >
      <View style={styles.versionRow}>
        <View style={styles.versionPill}>
          <Text style={styles.versionText}>v{currentVersion}</Text>
        </View>
      </View>

      <View style={styles.entries}>
        <AppUpdateAnnouncementEntryList
          colors={theme.colors}
          entries={announcement.entries}
          onEntryPress={onEntryPress}
          t={t}
        />
      </View>

      {debugMode ? (
        <Text style={styles.debugHint}>
          {announcement.debugHint === 'Debug mode is on, so this preview ignores the one-time cache.'
            ? t('Debug mode is on, so this preview ignores the one-time cache.')
            : announcement.debugHint}
        </Text>
      ) : null}
      <View style={{ height: Math.max(insets.bottom, Space.lg) }} />
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      gap: Space.lg,
    },
    versionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    versionPill: {
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: colors.accentSoft,
    },
    versionText: {
      color: colors.accent,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    entries: {
      gap: Space.sm,
    },
    debugHint: {
      color: colors.warn,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      textAlign: 'center',
    },
  });
}
