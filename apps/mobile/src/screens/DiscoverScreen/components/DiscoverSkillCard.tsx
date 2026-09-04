import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../../../components/ui';
import { resolveSourceLabel } from '../../../features/discover/helpers';
import type { DiscoverSkillItem } from '../../../features/discover/types';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../../theme/tokens';

export function formatCount(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

type Props = {
  item: DiscoverSkillItem;
  onPress: () => void;
};

export function DiscoverSkillCard({ item, onPress }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const styles = useMemo(() => createVerticalStyles(theme.colors), [theme]);
  const installs = formatCount(item.installs);
  const activeNow = formatCount(item.installsRecent);

  return (
    <Card style={styles.card} onPress={onPress}>
      <View style={styles.metaRow}>
        <Text style={styles.source}>{resolveSourceLabel(item.source)}</Text>
        {item.isOfficial ? <Text style={styles.officialBadge}>★ {t('Official')}</Text> : null}
        {activeNow ? (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>{t('{{count}} active now', { count: activeNow })}</Text>
          </View>
        ) : null}
        {installs ? (
          <Text style={styles.installs}>{t('{{count}} installs', { count: installs })}</Text>
        ) : null}
      </View>
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={2}>{item.title}</Text>
      <Text style={[styles.author, { color: theme.colors.textMuted }]} numberOfLines={1}>{item.author}</Text>
      {item.summary ? (
        <Text style={[styles.summary, { color: theme.colors.textMuted }]} numberOfLines={3}>{item.summary}</Text>
      ) : null}
    </Card>
  );
}

export function DiscoverSkillRow({ item, onPress }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const styles = useMemo(() => createRowStyles(theme.colors), [theme]);
  const installs = formatCount(item.installs);
  const activeNow = formatCount(item.installsRecent);
  const sourceLabel = resolveSourceLabel(item.source);
  const accent = item.source === 'clawhub' ? theme.colors.primary : theme.colors.textMuted;

  return (
    <Card style={styles.row} onPress={onPress}>
      <View style={[styles.sourceBar, { backgroundColor: accent }]} />
      <View style={styles.content}>
        <View style={styles.headRow}>
          <Text style={[styles.sourceLabel, { color: accent }]} numberOfLines={1}>{sourceLabel}</Text>
          {item.isOfficial ? <Text style={[styles.officialBadge, { color: accent }]}>★</Text> : null}
          {activeNow ? (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>{t('{{count}} active now', { count: activeNow })}</Text>
            </View>
          ) : null}
          {installs ? (
            <Text style={[styles.installs, { color: theme.colors.textMuted }]}>
              {t('{{count}} installs', { count: installs })}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {item.summary ? `${item.author} · ${item.summary}` : item.author}
        </Text>
      </View>
    </Card>
  );
}

export const RAIL_CARD_WIDTH = 220;

export function DiscoverSkillRailCard({ item, onPress }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const styles = useMemo(() => createRailStyles(theme.colors), [theme]);
  const installs = formatCount(item.installs);
  const activeNow = formatCount(item.installsRecent);

  return (
    <Card style={styles.card} onPress={onPress}>
      <View style={styles.topRow}>
        <Text style={styles.source}>{resolveSourceLabel(item.source)}</Text>
        {item.isOfficial ? <Text style={styles.officialBadge}>★</Text> : null}
        {activeNow ? (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>{t('{{count}} active now', { count: activeNow })}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={2}>{item.title}</Text>
      <Text style={[styles.author, { color: theme.colors.textMuted }]} numberOfLines={1}>{item.author}</Text>
      {item.summary ? (
        <Text style={[styles.summary, { color: theme.colors.textMuted }]} numberOfLines={3}>{item.summary}</Text>
      ) : null}
      <View style={styles.footer}>
        {installs ? (
          <Text style={styles.installs}>{t('{{count}} installs', { count: installs })}</Text>
        ) : <View />}
      </View>
    </Card>
  );
}

function createVerticalStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      paddingVertical: Space.lg,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      marginBottom: Space.sm,
    },
    source: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    officialBadge: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    installs: {
      marginLeft: 'auto',
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    activeBadge: {
      paddingHorizontal: 0,
    },
    activeBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    title: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      marginBottom: 2,
    },
    author: {
      fontSize: FontSize.sm,
      marginBottom: Space.sm,
    },
    summary: {
      fontSize: FontSize.md,
      lineHeight: 19,
    },
  });
}

function createRowStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingVertical: Space.md,
      paddingRight: Space.md,
      paddingLeft: 0,
      overflow: 'hidden',
    },
    sourceBar: {
      width: 3,
      marginRight: Space.md,
      borderTopRightRadius: 2,
      borderBottomRightRadius: 2,
    },
    content: {
      flex: 1,
      minWidth: 0,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      marginBottom: 2,
    },
    sourceLabel: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      letterSpacing: 0.3,
    },
    officialBadge: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    installs: {
      marginLeft: 'auto',
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
    activeBadge: {
      paddingHorizontal: 0,
    },
    activeBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    title: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      marginBottom: 2,
    },
    subtitle: {
      fontSize: FontSize.sm,
    },
  });
}

function createRailStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      width: RAIL_CARD_WIDTH,
      minHeight: 168,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      paddingVertical: Space.md,
      paddingHorizontal: Space.md,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      marginBottom: Space.xs,
    },
    source: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    officialBadge: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    activeBadge: {
      marginLeft: 'auto',
      paddingHorizontal: 0,
    },
    activeBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    title: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      marginBottom: 2,
    },
    author: {
      fontSize: FontSize.xs,
      marginBottom: Space.xs,
    },
    summary: {
      fontSize: FontSize.sm,
      lineHeight: 17,
    },
    footer: {
      marginTop: 'auto',
      paddingTop: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
    },
    installs: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
  });
}
