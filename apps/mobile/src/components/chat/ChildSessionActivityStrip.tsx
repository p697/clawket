import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Sparkles, Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space, createThemedShadowStyle } from '../../theme/tokens';
import {
  ChildSessionActivityCard,
  getChildSessionStatusLabel,
} from '../../screens/ChatScreen/hooks/childSessionActivity';

type Props = {
  cards: ChildSessionActivityCard[];
  onSelectSession: (sessionKey: string) => void;
};

function statusTone(
  status: ChildSessionActivityCard['status'],
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): { background: string; text: string; border: string; icon: string } {
  if (status === 'tool_calling') {
    return {
      background: colors.warning,
      text: colors.iconOnColor,
      border: colors.warning,
      icon: colors.iconOnColor,
    };
  }
  if (status === 'streaming') {
    return {
      background: colors.primary,
      text: colors.iconOnColor,
      border: colors.primary,
      icon: colors.iconOnColor,
    };
  }
  return {
    background: colors.surfaceMuted,
    text: colors.textMuted,
    border: colors.borderStrong,
    icon: colors.success,
  };
}

function StatusIcon({
  status,
  color,
}: {
  status: ChildSessionActivityCard['status'];
  color: string;
}): React.JSX.Element {
  if (status === 'tool_calling') return <Wrench size={13} color={color} strokeWidth={2.2} />;
  if (status === 'completed') return <CheckCircle2 size={13} color={color} strokeWidth={2.2} />;
  return <Sparkles size={13} color={color} strokeWidth={2.2} />;
}

export function ChildSessionActivityStrip({
  cards,
  onSelectSession,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const [collapsed, setCollapsed] = useState(false);

  if (cards.length === 0) return null;

  const runningCount = cards.filter((card) => card.status !== 'completed').length;
  const summaryCount = runningCount > 0 ? runningCount : cards.length;

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.summaryBadge}>
          <Bot size={12} color={theme.colors.primary} strokeWidth={2.2} />
          <Text style={styles.summaryText} numberOfLines={1}>
            {summaryCount} {runningCount > 0 ? t('Running') : t('Subagents')}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setCollapsed((prev) => !prev);
          }}
          style={({ pressed }) => [styles.collapseButton, pressed && styles.collapseButtonPressed]}
        >
          {collapsed
            ? <ChevronDown size={15} color={theme.colors.textMuted} strokeWidth={2.4} />
            : <ChevronUp size={15} color={theme.colors.textMuted} strokeWidth={2.4} />}
        </Pressable>
      </View>

      {!collapsed ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {cards.map((card) => {
            const tone = statusTone(card.status, theme.colors);
            const statusLabel = getChildSessionStatusLabel(card.status, card.previewText, card.toolName, t);
            return (
              <Pressable
                key={card.sessionKey}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSelectSession(card.sessionKey);
                }}
                style={({ pressed }) => [
                  styles.pill,
                  card.status === 'completed' && styles.pillCompleted,
                  pressed && styles.pillPressed,
                ]}
              >
                <Text style={styles.pillTitle} numberOfLines={1}>
                  {card.title}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: tone.background, borderColor: tone.border }]}>
                  <StatusIcon status={card.status} color={tone.icon} />
                  <Text style={[styles.statusBadgeText, { color: tone.text }]} numberOfLines={1}>
                    {statusLabel}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    wrap: {
      paddingTop: Space.xs,
      paddingBottom: Space.xs + 1,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    topRow: {
      paddingHorizontal: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 30,
      gap: Space.sm,
    },
    summaryBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Radius.full,
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexShrink: 1,
    },
    summaryText: {
      color: colors.text,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    collapseButton: {
      width: 28,
      height: 28,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexShrink: 0,
    },
    collapseButtonPressed: {
      opacity: 0.8,
    },
    scrollContent: {
      paddingHorizontal: Space.md,
      paddingTop: Space.xs,
      gap: Space.sm,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      minWidth: 128,
      maxWidth: 220,
      minHeight: 40,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...createThemedShadowStyle(colors, scheme, Shadow.sm),
    },
    pillCompleted: {
      opacity: 0.86,
    },
    pillPressed: {
      transform: [{ scale: 0.985 }],
    },
    pillTitle: {
      flexShrink: 1,
      minWidth: 0,
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      marginBottom: 0,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      maxWidth: 118,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      flexShrink: 0,
    },
    statusBadgeText: {
      flexShrink: 1,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
  });
}
