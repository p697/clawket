import React, { useCallback, useMemo, useRef, useState } from 'react';
import { I18nManager, StyleSheet, useWindowDimensions } from 'react-native';
import {
  BottomSheetModal,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context';
import { getIpadModalSheetMetrics, hasPanelSpace } from '../../utils/ipad-layout';
import { getRuntimePlatform } from '../../utils/platform';
import { Radius } from '../../theme/tokens';
import { PresentationSafeAreaProvider } from './PresentationSafeAreaProvider';

export type AdaptiveBottomSheetModalRef = React.ElementRef<typeof BottomSheetModal>;

type AdaptiveBottomSheetModalProps<T = unknown> = BottomSheetModalProps<T> & {
  adaptive?: boolean;
  preferredHeight?: number;
  onPresentationMetrics?: (metrics: Metrics) => void;
};

export const AdaptiveBottomSheetModal = React.forwardRef<
  AdaptiveBottomSheetModalRef,
  AdaptiveBottomSheetModalProps
>(function AdaptiveBottomSheetModal(
  {
    adaptive = true,
    preferredHeight,
    onPresentationMetrics,
    containerComponent,
    style,
    backgroundStyle,
    containerStyle,
    detached,
    enableDynamicSizing,
    index,
    snapPoints,
    topInset,
    bottomInset,
    ...props
  },
  ref,
): React.JSX.Element {
  const window = useWindowDimensions();
  const inheritedInsets = useSafeAreaInsets();
  const [presentation, setPresentation] = useState<Metrics | null>(null);
  const windowWidth = presentation?.frame.width ?? window.width;
  const windowHeight = presentation?.frame.height ?? window.height;
  const insets = presentation?.insets ?? inheritedInsets;
  const enabled = adaptive && getRuntimePlatform() === 'ios';
  const containerRef = useRef(containerComponent);
  const onMetricsRef = useRef(onPresentationMetrics);
  containerRef.current = containerComponent;
  onMetricsRef.current = onPresentationMetrics;
  const handleMetrics = useCallback((value: Metrics) => {
    setPresentation(value);
    onMetricsRef.current?.(value);
  }, []);
  // Gorhom keys its native host by component identity. Keep this type stable
  // while reporting the detached presentation's own measurements to its owner.
  const [MeasuredContainer] = useState(() => function MeasuredSheetContainer({ children }: React.PropsWithChildren) {
    const Container = containerRef.current ?? React.Fragment;
    return <Container><PresentationSafeAreaProvider style={StyleSheet.absoluteFill} pointerEvents="box-none" onMetrics={handleMetrics}>{children}</PresentationSafeAreaProvider></Container>;
  });
  const metrics = useMemo(
    () => (
      enabled && hasPanelSpace(windowWidth - insets.left - insets.right)
        ? getIpadModalSheetMetrics({
          windowWidth,
          windowHeight,
          topInset: insets.top,
          bottomInset: insets.bottom,
          leftInset: insets.left,
          rightInset: insets.right,
          preferredHeight,
        })
        : null
    ),
    [enabled, insets.bottom, insets.top, insets.left, insets.right, windowHeight, windowWidth, preferredHeight],
  );

  if (!metrics) {
    return (
      <BottomSheetModal
        {...props}
        ref={ref}
        containerComponent={enabled ? MeasuredContainer : containerComponent}
        style={style}
        backgroundStyle={backgroundStyle}
        bottomInset={bottomInset}
        containerStyle={enabled ? [containerStyle, {
          // Compact sheets also share the scene with a movable system bar.
          marginLeft: undefined,
          marginRight: undefined,
          marginStart: I18nManager.isRTL ? insets.right : insets.left,
          marginEnd: I18nManager.isRTL ? insets.left : insets.right,
        }] : containerStyle}
        detached={detached}
        enableDynamicSizing={enableDynamicSizing}
        index={index}
        snapPoints={snapPoints}
        topInset={topInset}
      />
    );
  }

  return (
    <BottomSheetModal
      {...props}
      ref={ref}
      containerComponent={MeasuredContainer}
      // The background is a sibling of the content, so rounding it alone
      // cannot clip opaque scroll views or footers in a detached panel.
      style={[
        style,
        {
          overflow: 'hidden',
          borderRadius: Radius.bottomSheet,
        },
      ]}
      backgroundStyle={[
        backgroundStyle,
        {
          overflow: 'hidden',
          borderBottomLeftRadius: Radius.bottomSheet,
          borderBottomRightRadius: Radius.bottomSheet,
        },
      ]}
      bottomInset={metrics.bottomInset}
      containerStyle={[
        containerStyle,
        {
          // Insets are physical; RN swaps left/right styles in RTL by default.
          marginLeft: undefined,
          marginRight: undefined,
          marginStart: I18nManager.isRTL ? metrics.rightMargin : metrics.leftMargin,
          marginEnd: I18nManager.isRTL ? metrics.leftMargin : metrics.rightMargin,
        },
      ]}
      detached
      enableDynamicSizing={false}
      index={0}
      snapPoints={[metrics.height]}
      topInset={metrics.topInset}
    />
  );
});
