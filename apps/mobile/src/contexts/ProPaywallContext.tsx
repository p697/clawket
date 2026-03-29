import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import Purchases from 'react-native-purchases';
import {
  classifyProPurchaseError,
  deriveProSubscriptionSnapshot,
  ensureRevenueCatConfigured,
  ProSubscriptionService,
  type ProPurchaseResult,
  type ProPaywallPackage,
  type ProSubscriptionSnapshot,
  resolveRevenueCatConfig,
  selectDefaultRevenueCatPackage,
  selectSnapshotRevenueCatPackage,
} from '../services/pro-subscription';
import { StorageService } from '../services/storage';
import { syncAnalyticsSubscriptionContext } from '../services/analytics/subscription-context';
import { ProFeature, resolvePreviewPaywallFeature, resolveProAccessEnabled } from '../utils/pro';

export type ProPaywallErrorCode =
  | 'notConfigured'
  | 'purchaseUnavailable'
  | 'purchaseCancelled'
  | 'purchasePending'
  | 'purchaseFailed'
  | 'restoreNotFound'
  | 'restoreFailed'
  | 'offeringsUnavailable';

export type ProPaywallStatusCode =
  | 'restoreSuccess';

type ProPaywallContextType = {
  isPro: boolean;
  debugOverrideEnabled: boolean;
  visible: boolean;
  previewOnly: boolean;
  blockedFeature: ProFeature | null;
  isLoading: boolean;
  offeringsLoading: boolean;
  purchasePending: boolean;
  restorePending: boolean;
  isConfigured: boolean;
  paywallPackages: ProPaywallPackage[];
  selectedPackage: ProPaywallPackage | null;
  selectedPackageId: string | null;
  priceLabel: string | null;
  snapshot: ProSubscriptionSnapshot | null;
  errorCode: ProPaywallErrorCode | null;
  statusCode: ProPaywallStatusCode | null;
  hidePaywall: () => void;
  showPaywallPreview: () => void;
  showPaywall: (feature: ProFeature) => void;
  requirePro: (feature: ProFeature) => boolean;
  purchasePro: () => Promise<boolean>;
  selectPackage: (packageId: string) => void;
  restorePurchases: () => Promise<boolean>;
  refreshSubscription: () => Promise<void>;
  refreshOfferings: () => Promise<void>;
};

const ProPaywallContext = React.createContext<ProPaywallContextType | null>(null);
const INITIAL_REFRESH_RETRY_DELAY_MS = 500;

export function ProPaywallProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const debugOverrideEnabled = useMemo(() => resolveProAccessEnabled(), []);
  const [blockedFeature, setBlockedFeature] = useState<ProFeature | null>(null);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [purchasePending, setPurchasePending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [snapshot, setSnapshot] = useState<ProSubscriptionSnapshot | null>(null);
  const [paywallPackages, setPaywallPackages] = useState<ProPaywallPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ProPaywallErrorCode | null>(null);
  const [statusCode, setStatusCode] = useState<ProPaywallStatusCode | null>(null);
  const subscriptionRequestIdRef = useRef(0);
  const offeringsRequestIdRef = useRef(0);
  const paywallListenerRef = useRef<((info: ProPurchaseResult['customerInfo']) => void) | null>(null);
  const bootstrapRunIdRef = useRef(0);

  const delay = useCallback((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }), []);

  const applySnapshot = useCallback(async (next: ProSubscriptionSnapshot | null) => {
    setSnapshot(next);
    syncAnalyticsSubscriptionContext(next);
    if (next) {
      await StorageService.setProSubscriptionSnapshot(next);
      return;
    }
    await StorageService.clearProSubscriptionSnapshot();
  }, []);

  const refreshSubscriptionState = useCallback(async (): Promise<ProSubscriptionSnapshot | null> => {
    const requestId = ++subscriptionRequestIdRef.current;
    try {
      const config = await ensureRevenueCatConfigured();
      if (requestId !== subscriptionRequestIdRef.current) return null;
      if (!config) {
        setIsConfigured(false);
        setIsLoading(false);
        return null;
      }

      setIsConfigured(true);
      setErrorCode((current) => current === 'notConfigured' ? null : current);
      const result = await ProSubscriptionService.getCustomerInfo();
      if (requestId !== subscriptionRequestIdRef.current) return null;
      const nextSnapshot = result?.snapshot ?? null;
      await applySnapshot(nextSnapshot);
      return nextSnapshot;
    } catch {
      if (requestId !== subscriptionRequestIdRef.current) return null;
      return null;
    } finally {
      if (requestId === subscriptionRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [applySnapshot]);

  const refreshSubscription = useCallback(async () => {
    await refreshSubscriptionState();
  }, [refreshSubscriptionState]);

  const refreshOfferingsState = useCallback(async (): Promise<ProPaywallPackage[]> => {
    const requestId = ++offeringsRequestIdRef.current;
    setOfferingsLoading(true);
    try {
      const config = await ensureRevenueCatConfigured();
      if (requestId !== offeringsRequestIdRef.current) return [];
      if (!config) {
        setIsConfigured(false);
        setPaywallPackages([]);
        setSelectedPackageId(null);
        setErrorCode((current) => current ?? 'notConfigured');
        return [];
      }

      setIsConfigured(true);
      const nextPackages = await ProSubscriptionService.getPaywallPackages();
      if (requestId !== offeringsRequestIdRef.current) return [];
      setPaywallPackages(nextPackages);
      const defaultPackage = selectDefaultRevenueCatPackage(nextPackages, config);
      setSelectedPackageId((current) => {
        if (current && nextPackages.some((item) => item.packageIdentifier === current)) {
          return current;
        }
        return defaultPackage?.packageIdentifier ?? null;
      });
      if (nextPackages.length > 0) {
        setErrorCode((current) => (
          current === 'notConfigured' || current === 'offeringsUnavailable' || current === 'purchaseUnavailable'
            ? null
            : current
        ));
      } else {
        setErrorCode((current) => current ?? 'offeringsUnavailable');
      }
      return nextPackages;
    } catch {
      if (requestId !== offeringsRequestIdRef.current) return [];
      setPaywallPackages([]);
      setSelectedPackageId(null);
      setErrorCode('offeringsUnavailable');
      return [];
    } finally {
      if (requestId === offeringsRequestIdRef.current) {
        setOfferingsLoading(false);
      }
    }
  }, []);

  const refreshOfferings = useCallback(async () => {
    await refreshOfferingsState();
  }, [refreshOfferingsState]);

  const refreshRevenueCatState = useCallback(async (): Promise<void> => {
    await refreshSubscriptionState();
    await refreshOfferingsState();
  }, [refreshOfferingsState, refreshSubscriptionState]);

  useEffect(() => {
    if (debugOverrideEnabled) {
      setIsLoading(false);
      setOfferingsLoading(false);
      setIsConfigured(false);
      setPaywallPackages([]);
      setSelectedPackageId(null);
      setErrorCode(null);
      return;
    }

    let active = true;

    const bootstrap = async () => {
      const runId = ++bootstrapRunIdRef.current;
      const cached = await StorageService.getProSubscriptionSnapshot();
      if (active && cached?.snapshot) {
        setSnapshot(cached.snapshot);
        syncAnalyticsSubscriptionContext(cached.snapshot);
      }

      const nextSnapshot = await refreshSubscriptionState();
      const nextPackages = await refreshOfferingsState();
      if (!active || runId !== bootstrapRunIdRef.current) return;

      const hasSubscription = Boolean(nextSnapshot ?? cached?.snapshot);
      if (!hasSubscription || nextPackages.length === 0) {
        await delay(INITIAL_REFRESH_RETRY_DELAY_MS);
        if (!active || runId !== bootstrapRunIdRef.current) return;
        await refreshRevenueCatState();
      }
    };

    void bootstrap();

    return () => {
      active = false;
      bootstrapRunIdRef.current += 1;
    };
  }, [debugOverrideEnabled, delay, refreshRevenueCatState]);

  useEffect(() => {
    if (debugOverrideEnabled) return;

    let mounted = true;

    const registerListener = async () => {
      const config = await ensureRevenueCatConfigured();
      if (!mounted || !config) return;

      const listener = (customerInfo: ProPurchaseResult['customerInfo']) => {
        void applySnapshot(deriveProSubscriptionSnapshot(customerInfo, config.entitlementId));
      };

      paywallListenerRef.current = listener;
      Purchases.addCustomerInfoUpdateListener(listener);
    };

    void registerListener();

    return () => {
      mounted = false;
      const listener = paywallListenerRef.current;
      if (listener) {
        Purchases.removeCustomerInfoUpdateListener(listener);
        paywallListenerRef.current = null;
      }
    };
  }, [applySnapshot, debugOverrideEnabled]);

  useEffect(() => {
    if (debugOverrideEnabled) return;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void refreshRevenueCatState();
      }
    });
    return () => subscription.remove();
  }, [debugOverrideEnabled, refreshRevenueCatState]);

  useEffect(() => {
    if (debugOverrideEnabled) return;
    if (!blockedFeature && !previewOnly) return;
    void refreshOfferings();
  }, [blockedFeature, debugOverrideEnabled, previewOnly, refreshOfferings]);

  useEffect(() => {
    if (!previewOnly || !snapshot?.isActive || paywallPackages.length === 0) return;
    const matchingPackage = selectSnapshotRevenueCatPackage(paywallPackages, snapshot);
    if (!matchingPackage) return;
    if (matchingPackage.packageIdentifier !== selectedPackageId) {
      setSelectedPackageId(matchingPackage.packageIdentifier);
    }
  }, [paywallPackages, previewOnly, selectedPackageId, snapshot]);

  const clearFeedback = useCallback(() => {
    setErrorCode(null);
    setStatusCode(null);
  }, []);

  const hidePaywall = useCallback(() => {
    clearFeedback();
    setBlockedFeature(null);
    setPreviewOnly(false);
  }, [clearFeedback]);

  const showPaywallPreview = useCallback(() => {
    clearFeedback();
    setBlockedFeature(resolvePreviewPaywallFeature());
    setPreviewOnly(true);
  }, [clearFeedback]);

  const showPaywall = useCallback((feature: ProFeature) => {
    if (debugOverrideEnabled || snapshot?.isActive) return;
    clearFeedback();
    setPreviewOnly(false);
    setBlockedFeature(feature);
  }, [clearFeedback, debugOverrideEnabled, snapshot?.isActive]);

  const requirePro = useCallback((feature: ProFeature) => {
    if (debugOverrideEnabled || snapshot?.isActive) return true;
    clearFeedback();
    setPreviewOnly(false);
    setBlockedFeature(feature);
    return false;
  }, [clearFeedback, debugOverrideEnabled, snapshot?.isActive]);

  const purchasePro = useCallback(async () => {
    clearFeedback();
    const selectedPackage = paywallPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
    if (!isConfigured) {
      setErrorCode('notConfigured');
      return false;
    }
    if (!selectedPackage) {
      setErrorCode('offeringsUnavailable');
      return false;
    }

    setPurchasePending(true);
    try {
      const result = await ProSubscriptionService.purchasePro(selectedPackage.package);
      await applySnapshot(result.snapshot);
      setBlockedFeature(null);
      setPreviewOnly(false);
      return true;
    } catch (error) {
      const code = classifyProPurchaseError(error);
      if (code === 'cancelled') {
        setErrorCode('purchaseCancelled');
      } else if (code === 'pending') {
        setErrorCode('purchasePending');
      } else if (code === 'purchaseUnavailable') {
        setErrorCode('purchaseUnavailable');
      } else if (code === 'notConfigured') {
        setErrorCode('notConfigured');
      } else {
        setErrorCode('purchaseFailed');
      }
      return false;
    } finally {
      setPurchasePending(false);
    }
  }, [applySnapshot, clearFeedback, isConfigured, paywallPackages, selectedPackageId]);

  const restorePro = useCallback(async () => {
    clearFeedback();
    setRestorePending(true);
    try {
      const result = await ProSubscriptionService.restorePurchases();
      if (!result) {
        setErrorCode('notConfigured');
        return false;
      }
      await applySnapshot(result.snapshot);
      if (result.snapshot.isActive) {
        setStatusCode('restoreSuccess');
        setBlockedFeature(null);
        setPreviewOnly(false);
        return true;
      }
      setErrorCode('restoreNotFound');
      return false;
    } catch {
      setErrorCode('restoreFailed');
      return false;
    } finally {
      setRestorePending(false);
    }
  }, [applySnapshot, clearFeedback]);

  const isPro = debugOverrideEnabled || Boolean(snapshot?.isActive);
  const selectedPackage = paywallPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
  const selectPackage = useCallback((packageId: string) => {
    setSelectedPackageId(packageId);
  }, []);

  const value = useMemo(
    () => ({
      isPro,
      debugOverrideEnabled,
      visible: blockedFeature !== null || previewOnly,
      previewOnly,
      blockedFeature,
      isLoading,
      offeringsLoading,
      purchasePending,
      restorePending,
      isConfigured,
      paywallPackages,
      selectedPackage,
      selectedPackageId,
      priceLabel: selectedPackage?.priceString ?? null,
      snapshot,
      errorCode,
      statusCode,
      hidePaywall,
      showPaywallPreview,
      showPaywall,
      requirePro,
      purchasePro,
      selectPackage,
      restorePurchases: restorePro,
      refreshSubscription,
      refreshOfferings,
    }),
    [
      blockedFeature,
      debugOverrideEnabled,
      errorCode,
      hidePaywall,
      isConfigured,
      isLoading,
      isPro,
      debugOverrideEnabled,
      previewOnly,
      offeringsLoading,
      paywallPackages,
      purchasePending,
      purchasePro,
      refreshOfferings,
      refreshSubscription,
      requirePro,
      restorePending,
      restorePro,
      selectPackage,
      selectedPackage,
      selectedPackageId,
      showPaywallPreview,
      showPaywall,
      snapshot,
      statusCode,
    ],
  );

  return (
    <ProPaywallContext.Provider value={value}>
      {children}
    </ProPaywallContext.Provider>
  );
}

export function useProPaywall(): ProPaywallContextType {
  const context = React.useContext(ProPaywallContext);
  if (!context) {
    throw new Error('useProPaywall must be used within ProPaywallProvider');
  }
  return context;
}
