import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, type ViewStyle, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import { createChatGlassStyle, resolveChatPresenceColors } from '../../features/chat-appearance/resolver';
import { useConversationTheme } from '../chat/ChatPresentation';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../theme/tokens';
import { AgentAvatar, type AgentAttentionTone, type AgentAvatarStatus } from './AgentAvatar';
import type { PlatformKind } from './PlatformMark';
import { PresenceRing, type PresenceRingTone } from './PresenceRing';

/** The header avatar's diameter (`AgentAvatar` header variant). */
const HEADER_AVATAR_SIZE = ControlSize.pill - Space.md;

const PRESSED_OPACITY = 0.88;

export type HeaderPillProps = Readonly<{
  icon?: LucideIcon;
  agentId: string;
  name: string;
  avatarName?: string;
  subtitle: string;
  subtitleEllipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  /**
   * The Agent's presence (A+ chat design, 2026-09-30): `working` turns an
   * accent arc around the avatar and colors the subtitle (the status sentence)
   * in the accent; `attention` breathes a full ring and colors it amber.
   */
  presence?: PresenceRingTone | null;
  /** An idle Agent that can answer: its "Online" subtitle takes the accent, as in Telegram. */
  online?: boolean;
  emoji?: string | null;
  avatarUrl?: string | null;
  /** The Agent's backend: a product Agent wears the official mark, as on the roster. */
  platform?: PlatformKind | null;
  status?: AgentAvatarStatus;
  attentionTone?: AgentAttentionTone;
  /** `glass` floats the pill over a chat wallpaper on translucent chrome. */
  material?: 'surface' | 'glass';
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function HeaderPill({
  icon: Icon,
  agentId,
  name,
  avatarName,
  subtitle,
  subtitleEllipsizeMode = 'tail',
  presence = null,
  online = false,
  emoji,
  avatarUrl,
  platform,
  status = 'idle',
  attentionTone,
  material = 'surface',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: HeaderPillProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const conversation = useConversationTheme();
  const presenceColors = useMemo(() => resolveChatPresenceColors(conversation), [conversation]);
  const subtitleColor = presence === 'working' || (!presence && online) ? presenceColors.working
    : presence === 'attention' ? presenceColors.attentionText : theme.colors.inkSecondary;
  const reduceMotion = useReducedMotion();
  const subtitleProgress = useSharedValue(1);
  const chrome = useMemo(
    () => (material === 'glass' ? createChatGlassStyle(theme) : { backgroundColor: theme.colors.surface }),
    [material, theme],
  );
  // A new status sentence fades in and rises a few points (A+ motion, 200 ms); reduced motion only fades.
  const subtitleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: subtitleProgress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - subtitleProgress.value) * Motion.status.rise }],
  }), [reduceMotion]);

  useEffect(() => {
    cancelAnimation(subtitleProgress);
    subtitleProgress.value = 0;
    subtitleProgress.value = withTiming(1, { duration: Motion.status.duration, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(subtitleProgress);
  }, [subtitle, subtitleProgress]);

  const content = (
    <>
      <View style={styles.avatarSlot}>
        {Icon ? <Icon size={24} color={theme.colors.inkSecondary} strokeWidth={1.5} /> : <AgentAvatar
          testID={testID ? `${testID}-avatar` : undefined}
          agentId={agentId}
          name={avatarName ?? name}
          emoji={emoji}
          avatarUrl={avatarUrl}
          platform={platform}
          variant="header"
          status={status}
          attentionTone={attentionTone}
        />}
        {presence ? (
          <Animated.View key={presence} style={styles.ringLayer} pointerEvents="none"
            entering={FadeIn.duration(Motion.status.duration)} exiting={FadeOut.duration(Motion.status.duration)}>
            <PresenceRing
              testID={testID ? `${testID}-${presence}` : undefined}
              tone={presence}
              avatarSize={HEADER_AVATAR_SIZE}
              color={presence === 'working' ? presenceColors.working : presenceColors.attentionRing}
            />
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.labels}>
        <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {name}
        </Text>
        {subtitle.trim() ? <Animated.Text
          testID={testID ? `${testID}-subtitle` : undefined}
          style={[styles.subtitle, { color: subtitleColor }, subtitleAnimatedStyle]}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          ellipsizeMode={subtitleEllipsizeMode}
        >
          {subtitle}
        </Animated.Text> : null}
      </View>
    </>
  );

  const rootStyle = [styles.pill, chrome, style];
  if (!onPress) {
    return <View testID={testID} style={rootStyle}>{content}</View>;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [rootStyle, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: ControlSize.pill,
    maxWidth: '100%',
    borderRadius: Radius.full,
    paddingLeft: Space.sm,
    paddingRight: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  avatarSlot: {
    width: HEADER_AVATAR_SIZE,
    height: HEADER_AVATAR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The ring centres itself on its parent, so its fade layer covers the avatar box.
  ringLayer: {
    ...StyleSheet.absoluteFill,
  },
  labels: {
    flexShrink: 1,
  },
  name: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
    includeFontPadding: false,
  },
  subtitle: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.secondary - Space.xs,
    fontWeight: FontWeight.regular,
    includeFontPadding: false,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
