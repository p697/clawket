import nacl from 'tweetnacl';
import openClawFixture from '../../../../../tests/compat/fixtures/v1/relay-openclaw/openclaw-v1.json';
import hermesFixture from '../../../../../tests/compat/fixtures/v1/relay-hermes/hermes-v1.json';
import unknownControlFixture from '../../../../../tests/compat/fixtures/v1/relay-openclaw/unknown-control-v1.json';
import {
  buildDeviceAuthPayload,
  bytesToHex,
  deriveDeviceId,
  hexToBytes,
} from '../../services/gateway-auth';
import type { DeviceIdentity } from '../../types';
import {
  WEB_SOCKET_CONNECTING,
  WEB_SOCKET_OPEN,
  type WebSocketCloseEventLike,
  type WebSocketLike,
} from '../transports';
import {
  HERMES_GATEWAY_PROTOCOL_PROFILE,
  OPENCLAW_GATEWAY_PROTOCOL_PROFILE,
} from '../adapters/gateway-profiles';
import { GatewayProtocolClient } from './gateway-client';

class FakeSocket implements WebSocketLike {
  public readyState = WEB_SOCKET_CONNECTING;
  public onopen: ((event?: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event?: { message?: string; type?: string }) => void) | null = null;
  public onclose: ((event?: WebSocketCloseEventLike) => void) | null = null;
  public readonly sent: unknown[] = [];

  public open(): void {
    this.readyState = WEB_SOCKET_OPEN;
    this.onopen?.();
  }

  public receive(value: unknown): void {
    this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) });
  }

  public send(data: unknown): void {
    this.sent.push(data);
  }

  public close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

type RecordedFrame = {
  sequence: number;
  label: string;
  payload: unknown;
};

function frame(fixture: { frames: RecordedFrame[] }, label: string): any {
  const match = fixture.frames.find((entry) => entry.label === label);
  if (!match) throw new Error(`Missing recorded frame: ${label}`);
  return match.payload;
}

function deterministicIdentity(): DeviceIdentity {
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
  return {
    deviceId: deriveDeviceId(keyPair.publicKey),
    publicKeyHex: bytesToHex(keyPair.publicKey),
    secretKeyHex: bytesToHex(keyPair.secretKey),
    createdAt: '2026-09-05T00:00:00.000Z',
  };
}

function harness(profile = OPENCLAW_GATEWAY_PROTOCOL_PROFILE) {
  const identity = deterministicIdentity();
  const sockets: Array<{ url: string; socket: FakeSocket }> = [];
  let nextId = 0;
  const credentialStore = {
    getDeviceTokenRecord: jest.fn(async () => null),
    setDeviceTokenRecord: jest.fn(async () => undefined),
    deleteDeviceToken: jest.fn(async () => undefined),
  };
  const client = new GatewayProtocolClient({
    profile,
    identityProvider: async () => identity,
    credentialStore,
    requestId: () => `request-${++nextId}`,
    webSocketFactory: (url) => {
      const socket = new FakeSocket();
      sockets.push({ url, socket });
      return socket;
    },
    reconnectJitter: false,
    handshakeTimeoutMs: 500,
    directFirstFrameTimeoutMs: 500,
  });
  return { client, credentialStore, identity, sockets };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not reached');
}

function sentJson(socket: FakeSocket): Array<Record<string, any>> {
  return socket.sent
    .filter((value): value is string => typeof value === 'string' && value.startsWith('{'))
    .map((value) => JSON.parse(value) as Record<string, any>);
}

describe('GatewayProtocolClient recorded protocol', () => {
  it('forgets its in-memory device identity during a device reset', async () => {
    const identity = deterministicIdentity();
    const identityProvider = jest.fn(async () => identity);
    const client = new GatewayProtocolClient({
      profile: OPENCLAW_GATEWAY_PROTOCOL_PROFILE,
      identityProvider,
    });

    await client.getDeviceIdentity();
    await client.getDeviceIdentity();
    expect(identityProvider).toHaveBeenCalledTimes(1);

    client.resetDeviceIdentity();
    await client.getDeviceIdentity();
    expect(identityProvider).toHaveBeenCalledTimes(2);
  });

  it('keeps configured credentials, device identity, and transport URL out of enumerable state', async () => {
    const { client, identity, sockets } = harness();
    const credentials = {
      token: 'private-gateway-token',
      password: 'private-gateway-password',
      bootstrapToken: 'private-bootstrap-token',
      clientToken: 'private-relay-client-token',
    };
    client.configure({
      url: 'wss://private-gateway.invalid/ws',
      token: credentials.token,
      password: credentials.password,
      bootstrap: {
        token: credentials.bootstrapToken,
        strategy: 'mobile-setup',
      },
      backendKind: 'openclaw',
      transportKind: 'relay',
      relay: {
        serverUrl: 'wss://private-relay.invalid',
        gatewayId: 'private-gateway-id',
        clientToken: credentials.clientToken,
      },
    });
    client.connect();
    await waitFor(() => sockets.length === 1);

    const serialized = JSON.stringify(client);
    expect(Reflect.ownKeys(client)).not.toEqual(expect.arrayContaining([
      'config',
      'identity',
      'options',
      'transport',
    ]));
    for (const secret of [
      credentials.token,
      credentials.password,
      credentials.bootstrapToken,
      credentials.clientToken,
      identity.secretKeyHex,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    client.disconnect();
  });

  it('takes the current-model method from the adapter profile rather than legacy config fields', async () => {
    const client = new GatewayProtocolClient({
      profile: HERMES_GATEWAY_PROTOCOL_PROFILE,
    });
    client.configure({
      url: 'ws://127.0.0.1:8787/v1/hermes/ws',
      backendKind: 'openclaw',
      transportKind: 'local',
    });
    const sendRequest = jest.spyOn(
      client as unknown as {
        sendRequest(method: string, params: object): Promise<unknown>;
      },
      'sendRequest',
    ).mockResolvedValue({
      currentModel: 'fixture-model',
      currentProvider: 'fixture-provider',
    });

    await expect(client.getCurrentModelState()).resolves.toMatchObject({
      currentModel: 'fixture-model',
      currentProvider: 'fixture-provider',
    });
    expect(sendRequest).toHaveBeenCalledWith('model.current', {});
  });

  it('signs the recorded OpenClaw challenge and gates requests on connect success', async () => {
    const { client, identity, sockets } = harness();
    client.configure({
      url: 'ws://127.0.0.1:18789/ws',
      token: 'fixture-openclaw-token',
      backendKind: 'openclaw',
      transportKind: 'local',
    });
    client.connect();
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0].socket;
    socket.open();
    expect(client.getConnectionState()).toBe('challenging');
    await expect(client.request('sessions.list')).rejects.toMatchObject({ code: 'not_connected' });

    const challenge = frame(openClawFixture, 'connect-start.challenge');
    socket.receive(challenge);
    await waitFor(() => sentJson(socket).some((entry) => entry.method === 'connect'));
    const request = sentJson(socket).find((entry) => entry.method === 'connect')!;
    expect(request.meta).toBeUndefined();
    expect(request.params).toEqual(expect.objectContaining({
      minProtocol: 3,
      maxProtocol: 4,
      role: 'operator',
      scopes: [
        'operator.admin',
        'operator.approvals',
        'operator.pairing',
        'operator.questions',
        'operator.read',
        'operator.talk.secrets',
        'operator.write',
      ],
      auth: { token: 'fixture-openclaw-token' },
      device: expect.objectContaining({
        id: identity.deviceId,
        signedAt: challenge.payload.ts,
        nonce: challenge.payload.nonce,
      }),
    }));

    const authText = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: request.params.client.id,
      clientMode: 'ui',
      role: 'operator',
      scopes: request.params.scopes,
      signedAtMs: request.params.device.signedAt,
      token: 'fixture-openclaw-token',
      nonce: request.params.device.nonce,
      platform: request.params.client.platform,
      deviceFamily: request.params.client.deviceFamily,
    });
    expect(nacl.sign.detached.verify(
      new TextEncoder().encode(authText),
      decodeBase64Url(request.params.device.signature),
      hexToBytes(identity.publicKeyHex),
    )).toBe(true);

    const recordedResponse = frame(openClawFixture, 'connect-start.response');
    socket.receive({ ...recordedResponse, id: request.id });
    await waitFor(() => client.getConnectionState() === 'ready');

    const sessionsPromise = client.listSessions();
    await waitFor(() => sentJson(socket).some((entry) => entry.method === 'sessions.list'));
    const sessionsRequest = sentJson(socket).find((entry) => entry.method === 'sessions.list')!;
    expect(sessionsRequest.params).toEqual(
      frame(openClawFixture, 'sessions-list.request').params,
    );
    const sessionsResponse = frame(openClawFixture, 'sessions-list.response');
    socket.receive({ ...sessionsResponse, id: sessionsRequest.id });
    await expect(sessionsPromise).resolves.toEqual([]);
    client.disconnect();
  });

  it('keeps relay.ready additive, negotiates Bridge capabilities within the legacy Gateway schema, and acknowledges only capable ticks', async () => {
    const { client, identity, sockets } = harness();
    client.setConnectRequestMeta({ capabilities: ['bridge.capabilities.v2'] });
    client.configure({
      url: 'https://relay.fixture.invalid',
      token: 'fixture-openclaw-token',
      backendKind: 'openclaw',
      transportKind: 'relay',
      relay: {
        serverUrl: 'https://registry.fixture.invalid',
        gatewayId: 'gateway-id',
        clientToken: 'relay-client-token',
        supportsBootstrap: false,
      },
    });
    client.connect();
    await waitFor(() => sockets.length === 1);
    const { url, socket } = sockets[0];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe('/ws');
    expect(parsedUrl.searchParams.get('gatewayId')).toBe('gateway-id');
    expect(parsedUrl.searchParams.get('clientId')).toBe(identity.deviceId);
    expect(parsedUrl.searchParams.get('capabilities')).toBe('relay.client-pong.v1');
    socket.open();

    socket.receive(frame(unknownControlFixture, 'relay-ready.unknown-control'));
    expect(client.getConnectionState()).toBe('challenging');
    socket.receive(frame(unknownControlFixture, 'relay-ready.follow-up'));
    await waitFor(() => sentJson(socket).some((entry) => entry.method === 'connect'));
    const request = sentJson(socket).find((entry) => entry.method === 'connect')!;
    expect(request.meta).toBeUndefined();
    expect(request.params.caps).toEqual(['tool-events', 'bridge.capabilities.v2']);
    socket.receive({
      type: 'res',
      id: request.id,
      ok: true,
      payload: { server: { version: 'openclaw-gateway-2026.9.5', connId: 'relay' } },
      meta: {
        capabilities: ['bridge.capabilities.v2'],
        bridgeVersion: ' 3.0.0 ',
      },
    });
    await waitFor(() => client.getConnectionState() === 'ready');
    expect(client.getGatewayInfo()?.version).toBe('openclaw-gateway-2026.9.5');
    expect(client.getConnectResponseBridgeVersion()).toBe('3.0.0');
    expect(client.getConnectResponseCapabilities()).toEqual(['bridge.capabilities.v2']);

    const beforeTick = socket.sent.length;
    socket.receive(frame(openClawFixture, 'legacy.tick'));
    expect(socket.sent).toHaveLength(beforeTick);
    socket.receive(frame(openClawFixture, 'capable.tick'));
    expect(sentJson(socket).at(-1)).toEqual(frame(openClawFixture, 'capable.pong'));
    client.disconnect();
  });

  it('requests fresh Hermes Relay health when the initial Bridge event predates the client', async () => {
    const { client, sockets } = harness(HERMES_GATEWAY_PROTOCOL_PROFILE);
    client.configure({ url: 'https://hermes-relay.fixture.invalid', backendKind: 'hermes', transportKind: 'relay',
      relay: { serverUrl: 'https://registry.fixture.invalid', gatewayId: 'bridge-id',
        clientToken: 'fixture-client-token', supportsBootstrap: false } });
    client.connect();
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0].socket;
    socket.open();
    expect(client.getConnectionState()).toBe('challenging');
    const health = sentJson(socket).find((entry) => entry.method === 'health');
    expect(health).toBeDefined();
    if (!health) throw new Error('Missing Hermes health request');
    socket.receive({ type: 'res', id: health.id, ok: true, payload: frame(hermesFixture, 'health.event').payload });
    await waitFor(() => client.getConnectionState() === 'ready');
    client.disconnect();
  });

  it('waits for the recorded Hermes health frame and cannot revive after disconnect', async () => {
    const { client, sockets } = harness(HERMES_GATEWAY_PROTOCOL_PROFILE);
    const order: string[] = [];
    client.on('connection', ({ state }) => order.push(`connection:${state}`));
    client.on('health', () => order.push('health'));
    client.configure({
      url: 'ws://127.0.0.1:8787/v1/hermes/ws',
      backendKind: 'hermes',
      transportKind: 'local',
      mode: 'hermes',
    });
    client.connect();
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0].socket;
    socket.open();
    expect(client.getConnectionState()).toBe('challenging');
    expect(socket.sent).toEqual([]);

    socket.receive(frame(hermesFixture, 'health.event'));
    await waitFor(() => client.getConnectionState() === 'ready');
    expect(order.slice(-2)).toEqual(['connection:ready', 'health']);

    const sessionsPromise = client.listSessions();
    await waitFor(() => sentJson(socket).some((entry) => entry.method === 'sessions.list'));
    const request = sentJson(socket).find((entry) => entry.method === 'sessions.list')!;
    const response = frame(hermesFixture, 'sessions-list.response');
    socket.receive({ ...response, id: request.id });
    await expect(sessionsPromise).resolves.toEqual([
      expect.objectContaining({ key: 'agent:main:main', title: 'Main' }),
    ]);

    const lateHandler = socket.onmessage;
    client.disconnect();
    lateHandler?.({ data: JSON.stringify(frame(hermesFixture, 'health.event')) });
    expect(client.getConnectionState()).toBe('closed');
  });

  it('subscribes only when advertised and emits recorded session invalidations', async () => {
    const { client, sockets } = harness();
    const changes: Array<{ sessions?: unknown[] }> = [];
    client.on('sessionsChanged', (change) => changes.push(change));
    client.configure({
      url: 'ws://127.0.0.1:18789/ws',
      token: 'fixture-openclaw-token',
      backendKind: 'openclaw',
      transportKind: 'local',
    });
    client.connect();
    await waitFor(() => sockets.length === 1);
    const socket = sockets[0].socket;
    socket.open();
    socket.receive(frame(openClawFixture, 'connect-start.challenge'));
    await waitFor(() => sentJson(socket).some((entry) => entry.method === 'connect'));
    const connect = sentJson(socket).find((entry) => entry.method === 'connect')!;
    socket.receive({
      type: 'res',
      id: connect.id,
      ok: true,
      payload: {
        server: { version: 'openclaw-gateway-direct', connId: 'direct' },
        features: { methods: ['sessions.subscribe'] },
      },
      meta: {
        capabilities: ['bridge.capabilities.v2'],
        bridgeVersion: 'must-not-be-trusted-on-direct',
      },
    });
    await waitFor(() => sentJson(socket).some((entry) => entry.method === 'sessions.subscribe'));
    expect(client.getGatewayInfo()?.version).toBe('openclaw-gateway-direct');
    expect(client.getConnectResponseBridgeVersion()).toBeUndefined();
    expect(client.getConnectResponseCapabilities()).toBeUndefined();
    const subscribe = sentJson(socket).find((entry) => entry.method === 'sessions.subscribe')!;
    socket.receive({ type: 'res', id: subscribe.id, ok: true, payload: {} });
    const sessions = [{ key: 'agent:main:main', title: 'Recorded Main' }];
    socket.receive({ type: 'event', event: 'sessions.changed', payload: { sessions } });
    expect(changes).toEqual([{ sessions }]);
    client.disconnect();
  });
});

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
