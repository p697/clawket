import React from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme';
import { withAlpha } from '../../theme/color';
import { resolveChatWallpaperPalette } from '../../theme/chat-wallpaper';
import { resolveChatWallpaperKind } from '../../features/chat-appearance/resolver';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';
import { useChatAccentId } from './ChatPresentation';
import { ChatWallpaper } from './ChatWallpaper';

type Props = {
  appearance: ChatAppearanceSettings;
  /** Sends so far; the built-in wallpaper drifts one step per send (see `ChatWallpaper`). */
  driftStep?: number;
  imageUri?: string | null;
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
  testID?: string;
};

/**
 * The wallpaper. It fills whatever region hosts it edge to edge (the whole
 * Thread, or the appearance preview card) and never takes touches. The
 * default is the built-in accent-colored gradient with Clawket doodles; a
 * photo replaces it, softened by the saved blur, with the theme canvas laid
 * over it at the saved dim so text and translucent chrome keep their
 * contrast on a busy or bright picture; the plain choice draws nothing.
 */
export function ChatBackgroundLayer({
  appearance,
  driftStep,
  imageUri,
  style,
  borderRadius = 0,
  testID = 'chat-background-layer',
}: Props): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const accentId = useChatAccentId();
  const kind = resolveChatWallpaperKind(appearance, imageUri);
  if (kind === 'plain') return null;
  const rootStyle = [styles.root, { backgroundColor: theme.colors.canvas, borderRadius }, style];

  if (kind === 'pattern') {
    return (
      <View testID={testID} pointerEvents="none" style={rootStyle}>
        <ChatWallpaper testID={`${testID}-pattern`} palette={resolveChatWallpaperPalette(accentId, theme.scheme)} driftStep={driftStep} />
      </View>
    );
  }

  const dim = Math.min(0.6, Math.max(0, appearance.background.dim));
  return (
    <View testID={testID} pointerEvents="none" style={rootStyle}>
      <Image
        testID={`${testID}-image`}
        source={{ uri: imageUri ?? appearance.background.imagePath ?? '' }}
        style={styles.image}
        resizeMode="cover"
        blurRadius={Math.round(appearance.background.blur)}
      />
      {dim > 0 ? (
        <View
          testID={`${testID}-dim`}
          style={[styles.image, { backgroundColor: withAlpha(theme.colors.canvas, dim) }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
});
