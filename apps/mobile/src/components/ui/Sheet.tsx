import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import {
  BottomSheetFooter,
  BottomSheetFooterContainer,
  type BottomSheetFooterProps,
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
/** Air between the body and a pinned footer; the body reserves it too. */
const FOOTER_TOP_PADDING = Space.sm;

type SheetFooterSlot = Readonly<{
  node: React.ReactNode;
  style: ViewStyle;
  onLayout: (event: LayoutChangeEvent) => void;
  testID?: string;
}>;

const SheetFooterContext = createContext<SheetFooterSlot | null>(null);

/**
 * Gorhom remounts the footer whenever the component identity changes, so this
 * stays a module-level component and reads the live slot through context.
 */
function SheetFooter(props: BottomSheetFooterProps): React.JSX.Element | null {
  const slot = useContext(SheetFooterContext);
  if (!slot) return null;
  return (
    <BottomSheetFooter {...props} style={slot.style}>
      <View testID={slot.testID} onLayout={slot.onLayout}>{slot.node}</View>
    </BottomSheetFooter>
  );
}

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
  /**
   * Pinned to the visible bottom edge at every detent (fixed-snap content is
   * laid out for the tallest one, so an inline footer hides below the fold).
   * The body shrinks by the footer's measured height so nothing ends under it.
   */
  footer?: React.ReactNode;
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
  footer,
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

  // Gorhom tracks the sheet position for the footer; the footer carries the
  // same bottom padding as the sheet so it clears the home indicator itself.
  const bottomPadding = Math.max(insets.bottom, Space.md);
  const [footerHeight, setFooterHeight] = useState(0);
  const handleFooterLayout = useCallback(
    (event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height),
    [],
  );
  const footerStyle = useMemo<ViewStyle>(
    () => ({ ...styles.footer, paddingBottom: bottomPadding }),
    [bottomPadding, styles.footer],
  );
  const footerSlot = useMemo<SheetFooterSlot>(
    () => ({
      node: footer,
      style: footerStyle,
      onLayout: handleFooterLayout,
      testID: testID ? `${testID}-footer` : undefined,
    }),
    [footer, footerStyle, handleFooterLayout, testID],
  );
  // Rendered inside the modal view (not through `footerComponent`) so the slot's
  // context reaches it through the portal and VoiceOver does not treat it as a
  // sibling hidden behind `accessibilityViewIsModal`.
  const footerContainer = footer ? (
    <SheetFooterContext.Provider value={footerSlot}>
      <BottomSheetFooterContainer footerComponent={SheetFooter} />
    </SheetFooterContext.Provider>
  ) : null;

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
        testID={testID ? `${testID}-body` : undefined}
        style={[
          (usesFixedSnapPoints || fixedIpadSheetHeight !== undefined) && styles.fixedBody,
          contentStyle,
          footer ? { paddingBottom: footerHeight + FOOTER_TOP_PADDING } : null,
        ]}
      >
        {children}
      </View>
      {footerContainer}
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
          style={[styles.sheet, styles.fixedSheet, { paddingBottom: bottomPadding }, style]}
          accessibilityViewIsModal
        >
          {sheetContent}
        </View>
      ) : (
        <BottomSheetView
          testID={testID}
          style={[styles.sheet, { paddingBottom: bottomPadding }, style, contentViewportStyle]}
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
    footer: {
      paddingHorizontal: Space.lg,
      paddingTop: FOOTER_TOP_PADDING,
      backgroundColor: colors.canvas,
    },
  });
}
