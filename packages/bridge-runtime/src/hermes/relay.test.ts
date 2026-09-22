import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  buildHermesRelayWsHeaders,
  buildHermesRelayWsUrl,
  HermesRelayRuntime,
} from './relay.js';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from '../frame-limit.js';

class FakeSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: Array<string | Buffer> = [];
  autoPong = true;
  pings: string[] = [];
  terminated = false;
  closeCode?: number;
  closeReason?: string;

  constructor(
    readonly url: string,
    readonly options?: { headers?: Record<string, string>; maxPayload?: number },
  ) {
    super();
  }

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  ping(data: string): void {
    this.pings.push(data);
    if (this.autoPong) this.emit('pong', Buffer.from(data));
  }

  terminate(): void {
    this.terminated = true;
    this.close(1006);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  pushText(text: string): void {
    this.emit('message', text, false);
  }

  pushBinary(data: Buffer): void {
    this.emit('message', data, true);
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
  it('converges to one owner when two runtimes share the persisted pairing identity', async () => {
    vi.useFakeTimers();
    let owner: FakeSocket | undefined;
    let cloudConnections = 0;
    const sockets: FakeSocket[] = [];
    const createWebSocket = (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      if (url.startsWith('wss:')) {
        cloudConnections++;
        socket.once('open', () => {
          const previous = owner;
          owner = socket;
          previous?.close(4010, 'duplicate_socket');
        });
      }
      return socket as never;
    };
    const options = { config: createConfig(), bridgeUrl: 'ws://localhost/bridge',
      reconnectBaseDelayMs: 10, reconnectMaxDelayMs: 10, createWebSocket };
    const first = new HermesRelayRuntime(options);
    const second = new HermesRelayRuntime(options);
    try {
      first.start(); sockets[0].open(); sockets[1].open();
      second.start(); sockets[2].open(); sockets[3].open();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(cloudConnections).toBe(2);
      expect(first.getSnapshot().running).toBe(false);
      expect(second.getSnapshot()).toMatchObject({ running: true, relayConnected: true, bridgeConnected: true });
      expect(owner).toBe(sockets[2]);
    } finally { await first.stop(); await second.stop(); vi.useRealTimers(); }
  });

  it.each([
    [4010, 'duplicate_socket'],
    [4001, 'replaced_by_new_bridge'],
  ])('yields to a replacement owner instead of starting a reconnect fight (%s)', async (code, reason) => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(), bridgeUrl: 'ws://localhost/bridge',
      reconnectBaseDelayMs: 10, reconnectMaxDelayMs: 10,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });
    try {
      runtime.start(); sockets[0].open(); sockets[1].open();
      sockets[0].close(code, reason);
      expect(runtime.getSnapshot()).toMatchObject({
        running: false, relayConnected: false, bridgeConnected: false,
        lastError: expect.stringContaining('another Hermes relay runtime'),
      });
      expect(sockets[1].readyState).toBe(FakeSocket.CLOSED);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sockets).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
      // An explicit operator restart is still supported.
      runtime.start();
      expect(sockets).toHaveLength(3);
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it.each([
    [4010, 'dead_socket'], [4010, 'orphan_socket'], [1006, ''],
    [4010, ''], [4001, 'unexpected_reason'],
  ])('retains automatic recovery for non-replacement closes (%s / %s)', async (code, reason) => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(), bridgeUrl: 'ws://localhost/bridge',
      reconnectBaseDelayMs: 10, reconnectMaxDelayMs: 10,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });
    try {
      runtime.start(); sockets[0].open(); sockets[1].open();
      sockets[0].close(code, reason);
      await vi.advanceTimersByTimeAsync(100);
      expect(runtime.getSnapshot().running).toBe(true);
      expect(sockets).toHaveLength(3);
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it('suppresses only idle periodic snapshots with explicit zero clients, preserving legacy and reconnect traffic', async () => {
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({ config: createConfig(), bridgeUrl: 'ws://localhost/bridge',
      createWebSocket: (url, options) => { const socket = new FakeSocket(url, options); sockets.push(socket); return socket as never; },
    });
    try {
      runtime.start(); sockets[0].open(); sockets[1].open();
      const [relay, bridge] = sockets;
      const tick = JSON.stringify({ type: 'event', event: 'tick', payload: {} });
      const health = JSON.stringify({ type: 'event', event: 'health', payload: { status: 'ok' } });
      bridge.pushText(tick); bridge.pushText(health);
      expect(relay.sent).toEqual([tick, health]);
      relay.pushText('__clawket_relay_control__:{"event":"client_count","count":0}');
      bridge.pushText(tick); bridge.pushText(health);
      expect(relay.sent).toHaveLength(2);
      const reply = '{"type":"res","id":"client-health","ok":true}';
      const chat = '{"type":"event","event":"chat","payload":{"state":"final"}}';
      bridge.pushText(reply); bridge.pushText(chat);
      expect(relay.sent.slice(-2)).toEqual([reply, chat]);
      relay.pushText('__clawket_relay_control__:{"event":"gateway_ping","ts":123}');
      expect(String(relay.sent.at(-1))).toContain('gateway_pong');
      relay.pushText('__clawket_relay_control__:{"event":"client_connected","count":1}');
      bridge.pushText(tick); bridge.pushText(health);
      expect(relay.sent.slice(-2)).toEqual([tick, health]);
      relay.pushText('__clawket_relay_control__:{"event":"client_count","count":"0"}');
      bridge.pushText(tick);
      expect(relay.sent.at(-1)).toBe(tick);
    } finally { await runtime.stop(); }
  });

  it('ignores a retired local socket and an old cloud status result after reconnect', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let resolveStatus!: (response: Response) => void;
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>(resolve => { resolveStatus = resolve; });
    });
    const runtime = new HermesRelayRuntime({ config: createConfig(), bridgeUrl: 'ws://localhost/bridge',
      bridgeStatusPollIntervalMs: 100, bridgeHealthProbeIntervalMs: 60_000,
      reconnectBaseDelayMs: 10, reconnectMaxDelayMs: 10,
      fetchImpl: fetchMock as typeof fetch,
      createWebSocket: (url, options) => { const socket = new FakeSocket(url, options); sockets.push(socket); return socket as never; },
    });
    try {
      runtime.start();
      const oldRelay = sockets[0]; oldRelay.open();
      const oldBridge = sockets[1]; oldBridge.open();
      oldRelay.pushText('__clawket_relay_control__:{"event":"client_count","count":0}');
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      oldRelay.close();
      expect(signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(10);
      const newRelay = sockets[2]; newRelay.open();
      resolveStatus(Response.json({ hasBridge: false }));
      await vi.advanceTimersByTimeAsync(0);
      expect(newRelay.readyState).toBe(FakeSocket.OPEN);
      expect(runtime.getSnapshot().relayConnected).toBe(true);
      const newBridge = sockets[3]; newBridge.open();
      newBridge.pushText('{"type":"event","event":"health"}');
      expect(newRelay.sent.at(-1)).toBe('{"type":"event","event":"health"}');
      const before = newRelay.sent.length;
      oldBridge.pushText('{"type":"event","event":"chat","payload":{"state":"error"}}');
      oldBridge.pushBinary(Buffer.from('stale'));
      expect(newRelay.sent).toHaveLength(before);
      newBridge.pushText('{"type":"event","event":"chat","payload":{"state":"final"}}');
      expect(newRelay.sent).toHaveLength(before + 1);
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it('bounds a hung status request without closing a healthy relay and resumes later probes', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const runtime = new HermesRelayRuntime({ config: createConfig(), bridgeUrl: 'ws://localhost/bridge',
      bridgeStatusPollIntervalMs: 100, bridgeHealthProbeIntervalMs: 60_000,
      fetchImpl: fetchMock as typeof fetch,
      createWebSocket: (url, options) => { const socket = new FakeSocket(url, options); sockets.push(socket); return socket as never; },
    });
    try {
      runtime.start(); sockets[0].open(); sockets[1].open();
      await vi.advanceTimersByTimeAsync(100);
      const firstSignal = signal;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(firstSignal.aborted).toBe(true);
      expect(runtime.getSnapshot().relayConnected).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await runtime.stop();
      expect(signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it('recycles a half-open cloud socket even while local Bridge health succeeds', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=test',
      relayPingIntervalMs: 100,
      relayPongTimeoutMs: 50,
      bridgeHealthProbeIntervalMs: 30,
      reconnectBaseDelayMs: 10,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });
    try {
      runtime.start();
      const relay = sockets[0];
      relay.autoPong = false;
      relay.open();
      const bridge = sockets[1];
      bridge.open();
      await vi.advanceTimersByTimeAsync(30);
      const probe = JSON.parse(String(bridge.sent[0]));
      bridge.pushText(JSON.stringify({ type: 'res', id: probe.id, ok: true, payload: { status: 'ok' } }));
      await vi.advanceTimersByTimeAsync(70);
      expect(relay.pings).toHaveLength(1);
      relay.emit('pong', Buffer.from('unrelated'));
      await vi.advanceTimersByTimeAsync(50);
      expect(relay.terminated).toBe(true);
      expect(runtime.getSnapshot().relayConnected).toBe(false);
      expect(runtime.getSnapshot().lastError).toBe('relay transport pong timed out');
      await vi.advanceTimersByTimeAsync(20);
      expect(sockets).toHaveLength(3);
      sockets[2].open();
      await vi.advanceTimersByTimeAsync(400);
      expect(sockets[2].pings.length).toBeGreaterThan(1);
      expect(sockets[2].terminated).toBe(false);
      // A late old-socket frame must not enter the new backend connection.
      const sent = bridge.sent.length;
      relay.pushText('{"type":"req","id":"stale","method":"chat.send"}');
      expect(bridge.sent).toHaveLength(sent);
    } finally {
      await runtime.stop();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it('cleans up a pending cloud pong deadline when stopped', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=test',
      relayPingIntervalMs: 100,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        socket.autoPong = false;
        sockets.push(socket);
        return socket as never;
      },
    });
    try {
      runtime.start();
      sockets[0].open();
      await vi.advanceTimersByTimeAsync(100);
      await runtime.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(sockets).toHaveLength(2);
      expect(sockets[0].terminated).toBe(false);
    } finally {
      await runtime.stop();
      vi.useRealTimers();
    }
  });

  it('does not reset reconnect backoff from a raw stable WebSocket open', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=test',
      createWebSocket: ((url: string, options?: { headers?: Record<string, string>; maxPayload?: number }) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as any;
      }),
      onLog: (line) => logs.push(line),
    });
    try {
      runtime.start();
      sockets[0].open();
      await vi.advanceTimersByTimeAsync(30_001);
      expect(logs).not.toContain('relay stable window reached; reconnect backoff reset');
    } finally {
      await runtime.stop();
      vi.useRealTimers();
    }
  });

  it('resumes local health probes when cloud reconnect reuses the local socket', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let hasBridge = false;
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=test',
      bridgeStatusPollIntervalMs: 100,
      bridgeHealthProbeIntervalMs: 30,
      reconnectBaseDelayMs: 1_000,
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ hasBridge }) })) as unknown as typeof fetch,
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket as never;
      },
    });
    try {
      runtime.start();
      sockets[0].open();
      const local = sockets[1];
      local.open();
      await vi.advanceTimersByTimeAsync(1_100);
      expect(sockets).toHaveLength(3);
      expect(local.readyState).toBe(FakeSocket.OPEN);
      const before = local.sent.length;
      hasBridge = true;
      sockets[2].open();
      await vi.advanceTimersByTimeAsync(30);
      expect(local.sent.length).toBeGreaterThan(before);
      expect(JSON.parse(String(local.sent.at(-1))).method).toBe('health');
    } finally {
      await runtime.stop();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

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

  it('forwards Bridge-version health frames byte-identically', async () => {
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

    const initialHealth = '{"type":"event","event":"health","payload":{"status":"ok","bridgeVersion":"3.0.0-test"}}';
    bridgeSocket.pushText(initialHealth);
    expect(relaySocket.sent).toEqual([initialHealth]);

    const healthRequest = '{"type":"req","id":"client-health","method":"health","params":{}}';
    relaySocket.pushText(healthRequest);
    expect(bridgeSocket.sent).toContain(healthRequest);
    const healthResponse = '{"type":"res","id":"client-health","ok":true,"payload":{"status":"ok","bridgeVersion":"3.0.0-test"}}';
    bridgeSocket.pushText(healthResponse);
    expect(relaySocket.sent).toEqual([initialHealth, healthResponse]);

    await runtime.stop();
  });

  it('enforces the 8 MiB frame boundary on both Hermes relay sockets', async () => {
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
    expect(relaySocket.options?.maxPayload).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
    relaySocket.open();
    const bridgeSocket = sockets[1];
    expect(bridgeSocket.options?.maxPayload).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
    bridgeSocket.open();

    const exactBoundary = Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES);
    relaySocket.pushBinary(exactBoundary);
    expect((bridgeSocket.sent.at(-1) as Buffer).byteLength).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
    bridgeSocket.pushBinary(exactBoundary);
    expect((relaySocket.sent.at(-1) as Buffer).byteLength).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);

    const oversized = Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES + 1);
    bridgeSocket.pushBinary(oversized);
    expect(bridgeSocket.closeCode).toBe(FRAME_TOO_LARGE_CLOSE_CODE);
    expect(bridgeSocket.closeReason).toBe(FRAME_TOO_LARGE_ERROR_CODE);
    expect(relaySocket.sent).toHaveLength(1);

    relaySocket.pushBinary(oversized);
    expect(relaySocket.closeCode).toBe(FRAME_TOO_LARGE_CLOSE_CODE);
    expect(relaySocket.closeReason).toBe(FRAME_TOO_LARGE_ERROR_CODE);

    await runtime.stop();
  });

  it('recycles only the relay socket when cloud bridge status reports hasBridge=false', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const fetchCalls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const runtime = new HermesRelayRuntime({
      config: createConfig(),
      bridgeUrl: 'ws://127.0.0.1:4319/v1/hermes/ws?token=secret',
      bridgeStatusPollIntervalMs: 1,
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1,
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
    expect(logs).toContain('bridge status probe reported hasBridge=false; recycling relay socket');
    expect(relaySocket.readyState).toBe(FakeSocket.CLOSED);
    expect(bridgeSocket.readyState).toBe(FakeSocket.OPEN);
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(3));
    expect(sockets[2]?.url).toContain('wss://relay.example.com/ws');

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
