import React, { useEffect, useId, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import geometry from '../../brand/companion.json';
import { CURIOUS_CHOREOGRAPHY, type CompanionStep } from '../../brand/companion-motion';
import { paywallArtwork as art } from '../../theme/paywall';
import type { PaywallHero } from '../../screens/Paywall/model';

// G's native host accepts a matrix directly, avoiding JS transform parsing per frame.
const AnimatedG = Animated.createAnimatedComponent(G<{ matrix?: number[] }>);
const [leftEar, rightEar, face] = geometry.parts;

function rotation(degrees: number, x: number, y: number): number[] {
  'worklet';
  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  return [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
}

function play(value: SharedValue<number>, steps: CompanionStep[]): void {
  value.value = withRepeat(withSequence(...steps.map(step => withDelay(step.after ?? 0,
    withTiming(step.to, { duration: step.over, easing: Easing.out(Easing.cubic) })))), -1, false);
}

/** SVG geometry is a brand-artwork exception; UI chrome still uses shared components. */
export function PaywallLumenHero({ hero, success = false }: { hero: PaywallHero; success?: boolean }): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const lift = useSharedValue(0);
  const tilt = useSharedValue(0);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const blink = useSharedValue(1);
  const earLeft = useSharedValue(0);
  const earRight = useSharedValue(0);
  const widen = useSharedValue(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const values = [lift, tilt, gazeX, gazeY, blink, earLeft, earRight, widen];
    const stop = () => values.forEach(value => cancelAnimation(value));
    stop();
    lift.value = 0; tilt.value = 0; gazeX.value = 0; gazeY.value = 0;
    blink.value = 1; earLeft.value = 0; earRight.value = 0; widen.value = 0;
    if (active && !reduceMotion && !success) {
      lift.value = withRepeat(withTiming(-4, { duration: 3600, easing: Easing.inOut(Easing.sin) }), -1, true);
      play(tilt, CURIOUS_CHOREOGRAPHY.tilt);
      play(gazeX, CURIOUS_CHOREOGRAPHY.gazeX);
      play(gazeY, CURIOUS_CHOREOGRAPHY.gazeY);
      play(blink, CURIOUS_CHOREOGRAPHY.blink);
      play(earLeft, CURIOUS_CHOREOGRAPHY.earLeft);
      play(earRight, CURIOUS_CHOREOGRAPHY.earRight);
      play(widen, CURIOUS_CHOREOGRAPHY.widen);
    }
    return stop;
  }, [active, reduceMotion, success, lift, tilt, gazeX, gazeY, blink, earLeft, earRight, widen]);
  const headMotion = useAnimatedProps(() => {
    const matrix = rotation(tilt.value * 0.6, 47, 70);
    matrix[5] += lift.value / 1.73;
    return { matrix };
  });
  const leftMotion = useAnimatedProps(() => ({ matrix: rotation(earLeft.value * 0.65, leftEar.pivot!.x, leftEar.pivot!.y) }));
  const rightMotion = useAnimatedProps(() => ({ matrix: rotation(earRight.value * 0.65, rightEar.pivot!.x, rightEar.pivot!.y) }));
  const eyeMotion = useAnimatedProps(() => {
    const scale = blink.value * (1 + 0.1 * widen.value);
    const center = geometry.eyes[0].y + geometry.eyes[0].height / 2;
    return { matrix: [1, 0, 0, scale, gazeX.value * 3.2, center * (1 - scale) + gazeY.value * 2] };
  });
  const url = (name: string) => `url(#${id}${name})`;
  const angle = { generic: -24, connections: -18, agents: -28, manage: -12, logsFiles: -32, search: -20 }[hero];
  return (
    <Animated.View testID="paywall-lumen-artwork" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.art}>
      <Svg width="100%" height="100%" viewBox="0 0 393 230">
        <Defs>
          <RadialGradient id={`${id}halo`}><Stop stopColor={art.halo} stopOpacity={0.32}/><Stop offset="1" stopColor={art.halo} stopOpacity={0}/></RadialGradient>
          <LinearGradient id={`${id}metal`} x1="20%" y1="0%" x2="80%" y2="100%">
            {art.silver.map((color, index) => <Stop key={color} offset={[0, .2, .44, .53, .66, .79, 1][index]} stopColor={color}/>)}
          </LinearGradient>
          <LinearGradient id={`${id}edge`}>{art.edge.map((color, index) => <Stop key={color} offset={[0, .37, .51, .63, 1][index]} stopColor={color}/>)}</LinearGradient>
          <LinearGradient id={`${id}eye`} x2="0%" y2="100%"><Stop stopColor={art.eye[0]}/><Stop offset="1" stopColor={art.eye[1]}/></LinearGradient>
          <Mask id={`${id}silhouette`} x="0" y="0" width="94" height="88" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
            <AnimatedG animatedProps={leftMotion}><Path d={leftEar.d} transform={leftEar.transform} fill={art.mask}/></AnimatedG>
            <AnimatedG animatedProps={rightMotion}><Path d={rightEar.d} transform={rightEar.transform} fill={art.mask}/></AnimatedG>
            <Path d={face.d} fill={art.mask}/>
          </Mask>
        </Defs>
        <Ellipse cx="197" cy="104" rx="173" ry="122" fill={url('halo')}/>
        <G rotation={angle} origin="196,119"><Ellipse cx="196" cy="119" rx="165" ry="57" stroke={url('edge')} strokeWidth="1.1" fill="none"/><Ellipse cx="196" cy="119" rx="156" ry="53" stroke={art.orbit} strokeOpacity=".14" strokeWidth=".5" fill="none"/></G>
        <Ellipse cx="197" cy="193" rx="58" ry="5" fill={art.shadow} opacity=".35"/>
        <G transform="translate(115 23) scale(1.73)">
          <AnimatedG animatedProps={headMotion}>
            <Rect width="94" height="88" fill={url('metal')} mask={url('silhouette')}/>
            <AnimatedG animatedProps={eyeMotion}>{geometry.eyes.map(eye => <Rect key={eye.x} {...eye} fill={url('eye')}/>)}</AnimatedG>
          </AnimatedG>
        </G>
        <Circle cx="335" cy="68" r="2" fill={art.halo}/>
        <Path d="M64 165h6m-3-3v6" stroke={art.orbit} strokeWidth=".6"/>
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({ art: { width: '100%', height: '100%' } });
