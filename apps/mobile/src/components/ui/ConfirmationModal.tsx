import React, { useMemo } from 'react';
import { I18nManager, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { PresentationSafeAreaProvider } from './PresentationSafeAreaProvider';

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
  onClose,
  ...props
}: ConfirmationModalProps): React.JSX.Element {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <PresentationSafeAreaProvider>
        <ConfirmationContent {...props} onClose={onClose} />
      </PresentationSafeAreaProvider>
    </Modal>
  );
}

function ConfirmationContent({
  title,
  message,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
  destructive = false,
  testID = 'confirmation-modal',
}: Omit<ConfirmationModalProps, 'visible'>): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  return (
    <View testID={`${testID}-safe-area`} style={[styles.root, {
      paddingTop: insets.top + Space.xl,
      paddingBottom: insets.bottom + Space.xl,
      paddingStart: (I18nManager.isRTL ? insets.right : insets.left) + Space.xl,
      paddingEnd: (I18nManager.isRTL ? insets.left : insets.right) + Space.xl,
    }]} accessibilityViewIsModal>
      <Pressable
        testID={`${testID}-backdrop`}
        accessible={false}
        onPress={onClose}
        style={styles.backdrop}
      />
      <View testID={`${testID}-card`} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.sideSlot} />
          {/* Two lines: pairing names a computer (`Connect to Claude Code · Computer?`), which one line cut off. */}
          <Text testID={`${testID}-title`} style={styles.title} numberOfLines={2}>{title}</Text>
          <View style={styles.sideSlot}>
            <FloatingButton
              testID={`${testID}-close`}
              icon={X}
              onPress={onClose}
              accessibilityLabel={cancelLabel}
              appearance="plain"
            />
          </View>
        </View>
        <ScrollView testID={testID} style={styles.scroll} contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled">
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
        </ScrollView>
      </View>
    </View>
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
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.scrim,
    },
    card: {
      width: '100%',
      maxWidth: 440,
      maxHeight: '100%',
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
      paddingTop: Space.md,
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
      paddingTop: Space.md,
      paddingBottom: Space.xl,
      gap: Space.xl,
    },
    scroll: {
      flexGrow: 0,
      flexShrink: 1,
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
