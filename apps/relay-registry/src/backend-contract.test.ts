import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@clawket/shared';
import worker from './index';

const fetchHandler = worker.fetch as (request: Request, env: unknown) => Promise<Response>;
const RECORD_TTL_SEC = 365 * 24 * 3600;

type PutCall = {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
};

class TrackingKV {
  readonly map = new Map<string, string>();
  readonly puts: PutCall[] = [];
  readonly deletes: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.map.set(key, value);
    this.puts.push({ key, value, options });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
    this.deletes.push(key);
  }
}

const BACKENDS = [
  {
    backend: 'openclaw',
    principalParam: 'gatewayId',
    otherPrincipalParam: 'bridgeId',
    principalLabel: 'Gateway',
    pairBasePath: '/v1/pair',
    otherPairBasePath: '/v1/hermes/pair',
    verifyPath: '/v1/verify/',
    idPrefix: 'gw_',
    relaySecretPrefix: 'grs_',
    clientTokenPrefix: 'gct_',
    pairKeyPrefix: 'pair-gateway:',
    telemetryScope: 'registry_worker',
    invalidCode: 'INVALID_GATEWAY_ID',
    notFoundCode: 'GATEWAY_NOT_FOUND',
  },
  {
    backend: 'hermes',
    principalParam: 'bridgeId',
    otherPrincipalParam: 'gatewayId',
    principalLabel: 'Bridge',
    pairBasePath: '/v1/hermes/pair',
    otherPairBasePath: '/v1/pair',
    verifyPath: '/v1/hermes/verify/',
    idPrefix: 'hbg_',
    relaySecretPrefix: 'hrs_',
    clientTokenPrefix: 'hct_',
    pairKeyPrefix: 'hermes-pair-bridge:',
    telemetryScope: 'hermes_registry_worker',
    invalidCode: 'INVALID_BRIDGE_ID',
    notFoundCode: 'BRIDGE_NOT_FOUND',
  },
] as const;

type BackendCase = (typeof BACKENDS)[number];

function createEnv(backendCase: BackendCase, overrides: Record<string, unknown> = {}) {
  const openClawKv = new TrackingKV();
  const hermesKv = new TrackingKV();
  return {
    env: {
      RELAY_BACKEND: backendCase.backend,
      ROUTES_KV: openClawKv as unknown as KVNamespace,
      HERMES_ROUTES_KV: hermesKv as unknown as KVNamespace,
      RELAY_REGION_MAP: JSON.stringify({ us: 'wss://relay-us.example.com/ws' }),
      PAIR_ACCESS_CODE_TTL_SEC: '600',
      PAIR_CLIENT_TOKEN_MAX: '8',
      ...overrides,
    },
    selectedKv: backendCase.backend === 'openclaw' ? openClawKv : hermesKv,
    unusedKv: backendCase.backend === 'openclaw' ? hermesKv : openClawKv,
  };
}

async function postJson(url: string, body: Record<string, unknown>, env: unknown): Promise<Response> {
  return fetchHandler(new Request(`https://registry.example.com${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

async function register(backendCase: BackendCase, env: unknown) {
  const response = await postJson(`${backendCase.pairBasePath}/register`, {
    displayName: 'Contract Host',
    preferredRegion: 'us',
  }, env);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, string | null>>;
}

describe('Registry backend contract matrix', () => {
  it('fails closed when RELAY_BACKEND is configured to an unsupported value', async () => {
    await expect(fetchHandler(new Request('https://registry.example.com/v1/health'), {
      RELAY_BACKEND: 'hermez',
      RELAY_REGION_MAP: '{}',
    })).rejects.toThrow('Unsupported RELAY_BACKEND: hermez');
  });

  it.each(BACKENDS)('preserves $backend public fields, KV shape, TTL, wire roles, and telemetry', async (backendCase) => {
    const { env, selectedKv, unusedKv } = createEnv(backendCase);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const registered = await register(backendCase, env);
      const principalId = registered[backendCase.principalParam] as string;
      const relaySecret = registered.relaySecret as string;
      expect(Object.keys(registered)).toEqual([
        backendCase.principalParam,
        'relaySecret',
        'relayUrl',
        'accessCode',
        'accessCodeExpiresAt',
        'displayName',
        'region',
      ]);
      expect(registered).not.toHaveProperty(backendCase.otherPrincipalParam);
      expect(principalId).toMatch(new RegExp(`^${backendCase.idPrefix}`));
      expect(relaySecret).toMatch(new RegExp(`^${backendCase.relaySecretPrefix}`));

      const recordKey = `${backendCase.pairKeyPrefix}${principalId}`;
      const registerPut = selectedKv.puts.find((call) => call.key === recordKey);
      expect(registerPut?.options).toEqual({ expirationTtl: RECORD_TTL_SEC });
      expect(unusedKv.puts).toHaveLength(0);
      const storedAtRegister = JSON.parse(registerPut?.value as string) as Record<string, unknown>;
      expect(Object.keys(storedAtRegister)[0]).toBe(backendCase.principalParam);
      expect(storedAtRegister).not.toHaveProperty(backendCase.otherPrincipalParam);
      expect(registerPut?.value).not.toContain(relaySecret);
      if (backendCase.backend === 'openclaw') {
        expect(storedAtRegister).toMatchObject({
          pairingSessionId: null,
          pairingSessionCodeHash: null,
          pairingSessionShortCodeLookup: null,
        });
      } else {
        expect(storedAtRegister).not.toHaveProperty('pairingSessionId');
        expect(storedAtRegister).not.toHaveProperty('pairingSessionCodeHash');
        expect(storedAtRegister).not.toHaveProperty('pairingSessionShortCodeLookup');
      }

      const claimResponse = await postJson(`${backendCase.pairBasePath}/claim`, {
        [backendCase.principalParam]: principalId,
        accessCode: registered.accessCode,
        clientLabel: 'Contract Client',
      }, env);
      expect(claimResponse.status).toBe(200);
      const claimed = await claimResponse.json() as Record<string, string | null>;
      expect(Object.keys(claimed)).toEqual([
        backendCase.principalParam,
        'relayUrl',
        'clientToken',
        'displayName',
        'region',
      ]);
      expect(claimed).not.toHaveProperty(backendCase.otherPrincipalParam);
      expect(claimed.clientToken).toMatch(new RegExp(`^${backendCase.clientTokenPrefix}`));
      expect(selectedKv.puts.filter((call) => call.key === recordKey).every(
        (call) => call.options?.expirationTtl === RECORD_TTL_SEC,
      )).toBe(true);
      const storedAfterClaim = selectedKv.map.get(recordKey) as string;
      expect(storedAfterClaim).not.toContain(claimed.clientToken as string);
      expect(JSON.parse(storedAfterClaim)).toMatchObject({
        accessCodeHash: null,
        accessCodeExpiresAt: null,
        clientTokens: [{ label: 'Contract Client' }],
      });

      const verifyUrl = `https://registry.example.com${backendCase.verifyPath}${encodeURIComponent(principalId)}`;
      const ownerVerify = await fetchHandler(new Request(verifyUrl, {
        headers: { authorization: `Bearer ${relaySecret}` },
      }), env);
      expect(ownerVerify.status).toBe(200);
      await expect(ownerVerify.json()).resolves.toEqual({ ok: true, role: 'gateway' });
      const clientVerify = await fetchHandler(new Request(verifyUrl, {
        headers: { authorization: `Bearer ${claimed.clientToken}` },
      }), env);
      await expect(clientVerify.json()).resolves.toEqual({ ok: true, role: 'client' });

      const wrongBackendRoute = await postJson(`${backendCase.otherPairBasePath}/register`, {}, env);
      expect(wrongBackendRoute.status).toBe(404);
      const telemetry = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(telemetry.every((entry) => entry.scope === backendCase.telemetryScope)).toBe(true);
      expect(telemetry).toContainEqual(expect.objectContaining({
        path: `${backendCase.verifyPath}:${backendCase.principalParam}`,
      }));
      expect(telemetry.some((entry) => String(entry.path).includes(principalId))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it.each(BACKENDS)('preserves $backend principal errors and access-code expiry', async (backendCase) => {
    const { env, selectedKv } = createEnv(backendCase);
    const missing = await postJson(`${backendCase.pairBasePath}/access-code`, { relaySecret: 'secret' }, env);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: {
        code: backendCase.invalidCode,
        message: `${backendCase.principalParam} is required`,
      },
    });

    const missingId = `${backendCase.idPrefix}missing`;
    const notFound = await postJson(`${backendCase.pairBasePath}/access-code`, {
      [backendCase.principalParam]: missingId,
      relaySecret: 'secret',
    }, env);
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: {
        code: backendCase.notFoundCode,
        message: `${backendCase.principalLabel} not found`,
      },
    });

    const registered = await register(backendCase, env);
    const principalId = registered[backendCase.principalParam] as string;
    const key = `${backendCase.pairKeyPrefix}${principalId}`;
    const record = JSON.parse(selectedKv.map.get(key) as string) as Record<string, unknown>;
    record.accessCodeExpiresAt = new Date(Date.now() - 1_000).toISOString();
    selectedKv.map.set(key, JSON.stringify(record));
    const expired = await postJson(`${backendCase.pairBasePath}/claim`, {
      [backendCase.principalParam]: principalId,
      accessCode: registered.accessCode,
    }, env);
    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toEqual({
      error: { code: 'ACCESS_CODE_EXPIRED', message: 'Access code expired' },
    });
  });

  it.each(BACKENDS)('caps $backend client tokens at the configured newest records', async (backendCase) => {
    const { env, selectedKv } = createEnv(backendCase, { PAIR_CLIENT_TOKEN_MAX: '2' });
    const registered = await register(backendCase, env);
    const principalId = registered[backendCase.principalParam] as string;
    const relaySecret = registered.relaySecret as string;
    let accessCode = registered.accessCode as string;
    const issued: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const claim = await postJson(`${backendCase.pairBasePath}/claim`, {
        [backendCase.principalParam]: principalId,
        accessCode,
      }, env);
      const claimBody = await claim.json() as { clientToken: string };
      issued.push(claimBody.clientToken);
      if (index < 2) {
        const refresh = await postJson(`${backendCase.pairBasePath}/access-code`, {
          [backendCase.principalParam]: principalId,
          relaySecret,
        }, env);
        accessCode = (await refresh.json() as { accessCode: string }).accessCode;
      }
    }

    const key = `${backendCase.pairKeyPrefix}${principalId}`;
    const stored = JSON.parse(selectedKv.map.get(key) as string) as { clientTokens: Array<{ hash: string }> };
    expect(stored.clientTokens).toHaveLength(2);
    await expect(Promise.all(issued.slice(1).reverse().map(sha256Hex))).resolves.toEqual(
      stored.clientTokens.map((token) => token.hash),
    );
  });

  it.each(BACKENDS)('preserves $backend Relay sync route, body key, and transport', async (backendCase) => {
    const serviceFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const globalFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    const { env } = createEnv(backendCase, {
      PAIRING_SYNC_SECRET: 'sync-secret',
      RELAY_SYNC_SERVICE: { fetch: serviceFetch },
    });

    try {
      const registered = await register(backendCase, env);
      const principalId = registered[backendCase.principalParam] as string;
      const claim = await postJson(`${backendCase.pairBasePath}/claim`, {
        [backendCase.principalParam]: principalId,
        accessCode: registered.accessCode,
      }, env);
      const claimed = await claim.json() as { clientToken: string };
      const selectedFetch = backendCase.backend === 'openclaw' ? serviceFetch : globalFetch;
      const unusedFetch = backendCase.backend === 'openclaw' ? globalFetch : serviceFetch;
      expect(selectedFetch).toHaveBeenCalledTimes(1);
      expect(unusedFetch).not.toHaveBeenCalled();
      const [url, init] = selectedFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(backendCase.backend === 'openclaw'
        ? 'https://relay-us.example.com/v1/internal/pairing/client-tokens'
        : 'https://relay-us.example.com/v1/internal/hermes/pairing/client-tokens');
      expect(init.headers).toEqual(expect.objectContaining({
        'x-clawket-pairing-sync-secret': 'sync-secret',
      }));
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual([backendCase.principalParam, 'clientTokenHashes', 'updatedAt']);
      expect(body[backendCase.principalParam]).toBe(principalId);
      expect(body).not.toHaveProperty(backendCase.otherPrincipalParam);
      expect(body.clientTokenHashes).toEqual([await sha256Hex(claimed.clientToken)]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(BACKENDS)('keeps $backend claim successful when Relay sync fails', async (backendCase) => {
    const syncFailure = new Error('relay sync unavailable');
    const serviceFetch = vi.fn(async () => { throw syncFailure; });
    const globalFetch = vi.fn(async () => { throw syncFailure; });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { env } = createEnv(backendCase, {
      PAIRING_SYNC_SECRET: 'sync-secret',
      RELAY_SYNC_SERVICE: { fetch: serviceFetch },
    });

    try {
      const registered = await register(backendCase, env);
      const claim = await postJson(`${backendCase.pairBasePath}/claim`, {
        [backendCase.principalParam]: registered[backendCase.principalParam],
        accessCode: registered.accessCode,
      }, env);
      expect(claim.status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({
        scope: backendCase.telemetryScope,
        event: 'relay_token_sync_failed',
        message: 'relay sync unavailable',
      });
    } finally {
      warn.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps every OpenClaw invitation route unavailable in Hermes mode', async () => {
    const backendCase = BACKENDS[1];
    const { env, selectedKv } = createEnv(backendCase);
    const requests = [
      new Request('https://registry.example.com/v1/pair/session', { method: 'POST' }),
      new Request('https://registry.example.com/v1/pair/session/resolve', { method: 'POST' }),
      new Request('https://registry.example.com/v2/pair/session/resolve', { method: 'POST' }),
      new Request('https://registry.example.com/v1/pair/session/ps_fake'),
      new Request('https://registry.example.com/pair/ps_fake'),
      new Request('https://registry.example.com/.well-known/apple-app-site-association'),
      new Request('https://registry.example.com/.well-known/assetlinks.json'),
    ];
    const responses = await Promise.all(requests.map((request) => fetchHandler(request, env)));
    expect(responses.map((response) => response.status)).toEqual(Array(requests.length).fill(404));
    expect([...selectedKv.map.keys()].some((key) => key.startsWith('pair-session'))).toBe(false);
  });

  it('invalidates all OpenClaw invitation indexes when refreshing an access code', async () => {
    const backendCase = BACKENDS[0];
    const serviceFetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      capabilities: ['pairing.secure-short-code.v2'],
    }), { status: 200 }));
    const { env, selectedKv } = createEnv(backendCase, {
      PAIRING_TICKET_SECRET: 'test-pairing-ticket-secret-that-is-long-enough',
      RELAY_SYNC_SERVICE: { fetch: serviceFetch },
    });
    const registered = await register(backendCase, env);
    const gatewayId = registered.gatewayId as string;
    const codeHash = await sha256Hex('ABCD-EFGH-JKLM');
    const shortCodeHash = await sha256Hex('123456');
    const ciphertext = {
      nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    };
    const sessionResponse = await postJson('/v1/pair/session', {
      gatewayId,
      relaySecret: registered.relaySecret,
      codeHash,
      shortCodeHash,
      linkPayload: ciphertext,
      codePayload: ciphertext,
    }, env);
    const session = await sessionResponse.json() as { sessionId: string };
    const gatewayKey = `pair-gateway:${gatewayId}`;
    const gatewayRecord = JSON.parse(selectedKv.map.get(gatewayKey) as string) as {
      pairingSessionShortCodeLookup: string;
    };
    const invitationKeys = [
      `pair-session:${session.sessionId}`,
      `pair-session-code:${codeHash}`,
      `pair-session-short-code:${gatewayRecord.pairingSessionShortCodeLookup}`,
    ];
    expect(invitationKeys.every((key) => selectedKv.map.has(key))).toBe(true);

    const refresh = await postJson('/v1/pair/access-code', {
      gatewayId,
      relaySecret: registered.relaySecret,
    }, env);
    expect(refresh.status).toBe(200);
    expect(invitationKeys.every((key) => !selectedKv.map.has(key))).toBe(true);
    expect(selectedKv.deletes).toEqual(expect.arrayContaining(invitationKeys));
    expect(JSON.parse(selectedKv.map.get(gatewayKey) as string)).toMatchObject({
      pairingSessionId: null,
      pairingSessionCodeHash: null,
      pairingSessionShortCodeLookup: null,
    });
    const staleRead = await fetchHandler(new Request(
      `https://registry.example.com/v1/pair/session/${session.sessionId}`,
    ), env);
    expect(staleRead.status).toBe(404);
  });
});
