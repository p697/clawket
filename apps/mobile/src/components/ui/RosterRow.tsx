import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import { Lock, Pin, type LucideIcon } from 'lucide-react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Space,
  StatusSize,
} from '../../theme/tokens';
import {
  AGENT_AVATAR_METRICS,
  AgentAvatar,
  type AgentAttentionTone,
  type AgentAvatarStatus,
} from './AgentAvatar';
import { triggerLightImpact } from '../../services/haptics';
import { formatFloatingButtonBadgeCount } from './FloatingButton';
import type { PlatformKind } from './PlatformMark';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * 84: four points tighter than the shared 88-point two-line row, leaving 14 above and below the
 * 56-point avatar (owner decision 2026-09-27: 88 felt loose; 80 was tried first). Enlarged text
 * still grows the row.
 */
export const ROSTER_ROW_MIN_HEIGHT = ControlSize.rosterRow - Space.xs;

export type RosterRowProps = Readonly<{
  selected?: boolean;
  agentId: string;
  name: string;
  avatarName?: string;
  preview: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  /** A pinned Agent: pinned Agents lead the roster and only they carry the pin glyph. */
  pinned?: boolean;
  /** A conversation row's badge glyph (`resolveSessionTileIcon`); Agent rows have none. */
  sessionIcon?: LucideIcon;
  /** The row's backend: product backends wear the official mark as the Agent's face. */
  platform?: PlatformKind;
  /** Put the backend's mark on an Agent's own avatar (the roster mixes two or more backends). */
  platformBadge?: boolean;
  avatarStatus?: AgentAvatarStatus;
  attentionTone?: AgentAttentionTone;
  timeLabel?: string;
  unreadCount?: number;
  unreadIndicator?: 'count' | 'dot';
  attention?: boolean;
  locked?: boolean;
  cached?: boolean;
  /**
   * The row's connection is the live one. It survives `cached` because the
   * runtime serves the live connection's rows from cache while it reconnects.
   */
  live?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function RosterRow({
  selected = false,
  agentId,
  name,
  avatarName,
  preview,
  emoji,
  avatarUrl,
  pinned = false,
  sessionIcon,
  platform,
  platformBadge = false,
  avatarStatus = 'idle',
  attentionTone = 'bad',
  timeLabel,
  unreadCount = 0,
  unreadIndicator = 'count',
  attention = false,
  locked = false,
  cached = false,
  live = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
  testID,
}: RosterRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const pressProgress = useSharedValue(0);
  const pressedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      pressProgress.value,
      [0, 1],
      [selected ? theme.colors.surface : theme.colors.canvas, theme.colors.surface],
    ),
  }), [selected ? theme.colors.surface : theme.colors.canvas, theme.colors.surface]);
  // A locked row mutes its avatar and ends in one trailing lock; the avatar
  // corner keeps attention, then the live dot; cached rows otherwise stay quiet.
  const resolvedAvatarStatus: AgentAvatarStatus = locked
    ? 'locked'
    : attention && !cached
      ? 'attention'
      : live
        ? 'live'
        : cached
          ? 'idle'
          : avatarStatus;

  // The preview line's trailing marker: lock, then a live attention request, then unread.
  const marker = locked ? (
    <Lock testID={testID ? `${testID}-lock-icon` : undefined} size={IconSize.sm}
      color={theme.colors.inkTertiary} strokeWidth={BorderWidth.strong} />
  ) : !cached && attention ? (
    <View testID={testID ? `${testID}-attention` : undefined}
      style={[styles.attentionDot, { backgroundColor: theme.colors.bad }]} />
  ) : !cached && unreadCount > 0 ? (
    <View testID={testID ? `${testID}-unread` : undefined}
      style={[unreadIndicator === 'dot' ? styles.attentionDot : styles.unreadBadge, { backgroundColor: theme.colors.ink }]}>
      {unreadIndicator === 'count' ? (
        <Text style={[styles.unreadText, { color: theme.colors.canvas }]}>
          {formatFloatingButtonBadgeCount(unreadCount)}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? name}
      onPress={onPress}
      onLongPress={onLongPress ? () => { triggerLightImpact(); onLongPress(); } : undefined}
      onPressIn={() => {
        pressProgress.value = withTiming(1, { duration: Motion.duration.fast });
      }}
      onPressOut={() => {
        pressProgress.value = withTiming(0, { duration: Motion.duration.fast });
      }}
      style={[
        styles.row,
        pressedStyle,
        style,
      ]}
    >
      <View style={styles.avatarSlot}>
        <AgentAvatar
          testID={testID ? `${testID}-avatar` : undefined}
          agentId={agentId}
          name={avatarName ?? name}
          emoji={emoji}
          avatarUrl={avatarUrl}
          status={resolvedAvatarStatus}
          attentionTone={attentionTone}
          badgeIcon={sessionIcon}
          platform={platform}
          platformBadge={platformBadge}
          lockBadge={false}
          variant="roster"
        />
      </View>
      {/* Two lines, each with its own trailing slot (owner decision 2026-09-27): the time sits on the
          name's line and the unread / attention / lock marker on the preview's, so a badge never
          pushes the time up and every row keeps the same right edge. */}
      <View style={styles.copy}>
        <View style={styles.line}>
          <View style={styles.nameRow}>
            {pinned ? (
              <Pin
                testID={testID ? `${testID}-pin-icon` : undefined}
                size={IconSize.sm}
                color={theme.colors.inkTertiary}
                strokeWidth={BorderWidth.strong}
              />
            ) : null}
            <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={1}>
              {name}
            </Text>
          </View>
          {timeLabel ? (
            <Text testID={testID ? `${testID}-time` : undefined}
              style={[styles.time, { color: theme.colors.inkTertiary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {timeLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, { color: theme.colors.inkSecondary }]} numberOfLines={1}>
            {preview}
          </Text>
          {marker ? (
            <View testID={testID ? `${testID}-trailing` : undefined} style={styles.marker}>
              {marker}
            </View>
          ) : null}
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROSTER_ROW_MIN_HEIGHT,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  avatarSlot: {
    width: AGENT_AVATAR_METRICS.roster.size,
    height: AGENT_AVATAR_METRICS.roster.size,
    position: 'relative',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    flexShrink: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  nameRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  preview: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  marker: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  time: {
    flexShrink: 0,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  attentionDot: {
    width: StatusSize.attention,
    height: StatusSize.attention,
    borderRadius: Radius.full,
  },
  unreadBadge: {
    minWidth: LineHeight.caption,
    height: LineHeight.caption,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
