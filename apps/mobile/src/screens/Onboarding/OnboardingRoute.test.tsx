import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { OFFICIAL_PREVIEW_REGISTRY_URL, OFFICIAL_PRODUCTION_REGISTRY_URL } from '../../services/relay-environment';
import type { OnboardingScreenProps } from './OnboardingScreen';
import { OnboardingRoute, type OnboardingRouteProps } from './OnboardingRoute';

let mockScreenProps: OnboardingScreenProps | null = null;
let mockRuntime: Record<string, unknown>;
let mockApp: {
  gateway: {
    configure: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
  };
  debugMode: boolean;
  onSaved: jest.Mock;
};
let mockPro: Record<string, unknown>;
let mockScanner: Record<string, jest.Mock>;

const mockCoordinator = {
  syncLegacyConnections: jest.fn(),
  probeActive: jest.fn(async () => true),
};
const mockClaimRelayPairing: jest.Mock = jest.fn();
const mockCreateGatewayConfigFromScan: jest.Mock = jest.fn();
const mockToRuntimeConfig: jest.Mock = jest.fn((created: Record<string, unknown>, debugMode: boolean) => ({
  ...created,
  debugMode,
}));
const mockClipboardSetString = jest.fn(async (_value: string) => true);
const mockClipboardGetString = jest.fn(async () => '123456');
const mockOpenUrl = jest.fn(async (_url: string) => true);

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    View: ({ children, ...props }: { children?: React.ReactNode }) => ReactRuntime.createElement(
      'View',
      props,
      children,
    ),
  };
});

jest.mock('expo-clipboard', () => ({
  setStringAsync: (value: string) => mockClipboardSetString(value),
  getStringAsync: () => mockClipboardGetString(),
}));

jest.mock('expo-linking', () => ({
  openURL: (url: string) => mockOpenUrl(url),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockCoordinator,
  useConnections: () => mockRuntime,
}));

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => mockApp,
}));

jest.mock('../../contexts/GatewayScannerContext', () => ({
  useGatewayScanner: () => mockScanner,
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => mockPro,
}));

jest.mock('../../connection/pairing/gateway-scan-flow', () => ({
  claimRelayPairing: (...args: unknown[]) => mockClaimRelayPairing(...args),
  createGatewayConfigFromScan: (...args: unknown[]) => mockCreateGatewayConfigFromScan(...args),
  toRuntimeConfig: (...args: unknown[]) => mockToRuntimeConfig(...args),
}));

jest.mock('./OnboardingScreen', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    OnboardingScreen: (props: OnboardingScreenProps) => {
      mockScreenProps = props;
      return ReactRuntime.createElement(View, { testID: 'onboarding-route-view' });
    },
  };
});

function createProps(overrides: Partial<OnboardingRouteProps> = {}): OnboardingRouteProps {
  return {
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
    },
    route: {
      key: 'Onboarding-key',
      name: 'Onboarding',
      params: undefined,
    },
    ...overrides,
  } as unknown as OnboardingRouteProps;
}

function connectionSnapshot(input: {
  id?: string;
  backendKind?: 'openclaw' | 'hermes';
  state?: 'idle' | 'ready' | 'offline';
} = {}) {
  const id = input.id ?? 'connection-1';
  const backendKind = input.backendKind ?? 'openclaw';
  return {
    initialized: true,
    connections: [{ id, backendKind, transportKind: 'relay', label: 'Computer' }],
    activeConnectionId: id,
    activeState: input.state ?? 'ready',
    error: null,
  };
}

describe('OnboardingRoute', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockScreenProps = null;
    mockRuntime = {
      initialized: true,
      connections: [],
      activeConnectionId: null,
      activeState: 'idle',
      error: null,
    };
    mockApp = {
      gateway: {
        configure: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
      },
      debugMode: false,
      onSaved: jest.fn(),
    };
    mockPro = {
      isPro: false,
      requirePro: jest.fn(() => false),
    };
    mockScanner = {
      connectPairingCode: jest.fn(async () => true),
      connectPairingLink: jest.fn(async () => true),
      openGatewayScanner: jest.fn(),
    };
    mockCoordinator.syncLegacyConnections.mockReset();
    mockCoordinator.syncLegacyConnections.mockResolvedValue(connectionSnapshot({ state: 'idle' }));
    mockCoordinator.probeActive.mockClear();
    mockClaimRelayPairing.mockReset();
    mockClaimRelayPairing.mockImplementation(async (value) => value);
    mockCreateGatewayConfigFromScan.mockReset();
    mockCreateGatewayConfigFromScan.mockResolvedValue({
      created: {
        id: 'connection-1',
        backendKind: 'openclaw',
        transportKind: 'relay',
        url: 'wss://relay.example/ws',
      },
      nextConfigs: [],
    });
    mockToRuntimeConfig.mockClear();
    mockClipboardSetString.mockClear();
    mockClipboardGetString.mockClear();
    mockOpenUrl.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it('resolves an OpenClaw short code against Production and announces only a ready connection', async () => {
    const onConnected = jest.fn();
    const props = createProps({ onConnected });
    const view = render(<OnboardingRoute {...props} />);

    await act(async () => {
      await mockScreenProps?.onSubmitPairing({
        backendKind: 'openclaw',
        transportKind: 'relay',
        code: '123456',
      });
    });
    await waitFor(() => {
      expect(mockScanner.connectPairingCode).toHaveBeenCalledWith({
        serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
        pairingCode: '123456',
      });
      expect(mockScreenProps?.status).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
    });
    expect(onConnected).not.toHaveBeenCalled();

    mockRuntime = connectionSnapshot();
    view.rerender(<OnboardingRoute {...props} />);
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        connectionId: 'connection-1',
        backendKind: 'openclaw',
      });
    });
  });

  it('uses Preview in Debug Mode and returns unsupported for a Hermes short code', async () => {
    mockApp = { ...mockApp, debugMode: true };
    render(<OnboardingRoute {...createProps()} />);
    expect(mockScreenProps?.environment).toBe('preview');
    expect(mockScreenProps?.pairingCommand).toBe('npx @p697/clawket pair --preview');

    await act(async () => {
      await mockScreenProps?.onSubmitPairing({
        backendKind: 'hermes',
        transportKind: 'relay',
        code: '654321',
      });
    });
    await waitFor(() => {
      expect(mockScreenProps?.status).toEqual({ kind: 'error', code: 'unsupported' });
    });
    expect(mockScanner.connectPairingCode).not.toHaveBeenCalled();

    await act(async () => {
      await mockScreenProps?.onSubmitPairing({
        backendKind: 'openclaw',
        transportKind: 'relay',
        code: '654321',
      });
    });
    await waitFor(() => {
      expect(mockScanner.connectPairingCode).toHaveBeenCalledWith(expect.objectContaining({
        serverUrl: OFFICIAL_PREVIEW_REGISTRY_URL,
      }));
    });
  });

  it('consumes a valid route pairing link without choosing a root destination', async () => {
    const onConnected = jest.fn();
    const pairingUrl = `${OFFICIAL_PRODUCTION_REGISTRY_URL}/pair/ps_test#k=${'A'.repeat(43)}`;
    render(<OnboardingRoute {...createProps({
      route: {
        key: 'Onboarding-link',
        name: 'Onboarding',
        params: { pairingUrl },
      } as never,
      onConnected,
    })} />);

    await waitFor(() => {
      expect(mockScanner.connectPairingLink).toHaveBeenCalledWith(pairingUrl);
      expect(mockScreenProps?.status).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
    });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('rejects a QR that does not match the selected backend before claiming it', async () => {
    render(<OnboardingRoute {...createProps()} />);
    act(() => mockScreenProps?.onScanQr('hermes'));
    const options = mockScanner.openGatewayScanner.mock.calls[0][0];

    await act(async () => {
      await options.onScanned({
        url: 'wss://relay.example/ws',
        backendKind: 'openclaw',
        transportKind: 'relay',
        mode: 'relay',
        relay: {
          serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
          gatewayId: 'gateway-1',
          accessCode: 'secret',
        },
      });
    });

    expect(mockScreenProps?.status).toEqual({ kind: 'error', code: 'unsupported' });
    expect(mockClaimRelayPairing).not.toHaveBeenCalled();
    expect(mockCreateGatewayConfigFromScan).not.toHaveBeenCalled();
  });

  it('claims, saves, and starts a matching Hermes QR connection', async () => {
    const onConnected = jest.fn();
    mockCoordinator.syncLegacyConnections.mockResolvedValue(connectionSnapshot({
      id: 'hermes-1',
      backendKind: 'hermes',
      state: 'idle',
    }));
    mockCreateGatewayConfigFromScan.mockResolvedValue({
      created: {
        id: 'hermes-1',
        backendKind: 'hermes',
        transportKind: 'relay',
        url: 'wss://hermes-relay.example/ws',
      },
      nextConfigs: [],
    });
    const props = createProps({ onConnected });
    const view = render(<OnboardingRoute {...props} />);
    act(() => mockScreenProps?.onScanQr('hermes'));
    const options = mockScanner.openGatewayScanner.mock.calls[0][0];
    const qr = {
      url: 'wss://hermes-relay.example/ws',
      backendKind: 'hermes' as const,
      transportKind: 'relay' as const,
      mode: 'hermes' as const,
      relay: {
        serverUrl: 'https://hermes-registry.example',
        gatewayId: 'bridge-1',
        accessCode: 'secret',
      },
    };

    await act(async () => {
      await options.onScanned(qr);
    });
    expect(mockClaimRelayPairing).toHaveBeenCalledWith(qr, expect.anything());
    expect(mockCreateGatewayConfigFromScan).toHaveBeenCalledWith({
      payload: qr,
      debugMode: false,
    });
    expect(mockApp.onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'hermes-1', debugMode: false }),
      'cfg:hermes-1',
    );
    expect(mockApp.gateway.disconnect).toHaveBeenCalledTimes(1);
    expect(mockApp.gateway.configure).toHaveBeenCalledTimes(1);
    expect(mockApp.gateway.connect).toHaveBeenCalledTimes(1);

    mockRuntime = connectionSnapshot({ id: 'hermes-1', backendKind: 'hermes' });
    view.rerender(<OnboardingRoute {...props} />);
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        connectionId: 'hermes-1',
        backendKind: 'hermes',
      });
    });
  });

  it('uses the Pro gate before opening an additional connection flow', () => {
    mockRuntime = connectionSnapshot();
    render(<OnboardingRoute {...createProps()} />);
    act(() => mockScreenProps?.onScanQr('openclaw'));
    expect(mockPro.requirePro).toHaveBeenCalledWith('gatewayConnections');
    expect(mockScanner.openGatewayScanner).not.toHaveBeenCalled();
  });

  it('binds clipboard, official docs, YouMind, modal close, and offline retry', async () => {
    const onOpenYouMind = jest.fn();
    const onDocsOpened = jest.fn();
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    mockRuntime = connectionSnapshot({ state: 'offline' });
    const props = createProps({
      navigation: navigation as never,
      route: {
        key: 'Onboarding-key',
        name: 'Onboarding',
        params: { presentation: 'modal' },
      } as never,
      onOpenYouMind,
      onDocsOpened,
    });
    render(<OnboardingRoute {...props} />);
    expect(mockScreenProps?.status).toEqual({ kind: 'offline' });

    await act(async () => {
      await mockScreenProps?.onCopyCommand?.('copy me');
      await mockScreenProps?.onPastePairingCode?.('openclaw');
    });
    expect(mockClipboardSetString).toHaveBeenCalledWith('copy me');
    expect(mockClipboardGetString).toHaveBeenCalledTimes(1);
    act(() => mockScreenProps?.onOpenDocs('openclaw'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://docs.openclaw.ai/install');
    expect(onDocsOpened).toHaveBeenCalledWith('openclaw');
    act(() => mockScreenProps?.onOpenYouMind());
    expect(onOpenYouMind).toHaveBeenCalledTimes(1);
    act(() => mockScreenProps?.onClose?.());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    act(() => mockScreenProps?.onRetry?.());
    expect(mockCoordinator.probeActive).toHaveBeenCalledTimes(1);
  });
});
