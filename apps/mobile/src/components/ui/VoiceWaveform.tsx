import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming, type SharedValue } from 'react-native-reanimated';
import { Space, Radius } from '../../theme/tokens';

/** A quiet, symmetric waveform. Audio updates stay on the UI thread. */
export function VoiceWaveform({ level, color }: { level?: SharedValue<number>; color: string }) {
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.row}>
    {Array.from({ length: 25 }, (_, index) => <VoiceBar key={index} index={index} level={level} color={color} />)}
  </View>;
}
function VoiceBar({ level, color, index }: { level?: SharedValue<number>; color: string; index: number }) {
  const reduced = useReducedMotion();
  const weight = 0.2 + 0.8 * (1 - Math.abs(index - 12) / 13);
  const rhythm = 0.6 + 0.4 * Math.cos(index * 1.8) ** 2;
  const animated = useAnimatedStyle(() => ({
    transform: [{ scaleY: reduced ? 1 : withTiming(1 + Math.min(1, Math.max(0, level?.value ?? 0)) * 7 * weight * rhythm,
      { duration: 65 + Math.abs(index - 12) * 8 }) }],
    opacity: reduced ? 0.65 : 0.35 + Math.min(1, Math.max(0, level?.value ?? 0)) * 0.65,
  }), [level, reduced, weight, rhythm]);
  return <Animated.View style={[styles.bar, { backgroundColor: color }, animated]} />;
}
const styles = StyleSheet.create({
  row: { height: Space.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs },
  bar: { width: Space.xs, height: Space.xs, borderRadius: Radius.full },
});
