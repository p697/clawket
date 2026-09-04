import { beforeEach, describe, expect, it, vi } from 'vitest';
import relayWorker, { __testing } from './index';
import {
  HERMES_BACKEND_POLICY,
  OPENCLAW_BACKEND_POLICY,
  PRINCIPAL_EXISTENCE_CACHE_MAX_ENTRIES,
  PRINCIPAL_EXISTENCE_CACHE_TTL_MS,
  PrincipalExistenceCache,
} from './backend-policy';
import { RelayRuntime } from './relay/runtime';
import { storeRoomMeta, touchGatewayOwner } from './relay/storage';
import type { Env } from './relay/types';

function handler(): (request: Request, env: Env) => Promise<Response> {
  return relayWorker.fetch as (request: Request, env: Env) => Promise<Response>;
}

function namespaceRecorder() {
  const names: string[] = [];
  const gets: unknown[] = [];
  const requests: Request[] = [];
  const namespace = {
    idFromName(name: string) {
      names.push(name);
      return { name };
    },
    get(id: unknown) {
      gets.push(id);
      return {
        async fetch(request: Request) {
          requests.push(request);
          return new Response(null, { status: 204 });
        },
      };
    },
  } as unknown as DurableObjectNamespace;
  return { namespace, names, gets, requests };
}

function kvRecorder(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  const get = vi.fn(async (key: string) => values.get(key) ?? null);
  return {
    namespace: { get } as unknown as KVNamespace,
    get,
    set(key: string, value: string) {
      values.set(key, value);
    },
    delete(key: string) {
      values.delete(key);
    },
  };
}

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function runtimeFor(policy: typeof OPENCLAW_BACKEND_POLICY | typeof HERMES_BACKEND_POLICY) {
  const storage = new MemoryStorage();
  const state = { storage } as unknown as DurableObjectState;
  return {
    runtime: new RelayRuntime(state, {} as Env, policy),
    storage,
  };
}

describe('backend policy dispatch', () => {
  beforeEach(() => {
    __testing.clearPrincipalExistenceCache();
  });

  it('keeps the mechanically merged policy contract explicit', () => {
    expect(__testing.BackendPolicy.openclaw).toMatchObject({
      backend: 'openclaw',
      principalParam: 'gatewayId',
      kvKeys: { pair: 'pair-gateway:' },
      registryVerifyPath: '/v1/verify/',
      doBinding: 'ROOM',
      kvBinding: 'ROUTES_KV',
      telemetryScope: 'relay_worker',
      securePairing: true,
      routeRequestsByOrigin: false,
      watchdog: 'none',
      clientPongTimeoutMs: 120_000,
    });
    expect(__testing.BackendPolicy.hermes).toMatchObject({
      backend: 'hermes',
      principalParam: 'bridgeId',
      kvKeys: { pair: 'hermes-pair-bridge:' },
      registryVerifyPath: '/v1/hermes/verify/',
      doBinding: 'HERMES_ROOM',
      kvBinding: 'HERMES_ROUTES_KV',
      telemetryScope: 'hermes_relay_worker',
      securePairing: false,
      routeRequestsByOrigin: true,
      watchdog: 'hermes-bridge-probe',
      clientPongTimeoutMs: 30_000,
    });
  });

  it('dispatches OpenClaw websocket requests through ROOM by default', async () => {
    const recorder = namespaceRecorder();
    const kv = kvRecorder({ 'pair-gateway:gw_policy': '{}' });
    const response = await handler()(
      new Request('https://relay.example/ws?gatewayId=gw_policy&role=gateway', {
        headers: { upgrade: 'websocket' },
      }),
      { ROOM: recorder.namespace, ROUTES_KV: kv.namespace } as Env,
    );
    expect(response.status).toBe(204);
    expect(recorder.names).toEqual(['gw_policy']);
    expect(recorder.gets).toHaveLength(1);
    expect(kv.get).toHaveBeenCalledWith('pair-gateway:gw_policy');
  });

  it('dispatches Hermes websocket requests through HERMES_ROOM only when configured', async () => {
    const recorder = namespaceRecorder();
    const kv = kvRecorder({ 'hermes-pair-bridge:hbg_policy': '{}' });
    const response = await handler()(
      new Request('https://relay.example/ws?bridgeId=hbg_policy&role=gateway', {
        headers: { upgrade: 'websocket' },
      }),
      {
        RELAY_BACKEND: 'hermes',
        HERMES_ROOM: recorder.namespace,
        HERMES_ROUTES_KV: kv.namespace,
      } as Env,
    );
    expect(response.status).toBe(204);
    expect(recorder.names).toEqual(['hbg_policy']);

    const wrongParam = await handler()(
      new Request('https://relay.example/ws?gatewayId=gw_wrong&role=gateway', {
        headers: { upgrade: 'websocket' },
      }),
      {
        RELAY_BACKEND: 'hermes',
        HERMES_ROOM: recorder.namespace,
        HERMES_ROUTES_KV: kv.namespace,
      } as Env,
    );
    await expect(wrongParam.json()).resolves.toEqual({
      error: { code: 'INVALID_BRIDGE_ID', message: 'bridgeId is required' },
    });
    expect(kv.get).toHaveBeenCalledWith('hermes-pair-bridge:hbg_policy');
  });

  it.each([
    {
      label: 'OpenClaw',
      url: 'https://relay.example/ws?gatewayId=gw_unknown&role=client&token=invalid',
      env: (namespace: DurableObjectNamespace, kv: KVNamespace) => ({ ROOM: namespace, ROUTES_KV: kv }),
      pairKey: 'pair-gateway:gw_unknown',
    },
    {
      label: 'Hermes',
      url: 'https://relay.example/ws?bridgeId=hbg_unknown&role=client&token=invalid',
      env: (namespace: DurableObjectNamespace, kv: KVNamespace) => ({
        RELAY_BACKEND: 'hermes',
        HERMES_ROOM: namespace,
        HERMES_ROUTES_KV: kv,
      }),
      pairKey: 'hermes-pair-bridge:hbg_unknown',
    },
  ])('rejects an unknown $label principal before any Durable Object operation', async ({ url, env, pairKey }) => {
    const recorder = namespaceRecorder();
    const kv = kvRecorder();

    const response = await handler()(
      new Request(url, { headers: { upgrade: 'websocket' } }),
      env(recorder.namespace, kv.namespace) as Env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNKNOWN_GATEWAY', message: expect.any(String) },
    });
    expect(kv.get).toHaveBeenCalledWith(pairKey);
    expect(recorder.names).toEqual([]);
    expect(recorder.gets).toEqual([]);
    expect(recorder.requests).toEqual([]);
  });

  it('does not cache a miss and admits the same principal as soon as KV observes it', async () => {
    const recorder = namespaceRecorder();
    const kv = kvRecorder();
    const env = { ROOM: recorder.namespace, ROUTES_KV: kv.namespace } as Env;
    const request = () => new Request(
      'https://relay.example/ws?gatewayId=gw_eventually_visible&role=client&token=invalid',
      { headers: { upgrade: 'websocket' } },
    );

    expect((await handler()(request(), env)).status).toBe(404);
    kv.set('pair-gateway:gw_eventually_visible', '{}');
    expect((await handler()(request(), env)).status).toBe(204);

    expect(kv.get).toHaveBeenCalledTimes(2);
    expect(recorder.names).toEqual(['gw_eventually_visible']);
    expect(recorder.gets).toHaveLength(1);
    expect(recorder.requests).toHaveLength(1);
  });

  it('caches a positive pair existence result for exactly 60 seconds', async () => {
    expect(PRINCIPAL_EXISTENCE_CACHE_TTL_MS).toBe(60_000);
    const recorder = namespaceRecorder();
    const kv = kvRecorder({ 'pair-gateway:gw_cached': '{}' });
    const env = { ROOM: recorder.namespace, ROUTES_KV: kv.namespace } as Env;
    const request = () => new Request(
      'https://relay.example/ws?gatewayId=gw_cached&role=gateway',
      { headers: { upgrade: 'websocket' } },
    );
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    try {
      expect((await handler()(request(), env)).status).toBe(204);
      kv.delete('pair-gateway:gw_cached');
      nowSpy.mockReturnValue(60_999);
      expect((await handler()(request(), env)).status).toBe(204);
      nowSpy.mockReturnValue(61_000);
      expect((await handler()(request(), env)).status).toBe(404);
    } finally {
      nowSpy.mockRestore();
    }

    expect(kv.get).toHaveBeenCalledTimes(2);
    expect(recorder.names).toEqual(['gw_cached', 'gw_cached']);
  });

  it('bounds the isolate pair existence cache at 10,000 entries', () => {
    expect(PRINCIPAL_EXISTENCE_CACHE_MAX_ENTRIES).toBe(10_000);
    const cache = new PrincipalExistenceCache();
    for (let index = 0; index <= PRINCIPAL_EXISTENCE_CACHE_MAX_ENTRIES; index += 1) {
      cache.add(`principal-${index}`, 0);
    }

    expect(cache.size).toBe(PRINCIPAL_EXISTENCE_CACHE_MAX_ENTRIES);
    expect(cache.has('principal-0', 1)).toBe(false);
    expect(cache.has('principal-1', 1)).toBe(true);
  });

  it('fails closed when RELAY_BACKEND is configured to an unsupported value', async () => {
    await expect(handler()(new Request('https://relay.example/v1/health'), {
      RELAY_BACKEND: 'hermez',
    } as unknown as Env)).rejects.toThrow('Unsupported RELAY_BACKEND: hermez');
  });

  it('preserves the backend-specific health response shapes', async () => {
    const secret = 'test-pairing-ticket-secret-that-is-long-enough';
    const openclaw = await handler()(new Request('https://relay.example/v1/health'), {
      PAIRING_TICKET_SECRET: secret,
    } as Env);
    const hermes = await handler()(new Request('https://relay.example/v1/health'), {
      RELAY_BACKEND: 'hermes',
      PAIRING_TICKET_SECRET: secret,
    } as Env);
    await expect(openclaw.json()).resolves.toEqual({
      ok: true,
      runtime: 'durable-object',
      capabilities: ['pairing.secure-short-code.v2', 'relay.frame-limit.v2'],
    });
    await expect(hermes.json()).resolves.toEqual({
      ok: true,
      runtime: 'durable-object',
      capabilities: ['relay.frame-limit.v2'],
    });
  });

  it('preserves OpenClaw DO storage field shapes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12_345);
    const { runtime, storage } = runtimeFor(OPENCLAW_BACKEND_POLICY);
    await storeRoomMeta(runtime, 'gw_storage');
    await touchGatewayOwner(runtime, 'gateway-runtime', true);
    expect(storage.values.get('room-meta')).toEqual({ gatewayId: 'gw_storage' });
    expect(storage.values.get('gateway-owner')).toEqual({ gatewayId: 'gateway-runtime', seenAt: 12_345 });
    vi.restoreAllMocks();
  });

  it('preserves Hermes DO storage field shapes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(67_890);
    const { runtime, storage } = runtimeFor(HERMES_BACKEND_POLICY);
    await storeRoomMeta(runtime, 'hbg_storage');
    await touchGatewayOwner(runtime, 'bridge-runtime', true);
    expect(storage.values.get('room-meta')).toEqual({ bridgeId: 'hbg_storage' });
    expect(storage.values.get('gateway-owner')).toEqual({ bridgeId: 'bridge-runtime', seenAt: 67_890 });
    vi.restoreAllMocks();
  });
});
