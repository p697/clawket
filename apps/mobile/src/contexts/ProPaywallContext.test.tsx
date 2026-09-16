import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import Purchases from 'react-native-purchases';
import {
  PAYWALL_SUCCESS_DISPLAY_MS,
  ProPaywallProvider,
  useProPaywall,
} from './ProPaywallContext';
import type { ProPaywallPackage, ProSubscriptionSnapshot } from '../services/pro-subscription';

const mockEnsureConfigured = jest.fn();
const mockGetCustomerInfo = jest.fn();
const mockGetPaywallPackages = jest.fn();
const mockPurchasePro = jest.fn();
const mockRestorePurchases = jest.fn();
const mockDeriveProSubscriptionSnapshot = jest.fn();
const mockSetSnapshot = jest.fn();
const mockClearSnapshot = jest.fn();
const mockGetSnapshot = jest.fn();
let current: ReturnType<typeof useProPaywall> | null = null;

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  },
}));

jest.mock('../services/pro-subscription', () => ({
  ensureRevenueCatConfigured: (...args: unknown[]) => mockEnsureConfigured(...args),
  deriveProSubscriptionSnapshot: (...args: unknown[]) => mockDeriveProSubscriptionSnapshot(...args),
  getProSubscriptionExpirationMs: (snapshot: ProSubscriptionSnapshot | null) => {
    if (!snapshot?.isActive || snapshot.expirationDate === null) return null;
    const value = Date.parse(snapshot.expirationDate);
    return Number.isFinite(value) ? value : 0;
  },
  isProSubscriptionSnapshotActiveAt: (snapshot: ProSubscriptionSnapshot | null, now: number) => {
    if (!snapshot?.isActive) return false;
    if (snapshot.expirationDate === null) return true;
    const value = Date.parse(snapshot.expirationDate);
    return Number.isFinite(value) && now < value;
  },
  normalizeProSubscriptionSnapshotAt: (snapshot: ProSubscriptionSnapshot | null, now: number) => {
    if (!snapshot?.isActive || snapshot.expirationDate === null) return snapshot;
    const value = Date.parse(snapshot.expirationDate);
    return Number.isFinite(value) && now < value ? snapshot : { ...snapshot, isActive: false };
  },
  classifyProPurchaseFailureReason: (error: { reason?: string }) => error.reason ?? 'store_error:UNKNOWN',
  ProSubscriptionService: {
    getCustomerInfo: (...args: unknown[]) => mockGetCustomerInfo(...args),
    getPaywallPackages: (...args: unknown[]) => mockGetPaywallPackages(...args),
    purchasePro: (...args: unknown[]) => mockPurchasePro(...args),
    restorePurchases: (...args: unknown[]) => mockRestorePurchases(...args),
  },
  selectDefaultRevenueCatPackage: (packages: ProPaywallPackage[]) => (
    packages.find((item) => item.packageType === 'ANNUAL') ?? packages[0] ?? null
  ),
  selectDisplayedRevenueCatPackage: jest.fn(() => null),
  isRevenueCatPackagePurchaseLocked: jest.fn(() => false),
}));

jest.mock('../services/storage', () => ({
  StorageService: {
    getProSubscriptionSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
    setProSubscriptionSnapshot: (...args: unknown[]) => mockSetSnapshot(...args),
    clearProSubscriptionSnapshot: (...args: unknown[]) => mockClearSnapshot(...args),
  },
}));

jest.mock('../services/analytics/subscription-context', () => ({
  syncAnalyticsSubscriptionContext: jest.fn(),
}));

jest.mock('../utils/pro', () => ({
  resolveProAccessEnabled: () => false,
  resolvePreviewPaywallFeature: () => 'appIcons',
}));

const FREE_SNAPSHOT: ProSubscriptionSnapshot = {
  isActive: false,
  entitlementId: 'pro',
  productIdentifier: null,
  productPlanIdentifier: null,
  activeSubscriptionProductIdentifiers: [],
  purchasedProductIdentifiers: [],
  nonSubscriptionProductIdentifiers: [],
  originalPurchaseDate: null,
  latestPurchaseDate: null,
  expirationDate: null,
  willRenew: false,
  store: null,
  managementURL: null,
  originalAppUserId: null,
  requestDate: null,
  verification: null,
};

const PRO_SNAPSHOT: ProSubscriptionSnapshot = { ...FREE_SNAPSHOT, isActive: true };

const ANNUAL_PACKAGE: ProPaywallPackage = {
  offeringIdentifier: 'pro',
  packageIdentifier: '$rc_annual',
  packageType: 'ANNUAL',
  productIdentifier: 'annual',
  title: 'Annual',
  description: 'Annual',
  price: 24,
  priceString: '$24.00',
  pricePerMonth: 2,
  pricePerMonthString: '$2.00',
  offeringMetadata: { defaultPackage: 'annual', socialProof: true },
  package: { identifier: '$rc_annual' } as ProPaywallPackage['package'],
};

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function Capture(): null {
  current = useProPaywall();
  return null;
}

async function renderProvider(): Promise<void> {
  render(<ProPaywallProvider><Capture /></ProPaywallProvider>);
  await waitFor(() => {
    expect(current?.isConfigured).toBe(true);
    expect(current?.paywallPackages).toHaveLength(1);
  });
}

describe('ProPaywallProvider state machine', () => {
  beforeEach(() => {
    jest.useRealTimers();
    current = null;
    mockEnsureConfigured.mockReset().mockResolvedValue({ apiKey: 'key', entitlementId: 'pro' });
    mockGetSnapshot.mockReset().mockResolvedValue(null);
    mockSetSnapshot.mockReset().mockResolvedValue(undefined);
    mockClearSnapshot.mockReset().mockResolvedValue(undefined);
    mockGetCustomerInfo.mockReset().mockResolvedValue({ customerInfo: {}, snapshot: FREE_SNAPSHOT });
    mockGetPaywallPackages.mockReset().mockResolvedValue([ANNUAL_PACKAGE]);
    mockPurchasePro.mockReset();
    mockRestorePurchases.mockReset();
    mockDeriveProSubscriptionSnapshot.mockReset().mockReturnValue(FREE_SNAPSHOT);
    (Purchases.addCustomerInfoUpdateListener as jest.Mock).mockClear();
    (Purchases.removeCustomerInfoUpdateListener as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('lets an existing member explicitly open plans while feature gates remain satisfied', async () => {
    mockGetCustomerInfo.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    await renderProvider();
    act(() => { expect(current?.showPaywall('agents')).toBe(false); });
    act(() => { expect(current?.showPaywall('settingsMembershipPreview')).toBe(true); });
    expect(current?.visible).toBe(true);
    expect(current?.previewOnly).toBe(false);
  });

  it.each([
    ['scheduled', false, 'planChangeScheduled'],
    ['activated', true, 'lifetimeManageSubscription'],
    ['unconfirmed', false, 'purchaseUnconfirmed'],
  ] as const)('keeps member checkout feedback reviewable for %s', async (outcome, requiresSubscriptionManagement, statusCode) => {
    mockGetCustomerInfo.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    mockPurchasePro.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT, outcome, requiresSubscriptionManagement });
    await renderProvider();
    await act(async () => { current?.showPaywall('settingsMembershipPreview'); });
    await act(async () => { await current?.purchasePro(); });
    expect(current?.isPro).toBe(true);
    expect(current?.visible).toBe(true);
    expect(current?.paywallPhase).toBe('complete');
    expect(current?.statusCode).toBe(statusCode);
    expect(current?.purchasePending).toBe(false);
    act(() => { current?.hidePaywall(); });
    expect(current?.visible).toBe(false);
  });

  it.each([false, true])('settles initial loading when the SDK listener wins the refresh race (Pro=%s)', async (isActive) => {
    const pending = deferred<{ customerInfo: object; snapshot: ProSubscriptionSnapshot }>();
    mockGetCustomerInfo.mockReturnValueOnce(pending.promise);
    const authoritative = { ...FREE_SNAPSHOT, isActive };
    mockDeriveProSubscriptionSnapshot.mockReturnValue(authoritative);
    render(<ProPaywallProvider><Capture /></ProPaywallProvider>);
    await waitFor(() => {
      expect(mockGetCustomerInfo).toHaveBeenCalled();
      expect(Purchases.addCustomerInfoUpdateListener).toHaveBeenCalled();
    });
    expect(current?.isLoading).toBe(true);
    const listener = (Purchases.addCustomerInfoUpdateListener as jest.Mock).mock.calls.at(-1)[0];
    await act(async () => { listener({}); });
    expect(current?.isLoading).toBe(false);
    expect(current?.isPro).toBe(isActive);
    await act(async () => {
      pending.resolve({ customerInfo: {}, snapshot: { ...FREE_SNAPSHOT, isActive: !isActive } });
    });
    expect(current?.isLoading).toBe(false);
    expect(current?.snapshot).toEqual(authoritative);
  });

  it('holds the success state for two seconds, then closes and resolves purchase success', async () => {
    mockPurchasePro.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    await renderProvider();
    act(() => current?.showPaywall('agents'));
    jest.useFakeTimers();

    let purchase!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    await act(async () => {
      purchase = current!.purchasePro();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('success');
    expect(current?.statusCode).toBe('purchaseSuccess');
    expect(current?.visible).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_SUCCESS_DISPLAY_MS);
      await purchase;
    });
    await expect(purchase).resolves.toEqual({ success: true, reason: null, outcome: 'activated' });
    expect(current?.visible).toBe(false);
  });

  it('restores Pro through the same timed success state', async () => {
    mockRestorePurchases.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    await renderProvider();
    act(() => current?.showPaywall('gatewayConnections'));
    jest.useFakeTimers();

    let restore!: ReturnType<NonNullable<typeof current>['restorePurchases']>;
    await act(async () => {
      restore = current!.restorePurchases();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('success');
    expect(current?.statusCode).toBe('restoreSuccess');

    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_SUCCESS_DISPLAY_MS);
      await restore;
    });
    await expect(restore).resolves.toEqual({ success: true, reason: null });
    expect(current?.visible).toBe(false);
  });

  it('keeps a settings restore outside the paywall immediate and leaves the paywall state ready', async () => {
    mockRestorePurchases.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    await renderProvider();

    let result;
    await act(async () => {
      result = await current!.restorePurchases();
    });

    expect(result).toEqual({ success: true, reason: null });
    expect(current?.visible).toBe(false);
    expect(current?.paywallPhase).toBe('ready');
    expect(current?.statusCode).toBe('restoreSuccess');
  });

  it('does not let an offering refresh overwrite an active purchase or its two-second success state', async () => {
    const purchaseResult = deferred<{ customerInfo: object; snapshot: ProSubscriptionSnapshot }>();
    const offeringResult = deferred<ProPaywallPackage[]>();
    mockPurchasePro.mockReturnValue(purchaseResult.promise);
    await renderProvider();
    await act(async () => {
      current!.showPaywall('agents');
      await Promise.resolve();
      await Promise.resolve();
    });
    jest.useFakeTimers();

    let purchase!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    await act(async () => {
      purchase = current!.purchasePro();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('purchasing');

    mockGetPaywallPackages.mockReturnValueOnce(offeringResult.promise);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = current!.refreshOfferings();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('purchasing');

    await act(async () => {
      purchaseResult.resolve({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('success');

    await act(async () => {
      offeringResult.resolve([ANNUAL_PACKAGE]);
      await refresh;
    });
    expect(current?.paywallPhase).toBe('success');

    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_SUCCESS_DISPLAY_MS - 1);
      await Promise.resolve();
    });
    expect(current?.visible).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1);
      await purchase;
    });
    expect(current?.visible).toBe(false);
  });

  it('fails closed when the cached Pro snapshot is expired and RevenueCat is offline', async () => {
    const expiredSnapshot = {
      ...PRO_SNAPSHOT,
      expirationDate: new Date(Date.now() - 1).toISOString(),
    };
    mockGetSnapshot.mockResolvedValue({ snapshot: expiredSnapshot, cachedAtMs: Date.now() - 5_000 });
    mockGetCustomerInfo.mockRejectedValue(new Error('offline'));

    await renderProvider();

    expect(current?.isPro).toBe(false);
    expect(current?.snapshot).toEqual({ ...expiredSnapshot, isActive: false });
    expect(mockSetSnapshot).toHaveBeenCalledWith({ ...expiredSnapshot, isActive: false });
  });

  it('locks locally at expiration even when the timer refresh is offline', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1_000));
    const expiringSnapshot = {
      ...PRO_SNAPSHOT,
      expirationDate: new Date(10_000).toISOString(),
    };
    mockGetCustomerInfo.mockResolvedValue({ customerInfo: {}, snapshot: expiringSnapshot });

    await renderProvider();
    expect(current?.isPro).toBe(true);
    mockGetCustomerInfo.mockRejectedValue(new Error('offline'));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(9_025);
    });

    expect(current?.isPro).toBe(false);
    expect(current?.snapshot).toEqual({ ...expiringSnapshot, isActive: false });
  });

  it('rechecks expiration immediately when the app returns to the foreground', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1_000));
    let appStateListener: ((nextState: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    });
    const expiringSnapshot = {
      ...PRO_SNAPSHOT,
      expirationDate: new Date(10_000).toISOString(),
    };
    mockGetCustomerInfo.mockResolvedValue({ customerInfo: {}, snapshot: expiringSnapshot });

    await renderProvider();
    expect(current?.isPro).toBe(true);
    expect(appStateListener).not.toBeNull();
    mockGetCustomerInfo.mockRejectedValue(new Error('offline'));
    jest.setSystemTime(new Date(10_000));

    await act(async () => {
      appStateListener?.('active');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current?.isPro).toBe(false);
    expect(current?.snapshot).toEqual({ ...expiringSnapshot, isActive: false });
    expect(mockSetSnapshot).toHaveBeenLastCalledWith({ ...expiringSnapshot, isActive: false });
  });

  it('keeps purchase and restore in one single-flight and rejects a second gate', async () => {
    const purchaseResult = deferred<{ customerInfo: object; snapshot: ProSubscriptionSnapshot }>();
    mockPurchasePro.mockReturnValue(purchaseResult.promise);
    await renderProvider();
    act(() => {
      expect(current!.showPaywall('agents')).toBe(true);
    });

    let purchase!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    let duplicate!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    let restore!: ReturnType<NonNullable<typeof current>['restorePurchases']>;
    let secondGateAccepted = true;
    await act(async () => {
      purchase = current!.purchasePro();
      duplicate = current!.purchasePro();
      restore = current!.restorePurchases();
      secondGateAccepted = current!.showPaywall('messageHistory');
      await Promise.resolve();
    });

    await expect(duplicate).resolves.toEqual({ success: false, reason: 'pending' });
    await expect(restore).resolves.toEqual({ success: false, reason: 'pending' });
    expect(secondGateAccepted).toBe(false);
    expect(current?.blockedFeature).toBe('agents');
    expect(mockPurchasePro).toHaveBeenCalledTimes(1);
    expect(mockRestorePurchases).not.toHaveBeenCalled();

    await act(async () => {
      purchaseResult.resolve({ customerInfo: {}, snapshot: FREE_SNAPSHOT });
      await purchase;
    });
    expect(current?.purchasePending).toBe(false);
    expect(current?.restorePending).toBe(false);
  });

  it('discards a subscription refresh that started before a successful purchase', async () => {
    const staleRefresh = deferred<{ customerInfo: object; snapshot: ProSubscriptionSnapshot }>();
    mockPurchasePro.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    await renderProvider();

    mockGetCustomerInfo.mockReturnValueOnce(staleRefresh.promise);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = current!.refreshSubscription();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(2);

    act(() => {
      expect(current!.showPaywall('agents')).toBe(true);
    });
    jest.useFakeTimers();
    let purchase!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    await act(async () => {
      purchase = current!.purchasePro();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('success');

    await act(async () => {
      staleRefresh.resolve({ customerInfo: {}, snapshot: FREE_SNAPSHOT });
      await refresh;
    });
    expect(current?.isPro).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_SUCCESS_DISPLAY_MS);
      await purchase;
    });
    expect(current?.isPro).toBe(true);
  });

  it('persists the latest applied snapshot after an older storage write finishes late', async () => {
    await renderProvider();
    mockSetSnapshot.mockReset();
    const oldWrite = deferred<void>();
    const completedWrites: boolean[] = [];
    mockSetSnapshot
      .mockImplementationOnce(async (next: ProSubscriptionSnapshot) => {
        await oldWrite.promise;
        completedWrites.push(next.isActive);
      })
      .mockImplementationOnce(async (next: ProSubscriptionSnapshot) => {
        completedWrites.push(next.isActive);
      });

    mockGetCustomerInfo.mockResolvedValueOnce({ customerInfo: {}, snapshot: FREE_SNAPSHOT });
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = current!.refreshSubscription();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockSetSnapshot).toHaveBeenCalledTimes(1));

    mockPurchasePro.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    act(() => expect(current!.showPaywall('agents')).toBe(true));
    jest.useFakeTimers();
    let purchase!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    await act(async () => {
      purchase = current!.purchasePro();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.isPro).toBe(true);
    expect(current?.paywallPhase).toBe('purchasing');
    expect(mockSetSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      oldWrite.resolve(undefined);
      await refresh;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(completedWrites).toEqual([false, true]);
    expect(mockSetSnapshot.mock.calls.map(([next]) => next.isActive)).toEqual([false, true]);
    expect(current?.paywallPhase).toBe('success');

    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_SUCCESS_DISPLAY_MS);
      await purchase;
    });
  });

  it('ignores an older inactive customer-info listener update during purchase success', async () => {
    mockPurchasePro.mockResolvedValue({ customerInfo: {}, snapshot: PRO_SNAPSHOT });
    await renderProvider();
    await waitFor(() => {
      expect(Purchases.addCustomerInfoUpdateListener).toHaveBeenCalled();
    });
    const listener = (Purchases.addCustomerInfoUpdateListener as jest.Mock).mock.calls.at(-1)?.[0] as
      | ((customerInfo: object) => void)
      | undefined;
    expect(listener).toBeDefined();

    act(() => expect(current!.showPaywall('agents')).toBe(true));
    jest.useFakeTimers();
    let purchase!: ReturnType<NonNullable<typeof current>['purchasePro']>;
    await act(async () => {
      purchase = current!.purchasePro();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current?.paywallPhase).toBe('success');
    expect(current?.isPro).toBe(true);

    act(() => listener?.({ stale: true }));
    expect(mockDeriveProSubscriptionSnapshot).not.toHaveBeenCalled();
    expect(current?.snapshot).toEqual(PRO_SNAPSHOT);

    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_SUCCESS_DISPLAY_MS);
      await purchase;
    });
    expect(current?.isPro).toBe(true);
  });

  it('keeps a normalized restore failure visible for retry and analytics', async () => {
    mockRestorePurchases.mockRejectedValue({ reason: 'store_error:NETWORK_ERROR' });
    await renderProvider();
    act(() => current?.showPaywall('gatewayConnections'));

    let result;
    await act(async () => {
      result = await current!.restorePurchases();
    });

    expect(result).toEqual({ success: false, reason: 'store_error:NETWORK_ERROR' });
    expect(current?.paywallPhase).toBe('failure');
    expect(current?.failureReason).toBe('store_error:NETWORK_ERROR');
    expect(current?.failureOperation).toBe('restore');
  });

  it('returns cancellation to the ready page without a visible error', async () => {
    mockPurchasePro.mockRejectedValue({ reason: 'cancelled' });
    await renderProvider();
    act(() => current?.showPaywall('agents'));

    let result;
    await act(async () => {
      result = await current!.purchasePro();
    });
    expect(result).toEqual({ success: false, reason: 'cancelled' });
    expect(current?.paywallPhase).toBe('ready');
    expect(current?.errorCode).toBeNull();
    expect(current?.failureReason).toBe('cancelled');
    expect(current?.visible).toBe(true);
  });

  it('keeps a normalized store failure visible for purchase analytics', async () => {
    mockPurchasePro.mockRejectedValue({ reason: 'store_error:ITEM_UNAVAILABLE' });
    await renderProvider();
    act(() => current?.showPaywall('agents'));

    let result;
    await act(async () => {
      result = await current!.purchasePro();
    });
    expect(result).toEqual({ success: false, reason: 'store_error:ITEM_UNAVAILABLE' });
    expect(current?.paywallPhase).toBe('failure');
    expect(current?.errorCode).toBe('purchaseFailed');
    expect(current?.failureOperation).toBe('purchase');
  });

});
