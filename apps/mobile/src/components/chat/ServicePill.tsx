import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ChevronRight } from '../ui/DirectionalIcon';
import { FontSize, FontWeight, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { useChatSurfaces } from './ChatPresentation';

/** Glyphs inside a pill sit on its 13-point caption line. */
export const SERVICE_PILL_ICON_SIZE = 14;
const SERVICE_PILL_STROKE_WIDTH = 2;
/** The small system spinner is 20 points; scaled into the pill's glyph box. */
const SPINNER_SCALE = 0.7;

export const servicePillCodeStyle: TextStyle = {
  fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  fontSize: FontSize.meta,
};

export type ServicePillProps = Readonly<{
  /** Plain label, or pass rich `children` (for example an inline code span) instead. */
  label?: string;
  children?: React.ReactNode;
  /** `bad` is a failed step: deep red with white text on every wallpaper. */
  tone?: 'default' | 'bad';
  /** Semibold, for date labels. */
  emphasis?: boolean;
  icon?: LucideIcon;
  /** A spinner in the icon slot, for a step that is still running. */
  busy?: boolean;
  /** Quieter trailing text, such as a running step's elapsed time. */
  trailing?: string;
  numberOfLines?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/**
 * A centred translucent pill over the conversation, Telegram style: dates,
 * system notices and tool activity (A+ chat design, owner decision
 * 2026-09-30). It never competes with the bubbles; tappable pills end in a
 * chevron.
 */
export function ServicePill({
  label,
  children,
  tone = 'default',
  emphasis = false,
  icon: Icon,
  busy = false,
  trailing,
  numberOfLines = 1,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: ServicePillProps): React.JSX.Element {
  const { service } = useChatSurfaces();
  const bad = tone === 'bad';
  const textColor = bad ? service.badTextColor : service.textColor;
  const secondary = bad ? service.badTextColor : service.secondaryTextColor;
  const content = (
    <>
      {busy ? (
        <View style={styles.glyph} testID={testID ? `${testID}-busy` : undefined}>
          <ActivityIndicator size="small" color={textColor} style={styles.spinner} />
        </View>
      ) : Icon ? (
        <Icon size={SERVICE_PILL_ICON_SIZE} color={textColor} strokeWidth={SERVICE_PILL_STROKE_WIDTH} />
      ) : null}
      <Text
        style={[styles.label, { color: textColor }, emphasis ? styles.emphasis : null]}
        numberOfLines={numberOfLines}
      >
        {children ?? label}
      </Text>
      {trailing ? <Text style={[styles.label, styles.trailing, { color: secondary }]} numberOfLines={1}>{trailing}</Text> : null}
      {onPress ? (
        <ChevronRight size={SERVICE_PILL_ICON_SIZE} color={secondary} strokeWidth={SERVICE_PILL_STROKE_WIDTH} />
      ) : null}
    </>
  );
  const pillStyle = [
    styles.pill,
    { backgroundColor: bad ? service.badBackgroundColor : service.backgroundColor },
    onPress ? styles.pressablePill : null,
    style,
  ];
  if (!onPress) {
    return <View testID={testID} accessibilityLabel={accessibilityLabel} style={pillStyle}>{content}</View>;
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [pillStyle, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    borderRadius: Radius.full,
    paddingVertical: Space.xs - 1,
    paddingHorizontal: Space.sm + 2,
  },
  pressablePill: {
    paddingRight: Space.sm,
  },
  label: {
    flexShrink: 1,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    textAlign: 'center',
  },
  emphasis: {
    fontWeight: FontWeight.semibold,
  },
  trailing: {
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  glyph: {
    width: SERVICE_PILL_ICON_SIZE,
    height: SERVICE_PILL_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    transform: [{ scale: SPINNER_SCALE }],
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
});
