import { RelayPairingService } from '../../services/relay-pairing';
import { HermesRelayPairingService } from '../registry/hermes-relay-pairing';
import { claimRelayPairing, type GatewayScanPayload } from './gateway-scan-flow';

jest.mock('../../services/relay-pairing', () => ({
  RelayPairingService: { claim: jest.fn() },
}));

jest.mock('../registry/hermes-relay-pairing', () => ({
  HermesRelayPairingService: { claim: jest.fn() },
}));

describe('gateway scan Relay claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an already claimed or direct QR payload unchanged', async () => {
    const payload: GatewayScanPayload = {
      url: 'wss://relay.example.com/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        clientToken: 'gct_existing',
      },
    };

    await expect(claimRelayPairing(payload, { current: new Map() })).resolves.toBe(payload);
    expect(RelayPairingService.claim).not.toHaveBeenCalled();
    expect(HermesRelayPairingService.claim).not.toHaveBeenCalled();
  });

  it('claims a new-format OpenClaw Relay QR and preserves negotiated metadata', async () => {
    (RelayPairingService.claim as jest.Mock).mockResolvedValue({
      gatewayId: 'gw_123',
      relayUrl: ' wss://relay.example.com/ws ',
      clientToken: 'gct_new',
      displayName: 'Lucy Mac',
      region: 'us',
    });

    const result = await claimRelayPairing({
      url: '',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        accessCode: 'AB7K9Q',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    }, { current: new Map() });

    expect(RelayPairingService.claim).toHaveBeenCalledWith({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_123',
      accessCode: 'AB7K9Q',
    });
    expect(result).toEqual({
      url: 'wss://relay.example.com/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      token: undefined,
      password: undefined,
      bootstrap: undefined,
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        clientToken: 'gct_new',
        relayUrl: 'wss://relay.example.com/ws',
        displayName: 'Lucy Mac',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    });
  });

  it('keeps legacy OpenClaw gateway credentials for fallback authentication', async () => {
    (RelayPairingService.claim as jest.Mock).mockResolvedValue({
      gatewayId: 'gw_123',
      relayUrl: 'wss://relay.example.com/ws',
      clientToken: 'gct_new',
    });

    const result = await claimRelayPairing({
      url: '',
      token: 'legacy-token',
      password: 'legacy-password',
      backendKind: 'openclaw',
      transportKind: 'relay',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        accessCode: '123456',
      },
    }, { current: new Map() });

    expect(result).toMatchObject({
      token: 'legacy-token',
      password: 'legacy-password',
      relay: { clientToken: 'gct_new' },
    });
  });

  it('claims a Hermes Relay QR through the isolated Hermes Registry', async () => {
    (HermesRelayPairingService.claim as jest.Mock).mockResolvedValue({
      bridgeId: 'hbg_123',
      relayUrl: ' wss://hermes-relay.example.com/ws ',
      clientToken: 'hct_new',
      displayName: 'Hermes Mac',
      region: 'us',
    });

    const result = await claimRelayPairing({
      url: '',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        accessCode: 'ABCD23',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    }, { current: new Map() });

    expect(HermesRelayPairingService.claim).toHaveBeenCalledWith({
      serverUrl: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      accessCode: 'ABCD23',
    });
    expect(result).toEqual({
      url: 'wss://hermes-relay.example.com/ws',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        clientToken: 'hct_new',
        relayUrl: 'wss://hermes-relay.example.com/ws',
        displayName: 'Hermes Mac',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    });
  });

  it('deduplicates an in-flight claim and clears it after completion', async () => {
    let resolveClaim: ((value: {
      gatewayId: string;
      relayUrl: string;
      clientToken: string;
    }) => void) | undefined;
    (RelayPairingService.claim as jest.Mock).mockImplementation(() => new Promise((resolve) => {
      resolveClaim = resolve;
    }));
    const payload: GatewayScanPayload = {
      url: '',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        accessCode: 'AB7K9Q',
      },
    };
    const inFlight = new Map<string, Promise<GatewayScanPayload>>();

    const first = claimRelayPairing(payload, { current: inFlight });
    const second = claimRelayPairing(payload, { current: inFlight });
    expect(RelayPairingService.claim).toHaveBeenCalledTimes(1);
    expect(inFlight).toHaveProperty('size', 1);

    resolveClaim?.({
      gatewayId: 'gw_123',
      relayUrl: 'wss://relay.example.com/ws',
      clientToken: 'gct_new',
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(inFlight).toHaveProperty('size', 0);
  });
});
