import React, { useMemo } from 'react';
import {
  DimensionValue,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { FloatingButton } from './FloatingButton';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  closeAccessibilityLabel: string;
  title?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: DimensionValue;
  dismissOnBackdropPress?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * App-owned bottom sheet chrome for content that does not need virtualized
 * Gorhom snap points. The visible close control is intentionally independent
 * from drag and backdrop gestures.
 */
export function Sheet({
  visible,
  onClose,
  closeAccessibilityLabel,
  title,
  headerRight,
  children,
  maxHeight = '90%',
  dismissOnBackdropPress = true,
  style,
  contentStyle,
  testID,
}: SheetProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          accessible={false}
          onPress={dismissOnBackdropPress ? onClose : undefined}
          style={styles.backdrop}
        />
        <View testID={testID} style={[styles.sheet, { maxHeight }, style]}>
          <View style={styles.handleArea}>
            <View
              testID={testID ? `${testID}-handle` : undefined}
              style={styles.handle}
            />
          </View>
          <View style={styles.header}>
            <View style={styles.sideSlot}>
              <FloatingButton
                icon={X}
                onPress={onClose}
                accessibilityLabel={closeAccessibilityLabel}
                appearance="quiet"
                testID={testID ? `${testID}-close` : undefined}
              />
            </View>
            {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
            <View style={[styles.sideSlot, styles.trailingSlot]}>{headerRight}</View>
          </View>
          <View style={contentStyle}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  const backdropColor = scheme === 'dark' ? colors.canvas : colors.ink;
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: backdropColor,
      opacity: 0.4,
    },
    sheet: {
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderTopLeftRadius: Radius.bottomSheet,
      borderTopRightRadius: Radius.bottomSheet,
    },
    handleArea: {
      height: Space.md,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    handle: {
      width: ControlSize.compact,
      height: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: colors.line,
    },
    header: {
      minHeight: ControlSize.settingsRow,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Space.lg,
    },
    sideSlot: {
      width: ControlSize.floatingButton,
      minHeight: ControlSize.floatingButton,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    trailingSlot: {
      alignItems: 'flex-end',
    },
    title: {
      flex: 1,
      color: colors.ink,
      textAlign: 'center',
      fontSize: FontSize.title,
      lineHeight: LineHeight.title,
      fontWeight: FontWeight.semibold,
      paddingHorizontal: Space.sm,
    },
  });
}
