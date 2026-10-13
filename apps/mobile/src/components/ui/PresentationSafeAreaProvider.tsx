import React, { useLayoutEffect } from 'react';
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaFrame,
  useSafeAreaInsets,
  type Metrics,
  type SafeAreaProviderProps,
} from 'react-native-safe-area-context';

/** Measure inside the native presentation; never seed it with the underlying pane. */
export function PresentationSafeAreaProvider({ children, onMetrics, ...props }: Pick<SafeAreaProviderProps,
  'children' | 'style' | 'pointerEvents' | 'testID'
> & { onMetrics?: (metrics: Metrics) => void }): React.JSX.Element {
  return (
    <SafeAreaFrameContext.Provider value={null}>
      <SafeAreaInsetsContext.Provider value={null}>
        <SafeAreaProvider {...props}>
          {onMetrics ? <PresentationMetrics onMetrics={onMetrics} /> : null}
          {children}
        </SafeAreaProvider>
      </SafeAreaInsetsContext.Provider>
    </SafeAreaFrameContext.Provider>
  );
}

function PresentationMetrics({ onMetrics }: { onMetrics: (metrics: Metrics) => void }): null {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  useLayoutEffect(() => { onMetrics({ frame, insets }); }, [frame, insets, onMetrics]);
  return null;
}
