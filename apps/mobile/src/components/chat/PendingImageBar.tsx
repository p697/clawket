import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { FileText, Plus, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { isImageAttachmentMimeType } from '@clawket/agent-protocol';
import { PendingImage } from '../../types/chat';
import { ControlSize, FontSize, FontWeight, HitSize, IconSize, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { AttachmentMenu } from './AttachmentMenu';

type Props = {
  images: PendingImage[];
  canAddMore: boolean;
  attachDisabled?: boolean;
  onOpenPreview: (index: number) => void;
  onRemove: (index: number) => void;
  onPickImage: () => void | Promise<void>;
  onTakePhoto: () => void | Promise<void>;
  onChooseFile?: () => void | Promise<void>;
};

/** Attachment tiles share the composer's 40-point control scale, plus room for the remove badge. */
const TILE_SIZE = ControlSize.floatingButton + Space.md;
const REMOVE_BADGE_OFFSET = -Space.sm;
const PRESSED_OPACITY = 0.7;

function isFileAttachment(img: PendingImage): boolean {
  return !isImageAttachmentMimeType(img.mimeType);
}

/**
 * Draft attachments inside the composer: borderless tiles on the composer
 * surface, an ink remove badge on each corner, and a quiet tile to add more.
 * Tiles fade in as they are picked and the row closes up when one is removed.
 */
export function PendingImageBar({ images, canAddMore, attachDisabled = false, onOpenPreview, onRemove, onPickImage, onTakePhoto, onChooseFile }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { colors } = theme;
  const entering = reduceMotion ? undefined : FadeIn.duration(Motion.duration.normal);
  const exiting = reduceMotion ? undefined : FadeOut.duration(Motion.duration.fast);
  const layout = reduceMotion ? undefined : LinearTransition.duration(Motion.duration.normal);

  return (
    <Animated.View testID="pending-attachments" layout={layout} style={styles.bar}>
      {images.map((img, idx) => (
        <Animated.View key={`${img.uri}_${idx}`} entering={entering} exiting={exiting} layout={layout} style={[styles.item, isFileAttachment(img) ? styles.fileItem : null]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={img.fileName?.trim() || t('File', { ns: 'chat' })}
            onPress={() => onOpenPreview(idx)}
            style={({ pressed }) => [styles.tile, isFileAttachment(img) ? styles.document : null, pressed ? styles.pressed : null]}
          >
            {isFileAttachment(img) ? (
              <View testID={`pending-attachment-file-${idx}`} style={styles.fileTile}>
                <FileText size={IconSize.md} color={colors.inkSecondary} strokeWidth={1.75} />
                <Text style={styles.fileName} numberOfLines={2}>
                  {img.fileName?.trim() || t('File', { ns: 'chat' })}
                </Text>
              </View>
            ) : (
              <Image
                testID={`pending-attachment-image-${idx}`}
                source={{ uri: img.uri }}
                style={styles.image}
              />
            )}
          </Pressable>
          <Pressable
            testID={`pending-attachment-remove-${idx}`}
            accessibilityRole="button"
            accessibilityLabel={t('Remove', { ns: 'common' })}
            onPress={() => onRemove(idx)}
            hitSlop={Space.xs}
            style={styles.removeTarget}
          >
            <View
              testID={`pending-attachment-remove-${idx}-visual`}
              style={[styles.removeBadge, { backgroundColor: colors.ink, borderColor: colors.surface }]}
            >
              <X size={IconSize.sm - Space.xs} color={colors.canvas} strokeWidth={2.5} />
            </View>
          </Pressable>
        </Animated.View>
      ))}
      {canAddMore && (
        <Animated.View layout={layout}>
          <AttachmentMenu
            disabled={attachDisabled}
            style={styles.addTile}
            onPickImage={onPickImage}
            onTakePhoto={onTakePhoto}
            onChooseFile={onChooseFile}
          >
            <View testID="pending-attachment-add" style={styles.addTrigger}>
              <Plus size={IconSize.md} color={attachDisabled ? colors.inkTertiary : colors.inkSecondary} strokeWidth={1.75} />
            </View>
          </AttachmentMenu>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      paddingHorizontal: Space.sm,
      paddingTop: Space.sm,
      paddingBottom: Space.xs,
      gap: Space.md,
    },
    item: {
      position: 'relative',
    },
    fileItem: {
      width: '75%',
      maxWidth: '100%',
      flexShrink: 1,
    },
    tile: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      borderRadius: Radius.card,
      overflow: 'hidden',
      backgroundColor: colors.canvas,
    },
    pressed: {
      opacity: PRESSED_OPACITY,
    },
    document: {
      width: '100%',
      height: undefined,
      minHeight: TILE_SIZE,
      justifyContent: 'center',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    fileTile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      padding: Space.md,
    },
    fileName: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      color: colors.inkSecondary,
      fontWeight: FontWeight.semibold,
    },
    removeTarget: {
      position: 'absolute',
      top: REMOVE_BADGE_OFFSET - Space.md,
      right: REMOVE_BADGE_OFFSET - Space.md,
      width: HitSize.md,
      height: HitSize.md,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    removeBadge: {
      width: IconSize.md,
      height: IconSize.md,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addTile: {
      borderRadius: Radius.card,
      backgroundColor: colors.canvas,
    },
    addTrigger: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
