import React from 'react';
import type { SessionKind } from '@clawket/agent-protocol';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import { Lock, Pin } from 'lucide-react-native';
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
import { formatFloatingButtonBadgeCount } from './FloatingButton';
import { resolveSessionKindIcon } from './sessionKindIcon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type RosterRowProps = Readonly<{
  agentId: string;
  name: string;
  avatarName?: string;
  preview: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  pinned?: boolean;
  sessionKind?: SessionKind;
  avatarStatus?: AgentAvatarStatus;
  attentionTone?: AgentAttentionTone;
  timeLabel?: string;
  unreadCount?: number;
  unreadIndicator?: 'count' | 'dot';
  attention?: boolean;
  locked?: boolean;
  cached?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function RosterRow({
  agentId,
  name,
  avatarName,
  preview,
  emoji,
  avatarUrl,
  pinned = false,
  sessionKind,
  avatarStatus = 'idle',
  attentionTone = 'bad',
  timeLabel,
  unreadCount = 0,
  unreadIndicator = 'count',
  attention = false,
  locked = false,
  cached = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
  testID,
}: RosterRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const AvatarOverlayIcon = pinned && sessionKind
    ? resolveSessionKindIcon(sessionKind)
    : null;
  const pressProgress = useSharedValue(0);
  const pressedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      pressProgress.value,
      [0, 1],
      [theme.colors.canvas, theme.colors.surface],
    ),
  }), [theme.colors.canvas, theme.colors.surface]);
  const resolvedAvatarStatus: AgentAvatarStatus = locked
    ? 'locked'
    : cached
      ? 'idle'
      : attention
        ? 'attention'
        : avatarStatus;

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      onPress={onPress}
      onLongPress={onLongPress}
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
          variant="roster"
        />
        {AvatarOverlayIcon ? (
          <View
            testID={testID ? `${testID}-avatar-overlay` : undefined}
            pointerEvents="none"
            style={[styles.avatarOverlay, { backgroundColor: theme.colors.surfaceFloating }]}
          >
            <AvatarOverlayIcon
              testID={testID ? `${testID}-avatar-overlay-icon` : undefined}
              size={Space.md}
              color={theme.colors.inkSecondary}
              strokeWidth={BorderWidth.strong}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
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
        <Text style={[styles.preview, { color: theme.colors.inkSecondary }]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <View testID={testID ? `${testID}-trailing` : undefined} style={styles.trailing}>
        {cached ? (
          <View style={styles.cachedStatus}>
            {locked ? (
              <Lock
                testID={testID ? `${testID}-lock-icon` : undefined}
                size={IconSize.sm}
                color={theme.colors.inkTertiary}
                strokeWidth={BorderWidth.strong}
              />
            ) : null}
            {timeLabel ? (
              <Text
                testID={testID ? `${testID}-synced` : undefined}
                style={[styles.time, { color: theme.colors.inkTertiary }]}
                numberOfLines={1}
              >
                {timeLabel}
              </Text>
            ) : null}
          </View>
        ) : locked ? (
          <Lock
            testID={testID ? `${testID}-lock-icon` : undefined}
            size={IconSize.sm}
            color={theme.colors.inkTertiary}
            strokeWidth={BorderWidth.strong}
          />
        ) : attention ? (
          <View
            testID={testID ? `${testID}-attention` : undefined}
            style={[styles.attentionDot, { backgroundColor: theme.colors.bad }]}
          />
        ) : unreadCount > 0 ? (
          <View
            testID={testID ? `${testID}-unread` : undefined}
            style={[unreadIndicator === 'dot' ? styles.attentionDot : styles.unreadBadge, { backgroundColor: theme.colors.ink }]}
          >
            {unreadIndicator === 'count' ? <Text style={[styles.unreadText, { color: theme.colors.canvas }]}>
              {formatFloatingButtonBadgeCount(unreadCount)}
            </Text> : null}
          </View>
        ) : timeLabel ? (
          <Text style={[styles.time, { color: theme.colors.inkTertiary }]} numberOfLines={1}>
            {timeLabel}
          </Text>
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ControlSize.rosterRow,
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
  avatarOverlay: {
    position: 'absolute',
    top: -Space.xs,
    right: -Space.xs,
    width: Space.lg,
    height: Space.lg,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
  },
  name: {
    flexShrink: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  preview: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  trailing: {
    minWidth: Space.xl,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  cachedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  time: {
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
