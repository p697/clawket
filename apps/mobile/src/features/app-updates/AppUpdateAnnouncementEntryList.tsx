import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Bot,
  Brain,
  Clock,
  Coins,
  Feather,
  Image,
  Layers,
  LayoutGrid,
  Link,
  ListChecks,
  Moon,
  Palette,
  Puzzle,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import {
  type AppUpdateAnnouncementEntry,
  type AppUpdateAnnouncementIcon,
} from './releases';
import type { AppTheme } from '../../theme';
import { FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';

type Props = {
  entries: AppUpdateAnnouncementEntry[];
  colors: AppTheme['colors'];
  onEntryPress?: (entry: AppUpdateAnnouncementEntry) => void;
};

const ENTRY_ICONS: Readonly<Record<AppUpdateAnnouncementIcon, LucideIcon>> = {
  rocket: Rocket,
  sparkles: Sparkles,
  layout: LayoutGrid,
  layers: Layers,
  search: Search,
  link: Link,
  palette: Palette,
  brain: Brain,
  feather: Feather,
  puzzle: Puzzle,
  wrench: Wrench,
  stethoscope: Stethoscope,
  shield: ShieldCheck,
  star: Star,
  moon: Moon,
  bot: Bot,
  image: Image,
  clock: Clock,
  list: ListChecks,
  coins: Coins,
  zap: Zap,
};

export function isNavigableAppUpdateEntry(entry: AppUpdateAnnouncementEntry): boolean {
  return entry.action.type === 'open_url' || entry.action.type === 'open_paywall';
}

function TagBadge({ label, colors }: { label: string; colors: AppTheme['colors'] }) {
  return (
    <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
      <Text style={[styles.badgeText, { color: colors.accent }]}>{label}</Text>
    </View>
  );
}

/**
 * Release entries for the What's New sheet. Copy keys come from
 * `releases.ts` (registered as a dynamic key origin for the i18n gate).
 */
export function AppUpdateAnnouncementEntryList({ entries, colors, onEntryPress }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const stylesWithTheme = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={stylesWithTheme.entries}>
      {entries.map((entry) => {
        const navigable = isNavigableAppUpdateEntry(entry) && Boolean(onEntryPress);
        const EntryIcon = ENTRY_ICONS[entry.icon] ?? Sparkles;
        const title = t(entry.title);

        const content = (
          <View testID={`app-update-entry-${entry.id}-row`} style={stylesWithTheme.entryRow}>
            <View style={stylesWithTheme.entryIconContainer}>
              <EntryIcon
                testID={`app-update-entry-${entry.id}-icon`}
                size={IconSize.md}
                color={colors.ink}
                strokeWidth={2}
              />
            </View>
            <View style={stylesWithTheme.entryCopy}>
              <View style={stylesWithTheme.entryTitleRow}>
                <Text style={stylesWithTheme.entryTitle}>{title}</Text>
                {entry.tag ? <TagBadge label={t(entry.tag)} colors={colors} /> : null}
              </View>
              {entry.subtitle ? (
                <Text style={stylesWithTheme.entrySubtitle}>{t(entry.subtitle)}</Text>
              ) : null}
            </View>
            {navigable ? (
              <ChevronRight size={IconSize.sm} color={colors.inkTertiary} strokeWidth={2} />
            ) : null}
          </View>
        );

        if (navigable) {
          return (
            <Pressable
              key={entry.id}
              testID={`app-update-entry-${entry.id}`}
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={() => onEntryPress?.(entry)}
              style={({ pressed }) => (pressed ? stylesWithTheme.entryPressed : null)}
            >
              {content}
            </Pressable>
          );
        }

        return <View key={entry.id} testID={`app-update-entry-${entry.id}`}>{content}</View>;
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
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
  },
});

function createStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    entries: {
      gap: Space.xs,
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Space.sm,
      gap: Space.md,
    },
    entryPressed: {
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
    },
    entryIconContainer: {
      width: 40,
      height: 40,
      borderRadius: Radius.avatarSettings,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
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
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    entrySubtitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
  });
}
