import React, { useEffect, useRef } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Motion, Space } from '../../theme/tokens';

export type MessageEntranceMotion = 'sent' | 'reply';

/**
 * Sent: the bubble springs up into the timeline from just below its resting
 * place, like a message leaving the composer. Reply: the Agent's row rises in
 * a beat later so the two never read as one block.
 */
const SENT_ENTRANCE_OFFSET = Space.lg;
const SENT_ENTRANCE_SCALE = 0.92;
const SENT_ENTRANCE_SPRING = { duration: Motion.duration.slow, dampingRatio: 0.82 } as const;
const REPLY_ENTRANCE_OFFSET = Space.sm;
const REPLY_ENTRANCE_DELAY = Motion.duration.fast / 2;

export type MessageEntranceProps = Readonly<{
  /** Identity of the rendered row; a change re-arms the entrance for a recycled cell. */
  animationKey: string;
  /** Latched per `animationKey` so a later re-render cannot abort the motion. */
  animate: boolean;
  motion: MessageEntranceMotion;
  testID?: string;
  children: React.ReactNode;
}>;

export function MessageEntrance({ animationKey, animate, motion, testID, children }: MessageEntranceProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(animate ? 0 : 1);
  const playRef = useRef({ animationKey, animate });
  // FlashList reuses this instance for other rows: reset during render so the
  // previous row's settled values never paint for a frame.
  if (playRef.current.animationKey !== animationKey) {
    playRef.current = { animationKey, animate };
    progress.value = animate ? 0 : 1;
  }

  useEffect(() => {
    if (!playRef.current.animate) return undefined;
    cancelAnimation(progress);
    progress.value = 0;
    if (reduceMotion) {
      progress.value = withTiming(1, { duration: Motion.duration.fast });
    } else if (motion === 'sent') {
      progress.value = withSpring(1, SENT_ENTRANCE_SPRING);
    } else {
      progress.value = withDelay(REPLY_ENTRANCE_DELAY, withTiming(1, {
        duration: Motion.duration.normal,
        easing: Easing.out(Easing.cubic),
      }));
    }
    return () => cancelAnimation(progress);
  }, [animationKey, motion, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const value = progress.value;
    if (reduceMotion) return { opacity: value, transform: [{ translateY: 0 }, { scale: 1 }] };
    if (motion === 'sent') {
      return {
        opacity: Math.min(1, value * 2),
        transform: [
          { translateY: (1 - value) * SENT_ENTRANCE_OFFSET },
          { scale: SENT_ENTRANCE_SCALE + (1 - SENT_ENTRANCE_SCALE) * value },
        ],
      };
    }
    return { opacity: value, transform: [{ translateY: (1 - value) * REPLY_ENTRANCE_OFFSET }, { scale: 1 }] };
  }, [motion, reduceMotion]);

  return (
    <Animated.View testID={testID} style={animatedStyle}>
      {children}
    </Animated.View>
  );
}
