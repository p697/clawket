import {
  claimRelayPairing,
  createGatewayConfigFromScan,
  upsertGatewayConfigFromScan,
  willCreateGatewayConfigFromScan,
} from './gatewayScanFlow';
import { StorageService } from '../services/storage';
import { RelayPairingService } from '../services/relay-pairing';
import { HermesRelayPairingService } from '../services/hermes-relay-pairing';

jest.mock('../services/storage', () => ({
  StorageService: {
    getGatewayConfigsState: jest.fn(),
    setGatewayConfigsState: jest.fn(),
  },
}));

jest.mock('../services/relay-pairing', () => ({
  RelayPairingService: {
    claim: jest.fn(),
  },
}));

jest.mock('../services/hermes-relay-pairing', () => ({
  HermesRelayPairingService: {
    claim: jest.fn(),
  },
}));

describe('gatewayScanFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a new relay config when the gateway has not been seen before', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: null,
        configs: [],
      },
      payload: {
        url: 'wss://relay.example.com/ws',
        token: 'gateway-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com/',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          displayName: 'Test Relay',
        },
      },
      now: 100,
    });

    expect(result.created).toMatchObject({
      id: 'gateway_100',
      name: 'Test Relay',
      mode: 'relay',
      url: 'wss://relay.example.com/ws',
      token: 'gateway-token',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        clientToken: 'gct_new',
        displayName: 'Test Relay',
      },
      createdAt: 100,
      updatedAt: 100,
    });
    expect(result.nextConfigs).toHaveLength(1);
  });

  it('updates an existing relay config for the same registry gateway instead of duplicating it', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: 'gateway_existing',
        configs: [{
          id: 'gateway_existing',
          name: 'My MacBook',
          mode: 'relay',
          url: 'wss://relay-old.example.com/ws',
          token: 'old-token',
          relay: {
            serverUrl: 'https://registry.example.com',
            gatewayId: 'gw_123',
            clientToken: 'gct_old',
            displayName: 'Old Name',
          },
          createdAt: 10,
          updatedAt: 20,
        }],
      },
      payload: {
        url: 'wss://relay.example.com/ws',
        token: 'new-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com/',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          displayName: 'New Name',
        },
      },
      now: 200,
    });

    expect(result.created).toEqual({
      id: 'gateway_existing',
      name: 'My MacBook',
      backendKind: 'openclaw',
      transportKind: 'relay',
      mode: 'relay',
      url: 'wss://relay.example.com/ws',
      token: 'new-token',
      password: undefined,
      hermes: undefined,
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        clientToken: 'gct_new',
        displayName: 'New Name',
        protocolVersion: undefined,
        supportsBootstrap: undefined,
      },
      createdAt: 10,
      updatedAt: 200,
    });
    expect(result.nextConfigs).toHaveLength(1);
    expect(result.nextConfigs[0]).toEqual(result.created);
  });

  it('preserves existing legacy credentials when a refreshed relay QR omits them', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: 'gateway_existing',
        configs: [{
          id: 'gateway_existing',
          name: 'My MacBook',
          mode: 'relay',
          url: 'wss://relay-old.example.com/ws',
          token: 'old-token',
          password: 'old-password',
          relay: {
            serverUrl: 'https://registry.example.com',
            gatewayId: 'gw_123',
            clientToken: 'gct_old',
            displayName: 'Old Name',
          },
          createdAt: 10,
          updatedAt: 20,
        }],
      },
      payload: {
        url: 'wss://relay.example.com/ws',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          displayName: 'New Name',
          protocolVersion: 2,
          supportsBootstrap: true,
        },
      },
      now: 300,
    });

    expect(result.created).toEqual({
      id: 'gateway_existing',
      name: 'My MacBook',
      backendKind: 'openclaw',
      transportKind: 'relay',
      mode: 'relay',
      url: 'wss://relay.example.com/ws',
      token: 'old-token',
      password: 'old-password',
      hermes: undefined,
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        clientToken: 'gct_new',
        displayName: 'New Name',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
      createdAt: 10,
      updatedAt: 300,
    });
  });

  it('treats a rescan of the same relay gateway as an update instead of a new config', () => {
    expect(willCreateGatewayConfigFromScan([
      {
        id: 'gateway_existing',
        name: 'My MacBook',
        mode: 'relay',
        url: 'wss://relay-old.example.com/ws',
        token: 'old-token',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_old',
        },
        createdAt: 10,
        updatedAt: 20,
      },
    ], {
      url: 'wss://relay.example.com/ws',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com/',
        gatewayId: 'gw_123',
        accessCode: '123456',
      },
    })).toBe(false);
  });

  it('persists the upserted config as the active gateway', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: 'gateway_existing',
      configs: [{
        id: 'gateway_existing',
        name: 'My MacBook',
        mode: 'relay',
        url: 'wss://relay-old.example.com/ws',
        token: 'old-token',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_old',
        },
        createdAt: 10,
        updatedAt: 20,
      }],
    });

    const result = await createGatewayConfigFromScan({
      payload: {
        url: 'wss://relay.example.com/ws',
        token: 'new-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
        },
      },
      debugMode: false,
    });

    expect(result.created.id).toBe('gateway_existing');
    expect(StorageService.setGatewayConfigsState).toHaveBeenCalledWith({
      activeId: 'gateway_existing',
      configs: [result.created],
    });
  });

  it('creates a hermes config from scan without inheriting legacy relay fields', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: null,
        configs: [],
      },
      payload: {
        url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=secret',
        backendKind: 'hermes',
        transportKind: 'local',
        mode: 'hermes',
        hermes: {
          bridgeUrl: 'http://192.168.1.8:4319',
          displayName: 'Hermes',
        },
      },
      now: 400,
    });

    expect(result.created).toEqual({
      id: 'gateway_400',
      name: 'Hermes',
      backendKind: 'hermes',
      transportKind: 'local',
      mode: 'hermes',
      url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=secret',
      token: undefined,
      password: undefined,
      hermes: {
        bridgeUrl: 'http://192.168.1.8:4319',
        displayName: 'Hermes',
      },
      relay: undefined,
      createdAt: 400,
      updatedAt: 400,
    });
  });

  it('updates an existing hermes config instead of duplicating it', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: 'gateway_existing',
        configs: [{
          id: 'gateway_existing',
          name: 'Hermes',
          mode: 'hermes',
          url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=old',
          hermes: {
            bridgeUrl: 'http://192.168.1.8:4319',
            displayName: 'Hermes',
          },
          createdAt: 10,
          updatedAt: 20,
        }],
      },
      payload: {
        url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=new',
        backendKind: 'hermes',
        transportKind: 'local',
        mode: 'hermes',
        hermes: {
          bridgeUrl: 'http://192.168.1.8:4319',
          displayName: 'Hermes',
        },
      },
      now: 500,
    });

    expect(result.created.id).toBe('gateway_existing');
    expect(result.nextConfigs).toHaveLength(1);
    expect(result.created.mode).toBe('hermes');
    expect(result.created.url).toBe('ws://192.168.1.8:4319/v1/hermes/ws?token=new');
  });

  it('preserves relay bootstrap capability flags when saving scanned configs', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: null,
        configs: [],
      },
      payload: {
        url: 'wss://relay.example.com/ws',
        token: 'gateway-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          protocolVersion: 2,
          supportsBootstrap: true,
        },
      },
      now: 300,
    });

    expect(result.created.relay).toEqual({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_123',
      clientToken: 'gct_new',
      protocolVersion: 2,
      supportsBootstrap: true,
    });
  });

  it('claims a new-format relay QR without legacy credentials and returns a usable relay config', async () => {
    const accessCode = 'AB7K9Q';
    (RelayPairingService.claim as jest.Mock).mockResolvedValue({
      gatewayId: 'gw_123',
      relayUrl: 'wss://relay.example.com/ws',
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
        accessCode,
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    }, { current: new Map() });

    expect(RelayPairingService.claim).toHaveBeenCalledWith({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_123',
      accessCode,
    });

    expect(result).toEqual({
      url: 'wss://relay.example.com/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      token: undefined,
      password: undefined,
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

  it('claims a legacy relay QR and keeps legacy gateway credentials for fallback auth', async () => {
    (RelayPairingService.claim as jest.Mock).mockResolvedValue({
      gatewayId: 'gw_123',
      relayUrl: 'wss://relay.example.com/ws',
      clientToken: 'gct_new',
      displayName: 'Lucy Mac',
      region: 'us',
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

    expect(result.token).toBe('legacy-token');
    expect(result.password).toBe('legacy-password');
    expect(result.relay?.clientToken).toBe('gct_new');
  });

  it('claims a Hermes relay QR into a Hermes relay runtime config', async () => {
    (HermesRelayPairingService.claim as jest.Mock).mockResolvedValue({
      bridgeId: 'hbg_123',
      relayUrl: 'wss://hermes-relay.example.com/ws',
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
        protocolVersion: undefined,
        supportsBootstrap: undefined,
      },
    });
  });

  it('creates a Hermes relay config without fabricating direct Hermes bridge metadata', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: null,
        configs: [],
      },
      payload: {
        url: 'wss://hermes-relay.example.com/ws',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        relay: {
          serverUrl: 'https://hermes-registry.example.com',
          gatewayId: 'hbg_123',
          clientToken: 'hct_new',
          displayName: 'Hermes Mac',
        },
      },
      now: 600,
    });

    expect(result.created).toEqual({
      id: 'gateway_600',
      name: 'Hermes Mac',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      url: 'wss://hermes-relay.example.com/ws',
      token: undefined,
      password: undefined,
      hermes: undefined,
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        clientToken: 'hct_new',
        displayName: 'Hermes Mac',
        protocolVersion: undefined,
        supportsBootstrap: undefined,
      },
      createdAt: 600,
      updatedAt: 600,
    });
  });

  it('updates an existing Hermes relay config by relay identity instead of clearing relay credentials', () => {
    const result = upsertGatewayConfigFromScan({
      existingState: {
        activeId: 'gateway_existing',
        configs: [{
          id: 'gateway_existing',
          name: 'Hermes Mac',
          backendKind: 'hermes',
          transportKind: 'relay',
          mode: 'hermes',
          url: 'wss://hermes-relay-old.example.com/ws',
          hermes: {
            bridgeUrl: 'wss://hermes-relay-old.example.com/ws',
          },
          relay: {
            serverUrl: 'https://hermes-registry.example.com',
            gatewayId: 'hbg_123',
            clientToken: 'hct_old',
            displayName: 'Hermes Mac',
          },
          createdAt: 10,
          updatedAt: 20,
        }],
      },
      payload: {
        url: 'wss://hermes-relay.example.com/ws',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        relay: {
          serverUrl: 'https://hermes-registry.example.com',
          gatewayId: 'hbg_123',
          clientToken: 'hct_new',
          displayName: 'Hermes Mac',
        },
      },
      now: 700,
    });

    expect(result.created).toEqual({
      id: 'gateway_existing',
      name: 'Hermes Mac',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      url: 'wss://hermes-relay.example.com/ws',
      token: undefined,
      password: undefined,
      hermes: undefined,
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        clientToken: 'hct_new',
        displayName: 'Hermes Mac',
        protocolVersion: undefined,
        supportsBootstrap: undefined,
      },
      createdAt: 10,
      updatedAt: 700,
    });
  });

  it('treats a rescan of the same Hermes relay gateway as an update instead of a new config', () => {
    expect(willCreateGatewayConfigFromScan([
      {
        id: 'gateway_existing',
        name: 'Hermes Mac',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        url: 'wss://hermes-relay-old.example.com/ws',
        relay: {
          serverUrl: 'https://hermes-registry.example.com',
          gatewayId: 'hbg_123',
          clientToken: 'hct_old',
        },
        createdAt: 10,
        updatedAt: 20,
      },
    ], {
      url: 'wss://hermes-relay.example.com/ws',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        accessCode: 'ABCD23',
      },
    })).toBe(false);
  });
});
