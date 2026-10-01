import React, { useLayoutEffect, useRef } from 'react';
import { I18nManager, StyleSheet } from 'react-native';
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

const REPLY_ENTRANCE_OFFSET = Space.sm;
const SEND = Motion.send;
const SEND_EASING_X = Easing.bezier(SEND.curveX[0], SEND.curveX[1], SEND.curveX[2], SEND.curveX[3]);
const SEND_EASING_Y = Easing.bezier(SEND.curveY[0], SEND.curveY[1], SEND.curveY[2], SEND.curveY[3]);

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

/**
 * A new row's entrance, played once per identity (A+ chat design, owner-approved
 * prototype 2026-09-30). The user's own message flies in from the composer:
 * it starts below the timeline's bottom edge (which clips it, so it emerges
 * from the composer), its X and Y follow separate curves to draw an arc, and
 * it grows from 94% and 35% opacity about its bottom trailing corner. A reply
 * rises a few points at full size. Under reduced motion a sent row fades in
 * place and a reply appears at once. A latched identity never replays, so
 * delivery and history updates cannot hide or shrink a row that has landed.
 */
export function MessageEntrance({ animationKey, animate, claimEntrance, motion, testID, children }: MessageEntranceProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(1);
  const progressX = useSharedValue(1);
  const playRef = useRef({ animationKey, animate });
  // FlashList reuses this instance for other rows. Latch intent here, but
  // reset shared animation state only after React commits the new identity.
  if (playRef.current.animationKey !== animationKey) {
    playRef.current = { animationKey, animate };
  }
  const sent = motion === 'sent';

  useLayoutEffect(() => {
    cancelAnimation(progress);
    cancelAnimation(progressX);
    if (!playRef.current.animate || (reduceMotion && !sent) || (claimEntrance && !claimEntrance(animationKey))) {
      progress.value = 1;
      progressX.value = 1;
      return undefined;
    }
    progress.value = 0;
    progressX.value = 0;
    if (reduceMotion) {
      progress.value = withTiming(1, { duration: Motion.morph.duration });
      progressX.value = 1;
    } else if (sent) {
      progress.value = withTiming(1, { duration: SEND.duration, easing: SEND_EASING_Y });
      progressX.value = withTiming(1, { duration: SEND.duration, easing: SEND_EASING_X });
    } else {
      progress.value = withTiming(1, { duration: Motion.duration.normal, easing: Easing.out(Easing.cubic) });
      progressX.value = 1;
    }
    return () => {
      cancelAnimation(progress);
      cancelAnimation(progressX);
    };
  }, [animationKey, claimEntrance, sent, progress, progressX, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const y = progress.value;
    if (!sent) return { opacity: 1, transform: [{ translateY: reduceMotion ? 0 : (1 - y) * REPLY_ENTRANCE_OFFSET }] };
    if (reduceMotion) return { opacity: y, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const direction = I18nManager.isRTL ? 1 : -1;
    return {
      opacity: SEND.startOpacity + (1 - SEND.startOpacity) * y,
      transform: [
        { translateX: direction * (1 - progressX.value) * SEND.offsetX },
        { translateY: (1 - y) * SEND.offsetY },
        { scale: SEND.startScale + (1 - SEND.startScale) * y },
      ],
    };
  }, [sent, reduceMotion]);

  return (
    <Animated.View testID={testID} style={[sent ? (I18nManager.isRTL ? styles.originLeading : styles.originTrailing) : null, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The bubble sits at the row's trailing edge, so it grows from its own corner.
  originTrailing: { transformOrigin: 'right bottom' },
  originLeading: { transformOrigin: 'left bottom' },
});
