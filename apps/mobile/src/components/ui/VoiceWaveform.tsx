import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AppState, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedProps, useFrameCallback, useReducedMotion, useSharedValue,
  type FrameInfo, type SharedValue,
} from 'react-native-reanimated';
import {
  EMPTY_VOICE_WAVEFORM_PATH, VOICE_WAVEFORM_ENTRANCE_SECONDS, VOICE_WAVEFORM_HEIGHT, VOICE_WAVEFORM_REST_OPACITY,
  advanceVoiceWaveform, createVoiceWaveformSimulation, drawStillVoiceWaveform, drawVoiceWaveform,
  resolveStillVoiceWaveformOpacity, resolveVoiceWaveformLayout, resolveVoiceWaveformVignette,
  type VoiceWaveformSimulation,
} from './voiceWaveformModel';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type VoiceWaveformProps = Readonly<{
  /** Normalized 0–1 microphone level, written at audio cadence. */
  level?: SharedValue<number>;
  color: string;
  /** Slide-to-cancel is armed: the row flattens and dims. */
  cancelling?: boolean;
  testID?: string;
}>;

/**
 * Dictation waveform. Voice leaves the centre as ripples that travel outward
 * and dissolve into a vignette; silence rests as dim dots with a soft listening
 * pulse. One UI-thread frame callback runs `voiceWaveformModel` and writes two
 * SVG paths, so audio never re-renders React. It pauses in the background, and
 * reduced motion keeps the dots still with only their opacity following the voice.
 */
export function VoiceWaveform({ level, color, cancelling = false, testID }: VoiceWaveformProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const gradientId = `voice-waveform-${useId().replace(/:/g, '')}`;
  const [width, setWidth] = useState(0);
  const [foreground, setForeground] = useState(AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive');
  const layout = useMemo(() => resolveVoiceWaveformLayout(width), [width]);
  const vignette = useMemo(() => resolveVoiceWaveformVignette(layout), [layout]);
  const stillPath = useMemo(() => drawStillVoiceWaveform(layout), [layout]);

  const layoutValue = useSharedValue(layout);
  const stillValue = useSharedValue(stillPath);
  const cancelValue = useSharedValue(cancelling);
  // Created on the UI runtime by the first frame and mutated in place afterwards.
  const simulation = useSharedValue<VoiceWaveformSimulation | null>(null);
  const restPath = useSharedValue(EMPTY_VOICE_WAVEFORM_PATH);
  const litPath = useSharedValue(EMPTY_VOICE_WAVEFORM_PATH);
  const restOpacity = useSharedValue(VOICE_WAVEFORM_REST_OPACITY);
  const litOpacity = useSharedValue(1);

  useEffect(() => { layoutValue.value = layout; }, [layout, layoutValue]);
  useEffect(() => { stillValue.value = stillPath; }, [stillPath, stillValue]);
  useEffect(() => { cancelValue.value = cancelling; }, [cancelValue, cancelling]);
  useEffect(() => {
    const subscription = AppState?.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription?.remove();
  }, []);

  const onFrame = useCallback((frame: FrameInfo) => {
    'worklet';
    const current = layoutValue.value;
    if (current.count === 0) return;
    let state = simulation.value;
    if (state === null) {
      state = createVoiceWaveformSimulation();
      simulation.value = state;
    }
    advanceVoiceWaveform(state, level ? level.value : 0, cancelValue.value, (frame.timeSincePreviousFrame ?? 0) / 1000);
    // After the entrance the dots are the still row, so only the lit path is rebuilt per frame.
    const entering = state.time < VOICE_WAVEFORM_ENTRANCE_SECONDS;
    const drawn = drawVoiceWaveform(state, current, entering);
    restPath.value = entering ? drawn.rest : stillValue.value;
    litPath.value = drawn.lit;
    restOpacity.value = drawn.restOpacity;
    litOpacity.value = drawn.litOpacity;
  }, [cancelValue, layoutValue, level, litOpacity, litPath, restOpacity, restPath, simulation, stillValue]);
  const frameCallback = useFrameCallback(onFrame, false);
  const animate = !reduceMotion && foreground && layout.count > 0;
  useEffect(() => { frameCallback.setActive(animate); }, [animate, frameCallback]);

  const restProps = useAnimatedProps(() => ({ d: restPath.value, opacity: restOpacity.value }));
  const litProps = useAnimatedProps(() => ({ d: litPath.value, opacity: litOpacity.value }));
  const stillProps = useAnimatedProps(() => ({
    opacity: resolveStillVoiceWaveformOpacity(level ? level.value : 0, cancelValue.value),
  }));

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
  }, []);

  const fill = `url(#${gradientId})`;
  return (
    <View testID={testID} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      onLayout={onLayout} style={styles.row}>
      {layout.count > 0 ? <Svg width={layout.width} height={VOICE_WAVEFORM_HEIGHT}>
        <Defs>
          <LinearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={vignette.x1} y1={0} x2={vignette.x2} y2={0}>
            {vignette.stops.map((stop, index) => (
              <Stop key={index} offset={stop.offset} stopColor={color} stopOpacity={stop.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        {reduceMotion
          ? <AnimatedPath testID={testID ? `${testID}-still` : undefined} d={stillPath} fill={fill} animatedProps={stillProps} />
          : <>
            <AnimatedPath testID={testID ? `${testID}-rest` : undefined} d={EMPTY_VOICE_WAVEFORM_PATH} fill={fill} animatedProps={restProps} />
            <AnimatedPath testID={testID ? `${testID}-lit` : undefined} d={EMPTY_VOICE_WAVEFORM_PATH} fill={fill} animatedProps={litProps} />
          </>}
      </Svg> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'stretch', height: VOICE_WAVEFORM_HEIGHT },
});
