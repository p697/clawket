import React, { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  BottomSheetModal,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getIpadModalSheetMetrics } from '../../utils/ipad-layout';
import { isIPad } from '../../utils/platform';
import { Radius } from '../../theme/tokens';

export type AdaptiveBottomSheetModalRef = React.ElementRef<typeof BottomSheetModal>;

type AdaptiveBottomSheetModalProps<T = unknown> = BottomSheetModalProps<T> & {
  adaptiveIpad?: boolean;
};

export const AdaptiveBottomSheetModal = React.forwardRef<
  AdaptiveBottomSheetModalRef,
  AdaptiveBottomSheetModalProps
>(function AdaptiveBottomSheetModal(
  {
    adaptiveIpad = true,
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const metrics = useMemo(
    () => (
      adaptiveIpad && isIPad && windowWidth >= 600
        ? getIpadModalSheetMetrics({
          windowWidth,
          windowHeight,
          topInset: insets.top,
          bottomInset: insets.bottom,
        })
        : null
    ),
    [adaptiveIpad, insets.bottom, insets.top, windowHeight, windowWidth],
  );

  if (!metrics) {
    return (
      <BottomSheetModal
        {...props}
        ref={ref}
        style={style}
        backgroundStyle={backgroundStyle}
        bottomInset={bottomInset}
        containerStyle={containerStyle}
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
        { marginHorizontal: metrics.horizontalMargin },
      ]}
      detached
      enableDynamicSizing={false}
      index={0}
      snapPoints={[metrics.height]}
      topInset={metrics.topInset}
    />
  );
});
