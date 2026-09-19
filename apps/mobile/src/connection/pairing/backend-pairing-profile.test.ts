import type { PairingConnectionRuntime } from './save-paired-connection';
import {
  connectBackendPairingCode,
  connectBackendPairingLink,
  connectBackendPairingPayload,
  type BackendPairingPayload,
} from './backend-pairing-profile';

const mockClaimCode = jest.fn();
const mockClaimRelayPairing = jest.fn();
const mockSavePairedConnection = jest.fn();
const mockPairingFinished = jest.fn();

jest.mock('../registry/hermes-relay-pairing', () => ({
  HermesRelayPairingService: {
    claimCode: (...args: unknown[]) => mockClaimCode(...args),
  },
}));

jest.mock('./save-paired-connection', () => ({
  savePairedConnection: (...args: unknown[]) => mockSavePairedConnection(...args),
}));

jest.mock('./gateway-scan-flow', () => ({
  ...jest.requireActual('./gateway-scan-flow'),
  claimRelayPairing: (...args: unknown[]) => mockClaimRelayPairing(...args),
}));

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    gatewaySecurePairingFinished: (...args: unknown[]) => mockPairingFinished(...args),
  },
}));

function createRuntime(
  activeConnectionId: string | null = 'active-connection',
  backendKind: 'openclaw' | 'hermes' | 'local-model' = 'openclaw',
) {
  return {
    getSnapshot: jest.fn(() => ({
      activeConnectionId,
      connections: activeConnectionId
        ? [{ id: activeConnectionId, backendKind }]
        : [],
    })),
    activate: jest.fn(),
    probeActive: jest.fn(),
    upsertConnection: jest.fn(),
  } as unknown as PairingConnectionRuntime;
}

function createSecureInvitation() {
  return {
    connectCode: jest.fn(async () => true),
    connectLink: jest.fn(async () => true),
  };
}

describe('backend pairing profiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimCode.mockResolvedValue({
      bridgeId: 'hermes-bridge',
      relayUrl: 'wss://hermes-relay.example/ws',
      clientToken: 'hct_test',
      displayName: 'Hermes desktop',
      region: 'us',
    });
    mockSavePairedConnection.mockResolvedValue({
      connection: { id: 'hermes-connection', backendKind: 'hermes' },
      created: true,
      probeSucceeded: true,
    });
    mockClaimRelayPairing.mockImplementation(async (payload) => payload);
  });

  it('routes an OpenClaw code through the official environment profile', async () => {
    const runtime = createRuntime('openclaw-connection');
    const secureInvitation = createSecureInvitation();

    await expect(connectBackendPairingCode({
      backendKind: 'openclaw',
      environment: 'preview',
      debugMode: true,
      runtime,
      pairingCode: '123456',
      secureInvitation,
    })).resolves.toEqual({
      backendKind: 'openclaw',
      connectionId: 'openclaw-connection',
    });

    expect(secureInvitation.connectCode).toHaveBeenCalledWith({
      serverUrl: 'https://clawket-registry-preview.clawket.workers.dev',
      pairingCode: '123456',
      expectedBackendKind: 'openclaw',
      environment: 'preview',
    });
    expect(mockPairingFinished).not.toHaveBeenCalled();
  });

  it('pairs a local model code in Production without Debug Mode through its dedicated Registry', async () => {
    const runtime = createRuntime('local-model-connection', 'local-model');
    const secureInvitation = createSecureInvitation();

    await expect(connectBackendPairingCode({
      backendKind: 'local-model',
      environment: 'production',
      debugMode: false,
      runtime,
      pairingCode: '001234',
      secureInvitation,
    })).resolves.toEqual({
      backendKind: 'local-model',
      connectionId: 'local-model-connection',
    });

    // Neither the selected environment nor Debug Mode reaches the invitation: the Registry is fixed.
    expect(secureInvitation.connectCode).toHaveBeenCalledWith({
      serverUrl: 'https://clawket-local-model-registry-preview.clawket.workers.dev',
      pairingCode: '001234',
      expectedBackendKind: 'local-model',
    });
    expect(mockPairingFinished).not.toHaveBeenCalled();
  });

  it('accepts a local model link only from the dedicated Registry, in any environment', async () => {
    const runtime = createRuntime('local-model-link-connection', 'local-model');
    const secureInvitation = createSecureInvitation();
    const url = `https://clawket-local-model-registry-preview.clawket.workers.dev/pair/ps_test#k=${'A'.repeat(43)}`;

    await expect(connectBackendPairingLink({
      backendKind: 'local-model',
      environment: 'production',
      debugMode: false,
      runtime,
      url,
      secureInvitation,
    })).resolves.toEqual({
      backendKind: 'local-model',
      connectionId: 'local-model-link-connection',
    });
    expect(secureInvitation.connectLink).toHaveBeenCalledWith(url, { expectedBackendKind: 'local-model' });

    // An OpenClaw Registry link cannot be smuggled in as a local model pairing.
    secureInvitation.connectLink.mockClear();
    await expect(connectBackendPairingLink({
      backendKind: 'local-model',
      environment: 'preview',
      debugMode: true,
      runtime,
      url: `https://clawket-registry-preview.clawket.workers.dev/pair/ps_test#k=${'A'.repeat(43)}`,
      secureInvitation,
    })).rejects.toMatchObject({ code: 'unsupported' });
    expect(secureInvitation.connectLink).not.toHaveBeenCalled();
  });

  it.each(['code', 'link'] as const)('does not invent an expiry after handled %s feedback or cancellation', async (method) => {
    const secureInvitation = createSecureInvitation();
    secureInvitation.connectCode.mockResolvedValue(false);
    secureInvitation.connectLink.mockResolvedValue(false);
    const input = {
      backendKind: 'openclaw' as const,
      environment: 'production' as const,
      debugMode: false,
      runtime: createRuntime(),
      secureInvitation,
    };
    const result = method === 'code'
      ? await connectBackendPairingCode({ ...input, pairingCode: '123456' })
      : await connectBackendPairingLink({ ...input, url: `https://registry.clawket.ai/pair/ps_test#k=${'A'.repeat(43)}` });
    expect(result).toBeNull();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });

  it('routes an accepted OpenClaw link through the secure invitation profile', async () => {
    const runtime = createRuntime('openclaw-link-connection');
    const secureInvitation = createSecureInvitation();
    const url = `https://registry.clawket.ai/pair/ps_test#k=${'A'.repeat(43)}`;

    await expect(connectBackendPairingLink({
      backendKind: 'openclaw',
      environment: 'production',
      debugMode: false,
      runtime,
      url,
      secureInvitation,
    })).resolves.toEqual({
      backendKind: 'openclaw',
      connectionId: 'openclaw-link-connection',
    });

    expect(secureInvitation.connectLink).toHaveBeenCalledWith(url, {
      expectedBackendKind: 'openclaw',
      environment: 'production',
    });
  });

  it('claims and saves a Hermes code with isolated Relay metadata', async () => {
    const runtime = createRuntime();
    const secureInvitation = createSecureInvitation();

    await expect(connectBackendPairingCode({
      backendKind: 'hermes',
      environment: 'preview',
      debugMode: true,
      runtime,
      pairingCode: 'ABC234',
      secureInvitation,
    })).resolves.toEqual({
      backendKind: 'hermes',
      connectionId: 'hermes-connection',
    });

    const serverUrl = 'https://clawket-hermes-registry-preview.clawket.workers.dev';
    expect(mockClaimCode).toHaveBeenCalledWith({
      serverUrl,
      pairingCode: 'ABC234',
    });
    expect(mockSavePairedConnection).toHaveBeenCalledWith({
      runtime,
      debugMode: true,
      source: 'pairing_code',
      payload: {
        url: 'wss://hermes-relay.example/ws',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        relay: {
          serverUrl,
          gatewayId: 'hermes-bridge',
          clientToken: 'hct_test',
          relayUrl: 'wss://hermes-relay.example/ws',
          displayName: 'Hermes desktop',
        },
      },
    });
    expect(mockPairingFinished).toHaveBeenCalledWith({
      method: 'code',
      environment: 'preview',
      connected: true,
    });
  });

  it('records a failed Hermes code without claiming success', async () => {
    mockClaimCode.mockRejectedValueOnce(new Error('Hermes Registry unavailable'));

    await expect(connectBackendPairingCode({
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
      runtime: createRuntime(),
      pairingCode: 'ABC234',
      secureInvitation: createSecureInvitation(),
    })).rejects.toThrow('Hermes Registry unavailable');

    expect(mockSavePairedConnection).not.toHaveBeenCalled();
    expect(mockPairingFinished).toHaveBeenCalledTimes(1);
    expect(mockPairingFinished).toHaveBeenCalledWith({
      method: 'code',
      environment: 'production',
      connected: false,
    });
  });

  it('rejects Hermes links through capability metadata without invoking OpenClaw pairing', async () => {
    const secureInvitation = createSecureInvitation();

    await expect(connectBackendPairingLink({
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
      runtime: createRuntime(),
      url: 'https://registry.clawket.ai/pair/ps_test#k=secret',
      secureInvitation,
    })).rejects.toMatchObject({ code: 'unsupported' });

    expect(secureInvitation.connectCode).not.toHaveBeenCalled();
    expect(secureInvitation.connectLink).not.toHaveBeenCalled();
    expect(mockPairingFinished).not.toHaveBeenCalled();
  });

  it('rejects mismatched and conflicting QR backends before claim or save', async () => {
    const openClawPayload: BackendPairingPayload = {
      url: 'wss://relay.example/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      mode: 'relay',
      relay: {
        serverUrl: 'https://self-hosted.example',
        gatewayId: 'gateway-1',
        accessCode: 'secret',
      },
    };

    await expect(connectBackendPairingPayload({
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
      runtime: createRuntime(),
      payload: openClawPayload,
    })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(connectBackendPairingPayload({
      backendKind: 'openclaw',
      environment: 'production',
      debugMode: false,
      runtime: createRuntime(),
      payload: {
        ...openClawPayload,
        mode: 'hermes',
        hermes: { bridgeUrl: 'ws://127.0.0.1:8787' },
      },
    })).rejects.toMatchObject({ code: 'unsupported' });

    expect(mockClaimRelayPairing).not.toHaveBeenCalled();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });

  it('rejects an official QR from the wrong environment before claim or save', async () => {
    await expect(connectBackendPairingPayload({
      backendKind: 'openclaw',
      environment: 'production',
      debugMode: false,
      runtime: createRuntime(),
      payload: {
        url: 'wss://relay.example/ws',
        backendKind: 'openclaw',
        transportKind: 'relay',
        mode: 'relay',
        relay: {
          serverUrl: 'https://clawket-registry-preview.clawket.workers.dev',
          gatewayId: 'gateway-1',
          accessCode: 'secret',
        },
      },
    })).rejects.toMatchObject({ code: 'unsupported' });

    expect(mockClaimRelayPairing).not.toHaveBeenCalled();
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });

  it('claims and re-validates a matching QR before saving through the runtime', async () => {
    const runtime = createRuntime('hermes-connection', 'hermes');
    const claimed: BackendPairingPayload = {
      url: 'wss://hermes-relay.example/ws',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      relay: {
        serverUrl: 'https://self-hosted.example',
        gatewayId: 'bridge-1',
        clientToken: 'client-token',
      },
    };
    mockClaimRelayPairing.mockResolvedValueOnce(claimed);

    await expect(connectBackendPairingPayload({
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
      runtime,
      payload: {
        ...claimed,
        url: '',
        relay: { ...claimed.relay!, accessCode: 'secret', clientToken: undefined },
      },
    })).resolves.toEqual({
      backendKind: 'hermes',
      connectionId: 'hermes-connection',
    });

    expect(mockClaimRelayPairing).toHaveBeenCalledTimes(1);
    expect(mockSavePairedConnection).toHaveBeenCalledWith({
      runtime,
      payload: claimed,
      debugMode: false,
      source: 'pairing_qr',
    });
  });

  it('rejects a claimed QR whose backend changed before any save', async () => {
    const claimed: BackendPairingPayload = {
      url: 'wss://relay.example/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      mode: 'relay',
      relay: {
        serverUrl: 'https://self-hosted.example',
        gatewayId: 'gateway-1',
        clientToken: 'client-token',
      },
    };
    mockClaimRelayPairing.mockResolvedValueOnce(claimed);

    await expect(connectBackendPairingPayload({
      backendKind: 'hermes',
      environment: 'production',
      debugMode: false,
      runtime: createRuntime(),
      payload: {
        url: '',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        relay: {
          serverUrl: 'https://self-hosted.example',
          gatewayId: 'gateway-1',
          accessCode: 'secret',
        },
      },
    })).rejects.toMatchObject({ code: 'unsupported' });

    expect(mockClaimRelayPairing).toHaveBeenCalledTimes(1);
    expect(mockSavePairedConnection).not.toHaveBeenCalled();
  });
});
