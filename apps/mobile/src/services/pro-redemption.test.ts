import { Linking, Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { publicRevenueCatConfig } from '../config/public';
import { ProSubscriptionService, resetRevenueCatForTests } from './pro-subscription';

jest.mock('../config/public', () => ({
  publicRevenueCatConfig: { enabled: true, iosApiKey: 'appl_testfixture', androidApiKey: 'goog_testfixture', entitlementId: 'pro', testApiKey: '' },
  resolvePublicRevenueCatConfig: jest.fn(),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, Linking: { openURL: jest.fn().mockResolvedValue(undefined) } }));

const originalPlatform = Platform.OS;

describe('native store redemption', () => {
  beforeEach(() => {
    resetRevenueCatForTests();
    jest.clearAllMocks();
    publicRevenueCatConfig.enabled = true;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    Purchases.presentCodeRedemptionSheet = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    jest.restoreAllMocks();
    resetRevenueCatForTests();
  });

  it('presents the iOS store sheet without purchasing or granting access', async () => {
    await ProSubscriptionService.presentCodeRedemption();
    expect(Purchases.presentCodeRedemptionSheet).toHaveBeenCalledTimes(1);
    expect(Purchases.purchasePackage).not.toHaveBeenCalled();
    expect(Purchases.restorePurchases).not.toHaveBeenCalled();
  });

  it('opens the Google Play redemption surface on Android', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    await ProSubscriptionService.presentCodeRedemption();
    expect(Linking.openURL).toHaveBeenCalledWith('https://play.google.com/redeem');
    expect(Purchases.presentCodeRedemptionSheet).not.toHaveBeenCalled();
  });

  it('does not open a store when billing is unavailable', async () => {
    publicRevenueCatConfig.enabled = false;
    await expect(ProSubscriptionService.presentCodeRedemption()).rejects.toThrow('not configured');
    expect(Purchases.presentCodeRedemptionSheet).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('propagates native presentation failure for retryable UI feedback', async () => {
    jest.mocked(Purchases.presentCodeRedemptionSheet).mockRejectedValueOnce(new Error('unavailable'));
    await expect(ProSubscriptionService.presentCodeRedemption()).rejects.toThrow('unavailable');
  });

  it('bypasses the customer cache only for an explicit reconciliation', async () => {
    await ProSubscriptionService.getCustomerInfo();
    expect(Purchases.invalidateCustomerInfoCache).not.toHaveBeenCalled();
    await ProSubscriptionService.getCustomerInfo(true);
    expect(Purchases.invalidateCustomerInfoCache).toHaveBeenCalledTimes(1);
    expect(Purchases.getCustomerInfo).toHaveBeenCalledTimes(2);
    const invalidationOrder = jest.mocked(Purchases.invalidateCustomerInfoCache).mock.invocationCallOrder[0];
    expect(invalidationOrder).toBeLessThan(jest.mocked(Purchases.getCustomerInfo).mock.invocationCallOrder[1]);
  });
});
