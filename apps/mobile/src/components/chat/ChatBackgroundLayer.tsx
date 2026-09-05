import React from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';

type Props = {
  appearance: ChatAppearanceSettings;
  imageUri?: string | null;
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
};

export function ChatBackgroundLayer({
  appearance,
  imageUri,
  style,
  borderRadius = 0,
}: Props): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const effectiveUri = appearance.background.enabled
    ? imageUri ?? appearance.background.imagePath ?? null
    : null;

  if (!effectiveUri) return null;

  return (
    <View
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
        source={{ uri: effectiveUri }}
        style={styles.image}
        resizeMode="cover"
        blurRadius={Math.round(appearance.background.blur)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
});
