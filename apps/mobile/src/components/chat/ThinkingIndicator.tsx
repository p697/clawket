import React, { useEffect, useId, useState } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions, type TextLayoutLine } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withTiming,
} from 'react-native-reanimated';
import { useConversationTheme } from './ChatPresentation';
import { activityCardStyles } from './activity-card-styles';
import { FontSize, FontWeight, Motion } from '../../theme/tokens';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

export type ThinkingIndicatorProps = Readonly<{ label: string; testID?: string }>;

/** Native text owns layout/accessibility; a monochrome glyph fill sweeps left to right. */
export function ThinkingIndicator({ label, testID }: ThinkingIndicatorProps): React.JSX.Element {
  const theme = useConversationTheme();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const gradientId = `activity-${useId().replace(/:/g, '')}`;
  const [active, setActive] = useState(AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive');
  const [layout, setLayout] = useState<{ label: string; fontScale: number; lines: TextLayoutLine[] } | null>(null);
  const progress = useSharedValue(0);
  const lines = layout?.label === label && layout.fontScale === fontScale ? layout.lines : [];
  const width = Math.max(0, ...lines.map(line => line.x + line.width));
  const animate = active && !reduceMotion && width > 0;

  useEffect(() => {
    const subscription = AppState?.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (animate) {
      progress.value = withRepeat(withDelay(Motion.duration.slow,
        withTiming(1, { duration: Motion.activityShimmer, easing: Easing.linear })), -1, false);
    }
    return () => cancelAnimation(progress);
  }, [animate, label, progress, width]);

  const gradientProps = useAnimatedProps(() => {
    const band = width * 0.65;
    const start = -band + (width + band) * progress.value;
    return { x1: start, x2: start + band };
  }, [width]);

  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={label}
      accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
      <Text onTextLayout={({ nativeEvent }) => setLayout({ label, fontScale, lines: nativeEvent.lines })}
        style={[activityCardStyles.label, { color: theme.colors.inkSecondary }, animate && styles.measure]}>
        {label}
      </Text>
      {animate ? <View pointerEvents="none" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <AnimatedGradient id={gradientId} gradientUnits="userSpaceOnUse" y1={0} y2={0}
              animatedProps={gradientProps}>
              <Stop offset="0" stopColor={theme.colors.inkSecondary} />
              <Stop offset="0.5" stopColor={theme.colors.ink} />
              <Stop offset="1" stopColor={theme.colors.inkSecondary} />
            </AnimatedGradient>
          </Defs>
          {lines.map((line, index) => <SvgText key={index} x={line.x} y={line.y + line.ascender}
            fontSize={FontSize.secondary * fontScale} fontWeight={FontWeight.regular}
            fill={`url(#${gradientId})`}>{line.text}</SvgText>)}
        </Svg>
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({ measure: { opacity: 0 } });
