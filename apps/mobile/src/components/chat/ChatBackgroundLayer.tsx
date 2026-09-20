import React from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme';
import { withAlpha } from '../../theme/color';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';

type Props = {
  appearance: ChatAppearanceSettings;
  imageUri?: string | null;
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
  testID?: string;
};

/**
 * The wallpaper. It fills whatever region hosts it edge to edge (the whole
 * Thread, or the appearance preview card) and never takes touches. The saved
 * blur softens the photo itself; the saved dim lays the theme canvas over it
 * at that opacity so text and translucent chrome keep their contrast on a
 * busy or bright picture.
 */
export function ChatBackgroundLayer({
  appearance,
  imageUri,
  style,
  borderRadius = 0,
  testID = 'chat-background-layer',
}: Props): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const effectiveUri = appearance.background.enabled
    ? imageUri ?? appearance.background.imagePath ?? null
    : null;

  if (!effectiveUri) return null;
  const dim = Math.min(0.6, Math.max(0, appearance.background.dim));

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.canvas,
          borderRadius,
        },
        style,
      ]}
    >
      <Image
        testID={`${testID}-image`}
        source={{ uri: effectiveUri }}
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
