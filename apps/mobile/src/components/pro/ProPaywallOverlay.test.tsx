import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ProPaywallOverlay } from './ProPaywallOverlay';

const mockPurchasePro = jest.fn();
const mockRestorePurchases = jest.fn();
const mockCompleteIntro = jest.fn();
const mockRefreshOfferings = jest.fn();
const mockSelectPackage = jest.fn();
var mockAnalytics: Record<string, jest.Mock>;

let mockContext: Record<string, unknown>;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    Alert: { alert: jest.fn() },
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    Modal: ({ children, ...props }: { children?: React.ReactNode }) => ReactRuntime.createElement('Modal', props, children),
    StyleSheet: { flatten: (style: unknown) => style ?? {} },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => mockContext,
}));

jest.mock('../../services/analytics/events', () => {
  mockAnalytics = {
    paywallViewed: jest.fn(),
    paywallClosed: jest.fn(),
    paywallPackageSelected: jest.fn(),
    paywallSubscribeTapped: jest.fn(),
    paywallPurchaseSucceeded: jest.fn(),
    paywallPurchaseFailed: jest.fn(),
    paywallRestoreTapped: jest.fn(),
    paywallRestoreSucceeded: jest.fn(),
    paywallRestoreFailed: jest.fn(),
    paywallLaunchShown: jest.fn(),
    paywallLaunchClosed: jest.fn(),
  };
  return { analyticsEvents: mockAnalytics };
});

jest.mock('../../services/pro-subscription', () => ({
  isRevenueCatPackagePurchaseLocked: () => false,
}));

jest.mock('../../config/public', () => ({
  publicAppLinks: {
    termsOfUseUrl: 'https://example.com/terms',
    privacyPolicyUrl: 'https://example.com/privacy',
  },
}));

jest.mock('../../screens/Paywall/PaywallScreen', () => {
  const ReactRuntime = require('react');
  return {
    PaywallScreen: (props: Record<string, unknown>) => ReactRuntime.createElement(
      'PaywallScreen',
      { ...props, testID: 'mock-paywall-screen' },
    ),
  };
});

function baseContext() {
  return {
    blockedFeature: 'agents',
    completeThreePointZeroIntro: mockCompleteIntro,
    failureOperation: null,
    failureReason: null,
    paywallMode: 'purchase',
    isConfigured: true,
    isPro: false,
    paywallPackages: [{ packageIdentifier: 'annual', offeringIdentifier: 'pro' }],
    paywallPhase: 'ready',
    previewOnly: false,
    purchasePro: mockPurchasePro,
    refreshOfferings: mockRefreshOfferings,
    restorePurchases: mockRestorePurchases,
    selectPackage: mockSelectPackage,
    selectedPackage: { packageIdentifier: 'annual', offeringIdentifier: 'pro' },
    selectedPackageId: 'annual',
    snapshot: null,
  };
}

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

describe('ProPaywallOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = baseContext();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses a native full-screen modal presentation', () => {
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} />);
    expect(screen.getByTestId('pro-paywall-modal').props).toEqual(expect.objectContaining({
      animationType: 'slide',
      presentationStyle: 'fullScreen',
      allowSwipeDismissal: true,
    }));
  });

  it('reports the normalized cancellation reason without continuing', async () => {
    mockPurchasePro.mockResolvedValue({ success: false, reason: 'cancelled' });
    const onContinue = jest.fn();
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} onContinue={onContinue} />);

    act(() => {
      screen.getByTestId('mock-paywall-screen').props.onPurchase();
    });

    expect(mockAnalytics.paywallSubscribeTapped).toHaveBeenCalledWith(
      expect.objectContaining({ packageIdentifier: 'annual' }),
      expect.objectContaining({
        blocked_feature: 'agents',
        hero: 'agents',
        launch: false,
        preview_only: false,
        trigger_screen: 'roster',
        variant: 'contextual',
      }),
    );
    await waitFor(() => {
      expect(mockAnalytics.paywallPurchaseFailed).toHaveBeenCalledWith(
        expect.objectContaining({ packageIdentifier: 'annual' }),
        expect.objectContaining({
          blocked_feature: 'agents',
          hero: 'agents',
          launch: false,
          preview_only: false,
          reason: 'cancelled',
          trigger_screen: 'roster',
          variant: 'contextual',
        }),
      );
    });
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('atomically ignores same-frame purchase and restore submissions after the first tap', async () => {
    const purchaseResult = deferred<{ success: false; reason: 'cancelled' }>();
    mockPurchasePro.mockReturnValue(purchaseResult.promise);
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} />);
    const paywall = screen.getByTestId('mock-paywall-screen');

    act(() => {
      paywall.props.onPurchase();
      paywall.props.onPurchase();
      paywall.props.onRestore();
    });

    expect(mockPurchasePro).toHaveBeenCalledTimes(1);
    expect(mockRestorePurchases).not.toHaveBeenCalled();
    expect(mockAnalytics.paywallSubscribeTapped).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.paywallRestoreTapped).not.toHaveBeenCalled();

    await act(async () => {
      purchaseResult.resolve({ success: false, reason: 'cancelled' });
      await purchaseResult.promise;
    });
    expect(mockAnalytics.paywallPurchaseFailed).toHaveBeenCalledTimes(1);
  });

  it('tracks the complete purchase context plus dwell time and plan toggles', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const onClose = jest.fn();
    const screen = render(<ProPaywallOverlay visible onClose={onClose} />);

    expect(mockAnalytics.paywallViewed).toHaveBeenCalledWith(expect.objectContaining({
      blocked_feature: 'agents',
      hero: 'agents',
      launch: false,
      preview_only: false,
      trigger_screen: 'roster',
      variant: 'contextual',
    }));

    act(() => {
      screen.getByTestId('mock-paywall-screen').props.onSelectPackage('monthly');
    });
    now.mockReturnValue(6_500);
    act(() => {
      screen.getByTestId('mock-paywall-screen').props.onClose();
    });

    expect(mockAnalytics.paywallPackageSelected).toHaveBeenCalledWith(null, expect.objectContaining({
      blocked_feature: 'agents',
      hero: 'agents',
      launch: false,
      preview_only: false,
      trigger_screen: 'roster',
      variant: 'contextual',
    }));
    expect(mockAnalytics.paywallClosed).toHaveBeenCalledWith(expect.objectContaining({
      seconds_on_paywall: 6,
      plan_toggled: true,
      blocked_feature: 'agents',
      hero: 'agents',
      launch: false,
      preview_only: false,
      trigger_screen: 'roster',
      variant: 'contextual',
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the generic connection-ready paywall as a roster launch', () => {
    mockContext = { ...baseContext(), blockedFeature: 'launch' };
    render(<ProPaywallOverlay visible onClose={jest.fn()} />);

    expect(mockAnalytics.paywallViewed).toHaveBeenCalledWith(expect.objectContaining({
      blocked_feature: 'launch',
      hero: 'generic',
      launch: true,
      trigger_screen: 'roster',
      variant: 'generic',
    }));
  });

  it('passes the same contextual fields and normalized reason through restore analytics', async () => {
    mockRestorePurchases.mockResolvedValue({ success: false, reason: 'store_error:NETWORK_ERROR' });
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} />);

    act(() => {
      screen.getByTestId('mock-paywall-screen').props.onRestore();
    });

    expect(mockAnalytics.paywallRestoreTapped).toHaveBeenCalledWith(expect.objectContaining({
      hero: 'agents',
      launch: false,
      preview_only: false,
      trigger_screen: 'roster',
      variant: 'contextual',
    }));
    await waitFor(() => {
      expect(mockAnalytics.paywallRestoreFailed).toHaveBeenCalledWith(expect.objectContaining({
        hero: 'agents',
        launch: false,
        preview_only: false,
        reason: 'store_error:NETWORK_ERROR',
        trigger_screen: 'roster',
        variant: 'contextual',
      }));
    });
  });

  it('continues after the context completes its timed purchase success', async () => {
    mockPurchasePro.mockResolvedValue({ success: true, reason: null });
    const onContinue = jest.fn();
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} onContinue={onContinue} />);

    act(() => {
      screen.getByTestId('mock-paywall-screen').props.onPurchase();
    });

    await waitFor(() => {
      expect(mockAnalytics.paywallPurchaseSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({ packageIdentifier: 'annual' }),
        expect.objectContaining({
          blocked_feature: 'agents',
          hero: 'agents',
          launch: false,
          preview_only: false,
          trigger_screen: 'roster',
          variant: 'contextual',
        }),
      );
    });
    expect(onContinue).toHaveBeenCalledWith('purchase');
  });

  it('passes the purchase context through successful restore and continues', async () => {
    mockRestorePurchases.mockResolvedValue({ success: true, reason: null });
    const onContinue = jest.fn();
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} onContinue={onContinue} />);

    act(() => {
      screen.getByTestId('mock-paywall-screen').props.onRestore();
    });

    await waitFor(() => {
      expect(mockAnalytics.paywallRestoreSucceeded).toHaveBeenCalledWith(expect.objectContaining({
        blocked_feature: 'agents',
        hero: 'agents',
        launch: false,
        preview_only: false,
        trigger_screen: 'roster',
        variant: 'contextual',
      }));
    });
    expect(onContinue).toHaveBeenCalledWith('restore');
  });

  it('exposes a non-purchase 3.0 intro completion path', () => {
    mockContext = { ...baseContext(), paywallMode: 'threePointZeroIntro', blockedFeature: null };
    const onContinue = jest.fn();
    const screen = render(<ProPaywallOverlay visible onClose={jest.fn()} onContinue={onContinue} />);

    act(() => screen.getByTestId('mock-paywall-screen').props.onCompleteIntro());

    expect(mockAnalytics.paywallLaunchShown).toHaveBeenCalledWith({
      variant: 'three_point_zero_intro',
      first_run: false,
    });
    expect(mockAnalytics.paywallLaunchClosed).toHaveBeenCalledWith({
      variant: 'three_point_zero_intro',
      first_run: false,
    });
    expect(mockCompleteIntro).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith('threePointZeroIntro');
  });
});
