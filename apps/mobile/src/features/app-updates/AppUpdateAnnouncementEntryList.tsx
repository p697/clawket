import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import {
  type AppUpdateAnnouncementEntry,
} from './releases';
import type { AppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

type Props = {
  entries: AppUpdateAnnouncementEntry[];
  colors: AppTheme['colors'];
  onEntryPress?: (entry: AppUpdateAnnouncementEntry) => void;
  t: (key: string) => string;
};

function translateEntryCopy(t: Props['t'], key: string): string {
  if (key === 'Clawket 3.0') return t('chat:Clawket 3.0');
  if (key === 'Every agent and session in one roster.') {
    return t('chat:Every agent and session in one roster.');
  }
  if (key === 'Clawket 3.0 + Pro') return t('chat:Clawket 3.0 + Pro');
  if (key === 'Unlimited connections, agents, management, logs, files, and search.') {
    return t('chat:Unlimited connections, agents, management, logs, files, and search.');
  }
  if (key === 'New') return t('chat:New');
  return key;
}

function TagBadge({ label, colors }: { label: string; colors: AppTheme['colors'] }) {
  const isNew = label === 'New';
  const bgColor = isNew ? colors.accentSoft : colors.surface;
  const textColor = isNew ? colors.accent : colors.inkSecondary;

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <Text style={[styles.badgeText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

export function AppUpdateAnnouncementEntryList({ entries, colors, onEntryPress, t }: Props): React.JSX.Element {
  const stylesWithTheme = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={stylesWithTheme.entries}>
      {entries.map((entry, index) => {
        const isNavigable = entry.action.type === 'open_url'
          || entry.action.type === 'navigate_tab'
          || entry.action.type === 'navigate_console'
          || entry.action.type === 'navigate_config'
          || entry.action.type === 'navigate_config_add_connection';
        const isLast = index === entries.length - 1;

        const content = (
          <View style={[stylesWithTheme.entryRow, !isLast && stylesWithTheme.entryBorder]}>
            <View style={stylesWithTheme.entryEmojiContainer}>
              <Text style={stylesWithTheme.entryEmoji}>{entry.emoji}</Text>
            </View>
            <View style={stylesWithTheme.entryCopy}>
              <View style={stylesWithTheme.entryTitleRow}>
                <Text style={stylesWithTheme.entryTitle} numberOfLines={1}>
                  {translateEntryCopy(t, entry.title)}
                </Text>
                {entry.tag ? (
                  <TagBadge label={translateEntryCopy(t, entry.tag)} colors={colors} />
                ) : null}
              </View>
              {entry.subtitle ? (
                <Text style={stylesWithTheme.entrySubtitle}>
                  {translateEntryCopy(t, entry.subtitle)}
                </Text>
              ) : null}
            </View>
            {isNavigable ? (
              <ChevronRight
                size={18}
                color={colors.inkTertiary}
                strokeWidth={2}
              />
            ) : null}
          </View>
        );

        if (isNavigable && onEntryPress) {
          return (
            <Pressable
              key={entry.id}
              onPress={() => onEntryPress(entry)}
              style={({ pressed }) => pressed && stylesWithTheme.entryPressed}
            >
              {content}
            </Pressable>
          );
        }

        return <View key={entry.id}>{content}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.full,
  },
  badgeText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
  },
});

function createStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    entries: {
      borderRadius: Radius.card,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
      gap: Space.md,
    },
    entryBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    entryPressed: {
      opacity: 0.7,
    },
    entryEmojiContainer: {
      width: 40,
      height: 40,
      borderRadius: Radius.avatarSettings,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    entryEmoji: {
      fontSize: FontSize.body,
    },
    entryCopy: {
      flex: 1,
      gap: 2,
    },
    entryTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    entryTitle: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    entrySubtitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: 18,
    },
  });
}
