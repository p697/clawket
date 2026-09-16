import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage, PRORATION_MODE } from 'react-native-purchases';
import {
  buildProGoogleProductChangeInfo, classifyProPurchaseOutcome, deriveProSubscriptionSnapshot,
  hasRenewingProSubscription, isRevenueCatPackagePurchaseLocked, matchesProProduct,
  ProSubscriptionService, resetRevenueCatForTests, toProPaywallPackage,
} from './pro-subscription';
import { buildAnalyticsSubscriptionProperties } from './analytics/subscription-context';

jest.mock('../config/public', () => ({
  publicRevenueCatConfig: { enabled: true, iosApiKey: 'appl_test', androidApiKey: 'goog_test', entitlementId: 'Clawket Pro' },
}));

function pkg(type: string, id: string) {
  return toProPaywallPackage({ identifier: type, packageType: type, offeringIdentifier: 'default',
    product: { identifier: id, title: type, description: type, price: 3, priceString: '$3' },
  } as PurchasesPackage);
}
const iosMonthly = pkg('MONTHLY', 'com.p697.clawket.pro.monthly');
const iosAnnual = pkg('ANNUAL', 'com.p697.clawket.pro.yearly');
const iosLifetime = pkg('LIFETIME', 'com.p697.clawket.pro.buyout');
const androidMonthly = pkg('MONTHLY', 'com.p697.clawket.pro.monthly:monthly');
const androidAnnual = pkg('ANNUAL', 'com.p697.clawket.pro.monthly:yearly');
const androidLifetime = pkg('LIFETIME', 'com.p697.clawket.pro.lifetime');
const iosPackages = [iosAnnual, iosLifetime, iosMonthly];
const androidPackages = [androidAnnual, androidLifetime, androidMonthly];

function info(product: string | null, options: { store?: string; plan?: string; lifetime?: boolean; renew?: boolean } = {}): CustomerInfo {
  const entitlement = product ? {
    isActive: true, productIdentifier: product, productPlanIdentifier: options.plan ?? null,
    expirationDate: options.lifetime ? null : '2099-10-01T00:00:00Z',
    originalPurchaseDate: '2026-09-01T00:00:00Z', latestPurchaseDate: '2026-09-01T00:00:00Z',
    willRenew: options.renew ?? !options.lifetime, store: options.store ?? 'APP_STORE', verification: 'VERIFIED',
  } : null;
  return {
    entitlements: { active: entitlement ? { 'Clawket Pro': entitlement } : {}, all: {} },
    activeSubscriptions: product && !options.lifetime ? [product] : [],
    allPurchasedProductIdentifiers: product ? [product] : [],
    nonSubscriptionTransactions: options.lifetime ? [{ productIdentifier: product }] : [],
    subscriptionsByProductIdentifier: {}, managementURL: null,
  } as unknown as CustomerInfo;
}
const snapshot = (value: CustomerInfo) => deriveProSubscriptionSnapshot(value, 'Clawket Pro');

describe('member plan changes using the live catalog structure', () => {
  beforeEach(() => { resetRevenueCatForTests(); jest.clearAllMocks(); Platform.OS = 'ios'; });
  afterEach(() => { Platform.OS = 'ios'; });

  it('allows monthly to annual and lifetime, but prevents purchasing the same plan', () => {
    const current = snapshot(info(iosMonthly.productIdentifier));
    expect(iosPackages.map((item) => isRevenueCatPackagePurchaseLocked(item, iosPackages, current))).toEqual([false, false, true]);
    expect(isRevenueCatPackagePurchaseLocked(iosMonthly, iosPackages, snapshot(info(iosAnnual.productIdentifier)))).toBe(false);
  });

  it('matches Android base plans without mistaking monthly and annual for one another', () => {
    Platform.OS = 'android';
    const current = snapshot(info('com.p697.clawket.pro.monthly', { store: 'PLAY_STORE', plan: 'monthly' }));
    expect(matchesProProduct(androidMonthly.productIdentifier, current)).toBe(true);
    expect(matchesProProduct(androidAnnual.productIdentifier, current)).toBe(false);
    expect(androidPackages.map((item) => isRevenueCatPackagePurchaseLocked(item, androidPackages, current))).toEqual([false, false, true]);
    expect(buildProGoogleProductChangeInfo(androidMonthly, androidAnnual)).toEqual({
      oldProductIdentifier: 'com.p697.clawket.pro.monthly', prorationMode: PRORATION_MODE.IMMEDIATE_WITHOUT_PRORATION,
    });
    expect(buildProGoogleProductChangeInfo(androidMonthly, pkg('ANNUAL', 'other:yearly')).prorationMode).toBe(PRORATION_MODE.DEFERRED);
  });

  it('blocks foreign-store and ambiguous recurring changes', () => {
    const foreign = snapshot(info(iosMonthly.productIdentifier, { store: 'PLAY_STORE' }));
    expect(isRevenueCatPackagePurchaseLocked(iosAnnual, iosPackages, foreign)).toBe(true);
    expect(isRevenueCatPackagePurchaseLocked(iosAnnual, iosPackages, snapshot(info('unknown')))).toBe(true);
  });

  it('blocks owned lifetime and preserves grandfathered annual protection', () => {
    const lifetime = snapshot(info(iosLifetime.productIdentifier, { lifetime: true }));
    expect(iosPackages.every((item) => isRevenueCatPackagePurchaseLocked(item, iosPackages, lifetime))).toBe(true);
    const grandfathered = { ...snapshot(info(iosAnnual.productIdentifier)), originalPurchaseDate: '2026-04-01T00:00:00Z' };
    expect(isRevenueCatPackagePurchaseLocked(iosLifetime, iosPackages, grandfathered)).toBe(true);
    expect(buildAnalyticsSubscriptionProperties(lifetime).subscription_type).toBe('lifetime');
  });

  it('does not grant lifetime from refunded purchase history while monthly remains active', () => {
    const monthly = { ...snapshot(info(iosMonthly.productIdentifier)), nonSubscriptionProductIdentifiers: [iosLifetime.productIdentifier!] };
    expect(isRevenueCatPackagePurchaseLocked(iosLifetime, iosPackages, monthly)).toBe(false);
    expect(classifyProPurchaseOutcome(iosLifetime, monthly, monthly, iosLifetime.productIdentifier!)).toBe('unconfirmed');
  });

  it('distinguishes a submitted change from activated access, even if old Pro stays active', () => {
    const monthly = snapshot(info(iosMonthly.productIdentifier));
    expect(classifyProPurchaseOutcome(iosAnnual, monthly, monthly, iosMonthly.productIdentifier!)).toBe('scheduled');
    expect(classifyProPurchaseOutcome(iosAnnual, monthly, monthly, 'unrelated')).toBe('unconfirmed');
    expect(classifyProPurchaseOutcome(iosLifetime, monthly, snapshot(info(iosLifetime.productIdentifier, { lifetime: true })), iosLifetime.productIdentifier!)).toBe('activated');
  });

  it('retains recurring renewal status independently of lifetime entitlement', () => {
    const lifetime = snapshot(info(iosLifetime.productIdentifier, { lifetime: true }));
    const recurring = { productIdentifier: iosMonthly.productIdentifier!, isActive: true, willRenew: true, store: 'APP_STORE', expiresDate: '2099-10-01', ownershipType: 'PURCHASED' };
    expect(hasRenewingProSubscription({ ...lifetime, subscriptions: [recurring] })).toBe(true);
    expect(hasRenewingProSubscription({ ...lifetime, subscriptions: [{ ...recurring, willRenew: false }] })).toBe(false);
    expect(hasRenewingProSubscription({ ...lifetime, subscriptions: [{ ...recurring, ownershipType: 'FAMILY_SHARED' }] })).toBe(false);
  });

  it('refreshes ownership before purchase and sends Android replacement parameters', async () => {
    Platform.OS = 'android';
    const before = info('com.p697.clawket.pro.monthly', { store: 'PLAY_STORE', plan: 'monthly' });
    const after = info('com.p697.clawket.pro.monthly', { store: 'PLAY_STORE', plan: 'yearly' });
    (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(before);
    (Purchases.purchasePackage as jest.Mock).mockResolvedValue({ productIdentifier: 'com.p697.clawket.pro.monthly', customerInfo: after });
    const result = await ProSubscriptionService.purchasePro(androidAnnual.package, androidPackages);
    expect(Purchases.invalidateCustomerInfoCache).toHaveBeenCalledTimes(1);
    expect(Purchases.purchasePackage).toHaveBeenCalledWith(androidAnnual.package, null, {
      oldProductIdentifier: 'com.p697.clawket.pro.monthly', prorationMode: PRORATION_MODE.IMMEDIATE_WITHOUT_PRORATION,
    });
    expect(result.outcome).toBe('scheduled');
    expect(result.snapshot.productPlanIdentifier).toBe('yearly');
  });

  it('purchases lifetime separately and requires management when the prior plan renews', async () => {
    (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(info(iosMonthly.productIdentifier));
    (Purchases.purchasePackage as jest.Mock).mockResolvedValue({ productIdentifier: iosLifetime.productIdentifier, customerInfo: info(iosLifetime.productIdentifier, { lifetime: true }) });
    const result = await ProSubscriptionService.purchasePro(iosLifetime.package, iosPackages);
    expect(Purchases.purchasePackage).toHaveBeenCalledWith(iosLifetime.package);
    expect(result).toMatchObject({ outcome: 'activated', requiresSubscriptionManagement: true });
  });

  it('does not open store checkout when a fresh snapshot already owns lifetime', async () => {
    (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(info(iosLifetime.productIdentifier, { lifetime: true }));
    await expect(ProSubscriptionService.purchasePro(iosAnnual.package, iosPackages)).rejects.toThrow('PLAN_CHANGE_UNAVAILABLE');
    expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  });

  it.each(['1', '20'])('preserves cancellation and pending errors without reporting success (%s)', async (code) => {
    (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(info(iosMonthly.productIdentifier));
    (Purchases.purchasePackage as jest.Mock).mockRejectedValue({ code });
    await expect(ProSubscriptionService.purchasePro(iosAnnual.package, iosPackages)).rejects.toEqual({ code });
  });
});
