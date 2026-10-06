import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  GatewayScannerProvider,
  useGatewayScanner,
} from './GatewayScannerContext';
import {
  OFFICIAL_PREVIEW_REGISTRY_URL,
  OFFICIAL_PRODUCTION_REGISTRY_URL,
} from '../services/relay-environment';

const mockRuntime = { id: 'coordinator' };
const mockShowOverlay = jest.fn();
const mockHideOverlay = jest.fn();
const mockSavePairedConnection = jest.fn();
const mockClaimRelayPairing = jest.fn();
const mockLaunchImageLibrary = jest.fn();
const mockScanFromUrl = jest.fn();
const mockResolvePairingCode = jest.fn();
const mockResolvePairingLink = jest.fn();
const mockGetCameraPermissions = jest.fn();
let mockPendingAddGateway = false;
const mockClearPendingAddGateway = jest.fn(() => { mockPendingAddGateway = false; });
let mockScannerScreenProps: { onChoosePhoto?: () => void } | null = null;
let scanner: ReturnType<typeof useGatewayScanner> | null = null;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    Alert: { alert: jest.fn() },
    Linking: { openSettings: jest.fn() },
    Modal: ({ children, visible }: { children?: React.ReactNode; visible: boolean }) => ReactRuntime.createElement(
      'Modal',
      { testID: 'gateway-scanner-modal', visible },
      children,
    ),
    Platform: { OS: 'ios', isMacCatalyst: false },
    StyleSheet: {
      flatten: (style: unknown) => Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : style ?? {},
    },
  };
});

jest.mock('../connection', () => ({
  getConnectionRuntime: () => mockRuntime,
}));

jest.mock('./AppContext', () => ({
  useAppContext: () => ({
    pendingAddGateway: mockPendingAddGateway,
    clearPendingAddGateway: mockClearPendingAddGateway,
    debugMode: true,
  }),
}));

jest.mock('./GatewayOverlayContext', () => ({
  useGatewayOverlay: () => ({
    showOverlay: mockShowOverlay,
    hideOverlay: mockHideOverlay,
  }),
}));

jest.mock('../connection/pairing/save-paired-connection', () => ({
  savePairedConnection: (...args: unknown[]) => mockSavePairedConnection(...args),
}));

jest.mock('../connection/pairing/gateway-scan-flow', () => ({
  ...jest.requireActual('../connection/pairing/gateway-scan-flow'),
  claimRelayPairing: (...args: unknown[]) => mockClaimRelayPairing(...args),
}));

jest.mock('../connection/pairing/QRScannerScreen', () => ({
  QRScannerScreen: (props: { onChoosePhoto?: () => void }) => {
    mockScannerScreenProps = props;
    return null;
  },
}));

jest.mock('../components/ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  return {
    ConfirmationModal: ({
      visible,
      testID,
      onClose,
      onConfirm,
    }: {
      visible: boolean;
      testID: string;
      onClose: () => void;
      onConfirm: () => void;
    }) => visible
      ? ReactRuntime.createElement(
        'ConfirmationModal',
        { testID },
        ReactRuntime.createElement('ConfirmationCancel', {
          testID: `${testID}-cancel`,
          onPress: onClose,
        }),
        ReactRuntime.createElement('ConfirmationConfirm', {
          testID: `${testID}-confirm`,
          onPress: onConfirm,
        }),
      )
      : null,
  };
});

jest.mock('../services/pairing-session', () => {
  const actual = jest.requireActual('../services/pairing-session');
  return {
    ...actual,
    resolvePairingCode: (...args: unknown[]) => mockResolvePairingCode(...args),
    resolvePairingLink: (...args: unknown[]) => mockResolvePairingLink(...args),
  };
});

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

jest.mock('expo-camera', () => ({
  Camera: {
    scanFromURLAsync: (...args: unknown[]) => mockScanFromUrl(...args),
    getCameraPermissionsAsync: () => mockGetCameraPermissions(),
  },
}));

function CaptureScanner(): null {
  scanner = useGatewayScanner();
  return null;
}

describe('GatewayScannerProvider pairing persistence', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    scanner = null;
    mockPendingAddGateway = false;
    mockClearPendingAddGateway.mockClear();
    mockScannerScreenProps = null;
    mockGetCameraPermissions.mockReset();
    mockGetCameraPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockShowOverlay.mockReset();
    mockHideOverlay.mockReset();
    mockSavePairedConnection.mockReset();
    mockSavePairedConnection.mockResolvedValue({
      connection: { id: 'stable-connection' },
      created: false,
      probeSucceeded: true,
    });
    mockClaimRelayPairing.mockReset();
    mockLaunchImageLibrary.mockReset();
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///pairing.png' }],
    });
    mockScanFromUrl.mockReset();
    mockResolvePairingCode.mockReset();
    mockResolvePairingLink.mockReset();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  it('claims a legacy Relay QR read from a photo in the add-connection scanner and saves it', async () => {
    const claimed = {
      url: 'wss://relay.example/ws',
      backendKind: 'openclaw' as const,
      transportKind: 'relay' as const,
      mode: 'relay' as const,
      relay: {
        serverUrl: 'https://registry.example',
        gatewayId: 'gateway-1',
        clientToken: 'client-token',
      },
    };
    mockScanFromUrl.mockResolvedValue([{
      data: JSON.stringify({
        kind: 'clawket_pair',
        version: 1,
        server: 'https://registry.example',
        gatewayId: 'gateway-1',
        accessCode: 'legacy-access-code',
        relayUrl: 'wss://relay.example/ws',
      }),
    }]);
    mockClaimRelayPairing.mockResolvedValue(claimed);
    mockPendingAddGateway = true;
    const view = render(
      <GatewayScannerProvider>
        <CaptureScanner />
      </GatewayScannerProvider>,
    );

    // A pending add-connection request opens the camera; its photo action reads the saved QR instead.
    await waitFor(() => expect(view.getByTestId('gateway-scanner-modal').props.visible).toBe(true));
    expect(mockClearPendingAddGateway).toHaveBeenCalledTimes(1);
    act(() => mockScannerScreenProps?.onChoosePhoto?.());

    await waitFor(() => {
      expect(mockClaimRelayPairing).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'wss://relay.example/ws',
          relay: expect.objectContaining({
            gatewayId: 'gateway-1',
            accessCode: 'legacy-access-code',
          }),
        }),
        expect.anything(),
      );
      expect(mockSavePairedConnection).toHaveBeenCalledWith({
        runtime: mockRuntime,
        payload: claimed,
        debugMode: true,
        source: 'gateway_scanner',
      });
    });
    expect(mockShowOverlay).toHaveBeenCalledTimes(1);
    expect(mockHideOverlay).toHaveBeenCalledTimes(1);
  });

  it('closes the camera before the photo library opens and keeps the opener callbacks', async () => {
    mockScanFromUrl.mockResolvedValue([{
      data: JSON.stringify({
        kind: 'clawket_pair',
        version: 1,
        server: 'https://registry.example',
        gatewayId: 'gateway-1',
        accessCode: 'legacy-access-code',
        relayUrl: 'wss://relay.example/ws',
      }),
    }]);
    const onScanned = jest.fn();
    const onCancel = jest.fn();
    const view = render(
      <GatewayScannerProvider>
        <CaptureScanner />
      </GatewayScannerProvider>,
    );
    const modal = () => view.getByTestId('gateway-scanner-modal');

    await act(async () => {
      await scanner?.openGatewayScanner({ onScanned, onCancel });
    });
    expect(modal().props.visible).toBe(true);
    act(() => mockScannerScreenProps?.onChoosePhoto?.());
    // The native picker never presents over the closing scanner.
    expect(modal().props.visible).toBe(false);
    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    await waitFor(() => expect(onScanned).toHaveBeenCalledWith(expect.objectContaining({
      relay: expect.objectContaining({ gatewayId: 'gateway-1', accessCode: 'legacy-access-code' }),
    })));
    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    // Dismissing the library reports the opener's cancellation, as closing the scanner would.
    mockLaunchImageLibrary.mockResolvedValueOnce({ canceled: true, assets: [] });
    await act(async () => {
      await scanner?.openGatewayScanner({ onScanned, onCancel });
    });
    act(() => mockScannerScreenProps?.onChoosePhoto?.());
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onScanned).toHaveBeenCalledTimes(1);
    // Neither path claims or saves anything on the opener's behalf.
    expect(mockClaimRelayPairing).not.toHaveBeenCalled();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });

  it('requires app-owned confirmation before accepting secure pairing', async () => {
    const rawQrPayload = JSON.stringify({
      kind: 'clawket_pair',
      version: 1,
      server: 'https://registry.example',
      gatewayId: 'gateway-1',
      accessCode: 'legacy-access-code',
      relayUrl: 'wss://relay.example/ws',
      displayName: 'Studio',
    });
    mockResolvePairingCode.mockResolvedValue({
      rawQrPayload,
      displayName: 'Studio',
      serverUrl: 'https://registry.example',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    mockClaimRelayPairing.mockResolvedValue({
      url: 'wss://relay.example/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example',
        gatewayId: 'gateway-1',
        clientToken: 'client-token',
      },
    });
    const view = render(
      <GatewayScannerProvider>
        <CaptureScanner />
      </GatewayScannerProvider>,
    );

    let cancelledPairing: Promise<boolean> | undefined;
    await act(async () => {
      cancelledPairing = scanner?.connectPairingCode({
        serverUrl: 'https://registry.example',
        pairingCode: '123456',
      });
      await Promise.resolve();
    });
    expect(view.getByTestId('gateway-secure-pairing-confirmation')).toBeTruthy();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('gateway-secure-pairing-confirmation-cancel'));
    await expect(cancelledPairing).resolves.toBe(false);
    expect(view.queryByTestId('gateway-secure-pairing-confirmation')).toBeNull();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();

    let acceptedPairing: Promise<boolean> | undefined;
    await act(async () => {
      acceptedPairing = scanner?.connectPairingCode({
        serverUrl: 'https://registry.example',
        pairingCode: '123456',
      });
      await Promise.resolve();
    });
    fireEvent.press(view.getByTestId('gateway-secure-pairing-confirmation-confirm'));
    await expect(acceptedPairing).resolves.toBe(true);
    expect(mockSavePairedConnection).toHaveBeenCalledWith({
      runtime: mockRuntime,
      payload: expect.objectContaining({
        url: 'wss://relay.example/ws',
        transportKind: 'relay',
      }),
      debugMode: true,
      source: 'gateway_scanner',
    });
    expect(view.queryByTestId('gateway-secure-pairing-confirmation')).toBeNull();
  });

  it('rejects a decrypted link for the wrong backend before confirmation or persistence', async () => {
    mockResolvePairingLink.mockResolvedValue({
      rawQrPayload: JSON.stringify({
        kind: 'clawket_hermes_pair',
        version: 1,
        server: OFFICIAL_PRODUCTION_REGISTRY_URL,
        bridgeId: 'hermes-bridge',
        accessCode: 'ABC234',
        relayUrl: 'wss://hermes-relay.example/ws',
      }),
      displayName: 'Unexpected Hermes',
      serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const view = render(
      <GatewayScannerProvider>
        <CaptureScanner />
      </GatewayScannerProvider>,
    );
    const url = `${OFFICIAL_PRODUCTION_REGISTRY_URL}/pair/ps_test#k=${'A'.repeat(43)}`;

    await expect(scanner?.connectPairingLink(url, {
      expectedBackendKind: 'openclaw',
      environment: 'production',
    })).resolves.toBe(false);

    expect(view.queryByTestId('gateway-secure-pairing-confirmation')).toBeNull();
    expect(mockClaimRelayPairing).not.toHaveBeenCalled();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });

  it('rejects a decrypted payload from another official environment before persistence', async () => {
    mockResolvePairingCode.mockResolvedValue({
      rawQrPayload: JSON.stringify({
        kind: 'clawket_pair',
        version: 1,
        server: OFFICIAL_PRODUCTION_REGISTRY_URL,
        gatewayId: 'gateway-1',
        accessCode: '123456',
        relayUrl: 'wss://relay.example/ws',
      }),
      displayName: 'Production computer',
      serverUrl: OFFICIAL_PREVIEW_REGISTRY_URL,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const view = render(
      <GatewayScannerProvider>
        <CaptureScanner />
      </GatewayScannerProvider>,
    );

    await expect(scanner?.connectPairingCode({
      serverUrl: OFFICIAL_PREVIEW_REGISTRY_URL,
      pairingCode: '123456',
      expectedBackendKind: 'openclaw',
      environment: 'preview',
    })).resolves.toBe(false);

    expect(view.queryByTestId('gateway-secure-pairing-confirmation')).toBeNull();
    expect(mockClaimRelayPairing).not.toHaveBeenCalled();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });
});
