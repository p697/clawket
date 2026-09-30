import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, type ViewStyle, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
  const subtitleColor = presence === 'working' ? presenceColors.working
    : presence === 'attention' ? presenceColors.attentionText : theme.colors.inkSecondary;
  const subtitleOpacity = useSharedValue(1);
  const chrome = useMemo(
    () => (material === 'glass' ? createChatGlassStyle(theme) : { backgroundColor: theme.colors.surface }),
    [material, theme],
  );
  const subtitleAnimatedStyle = useAnimatedStyle(() => ({ opacity: subtitleOpacity.value }));

  useEffect(() => {
    cancelAnimation(subtitleOpacity);
    subtitleOpacity.value = 0;
    subtitleOpacity.value = withTiming(1, { duration: Motion.duration.fast });
    return () => cancelAnimation(subtitleOpacity);
  }, [subtitle, subtitleOpacity]);

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
          <PresenceRing
            testID={testID ? `${testID}-${presence}` : undefined}
            tone={presence}
            avatarSize={HEADER_AVATAR_SIZE}
            color={presence === 'working' ? presenceColors.working : presenceColors.attentionRing}
          />
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
