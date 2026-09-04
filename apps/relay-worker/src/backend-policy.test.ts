import { describe, expect, it, vi } from 'vitest';
import relayWorker, { __testing } from './index';
import { HERMES_BACKEND_POLICY, OPENCLAW_BACKEND_POLICY } from './backend-policy';
import { RelayRuntime } from './relay/runtime';
import { storeRoomMeta, touchGatewayOwner } from './relay/storage';
import type { Env } from './relay/types';

function handler(): (request: Request, env: Env) => Promise<Response> {
  return relayWorker.fetch as (request: Request, env: Env) => Promise<Response>;
}

function namespaceRecorder() {
  const names: string[] = [];
  const requests: Request[] = [];
  const namespace = {
    idFromName(name: string) {
      names.push(name);
      return { name };
    },
    get() {
      return {
        async fetch(request: Request) {
          requests.push(request);
          return new Response(null, { status: 204 });
        },
      };
    },
  } as unknown as DurableObjectNamespace;
  return { namespace, names, requests };
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
    const response = await handler()(
      new Request('https://relay.example/ws?gatewayId=gw_policy&role=gateway', {
        headers: { upgrade: 'websocket' },
      }),
      { ROOM: recorder.namespace } as Env,
    );
    expect(response.status).toBe(204);
    expect(recorder.names).toEqual(['gw_policy']);
  });

  it('dispatches Hermes websocket requests through HERMES_ROOM only when configured', async () => {
    const recorder = namespaceRecorder();
    const response = await handler()(
      new Request('https://relay.example/ws?bridgeId=hbg_policy&role=gateway', {
        headers: { upgrade: 'websocket' },
      }),
      { RELAY_BACKEND: 'hermes', HERMES_ROOM: recorder.namespace } as Env,
    );
    expect(response.status).toBe(204);
    expect(recorder.names).toEqual(['hbg_policy']);

    const wrongParam = await handler()(
      new Request('https://relay.example/ws?gatewayId=gw_wrong&role=gateway', {
        headers: { upgrade: 'websocket' },
      }),
      { RELAY_BACKEND: 'hermes', HERMES_ROOM: recorder.namespace } as Env,
    );
    await expect(wrongParam.json()).resolves.toEqual({
      error: { code: 'INVALID_BRIDGE_ID', message: 'bridgeId is required' },
    });
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
      capabilities: ['pairing.secure-short-code.v2'],
    });
    await expect(hermes.json()).resolves.toEqual({ ok: true, runtime: 'durable-object' });
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
