import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import {
  buildPairedConnectionRecord,
  savePairedConnection,
  type PairingConnectionRuntime,
} from './save-paired-connection';

const mockGatewayConnectSaved = jest.fn();

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    gatewayConnectSaved: (...args: unknown[]) => mockGatewayConnectSaved(...args),
  },
}));

function descriptor(
  id: string,
  backendKind: 'openclaw' | 'hermes' = 'openclaw',
): ConnectionDescriptor {
  return {
    id,
    backendKind,
    transportKind: 'relay',
    label: 'Computer',
    createdAt: 1,
    isFreeSlot: true,
  };
}

describe('save paired connection', () => {
  beforeEach(() => {
    mockGatewayConnectSaved.mockReset();
  });

  it('builds an environment-aware credential-bearing Relay record', () => {
    expect(buildPairedConnectionRecord({
      payload: {
        url: ' wss://relay.example/ws ',
        token: ' gateway-token ',
        password: ' password ',
        backendKind: 'openclaw',
        transportKind: 'relay',
        bootstrap: { token: 'bootstrap', strategy: 'mobile-setup' },
        relay: {
          serverUrl: 'https://clawket-registry-preview.clawket.workers.dev/',
          gatewayId: ' gateway-1 ',
          clientToken: ' client-token ',
          displayName: ' Studio ',
          protocolVersion: 2,
          supportsBootstrap: true,
        },
      },
      debugMode: true,
      connectionCount: 2,
    })).toEqual({
      backendKind: 'openclaw',
      transportKind: 'relay',
      label: 'Studio',
      environment: 'preview',
      url: 'wss://relay.example/ws',
      auth: { token: 'gateway-token', password: 'password' },
      bootstrap: { token: 'bootstrap', strategy: 'mobile-setup' },
      relay: {
        serverUrl: 'https://clawket-registry-preview.clawket.workers.dev',
        gatewayId: 'gateway-1',
        clientToken: 'client-token',
        displayName: 'Studio',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
      debugMode: true,
    });
  });

  it('builds a direct Hermes bridge record without treating it as a transport mode', () => {
    expect(buildPairedConnectionRecord({
      payload: {
        url: 'ws://127.0.0.1:8789/v1/hermes/ws',
        backendKind: 'hermes',
        transportKind: 'local',
        mode: 'hermes',
        hermes: {
          bridgeUrl: ' ws://127.0.0.1:8789/v1/hermes/ws ',
          displayName: ' Local Hermes ',
        },
      },
      debugMode: false,
      connectionCount: 0,
    })).toEqual({
      backendKind: 'hermes',
      transportKind: 'local',
      label: 'Local Hermes',
      url: 'ws://127.0.0.1:8789/v1/hermes/ws',
      hermes: {
        bridgeUrl: 'ws://127.0.0.1:8789/v1/hermes/ws',
        displayName: 'Local Hermes',
      },
      debugMode: false,
    });
  });

  it('classifies official Hermes Preview without classifying a custom Registry', () => {
    const buildHermesRelay = (serverUrl: string) => buildPairedConnectionRecord({
      payload: {
        url: 'wss://hermes-relay.example/ws',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        relay: {
          serverUrl,
          gatewayId: 'bridge-1',
          clientToken: 'client-token',
        },
      },
      debugMode: true,
      connectionCount: 0,
    });

    expect(buildHermesRelay(
      'https://clawket-hermes-registry-preview.clawket.workers.dev',
    )).toMatchObject({
      backendKind: 'hermes',
      transportKind: 'relay',
      environment: 'preview',
    });
    expect(buildHermesRelay('https://self-hosted.example')).not.toHaveProperty('environment');
  });

  it('upserts, activates, and probes through the coordinator in order', async () => {
    const connection = descriptor('stable-id');
    const calls: string[] = [];
    const runtime = {
      getSnapshot: jest.fn(() => ({ connections: [connection] })),
      upsertConnection: jest.fn(async () => {
        calls.push('upsert');
        return { connection, created: false };
      }),
      activate: jest.fn(async () => {
        calls.push('activate');
        return {};
      }),
      probeActive: jest.fn(async () => {
        calls.push('probe');
        return false;
      }),
    } as unknown as PairingConnectionRuntime;

    await expect(savePairedConnection({
      runtime,
      payload: {
        url: 'wss://relay.example/ws',
        backendKind: 'openclaw',
        transportKind: 'relay',
        relay: { serverUrl: 'https://registry.example', gatewayId: 'gateway-1' },
      },
      debugMode: false,
      source: 'pairing_qr',
    })).resolves.toEqual({ connection, created: false, probeSucceeded: false });
    expect(calls).toEqual(['upsert', 'activate', 'probe']);
    expect(mockGatewayConnectSaved).toHaveBeenCalledWith({
      backend: 'openclaw',
      transport: 'relay',
      source: 'pairing_qr',
    });
  });
});
