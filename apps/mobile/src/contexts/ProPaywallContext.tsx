import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import Purchases from 'react-native-purchases';
import {
  classifyProPurchaseFailureReason,
  deriveProSubscriptionSnapshot,
  ensureRevenueCatConfigured,
  getProSubscriptionExpirationMs,
  hasRenewingProSubscription,
  isProSubscriptionSnapshotActiveAt,
  normalizeProSubscriptionSnapshotAt,
  ProSubscriptionService,
  type ProPurchaseResult,
  type ProPaywallPackage,
  type ProPurchaseFailureReason,
  type ProSubscriptionSnapshot,
  resolveRevenueCatConfig,
  selectDefaultRevenueCatPackage,
  selectDisplayedRevenueCatPackage,
  isRevenueCatPackagePurchaseLocked,
} from '../services/pro-subscription';
import { StorageService } from '../services/storage';
import { syncAnalyticsSubscriptionContext } from '../services/analytics/subscription-context';
import { ProFeature, resolvePreviewPaywallFeature, resolveProAccessEnabled } from '../utils/pro';
import type { PaywallMode } from '../screens/Paywall/model';

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
  | 'purchaseSuccess'
  | 'planChangeScheduled'
  | 'lifetimeManageSubscription'
  | 'purchaseUnconfirmed'
  | 'restoreSuccess'
  | 'redemptionWaiting'
  | 'redemptionUnconfirmed'
  | 'redemptionFailed';

export type ProPaywallPhase =
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'purchasing'
  | 'restoring'
  | 'redeeming'
  | 'success'
  | 'complete'
  | 'failure';

export type ProPaywallActionResult =
  | Readonly<{ success: true; reason: null; outcome?: 'activated' | 'scheduled'; keepOpen?: boolean }>
  | Readonly<{ success: false; reason: ProPurchaseFailureReason }>;

export type ProPaywallContextType = {
  isPro: boolean;
  debugOverrideEnabled: boolean;
  /** Developer toggle: an active subscription is presented as a free account so Pro gates open the paywall. */
  simulateFreeAccount: boolean;
  visible: boolean;
  paywallMode: PaywallMode | null;
  paywallPhase: ProPaywallPhase;
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
  failureReason: ProPurchaseFailureReason | null;
  failureOperation: 'purchase' | 'restore' | null;
  hidePaywall: () => void;
  showPaywallPreview: () => void;
  showPaywall: (feature: ProFeature) => boolean;
  requirePro: (feature: ProFeature) => boolean;
  setSimulateFreeAccount: (enabled: boolean) => void;
  purchasePro: () => Promise<ProPaywallActionResult>;
  redeemCode: () => Promise<ProPaywallActionResult>;
  selectPackage: (packageId: string) => void;
  restorePurchases: () => Promise<ProPaywallActionResult>;
  refreshSubscription: () => Promise<void>;
  refreshOfferings: () => Promise<void>;
};

const ProPaywallContext = React.createContext<ProPaywallContextType | null>(null);
const INITIAL_REFRESH_RETRY_DELAY_MS = 500;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
export const PAYWALL_SUCCESS_DISPLAY_MS = 2_000;

export function ProPaywallProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const debugOverrideEnabled = useMemo(() => resolveProAccessEnabled(), []);
  const [simulateFreeAccount, setSimulateFreeAccountState] = useState(false);
  const [simulateFreeAccountLoaded, setSimulateFreeAccountLoaded] = useState(false);
  // The env unlock only stands while the developer is not simulating a free account.
  const proAccessOverride = debugOverrideEnabled && !simulateFreeAccount;
  const [blockedFeature, setBlockedFeature] = useState<ProFeature | null>(null);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [paywallMode, setPaywallMode] = useState<PaywallMode | null>(null);
  const [paywallPhase, setPaywallPhase] = useState<ProPaywallPhase>('loading');
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
  const [failureReason, setFailureReason] = useState<ProPurchaseFailureReason | null>(null);
  const [failureOperation, setFailureOperation] = useState<'purchase' | 'restore' | null>(null);
  const [subscriptionClock, setSubscriptionClock] = useState(0);
  const subscriptionRequestIdRef = useRef(0);
  const snapshotApplyRevisionRef = useRef(0);
  const snapshotPersistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const offeringsRequestIdRef = useRef(0);
  const paywallListenerRef = useRef<((info: ProPurchaseResult['customerInfo']) => void) | null>(null);
  const bootstrapRunIdRef = useRef(0);
  const previewSelectionInitializedRef = useRef(false);
  const paywallModeRef = useRef<PaywallMode | null>(null);
  const operationIdRef = useRef(0);
  const activePaywallOperationRef = useRef<Readonly<{
    id: number;
    kind: 'purchase' | 'restore' | 'redeem';
  }> | null>(null);

  const delay = useCallback((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }), []);

  const applySnapshot = useCallback(async (
    next: ProSubscriptionSnapshot | null,
  ): Promise<ProSubscriptionSnapshot | null> => {
    const revision = ++snapshotApplyRevisionRef.current;
    const normalized = normalizeProSubscriptionSnapshotAt(next, Date.now());
    setSnapshot(normalized);
    syncAnalyticsSubscriptionContext(normalized);
    const persistence = snapshotPersistenceTailRef.current.then(async () => {
      if (revision !== snapshotApplyRevisionRef.current) return;
      if (normalized) {
        await StorageService.setProSubscriptionSnapshot(normalized);
        return;
      }
      await StorageService.clearProSubscriptionSnapshot();
    });
    snapshotPersistenceTailRef.current = persistence.catch(() => undefined);
    await persistence;
    return normalized;
  }, []);

  const refreshSubscriptionState = useCallback(async (): Promise<ProSubscriptionSnapshot | null> => {
    if (activePaywallOperationRef.current) return null;
    const requestId = ++subscriptionRequestIdRef.current;
    try {
      const config = await ensureRevenueCatConfigured();
      if (requestId !== subscriptionRequestIdRef.current || activePaywallOperationRef.current) return null;
      if (!config) {
        setIsConfigured(false);
        setIsLoading(false);
        return null;
      }

      setIsConfigured(true);
      setErrorCode((current) => current === 'notConfigured' ? null : current);
      const result = await ProSubscriptionService.getCustomerInfo();
      if (requestId !== subscriptionRequestIdRef.current || activePaywallOperationRef.current) return null;
      return applySnapshot(result?.snapshot ?? null);
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
    const operationId = operationIdRef.current;
    const startedWithoutActivePaywallOperation = activePaywallOperationRef.current === null;
    const shouldUpdatePaywallState = () => (
      startedWithoutActivePaywallOperation
      && activePaywallOperationRef.current === null
      && paywallModeRef.current === 'purchase'
      && operationId === operationIdRef.current
    );
    setOfferingsLoading(true);
    if (shouldUpdatePaywallState()) {
      setPaywallPhase('loading');
    }
    try {
      const config = await ensureRevenueCatConfigured();
      if (requestId !== offeringsRequestIdRef.current) return [];
      if (!config) {
        setIsConfigured(false);
        setPaywallPackages([]);
        setSelectedPackageId(null);
        if (shouldUpdatePaywallState()) {
          setErrorCode((current) => current ?? 'notConfigured');
          setFailureReason('offerings_unavailable');
          setFailureOperation('purchase');
          setPaywallPhase('unavailable');
        }
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
        if (shouldUpdatePaywallState()) {
          setErrorCode((current) => (
            current === 'notConfigured' || current === 'offeringsUnavailable' || current === 'purchaseUnavailable'
              ? null
              : current
          ));
          setFailureReason(null);
          setFailureOperation(null);
          setPaywallPhase('ready');
        }
      } else {
        if (shouldUpdatePaywallState()) {
          setErrorCode((current) => current ?? 'offeringsUnavailable');
          setFailureReason('offerings_unavailable');
          setFailureOperation('purchase');
          setPaywallPhase('unavailable');
        }
      }
      return nextPackages;
    } catch {
      if (requestId !== offeringsRequestIdRef.current) return [];
      setPaywallPackages([]);
      setSelectedPackageId(null);
      if (shouldUpdatePaywallState()) {
        setErrorCode('offeringsUnavailable');
        setFailureReason('offerings_unavailable');
        setFailureOperation('purchase');
        setPaywallPhase('unavailable');
      }
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
    let mounted = true;
    StorageService.getSimulateFreeAccount()
      .then((enabled) => {
        if (mounted) setSimulateFreeAccountState(enabled);
      })
      .catch(() => undefined) // An unreadable flag means the real subscription decides.
      .finally(() => {
        if (mounted) setSimulateFreeAccountLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const simulateFreeAccountRef = useRef(simulateFreeAccount);
  simulateFreeAccountRef.current = simulateFreeAccount;
  const setSimulateFreeAccount = useCallback((enabled: boolean) => {
    simulateFreeAccountRef.current = enabled;
    setSimulateFreeAccountState(enabled);
    void StorageService.setSimulateFreeAccount(enabled).catch(() => undefined);
  }, []);
  /** Verified store access ends a simulated free account the way a real free user's purchase would. */
  const endSimulatedFreeAccount = useCallback(() => {
    if (simulateFreeAccountRef.current) setSimulateFreeAccount(false);
  }, [setSimulateFreeAccount]);

  useEffect(() => {
    if (proAccessOverride) {
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
      const snapshotRevisionBeforeCacheRead = snapshotApplyRevisionRef.current;
      const cached = await StorageService.getProSubscriptionSnapshot();
      const cachedSnapshot = normalizeProSubscriptionSnapshotAt(cached?.snapshot ?? null, Date.now());
      if (
        active
        && cached?.snapshot
        && snapshotRevisionBeforeCacheRead === snapshotApplyRevisionRef.current
      ) {
        await applySnapshot(cachedSnapshot);
      }

      const nextSnapshot = await refreshSubscriptionState();
      const nextPackages = await refreshOfferingsState();
      if (!active || runId !== bootstrapRunIdRef.current) return;

      const hasSubscription = Boolean(nextSnapshot ?? cachedSnapshot);
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
  }, [delay, proAccessOverride, refreshRevenueCatState]);

  useEffect(() => {
    if (activePaywallOperationRef.current) return;
    const expirationMs = getProSubscriptionExpirationMs(snapshot);
    if (expirationMs === null) return;
    const now = Date.now();
    if (now >= expirationMs) {
      void applySnapshot(normalizeProSubscriptionSnapshotAt(snapshot, now))
        .then(() => refreshSubscriptionState());
      return;
    }
    const timer = setTimeout(() => {
      if (activePaywallOperationRef.current) return;
      const reachedAt = Date.now();
      if (reachedAt >= expirationMs) {
        void applySnapshot(normalizeProSubscriptionSnapshotAt(snapshot, reachedAt))
          .then(() => refreshSubscriptionState());
        return;
      }
      setSubscriptionClock((current) => current + 1);
      void refreshSubscriptionState();
    }, Math.min((expirationMs - now) + 25, MAX_TIMER_DELAY_MS));
    return () => clearTimeout(timer);
  }, [applySnapshot, refreshSubscriptionState, snapshot, subscriptionClock]);

  useEffect(() => {
    if (proAccessOverride) return;

    let mounted = true;

    const registerListener = async () => {
      const config = await ensureRevenueCatConfigured();
      if (!mounted || !config) return;

      const listener = (customerInfo: ProPurchaseResult['customerInfo']) => {
        if (activePaywallOperationRef.current) return;
        subscriptionRequestIdRef.current += 1;
        // This authoritative result supersedes an in-flight refresh, including
        // its finally block. Settle loading here instead of waiting on that stale request.
        setIsLoading(false);
        void applySnapshot(deriveProSubscriptionSnapshot(customerInfo, config.entitlementId))
          .catch(() => undefined); // The in-memory entitlement remains usable if persistence fails.
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
  }, [applySnapshot, proAccessOverride]);

  useEffect(() => {
    if (proAccessOverride) return;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        setSubscriptionClock((current) => current + 1);
        void refreshRevenueCatState();
      }
    });
    return () => subscription.remove();
  }, [proAccessOverride, refreshRevenueCatState]);

  useEffect(() => {
    if (proAccessOverride) return;
    if (!blockedFeature && !previewOnly) return;
    void refreshOfferings();
  }, [blockedFeature, proAccessOverride, previewOnly, refreshOfferings]);

  useEffect(() => {
    if (!previewOnly) {
      previewSelectionInitializedRef.current = false;
      return;
    }
    if (!snapshot?.isActive || paywallPackages.length === 0) return;
    if (previewSelectionInitializedRef.current) return;
    const matchingPackage = selectDisplayedRevenueCatPackage(paywallPackages, snapshot);
    if (!matchingPackage) {
      previewSelectionInitializedRef.current = false;
      if (selectedPackageId !== null) {
        setSelectedPackageId(null);
      }
      return;
    }
    previewSelectionInitializedRef.current = true;
    if (matchingPackage.packageIdentifier !== selectedPackageId) {
      setSelectedPackageId(matchingPackage.packageIdentifier);
    }
  }, [paywallPackages, previewOnly, selectedPackageId, snapshot]);

  useEffect(() => {
    if (previewOnly || blockedFeature !== 'settingsMembershipPreview' || paywallPhase !== 'ready') return;
    const selected = paywallPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
    if (!isRevenueCatPackagePurchaseLocked(selected, paywallPackages, snapshot)) return;
    const available = paywallPackages.find((item) => !isRevenueCatPackagePurchaseLocked(item, paywallPackages, snapshot));
    const next = available ?? selectDisplayedRevenueCatPackage(paywallPackages, snapshot);
    if (next && next.packageIdentifier !== selectedPackageId) setSelectedPackageId(next.packageIdentifier);
  }, [blockedFeature, paywallPackages, paywallPhase, previewOnly, selectedPackageId, snapshot]);

  const clearFeedback = useCallback(() => {
    setErrorCode(null);
    setStatusCode(null);
    setFailureReason(null);
    setFailureOperation(null);
  }, []);

  const hidePaywall = useCallback(() => {
    if (activePaywallOperationRef.current?.kind !== 'redeem' && activePaywallOperationRef.current) return;
    activePaywallOperationRef.current = null;
    operationIdRef.current += 1;
    clearFeedback();
    setBlockedFeature(null);
    setPreviewOnly(false);
    paywallModeRef.current = null;
    setPaywallMode(null);
    setPaywallPhase('ready');
  }, [clearFeedback]);

  const showPaywallPreview = useCallback(() => {
    if (activePaywallOperationRef.current || paywallModeRef.current !== null) return;
    operationIdRef.current += 1;
    clearFeedback();
    setBlockedFeature(resolvePreviewPaywallFeature());
    setPreviewOnly(true);
    paywallModeRef.current = 'purchase';
    setPaywallMode('purchase');
    setPaywallPhase(paywallPackages.length > 0 ? 'ready' : 'loading');
  }, [clearFeedback, paywallPackages.length]);

  const hasProAccess = useCallback((now: number): boolean => (
    !simulateFreeAccount
    && (debugOverrideEnabled || isProSubscriptionSnapshotActiveAt(snapshot, now))
  ), [debugOverrideEnabled, simulateFreeAccount, snapshot]);

  const showPaywall = useCallback((feature: ProFeature): boolean => {
    if (
      proAccessOverride
      || (feature !== 'settingsMembershipPreview' && hasProAccess(Date.now()))
      || activePaywallOperationRef.current
      || paywallModeRef.current !== null
    ) {
      return false;
    }
    operationIdRef.current += 1;
    clearFeedback();
    setPreviewOnly(false);
    setBlockedFeature(feature);
    paywallModeRef.current = 'purchase';
    setPaywallMode('purchase');
    setPaywallPhase(paywallPackages.length > 0 ? 'ready' : 'loading');
    return true;
  }, [clearFeedback, hasProAccess, paywallPackages.length, proAccessOverride]);

  const requirePro = useCallback((feature: ProFeature) => {
    if (hasProAccess(Date.now())) return true;
    showPaywall(feature);
    return false;
  }, [hasProAccess, showPaywall]);

  const showSuccessThenClose = useCallback(async (
    operationId: number,
    status: ProPaywallStatusCode,
  ): Promise<void> => {
    if (operationId !== operationIdRef.current || paywallModeRef.current !== 'purchase') return;
    setStatusCode(status);
    setErrorCode(null);
    setFailureReason(null);
    setFailureOperation(null);
    setPaywallPhase('success');
    await delay(PAYWALL_SUCCESS_DISPLAY_MS);
    if (operationId !== operationIdRef.current || paywallModeRef.current !== 'purchase') return;
    setBlockedFeature(null);
    setPreviewOnly(false);
    paywallModeRef.current = null;
    setPaywallMode(null);
    setPaywallPhase('ready');
  }, [delay]);

  const purchasePro = useCallback(async (): Promise<ProPaywallActionResult> => {
    if (activePaywallOperationRef.current) {
      return { success: false, reason: 'pending' };
    }
    const operationId = ++operationIdRef.current;
    clearFeedback();
    const selectedPackage = paywallPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
    if (!isConfigured) {
      setErrorCode('notConfigured');
      setFailureReason('offerings_unavailable');
      setFailureOperation('purchase');
      setPaywallPhase('unavailable');
      return { success: false, reason: 'offerings_unavailable' };
    }
    if (!selectedPackage) {
      setErrorCode('offeringsUnavailable');
      setFailureReason('offerings_unavailable');
      setFailureOperation('purchase');
      setPaywallPhase('unavailable');
      return { success: false, reason: 'offerings_unavailable' };
    }

    setPurchasePending(true);
    activePaywallOperationRef.current = { id: operationId, kind: 'purchase' };
    subscriptionRequestIdRef.current += 1;
    setPaywallPhase('purchasing');
    try {
      const result = await ProSubscriptionService.purchasePro(selectedPackage.package, paywallPackages);
      const appliedSnapshot = await applySnapshot(result.snapshot);
      if (result.outcome === 'unconfirmed') {
        setStatusCode('purchaseUnconfirmed');
        setPaywallPhase('complete');
        return { success: false, reason: 'pending' };
      }
      if (!isProSubscriptionSnapshotActiveAt(appliedSnapshot, Date.now())) {
        setErrorCode('purchaseFailed');
        setFailureReason('store_error:ENTITLEMENT_INACTIVE');
        setFailureOperation('purchase');
        setPaywallPhase('failure');
        return { success: false, reason: 'store_error:ENTITLEMENT_INACTIVE' };
      }
      endSimulatedFreeAccount();
      if (result.outcome === 'scheduled' || result.requiresSubscriptionManagement) {
        setStatusCode(result.outcome === 'scheduled' ? 'planChangeScheduled' : 'lifetimeManageSubscription');
        setPaywallPhase('complete');
        return { success: true, reason: null, outcome: result.outcome ?? 'activated', keepOpen: true };
      }
      await showSuccessThenClose(operationId, 'purchaseSuccess');
      return { success: true, reason: null, outcome: result.outcome ?? 'activated' };
    } catch (error) {
      const reason = classifyProPurchaseFailureReason(error);
      setFailureReason(reason);
      setFailureOperation('purchase');
      if (reason === 'cancelled') {
        setErrorCode(null);
        setPaywallPhase('ready');
      } else if (reason === 'pending') {
        setErrorCode('purchasePending');
        setPaywallPhase('failure');
      } else {
        setErrorCode('purchaseFailed');
        setPaywallPhase('failure');
      }
      return { success: false, reason };
    } finally {
      if (activePaywallOperationRef.current?.id === operationId) {
        activePaywallOperationRef.current = null;
        setPurchasePending(false);
        setSubscriptionClock((current) => current + 1);
      }
    }
  }, [applySnapshot, clearFeedback, endSimulatedFreeAccount, isConfigured, paywallPackages, selectedPackageId, showSuccessThenClose]);

  const restorePro = useCallback(async (): Promise<ProPaywallActionResult> => {
    if (activePaywallOperationRef.current) {
      return { success: false, reason: 'pending' };
    }
    const startedInPaywall = paywallModeRef.current === 'purchase';
    const operationId = ++operationIdRef.current;
    clearFeedback();
    setRestorePending(true);
    activePaywallOperationRef.current = { id: operationId, kind: 'restore' };
    subscriptionRequestIdRef.current += 1;
    if (startedInPaywall) setPaywallPhase('restoring');
    try {
      const result = await ProSubscriptionService.restorePurchases();
      if (!result) {
        setErrorCode('notConfigured');
        setFailureReason('offerings_unavailable');
        setFailureOperation('restore');
        if (startedInPaywall) setPaywallPhase('unavailable');
        return { success: false, reason: 'offerings_unavailable' };
      }
      const appliedSnapshot = await applySnapshot(result.snapshot);
      if (isProSubscriptionSnapshotActiveAt(appliedSnapshot, Date.now())) {
        endSimulatedFreeAccount();
        if (startedInPaywall) {
          await showSuccessThenClose(operationId, 'restoreSuccess');
        } else {
          setStatusCode('restoreSuccess');
          setPaywallPhase('ready');
        }
        return { success: true, reason: null };
      }
      setErrorCode('restoreNotFound');
      setFailureReason('store_error:RESTORE_NOT_FOUND');
      setFailureOperation('restore');
      if (startedInPaywall) setPaywallPhase('failure');
      return { success: false, reason: 'store_error:RESTORE_NOT_FOUND' };
    } catch (error) {
      const reason = classifyProPurchaseFailureReason(error);
      setFailureReason(reason);
      setFailureOperation('restore');
      if (reason === 'cancelled') {
        setErrorCode(null);
        if (startedInPaywall) setPaywallPhase('ready');
      } else if (reason === 'pending') {
        setErrorCode('purchasePending');
        if (startedInPaywall) setPaywallPhase('failure');
      } else {
        setErrorCode('restoreFailed');
        if (startedInPaywall) setPaywallPhase('failure');
      }
      return { success: false, reason };
    } finally {
      if (activePaywallOperationRef.current?.id === operationId) {
        activePaywallOperationRef.current = null;
        setRestorePending(false);
        setSubscriptionClock((current) => current + 1);
      }
    }
  }, [applySnapshot, clearFeedback, endSimulatedFreeAccount, showSuccessThenClose]);

  const redeemCode = useCallback(async (): Promise<ProPaywallActionResult> => {
    if (activePaywallOperationRef.current || paywallModeRef.current !== 'purchase') {
      return { success: false, reason: 'pending' };
    }
    const operationId = ++operationIdRef.current;
    activePaywallOperationRef.current = { id: operationId, kind: 'redeem' };
    subscriptionRequestIdRef.current += 1;
    clearFeedback();
    setPaywallPhase('redeeming');
    setStatusCode('redemptionWaiting');
    const isCurrent = () => operationId === operationIdRef.current
      && paywallModeRef.current === 'purchase';
    try {
      // Establish the baseline before opening the store: an existing member
      // dismissing its sheet must not be reported as a new activation.
      const before = await ProSubscriptionService.getCustomerInfo(true);
      if (!isCurrent()) return { success: false, reason: 'cancelled' };
      if (!before) throw new Error('Billing is not configured.');
      await applySnapshot(before.snapshot);
      if (!isCurrent()) return { success: false, reason: 'cancelled' };
      await ProSubscriptionService.presentCodeRedemption();
      // StoreKit's sheet resolves on presentation, not on dismissal. Bound
      // foreground reconciliation; the normal listener handles later delivery.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await delay(5_000);
        if (!isCurrent()) return { success: false, reason: 'cancelled' };
        if (AppState.currentState && AppState.currentState !== 'active') continue;
        const result = await ProSubscriptionService.getCustomerInfo(true).catch(() => null);
        if (!isCurrent()) return { success: false, reason: 'cancelled' };
        if (!result) continue;
        const next = await applySnapshot(result.snapshot);
        if (!isCurrent()) return { success: false, reason: 'cancelled' };
        const previous = before.snapshot;
        const changed = !isProSubscriptionSnapshotActiveAt(previous, Date.now())
          || previous.productIdentifier !== next?.productIdentifier
          || previous.expirationDate !== next?.expirationDate
          || previous.latestPurchaseDate !== next?.latestPurchaseDate;
        if (!isProSubscriptionSnapshotActiveAt(next, Date.now()) || !changed) continue;
        endSimulatedFreeAccount();
        if (next?.expirationDate === null && hasRenewingProSubscription(next)) {
          setStatusCode('lifetimeManageSubscription');
          setPaywallPhase('complete');
          return { success: true, reason: null, keepOpen: true };
        }
        await showSuccessThenClose(operationId, 'purchaseSuccess');
        return isCurrent() || operationId === operationIdRef.current
          ? { success: true, reason: null }
          : { success: false, reason: 'cancelled' };
      }
      setStatusCode('redemptionUnconfirmed');
      setPaywallPhase('ready');
      return { success: false, reason: 'pending' };
    } catch {
      if (!isCurrent()) return { success: false, reason: 'cancelled' };
      setStatusCode('redemptionFailed');
      setPaywallPhase('ready');
      return { success: false, reason: 'store_error:REDEMPTION_UNAVAILABLE' };
    } finally {
      if (activePaywallOperationRef.current?.id === operationId) {
        activePaywallOperationRef.current = null;
        setSubscriptionClock((current) => current + 1);
      }
    }
  }, [applySnapshot, clearFeedback, delay, endSimulatedFreeAccount, showSuccessThenClose]);

  useEffect(() => () => {
    operationIdRef.current += 1;
    activePaywallOperationRef.current = null;
  }, []);

  const isPro = hasProAccess(Date.now());
  const selectedPackage = paywallPackages.find((item) => item.packageIdentifier === selectedPackageId) ?? null;
  const selectPackage = useCallback((packageId: string) => {
    setSelectedPackageId(packageId);
  }, []);

  const value = useMemo(
    () => ({
      isPro,
      debugOverrideEnabled,
      simulateFreeAccount,
      visible: paywallMode !== null,
      paywallMode,
      paywallPhase,
      previewOnly,
      blockedFeature,
      isLoading: isLoading || !simulateFreeAccountLoaded,
      offeringsLoading,
      purchasePending,
      restorePending,
      isConfigured,
      paywallPackages,
      selectedPackage,
      selectedPackageId,
      priceLabel: selectedPackage?.priceString ?? null,
      // A simulated free account also hides the member plan so the paywall renders the free layout.
      snapshot: simulateFreeAccount ? null : snapshot,
      errorCode,
      statusCode,
      failureReason,
      failureOperation,
      hidePaywall,
      showPaywallPreview,
      showPaywall,
      requirePro,
      setSimulateFreeAccount,
      purchasePro,
      redeemCode,
      selectPackage,
      restorePurchases: restorePro,
      refreshSubscription,
      refreshOfferings,
    }),
    [
      blockedFeature,
      debugOverrideEnabled,
      errorCode,
      failureOperation,
      failureReason,
      hidePaywall,
      isConfigured,
      isLoading,
      isPro,
      debugOverrideEnabled,
      previewOnly,
      offeringsLoading,
      paywallMode,
      paywallPhase,
      paywallPackages,
      purchasePending,
      purchasePro,
      redeemCode,
      refreshOfferings,
      refreshSubscription,
      requirePro,
      restorePending,
      restorePro,
      selectPackage,
      selectedPackage,
      selectedPackageId,
      setSimulateFreeAccount,
      showPaywallPreview,
      showPaywall,
      simulateFreeAccount,
      simulateFreeAccountLoaded,
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
