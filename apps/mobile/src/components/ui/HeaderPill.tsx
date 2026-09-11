import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, type ViewStyle, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
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
  /** The Agent is composing: the subtitle slot shows three lifting dots instead of text. */
  working?: boolean;
  emoji?: string | null;
  avatarUrl?: string | null;
  status?: AgentAvatarStatus;
  attentionTone?: AgentAttentionTone;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function HeaderPill({
  icon: Icon,
  agentId,
  name,
  avatarName,
  subtitle,
  working = false,
  emoji,
  avatarUrl,
  status = 'idle',
  attentionTone,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: HeaderPillProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const subtitleOpacity = useSharedValue(1);
  const chrome = useMemo(
    () => ({ backgroundColor: theme.colors.surface }),
    [theme.colors, theme.scheme],
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
        <Text style={[styles.name, { color: theme.colors.ink }]} numberOfLines={1}>
          {name}
        </Text>
        {working ? (
          <Animated.View style={subtitleAnimatedStyle}>
            <TypingDots testID={testID ? `${testID}-working` : undefined} />
          </Animated.View>
        ) : subtitle.trim() ? <Animated.Text
          style={[styles.subtitle, { color: theme.colors.inkSecondary }, subtitleAnimatedStyle]}
          numberOfLines={1}
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
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
