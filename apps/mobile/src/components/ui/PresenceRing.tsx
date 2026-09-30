import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { withAlpha } from '../../theme/color';
import { Motion } from '../../theme/tokens';

export type PresenceRingTone = 'working' | 'attention';

/** Ring stroke and the air between it and the avatar, in points. */
export const PRESENCE_RING_STROKE = 2;
export const PRESENCE_RING_GAP = 2;
/** One turn of the working arc (A+ motion prototype). */
const SPIN_MS = 1_400;
const TRACK_ALPHA = 0.16;
const BREATH_LOW = 0.45;

export type PresenceRingProps = Readonly<{
  tone: PresenceRingTone;
  /** Diameter of the avatar the ring surrounds. */
  avatarSize: number;
  color: string;
  testID?: string;
}>;

/**
 * The Agent's presence around its header avatar (A+ chat design, owner
 * decision 2026-09-30): a quarter arc turning on a faint track while it
 * works, and a full ring breathing in the attention color while it waits for
 * you. Only the UI thread animates it; reduced motion holds it still.
 */
export function PresenceRing({ tone, avatarSize, color, testID }: PresenceRingProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const size = avatarSize + (PRESENCE_RING_GAP + PRESENCE_RING_STROKE) * 2;
  const center = size / 2;
  const radius = center - PRESENCE_RING_STROKE / 2;

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (!reduceMotion) {
      progress.value = tone === 'working'
        ? withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false)
        : withRepeat(withTiming(1, { duration: Motion.avatarWorkingLoop, easing: Easing.inOut(Easing.quad) }), -1, true);
    }
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, tone]);

  const animatedStyle = useAnimatedStyle(() => (tone === 'working'
    ? { transform: [{ rotate: `${progress.value * 360}deg` }] }
    : { opacity: 1 - (1 - BREATH_LOW) * progress.value }), [tone]);

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[styles.ring, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {tone === 'working' ? (
            <>
              <Circle cx={center} cy={center} r={radius} fill="none" stroke={withAlpha(color, TRACK_ALPHA)} strokeWidth={PRESENCE_RING_STROKE} />
              <Path
                d={`M${center} ${center - radius}A${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
                fill="none"
                stroke={color}
                strokeWidth={PRESENCE_RING_STROKE}
                strokeLinecap="round"
              />
            </>
          ) : (
            <Circle cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth={PRESENCE_RING_STROKE} />
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred on the avatar's centre, whatever the avatar box.
  ring: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
});
