import type { ProSubscriptionSnapshot } from '../pro-subscription';
import { buildAnalyticsSubscriptionProperties } from './subscription-context';

function snapshot(patch: Partial<ProSubscriptionSnapshot> = {}): ProSubscriptionSnapshot {
  return {
    isActive: true,
    entitlementId: 'pro',
    productIdentifier: 'clawket_annual',
    productPlanIdentifier: null,
    activeSubscriptionProductIdentifiers: [],
    purchasedProductIdentifiers: [],
    nonSubscriptionProductIdentifiers: [],
    originalPurchaseDate: '2026-08-01T00:00:00.000Z',
    latestPurchaseDate: null,
    expirationDate: null,
    willRenew: true,
    store: null,
    managementURL: null,
    originalAppUserId: null,
    requestDate: null,
    verification: null,
    ...patch,
  };
}

describe('analytics subscription context', () => {
  it('publishes is_pro and the one-release is_premium compatibility alias together', () => {
    expect(buildAnalyticsSubscriptionProperties(null)).toMatchObject({
      subscription_status: 'free',
      is_pro: false,
      is_premium: false,
    });
    expect(buildAnalyticsSubscriptionProperties(snapshot(), Date.parse('2026-09-05T00:00:00.000Z')))
      .toMatchObject({
        subscription_status: 'pro',
        subscription_type: 'yearly',
        subscription_tenure_bucket: '31_90d',
        is_pro: true,
        is_premium: true,
      });
  });
});
