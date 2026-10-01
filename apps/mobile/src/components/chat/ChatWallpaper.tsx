import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Path, Pattern, Rect } from 'react-native-svg';
import {
  CHAT_WALLPAPER_DRIFT_SCALE,
  chatWallpaperDriftGradient,
  chatWallpaperDriftPosition,
  type ChatWallpaperPalette,
} from '../../theme/chat-wallpaper';
import { Motion } from '../../theme/tokens';

/** One doodle tile, in points; the pattern repeats it edge to edge. */
export const CHAT_WALLPAPER_TILE = 132;
const DOODLE_STROKE_WIDTH = 1.4;

type Props = Readonly<{
  palette: ChatWallpaperPalette;
  /** Sends so far: each one drifts the gradient to the next position. Omitted, it rests. */
  driftStep?: number;
  testID?: string;
}>;

const DRIFT_TIMING = {
  duration: Motion.wallpaper.duration,
  easing: Easing.bezier(...Motion.wallpaper.curve),
};

/**
 * The built-in chat wallpaper: a soft 165° gradient of the accent family
 * under a faint repeating tile of Clawket doodles (paw, sparkles, terminal
 * prompt, clock, speech bubble, code brackets). Scrolling never repaints it,
 * and it takes no touches.
 *
 * The gradient is a native layer three times the screen in each direction;
 * each send slides it to the next window (`driftStep`) on the UI thread while
 * the doodles stay put. The first window is the resting wallpaper, and
 * reduced motion keeps it there.
 */
export const ChatWallpaper = React.memo(function ChatWallpaper({ palette, driftStep, testID }: Props): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const doodlesId = `chat-wallpaper-doodles-${id}`;
  const reduceMotion = useReducedMotion();
  const gradient = useMemo(() => chatWallpaperDriftGradient(palette), [palette]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
  };
  const position = chatWallpaperDriftPosition(reduceMotion ? 0 : driftStep ?? 0);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  // Only a new send glides; the first measurement and a new size place the window at once.
  const placedRef = useRef<{ step: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!size) return;
    const x = -position[0] * (CHAT_WALLPAPER_DRIFT_SCALE - 1) * size.width;
    const y = -position[1] * (CHAT_WALLPAPER_DRIFT_SCALE - 1) * size.height;
    const step = driftStep ?? 0;
    const placed = placedRef.current;
    const glide = !reduceMotion && placed !== null && placed.width === size.width && placed.height === size.height
      && placed.step !== step;
    placedRef.current = { step, width: size.width, height: size.height };
    offsetX.value = glide ? withTiming(x, DRIFT_TIMING) : x;
    offsetY.value = glide ? withTiming(y, DRIFT_TIMING) : y;
  }, [driftStep, offsetX, offsetY, position, reduceMotion, size]);
  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));
  return (
    <View testID={testID} pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={handleLayout}>
      <Animated.View testID={testID ? `${testID}-gradient` : undefined}
        style={[styles.drift, { experimental_backgroundImage: gradient }, driftStyle]} />
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={doodlesId} patternUnits="userSpaceOnUse" width={CHAT_WALLPAPER_TILE} height={CHAT_WALLPAPER_TILE}>
            <G
              fill="none"
              stroke={palette.doodle}
              strokeOpacity={palette.doodleOpacity}
              strokeWidth={DOODLE_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <G transform="translate(10 12) rotate(-12)">
                <Ellipse cx="9" cy="12" rx="5" ry="4" />
                <Circle cx="3.5" cy="6.5" r="1.7" />
                <Circle cx="7" cy="3.3" r="1.7" />
                <Circle cx="11" cy="3.3" r="1.7" />
                <Circle cx="14.5" cy="6.5" r="1.7" />
              </G>
              <G transform="translate(70 8)">
                <Path d="M9 0C9.8 5 13 8.2 18 9C13 9.8 9.8 13 9 18C8.2 13 5 9.8 0 9C5 8.2 8.2 5 9 0Z" />
              </G>
              <G transform="translate(104 46) rotate(8)">
                <Path d="M2 4l5 5-5 5" />
                <Path d="M10 15h7" />
              </G>
              <G transform="translate(38 56)">
                <Circle cx="9" cy="9" r="8" />
                <Path d="M9 4.5V9l3 2" />
              </G>
              <G transform="translate(8 92) rotate(-6)">
                <Path d="M3 3h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
              </G>
              <G transform="translate(76 90) rotate(14)">
                <Path d="M6 3L1 9l5 6" />
                <Path d="M14 3l5 6-5 6" />
              </G>
              <G transform="translate(112 106)">
                <Circle cx="4" cy="4" r="2.5" />
              </G>
              <G transform="translate(52 118)">
                <Path d="M4 0C4.4 2.3 5.7 3.6 8 4C5.7 4.4 4.4 5.7 4 8C3.6 5.7 2.3 4.4 0 4C2.3 3.6 3.6 2.3 4 0Z" />
              </G>
            </G>
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${doodlesId})`} />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  drift: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: `${CHAT_WALLPAPER_DRIFT_SCALE * 100}%`,
    height: `${CHAT_WALLPAPER_DRIFT_SCALE * 100}%`,
  },
});
