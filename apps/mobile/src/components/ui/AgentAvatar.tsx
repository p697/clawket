import React, { useEffect, useMemo } from 'react';
import { StyleProp, StyleSheet, Text, type ViewStyle, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
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
    radius: Radius.avatarRoster,
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
  },
  header: {
    size: ControlSize.pill - Space.md,
    radius: Radius.avatarHeader,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
  settings: {
    size: ControlSize.floatingButton,
    radius: Radius.avatarSettings,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  sheet: {
    size: Space.xxl,
    radius: Radius.avatarSheet,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
  },
};

const AVATAR_MUTED_SATURATION = 0.4;
const FULL_ROTATION_DEGREES = 360;

export type AgentAvatarProps = Readonly<{
  agentId: string;
  name: string;
  emoji?: string | null;
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
  variant = 'roster',
  status = 'idle',
  attentionTone = 'warn',
  style,
  testID,
}: AgentAvatarProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);
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
    cancelAnimation(rotation);
    rotation.value = 0;
    if (status === 'working' && !reduceMotion) {
      rotation.value = withRepeat(
        withTiming(FULL_ROTATION_DEGREES, {
          duration: Motion.avatarWorkingLoop,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
    return () => cancelAnimation(rotation);
  }, [reduceMotion, rotation, status]);

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

  const rotatingRingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  const doneDotStyle = useAnimatedStyle(() => ({ opacity: doneOpacity.value }));
  const isMuted = status === 'offline' || status === 'locked';
  const statusDotColor = attentionTone === 'bad' ? theme.colors.bad : theme.colors.warn;

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
      {status === 'working' ? (
        <Animated.View
          testID={testID ? `${testID}-working-ring` : undefined}
          pointerEvents="none"
          style={[
            styles.workingRing,
            {
              borderRadius: metrics.radius + BorderWidth.strong,
              borderColor: theme.colors.accent,
              borderBottomColor: reduceMotion ? theme.colors.accent : theme.colors.accentSoft,
              borderLeftColor: reduceMotion ? theme.colors.accent : theme.colors.accentSoft,
            },
            rotatingRingStyle,
          ]}
        />
      ) : null}
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
      </View>
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
  workingRing: {
    position: 'absolute',
    top: -BorderWidth.strong,
    right: -BorderWidth.strong,
    bottom: -BorderWidth.strong,
    left: -BorderWidth.strong,
    borderWidth: BorderWidth.strong,
  },
  statusDot: {
    position: 'absolute',
    right: -BorderWidth.strong,
    bottom: -BorderWidth.strong,
    width: Space.md,
    height: Space.md,
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
