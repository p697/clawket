import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import type { ChatWallpaperPalette } from '../../theme/chat-wallpaper';

/** One doodle tile, in points; the pattern repeats it edge to edge. */
export const CHAT_WALLPAPER_TILE = 132;
const DOODLE_STROKE_WIDTH = 1.4;

type Props = Readonly<{
  palette: ChatWallpaperPalette;
  testID?: string;
}>;

/**
 * The built-in chat wallpaper: a soft 165° gradient of the accent family
 * under a faint repeating tile of Clawket doodles (paw, sparkles, terminal
 * prompt, clock, speech bubble, code brackets). It is one static drawing, so
 * scrolling never repaints it, and it takes no touches.
 */
export const ChatWallpaper = React.memo(function ChatWallpaper({ palette, testID }: Props): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradientId = `chat-wallpaper-gradient-${id}`;
  const doodlesId = `chat-wallpaper-doodles-${id}`;
  const [top, middle, bottom] = palette.gradient;
  return (
    <View testID={testID} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          {/* 165° reads as a gentle top-left to bottom-right drift on a portrait screen. */}
          <LinearGradient id={gradientId} x1="0.3" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={top} />
            <Stop offset="0.45" stopColor={middle} />
            <Stop offset="1" stopColor={bottom} />
          </LinearGradient>
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
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${doodlesId})`} />
      </Svg>
    </View>
  );
});
