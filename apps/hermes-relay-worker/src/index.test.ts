import { describe, expect, it, vi } from 'vitest';
import relayWorker, { __testing, HermesRelayRoom } from './index';
import { resolveClientLabelFromToken } from './relay/auth';

class MemoryKV {
  private map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: string, _options?: unknown): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    return {
      keys: Array.from(this.map.keys())
        .filter((key) => key.startsWith(prefix))
        .sort()
        .slice(0, limit)
        .map((name) => ({ name })),
    };
  }
}

class FakeStorage {
  alarmAt: number | null = null;
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  async list<T>(options?: { prefix?: string; reverse?: boolean; limit?: number }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? '';
    const reverse = options?.reverse ?? false;
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const entries = Array.from(this.map.entries())
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    if (reverse) entries.reverse();
    return new Map(entries.slice(0, limit) as Array<[string, T]>);
  }

  async delete(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;
    for (const item of keys) {
      if (this.map.delete(item)) deleted += 1;
    }
    return deleted;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }

  async setAlarm(at: number): Promise<void> {
    this.alarmAt = at;
  }
}

class FakeWebSocket {
  readonly readyState: number;
  private readonly attachment: unknown;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  shouldThrowOnSend = false;

  constructor({ readyState, attachment }: { readyState?: number; attachment?: unknown } = {}) {
    this.readyState = readyState ?? WebSocket.OPEN;
    this.attachment = attachment ?? null;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(payload: string): void {
    if (this.shouldThrowOnSend) {
      throw new Error('send failed');
    }
    this.sent.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }
}

function createHermesRelayRoomWithSockets(
  sockets: FakeWebSocket[] = [],
  envOverrides: Partial<ConstructorParameters<typeof HermesRelayRoom>[1]> = {},
): { room: HermesRelayRoom; storage: FakeStorage; kv: MemoryKV } {
  const storage = new FakeStorage();
  const kv = new MemoryKV();
  const state = {
    id: {
      toString: () => 'test-object-id',
    },
    storage,
    getWebSockets: () => sockets as unknown as WebSocket[],
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      void fn();
    },
  } as unknown as DurableObjectState;
  const env = {
    HERMES_ROUTES_KV: kv as unknown as KVNamespace,
    MAX_MESSAGES_PER_10S: '120',
    HEARTBEAT_INTERVAL_MS: '30000',
    ...envOverrides,
  } as unknown as ConstructorParameters<typeof HermesRelayRoom>[1];
  return {
    room: new HermesRelayRoom(state, env),
    storage,
    kv,
  };
}

describe('relay worker helpers', () => {
  it('parsePositiveInt returns fallback for invalid values', () => {
    expect(__testing.parsePositiveInt(undefined, 10)).toBe(10);
    expect(__testing.parsePositiveInt('0', 10)).toBe(10);
    expect(__testing.parsePositiveInt('abc', 10)).toBe(10);
  });

  it('parsePositiveInt parses valid numbers', () => {
    expect(__testing.parsePositiveInt('120', 10)).toBe(120);
  });

  it('normalizeMessage handles string and arraybuffer', () => {
    expect(__testing.normalizeMessage('hello')).toBe('hello');
    const bytes = new TextEncoder().encode('world').buffer;
    expect(__testing.normalizeMessage(bytes)).toBe('world');
  });

  it('detects connect.start and connect.challenge frames', () => {
    expect(
      __testing.isConnectStartReqFrame(
        JSON.stringify({ type: 'req', method: 'connect.start', params: { hello: 'world' } }),
      ),
    ).toBe(true);
    expect(
      __testing.isConnectStartReqFrame(
        JSON.stringify({ type: 'req', method: 'connect', params: { hello: 'world' } }),
      ),
    ).toBe(true);
    expect(
      __testing.isConnectStartReqFrame(
        JSON.stringify({ type: 'req', method: 'chat.send' }),
      ),
    ).toBe(false);

    expect(
      __testing.isConnectChallengeFrame(
        JSON.stringify({ type: 'event', event: 'connect.challenge' }),
      ),
    ).toBe(true);
    expect(
      __testing.isConnectChallengeFrame(
        JSON.stringify({ type: 'event', event: 'chat.delta' }),
      ),
    ).toBe(false);
  });

  it('expires buffered challenges after the short retry window', () => {
    const now = 10_000;
    expect(__testing.isPendingChallengeExpired(now - 5_000, now)).toBe(false);
    expect(__testing.isPendingChallengeExpired(now - 5_001, now)).toBe(true);
  });

  it('expires awaiting challenge entries using configurable TTL', () => {
    const now = 50_000;
    expect(__testing.isAwaitingChallengeExpired(now - 25_000, now, 25_000)).toBe(false);
    expect(__testing.isAwaitingChallengeExpired(now - 25_001, now, 25_000)).toBe(true);
  });

  it('marks handshake stale only after both challenge wait and client activity exceed TTL', () => {
    const now = 80_000;
    const ttlMs = 25_000;
    expect(__testing.isClientStaleForHandshake(now - 10_000, now - 30_000, now, ttlMs)).toBe(false);
    expect(__testing.isClientStaleForHandshake(now - 30_000, now - 10_000, now, ttlMs)).toBe(false);
    expect(__testing.isClientStaleForHandshake(now - 30_001, now - 30_001, now, ttlMs)).toBe(true);
  });

  it('expires clients that stay fully idle beyond the absolute idle timeout', () => {
    const now = 120_000;
    expect(__testing.isClientIdleExpired(now - 600_000, now, 600_000)).toBe(false);
    expect(__testing.isClientIdleExpired(now - 600_001, now, 600_000)).toBe(true);
  });

  it('emits client control only when close/error belongs to current client mapping', () => {
    expect(__testing.shouldEmitClientControlAfterSocketEvent(true)).toBe(true);
    expect(__testing.shouldEmitClientControlAfterSocketEvent(false)).toBe(false);
  });

  it('routes a challenge to the oldest client still awaiting connect handshake', () => {
    expect(__testing.resolveAwaitingChallengeClientId({
      awaitingChallenge: [
        { clientId: 'ios-old', queuedAt: 100 },
        { clientId: 'ios-new', queuedAt: 200 },
      ],
      openClientIds: ['ios-old', 'ios-new'],
      preferredClientId: 'ios-new',
      activeClientId: 'ios-new',
    })).toBe('ios-old');
  });

  it('falls back to the preferred active client when no handshake is pending', () => {
    expect(__testing.resolveAwaitingChallengeClientId({
      awaitingChallenge: [],
      openClientIds: ['ios-a', 'ios-b'],
      preferredClientId: 'ios-b',
      activeClientId: 'ios-a',
    })).toBe('ios-b');
  });

  it('skips closed awaiting clients when resolving a pending challenge target', () => {
    expect(__testing.resolveAwaitingChallengeClientId({
      awaitingChallenge: [
        { clientId: 'ios-closed', queuedAt: 100 },
        { clientId: 'ios-open', queuedAt: 200 },
      ],
      openClientIds: ['ios-open'],
      preferredClientId: 'ios-closed',
      activeClientId: 'ios-closed',
    })).toBe('ios-open');
  });

  it('authorizes paired gateway and paired client tokens from KV', async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    const gatewaySecretHash = await __testing.sha256Hex('relay-secret-1');
    const clientTokenHash = await __testing.sha256Hex('client-token-1');
    await kv.put(
      'hermes-pair-bridge:hbg_simple_1',
      JSON.stringify({
        bridgeId: 'hbg_simple_1',
        relaySecretHash: gatewaySecretHash,
        clientTokens: [{ hash: clientTokenHash }],
      }),
    );

    await expect(
      __testing.isRelayTokenAuthorized({
        routesKv: kv,
        bridgeId: 'hbg_simple_1',
        role: 'gateway',
        token: 'relay-secret-1',
      }),
    ).resolves.toBe(true);

    await expect(
      __testing.isRelayTokenAuthorized({
        routesKv: kv,
        bridgeId: 'hbg_simple_1',
        role: 'client',
        token: 'client-token-1',
      }),
    ).resolves.toBe(true);
  });

  it('logs query authSource when websocket auth rejects an invalid query token', async () => {
    const { room, kv } = createHermesRelayRoomWithSockets();
    const relaySecretHash = await __testing.sha256Hex('valid-relay-secret');
    await kv.put('hermes-pair-bridge:hbg_query_auth_1', JSON.stringify({
      bridgeId: 'hbg_query_auth_1',
      relaySecretHash,
      clientTokens: [],
    }));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await room.fetch(new Request(
      'https://relay.internal/ws?bridgeId=hbg_query_auth_1&role=gateway&token=bad-relay-secret',
      { headers: { upgrade: 'websocket' } },
    ));

    expect(response.status).toBe(401);
    const telemetry = consoleSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'ws_auth_rejected');
    expect(telemetry).toMatchObject({
      scope: 'hermes_relay_worker',
      event: 'ws_auth_rejected',
      role: 'gateway',
      authSource: 'query',
      reason: 'invalid_token',
    });
  });

  it('logs bearer authSource when websocket auth rejects an invalid bearer token', async () => {
    const { room, kv } = createHermesRelayRoomWithSockets();
    const relaySecretHash = await __testing.sha256Hex('valid-relay-secret');
    await kv.put('hermes-pair-bridge:hbg_bearer_auth_1', JSON.stringify({
      bridgeId: 'hbg_bearer_auth_1',
      relaySecretHash,
      clientTokens: [],
    }));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await room.fetch(new Request(
      'https://relay.internal/ws?bridgeId=hbg_bearer_auth_1&role=gateway',
      {
        headers: {
          upgrade: 'websocket',
          authorization: 'Bearer bad-relay-secret',
        },
      },
    ));

    expect(response.status).toBe(401);
    const telemetry = consoleSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'ws_auth_rejected');
    expect(telemetry).toMatchObject({
      scope: 'hermes_relay_worker',
      event: 'ws_auth_rejected',
      role: 'gateway',
      authSource: 'bearer',
      reason: 'invalid_token',
    });
  });

  it('logs authSource none when websocket auth is missing entirely', async () => {
    const { room } = createHermesRelayRoomWithSockets();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await room.fetch(new Request(
      'https://relay.internal/ws?bridgeId=hbg_missing_auth_1&role=client',
      { headers: { upgrade: 'websocket' } },
    ));

    expect(response.status).toBe(401);
    const telemetry = consoleSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === 'ws_auth_rejected');
    expect(telemetry).toMatchObject({
      scope: 'hermes_relay_worker',
      event: 'ws_auth_rejected',
      role: 'client',
      authSource: 'none',
      reason: 'missing_token',
    });
  });

  it('falls back to registry verification when the pair record is not in local KV', async () => {
    const fetchMock = globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await expect(
      __testing.isRelayTokenAuthorized({
        routesKv: new MemoryKV() as unknown as KVNamespace,
        registryVerifyUrl: 'https://registry.example.com',
        bridgeId: 'hbg_missing',
        role: 'client',
        token: 'client-token-1',
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/v1/hermes/verify/hbg_missing',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('falls back to registry verification when the local pair record is stale', async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    const gatewaySecretHash = await __testing.sha256Hex('relay-secret-1');
    await kv.put(
      'hermes-pair-bridge:hbg_stale_1',
      JSON.stringify({
        bridgeId: 'hbg_stale_1',
        relaySecretHash: gatewaySecretHash,
        clientTokens: [],
      }),
    );
    const fetchMock = globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await expect(
      __testing.isRelayTokenAuthorized({
        routesKv: kv,
        registryVerifyUrl: 'https://registry.example.com',
        bridgeId: 'hbg_stale_1',
        role: 'client',
        token: 'fresh-client-token',
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/v1/hermes/verify/hbg_stale_1',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('authorizes freshly mirrored client tokens before KV propagation catches up', async () => {
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      fetch: (request: Request) => Promise<Response>;
      runtime: {
        mirroredClientTokenHashes: Set<string>;
      };
    };
    const freshTokenHash = await __testing.sha256Hex('fresh-client-token');

    const syncRes = await relay.fetch(new Request('https://relay.example.com/v1/internal/hermes/pairing/client-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bridgeId: 'hbg_fresh_1',
        clientTokenHashes: [freshTokenHash],
        updatedAt: 123,
      }),
    }));
    expect(syncRes.status).toBe(200);
    expect(relay.runtime.mirroredClientTokenHashes.has(freshTokenHash)).toBe(true);

    await expect(
      __testing.isRelayTokenAuthorized({
        routesKv: new MemoryKV() as unknown as KVNamespace,
        bridgeId: 'hbg_fresh_1',
        role: 'client',
        token: 'fresh-client-token',
        mirroredClientTokenHashes: relay.runtime.mirroredClientTokenHashes,
      }),
    ).resolves.toBe(true);
  });

  it('reports bridge attachment status through the internal bridge-status endpoint', async () => {
    const gatewaySecretHash = await __testing.sha256Hex('relay-secret-1');
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-1', connectedAt: 1 },
    });
    const { room, kv } = createHermesRelayRoomWithSockets([bridgeSocket]);
    await kv.put(
      'hermes-pair-bridge:hbg_status_1',
      JSON.stringify({
        bridgeId: 'hbg_status_1',
        relaySecretHash: gatewaySecretHash,
        clientTokens: [],
      }),
    );

    const response = await (room as unknown as { fetch: (request: Request) => Promise<Response> }).fetch(
      new Request('https://relay.example.com/v1/internal/hermes/bridge-status?bridgeId=hbg_status_1', {
        headers: {
          authorization: 'Bearer relay-secret-1',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      bridgeId: 'hbg_status_1',
      hasBridge: true,
      clientCount: 0,
    });
  });

  it('rejects unauthenticated bridge-status queries', async () => {
    const { room } = createHermesRelayRoomWithSockets();

    const response = await (room as unknown as { fetch: (request: Request) => Promise<Response> }).fetch(
      new Request('https://relay.example.com/v1/internal/hermes/bridge-status?bridgeId=hbg_status_2'),
    );

    expect(response.status).toBe(401);
  });

  it('resolves the stored client label for an authenticated client token', async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    const clientTokenHash = await __testing.sha256Hex('client-token-1');
    await kv.put(
      'hermes-pair-bridge:hbg_label_1',
      JSON.stringify({
        bridgeId: 'hbg_label_1',
        displayName: 'Studio Mac',
        relaySecretHash: 'relay-secret-hash',
        clientTokens: [{ hash: clientTokenHash, label: 'Lucy iPhone' }],
      }),
    );

    await expect(resolveClientLabelFromToken(kv, 'hbg_label_1', 'client-token-1')).resolves.toBe('Lucy iPhone');
  });

  it('rehydrates only open sockets and best-effort closes orphan sockets', async () => {
    const orphanSocket = new FakeWebSocket();
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-1', connectedAt: 1 },
    });
    const openClientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-open', connectedAt: 2 },
    });
    const closedClientSocket = new FakeWebSocket({
      readyState: WebSocket.CLOSED,
      attachment: { role: 'client', clientId: 'client-closed', connectedAt: 3 },
    });

    const { room } = createHermesRelayRoomWithSockets([
      orphanSocket,
      bridgeSocket,
      openClientSocket,
      closedClientSocket,
    ]);

    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        clients: Map<string, FakeWebSocket>;
        clientLastActivityAtById: Map<string, number>;
      };
    };
    const summary = __testing.rehydrateSockets(relay.runtime as never);
    expect(orphanSocket.closeCalls).toEqual([{ code: __testing.SocketCloseCode.DEAD_SOCKET, reason: 'orphan_socket' }]);
    expect(closedClientSocket.closeCalls).toEqual([{ code: __testing.SocketCloseCode.DEAD_SOCKET, reason: 'dead_socket' }]);
    expect(relay.runtime.bridgeSocket).toBe(bridgeSocket);
    expect(Array.from(relay.runtime.clients.keys())).toEqual(['client-open']);
    expect(relay.runtime.clientLastActivityAtById.has('client-open')).toBe(true);
    expect(relay.runtime.clientLastActivityAtById.has('client-closed')).toBe(false);
    expect(summary).toMatchObject({
      totalSocketCount: 4,
      openClientCount: 1,
      orphanSocketsClosed: 1,
      nonOpenSocketsClosed: 1,
      duplicateSocketsClosed: 0,
      hasBridge: true,
    });
  });

  it('rehydrates duplicate client sockets by keeping only the newest attachment per clientId', () => {
    const olderClientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-dup', connectedAt: 1 },
    });
    const newerClientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-dup', connectedAt: 2 },
    });
    const otherClientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-other', connectedAt: 3 },
    });

    const { room } = createHermesRelayRoomWithSockets([
      olderClientSocket,
      newerClientSocket,
      otherClientSocket,
    ]);

    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        clients: Map<string, FakeWebSocket>;
        clientLastActivityAtById: Map<string, number>;
      };
    };
    const summary = __testing.rehydrateSockets(relay.runtime as never);

    expect(olderClientSocket.closeCalls).toEqual([{ code: __testing.SocketCloseCode.DEAD_SOCKET, reason: 'duplicate_socket' }]);
    expect(newerClientSocket.closeCalls).toEqual([]);
    expect(otherClientSocket.closeCalls).toEqual([]);
    expect(relay.runtime.bridgeSocket).toBeNull();
    expect(relay.runtime.clients.get('client-dup')).toBe(newerClientSocket);
    expect(relay.runtime.clients.get('client-other')).toBe(otherClientSocket);
    expect(summary).toMatchObject({
      totalSocketCount: 3,
      openClientCount: 2,
      duplicateSocketsClosed: 1,
      hasBridge: false,
    });
  });

  it('reconciles duplicate gateway sockets by keeping the preferred attachment', () => {
    const olderGatewaySocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-old', connectedAt: 1 },
    });
    const newerGatewaySocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-new', connectedAt: 2 },
    });

    const { room } = createHermesRelayRoomWithSockets([
      olderGatewaySocket,
      newerGatewaySocket,
    ]);

    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        clients: Map<string, FakeWebSocket>;
      };
    };
    const summary = __testing.reconcileSockets(relay.runtime as never, { preferredSocket: olderGatewaySocket as never });

    expect(olderGatewaySocket.closeCalls).toEqual([]);
    expect(newerGatewaySocket.closeCalls).toEqual([{ code: __testing.SocketCloseCode.DEAD_SOCKET, reason: 'duplicate_socket' }]);
    expect(relay.runtime.bridgeSocket).toBe(olderGatewaySocket);
    expect(relay.runtime.clients.size).toBe(0);
    expect(summary).toMatchObject({
      totalSocketCount: 2,
      openClientCount: 0,
      duplicateSocketsClosed: 1,
      hasBridge: true,
    });
  });

  it('drops any buffered challenge when a fresh gateway socket replaces the previous gateway', () => {
    const oldGatewaySocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-old', connectedAt: 1 },
    });
    const newGatewaySocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-new', connectedAt: 2 },
    });

    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        pendingChallenge: {
          data: string;
          queuedAt: number;
          bridgeClientId: string;
          traceId?: string;
        } | null;
      };
    };

    relay.runtime.bridgeSocket = oldGatewaySocket;
    relay.runtime.pendingChallenge = {
      data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'old-nonce' } }),
      queuedAt: 1_000,
      bridgeClientId: 'gw-old',
    };

    __testing.replaceBridge(relay.runtime as never, newGatewaySocket as never);

    expect(relay.runtime.bridgeSocket).toBe(newGatewaySocket);
    expect(relay.runtime.pendingChallenge).toBeNull();
    expect(oldGatewaySocket.closeCalls).toEqual([{ code: 4001, reason: 'replaced_by_new_bridge' }]);
  });

  it('drops a buffered challenge if it no longer belongs to the current gateway socket', () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-current', connectedAt: 2 },
    });

    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        pendingChallenge: {
          data: string;
          queuedAt: number;
          bridgeClientId: string;
          traceId?: string;
        } | null;
        roomBridgeId: string | null;
      };
    };

    relay.runtime.bridgeSocket = bridgeSocket;
    relay.runtime.roomBridgeId = 'hbg_room_1';
    relay.runtime.pendingChallenge = {
      data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'stale-nonce' } }),
      queuedAt: 1_000,
      bridgeClientId: 'gw-stale',
    };

    const flushed = __testing.flushPendingChallenge(relay.runtime as never, 2_000);

    expect(flushed).toBe(false);
    expect(relay.runtime.pendingChallenge).toBeNull();
  });

  it('drops a buffered challenge when no client is awaiting a connect challenge', () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-current', connectedAt: 2 },
    });

    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        pendingChallenge: {
          data: string;
          queuedAt: number;
          bridgeClientId: string;
          traceId?: string;
        } | null;
        awaitingChallenge: Map<string, { clientId: string; queuedAt: number }>;
        roomBridgeId: string | null;
      };
    };

    relay.runtime.bridgeSocket = bridgeSocket;
    relay.runtime.roomBridgeId = 'hbg_room_2';
    relay.runtime.pendingChallenge = {
      data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'orphaned-nonce' } }),
      queuedAt: 1_000,
      bridgeClientId: 'gw-current',
    };

    const flushed = __testing.flushPendingChallenge(relay.runtime as never, 2_000);

    expect(flushed).toBe(false);
    expect(relay.runtime.pendingChallenge).toBeNull();
  });

  it('does not flush a buffered challenge just because a client socket connected', () => {
    const clientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-1', connectedAt: 3 },
    });

    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        clients: Map<string, FakeWebSocket>;
        clientLastActivityAtById: Map<string, number>;
        activeClientId: string | null;
        challengeClientId: string | null;
        pendingChallenge: {
          data: string;
          queuedAt: number;
          bridgeClientId: string;
          traceId?: string;
        } | null;
      };
    };

    relay.runtime.pendingChallenge = {
      data: JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'stale-before-connect' } }),
      queuedAt: 1_000,
      bridgeClientId: 'gw-current',
    };

    __testing.handleClientConnected(relay.runtime as never, 'client-1', clientSocket as never);

    expect(clientSocket.sent).toEqual([]);
    expect(relay.runtime.pendingChallenge).not.toBeNull();
  });

  it('preserves existing activity timestamps for other clients during fetch-path reconciliation', () => {
    const existingClientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-existing', connectedAt: 1_000 },
    });
    const incomingClientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-new', connectedAt: 2_000 },
    });

    const { room } = createHermesRelayRoomWithSockets([
      existingClientSocket,
      incomingClientSocket,
    ]);

    const relay = room as unknown as {
      runtime: {
        clients: Map<string, FakeWebSocket>;
        clientLastActivityAtById: Map<string, number>;
      };
    };

    relay.runtime.clients.set('client-existing', existingClientSocket);
    relay.runtime.clientLastActivityAtById.set('client-existing', 50_000);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(99_000);
    try {
      __testing.reconcileSockets(relay.runtime as never, { preferredSocket: incomingClientSocket as never });
    } finally {
      nowSpy.mockRestore();
    }

    expect(relay.runtime.clientLastActivityAtById.get('client-existing')).toBe(50_000);
    expect(relay.runtime.clientLastActivityAtById.get('client-new')).toBe(2_000);
  });

  it('alarm prunes dead sockets without interrupting tick delivery to healthy clients', async () => {
    const { room } = createHermesRelayRoomWithSockets();
    const deadClient = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-dead', connectedAt: 1 },
    });
    deadClient.shouldThrowOnSend = true;
    const healthyClient = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'client-healthy', connectedAt: 2 },
    });

    const relay = room as unknown as {
      runtime: {
        clients: Map<string, FakeWebSocket>;
        clientLastActivityAtById: Map<string, number>;
      };
      alarm: () => Promise<void>;
    };
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.runtime.clients.set('client-dead', deadClient);
    relay.runtime.clients.set('client-healthy', healthyClient);
    relay.runtime.clientLastActivityAtById.set('client-dead', Date.now());
    relay.runtime.clientLastActivityAtById.set('client-healthy', Date.now());

    await relay.alarm();

    expect(deadClient.closeCalls).toEqual([{ code: __testing.SocketCloseCode.DEAD_SOCKET, reason: 'dead_socket' }]);
    expect(relay.runtime.clients.has('client-dead')).toBe(false);
    expect(relay.runtime.clientLastActivityAtById.has('client-dead')).toBe(false);
    expect(relay.runtime.clients.has('client-healthy')).toBe(true);
    expect(healthyClient.sent).toHaveLength(1);
    expect(JSON.parse(healthyClient.sent[0])).toMatchObject({ type: 'tick' });
  });

  it('forwards client control frames to gateway with relay-injected sourceClientId', async () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-main', connectedAt: 1 },
    });
    const clientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-control', connectedAt: 2, traceId: 'trace-ios' },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        roomBridgeId: string | null;
      };
      webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
    };

    relay.runtime.bridgeSocket = bridgeSocket;
    relay.runtime.roomBridgeId = 'hbg_control_1';

    await relay.webSocketMessage(
      clientSocket as never,
      `${__testing.CONTROL_PREFIX}${JSON.stringify({
        type: 'control',
        event: 'bootstrap.hello',
        sourceClientId: 'spoofed-client',
      })}`,
    );

    expect(bridgeSocket.sent).toHaveLength(1);
    expect(JSON.parse(bridgeSocket.sent[0].slice(__testing.CONTROL_PREFIX.length))).toMatchObject({
      type: 'control',
      event: 'bootstrap.hello',
      sourceClientId: 'ios-control',
    });
  });

  it('routes gateway control frames only to the targeted client', async () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-main', connectedAt: 1 },
    });
    const targetClient = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-target', connectedAt: 2 },
    });
    const otherClient = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-other', connectedAt: 3 },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        clients: Map<string, FakeWebSocket>;
        clientLastActivityAtById: Map<string, number>;
      };
      webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
    };

    relay.runtime.clients.set('ios-target', targetClient);
    relay.runtime.clients.set('ios-other', otherClient);

    await relay.webSocketMessage(
      bridgeSocket as never,
      `${__testing.CONTROL_PREFIX}${JSON.stringify({
        type: 'control',
        event: 'bootstrap.challenge',
        targetClientId: 'ios-target',
      })}`,
    );

    expect(targetClient.sent).toHaveLength(1);
    expect(otherClient.sent).toEqual([]);
    expect(JSON.parse(targetClient.sent[0].slice(__testing.CONTROL_PREFIX.length))).toMatchObject({
      type: 'control',
      event: 'bootstrap.challenge',
      targetClientId: 'ios-target',
    });
  });

  it('does not cache targeted gateway control frames when the target client is missing', async () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-main', connectedAt: 1 },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        clients: Map<string, FakeWebSocket>;
      };
      webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
    };

    await relay.webSocketMessage(
      bridgeSocket as never,
      `${__testing.CONTROL_PREFIX}${JSON.stringify({
        type: 'control',
        event: 'bootstrap.challenge',
        targetClientId: 'ios-missing',
      })}`,
    );

    expect(relay.runtime.clients.size).toBe(0);
  });

  it('drops gateway messages when no active client is connected', async () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-drop', connectedAt: 1 },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
    };

    await relay.webSocketMessage(bridgeSocket as never, 'gateway-message-without-client');
  });

  it('rejects non-connect client requests when the Hermes bridge is unavailable', async () => {
    const clientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-history', connectedAt: 1 },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        clients: Map<string, FakeWebSocket>;
        activeClientId: string | null;
      };
      webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
    };

    relay.runtime.clients.set('ios-history', clientSocket);
    relay.runtime.activeClientId = 'ios-history';

    await relay.webSocketMessage(
      clientSocket as never,
      JSON.stringify({
        type: 'req',
        id: 'req_history_1',
        method: 'chat.history',
        params: { sessionKey: 'main', limit: 12 },
      }),
    );

    expect(clientSocket.sent).toHaveLength(1);
    expect(JSON.parse(clientSocket.sent[0])).toMatchObject({
      type: 'res',
      id: 'req_history_1',
      ok: false,
      error: {
        code: 'BRIDGE_UNAVAILABLE',
      },
    });
    expect(clientSocket.closeCalls).toEqual([
      { code: __testing.SocketCloseCode.BRIDGE_UNAVAILABLE, reason: 'bridge_unavailable' },
    ]);
  });

  it('routes ordinary bridge responses back to the client that sent the request', async () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-main', connectedAt: 1 },
    });
    const activeClient = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-active', connectedAt: 2 },
    });
    const requestingClient = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-requesting', connectedAt: 3 },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        clients: Map<string, FakeWebSocket>;
        activeClientId: string | null;
        requestClientByReqId: Map<string, string>;
      };
      webSocketMessage: (ws: WebSocket, message: string | ArrayBuffer) => Promise<void>;
    };

    relay.runtime.bridgeSocket = bridgeSocket;
    relay.runtime.clients.set('ios-active', activeClient);
    relay.runtime.clients.set('ios-requesting', requestingClient);
    relay.runtime.activeClientId = 'ios-active';

    await relay.webSocketMessage(
      requestingClient as never,
      JSON.stringify({
        type: 'req',
        id: 'req_sessions_1',
        method: 'sessions.list',
        params: { limit: 5 },
      }),
    );

    expect(relay.runtime.requestClientByReqId.get('req_sessions_1')).toBe('ios-requesting');
    expect(bridgeSocket.sent).toContain(JSON.stringify({
      type: 'req',
      id: 'req_sessions_1',
      method: 'sessions.list',
      params: { limit: 5 },
    }));

    await relay.webSocketMessage(
      bridgeSocket as never,
      JSON.stringify({
        type: 'res',
        id: 'req_sessions_1',
        ok: true,
        payload: { sessions: [] },
      }),
    );

    expect(requestingClient.sent).toEqual([
      JSON.stringify({
        type: 'res',
        id: 'req_sessions_1',
        ok: true,
        payload: { sessions: [] },
      }),
    ]);
    expect(activeClient.sent).toEqual([]);
  });

  it('closes connected Hermes clients when the bridge socket disconnects', async () => {
    const bridgeSocket = new FakeWebSocket({
      attachment: { role: 'gateway', clientId: 'gw-main', connectedAt: 1 },
    });
    const clientSocket = new FakeWebSocket({
      attachment: { role: 'client', clientId: 'ios-client', connectedAt: 2 },
    });
    const { room } = createHermesRelayRoomWithSockets();
    const relay = room as unknown as {
      runtime: {
        bridgeSocket: FakeWebSocket | null;
        clients: Map<string, FakeWebSocket>;
      };
      webSocketClose: (ws: WebSocket) => Promise<void>;
    };

    relay.runtime.bridgeSocket = bridgeSocket;
    relay.runtime.clients.set('ios-client', clientSocket);

    await relay.webSocketClose(bridgeSocket as never);

    expect(clientSocket.closeCalls).toEqual([
      { code: __testing.SocketCloseCode.BRIDGE_UNAVAILABLE, reason: 'bridge_unavailable' },
    ]);
  });

});
