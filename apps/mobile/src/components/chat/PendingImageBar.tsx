import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FileText, Plus, X } from 'lucide-react-native';
import { PendingImage } from '../../types/chat';
import { BorderWidth, FontSize, FontWeight } from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { Radius, Space } from '../../theme/tokens';
import { CircleButton } from '../ui';
import { AttachmentMenu } from './AttachmentMenu';

type Props = {
  images: PendingImage[];
  canAddMore: boolean;
  attachDisabled?: boolean;
  onOpenPreview: (index: number) => void;
  onRemove: (index: number) => void;
  onPickImage: () => void | Promise<void>;
  onTakePhoto: () => void | Promise<void>;
  onChooseFile: () => void | Promise<void>;
};

function isFileAttachment(img: PendingImage): boolean {
  return !img.mimeType.startsWith('image/');
}

export function PendingImageBar({ images, canAddMore, attachDisabled = false, onOpenPreview, onRemove, onPickImage, onTakePhoto, onChooseFile }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { colors } = theme;

  return (
    <View style={styles.imagePreviewBar}>
      {images.map((img, idx) => (
        <View key={`${img.uri}_${idx}`} style={styles.imagePreviewItem}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenPreview(idx)}>
            {isFileAttachment(img) ? (
              <View style={[styles.imagePreviewThumb, styles.fileThumb]}>
                <FileText size={20} color={colors.textMuted} strokeWidth={1.8} />
                <Text style={styles.fileThumbName} numberOfLines={1}>
                  {(img as PendingImage & { fileName?: string }).fileName ?? 'File'}
                </Text>
              </View>
            ) : (
              <Image source={{ uri: img.uri }} style={styles.imagePreviewThumb} />
            )}
          </TouchableOpacity>
          <CircleButton
            icon={<X size={12} color={colors.primaryText} strokeWidth={2.3} />}
            onPress={() => onRemove(idx)}
            size={20}
            color={colors.error}
            style={styles.imagePreviewItemRemove}
          />
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
            <Plus size={20} color={attachDisabled ? colors.textSubtle : colors.imageAddText} strokeWidth={2.2} />
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
      borderTopColor: colors.border,
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
      borderRadius: Radius.sm,
      backgroundColor: colors.surfaceMuted,
    },
    fileThumb: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 2,
    },
    fileThumbName: {
      fontSize: FontSize.nano,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
      marginTop: 1,
      maxWidth: 44,
    },
    imagePreviewItemRemove: {
      position: 'absolute',
      top: -6,
      right: -6,
    },
    imagePreviewAdd: {
      borderRadius: Radius.sm,
      borderWidth: BorderWidth.strong,
      borderColor: colors.imageAddBorder,
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
