import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
  createSurfaceStyle,
} from '../../theme/tokens';
import { Button } from './Button';
import { FloatingButton } from './FloatingButton';

export type ConfirmationModalProps = Readonly<{
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  destructive?: boolean;
  testID?: string;
}>;

/** App-owned centered confirmation chrome. */
export function ConfirmationModal({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
  destructive = false,
  testID = 'confirmation-modal',
}: ConfirmationModalProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          testID={`${testID}-backdrop`}
          accessible={false}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View testID={`${testID}-card`} style={styles.card}>
          <View style={styles.header}>
            <View style={styles.sideSlot} />
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <View style={styles.sideSlot}>
              <FloatingButton
                testID={`${testID}-close`}
                icon={X}
                onPress={onClose}
                accessibilityLabel={cancelLabel}
                appearance="quiet"
              />
            </View>
          </View>
          <View testID={testID} style={styles.content}>
            <Text style={styles.message} numberOfLines={4}>{message}</Text>
            <View style={styles.actions}>
              <Button
                testID={`${testID}-cancel`}
                label={cancelLabel}
                variant="secondary"
                onPress={onClose}
                style={styles.action}
              />
              <Button
                testID={`${testID}-confirm`}
                label={confirmLabel}
                variant={destructive ? 'destructive' : 'primary'}
                onPress={onConfirm}
                style={styles.action}
              />
            </View>
          </View>
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
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.scrim,
    },
    card: {
      width: '100%',
      maxWidth: 440,
      maxHeight: '60%',
      alignSelf: 'center',
      borderRadius: Radius.xl,
      overflow: 'hidden',
      ...createSurfaceStyle(colors, scheme, 'overlay'),
    },
    header: {
      minHeight: ControlSize.settingsRow,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
    },
    sideSlot: {
      width: ControlSize.floatingButton,
      minHeight: ControlSize.floatingButton,
      alignItems: 'center',
      justifyContent: 'center',
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
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.lg,
      gap: Space.lg,
    },
    message: {
      color: colors.inkSecondary,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    },
    actions: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    action: {
      flex: 1,
    },
  });
}
