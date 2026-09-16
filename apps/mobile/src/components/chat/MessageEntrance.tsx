import React, { useLayoutEffect, useRef } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Motion, Space } from '../../theme/tokens';

export type MessageEntranceMotion = 'sent' | 'reply';

/**
 * Keep final size and full visibility throughout the entrance. Only position
 * changes; delivery/history updates must never shrink or hide an existing row.
 */
const SENT_ENTRANCE_OFFSET = Space.lg;
const REPLY_ENTRANCE_OFFSET = Space.sm;

export type MessageEntranceProps = Readonly<{
  /** Identity of the rendered row; a change re-arms the entrance for a recycled cell. */
  animationKey: string;
  /** Latched per `animationKey` so a later re-render cannot abort the motion. */
  animate: boolean;
  /** Conversation-owned claim survives recycled cells and row remounts. */
  claimEntrance?: (key: string) => boolean;
  motion: MessageEntranceMotion;
  testID?: string;
  children: React.ReactNode;
}>;

export function MessageEntrance({ animationKey, animate, claimEntrance, motion, testID, children }: MessageEntranceProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(1);
  const playRef = useRef({ animationKey, animate });
  // FlashList reuses this instance for other rows. Latch intent here, but
  // reset shared animation state only after React commits the new identity.
  if (playRef.current.animationKey !== animationKey) {
    playRef.current = { animationKey, animate };
  }

  useLayoutEffect(() => {
    cancelAnimation(progress);
    if (!playRef.current.animate || reduceMotion || (claimEntrance && !claimEntrance(animationKey))) {
      progress.value = 1;
      return undefined;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: Motion.duration.normal,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(progress);
  }, [animationKey, claimEntrance, motion, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const value = progress.value;
    const offset = motion === 'sent' ? SENT_ENTRANCE_OFFSET : REPLY_ENTRANCE_OFFSET;
    return { opacity: 1, transform: [{ translateY: reduceMotion ? 0 : (1 - value) * offset }] };
  }, [motion, reduceMotion]);

  return (
    <Animated.View testID={testID} style={animatedStyle}>
      {children}
    </Animated.View>
  );
}
