import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LoaderCircle, type LucideIcon } from 'lucide-react-native';
import { Easing, FadeIn, useReducedMotion, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { ChevronRight } from '../ui/DirectionalIcon';
import { SwapEntrance } from '../ui/SwapEntrance';
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
  /**
   * Identity of a live pill's current step. When it changes the new words
   * slide in from below (A+ motion, 160 ms); reduced motion fades them in.
   */
  stepKey?: string;
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
  stepKey,
  numberOfLines = 1,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: ServicePillProps): React.JSX.Element {
  const { service } = useChatSurfaces();
  const reduceMotion = useReducedMotion();
  const bad = tone === 'bad';
  const textColor = bad ? service.badTextColor : service.textColor;
  const secondary = bad ? service.badTextColor : service.secondaryTextColor;
  const labelText = (
    <Text
      style={[styles.label, { color: textColor }, emphasis ? styles.emphasis : null]}
      numberOfLines={numberOfLines}
    >
      {children ?? label}
    </Text>
  );
  const content = (
    <>
      {busy ? (
        <View style={styles.glyph} testID={testID ? `${testID}-busy` : undefined}>
          {reduceMotion
            ? <LoaderCircle size={SERVICE_PILL_ICON_SIZE} color={textColor} strokeWidth={SERVICE_PILL_STROKE_WIDTH} />
            : <ActivityIndicator size="small" color={textColor} style={styles.spinner} />}
        </View>
      ) : Icon ? (
        <Icon size={SERVICE_PILL_ICON_SIZE} color={textColor} strokeWidth={SERVICE_PILL_STROKE_WIDTH} />
      ) : null}
      {stepKey === undefined ? labelText : <StepSwap stepKey={stepKey} testID={testID ? `${testID}-step` : undefined}>{labelText}</StepSwap>}
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

const STEP_DURATION = Motion.step.duration;
const STEP_RISE = Motion.step.rise;
const stepRiseIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: STEP_RISE }] },
    animations: {
      opacity: withTiming(1, { duration: STEP_DURATION, easing: Easing.out(Easing.cubic) }),
      transform: [{ translateY: withTiming(0, { duration: STEP_DURATION, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};
const stepFadeIn = FadeIn.duration(STEP_DURATION);

/** The live step's words; a new step replaces them from below. The first step is already there. */
function StepSwap({ stepKey, testID, children }: Readonly<{ stepKey: string; testID?: string; children: React.ReactNode }>): React.JSX.Element {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return (
    <SwapEntrance swapKey={stepKey} ready={ready} entering={stepRiseIn} reducedEntering={stepFadeIn} style={styles.step} testID={testID}>
      {children}
    </SwapEntrance>
  );
}

const styles = StyleSheet.create({
  step: {
    flexShrink: 1,
  },
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
