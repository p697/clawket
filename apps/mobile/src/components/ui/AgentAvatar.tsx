import React, { useEffect, useMemo } from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import { Lock } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import { agentPalette } from '../../theme/theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Radius,
  Space,
  StatusSize,
} from '../../theme/tokens';

export type AgentAvatarVariant = 'roster' | 'header' | 'settings' | 'sheet';
export type AgentAvatarStatus = 'idle' | 'working' | 'attention' | 'done' | 'offline' | 'locked';
export type AgentAttentionTone = 'warn' | 'bad';

type AvatarMetrics = Readonly<{
  size: number;
  radius: number;
  fontSize: number;
  lineHeight: number;
}>;

export const AGENT_AVATAR_METRICS: Readonly<Record<AgentAvatarVariant, AvatarMetrics>> = {
  roster: {
    size: ControlSize.settingsRow + Space.xs,
    radius: Radius.full,
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
  },
  header: {
    size: ControlSize.pill - Space.md,
    radius: Radius.full,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
  settings: {
    size: ControlSize.floatingButton,
    radius: Radius.full,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  sheet: {
    size: Space.xxl,
    radius: Radius.full,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
  },
};

const AVATAR_MUTED_SATURATION = 0.4;

export type AgentAvatarProps = Readonly<{
  agentId: string;
  name: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  variant?: AgentAvatarVariant;
  status?: AgentAvatarStatus;
  attentionTone?: AgentAttentionTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function getAgentPaletteIndex(agentId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % agentPalette.length;
}

export function getAgentInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length > 1) {
    return `${Array.from(words[0] ?? '')[0] ?? ''}${Array.from(words.at(-1) ?? '')[0] ?? ''}`.toLocaleUpperCase();
  }
  return Array.from(words[0] ?? '').slice(0, 2).join('').toLocaleUpperCase();
}

export function AgentAvatar({
  agentId,
  name,
  emoji,
  avatarUrl,
  variant = 'roster',
  status = 'idle',
  attentionTone = 'warn',
  style,
  testID,
}: AgentAvatarProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const doneOpacity = useSharedValue(status === 'done' ? 1 : 0);
  const metrics = AGENT_AVATAR_METRICS[variant];
  const paletteColor = agentPalette[getAgentPaletteIndex(agentId)] ?? agentPalette[0];
  const content = emoji || getAgentInitials(name);
  const labelColor = theme.scheme === 'light' ? theme.colors.surfaceFloating : theme.colors.ink;
  const textStyle = useMemo(
    () => ({
      color: labelColor,
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      fontWeight: FontWeight.semibold,
    }),
    [labelColor, metrics.fontSize, metrics.lineHeight],
  );

  useEffect(() => {
    cancelAnimation(doneOpacity);
    if (status !== 'done') {
      doneOpacity.value = 0;
      return () => cancelAnimation(doneOpacity);
    }
    doneOpacity.value = 1;
    doneOpacity.value = withDelay(
      Motion.avatarDoneFade,
      withTiming(0, { duration: Motion.duration.fast }),
    );
    return () => cancelAnimation(doneOpacity);
  }, [doneOpacity, status]);

  const doneDotStyle = useAnimatedStyle(() => ({ opacity: doneOpacity.value }));
  const isMuted = status === 'offline' || status === 'locked';
  const statusDotColor = attentionTone === 'bad' ? theme.colors.bad : theme.colors.warn;
  const resolvedAvatarUrl = !emoji ? avatarUrl?.trim() : undefined;

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        styles.container,
        { width: metrics.size, height: metrics.size },
        style,
      ]}
    >
      <View
        testID={testID ? `${testID}-fill` : undefined}
        style={[
          styles.fill,
          {
            borderRadius: metrics.radius,
            backgroundColor: paletteColor,
            filter: isMuted ? [{ saturate: AVATAR_MUTED_SATURATION }] : undefined,
          },
        ]}
      >
        {content ? (
          <Text numberOfLines={1} style={textStyle}>
            {content}
          </Text>
        ) : null}
        {resolvedAvatarUrl ? (
          <Image
            testID={testID ? `${testID}-image` : undefined}
            source={{ uri: resolvedAvatarUrl }}
            resizeMode="cover"
            style={styles.image}
          />
        ) : null}
      </View>
      {status === 'working' ? (
        <View
          testID={testID ? `${testID}-working` : undefined}
          pointerEvents="none"
          style={[styles.workingBadge, { backgroundColor: theme.colors.ink, borderColor: theme.colors.canvas }]}
        >
          {[Space.xs, Space.sm, Space.xs].map((height, index) => (
            <View key={index} style={[styles.workingBar, { height, backgroundColor: theme.colors.canvas }]} />
          ))}
        </View>
      ) : null}
      {status === 'attention' ? (
        <View
          testID={testID ? `${testID}-attention` : undefined}
          pointerEvents="none"
          style={[
            styles.statusDot,
            {
              backgroundColor: statusDotColor,
              borderColor: theme.colors.canvas,
            },
          ]}
        />
      ) : null}
      {status === 'done' ? (
        <Animated.View
          testID={testID ? `${testID}-done` : undefined}
          pointerEvents="none"
          style={[
            styles.statusDot,
            {
              backgroundColor: theme.colors.good,
              borderColor: theme.colors.canvas,
            },
            doneDotStyle,
          ]}
        />
      ) : null}
      {status === 'locked' ? (
        <View
          testID={testID ? `${testID}-locked` : undefined}
          pointerEvents="none"
          style={[
            styles.lockBadge,
            {
              backgroundColor: theme.colors.surfaceFloating,
              borderColor: theme.colors.canvas,
            },
          ]}
        >
          <Lock size={Space.md} color={theme.colors.inkSecondary} strokeWidth={BorderWidth.strong} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'visible',
  },
  fill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  workingBadge: {
    position: 'absolute',
    right: -BorderWidth.strong,
    bottom: -BorderWidth.strong,
    width: Space.lg,
    height: Space.lg,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.strong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BorderWidth.strong,
  },
  workingBar: {
    width: BorderWidth.strong,
    borderRadius: Radius.full,
  },
  statusDot: {
    position: 'absolute',
    right: -BorderWidth.strong,
    bottom: -BorderWidth.strong,
    width: StatusSize.attention,
    height: StatusSize.attention,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.strong,
  },
  lockBadge: {
    position: 'absolute',
    right: -Space.xs,
    bottom: -Space.xs,
    width: Space.lg,
    height: Space.lg,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
