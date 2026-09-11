import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  type DimensionValue,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import {
  type BottomSheetModalProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import {
  Easing,
  type ReduceMotion,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme';
import { Motion, Radius, Space } from '../../theme/tokens';
import { getIpadModalSheetMetrics } from '../../utils/ipad-layout';
import { isIPad } from '../../utils/platform';
import {
  AdaptiveBottomSheetModal,
  type AdaptiveBottomSheetModalRef,
} from './AdaptiveBottomSheetModal';
import { SheetBackdrop } from './SheetBackdrop';
import {
  SheetDragHandle,
  SheetHeader,
  useSheetBackgroundStyle,
} from './SheetHeader';
import { ThemedFullWindowOverlay } from './ThemedFullWindowOverlay';

const REDUCE_MOTION_SYSTEM = 'system' as ReduceMotion;

export const SHEET_TIMING_CONFIG: WithTimingConfig = {
  duration: Motion.duration.slow,
  easing: Easing.out(Easing.cubic),
  reduceMotion: REDUCE_MOTION_SYSTEM,
};

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  onAfterClose?: () => void;
  closeAccessibilityLabel: string;
  title?: string;
  titleContent?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: DimensionValue;
  snapPoints?: BottomSheetModalProps['snapPoints'];
  initialIndex?: number;
  dismissOnBackdropPress?: boolean;
  keyboardBehavior?: BottomSheetModalProps['keyboardBehavior'];
  keyboardBlurBehavior?: BottomSheetModalProps['keyboardBlurBehavior'];
  androidKeyboardInputMode?: BottomSheetModalProps['android_keyboardInputMode'];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export function resolveSheetMaxHeight(
  maxHeight: DimensionValue,
  availableHeight: number,
): number {
  const safeAvailableHeight = Number.isFinite(availableHeight) && availableHeight > 0
    ? availableHeight
    : 1;

  if (typeof maxHeight === 'number' && Number.isFinite(maxHeight)) {
    return Math.max(1, Math.min(maxHeight, safeAvailableHeight));
  }

  if (typeof maxHeight === 'string' && maxHeight.endsWith('%')) {
    const percentage = Number.parseFloat(maxHeight.slice(0, -1));
    if (Number.isFinite(percentage) && percentage > 0) {
      return Math.max(
        1,
        Math.min(safeAvailableHeight, safeAvailableHeight * percentage / 100),
      );
    }
  }

  return safeAvailableHeight;
}

/**
 * Gorhom's dynamic detent includes its separately measured handle height.
 * Keep the measured content viewport inside the requested total sheet height.
 */
export function resolveSheetContentHeightLimit(
  maxSheetHeight: number,
  fixedSheetHeight?: number,
): number {
  const boundedSheetHeight = typeof fixedSheetHeight === 'number'
    && Number.isFinite(fixedSheetHeight)
    && fixedSheetHeight > 0
    ? Math.min(maxSheetHeight, fixedSheetHeight)
    : maxSheetHeight;
  return Math.max(1, boundedSheetHeight - Space.lg);
}

/** Shared phone bottom sheet and automatically centered iPad panel. */
export function Sheet({
  visible,
  onClose,
  onAfterClose,
  closeAccessibilityLabel,
  title,
  titleContent,
  headerRight,
  children,
  maxHeight = '90%',
  snapPoints,
  initialIndex = 0,
  dismissOnBackdropPress = true,
  keyboardBehavior = 'interactive',
  keyboardBlurBehavior = 'restore',
  androidKeyboardInputMode = 'adjustResize',
  style,
  contentStyle,
  testID,
}: SheetProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const modalRef = useRef<AdaptiveBottomSheetModalRef>(null);
  const presentedRef = useRef(false);
  const visibleRef = useRef(visible);
  const onCloseRef = useRef(onClose);
  const onAfterCloseRef = useRef(onAfterClose);
  visibleRef.current = visible;
  onCloseRef.current = onClose;
  onAfterCloseRef.current = onAfterClose;

  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const backgroundStyle = useSheetBackgroundStyle();
  const usesFixedSnapPoints = snapPoints !== undefined;
  const maxDynamicContentSize = useMemo(
    () => resolveSheetMaxHeight(
      maxHeight,
      windowHeight - insets.top - insets.bottom,
    ),
    [insets.bottom, insets.top, maxHeight, windowHeight],
  );
  const fixedIpadSheetHeight = useMemo(
    () => (isIPad
      ? getIpadModalSheetMetrics({
        windowWidth,
        windowHeight,
        topInset: insets.top,
        bottomInset: insets.bottom,
      }).height
      : undefined),
    [insets.bottom, insets.top, windowHeight, windowWidth],
  );
  const contentHeightLimit = useMemo(
    () => resolveSheetContentHeightLimit(
      maxDynamicContentSize,
      fixedIpadSheetHeight,
    ),
    [fixedIpadSheetHeight, maxDynamicContentSize],
  );
  const contentViewportStyle = useMemo<ViewStyle>(
    () => (fixedIpadSheetHeight === undefined
      ? { maxHeight: contentHeightLimit }
      : { height: contentHeightLimit, maxHeight: contentHeightLimit }),
    [contentHeightLimit, fixedIpadSheetHeight],
  );

  useEffect(() => {
    if (visible) {
      presentedRef.current = true;
      modalRef.current?.present();
    } else if (presentedRef.current) {
      presentedRef.current = false;
      modalRef.current?.dismiss();
    }
  }, [visible]);

  const handleDismiss = useCallback(() => {
    presentedRef.current = false;
    if (visibleRef.current) {
      onCloseRef.current();
    }
    onAfterCloseRef.current?.();
  }, []);

  const close = useCallback(() => onCloseRef.current(), []);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof SheetBackdrop>) => (
      <SheetBackdrop
        {...props}
        testID={testID ? `${testID}-backdrop` : undefined}
        dismissOnPress={dismissOnBackdropPress}
        onBackdropPress={close}
      />
    ),
    [dismissOnBackdropPress, close, testID],
  );

  const renderHandle = useCallback(
    () => <SheetDragHandle testID={testID ? `${testID}-handle` : undefined} />,
    [testID],
  );

  const sheetContent = (
    <>
      <SheetHeader
        title={title}
        titleContent={titleContent}
        onClose={onClose}
        closeAccessibilityLabel={closeAccessibilityLabel}
        right={headerRight}
        testID={testID}
      />
      <View
        style={[
          (usesFixedSnapPoints || fixedIpadSheetHeight !== undefined) && styles.fixedBody,
          contentStyle,
        ]}
      >
        {children}
      </View>
    </>
  );

  return (
    <AdaptiveBottomSheetModal
      ref={modalRef}
      accessible={false}
      index={initialIndex}
      enableDynamicSizing={!usesFixedSnapPoints}
      maxDynamicContentSize={usesFixedSnapPoints ? undefined : maxDynamicContentSize}
      snapPoints={snapPoints}
      enablePanDownToClose={dismissOnBackdropPress}
      backdropComponent={renderBackdrop}
      handleComponent={renderHandle}
      backgroundStyle={backgroundStyle}
      containerComponent={ThemedFullWindowOverlay}
      animationConfigs={SHEET_TIMING_CONFIG}
      overrideReduceMotion={REDUCE_MOTION_SYSTEM}
      onDismiss={handleDismiss}
      topInset={insets.top}
      keyboardBehavior={keyboardBehavior}
      keyboardBlurBehavior={keyboardBlurBehavior}
      android_keyboardInputMode={androidKeyboardInputMode}
    >
      {usesFixedSnapPoints ? (
        <View
          testID={testID}
          style={[styles.sheet, styles.fixedSheet, { paddingBottom: Math.max(insets.bottom, Space.md) }, style]}
          accessibilityViewIsModal
        >
          {sheetContent}
        </View>
      ) : (
        <BottomSheetView
          testID={testID}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Space.md) }, style, contentViewportStyle]}
          accessibilityViewIsModal
        >
          {sheetContent}
        </BottomSheetView>
      )}
    </AdaptiveBottomSheetModal>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
) {
  return StyleSheet.create({
    sheet: {
      overflow: 'hidden',
      backgroundColor: colors.canvas,
      borderTopLeftRadius: Radius.bottomSheet,
      borderTopRightRadius: Radius.bottomSheet,
    },
    fixedBody: {
      flex: 1,
      minHeight: 0,
    },
    fixedSheet: {
      flex: 1,
    },
  });
}
