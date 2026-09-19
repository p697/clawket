import React, { useId } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type ChatWallpaperScrimEdge = 'top' | 'bottom';

type Props = {
  /** Which screen edge the scrim is anchored to; it is opaque there and clear at the far side. */
  edge: ChatWallpaperScrimEdge;
  /** The theme canvas, so the scrim belongs to the current scheme rather than to the photo. */
  color: string;
  /** Peak opacity at the anchored edge. */
  opacity: number;
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
export function ChatWallpaperScrim({ edge, color, opacity, style, testID }: Props): React.JSX.Element {
  const gradientId = `chat-wallpaper-scrim-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const anchoredAtTop = edge === 'top';
  return (
    <View testID={testID} pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1={anchoredAtTop ? '0' : '1'} x2="0" y2={anchoredAtTop ? '1' : '0'}>
            <Stop offset={0} stopColor={color} stopOpacity={opacity} />
            <Stop offset={HOLD_STOP} stopColor={color} stopOpacity={opacity * HOLD_OPACITY_RATIO} />
            <Stop offset={1} stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}
