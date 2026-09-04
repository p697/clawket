import React, { useMemo } from 'react';
import { DimensionValue, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { IconButton } from './IconButton';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  headerRight?: React.ReactNode;
  height?: DimensionValue;
  maxHeight?: DimensionValue;
  children: React.ReactNode;
};

export function ModalSheet({
  visible,
  onClose,
  title,
  headerRight,
  height,
  maxHeight = '75%',
  children,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.card, { maxHeight }, height != null && { height }]}>
          {title != null && (
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {headerRight}
              <IconButton
                icon={<X size={20} color={theme.colors.textMuted} strokeWidth={2} />}
                onPress={onClose}
              />
            </View>
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Space.lg,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    card: {
      borderRadius: Radius.xl,
      overflow: 'hidden',
      ...createSurfaceStyle(colors, scheme, 'overlay'),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.sm,
    },
    title: {
      color: colors.text,
      fontSize: FontSize.lg,
      lineHeight: LineHeight.lg,
      fontWeight: FontWeight.bold,
      flex: 1,
      marginRight: Space.sm,
    },
  });
}
