import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FileText, Plus, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { isImageAttachmentMimeType } from '@clawket/agent-protocol';
import { PendingImage } from '../../types/chat';
import { BorderWidth, FontSize, FontWeight, HitSize, IconSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { Radius, Space } from '../../theme/tokens';
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

function isFileAttachment(img: PendingImage): boolean {
  return !isImageAttachmentMimeType(img.mimeType);
}

export function PendingImageBar({ images, canAddMore, attachDisabled = false, onOpenPreview, onRemove, onPickImage, onTakePhoto, onChooseFile }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { colors } = theme;

  return (
    <View style={styles.imagePreviewBar}>
      {images.map((img, idx) => (
        <View key={`${img.uri}_${idx}`} style={styles.imagePreviewItem}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenPreview(idx)}>
            {isFileAttachment(img) ? (
              <View
                testID={`pending-attachment-file-${idx}`}
                style={[styles.imagePreviewThumb, styles.fileThumb]}
              >
                <FileText size={20} color={colors.inkSecondary} strokeWidth={1.8} />
                <Text style={styles.fileThumbName} numberOfLines={1}>
                  {img.fileName?.trim() || t('File', { ns: 'chat' })}
                </Text>
              </View>
            ) : (
              <Image
                testID={`pending-attachment-image-${idx}`}
                source={{ uri: img.uri }}
                style={styles.imagePreviewThumb}
              />
            )}
          </TouchableOpacity>
          <Pressable
            testID={`pending-attachment-remove-${idx}`}
            accessibilityRole="button"
            accessibilityLabel={t('Remove', { ns: 'common' })}
            onPress={() => onRemove(idx)}
            style={styles.imagePreviewItemRemoveHitTarget}
          >
            <View
              testID={`pending-attachment-remove-${idx}-visual`}
              style={styles.imagePreviewItemRemoveVisual}
            >
              <X size={12} color={colors.onAccent} strokeWidth={2.3} />
            </View>
          </Pressable>
        </View>
      ))}
      {canAddMore && (
        <AttachmentMenu
          disabled={attachDisabled}
          style={styles.imagePreviewAdd}
          onPickImage={onPickImage}
          onTakePhoto={onTakePhoto}
          onChooseFile={onChooseFile}
        >
          <View style={styles.imagePreviewAddTrigger}>
            <Plus size={20} color={attachDisabled ? colors.inkTertiary : colors.inkTertiary} strokeWidth={2.2} />
          </View>
        </AttachmentMenu>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    imagePreviewBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderTopColor: colors.line,
      borderTopWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: Space.sm,
      gap: Space.sm,
    },
    imagePreviewItem: {
      position: 'relative',
    },
    imagePreviewThumb: {
      width: 48,
      height: 48,
      borderRadius: Radius.card,
      backgroundColor: colors.surface,
    },
    fileThumb: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      paddingHorizontal: 2,
    },
    fileThumbName: {
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
      fontWeight: FontWeight.semibold,
      marginTop: 1,
      maxWidth: 44,
    },
    imagePreviewItemRemoveHitTarget: {
      position: 'absolute',
      top: -Space.lg,
      right: -Space.lg,
      width: HitSize.md,
      height: HitSize.md,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    imagePreviewItemRemoveVisual: {
      width: IconSize.md,
      height: IconSize.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.full,
      backgroundColor: colors.bad,
    },
    imagePreviewAdd: {
      borderRadius: Radius.card,
      borderWidth: BorderWidth.strong,
      borderColor: colors.line,
      borderStyle: 'dashed',
    },
    imagePreviewAddTrigger: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
