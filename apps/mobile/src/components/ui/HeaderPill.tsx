import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, type ViewStyle, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import { createChatGlassStyle } from '../../features/chat-appearance/resolver';
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
import { TypingDots } from './TypingDots';

const PRESSED_OPACITY = 0.88;

export type HeaderPillProps = Readonly<{
  icon?: LucideIcon;
  agentId: string;
  name: string;
  avatarName?: string;
  subtitle: string;
  subtitleEllipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  /** The Agent is composing: the subtitle slot shows three lifting dots instead of text. */
  working?: boolean;
  emoji?: string | null;
  avatarUrl?: string | null;
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
  working = false,
  emoji,
  avatarUrl,
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
  }, [subtitle, subtitleOpacity, working]);

  const content = (
    <>
      {Icon ? <Icon size={24} color={theme.colors.inkSecondary} strokeWidth={1.5} /> : <AgentAvatar
        testID={testID ? `${testID}-avatar` : undefined}
        agentId={agentId}
        name={avatarName ?? name}
        emoji={emoji}
        avatarUrl={avatarUrl}
        variant="header"
        status={status}
        attentionTone={attentionTone}
      />}
      <View style={styles.labels}>
        <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {name}
        </Text>
        {working ? (
          <Animated.View style={[styles.working, subtitleAnimatedStyle]}>
            <TypingDots testID={testID ? `${testID}-working` : undefined} />
          </Animated.View>
        ) : subtitle.trim() ? <Animated.Text
          style={[styles.subtitle, { color: theme.colors.inkSecondary }, subtitleAnimatedStyle]}
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
  labels: {
    flexShrink: 1,
  },
  name: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  subtitle: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
  },
  // The dots sit a step in from the name's left edge; flush-left they read
  // as hanging off the pill (owner-requested 2026-09-11).
  working: {
    paddingLeft: Space.xs,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
