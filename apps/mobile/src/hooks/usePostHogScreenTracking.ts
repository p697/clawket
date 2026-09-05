import { useCallback, useRef } from 'react';
import { NavigationContainerRefWithCurrent, NavigationState, ParamListBase } from '@react-navigation/native';
import type { BackendKind } from '@clawket/agent-protocol';
import { getManualTrackedScreen, getTrackedScreen } from '../utils/posthog-navigation';
import { capturePostHogScreen } from '../services/analytics/posthog';

type Args<T extends ParamListBase> = {
  rootNavigationRef: NavigationContainerRefWithCurrent<T>;
  activeBackend?: BackendKind | null;
};

export function usePostHogScreenTracking<T extends ParamListBase>({
  rootNavigationRef,
  activeBackend = null,
}: Args<T>): {
  trackInitialScreen: () => void;
  trackScreenState: (state: NavigationState | undefined) => void;
  trackManualScreen: (screen: 'SessionPanel' | 'Paywall') => void;
} {
  const lastTrackedKeyRef = useRef<string | null>(null);

  const trackScreen = useCallback((state: NavigationState | undefined, phase: 'initial' | 'navigation') => {
    const trackedScreen = getTrackedScreen(state, { backend: activeBackend });
    if (!trackedScreen) return;
    if (phase === 'navigation' && lastTrackedKeyRef.current === trackedScreen.uniqueKey) return;

    lastTrackedKeyRef.current = trackedScreen.uniqueKey;

    void capturePostHogScreen(trackedScreen.name, trackedScreen.properties).catch(() => {});
  }, [activeBackend]);

  const trackInitialScreen = useCallback(() => {
    trackScreen(rootNavigationRef.getRootState(), 'initial');
  }, [rootNavigationRef, trackScreen]);

  const trackScreenState = useCallback((state: NavigationState | undefined) => {
    trackScreen(state, 'navigation');
  }, [trackScreen]);

  const trackManualScreen = useCallback((screen: 'SessionPanel' | 'Paywall') => {
    const trackedScreen = getManualTrackedScreen(screen, { backend: activeBackend });
    void capturePostHogScreen(trackedScreen.name, trackedScreen.properties).catch(() => {});
  }, [activeBackend]);

  return {
    trackInitialScreen,
    trackScreenState,
    trackManualScreen,
  };
}
