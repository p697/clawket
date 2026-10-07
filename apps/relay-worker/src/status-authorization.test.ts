import { describe, expect, it, vi } from 'vitest';
import relayWorker, { __testing, HermesRelayRoom } from './index';
import type { Env } from './relay/types';

const STATUS = 'https://relay.example/v1/internal/hermes/bridge-status?bridgeId=hbg_status';
const PRIVATE_STATUS = 'https://relay.example/__clawket/verified-hermes-bridge-status?bridgeId=hbg_status';

async function environment() {
  const values = new Map<string, unknown>();
  const put = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
  const kvGet = vi.fn(async () => JSON.stringify({
    bridgeId: 'hbg_status', relaySecretHash: await __testing.sha256Hex('owner-secret'),
    clientTokens: [{ hash: await __testing.sha256Hex('phone-token') }],
  }));
  const requests: Request[] = [];
  const resolve = vi.fn();
  let ready: Promise<unknown> = Promise.resolve();
  const env = { RELAY_BACKEND: 'hermes', HERMES_ROUTES_KV: { get: kvGet } } as unknown as Env;
  const state = {
    storage: { get: async (key: string) => values.get(key), put,
      getAlarm: async () => null, deleteAlarm: async () => {}, setAlarm: async () => {} },
    getWebSockets: () => [],
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { ready = fn(); },
  } as unknown as DurableObjectState;
  env.HERMES_ROOM = {
    idFromName: resolve.mockImplementation((name: string) => name),
    get: () => {
      const room = new HermesRelayRoom(state, env);
      return { fetch: async (request: Request) => {
        requests.push(request); await ready; return room.fetch(request);
      } };
    },
  } as unknown as DurableObjectNamespace;
  const fetch = (request: Request) => (relayWorker.fetch as (r: Request, e: Env) => Promise<Response>)(request, env);
  return { env, fetch, resolve, requests, put, kvGet, state, ready: () => ready };
}

describe('Hermes bridge status resource admission', () => {
  it.each([undefined, 'Bearer wrong-token', 'Bearer phone-token'])('rejects %s before room resolution or storage', async authorization => {
    const e = await environment();
    const response = await e.fetch(new Request(STATUS, { headers: authorization ? { authorization } : {} }));
    expect(response.status).toBe(401);
    expect(e.resolve).not.toHaveBeenCalled();
    expect(e.requests).toHaveLength(0);
    expect(e.put).not.toHaveBeenCalled();
    expect(e.kvGet).toHaveBeenCalledTimes(authorization ? 1 : 0);
  });

  it('reads status with one owner authorization and no room metadata writes', async () => {
    const e = await environment();
    const response = await e.fetch(new Request(STATUS + '&token=ignored&extra=ignored', {
      headers: { authorization: 'Bearer owner-secret', 'x-status-authorized': 'forged' },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, bridgeId: 'hbg_status', hasBridge: false, clientCount: 0 });
    expect(e.kvGet).toHaveBeenCalledTimes(1);
    expect(e.resolve).toHaveBeenCalledOnce();
    expect(e.put).not.toHaveBeenCalled();
    expect(e.requests[0].headers.get('authorization')).toBeNull();
    expect([...new URL(e.requests[0].url).searchParams.keys()]).toEqual(['bridgeId']);
  });

  it.each(['hermes', 'openclaw'] as const)('does not expose the private action on the %s public Worker', async backend => {
    const e = await environment(); e.env.RELAY_BACKEND = backend;
    const response = await e.fetch(new Request(PRIVATE_STATUS, {
      headers: { authorization: 'Bearer owner-secret', 'x-status-authorized': 'true' },
    }));
    expect(response.status).toBe(404);
    expect(e.resolve).not.toHaveBeenCalled();
    expect(e.kvGet).not.toHaveBeenCalled();
  });

  it('keeps direct legacy DO status requests authenticated and read-only', async () => {
    const e = await environment(); const room = new HermesRelayRoom(e.state, e.env); await e.ready();
    expect((await room.fetch(new Request(STATUS, { headers: { authorization: 'Bearer wrong-token' } }))).status).toBe(401);
    expect(e.put).not.toHaveBeenCalled();
    expect((await room.fetch(new Request(STATUS, { headers: { authorization: 'Bearer owner-secret' } }))).status).toBe(200);
    expect(e.put).not.toHaveBeenCalled();
  });

  it('rejects client credentials even when the real Registry contract returns HTTP 200', async () => {
    const e = await environment(); e.env.REGISTRY_VERIFY_URL = 'https://registry.example';
    const fallback = vi.fn(async () => Response.json({ ok: true, role: 'client' }));
    vi.stubGlobal('fetch', fallback);
    try {
      const headers = { authorization: 'Bearer phone-token' };
      expect((await e.fetch(new Request(STATUS, { headers }))).status).toBe(401);
      expect(e.resolve).not.toHaveBeenCalled(); expect(e.put).not.toHaveBeenCalled();
      const room = new HermesRelayRoom(e.state, e.env); await e.ready();
      expect((await room.fetch(new Request(STATUS, { headers }))).status).toBe(401);
      expect((await room.fetch(new Request('https://relay.example/ws?bridgeId=hbg_status&role=gateway&clientId=test-owner', {
        headers: { ...headers, Upgrade: 'websocket' },
      }))).status).toBe(401);
      expect(e.put).not.toHaveBeenCalled(); expect(fallback).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); }
  });
});
