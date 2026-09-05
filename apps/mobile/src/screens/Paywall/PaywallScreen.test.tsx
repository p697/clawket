import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PaywallScreen } from './PaywallScreen';
import type { ProPaywallPackage } from '../../services/pro-subscription';

const mockTheme = {
  scheme: 'light',
  colors: {
    canvas: '#canvas', canvasGrouped: '#grouped', surface: '#surface', surfaceFloating: '#floating',
    ink: '#ink', inkSecondary: '#secondary', inkTertiary: '#tertiary', line: '#line', accent: '#accent',
    accentSoft: '#accent-soft', onAccent: '#on-accent', scrim: '#scrim', good: '#good', goodSoft: '#good-soft',
    warn: '#warn', warnSoft: '#warn-soft', bad: '#bad', badSoft: '#bad-soft',
  },
};

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const flatten = (style: unknown): Record<string, unknown> => {
    if (!Array.isArray(style)) return (style ?? {}) as Record<string, unknown>;
    return Object.assign({}, ...style.filter(Boolean).map(flatten));
  };
  const primitive = (name: string) => ({ children, style, ...props }: Record<string, unknown>) => ReactRuntime.createElement(
    name,
    { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style },
    children,
  );
  return {
    ActivityIndicator: primitive('ActivityIndicator'),
    Platform: { OS: 'ios' },
    Pressable: primitive('Pressable'),
    ScrollView: primitive('ScrollView'),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, flatten },
    Text: primitive('Text'),
    View: primitive('View'),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));

jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => {
    if (key === '__esModule') return true;
    const ReactRuntime = require('react');
    return (props: Record<string, unknown>) => ReactRuntime.createElement(String(key), props);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => Object.entries(options ?? {})
      .reduce((value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)), key),
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../components/ui/AgentAvatar', () => ({
  AgentAvatar: (props: Record<string, unknown>) => {
    const ReactRuntime = require('react');
    return ReactRuntime.createElement('AgentAvatar', props);
  },
}));

function aPackage(
  packageType: 'ANNUAL' | 'LIFETIME' | 'MONTHLY',
  price: number,
  priceString: string,
  socialProof = true,
): ProPaywallPackage {
  return {
    offeringIdentifier: 'pro',
    packageIdentifier: packageType.toLowerCase(),
    packageType,
    productIdentifier: packageType.toLowerCase(),
    title: packageType,
    description: packageType,
    price,
    priceString,
    pricePerMonth: packageType === 'ANNUAL' ? price / 12 : packageType === 'MONTHLY' ? price : null,
    pricePerMonthString: packageType === 'ANNUAL' ? '$2.00' : packageType === 'MONTHLY' ? priceString : null,
    offeringMetadata: { defaultPackage: 'annual', socialProof },
    package: {} as ProPaywallPackage['package'],
  };
}

const PACKAGES = [
  aPackage('MONTHLY', 3, '$3.00'),
  aPackage('LIFETIME', 49.99, '$49.99'),
  aPackage('ANNUAL', 24, '$24.00'),
];

const callbacks = {
  onClose: jest.fn(),
  onRestore: jest.fn(),
  onRetry: jest.fn(),
  onSelectPackage: jest.fn(),
  onPurchase: jest.fn(),
  onCompleteIntro: jest.fn(),
  onOpenTerms: jest.fn(),
  onOpenPrivacy: jest.fn(),
};

function renderPaywall(overrides: Partial<React.ComponentProps<typeof PaywallScreen>> = {}) {
  return render(
    <PaywallScreen
      mode="purchase"
      blockedFeature={null}
      phase="ready"
      packages={PACKAGES}
      selectedPackageId="annual"
      failureReason={null}
      failureOperation={null}
      {...callbacks}
      {...overrides}
    />,
  );
}

describe('PaywallScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTheme.scheme = 'light';
    mockTheme.colors.canvas = '#canvas';
  });

  it.each([
    ['light', '#light-canvas'],
    ['dark', '#dark-canvas'],
  ])('renders the full-screen generic paywall in the %s theme', (scheme, canvas) => {
    mockTheme.scheme = scheme;
    mockTheme.colors.canvas = canvas;
    const screen = renderPaywall();

    expect(screen.getByTestId('paywall-screen').props.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ flex: 1, backgroundColor: canvas }),
    ]));
    expect(screen.getByTestId('paywall-hero-generic')).toBeTruthy();
    expect(screen.getByText('Every Agent in your pocket')).toBeTruthy();
    expect(screen.getByText('$2.00 / month · Save 33%')).toBeTruthy();
    expect(screen.getByText('Unlock Pro · $24.00 / year')).toBeTruthy();
    expect(screen.getByTestId('paywall-plan-annual').props.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ borderWidth: 2, borderColor: '#accent', backgroundColor: '#accent-soft' }),
    ]));
  });

  it('keeps monthly hidden until requested, then exposes it for selection', () => {
    const screen = renderPaywall();
    expect(screen.queryByTestId('paywall-plan-monthly')).toBeNull();
    fireEvent.press(screen.getByTestId('paywall-show-monthly'));
    fireEvent.press(screen.getByTestId('paywall-plan-monthly'));
    expect(callbacks.onSelectPackage).toHaveBeenCalledWith('monthly');
  });

  it('reveals monthly immediately when offering metadata selects it by default', () => {
    const monthlyDefaultPackages = PACKAGES.map((item) => ({
      ...item,
      offeringMetadata: { ...item.offeringMetadata, defaultPackage: 'monthly' as const },
    }));
    const screen = renderPaywall({
      packages: monthlyDefaultPackages,
      selectedPackageId: 'monthly',
    });
    expect(screen.getByTestId('paywall-plan-monthly')).toBeTruthy();
  });

  it('renders contextual copy and a price-free continue action', () => {
    const screen = renderPaywall({ blockedFeature: 'agents' });
    expect(screen.getByTestId('paywall-hero-agents')).toBeTruthy();
    expect(screen.getByText('Bring every Agent into the roster')).toBeTruthy();
    expect(screen.getByText('Unlock Pro to continue with this Agent')).toBeTruthy();
    expect(screen.getByTestId('paywall-benefits').children).toHaveLength(3);
  });

  it.each([
    ['gatewayConnections', 'paywall-hero-connections-link'],
    ['agents', 'paywall-hero-agents-cluster'],
    ['openclawDiagnostics', 'paywall-hero-manage-repair-loop'],
    ['logs', 'paywall-hero-logs-files-stack'],
    ['messageHistory', 'paywall-hero-search-results'],
    [null, 'paywall-hero-generic-control-tower'],
  ] as const)('renders an independent illustration for the %s trigger', (blockedFeature, marker) => {
    const screen = renderPaywall({ blockedFeature });
    expect(screen.getByTestId(marker)).toBeTruthy();
  });

  it('honors social_proof false and keeps a cancelled purchase silent', () => {
    const hiddenSocialPackages = PACKAGES.map((item) => ({
      ...item,
      offeringMetadata: { ...item.offeringMetadata, socialProof: false },
    }));
    const screen = renderPaywall({
      packages: hiddenSocialPackages,
      failureReason: 'cancelled',
      failureOperation: 'purchase',
    });
    expect(screen.queryByTestId('paywall-social-proof')).toBeNull();
    expect(screen.queryByTestId('paywall-failure')).toBeNull();
  });

  it('renders offering loading, unavailable retry, and store failure states', () => {
    const loading = renderPaywall({ phase: 'loading', packages: [], selectedPackageId: null });
    expect(loading.getByTestId('paywall-plan-skeletons')).toBeTruthy();
    loading.unmount();

    const unavailable = renderPaywall({
      phase: 'unavailable',
      packages: [],
      selectedPackageId: null,
      failureReason: 'offerings_unavailable',
      failureOperation: 'purchase',
    });
    expect(unavailable.getByTestId('paywall-offerings-unavailable')).toBeTruthy();
    expect(unavailable.queryByTestId('paywall-failure')).toBeNull();
    fireEvent.press(unavailable.getByText('Retry'));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
    unavailable.unmount();

    const failed = renderPaywall({
      phase: 'failure',
      failureReason: 'store_error:ITEM_UNAVAILABLE',
      failureOperation: 'purchase',
    });
    expect(failed.getByText('Unable to complete your purchase right now.')).toBeTruthy();
  });

  it('renders the reusable 3.0 intro with four changes and no purchase plans', () => {
    const screen = renderPaywall({ mode: 'threePointZeroIntro', packages: [] });
    expect(screen.getByText('Clawket 3.0')).toBeTruthy();
    expect(screen.getByText('Every Agent and session in one roster')).toBeTruthy();
    expect(screen.getByTestId('paywall-benefits').children).toHaveLength(4);
    expect(screen.queryByTestId('paywall-plan-annual')).toBeNull();
    fireEvent.press(screen.getByTestId('paywall-intro-continue'));
    expect(callbacks.onCompleteIntro).toHaveBeenCalledTimes(1);
  });
});
