import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useImageDimensions } from '../../hooks/useImageDimensions';
import { Radius } from '../../theme/tokens';
import type { ImageMeta } from '../../types/chat';
import { useConversationTheme } from './ChatPresentation';
import { computeAttachmentAlbumLayout } from './attachmentAlbumLayout';

export type MessageAttachmentAlbumProps = Readonly<{
  uris: readonly string[];
  /** Known dimensions from the picker or the history cache; missing ones resolve lazily. */
  metas?: readonly ImageMeta[];
  /** Widest the album may grow; the layout decides the actual frame. */
  maxWidth: number;
  align: 'start' | 'end';
  /** Spoken name of the whole album, e.g. “6 attachments”. */
  label: string;
  /** Spoken name of one tile, e.g. “Photo 2 of 6”. */
  formatTileLabel: (index: number, count: number) => string;
  onPressImage?: (index: number) => void;
  /** Forwarded so a long press on a photo still opens the message actions. */
  onLongPress?: () => void;
  /** Matches the message row so the gesture feels the same on text and photos. */
  longPressDelay?: number;
  testID?: string;
}>;

/**
 * Image attachments of one message as a single album: one photo at its own
 * aspect ratio, several photos packed into rows that share the album width,
 * clipped together at the bubble radius. Every photo is visible and opens the
 * viewer at its own position; the album never scrolls sideways.
 */
export function MessageAttachmentAlbum({
  uris,
  metas,
  maxWidth,
  align,
  label,
  formatTileLabel,
  onPressImage,
  onLongPress,
  longPressDelay,
  testID,
}: MessageAttachmentAlbumProps): React.JSX.Element | null {
  const { colors } = useConversationTheme();
  const resolved = useImageDimensions(uris as string[], metas as ImageMeta[] | undefined);
  const layout = useMemo(() => computeAttachmentAlbumLayout(
    uris.map((_, index) => resolved?.[index] ?? metas?.[index]),
    maxWidth,
  ), [maxWidth, metas, resolved, uris]);
  if (layout.tiles.length === 0) return null;
  const count = uris.length;
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={[
        styles.album,
        align === 'end' ? styles.alignEnd : styles.alignStart,
        { width: layout.width, height: layout.height },
      ]}
    >
      {layout.tiles.map((tile, index) => (
        <Pressable
          key={`${uris[index]}:${index}`}
          testID={testID ? `${testID}-${index}` : undefined}
          accessibilityRole="imagebutton"
          accessibilityLabel={formatTileLabel(index + 1, count)}
          onPress={onPressImage ? () => onPressImage(index) : undefined}
          onLongPress={onLongPress}
          delayLongPress={longPressDelay}
          style={[
            styles.tile,
            { left: tile.x, top: tile.y, width: tile.width, height: tile.height, backgroundColor: colors.surface },
          ]}
        >
          <Image source={{ uri: uris[index] }} resizeMode="cover" style={styles.image} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  album: {
    borderRadius: Radius.bubble,
    overflow: 'hidden',
  },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  tile: {
    position: 'absolute',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
