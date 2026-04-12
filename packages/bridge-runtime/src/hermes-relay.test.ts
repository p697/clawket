import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  buildHermesRelayWsHeaders,
  buildHermesRelayWsUrl,
  HermesRelayRuntime,
} from './hermes-relay.js';

class FakeSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: Array<string | Buffer> = [];

  constructor(readonly url: string, readonly options?: { headers?: Record<string, string> }) {
    super();
  }

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  pushText(text: string): void {
    this.emit('message', text, false);
  }
}

function createConfig() {
  return {
    serverUrl: 'https://registry.example.com',
    bridgeId: 'hbg_123',
    relaySecret: 'hrs_secret',
    relayUrl: 'wss://relay.example.com/ws',
    instanceId: 'hermes-host',
    displayName: 'Hermes',
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
  } as const;
}

describe('hermes relay runtime helpers', () => {
  it('builds relay websocket URL with bridge identity but no token query', () => {
    const url = new URL(buildHermesRelayWsUrl({
      serverUrl: 'https://registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_secret',
      relayUrl: 'wss://relay.example.com/ws?token=legacy',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }));

    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('bridgeId')).toBe('hbg_123');
    expect(url.searchParams.get('role')).toBe('gateway');
    expect(url.searchParams.get('clientId')).toBe('hermes-host');
    expect(url.searchParams.get('token')).toBeNull();
  });

  it('builds Hermes relay bearer auth headers', () => {
    expect(buildHermesRelayWsHeaders({ relaySecret: 'hrs_secret' })).toEqual({
      Authorization: 'Bearer hrs_secret',
    });
  });

  it('does not forward relay control frames into the Hermes bridge socket', async () => {
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const bridgeSocket = sockets[1];
    bridgeSocket.open();

    relaySocket.pushText('__clawket_relay_control__:{"event":"client_count","payload":{"count":1}}');
    relaySocket.pushText('{"type":"req","id":"req_1","method":"chat.send"}');

    expect(bridgeSocket.sent).toEqual(['{"type":"req","id":"req_1","method":"chat.send"}']);

    await runtime.stop();
  });

  it('restarts relay and bridge sockets when cloud bridge status reports hasBridge=false', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const fetchCalls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      bridgeStatusPollIntervalMs: 1,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({
          url: String(url),
          headers: init?.headers as Record<string, string> | undefined,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ hasBridge: false }),
        } as Response;
      }) as typeof fetch,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
      onLog: (line) => {
        logs.push(line);
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const bridgeSocket = sockets[1];
    bridgeSocket.open();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://relay.example.com/v1/internal/hermes/bridge-status?bridgeId=hbg_123');
    expect(fetchCalls[0]?.headers).toEqual({
      authorization: 'Bearer hrs_secret',
      accept: 'application/json',
    });
    expect(logs).toContain('bridge status probe reported hasBridge=false; restarting relay socket');
    expect(relaySocket.readyState).toBe(FakeSocket.CLOSED);
    expect(bridgeSocket.readyState).toBe(FakeSocket.CLOSED);

    await runtime.stop();
  });

  it('keeps relay open when cloud bridge status confirms hasBridge=true', async () => {
    const sockets: FakeSocket[] = [];
    const fetchCalls: string[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      bridgeStatusPollIntervalMs: 1,
      fetchImpl: (async (url: string | URL | Request) => {
        fetchCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ hasBridge: true }),
        } as Response;
      }) as typeof fetch,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const bridgeSocket = sockets[1];
    bridgeSocket.open();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(relaySocket.readyState).toBe(FakeSocket.OPEN);
    expect(bridgeSocket.readyState).toBe(FakeSocket.OPEN);

    await runtime.stop();
  });

  it('probes the local Hermes bridge connection and consumes the health response locally', async () => {
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      bridgeStatusPollIntervalMs: 1,
      bridgeHealthProbeTimeoutMs: 50,
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hasBridge: true }),
      })) as typeof fetch,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const bridgeSocket = sockets[1];
    bridgeSocket.open();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const healthProbe = bridgeSocket.sent.find((entry) => String(entry).includes('"method":"health"'));
    expect(healthProbe).toBeTruthy();
    expect(String(healthProbe)).toContain('"method":"health"');

    const parsedProbe = JSON.parse(String(healthProbe)) as { id: string };
    bridgeSocket.pushText(JSON.stringify({
      type: 'res',
      id: parsedProbe.id,
      ok: true,
      payload: { status: 'ok' },
    }));

    const relayMessagesBefore = relaySocket.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(relaySocket.sent).toHaveLength(relayMessagesBefore);

    await runtime.stop();
  });

  it('restarts the local Hermes bridge socket when the health probe times out', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      bridgeStatusPollIntervalMs: 1,
      bridgeHealthProbeTimeoutMs: 5,
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hasBridge: true }),
      })) as typeof fetch,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
      onLog: (line) => {
        logs.push(line);
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const firstBridgeSocket = sockets[1];
    firstBridgeSocket.open();

    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(logs).toContain('bridge health probe timed out; restarting bridge socket');
    expect(firstBridgeSocket.readyState).toBe(FakeSocket.CLOSED);
    expect(sockets.length).toBeGreaterThan(2);
    const secondBridgeSocket = sockets[sockets.length - 1];
    expect(secondBridgeSocket).not.toBe(firstBridgeSocket);

    await runtime.stop();
  });

  it('restarts the local Hermes bridge socket when the health probe returns ok=false', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      bridgeStatusPollIntervalMs: 1,
      bridgeHealthProbeTimeoutMs: 50,
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ hasBridge: true }),
      })) as typeof fetch,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
      onLog: (line) => {
        logs.push(line);
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const firstBridgeSocket = sockets[1];
    firstBridgeSocket.open();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const healthProbe = firstBridgeSocket.sent.find((entry) => String(entry).includes('"method":"health"'));
    expect(healthProbe).toBeTruthy();
    const parsedProbe = JSON.parse(String(healthProbe)) as { id: string };
    firstBridgeSocket.pushText(JSON.stringify({
      type: 'res',
      id: parsedProbe.id,
      ok: false,
      error: { code: 'degraded', message: 'degraded' },
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logs).toContain('bridge health probe failed with an error response; restarting bridge socket');
    expect(firstBridgeSocket.readyState).toBe(FakeSocket.CLOSED);

    await runtime.stop();
  });

  it('ignores stale relay socket close events after a replacement relay socket becomes current', async () => {
    const sockets: FakeSocket[] = [];
    const snapshots: Array<{ relayConnected: boolean; bridgeConnected: boolean; lastError: string | null }> = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
      onStatus: (snapshot) => {
        snapshots.push({
          relayConnected: snapshot.relayConnected,
          bridgeConnected: snapshot.bridgeConnected,
          lastError: snapshot.lastError,
        });
      },
    });

    runtime.start();
    const firstRelaySocket = sockets[0];
    firstRelaySocket.open();
    const firstBridgeSocket = sockets[1];
    firstBridgeSocket.open();

    (runtime as any).relaySocket = null;
    (runtime as any).connectRelay();
    const secondRelaySocket = sockets[2];
    secondRelaySocket.open();

    firstRelaySocket.close(4010, 'duplicate_socket');

    expect(runtime.getSnapshot().relayConnected).toBe(true);
    expect(runtime.getSnapshot().bridgeConnected).toBe(true);
    expect(runtime.getSnapshot().lastError).toBeNull();
    expect(firstBridgeSocket.readyState).toBe(FakeSocket.OPEN);
    expect(secondRelaySocket.readyState).toBe(FakeSocket.OPEN);
    expect(snapshots.at(-1)).toEqual({
      relayConnected: true,
      bridgeConnected: true,
      lastError: null,
    });

    await runtime.stop();
  });

  it('ignores stale bridge socket close events after a replacement bridge socket becomes current', async () => {
    const sockets: FakeSocket[] = [];
    const snapshots: Array<{ relayConnected: boolean; bridgeConnected: boolean; lastError: string | null }> = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
      onStatus: (snapshot) => {
        snapshots.push({
          relayConnected: snapshot.relayConnected,
          bridgeConnected: snapshot.bridgeConnected,
          lastError: snapshot.lastError,
        });
      },
    });

    runtime.start();
    const relaySocket = sockets[0];
    relaySocket.open();
    const firstBridgeSocket = sockets[1];
    firstBridgeSocket.open();

    (runtime as any).bridgeSocket = null;
    (runtime as any).connectBridge();
    const secondBridgeSocket = sockets[2];
    secondBridgeSocket.open();

    firstBridgeSocket.close(1005, '');

    expect(runtime.getSnapshot().relayConnected).toBe(true);
    expect(runtime.getSnapshot().bridgeConnected).toBe(true);
    expect(runtime.getSnapshot().lastError).toBeNull();
    expect(secondBridgeSocket.readyState).toBe(FakeSocket.OPEN);
    expect(snapshots.at(-1)).toEqual({
      relayConnected: true,
      bridgeConnected: true,
      lastError: null,
    });

    await runtime.stop();
  });
});
