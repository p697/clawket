import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import type { OnboardingScreenProps } from './OnboardingScreen';
import { OnboardingRoute, type OnboardingRouteProps } from './OnboardingRoute';

let mockScreenProps: OnboardingScreenProps | null = null;
let mockRuntime: Record<string, unknown>;
let mockApp: {
  debugMode: boolean;
};
let mockPro: Record<string, unknown>;
let mockScanner: Record<string, jest.Mock>;

const mockCoordinator = {
  getSnapshot: jest.fn(),
  probeActive: jest.fn(async () => true),
};
const mockConnectBackendPairingCode: jest.Mock = jest.fn();
const mockConnectBackendPairingLink: jest.Mock = jest.fn();
const mockConnectBackendPairingPayload: jest.Mock = jest.fn();
const mockClipboardSetString = jest.fn(async (_value: string) => true);
const mockClipboardGetString = jest.fn(async () => '123456');
const mockOpenUrl = jest.fn(async (_url: string) => true);
const mockShowNoticeAlert = jest.fn();

jest.mock('./WelcomeScreen', () => ({ WelcomeScreen: () => null }));

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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../utils/notice-alert', () => ({
  showNoticeAlert: (...args: unknown[]) => mockShowNoticeAlert(...args),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => mockCoordinator,
  useConnections: () => mockRuntime,
  connectBackendPairingCode: (...args: unknown[]) => mockConnectBackendPairingCode(...args),
  connectBackendPairingLink: (...args: unknown[]) => mockConnectBackendPairingLink(...args),
  connectBackendPairingPayload: (...args: unknown[]) => mockConnectBackendPairingPayload(...args),
  // The real resolver is covered in gateway-scan-flow tests; the route only forwards its answer.
  resolvePairingPayloadBackend: (payload: { backendKind?: string }) => payload.backendKind ?? null,
  resolvePairingValidationReason: jest.requireActual('../../connection/pairing/pairing-validation').resolvePairingValidationReason,
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
      params: { initialBackend: 'openclaw' },
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
    mockApp = { debugMode: false };
    mockPro = {
      isPro: false,
      requirePro: jest.fn(() => false),
    };
    mockScanner = {
      connectPairingCode: jest.fn(async () => true),
      connectPairingLink: jest.fn(async () => true),
      openGatewayScanner: jest.fn(),
    };
    mockCoordinator.getSnapshot.mockReset();
    mockCoordinator.getSnapshot.mockReturnValue(connectionSnapshot({ state: 'idle' }));
    mockCoordinator.probeActive.mockClear();
    mockConnectBackendPairingCode.mockReset();
    mockConnectBackendPairingCode.mockResolvedValue({
      backendKind: 'openclaw',
      connectionId: 'connection-1',
    });
    mockConnectBackendPairingLink.mockReset();
    mockConnectBackendPairingLink.mockResolvedValue({
      backendKind: 'openclaw',
      connectionId: 'connection-1',
    });
    mockConnectBackendPairingPayload.mockReset();
    mockConnectBackendPairingPayload.mockResolvedValue({
      backendKind: 'openclaw',
      connectionId: 'connection-1',
    });
    mockClipboardSetString.mockClear();
    mockClipboardGetString.mockClear();
    mockOpenUrl.mockClear();
    mockShowNoticeAlert.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it('returns to an editable form after invitation feedback without announcing a connection or false expiry', async () => {
    mockConnectBackendPairingCode.mockResolvedValue(null);
    const onConnected = jest.fn();
    render(<OnboardingRoute {...createProps({ onConnected })} />);
    await act(async () => {
      await mockScreenProps?.onSubmitPairing({ backendKind: 'openclaw', transportKind: 'relay', code: '123456' });
    });
    expect(mockScreenProps?.status).toEqual({ kind: 'idle' });
    expect(onConnected).not.toHaveBeenCalled();
  });

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
      expect(mockConnectBackendPairingCode).toHaveBeenCalledWith({
        backendKind: 'openclaw',
        environment: 'production',
        debugMode: false,
        runtime: mockCoordinator,
        pairingCode: '123456',
        secureInvitation: {
          connectCode: mockScanner.connectPairingCode,
          connectLink: mockScanner.connectPairingLink,
        },
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

  it('admits only one pairing operation while submission is in flight', async () => {
    let resolvePairing: ((value: {
      backendKind: 'hermes';
      connectionId: string;
    }) => void) | undefined;
    mockConnectBackendPairingCode.mockImplementation(() => new Promise((resolve) => {
      resolvePairing = resolve;
    }));
    mockCoordinator.getSnapshot.mockReturnValue(connectionSnapshot({
      id: 'hermes-connection',
      backendKind: 'hermes',
      state: 'idle',
    }));
    render(<OnboardingRoute {...createProps()} />);

    act(() => {
      mockScreenProps?.onSubmitPairing({
        backendKind: 'hermes',
        transportKind: 'relay',
        code: 'ABC234',
      });
      mockScreenProps?.onSubmitPairing({
        backendKind: 'hermes',
        transportKind: 'relay',
        code: 'ABC234',
      });
    });
    expect(mockConnectBackendPairingCode).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePairing?.({
        backendKind: 'hermes',
        connectionId: 'hermes-connection',
      });
    });
    await waitFor(() => {
      expect(mockConnectBackendPairingCode).toHaveBeenCalledTimes(1);
      expect(mockScreenProps?.status).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
    });
  });

  it('uses the isolated Preview Registry for a Hermes pairing code', async () => {
    mockApp = { ...mockApp, debugMode: true };
    mockConnectBackendPairingCode.mockResolvedValue({
      backendKind: 'hermes',
      connectionId: 'hermes-code-1',
    });
    mockCoordinator.getSnapshot.mockReturnValue(connectionSnapshot({
      id: 'hermes-code-1',
      backendKind: 'hermes',
      state: 'idle',
    }));
    render(<OnboardingRoute {...createProps()} />);
    expect(mockScreenProps?.environment).toBe('preview');
    expect(mockScreenProps?.pairingCommand).toBe('npx @p697/clawket@latest pair --preview');

    await act(async () => {
      await mockScreenProps?.onSubmitPairing({
        backendKind: 'hermes',
        transportKind: 'relay',
        code: 'ABC234',
      });
    });
    await waitFor(() => {
      expect(mockConnectBackendPairingCode).toHaveBeenCalledWith({
        backendKind: 'hermes',
        environment: 'preview',
        debugMode: true,
        runtime: mockCoordinator,
        pairingCode: 'ABC234',
        secureInvitation: {
          connectCode: mockScanner.connectPairingCode,
          connectLink: mockScanner.connectPairingLink,
        },
      });
      expect(mockScreenProps?.status).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
    });
    expect(mockScanner.connectPairingCode).not.toHaveBeenCalled();
  });

  it('consumes a valid route pairing link without choosing a root destination', async () => {
    const onConnected = jest.fn();
    const pairingUrl = `https://registry.clawket.ai/pair/ps_test#k=${'A'.repeat(43)}`;
    render(<OnboardingRoute {...createProps({
      route: {
        key: 'Onboarding-link',
        name: 'Onboarding',
        params: { pairingUrl },
      } as never,
      onConnected,
    })} />);

    await waitFor(() => {
      expect(mockConnectBackendPairingLink).toHaveBeenCalledWith({
        backendKind: 'openclaw',
        environment: 'production',
        debugMode: false,
        runtime: mockCoordinator,
        url: pairingUrl,
        secureInvitation: {
          connectCode: mockScanner.connectPairingCode,
          connectLink: mockScanner.connectPairingLink,
        },
      });
      expect(mockScreenProps?.status).toEqual({ kind: 'connecting', phase: 'waiting_bridge' });
    });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('delegates an unsupported Hermes pairing link to the backend profile', async () => {
    const pairingUrl = `https://registry.clawket.ai/pair/ps_test#k=${'A'.repeat(43)}`;
    mockConnectBackendPairingLink.mockRejectedValueOnce({ code: 'unsupported' });
    render(<OnboardingRoute {...createProps({
      route: {
        key: 'Onboarding-hermes-link',
        name: 'Onboarding',
        params: { initialBackend: 'hermes', pairingUrl },
      } as never,
    })} />);

    await waitFor(() => {
      expect(mockScreenProps?.status).toEqual({ kind: 'error', code: 'unsupported' });
    });
    expect(mockConnectBackendPairingLink).toHaveBeenCalledWith(expect.objectContaining({
      backendKind: 'hermes',
      url: pairingUrl,
    }));
  });

  it('rejects a QR that does not match the selected backend before claiming it', async () => {
    const onScanQrTapped = jest.fn();
    mockConnectBackendPairingPayload.mockRejectedValueOnce({ code: 'unsupported' });
    render(<OnboardingRoute {...createProps({ onScanQrTapped })} />);
    act(() => mockScreenProps?.onScanQr('hermes'));
    expect(onScanQrTapped).toHaveBeenCalledWith('hermes');
    const options = mockScanner.openGatewayScanner.mock.calls[0][0];

    await act(async () => {
      await options.onScanned({
        url: 'wss://relay.example/ws',
        backendKind: 'openclaw',
        transportKind: 'relay',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.clawket.ai',
          gatewayId: 'gateway-1',
          accessCode: 'secret',
        },
      });
    });

    expect(mockScreenProps?.status).toEqual({ kind: 'error', code: 'unsupported' });
    expect(mockConnectBackendPairingPayload).toHaveBeenCalledWith(expect.objectContaining({
      runtime: mockCoordinator,
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
    }));
  });

  it('claims, saves, and starts a matching Hermes QR connection', async () => {
    const onConnected = jest.fn();
    mockCoordinator.getSnapshot.mockReturnValue(connectionSnapshot({
      id: 'hermes-1',
      backendKind: 'hermes',
      state: 'idle',
    }));
    mockConnectBackendPairingPayload.mockResolvedValue({
      backendKind: 'hermes',
      connectionId: 'hermes-1',
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
    expect(mockConnectBackendPairingPayload).toHaveBeenCalledWith({
      runtime: mockCoordinator,
      payload: qr,
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
    });

    mockRuntime = connectionSnapshot({ id: 'hermes-1', backendKind: 'hermes' });
    view.rerender(<OnboardingRoute {...props} />);
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        connectionId: 'hermes-1',
        backendKind: 'hermes',
      });
    });
  });

  it('keeps the fixed local validation reason when the first QR fails immediately', async () => {
    mockConnectBackendPairingPayload.mockRejectedValueOnce({ code: 'unsupported', pairingReason: 'official_environment_mismatch', message: 'private detail' });
    render(<OnboardingRoute {...createProps()} />);
    act(() => mockScreenProps?.onScanQr('openclaw'));
    await act(async () => {
      await mockScanner.openGatewayScanner.mock.calls[0][0].onScanned({ url: '', mode: 'relay', relay: { serverUrl: 'https://registry.clawket.ai', gatewayId: 'gateway', accessCode: 'synthetic' } });
    });
    expect(mockScreenProps?.status).toEqual({ kind: 'error', code: 'unsupported', pairingReason: 'official_environment_mismatch' });
  });

  // A photo chosen inside the scanner returns through these same callbacks (GatewayScannerContext tests).
  it.each([
    ['openclaw', 'camera'], ['codex', 'camera'],
    ['openclaw', 'header'], ['codex', 'header'],
    ['hermes', 'header'], ['claude-code', 'header'],
  ] as const)(
    'uses current settings for the first %s %s scan delivered after opening', async (backendKind, method) => {
      mockApp.debugMode = true;
      mockConnectBackendPairingPayload.mockImplementationOnce(async (input) => {
        const assessment = jest.requireActual('../../connection/pairing/gateway-scan-flow').assessPairingPayload({
          payload: input.payload, expectedBackendKind: input.backendKind,
          selectedEnvironment: input.environment, debugMode: input.debugMode,
        });
        if (assessment.kind === 'rejected') throw { code: 'unsupported', pairingReason: assessment.reason };
        return null;
      });
      const props = createProps();
      const view = render(<OnboardingRoute {...props} />);
      act(() => {
        if (method === 'header') mockScreenProps?.onScanAnyQr?.();
        else mockScreenProps?.onScanQr(backendKind);
      });
      const firstCameraCallback = mockScanner.openGatewayScanner.mock.calls[0][0].onScanned;
      // Preserve the callback already held by the native camera, across a context update.
      mockApp.debugMode = false;
      view.rerender(<OnboardingRoute {...props} />);
      await act(async () => {
        await firstCameraCallback({ backendKind, mode: backendKind === 'hermes' ? 'hermes' : 'relay', relay: { serverUrl: backendKind === 'codex' ? 'https://clawket-codex-registry.clawket.workers.dev' : 'https://registry.clawket.ai', gatewayId: 'gateway', accessCode: 'synthetic' } });
      });
      expect(mockConnectBackendPairingPayload).toHaveBeenCalledWith(expect.objectContaining({
        backendKind, environment: 'production', debugMode: false,
      }));
      expect(mockScreenProps?.status).toEqual({ kind: 'idle' });
    },
  );

  it('pairs a header-scanned QR with the backend the QR names', async () => {
    const props = createProps({ route: { key: 'Onboarding-key', name: 'Onboarding', params: { presentation: 'modal' } } } as Partial<OnboardingRouteProps>);
    render(<OnboardingRoute {...props} />);
    expect(mockScreenProps?.initialBackend).toBeUndefined();
    act(() => mockScreenProps?.onScanAnyQr?.());
    const options = mockScanner.openGatewayScanner.mock.calls[0][0];
    const qr = {
      url: 'wss://relay.example/ws',
      backendKind: 'codex' as const,
      transportKind: 'relay' as const,
      mode: 'relay' as const,
      relay: { serverUrl: 'https://codex-registry.example', gatewayId: 'bridge-1', accessCode: 'secret' },
    };
    mockConnectBackendPairingPayload.mockReturnValueOnce(new Promise(() => {}));

    await act(async () => {
      void options.onScanned(qr);
    });

    expect(mockConnectBackendPairingPayload).toHaveBeenCalledWith({
      runtime: mockCoordinator,
      payload: qr,
      backendKind: 'codex',
      environment: 'production',
      debugMode: false,
    });
    // The chooser moves to the scanned backend's step so its progress is visible.
    expect(mockScreenProps?.initialBackend).toBe('codex');
    expect(mockScreenProps?.status).toEqual({ kind: 'connecting', phase: 'relay_connected' });
  });

  it('rejects a header-scanned QR without backend identity before claiming it', async () => {
    render(<OnboardingRoute {...createProps()} />);
    act(() => mockScreenProps?.onScanAnyQr?.());
    const options = mockScanner.openGatewayScanner.mock.calls[0][0];

    await act(async () => {
      await options.onScanned({ url: 'wss://unknown.example/ws' });
    });

    expect(mockShowNoticeAlert).toHaveBeenCalledWith('Invalid QR Code', 'This QR code does not contain valid connection info.');
    expect(mockConnectBackendPairingPayload).not.toHaveBeenCalled();
  });

  it('gates the header scan behind the additional-connection paywall', () => {
    mockRuntime = connectionSnapshot();
    const onOpenPaywall = jest.fn();
    render(<OnboardingRoute {...createProps({ onOpenPaywall })} />);
    act(() => mockScreenProps?.onScanAnyQr?.());
    expect(onOpenPaywall).toHaveBeenCalledWith('gatewayConnections', expect.any(Function));
    expect(mockScanner.openGatewayScanner).not.toHaveBeenCalled();

    act(() => onOpenPaywall.mock.calls[0]?.[1]?.());
    expect(mockScanner.openGatewayScanner).toHaveBeenCalledTimes(1);
  });

  it('resumes an additional connection flow after the host Pro gate succeeds', () => {
    mockRuntime = connectionSnapshot();
    const onOpenPaywall = jest.fn();
    render(<OnboardingRoute {...createProps({ onOpenPaywall })} />);
    act(() => mockScreenProps?.onScanQr('openclaw'));
    expect(onOpenPaywall).toHaveBeenCalledWith('gatewayConnections', expect.any(Function));
    expect(mockScanner.openGatewayScanner).not.toHaveBeenCalled();

    act(() => onOpenPaywall.mock.calls[0]?.[1]?.());
    expect(mockScanner.openGatewayScanner).toHaveBeenCalledTimes(1);
    expect(mockPro.requirePro).not.toHaveBeenCalled();
  });

  it('resumes the exact pairing-code submission after the host Pro gate succeeds', async () => {
    mockRuntime = connectionSnapshot();
    const onOpenPaywall = jest.fn();
    render(<OnboardingRoute {...createProps({ onOpenPaywall })} />);

    await act(async () => {
      await mockScreenProps?.onSubmitPairing({
        backendKind: 'hermes',
        transportKind: 'relay',
        code: 'ABC234',
      });
    });
    expect(mockConnectBackendPairingCode).not.toHaveBeenCalled();
    expect(onOpenPaywall).toHaveBeenCalledWith('gatewayConnections', expect.any(Function));

    act(() => onOpenPaywall.mock.calls[0]?.[1]?.());
    await waitFor(() => expect(mockConnectBackendPairingCode).toHaveBeenCalledWith(
      expect.objectContaining({
        backendKind: 'hermes',
        pairingCode: 'ABC234',
      }),
    ));
  });

  it.each(['openclaw', 'hermes', 'codex', 'claude-code', 'pi'] as const)('routes a pasted invitation through the selected %s backend without putting it in the code field', async (backend) => {
    const invitation = 'https://clawket.ai/pair/example#test-fragment';
    mockClipboardGetString.mockResolvedValueOnce(` ${invitation} `);
    render(<OnboardingRoute {...createProps()} />);
    let pasted: string | null | undefined;
    await act(async () => {
      pasted = await mockScreenProps?.onPastePairingCode?.(backend);
    });
    expect(pasted).toBeNull();
    expect(mockConnectBackendPairingLink).toHaveBeenCalledWith(expect.objectContaining({ url: invitation, backendKind: backend }));
    expect(mockConnectBackendPairingCode).not.toHaveBeenCalled();
  });

  it('does not claim a pasted invitation after the form scope changes during the clipboard read', async () => {
    let resolveClipboard!: (value: string) => void;
    mockClipboardGetString.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveClipboard = resolve; }));
    render(<OnboardingRoute {...createProps()} />);
    let current = true;
    let result: string | null | undefined;
    await act(async () => {
      const pending = mockScreenProps?.onPastePairingCode?.('hermes', () => current);
      current = false;
      resolveClipboard('https://clawket.ai/pair/example#test-fragment');
      result = await pending;
    });
    expect(result).toBeNull();
    expect(mockConnectBackendPairingLink).not.toHaveBeenCalled();
    expect(mockConnectBackendPairingCode).not.toHaveBeenCalled();
  });

  it('binds clipboard, official docs, modal close, and retry', async () => {
    const onDocsOpened = jest.fn();
    const onAgentPromptCopied = jest.fn();
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    mockPro = { ...mockPro, isPro: true };
    mockRuntime = connectionSnapshot({ state: 'offline' });
    const props = createProps({
      navigation: navigation as never,
      route: {
        key: 'Onboarding-key',
        name: 'Onboarding',
        params: { presentation: 'modal', initialBackend: 'openclaw' },
      } as never,
      onDocsOpened,
      onAgentPromptCopied,
    });
    render(<OnboardingRoute {...props} />);
    // An offline existing connection never surfaces on the add-connection form.
    expect(mockScreenProps?.status).toEqual({ kind: 'idle' });

    await act(async () => {
      await mockScreenProps?.onCopyCommand?.('copy me');
      await mockScreenProps?.onPastePairingCode?.('openclaw');
    });
    expect(mockClipboardSetString).toHaveBeenCalledWith('copy me');
    expect(mockClipboardGetString).toHaveBeenCalledTimes(1);
    act(() => mockScreenProps?.onErrorAction?.('bridge_offline'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://docs.openclaw.ai/install');
    expect(onDocsOpened).toHaveBeenCalledWith('openclaw');
    await act(async () => {
      await mockScreenProps?.onCopyAgentPrompt?.('run it for me', 'openclaw');
    });
    expect(mockClipboardSetString).toHaveBeenLastCalledWith('run it for me');
    expect(onAgentPromptCopied).toHaveBeenCalledWith('openclaw');
    act(() => mockScreenProps?.onOpenWebsite('hermes'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://hermes-agent.nousresearch.com');
    expect(onDocsOpened).toHaveBeenLastCalledWith('hermes');
    act(() => mockScreenProps?.onClose?.());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    // Nothing was paired here, so retry has nothing to probe or replay.
    act(() => mockScreenProps?.onRetry?.());
    expect(mockCoordinator.probeActive).not.toHaveBeenCalled();
  });

  it('keeps an offline existing connection out of an added pairing and its retry', async () => {
    // Owner report 2026-09-19: "Add connection" showed "No network" because
    // the current connection was offline. The form stays clean, a failed claim
    // replays the claim, and only the newly paired connection is probed.
    mockPro = { ...mockPro, isPro: true };
    mockRuntime = connectionSnapshot({ id: 'existing', state: 'offline' });
    mockConnectBackendPairingCode.mockRejectedValueOnce({ code: 'network' });
    const props = createProps({
      route: {
        key: 'Onboarding-key',
        name: 'Onboarding',
        params: { presentation: 'modal' },
      } as never,
    });
    const view = render(<OnboardingRoute {...props} />);
    expect(mockScreenProps?.status).toEqual({ kind: 'idle' });

    const submission = { backendKind: 'openclaw' as const, transportKind: 'relay' as const, code: '123456' };
    await act(async () => {
      await mockScreenProps?.onSubmitPairing(submission);
    });
    expect(mockScreenProps?.status).toEqual({ kind: 'error', code: 'network' });

    mockConnectBackendPairingCode.mockImplementation(() => {
      mockRuntime = connectionSnapshot({ id: 'connection-1', state: 'offline' });
      return Promise.resolve({ backendKind: 'openclaw', connectionId: 'connection-1' });
    });
    await act(async () => {
      mockScreenProps?.onErrorAction?.('network');
    });
    expect(mockConnectBackendPairingCode).toHaveBeenCalledTimes(2);
    expect(mockCoordinator.probeActive).not.toHaveBeenCalled();

    view.rerender(<OnboardingRoute {...props} />);
    await waitFor(() => {
      expect(mockScreenProps?.status).toEqual({ kind: 'offline' });
    });
    act(() => mockScreenProps?.onRetry?.());
    expect(mockCoordinator.probeActive).toHaveBeenCalledTimes(1);
  });
});
