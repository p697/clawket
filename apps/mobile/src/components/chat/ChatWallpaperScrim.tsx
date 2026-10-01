import React, { useEffect, useId, useRef, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { mixColors } from '../../theme/color';
import { Motion } from '../../theme/tokens';
import { cubicBezier } from '../../utils/cubic-bezier';

export type ChatWallpaperScrimEdge = 'top' | 'bottom';

type Props = {
  /** Which screen edge the scrim is anchored to; it is opaque there and clear at the far side. */
  edge: ChatWallpaperScrimEdge;
  /** The theme canvas, so the scrim belongs to the current scheme rather than to the photo. */
  color: string;
  /** Peak opacity at the anchored edge. */
  opacity: number;
  /** Where the scrim still holds `ratio` of its peak; defaults suit photos. */
  hold?: Readonly<{ stop: number; ratio: number }>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Where the scrim is still strong: the first stop holds most of the opacity so
 * the status bar and the control row sit on a calm band, then it eases out
 * over the remaining run instead of a straight fade.
 */
const HOLD_STOP = 0.45;
const HOLD_OPACITY_RATIO = 0.62;

/**
 * A soft canvas gradient laid over the wallpaper behind floating chrome. It
 * takes no touches and no layout of its own: the host positions it under the
 * header or the composer dock and it fills that box.
 */
const DRIFT_EASING = cubicBezier(...Motion.wallpaper.curve);

/**
 * Eases from the color on screen to `target` with the wallpaper's drift, so a
 * scrim keeps fading from the color behind it while the gradient slides. Only
 * this scrim re-renders: SVG stops cannot be animated on the UI thread.
 */
function useDriftingColor(target: string): string {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (shownRef.current === target) return undefined;
    if (reduceMotion) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const from = shownRef.current;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - start) / Motion.wallpaper.duration);
      const next = progress >= 1 ? target : mixColors(from, target, DRIFT_EASING(progress));
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, target]);
  return shown;
}

export function ChatWallpaperScrim({ edge, color: target, opacity, hold, style, testID }: Props): React.JSX.Element {
  const gradientId = `chat-wallpaper-scrim-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const color = useDriftingColor(target);
  const anchoredAtTop = edge === 'top';
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1={anchoredAtTop ? '0' : '1'} x2="0" y2={anchoredAtTop ? '1' : '0'}>
            <Stop offset={0} stopColor={color} stopOpacity={opacity} />
            <Stop offset={hold?.stop ?? HOLD_STOP} stopColor={color} stopOpacity={opacity * (hold?.ratio ?? HOLD_OPACITY_RATIO)} />
            <Stop offset={1} stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}
