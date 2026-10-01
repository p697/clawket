import React, { useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useReducedMotion, type EntryOrExitLayoutType } from 'react-native-reanimated';

export type SwapEntranceProps = Readonly<{
  /** Identity of what is shown: a new key remounts the child, which then enters. */
  swapKey: string;
  /** False while the owner is mounting: what is on screen from the start never enters. */
  ready: boolean;
  entering: EntryOrExitLayoutType;
  /** Plays instead under reduced motion, normally a fade in place. */
  reducedEntering: EntryOrExitLayoutType;
  /** `none` leaves touches to an ancestor that owns them. */
  pointerEvents?: 'box-none' | 'none';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
}>;

/**
 * One thing taking another's place (A+ motion): send, stop and mic in the
 * composer slot, a live pill's step. The choice to animate is latched per
 * key, so a later re-render never changes how something entered.
 */
export function SwapEntrance({
  swapKey, ready, entering, reducedEntering, pointerEvents = 'box-none', style, testID, children,
}: SwapEntranceProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const entryRef = useRef({ swapKey, animate: ready });
  if (entryRef.current.swapKey !== swapKey) entryRef.current = { swapKey, animate: ready };
  return (
    <Animated.View key={swapKey} testID={testID} style={style} pointerEvents={pointerEvents}
      entering={entryRef.current.animate ? (reducedMotion ? reducedEntering : entering) : undefined}>
      {children}
    </Animated.View>
  );
}
