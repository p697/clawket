import type { ConnectionRecord } from '@clawket/agent-protocol';
import nacl from 'tweetnacl';
import { NodeClient } from './node-client';
import { StorageService } from './storage';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from './websocket-frame-limit';
import { RELAY_CLIENT_PONG_CAPABILITY } from '../connection/protocol/relay-control';

// Mock tweetnacl
jest.mock('tweetnacl', () => ({
  sign: {
    keyPair: jest.fn(() => ({
      publicKey: new Uint8Array(32).fill(1),
      secretKey: new Uint8Array(64).fill(2),
    })),
    detached: jest.fn(() => new Uint8Array(64).fill(3)),
  },
}));

// Mock js-sha256
jest.mock('js-sha256', () => ({
  sha256: jest.fn(() => 'a'.repeat(64)),
}));

// Mock StorageService
jest.mock('./storage', () => ({
  StorageService: (() => {
    type Scope = {
      serverUrl?: string;
      gatewayId?: string;
      gatewayUrl?: string;
      role?: string;
    };
    const getDeviceToken = jest.fn((
      _deviceId: string,
      _scope?: Scope,
    ) => Promise.resolve<string | null>(null));
    const setDeviceToken = jest.fn((
      _deviceId: string,
      _token: string,
      _scope?: Scope,
    ) => Promise.resolve());
    return {
      getIdentity: jest.fn(() => Promise.resolve(null)),
      setIdentity: jest.fn(() => Promise.resolve()),
      clearIdentity: jest.fn(() => Promise.resolve()),
      getDeviceToken,
      setDeviceToken,
      getDeviceTokenRecord: jest.fn(async (deviceId, scope) => {
        const token = await getDeviceToken(deviceId, scope);
        return token ? {
          version: 1,
          token,
          role: 'node',
          scopes: [],
          updatedAtMs: 1,
        } : null;
      }),
      setDeviceTokenRecord: jest.fn((deviceId, record, scope) => (
        setDeviceToken(deviceId, record.token, scope)
      )),
      deleteDeviceToken: jest.fn(() => Promise.resolve()),
    };
  })(),
}));

// MockWebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  OPEN = 1;
  CONNECTING = 0;
  CLOSING = 2;
  CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  constructor(readonly url: string) {}
  close = jest.fn((_code?: number, _reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  });
}

(globalThis as any).WebSocket = MockWebSocket;

function openClawRecord(
  overrides: Partial<ConnectionRecord> = {},
): ConnectionRecord {
  return {
    id: 'openclaw-node',
    backendKind: 'openclaw',
    transportKind: 'local',
    label: 'OpenClaw node',
    createdAt: 1,
    url: 'ws://localhost:18789',
    ...overrides,
  };
}

describe('NodeClient', () => {
  let client: NodeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(StorageService.getDeviceToken).mockReset().mockResolvedValue(null);
    client = new NodeClient();
  });

  afterEach(() => {
    client.disconnect();
  });

  it('starts in idle state', () => {
    expect(client.getConnectionState()).toBe('idle');
  });

  it('emits error when connecting without config', () => {
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (e) => errors.push(e));
    client.connect();
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('config_missing');
  });

  it('transitions to connecting then challenging on open', () => {
    const states: string[] = [];
    client.on('connection', ({ state }) => states.push(state));
    client.configure(openClawRecord());
    client.connect();
    expect(states).toContain('connecting');

    // Simulate WebSocket open
    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();
    expect(states).toContain('challenging');
  });

  it('resets reconnect backoff only after a successful protocol handshake', async () => {
    client.configure(openClawRecord());
    (client as any).reconnectAttempts = 3;
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    expect(client.getConnectionState()).toBe('challenging');
    expect((client as any).reconnectAttempts).toBe(3);

    jest.spyOn(client as any, 'sendRequest').mockResolvedValue({});
    await (client as any).handleConnectChallenge('healthy-handshake');

    expect(client.getConnectionState()).toBe('ready');
    expect((client as any).reconnectAttempts).toBe(0);
  });

  it('does not reset reconnect backoff when the accepted socket closes before readiness', async () => {
    client.configure(openClawRecord());
    (client as any).reconnectAttempts = 3;
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();
    jest.spyOn(client as any, 'sendRequest').mockResolvedValue({
      auth: { deviceToken: 'rotated-device-token' },
    });
    let finishPersistingToken: (() => void) | undefined;
    let announceTokenPersistence: (() => void) | undefined;
    const tokenPersistenceStarted = new Promise<void>((resolve) => {
      announceTokenPersistence = resolve;
    });
    jest.mocked(StorageService.setDeviceToken).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishPersistingToken = resolve;
        announceTokenPersistence?.();
      }),
    );

    const handshake = (client as any).handleConnectChallenge('stale-handshake');
    await tokenPersistenceStarted;
    expect(StorageService.setDeviceToken).toHaveBeenCalled();

    const delayedClose = ws.onclose;
    ws.readyState = MockWebSocket.CLOSED;
    finishPersistingToken?.();
    await handshake;

    expect(client.getConnectionState()).toBe('challenging');
    expect((client as any).reconnectAttempts).toBe(3);
    delayedClose?.();
    expect(client.getConnectionState()).toBe('reconnecting');
    expect((client as any).reconnectAttempts).toBe(4);
  });

  it('does not let a stale challenge continuation write its nonce to a replacement socket', async () => {
    let finishIdentityRead: ((identity: null) => void) | undefined;
    jest.mocked(StorageService.getIdentity).mockImplementationOnce(
      () => new Promise<null>((resolve) => {
        finishIdentityRead = resolve;
      }),
    );
    client.configure(openClawRecord());
    client.connect();

    const staleSocket = (client as any).ws as MockWebSocket;
    staleSocket.onopen?.();
    const staleAttempt = (client as any).activeAttempt;
    const staleChallenge = (client as any).handleConnectChallenge(
      'stale-nonce',
      staleAttempt,
    );

    staleSocket.close();
    client.connect();
    const replacementSocket = (client as any).ws as MockWebSocket;
    replacementSocket.onopen?.();

    finishIdentityRead?.(null);
    await staleChallenge;

    expect(staleSocket.send).not.toHaveBeenCalled();
    expect(replacementSocket.send).not.toHaveBeenCalled();
    expect((client as any).ws).toBe(replacementSocket);
    expect(client.getConnectionState()).toBe('challenging');
  });

  it('does not let a stale credential lookup write its nonce to a replacement socket', async () => {
    let finishTokenRead: ((token: null) => void) | undefined;
    let announceTokenRead: (() => void) | undefined;
    const tokenReadStarted = new Promise<void>((resolve) => {
      announceTokenRead = resolve;
    });
    jest.mocked(StorageService.getDeviceToken).mockImplementationOnce(
      () => new Promise<null>((resolve) => {
        finishTokenRead = resolve;
        announceTokenRead?.();
      }),
    );
    client.configure(openClawRecord());
    client.connect();

    const staleSocket = (client as any).ws as MockWebSocket;
    staleSocket.onopen?.();
    const staleAttempt = (client as any).activeAttempt;
    const staleChallenge = (client as any).handleConnectChallenge(
      'stale-token-read-nonce',
      staleAttempt,
    );
    await tokenReadStarted;

    staleSocket.close();
    client.connect();
    const replacementSocket = (client as any).ws as MockWebSocket;
    replacementSocket.onopen?.();
    finishTokenRead?.(null);
    await staleChallenge;

    expect(staleSocket.send).not.toHaveBeenCalled();
    expect(replacementSocket.send).not.toHaveBeenCalled();
    expect((client as any).ws).toBe(replacementSocket);
    expect(client.getConnectionState()).toBe('challenging');
  });

  it('isolates replacement pending requests from a stale socket close', async () => {
    client.configure(openClawRecord());
    client.connect();
    const staleSocket = (client as any).ws as MockWebSocket;
    staleSocket.onopen?.();
    const lateClose = staleSocket.onclose;
    const staleRequest = (client as any).sendRequest('stale.method', {});
    const staleRejection = expect(staleRequest).rejects.toThrow('Connection superseded');

    staleSocket.readyState = MockWebSocket.CLOSED;
    client.connect();
    const replacementSocket = (client as any).ws as MockWebSocket;
    replacementSocket.onopen?.();
    const replacementRequest = (client as any).sendRequest('replacement.method', {});
    const replacementFrame = JSON.parse(replacementSocket.send.mock.calls[0][0]);

    lateClose?.();

    expect((client as any).ws).toBe(replacementSocket);
    expect(client.getConnectionState()).toBe('challenging');
    replacementSocket.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: replacementFrame.id,
        result: { current: true },
      }),
    });
    await expect(replacementRequest).resolves.toEqual({ current: true });
    await staleRejection;
  });

  it('transitions to closed on disconnect', () => {
    const states: string[] = [];
    client.on('connection', ({ state }) => states.push(state));
    client.configure(openClawRecord());
    client.connect();
    client.disconnect();
    expect(states).toContain('closed');
  });

  it('rejects backends that do not declare the nodes capability', () => {
    expect(() => client.configure({
      ...openClawRecord(),
      backendKind: 'hermes',
      label: 'Hermes',
    })).toThrow('NodeClient requires a connection with the nodes capability');
  });

  it('uses direct record auth and the direct device-token scope', async () => {
    const record = openClawRecord({
      url: 'https://gateway.example.test/',
      auth: { token: 'direct-runtime-token', password: 'unused-password' },
      // A stale Relay payload on a direct record must not change token scope.
      relay: {
        serverUrl: 'https://registry.example.test/',
        gatewayId: 'gw_stale',
        clientToken: 'gct_stale',
      },
    });
    client.configure(record);
    client.connect();
    const directSocket = (client as any).ws as MockWebSocket;
    directSocket.onopen?.();
    expect(directSocket.url).toBe('wss://gateway.example.test/');
    expect(new URL(directSocket.url).search).toBe('');
    const request = jest
      .spyOn(client as any, 'sendRequest')
      .mockResolvedValue({ auth: { deviceToken: 'direct-device-token' } });

    await (client as any).handleConnectChallenge('direct-nonce');

    expect(request).toHaveBeenCalledWith(
      'connect',
      expect.objectContaining({ auth: { token: 'direct-runtime-token' } }),
      expect.anything(),
    );
    expect(StorageService.getDeviceToken).toHaveBeenCalledWith(
      'a'.repeat(64),
      { gatewayUrl: 'https://gateway.example.test', role: 'node' },
    );
    expect(StorageService.setDeviceToken).toHaveBeenCalledWith(
      'a'.repeat(64),
      'direct-device-token',
      { gatewayUrl: 'https://gateway.example.test', role: 'node' },
    );

    record.url = 'ws://caller-mutated.example.test';
    client.connect();
    expect(((client as any).ws as MockWebSocket).url).toBe('wss://gateway.example.test/');
  });

  it('reuses an issued scoped device token for auth and signature on the next connection', async () => {
    jest.mocked(StorageService.getDeviceToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('issued-node-device-token');
    const request = jest
      .spyOn(client as any, 'sendRequest')
      .mockResolvedValueOnce({ auth: { deviceToken: 'issued-node-device-token' } })
      .mockResolvedValueOnce({});
    client.configure(openClawRecord({
      url: 'wss://gateway.example.test/ws',
      auth: { token: 'configured-bootstrap-token' },
    }));

    client.connect();
    ((client as any).ws as MockWebSocket).onopen?.();
    await (client as any).handleConnectChallenge('first-nonce');
    client.disconnect();
    client.connect();
    ((client as any).ws as MockWebSocket).onopen?.();
    await (client as any).handleConnectChallenge('second-nonce');

    expect(request.mock.calls[0][1]).toEqual(expect.objectContaining({
      auth: { token: 'configured-bootstrap-token' },
    }));
    expect(request.mock.calls[1][1]).toEqual(expect.objectContaining({
      auth: { deviceToken: 'issued-node-device-token' },
    }));
    const signedPayloads = jest.mocked(nacl.sign.detached).mock.calls.map(
      ([payload]) => new TextDecoder().decode(payload),
    );
    expect(signedPayloads[0]).toContain('|configured-bootstrap-token|first-nonce');
    expect(signedPayloads[1]).toContain('|issued-node-device-token|second-nonce');
    expect(StorageService.setDeviceToken).toHaveBeenCalledWith(
      'a'.repeat(64),
      'issued-node-device-token',
      { gatewayUrl: 'wss://gateway.example.test/ws', role: 'node' },
    );
    expect(StorageService.getDeviceToken).toHaveBeenNthCalledWith(
      2,
      'a'.repeat(64),
      { gatewayUrl: 'wss://gateway.example.test/ws', role: 'node' },
    );
  });

  it('uses a bootstrap credential when no scoped or legacy token exists', async () => {
    const request = jest
      .spyOn(client as any, 'sendRequest')
      .mockResolvedValue({});
    client.configure(openClawRecord({
      auth: undefined,
      bootstrap: {
        token: 'mobile-bootstrap-token',
        strategy: 'mobile-setup',
      },
    }));

    client.connect();
    ((client as any).ws as MockWebSocket).onopen?.();
    await (client as any).handleConnectChallenge('bootstrap-nonce');

    expect(request).toHaveBeenCalledWith(
      'connect',
      expect.objectContaining({ auth: { bootstrapToken: 'mobile-bootstrap-token' } }),
      expect.anything(),
    );
    const signedPayload = new TextDecoder().decode(
      jest.mocked(nacl.sign.detached).mock.calls[0][0],
    );
    expect(signedPayload).toContain('|mobile-bootstrap-token|bootstrap-nonce');
  });

  it('drops a rejected scoped device token and falls back to configured auth', async () => {
    jest.mocked(StorageService.getDeviceToken)
      .mockResolvedValueOnce('stale-node-device-token')
      .mockResolvedValueOnce(null);
    client.configure(openClawRecord({ auth: { token: 'configured-bootstrap-token' } }));

    client.connect();
    const staleSocket = (client as any).ws as MockWebSocket;
    staleSocket.onopen?.();
    staleSocket.send.mockImplementation((raw: string) => {
      const frame = JSON.parse(raw);
      queueMicrotask(() => staleSocket.onmessage?.({
        data: JSON.stringify({
          type: 'res',
          id: frame.id,
          error: {
            code: 'AUTH_TOKEN_MISMATCH',
            message: 'device token mismatch',
          },
        }),
      }));
    });
    await (client as any).handleConnectChallenge('stale-token-nonce');

    expect(StorageService.deleteDeviceToken).toHaveBeenCalledWith(
      'a'.repeat(64),
      { gatewayUrl: 'ws://localhost:18789', role: 'node' },
    );
    client.connect();
    const fallbackSocket = (client as any).ws as MockWebSocket;
    fallbackSocket.onopen?.();
    fallbackSocket.send.mockImplementation((raw: string) => {
      const frame = JSON.parse(raw);
      queueMicrotask(() => fallbackSocket.onmessage?.({
        data: JSON.stringify({ type: 'res', id: frame.id, result: {} }),
      }));
    });
    await (client as any).handleConnectChallenge('fallback-nonce');

    const staleConnect = JSON.parse(staleSocket.send.mock.calls[0][0]);
    const fallbackConnect = JSON.parse(fallbackSocket.send.mock.calls[0][0]);
    expect(staleConnect.params).toEqual(expect.objectContaining({
      auth: { deviceToken: 'stale-node-device-token' },
    }));
    expect(fallbackConnect.params).toEqual(expect.objectContaining({
      auth: { token: 'configured-bootstrap-token' },
    }));
    const signedPayloads = jest.mocked(nacl.sign.detached).mock.calls.map(
      ([payload]) => new TextDecoder().decode(payload),
    );
    expect(signedPayloads[0]).toContain('|stale-node-device-token|stale-token-nonce');
    expect(signedPayloads[1]).toContain('|configured-bootstrap-token|fallback-nonce');
  });

  it.each([
    ['gateway id', { gatewayId: ' ', clientToken: 'gct_runtime' }],
    ['client token', { gatewayId: 'gw_runtime', clientToken: ' ' }],
  ])('fails closed before opening Relay when the %s is missing', (_field, relayIdentity) => {
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (error) => errors.push(error));
    client.configure(openClawRecord({
      transportKind: 'relay',
      url: 'wss://relay.example.test/ws',
      relay: {
        serverUrl: 'https://registry.example.test',
        ...relayIdentity,
      },
    }));

    client.connect();

    expect((client as any).ws).toBeNull();
    expect(client.getConnectionState()).toBe('closed');
    expect(errors).toEqual([{
      code: 'config_missing',
      message: 'Relay connection is not configured',
    }]);
  });

  it('fails closed before opening Relay when the local connection id is missing', () => {
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (error) => errors.push(error));
    client.configure(openClawRecord({
      id: ' ',
      transportKind: 'relay',
      url: 'wss://relay.example.test/ws',
      relay: {
        serverUrl: 'https://registry.example.test',
        gatewayId: 'gw_runtime',
        clientToken: 'gct_runtime',
      },
    }));

    client.connect();

    expect((client as any).ws).toBeNull();
    expect(client.getConnectionState()).toBe('closed');
    expect(errors).toEqual([{
      code: 'config_missing',
      message: 'Relay connection is not configured',
    }]);
  });

  it('uses a stable Relay node client id that stays distinct across local connection records', () => {
    const readClientId = (connectionId: string): string | null => {
      const isolatedClient = new NodeClient();
      isolatedClient.configure(openClawRecord({
        id: connectionId,
        transportKind: 'relay',
        url: 'wss://relay.example.test/ws',
        relay: {
          serverUrl: 'https://registry.example.test',
          gatewayId: 'gw_runtime',
          clientToken: 'gct_runtime',
        },
      }));
      isolatedClient.connect();
      const clientId = new URL((isolatedClient as any).ws.url).searchParams.get('clientId');
      isolatedClient.disconnect();
      return clientId;
    };

    const first = readClientId('device-a-connection');
    expect(first).toBe('clawket-node:device-a-connection');
    expect(readClientId('device-a-connection')).toBe(first);
    expect(readClientId('device-b-connection')).not.toBe(first);
  });

  it('uses Relay record auth and the gateway-scoped Relay token record', async () => {
    client.configure(openClawRecord({
      transportKind: 'relay',
      url: 'wss://relay.example.test/ws',
      auth: { token: 'relay-runtime-token' },
      relay: {
        serverUrl: 'https://registry.example.test///',
        gatewayId: '  gw_runtime  ',
        clientToken: 'gct_runtime',
      },
    }));
    client.connect();
    const relaySocket = (client as any).ws as MockWebSocket;
    relaySocket.onopen?.();
    const relayUrl = new URL(relaySocket.url);
    expect(relayUrl.protocol).toBe('wss:');
    expect(relayUrl.pathname).toBe('/ws');
    expect(relayUrl.searchParams.get('gatewayId')).toBe('gw_runtime');
    expect(relayUrl.searchParams.get('role')).toBe('client');
    expect(relayUrl.searchParams.get('clientId')).toBe('clawket-node:openclaw-node');
    expect(relayUrl.searchParams.get('token')).toBe('gct_runtime');
    expect(relayUrl.searchParams.get('capabilities')).toBe(RELAY_CLIENT_PONG_CAPABILITY);
    expect(relaySocket.url).not.toContain('relay-runtime-token');
    const request = jest
      .spyOn(client as any, 'sendRequest')
      .mockResolvedValue({ auth: { deviceToken: 'relay-device-token' } });

    await (client as any).handleConnectChallenge('relay-nonce');

    expect(request).toHaveBeenCalledWith(
      'connect',
      expect.objectContaining({ auth: { token: 'relay-runtime-token' } }),
      expect.anything(),
    );
    expect(StorageService.setDeviceToken).toHaveBeenCalledWith(
      'a'.repeat(64),
      'relay-device-token',
      {
        serverUrl: 'https://registry.example.test',
        gatewayId: 'gw_runtime',
        role: 'node',
      },
    );
  });

  it('acknowledges negotiated Relay ticks on the authenticated node socket', () => {
    client.configure(openClawRecord({
      transportKind: 'relay',
      url: 'wss://relay.example.test/ws',
      relay: {
        serverUrl: 'https://registry.example.test',
        gatewayId: 'gw_runtime',
        clientToken: 'gct_runtime',
      },
    }));
    client.connect();
    const relaySocket = (client as any).ws as MockWebSocket;
    relaySocket.onopen?.();

    relaySocket.onmessage?.({
      data: JSON.stringify({
        type: 'tick',
        ts: 1234,
        ack: RELAY_CLIENT_PONG_CAPABILITY,
      }),
    });

    expect(relaySocket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', ts: 1234 }));
  });

  it('emits invokeRequest event from node.invoke.request', () => {
    client.configure(openClawRecord());
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    const events: any[] = [];
    client.on('invokeRequest', (e) => events.push(e));

    // Simulate incoming invoke request
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        event: 'node.invoke.request',
        payload: {
          id: 'inv-1',
          nodeId: 'node-abc',
          command: 'device.info',
          paramsJSON: '{}',
          timeoutMs: 5000,
        },
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('inv-1');
    expect(events[0].command).toBe('device.info');
    expect(events[0].timeoutMs).toBe(5000);
  });

  it('sendInvokeResult sends frame over WebSocket', async () => {
    client.configure(openClawRecord());
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    // Simulate challenge → ready to set deviceId
    // We need to set deviceId manually since challenge flow is async
    (client as any).deviceId = 'device-123';

    client.sendInvokeResult('inv-1', { ok: true, payload: { platform: 'ios' } });

    expect(ws.send).toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
    expect(sent.method).toBe('node.invoke.result');
    expect(sent.params.id).toBe('inv-1');
    expect(sent.params.nodeId).toBe('device-123');
    expect(sent.params.ok).toBe(true);
    expect(sent.params.payload.platform).toBe('ios');
  });

  it('handles res frames for pending requests', () => {
    client.configure(openClawRecord());
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    // Create a pending request by accessing the sendRequest method
    const promise = (client as any).sendRequest('test.method', {});
    const sentData = JSON.parse(ws.send.mock.calls[0][0]);
    const requestId = sentData.id;

    // Simulate response
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: requestId,
        result: { success: true },
      }),
    });

    return expect(promise).resolves.toEqual({ success: true });
  });

  it('rejects pending requests on error response', () => {
    client.configure(openClawRecord());
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    const promise = (client as any).sendRequest('test.method', {});
    const sentData = JSON.parse(ws.send.mock.calls[0][0]);
    const requestId = sentData.id;

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: requestId,
        error: { code: 'FAIL', message: 'Something went wrong' },
      }),
    });

    return expect(promise).rejects.toThrow('Something went wrong');
  });

  it('does not send invoke result without deviceId', () => {
    client.configure(openClawRecord());
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    // deviceId is null by default
    const sendCallsBefore = ws.send.mock.calls.length;
    client.sendInvokeResult('inv-1', { ok: true, payload: {} });
    expect(ws.send.mock.calls.length).toBe(sendCallsBefore);
  });

  it('rejects oversized invoke results before WebSocket.send', () => {
    client.configure(openClawRecord());
    client.connect();
    const ws = (client as any).ws as MockWebSocket;
    (client as any).deviceId = 'device-123';
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (error) => errors.push(error));

    client.sendInvokeResult('inv-1', {
      ok: true,
      payload: { value: '😀'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES / 4) },
    });

    expect(ws.send).not.toHaveBeenCalled();
    expect(errors).toContainEqual({
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
    });
  });

  it('rejects oversized inbound frames before parsing', () => {
    client.configure(openClawRecord());
    client.connect();
    const ws = (client as any).ws as MockWebSocket;
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (error) => errors.push(error));

    ws.onmessage?.({ data: new ArrayBuffer(WEBSOCKET_FRAME_LIMIT_BYTES + 1) });

    expect(errors).toContainEqual({
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
    });
    expect(ws.close).toHaveBeenCalledWith(
      FRAME_TOO_LARGE_CLOSE_CODE,
      FRAME_TOO_LARGE_ERROR_CODE,
    );
  });
});
