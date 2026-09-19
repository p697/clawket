import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
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
import { SheetHeaderButton } from './SheetHeaderButton';

const HANDLE_WIDTH = 36;
/**
 * Air between the header row and the body. The row already carries 4 points
 * under a 44-point button, so content starts 16 points below the control edge
 * (`ScreenHeader` keeps the same relationship on pages).
 */
const HEADER_BOTTOM_PADDING = Space.md;

export function useSheetBackgroundStyle(): ViewStyle {
  const { theme } = useAppTheme();
  return useMemo(
    () => ({
      backgroundColor: theme.colors.canvas,
      borderTopLeftRadius: Radius.bottomSheet,
      borderTopRightRadius: Radius.bottomSheet,
    }),
    [theme.colors.canvas],
  );
}

export function SheetDragHandle({ testID }: { testID?: string }): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHandleStyles(theme.colors), [theme.colors]);
  return (
    <View style={styles.handleArea}>
      <View testID={testID} style={styles.handle} />
    </View>
  );
}

export type SheetHeaderProps = {
  title?: string;
  /** Replaces the centered title text, e.g. the Session Panel's Agent pill. */
  titleContent?: React.ReactNode;
  onClose: () => void;
  closeAccessibilityLabel: string;
  right?: React.ReactNode;
  testID?: string;
};

export function SheetHeader({
  title,
  titleContent,
  onClose,
  closeAccessibilityLabel,
  right,
  testID,
}: SheetHeaderProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createHeaderStyles(theme.colors), [theme.colors]);

  return (
    <View testID={testID ? `${testID}-header` : undefined} style={styles.header}>
      <View style={styles.sideSlot}>
        <SheetHeaderButton
          icon={X}
          onPress={onClose}
          accessibilityLabel={closeAccessibilityLabel}
          testID={testID ? `${testID}-close` : undefined}
        />
      </View>
      {titleContent ? (
        <View style={styles.titleSlot}>{titleContent}</View>
      ) : (
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      )}
      <View style={[styles.sideSlot, styles.trailingSlot]}>{right}</View>
    </View>
  );
}

function createHandleStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
) {
  return StyleSheet.create({
    // The grabber sits 8 points under the sheet edge in its 16-point area, so
    // 8 points separate it from the header's 44-point controls. Bottom-aligning
    // it left only 4 points to the controls, so it read as part of the Session
    // Panel's Agent pill; centering (6 points) read as too close to the edge
    // (owner feedback 2026-09-19). `Sheet` reserves this same height in its
    // content limit.
    handleArea: {
      height: Space.lg,
      paddingTop: Space.sm,
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    handle: {
      width: HANDLE_WIDTH,
      height: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: colors.line,
    },
  });
}

function createHeaderStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
) {
  return StyleSheet.create({
    header: {
      minHeight: ControlSize.settingsRow,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Space.lg,
      paddingBottom: HEADER_BOTTOM_PADDING,
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
    titleSlot: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      paddingHorizontal: Space.sm,
    },
    title: {
      flex: 1,
      color: colors.ink,
      textAlign: 'center',
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
      paddingHorizontal: Space.sm,
    },
  });
}
