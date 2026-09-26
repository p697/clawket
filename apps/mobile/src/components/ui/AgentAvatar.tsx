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
} from '../../theme/tokens';
import { resolveAgentAvatarImageSource } from '../../utils/agent-avatar-uri';
import { StatusDot } from './StatusDot';

export type AgentAvatarVariant = 'roster' | 'header' | 'settings' | 'sheet' | 'panel';
/** `live` marks an Agent on the connection the phone is live on (owner decision 2026-09-26). */
export type AgentAvatarStatus = 'idle' | 'working' | 'attention' | 'done' | 'live' | 'offline' | 'locked';
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
  panel: {
    size: ControlSize.pill,
    radius: Radius.full,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
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

/** Full-width scripts: one glyph already fills a small avatar, two crowd its edges. */
const WIDE_SCRIPT_PATTERN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function getAgentInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length > 1) {
    return `${Array.from(words[0] ?? '')[0] ?? ''}${Array.from(words.at(-1) ?? '')[0] ?? ''}`.toLocaleUpperCase();
  }
  const word = words[0] ?? '';
  const length = WIDE_SCRIPT_PATTERN.test(word) ? 1 : 2;
  return Array.from(word).slice(0, length).join('').toLocaleUpperCase();
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

  // A row that mounts live shows its dot at once; one that becomes live (its
  // connection finished connecting) fades the dot in. Opacity only, so the
  // fade also suits reduced motion.
  const liveOpacity = useSharedValue(status === 'live' ? 1 : 0);
  useEffect(() => {
    cancelAnimation(liveOpacity);
    if (status !== 'live') {
      liveOpacity.value = 0;
      return () => cancelAnimation(liveOpacity);
    }
    liveOpacity.value = withTiming(1, { duration: Motion.duration.normal });
    return () => cancelAnimation(liveOpacity);
  }, [liveOpacity, status]);

  const doneDotStyle = useAnimatedStyle(() => ({ opacity: doneOpacity.value }));
  const liveDotStyle = useAnimatedStyle(() => ({ opacity: liveOpacity.value }));
  const isMuted = status === 'offline' || status === 'locked';
  const statusDotColor = attentionTone === 'bad' ? theme.colors.bad : theme.colors.warn;
  const resolvedAvatarSource = !emoji ? resolveAgentAvatarImageSource(avatarUrl) : null;

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
          <Text numberOfLines={1} allowFontScaling={false} style={textStyle}>
            {content}
          </Text>
        ) : null}
        {resolvedAvatarSource ? (
          <Image
            testID={testID ? `${testID}-image` : undefined}
            source={resolvedAvatarSource}
            resizeMode="cover"
            style={styles.image}
          />
        ) : null}
      </View>
      {status === 'attention' ? (
        <StatusDot
          testID={testID ? `${testID}-attention` : undefined}
          color={statusDotColor}
          ringColor={theme.colors.canvas}
        />
      ) : null}
      {status === 'done' ? (
        <Animated.View pointerEvents="none" style={[styles.statusLayer, doneDotStyle]}>
          <StatusDot
            testID={testID ? `${testID}-done` : undefined}
            color={theme.colors.good}
            ringColor={theme.colors.canvas}
          />
        </Animated.View>
      ) : null}
      {status === 'live' ? (
        <Animated.View pointerEvents="none" style={[styles.statusLayer, liveDotStyle]}>
          <StatusDot
            testID={testID ? `${testID}-live` : undefined}
            color={theme.colors.good}
            ringColor={theme.colors.canvas}
          />
        </Animated.View>
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
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  // Carries a dot's fade; the dot itself sits on the avatar's corner.
  statusLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'visible',
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
