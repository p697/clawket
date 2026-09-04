import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import { Lock } from 'lucide-react-native';
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
} from '../../theme/tokens';
import {
  AgentAvatar,
  type AgentAttentionTone,
  type AgentAvatarStatus,
} from './AgentAvatar';
import { formatFloatingButtonBadgeCount } from './FloatingButton';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type RosterRowProps = Readonly<{
  agentId: string;
  name: string;
  preview: string;
  emoji?: string | null;
  avatarStatus?: AgentAvatarStatus;
  attentionTone?: AgentAttentionTone;
  timeLabel?: string;
  unreadCount?: number;
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
  preview,
  emoji,
  avatarStatus = 'idle',
  attentionTone = 'bad',
  timeLabel,
  unreadCount = 0,
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
      <AgentAvatar
        testID={testID ? `${testID}-avatar` : undefined}
        agentId={agentId}
        name={name}
        emoji={emoji}
        status={resolvedAvatarStatus}
        attentionTone={attentionTone}
        variant="roster"
      />
      <View style={styles.copy}>
        <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.preview, { color: theme.colors.inkSecondary }]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <View testID={testID ? `${testID}-trailing` : undefined} style={styles.trailing}>
        {locked ? (
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
            style={[styles.unreadBadge, { backgroundColor: theme.colors.accent }]}
          >
            <Text style={[styles.unreadText, { color: theme.colors.canvas }]}>
              {formatFloatingButtonBadgeCount(unreadCount)}
            </Text>
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
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
  },
  name: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
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
  time: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  attentionDot: {
    width: Space.md,
    height: Space.md,
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
