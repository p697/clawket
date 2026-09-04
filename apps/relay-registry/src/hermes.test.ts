import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@clawket/shared';
import worker from './index';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: DurableObjectState;
    protected readonly env: unknown;

    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const fetchHandler = worker.fetch as (request: Request, env: unknown) => Promise<Response>;
const ACCESS_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/;

class MemoryKV {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

function createEnv() {
  return {
    RELAY_BACKEND: 'hermes',
    HERMES_ROUTES_KV: new MemoryKV() as unknown as KVNamespace,
    RELAY_REGION_MAP: JSON.stringify({
      us: 'wss://relay-us.example.com/ws',
      sg: 'wss://relay-sg.example.com/ws',
    }),
    PAIR_ACCESS_CODE_TTL_SEC: '600',
    PAIR_CLIENT_TOKEN_MAX: '4',
    PAIR_REGISTER_LIMITER: createAlwaysAllowRegisterLimiter(),
  };
}

function createAlwaysAllowRegisterLimiter() {
  return {
    getByName: () => ({
      consume: async (nowMs: number) => ({ allowed: true, count: 1, resetAt: nowMs + 60 * 60 * 1000 }),
    }),
  };
}

describe('Hermes registry worker', () => {
  it('registers a gateway and claims a single-use access code', async () => {
    const env = createEnv();
    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Studio Mac', preferredRegion: 'us' }),
    }), env);
    expect(registerRes.status).toBe(200);
    const registered = await registerRes.json() as {
      bridgeId: string;
      relaySecret: string;
      relayUrl: string;
      accessCode: string;
      accessCodeExpiresAt: string;
      displayName: string | null;
    };
    expect(registered.bridgeId).toMatch(/^hbg_/);
    expect(registered.relaySecret).toMatch(/^hrs_/);
    expect(registered.relayUrl).toBe('wss://relay-us.example.com/ws');
    expect(registered.accessCode).toMatch(ACCESS_CODE_PATTERN);
    expect(registered.displayName).toBe('Studio Mac');
    expect(Number.isFinite(Date.parse(registered.accessCodeExpiresAt))).toBe(true);

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bridgeId: registered.bridgeId,
        accessCode: registered.accessCode,
        clientLabel: 'iPhone',
      }),
    }), env);
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json() as { clientToken: string; relayUrl: string };
    expect(claimed.clientToken).toMatch(/^hct_/);
    expect(claimed.relayUrl).toBe(registered.relayUrl);

    const secondClaimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bridgeId: registered.bridgeId, accessCode: registered.accessCode }),
    }), env);
    expect(secondClaimRes.status).toBe(409);
  });

  it('refreshes access code with the relay secret and verifies gateway/client tokens', async () => {
    const env = createEnv();
    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredRegion: 'sg' }),
    }), env);
    const registered = await registerRes.json() as {
      bridgeId: string;
      relaySecret: string;
      accessCode: string;
    };

    const refreshRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/access-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bridgeId: registered.bridgeId, relaySecret: registered.relaySecret }),
    }), env);
    expect(refreshRes.status).toBe(200);
    const refreshed = await refreshRes.json() as { accessCode: string };
    expect(refreshed.accessCode).toMatch(ACCESS_CODE_PATTERN);
    expect(refreshed.accessCode).not.toBe(registered.accessCode);

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bridgeId: registered.bridgeId, accessCode: refreshed.accessCode }),
    }), env);
    const claimed = await claimRes.json() as { clientToken: string };
    const verifyUrl = `https://registry.example.com/v1/hermes/verify/${encodeURIComponent(registered.bridgeId)}`;

    const verifyOwner = await fetchHandler(new Request(verifyUrl, {
      headers: { authorization: `Bearer ${registered.relaySecret}` },
    }), env);
    expect(verifyOwner.status).toBe(200);
    await expect(verifyOwner.json()).resolves.toEqual({ ok: true, role: 'gateway' });

    const verifyClient = await fetchHandler(new Request(verifyUrl, {
      headers: { authorization: `Bearer ${claimed.clientToken}` },
    }), env);
    expect(verifyClient.status).toBe(200);
    await expect(verifyClient.json()).resolves.toEqual({ ok: true, role: 'client' });

    const verifyBad = await fetchHandler(new Request(verifyUrl, {
      headers: { authorization: 'Bearer nope' },
    }), env);
    expect(verifyBad.status).toBe(401);
  });

  it('syncs active client token hashes to relay after claim when pairing sync is configured', async () => {
    const env = { ...createEnv(), PAIRING_SYNC_SECRET: 'sync-secret' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredRegion: 'us' }),
      }), env);
      const registered = await registerRes.json() as { bridgeId: string; accessCode: string };
      const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bridgeId: registered.bridgeId, accessCode: registered.accessCode }),
      }), env);
      expect(claimRes.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://relay-us.example.com/v1/internal/hermes/pairing/client-tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-clawket-pairing-sync-secret': 'sync-secret' }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps legacy KV pairing records readable after reusable-code fields are removed', async () => {
    const env = createEnv();
    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Legacy Host', preferredRegion: 'us' }),
    }), env);
    const registered = await registerRes.json() as { bridgeId: string; accessCode: string };
    const key = `hermes-pair-bridge:${registered.bridgeId}`;
    const raw = await env.HERMES_ROUTES_KV.get(key);
    const legacyRecord = JSON.parse(raw as string) as Record<string, unknown>;
    legacyRecord.clientTokens = [{
      hash: 'legacy-client-hash',
      label: 'Legacy Client',
      createdAt: '2026-03-01T00:00:00.000Z',
      lastUsedAt: null,
      issuedByReusableCodeId: 'prcid_legacy',
    }];
    legacyRecord.reusableCodes = [{ codeId: 'prcid_legacy', note: 'deprecated' }];
    await env.HERMES_ROUTES_KV.put(key, JSON.stringify(legacyRecord));

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bridgeId: registered.bridgeId,
        accessCode: registered.accessCode,
        clientLabel: 'Current iPhone',
      }),
    }), env);
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json() as { clientToken: string };
    expect(claimed.clientToken).toMatch(/^hct_/);

    const verifyClient = await fetchHandler(new Request(
      `https://registry.example.com/v1/hermes/verify/${encodeURIComponent(registered.bridgeId)}`,
      { headers: { authorization: `Bearer ${claimed.clientToken}` } },
    ), env);
    expect(verifyClient.status).toBe(200);
    const updated = JSON.parse(await env.HERMES_ROUTES_KV.get(key) as string) as {
      accessCodeHash: string | null;
      accessCodeExpiresAt: string | null;
      clientTokens: Array<Record<string, unknown>>;
    };
    expect(updated.accessCodeHash).toBeNull();
    expect(updated.accessCodeExpiresAt).toBeNull();
    expect(updated.clientTokens[0]).toEqual(expect.objectContaining({ label: 'Current iPhone' }));
    expect(updated.clientTokens[0]).not.toHaveProperty('issuedByReusableCodeId');
  });

  it('accepts legacy unclaimed numeric access codes after the new generator format rollout', async () => {
    const env = createEnv();
    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Legacy Numeric Host', preferredRegion: 'us' }),
    }), env);
    const registered = await registerRes.json() as { bridgeId: string };
    const key = `hermes-pair-bridge:${registered.bridgeId}`;
    const record = JSON.parse(await env.HERMES_ROUTES_KV.get(key) as string) as Record<string, unknown>;
    record.accessCodeHash = await sha256Hex('123456');
    record.accessCodeExpiresAt = new Date(Date.now() + 60_000).toISOString();
    await env.HERMES_ROUTES_KV.put(key, JSON.stringify(record));

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bridgeId: registered.bridgeId, accessCode: '123456', clientLabel: 'Legacy iPhone' }),
    }), env);
    expect(claimRes.status).toBe(200);
    await expect(claimRes.json()).resolves.toEqual(expect.objectContaining({
      bridgeId: registered.bridgeId,
      clientToken: expect.stringMatching(/^hct_/),
      displayName: 'Legacy Numeric Host',
      region: 'us',
    }));
  });

  it('returns an explicit corruption error when a stored pairing record is invalid', async () => {
    const env = createEnv();
    await env.HERMES_ROUTES_KV.put('hermes-pair-bridge:hbg_broken_1', '{"bridgeId":"hbg_broken_1"}');
    const expected = {
      error: {
        code: 'PAIRING_RECORD_CORRUPT',
        message: 'Stored Hermes pairing record for hbg_broken_1 is invalid. Reset the Hermes bridge pairing and pair again.',
      },
    };

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bridgeId: 'hbg_broken_1', accessCode: '123456' }),
    }), env);
    expect(claimRes.status).toBe(500);
    await expect(claimRes.json()).resolves.toEqual(expected);

    const verifyRes = await fetchHandler(new Request('https://registry.example.com/v1/hermes/verify/hbg_broken_1', {
      headers: { authorization: 'Bearer some-token' },
    }), env);
    expect(verifyRes.status).toBe(500);
    await expect(verifyRes.json()).resolves.toEqual(expected);
  });
});
