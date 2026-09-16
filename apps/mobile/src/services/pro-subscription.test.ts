import {
  classifyProPurchaseError,
  classifyProPurchaseFailureReason,
  deriveProSubscriptionSnapshot,
  getProSubscriptionExpirationMs,
  hasLifetimeProAccess,
  isProSubscriptionSnapshotActiveAt,
  isRevenueCatPackagePurchaseLocked,
  normalizeProSubscriptionSnapshotAt,
  resetRevenueCatForTests,
  resolveRevenueCatConfig,
  resolveProOfferingMetadata,
  selectActiveRecurringRevenueCatPackage,
  selectDefaultRevenueCatPackage,
  selectDisplayedRevenueCatPackage,
  selectOwnedLifetimeRevenueCatPackage,
  selectRevenueCatPackages,
  selectSnapshotRevenueCatPackageByMetadata,
  shouldDisplayGrandfatheredLifetimeUi,
  shouldShowLifetimeUpgradeAnnouncementForSnapshot,
  toProPaywallPackage,
  type ProSubscriptionSnapshot,
} from './pro-subscription';
import { buildAnalyticsSubscriptionProperties } from './analytics/subscription-context';

describe('resolveRevenueCatConfig', () => {
  afterEach(() => {
    resetRevenueCatForTests();
  });

  it('returns null when billing config is missing', () => {
    const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    expect(resolveRevenueCatConfig('ios', {} as NodeJS.ProcessEnv)).toBeNull();

    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
  });

  it('returns null when required config is missing for unsupported platforms', () => {
    expect(resolveRevenueCatConfig('web', {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('prefers the test store api key in development', () => {
    const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;

    expect(resolveRevenueCatConfig('ios', {
      EXPO_PUBLIC_REVENUECAT_TEST_API_KEY: 'test_key',
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_key',
      EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'pro',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      apiKey: 'test_key',
      entitlementId: 'pro',
      offeringId: undefined,
      packageId: undefined,
    });

    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
  });

  it('resolves iOS config from env', () => {
    const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    expect(resolveRevenueCatConfig('ios', {
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_key',
      EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'pro',
      EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID: 'default',
      EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID: '$rc_monthly',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      apiKey: 'appl_key',
      entitlementId: 'pro',
      offeringId: 'default',
      packageId: '$rc_monthly',
    });

    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
  });

  it('resolves Android config from env', () => {
    const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    expect(resolveRevenueCatConfig('android', {
      EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'goog_key',
      EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'pro',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      apiKey: 'goog_key',
      entitlementId: 'pro',
      offeringId: undefined,
      packageId: undefined,
    });

    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
  });
});

describe('deriveProSubscriptionSnapshot', () => {
  it('maps active entitlement state', () => {
    const snapshot = deriveProSubscriptionSnapshot({
      entitlements: {
        active: {
          pro: {
            identifier: 'pro',
            isActive: true,
            willRenew: true,
            periodType: 'NORMAL',
            latestPurchaseDate: '2026-03-08T00:00:00.000Z',
            latestPurchaseDateMillis: 1,
            originalPurchaseDate: '2026-03-01T00:00:00.000Z',
            originalPurchaseDateMillis: 1,
            expirationDate: '2026-04-08T00:00:00.000Z',
            expirationDateMillis: 1,
            store: 'APP_STORE',
            productIdentifier: 'clawket_pro_monthly',
            productPlanIdentifier: null,
            isSandbox: false,
            unsubscribeDetectedAt: null,
            unsubscribeDetectedAtMillis: null,
            billingIssueDetectedAt: null,
            billingIssueDetectedAtMillis: null,
            ownershipType: 'PURCHASED',
            verification: 'VERIFIED' as any,
          },
        },
        all: {},
        verification: 'VERIFIED' as any,
      },
      activeSubscriptions: ['clawket_pro_monthly'],
      allPurchasedProductIdentifiers: ['clawket_pro_monthly'],
      latestExpirationDate: '2026-04-08T00:00:00.000Z',
      firstSeen: '2026-03-01T00:00:00.000Z',
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: '2026-03-08T00:00:00.000Z',
      allExpirationDates: {},
      allPurchaseDates: {},
      originalApplicationVersion: null,
      originalPurchaseDate: null,
      managementURL: 'https://apps.apple.com/account/subscriptions',
      nonSubscriptionTransactions: [],
      subscriptionsByProductIdentifier: {},
    }, 'pro');

    expect(snapshot).toEqual({
      subscriptions: [],
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'clawket_pro_monthly',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: ['clawket_pro_monthly'],
      purchasedProductIdentifiers: ['clawket_pro_monthly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: '2026-03-01T00:00:00.000Z',
      latestPurchaseDate: '2026-03-08T00:00:00.000Z',
      expirationDate: '2026-04-08T00:00:00.000Z',
      willRenew: true,
      store: 'APP_STORE',
      managementURL: 'https://apps.apple.com/account/subscriptions',
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: '2026-03-08T00:00:00.000Z',
      verification: 'VERIFIED',
    });
  });

  it('prefers active entitlement product metadata over stale all-entitlement data', () => {
    const snapshot = deriveProSubscriptionSnapshot({
      entitlements: {
        active: {
          pro: {
            identifier: 'pro',
            isActive: true,
            willRenew: true,
            periodType: 'NORMAL',
            latestPurchaseDate: '2026-04-10T00:00:00.000Z',
            latestPurchaseDateMillis: 1,
            originalPurchaseDate: '2026-04-10T00:00:00.000Z',
            originalPurchaseDateMillis: 1,
            expirationDate: '2026-05-10T00:00:00.000Z',
            expirationDateMillis: 1,
            store: 'APP_STORE',
            productIdentifier: 'clawket_pro_monthly',
            productPlanIdentifier: 'monthly',
            isSandbox: false,
            unsubscribeDetectedAt: null,
            unsubscribeDetectedAtMillis: null,
            billingIssueDetectedAt: null,
            billingIssueDetectedAtMillis: null,
            ownershipType: 'PURCHASED',
            verification: 'VERIFIED' as any,
          },
        },
        all: {
          pro: {
            identifier: 'pro',
            isActive: false,
            willRenew: false,
            periodType: 'NORMAL',
            latestPurchaseDate: '2026-01-01T00:00:00.000Z',
            latestPurchaseDateMillis: 1,
            originalPurchaseDate: '2026-01-01T00:00:00.000Z',
            originalPurchaseDateMillis: 1,
            expirationDate: null,
            expirationDateMillis: null,
            store: 'APP_STORE',
            productIdentifier: 'clawket_pro_lifetime',
            productPlanIdentifier: 'lifetime',
            isSandbox: false,
            unsubscribeDetectedAt: null,
            unsubscribeDetectedAtMillis: null,
            billingIssueDetectedAt: null,
            billingIssueDetectedAtMillis: null,
            ownershipType: 'PURCHASED',
            verification: 'VERIFIED' as any,
          },
        },
        verification: 'VERIFIED' as any,
      },
      activeSubscriptions: ['clawket_pro_monthly'],
      allPurchasedProductIdentifiers: ['clawket_pro_monthly', 'clawket_pro_lifetime'],
      latestExpirationDate: '2026-05-10T00:00:00.000Z',
      firstSeen: '2026-01-01T00:00:00.000Z',
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: '2026-04-10T00:00:00.000Z',
      allExpirationDates: {},
      allPurchaseDates: {},
      originalApplicationVersion: null,
      originalPurchaseDate: null,
      managementURL: 'https://apps.apple.com/account/subscriptions',
      nonSubscriptionTransactions: [],
      subscriptionsByProductIdentifier: {},
    } as any, 'pro');

    expect(snapshot.productIdentifier).toBe('clawket_pro_monthly');
    expect(snapshot.productPlanIdentifier).toBe('monthly');
    expect(snapshot.activeSubscriptionProductIdentifiers).toEqual(['clawket_pro_monthly']);
    expect(snapshot.purchasedProductIdentifiers).toEqual(['clawket_pro_monthly', 'clawket_pro_lifetime']);
    expect(snapshot.nonSubscriptionProductIdentifiers).toEqual([]);
    expect(snapshot.willRenew).toBe(true);
  });
});

describe('buildAnalyticsSubscriptionProperties', () => {
  it('derives a coarse-grained analytics subscription context', () => {
    expect(buildAnalyticsSubscriptionProperties({
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'clawket_pro_yearly',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: [],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: '2026-01-15T00:00:00.000Z',
      latestPurchaseDate: '2026-03-08T00:00:00.000Z',
      expirationDate: '2027-01-15T00:00:00.000Z',
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    }, Date.parse('2026-03-23T00:00:00.000Z'))).toEqual({
      subscription_status: 'pro',
      subscription_type: 'yearly',
      subscription_tenure_bucket: '31_90d',
      is_pro: true,
      is_premium: true,
    });
  });

  it('falls back to non-sensitive defaults for free users', () => {
    expect(buildAnalyticsSubscriptionProperties(null)).toEqual({
      subscription_status: 'free',
      subscription_type: 'none',
      subscription_tenure_bucket: 'none',
      is_pro: false,
      is_premium: false,
    });
  });
});

describe('selectRevenueCatPackages', () => {
  const monthlyPackage = {
    identifier: '$rc_monthly',
    packageType: 'MONTHLY',
    product: {
      identifier: 'monthly',
      title: 'Clawket Pro Monthly',
      description: 'Unlock Pro',
      price: 2.99,
      priceString: '$2.99',
      pricePerMonth: 2.99,
      pricePerMonthString: '$2.99',
    },
  } as any;
  const annualPackage = {
    identifier: '$rc_annual',
    packageType: 'ANNUAL',
    product: {
      identifier: 'yearly',
      title: 'Clawket Pro Annual',
      description: 'Unlock Pro',
      price: 23.99,
      priceString: '$29.99',
      pricePerMonth: 2,
      pricePerMonthString: '$2.49',
    },
  } as any;
  const lifetimePackage = {
    identifier: '$rc_lifetime',
    packageType: 'LIFETIME',
    product: {
      identifier: 'lifetime',
      title: 'Clawket Pro Lifetime',
      description: 'Unlock Pro forever',
      price: 49.99,
      priceString: '$79.99',
      pricePerMonth: null,
      pricePerMonthString: null,
    },
  } as any;

  it('returns annual, lifetime, and monthly packages in the product order', () => {
    expect(selectRevenueCatPackages({
      all: {
        default: {
          identifier: 'default',
          availablePackages: [monthlyPackage, annualPackage, lifetimePackage],
          lifetime: lifetimePackage,
          monthly: monthlyPackage,
          annual: annualPackage,
        },
      },
      current: null,
    } as any, {
      apiKey: 'key',
      entitlementId: 'pro',
      offeringId: 'default',
    })).toEqual([annualPackage, lifetimePackage, monthlyPackage]);
  });

  it('falls back to the first available package when no monthly or annual package exists', () => {
    const customPackage = {
      identifier: 'promo',
      packageType: 'CUSTOM',
      product: {
        title: 'Promo',
        description: 'Unlock Pro',
        priceString: '$1.99',
        pricePerMonthString: null,
      },
    } as any;

    expect(selectRevenueCatPackages({
      all: {},
      current: {
        identifier: 'default',
        availablePackages: [customPackage],
        monthly: null,
        annual: null,
      },
    } as any, {
      apiKey: 'key',
      entitlementId: 'pro',
    })).toEqual([customPackage]);
  });

  it('uses the RevenueCat current offering so targeting and experiment assignments remain authoritative', () => {
    const proOffering = {
      identifier: 'pro',
      metadata: {},
      availablePackages: [annualPackage],
      annual: annualPackage,
      monthly: null,
      lifetime: null,
    };
    expect(selectRevenueCatPackages({
      all: { pro: proOffering },
      current: {
        identifier: 'other',
        metadata: {},
        availablePackages: [monthlyPackage],
        annual: null,
        monthly: monthlyPackage,
        lifetime: null,
      },
    } as any, { apiKey: 'key', entitlementId: 'pro' })).toEqual([monthlyPackage]);
  });

  it('keeps a current experiment variant authoritative over the pro and legacy configured offering ids', () => {
    const proOffering = {
      identifier: 'pro',
      metadata: { default_package: 'monthly' },
      availablePackages: [monthlyPackage],
      annual: null,
      monthly: monthlyPackage,
      lifetime: null,
    };
    const legacyOffering = {
      identifier: 'default',
      metadata: {},
      availablePackages: [annualPackage],
      annual: annualPackage,
      monthly: null,
      lifetime: null,
    };
    expect(selectRevenueCatPackages({
      all: { pro: proOffering, default: legacyOffering },
      current: legacyOffering,
    } as any, {
      apiKey: 'key',
      entitlementId: 'pro',
      offeringId: 'default',
    })).toEqual([annualPackage]);
  });

  it('falls back to the named pro offering when RevenueCat has no current assignment', () => {
    const proOffering = {
      identifier: 'pro',
      metadata: {},
      availablePackages: [annualPackage],
      annual: annualPackage,
      monthly: null,
      lifetime: null,
    };
    expect(selectRevenueCatPackages({
      all: { pro: proOffering },
      current: null,
    } as any, { apiKey: 'key', entitlementId: 'pro' })).toEqual([annualPackage]);
  });

  it('honors an explicitly configured non-default custom offering over pro', () => {
    const proOffering = {
      identifier: 'pro',
      metadata: {},
      availablePackages: [annualPackage],
      annual: annualPackage,
      monthly: null,
      lifetime: null,
    };
    const customOffering = {
      identifier: 'team-promo',
      metadata: { default_package: 'monthly' },
      availablePackages: [monthlyPackage],
      annual: null,
      monthly: monthlyPackage,
      lifetime: null,
    };
    expect(selectRevenueCatPackages({
      all: { pro: proOffering, 'team-promo': customOffering },
      current: proOffering,
    } as any, {
      apiKey: 'key',
      entitlementId: 'pro',
      offeringId: 'team-promo',
    })).toEqual([monthlyPackage]);
  });

  it('normalizes supported offering metadata and fails safe on malformed values', () => {
    expect(resolveProOfferingMetadata({
      metadata: { default_package: 'monthly', social_proof: false },
    })).toEqual({ defaultPackage: 'monthly', socialProof: false });
    expect(resolveProOfferingMetadata({
      metadata: { default_package: 'weekly', social_proof: 'false' },
    })).toEqual({ defaultPackage: 'annual', socialProof: true });
  });

  it('keeps offering metadata authoritative over the legacy configured package id', () => {
    const packages = [
      toProPaywallPackage(monthlyPackage, { defaultPackage: 'annual', socialProof: true }),
      toProPaywallPackage(annualPackage, { defaultPackage: 'annual', socialProof: true }),
    ];
    expect(selectDefaultRevenueCatPackage(packages, {
      apiKey: 'key',
      entitlementId: 'pro',
      packageId: '$rc_monthly',
    })?.packageIdentifier).toBe('$rc_annual');
  });

  it('defaults to annual when offering metadata is absent', () => {
    const packages = [toProPaywallPackage(annualPackage), toProPaywallPackage(monthlyPackage)];
    expect(selectDefaultRevenueCatPackage(packages, {
      apiKey: 'key',
      entitlementId: 'pro',
    })?.packageIdentifier).toBe('$rc_annual');
  });

  it('selects monthly when the offering metadata requests it', () => {
    const metadata = { defaultPackage: 'monthly' as const, socialProof: false };
    const packages = [
      toProPaywallPackage(annualPackage, metadata),
      toProPaywallPackage(monthlyPackage, metadata),
    ];
    expect(selectDefaultRevenueCatPackage(packages, {
      apiKey: 'key',
      entitlementId: 'pro',
    })?.packageIdentifier).toBe('$rc_monthly');
  });

  it('falls back to lifetime when it is the only primary paywall package', () => {
    const packages = [toProPaywallPackage(lifetimePackage)];
    expect(selectDefaultRevenueCatPackage(packages, {
      apiKey: 'key',
      entitlementId: 'pro',
    })?.packageIdentifier).toBe('$rc_lifetime');
  });

  it('matches the subscribed package from snapshot metadata as a metadata-only fallback', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage)];
    expect(selectSnapshotRevenueCatPackageByMetadata(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'yearly',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: [],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'TEST_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_annual');
  });

  it('selects the active recurring package from active subscription identifiers', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectActiveRecurringRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'ignored',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: ['yearly'],
      purchasedProductIdentifiers: ['yearly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_annual');
  });

  it('matches a lifetime package from snapshot metadata as a metadata-only fallback', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];
    expect(selectSnapshotRevenueCatPackageByMetadata(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.lifetime',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: [],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: false,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_lifetime');
  });

  it('detects lifetime access from the active snapshot package', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];

    expect(hasLifetimeProAccess(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'lifetime',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: ['com.p697.clawket.pro.lifetime'],
      nonSubscriptionProductIdentifiers: ['lifetime'],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: false,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBe(true);

    expect(hasLifetimeProAccess(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'monthly',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: ['monthly'],
      purchasedProductIdentifiers: ['monthly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'TEST_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBe(false);
  });

  it('does not treat stale lifetime metadata on active recurring subscriptions as owned lifetime', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];

    expect(hasLifetimeProAccess(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.lifetime',
      productPlanIdentifier: 'lifetime',
      activeSubscriptionProductIdentifiers: ['monthly'],
      purchasedProductIdentifiers: ['monthly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBe(false);
  });

  it('locks the current plan while allowing annual and lifetime for monthly subscribers', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];
    const snapshot: ProSubscriptionSnapshot = {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'monthly',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: ['monthly'],
      purchasedProductIdentifiers: ['monthly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    };

    expect(isRevenueCatPackagePurchaseLocked(packages[0], packages, snapshot)).toBe(true);
    expect(isRevenueCatPackagePurchaseLocked(packages[1], packages, snapshot)).toBe(false);
    expect(isRevenueCatPackagePurchaseLocked(packages[2], packages, snapshot)).toBe(false);
  });

  it('locks every package once lifetime access is already owned', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];
    const snapshot: ProSubscriptionSnapshot = {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'lifetime',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: ['monthly', 'lifetime'],
      nonSubscriptionProductIdentifiers: ['lifetime'],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: false,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    };

    expect(isRevenueCatPackagePurchaseLocked(packages[0], packages, snapshot)).toBe(true);
    expect(isRevenueCatPackagePurchaseLocked(packages[1], packages, snapshot)).toBe(true);
    expect(isRevenueCatPackagePurchaseLocked(packages[2], packages, snapshot)).toBe(true);
  });

  it('keeps lifetime purchasable when only stale lifetime metadata exists on an active recurring subscription', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];
    const snapshot: ProSubscriptionSnapshot = {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.lifetime',
      productPlanIdentifier: 'lifetime',
      activeSubscriptionProductIdentifiers: ['yearly'],
      purchasedProductIdentifiers: ['yearly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    };

    expect(isRevenueCatPackagePurchaseLocked(packages[0], packages, snapshot)).toBe(false);
    expect(isRevenueCatPackagePurchaseLocked(packages[1], packages, snapshot)).toBe(true);
    expect(isRevenueCatPackagePurchaseLocked(packages[2], packages, snapshot)).toBe(false);
  });

  it('shows the grandfathered lifetime UI for active annual members before the Pacific cutoff', () => {
    expect(shouldDisplayGrandfatheredLifetimeUi({
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.yearly',
      productPlanIdentifier: 'annual',
      activeSubscriptionProductIdentifiers: ['com.p697.clawket.pro.yearly'],
      purchasedProductIdentifiers: ['com.p697.clawket.pro.yearly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: '2026-04-18T06:59:59.000Z',
      latestPurchaseDate: '2026-04-18T06:59:59.000Z',
      expirationDate: '2027-04-18T06:59:59.000Z',
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBe(true);
  });

  it('does not show the grandfathered lifetime UI at or after the Pacific cutoff', () => {
    expect(shouldDisplayGrandfatheredLifetimeUi({
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.yearly',
      productPlanIdentifier: 'annual',
      activeSubscriptionProductIdentifiers: ['com.p697.clawket.pro.yearly'],
      purchasedProductIdentifiers: ['com.p697.clawket.pro.yearly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: '2026-04-18T07:00:00.000Z',
      latestPurchaseDate: '2026-04-18T07:00:00.000Z',
      expirationDate: '2027-04-18T07:00:00.000Z',
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBe(false);
  });

  it('shows the lifetime upgrade announcement for grandfathered annual members', () => {
    expect(shouldShowLifetimeUpgradeAnnouncementForSnapshot({
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.yearly',
      productPlanIdentifier: 'annual',
      activeSubscriptionProductIdentifiers: ['com.p697.clawket.pro.yearly'],
      purchasedProductIdentifiers: ['com.p697.clawket.pro.yearly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: '2026-04-10T00:00:00.000Z',
      latestPurchaseDate: '2026-04-10T00:00:00.000Z',
      expirationDate: '2027-04-10T00:00:00.000Z',
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBe(true);
  });

  it('selects the owned lifetime package from purchased identifiers', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectOwnedLifetimeRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'lifetime',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: ['monthly'],
      purchasedProductIdentifiers: ['monthly', 'lifetime'],
      nonSubscriptionProductIdentifiers: ['lifetime'],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_lifetime');
  });

  it('matches a package from the snapshot product plan identifier as a metadata-only fallback', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectSnapshotRevenueCatPackageByMetadata(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro',
      productPlanIdentifier: 'monthly',
      activeSubscriptionProductIdentifiers: ['monthly'],
      purchasedProductIdentifiers: ['monthly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_monthly');
  });

  it('prefers active subscription identifiers over stale lifetime entitlement metadata', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectDisplayedRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.lifetime',
      productPlanIdentifier: 'lifetime',
      activeSubscriptionProductIdentifiers: ['monthly'],
      purchasedProductIdentifiers: ['monthly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_monthly');
  });

  it('displays the lifetime package for grandfathered annual members', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectDisplayedRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'yearly',
      productPlanIdentifier: 'annual',
      activeSubscriptionProductIdentifiers: ['yearly'],
      purchasedProductIdentifiers: ['yearly'],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: '2026-04-10T00:00:00.000Z',
      latestPurchaseDate: '2026-04-10T00:00:00.000Z',
      expirationDate: '2027-04-10T00:00:00.000Z',
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_lifetime');
  });

  it('prefers lifetime when the user owns lifetime alongside an active recurring subscription', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectDisplayedRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'lifetime',
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: ['yearly'],
      purchasedProductIdentifiers: ['yearly', 'lifetime'],
      nonSubscriptionProductIdentifiers: ['lifetime'],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })?.packageIdentifier).toBe('$rc_lifetime');
  });

  it('returns null when no reliable package details are available', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(annualPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectDisplayedRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: null,
      productPlanIdentifier: null,
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: [],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBeNull();
  });

  it('does not use metadata-only lifetime guesses for displayed package selection', () => {
    const packages = [toProPaywallPackage(monthlyPackage), toProPaywallPackage(lifetimePackage)];

    expect(selectDisplayedRevenueCatPackage(packages, {
      isActive: true,
      entitlementId: 'pro',
      productIdentifier: 'com.p697.clawket.pro.lifetime',
      productPlanIdentifier: 'lifetime',
      activeSubscriptionProductIdentifiers: [],
      purchasedProductIdentifiers: [],
      nonSubscriptionProductIdentifiers: [],
      originalPurchaseDate: null,
      latestPurchaseDate: null,
      expirationDate: null,
      willRenew: true,
      store: 'APP_STORE',
      managementURL: null,
      originalAppUserId: '$RCAnonymousID:test',
      requestDate: null,
      verification: null,
    })).toBeNull();
  });

});

describe('subscription snapshot expiration', () => {
  const activeSnapshot: ProSubscriptionSnapshot = {
    isActive: true,
    entitlementId: 'pro',
    productIdentifier: 'annual',
    productPlanIdentifier: null,
    activeSubscriptionProductIdentifiers: ['annual'],
    purchasedProductIdentifiers: ['annual'],
    nonSubscriptionProductIdentifiers: [],
    originalPurchaseDate: null,
    latestPurchaseDate: null,
    expirationDate: '2026-09-05T00:00:01.000Z',
    willRenew: false,
    store: 'APP_STORE',
    managementURL: null,
    originalAppUserId: null,
    requestDate: null,
    verification: null,
  };

  it('locks a cached subscription at the exact expiration boundary', () => {
    const expirationMs = Date.parse(activeSnapshot.expirationDate!);
    expect(getProSubscriptionExpirationMs(activeSnapshot)).toBe(expirationMs);
    expect(isProSubscriptionSnapshotActiveAt(activeSnapshot, expirationMs - 1)).toBe(true);
    expect(isProSubscriptionSnapshotActiveAt(activeSnapshot, expirationMs)).toBe(false);
    expect(normalizeProSubscriptionSnapshotAt(activeSnapshot, expirationMs)).toEqual({
      ...activeSnapshot,
      isActive: false,
    });
  });

  it('keeps lifetime access and fails closed on malformed expiration data', () => {
    const lifetime = { ...activeSnapshot, expirationDate: null };
    expect(isProSubscriptionSnapshotActiveAt(lifetime, Date.now())).toBe(true);
    expect(isProSubscriptionSnapshotActiveAt({
      ...activeSnapshot,
      expirationDate: 'not-a-date',
    }, Date.now())).toBe(false);
  });
});

describe('classifyProPurchaseError', () => {
  it('maps RevenueCat error codes to UI states', () => {
    expect(classifyProPurchaseError({ code: '1' })).toBe('cancelled');
    expect(classifyProPurchaseError({ code: '20' })).toBe('pending');
    expect(classifyProPurchaseError({ code: '5' })).toBe('purchaseUnavailable');
    expect(classifyProPurchaseError({ code: '11' })).toBe('notConfigured');
    expect(classifyProPurchaseError(new Error('boom'))).toBe('unknown');
  });

  it('maps cancellation, pending, and store errors to analytics-safe reasons', () => {
    expect(classifyProPurchaseFailureReason({ code: '1' })).toBe('cancelled');
    expect(classifyProPurchaseFailureReason({ code: '20' })).toBe('pending');
    expect(classifyProPurchaseFailureReason({
      code: '5',
      underlyingErrorMessage: 'Billing response: ITEM_UNAVAILABLE',
    })).toBe('store_error:ITEM_UNAVAILABLE');
    expect(classifyProPurchaseFailureReason({ code: '10' })).toBe('store_error:10');
    expect(classifyProPurchaseFailureReason(new Error('boom'))).toBe('store_error:UNKNOWN');
  });
});
