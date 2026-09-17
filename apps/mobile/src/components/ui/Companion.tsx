import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import geometry from '../../brand/companion.json';
import { CURIOUS_CHOREOGRAPHY, type CompanionStep } from '../../brand/companion-motion';
export { CURIOUS_CHOREOGRAPHY, choreographyLength, type CompanionStep } from '../../brand/companion-motion';
import { useAppTheme } from '../../theme';
import { Motion } from '../../theme/tokens';

export type CompanionPose = 'idle' | 'connecting' | 'loading' | 'curious' | 'error';

/** `ink` draws the cat in ink on canvas; `inverse` draws it in canvas for ink chrome such as the Pro entry. */
export type CompanionTone = 'ink' | 'inverse';

type CompanionPart = { d: string; transform?: string; role?: string; pivot?: { x: number; y: number } };

const parts = geometry.parts as CompanionPart[];
const earLeft = parts.find(part => part.role === 'earLeft');
const earRight = parts.find(part => part.role === 'earRight');
const face = parts.filter(part => part !== earLeft && part !== earRight);


function play(value: SharedValue<number>, steps: CompanionStep[]): void {
  value.value = withRepeat(withSequence(...steps.map(step => withDelay(step.after ?? 0, withTiming(step.to, { duration: step.over, easing: Easing.out(Easing.cubic) })))), -1, false);
}

/** Original brand artwork. Geometry also generates the native launcher assets. */
export function Companion({ size = 94, pose = 'idle', tone = 'ink', testID }: { size?: number; pose?: CompanionPose; tone?: CompanionTone; testID?: string }): React.JSX.Element {
  const { theme: { colors } } = useAppTheme();
  const faceColor = tone === 'inverse' ? colors.canvas : colors.ink;
  const eyeColor = tone === 'inverse' ? colors.ink : colors.canvas;
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(AppState?.currentState !== 'background' && AppState?.currentState !== 'inactive');
  const breath = useSharedValue(0);
  const gaze = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const blink = useSharedValue(1);
  const tilt = useSharedValue(0);
  const earLeftTurn = useSharedValue(0);
  const earRightTurn = useSharedValue(0);
  const widen = useSharedValue(0);
  useEffect(() => {
    const listener = AppState?.addEventListener('change', state => setActive(state === 'active'));
    return () => listener?.remove();
  }, []);
  useEffect(() => {
    const values = [breath, gaze, gazeY, blink, tilt, earLeftTurn, earRightTurn, widen];
    const stop = () => values.forEach(value => cancelAnimation(value));
    stop();
    breath.value = 0; gaze.value = 0; gazeY.value = 0; blink.value = 1; tilt.value = 0; earLeftTurn.value = 0; earRightTurn.value = 0; widen.value = 0;
    if (!active || reducedMotion) return stop;
    if (pose === 'connecting' || pose === 'loading') {
      breath.value = withRepeat(withTiming(1, { duration: Motion.companionBreath, easing: Easing.inOut(Easing.ease) }), -1, true);
      gaze.value = withRepeat(withSequence(withTiming(1, { duration: Motion.companionGaze }), withTiming(1, { duration: Motion.companionGaze }), withTiming(0, { duration: Motion.companionGaze })), -1);
      blink.value = withRepeat(withSequence(withTiming(1, { duration: Motion.companionBlinkPause }), withTiming(0.15, { duration: Motion.duration.fast }), withTiming(1, { duration: Motion.duration.fast })), -1);
    } else if (pose === 'curious') {
      breath.value = withRepeat(withTiming(1, { duration: Motion.companionBreath, easing: Easing.inOut(Easing.ease) }), -1, true);
      play(tilt, CURIOUS_CHOREOGRAPHY.tilt);
      play(gaze, CURIOUS_CHOREOGRAPHY.gazeX);
      play(gazeY, CURIOUS_CHOREOGRAPHY.gazeY);
      play(blink, CURIOUS_CHOREOGRAPHY.blink);
      play(earLeftTurn, CURIOUS_CHOREOGRAPHY.earLeft);
      play(earRightTurn, CURIOUS_CHOREOGRAPHY.earRight);
      play(widen, CURIOUS_CHOREOGRAPHY.widen);
    }
    return stop;
  }, [active, reducedMotion, pose, breath, gaze, gazeY, blink, tilt, earLeftTurn, earRightTurn, widen]);
  const scale = size / geometry.width;
  const height = geometry.height * scale;
  // Pivots are offsets from each layer's centre, applied as translate → transform → translate back.
  // A static transform origin combined with an animated transform blanks the layer on Fabric.
  const neck = height * 0.3;
  const eyeDrop = (geometry.eyes[0].y + geometry.eyes[0].height / 2) * scale - height / 2;
  const earLeftPivot = { x: (earLeft?.pivot?.x ?? geometry.width / 2) * scale - size / 2, y: (earLeft?.pivot?.y ?? geometry.height / 2) * scale - height / 2 };
  const earRightPivot = { x: (earRight?.pivot?.x ?? geometry.width / 2) * scale - size / 2, y: (earRight?.pivot?.y ?? geometry.height / 2) * scale - height / 2 };
  const bodyMotion = useAnimatedStyle(() => ({
    transform: [
      { translateY: -3 * scale * breath.value },
      { translateX: tilt.value * 0.6 * scale },
      { translateY: neck },
      { rotate: pose === 'error' ? '-7deg' : `${tilt.value}deg` },
      { translateY: -neck },
    ],
  }));
  const eyeMotion = useAnimatedStyle(() => ({
    transform: [
      { translateX: gaze.value * size * 0.04 },
      { translateY: gazeY.value * size * 0.03 + eyeDrop },
      { scaleY: pose === 'error' ? 0.65 : blink.value * (1 + 0.12 * widen.value) },
      { translateY: -eyeDrop },
    ],
  }));
  const earLeftMotion = useAnimatedStyle(() => ({
    transform: [{ translateX: earLeftPivot.x }, { translateY: earLeftPivot.y }, { rotate: `${earLeftTurn.value}deg` }, { translateX: -earLeftPivot.x }, { translateY: -earLeftPivot.y }],
  }));
  const earRightMotion = useAnimatedStyle(() => ({
    transform: [{ translateX: earRightPivot.x }, { translateY: earRightPivot.y }, { rotate: `${earRightTurn.value}deg` }, { translateX: -earRightPivot.x }, { translateY: -earRightPivot.y }],
  }));
  const viewBox = `0 0 ${geometry.width} ${geometry.height}`;
  const ear = (part: CompanionPart | undefined, motion: typeof earLeftMotion, key: string) => part ? (
    <Animated.View key={key} style={[StyleSheet.absoluteFill, motion]}>
      <Svg width={size} height={height} viewBox={viewBox}>
        <Path d={part.d} transform={part.transform} fill={faceColor} />
      </Svg>
    </Animated.View>
  ) : null;
  return (
    <Animated.View testID={testID} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ width: size, height }, bodyMotion]}>
      {ear(earLeft, earLeftMotion, 'ear-left')}
      {ear(earRight, earRightMotion, 'ear-right')}
      <Svg width={size} height={height} viewBox={viewBox}>
        {face.map((part, index) => <Path key={index} d={part.d} transform={part.transform} fill={faceColor} />)}
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, eyeMotion]}>
        {geometry.eyes.map((eye, index) => <View key={index} style={{ position: 'absolute', left: eye.x * scale, top: eye.y * scale, width: eye.width * scale, height: eye.height * scale, borderRadius: eye.rx * scale, backgroundColor: eyeColor }} />)}
      </Animated.View>
    </Animated.View>
  );
}
