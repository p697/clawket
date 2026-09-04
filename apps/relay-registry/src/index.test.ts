import { describe, expect, it, vi } from 'vitest';
import { sha256Hex, verifyPairingRelayTicket } from '@clawket/shared';
import worker from './index';

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

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function createEnv() {
  return {
    ROUTES_KV: new MemoryKV() as unknown as KVNamespace,
    RELAY_REGION_MAP: JSON.stringify({
      us: 'wss://relay-us.example.com/ws',
      sg: 'wss://relay-sg.example.com/ws',
    }),
    PAIR_ACCESS_CODE_TTL_SEC: '600',
    PAIR_CLIENT_TOKEN_MAX: '4',
    PAIRING_TICKET_SECRET: 'test-pairing-ticket-secret-that-is-long-enough',
    RELAY_SYNC_SERVICE: {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        ok: true,
        capabilities: ['pairing.secure-short-code.v2'],
      }), { status: 200 })),
    },
  };
}

describe('registry worker', () => {
  it('creates encrypted one-tap and short-code pairing sessions without exposing the legacy payload', async () => {
    const env = createEnv();
    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Studio Mac', preferredRegion: 'us' }),
    }), env);
    const registered = await registerRes.json() as {
      gatewayId: string;
      relaySecret: string;
      accessCode: string;
    };
    const codeHash = await sha256Hex('ABCD-EFGH-JKLM');
    const shortCodeHash = await sha256Hex('123456');
    const encrypted = {
      nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    };
    const createRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registered.gatewayId,
        relaySecret: registered.relaySecret,
        codeHash,
        shortCodeHash,
        linkPayload: encrypted,
        codePayload: { ...encrypted, ciphertext: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
      }),
    }), env);
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as {
      sessionId: string;
      pairingUrl: string;
      displayName: string;
      capabilities: string[];
    };
    expect(created.sessionId).toMatch(/^ps_[a-f0-9]{64}$/);
    expect(created.pairingUrl).toBe(`https://registry.example.com/pair/${created.sessionId}`);
    expect(created.displayName).toBe('Studio Mac');
    expect(created.capabilities).toContain('pairing.secure-short-code.v2');

    const secureResolveRes = await fetchHandler(new Request('https://registry.example.com/v2/pair/session/resolve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.11',
      },
      body: JSON.stringify({ codeHash: shortCodeHash }),
    }), env);
    expect(secureResolveRes.status).toBe(200);
    const secureResolved = await secureResolveRes.json() as {
      protocol: number;
      sessionId: string;
      gatewayId: string;
      relayTicket: string;
    };
    expect(secureResolved).toMatchObject({
      protocol: 2,
      sessionId: created.sessionId,
      gatewayId: registered.gatewayId,
    });
    await expect(verifyPairingRelayTicket({
      token: secureResolved.relayTicket,
      secret: env.PAIRING_TICKET_SECRET,
      gatewayId: registered.gatewayId,
    })).resolves.toMatchObject({
      scope: 'pairing',
      sessionId: created.sessionId,
    });

    const readRes = await fetchHandler(new Request(
      `https://registry.example.com/v1/pair/session/${created.sessionId}`,
    ), env);
    expect(readRes.status).toBe(200);
    await expect(readRes.json()).resolves.toMatchObject({
      sessionId: created.sessionId,
      displayName: 'Studio Mac',
      encryptedPayload: encrypted,
    });

    const resolveRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/session/resolve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.10',
      },
      body: JSON.stringify({ codeHash }),
    }), env);
    expect(resolveRes.status).toBe(200);
    await expect(resolveRes.json()).resolves.toMatchObject({
      encryptedPayload: { ciphertext: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
    });

    const pageRes = await fetchHandler(new Request(created.pairingUrl), env);
    expect(pageRes.status).toBe(200);
    const page = await pageRes.text();
    expect(page).toContain('Connect to Studio Mac');
    expect(page).not.toContain(registered.accessCode);

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registered.gatewayId,
        accessCode: registered.accessCode,
      }),
    }), env);
    expect(claimRes.status).toBe(200);
    const consumedRes = await fetchHandler(new Request(
      `https://registry.example.com/v1/pair/session/${created.sessionId}`,
    ), env);
    expect(consumedRes.status).toBe(404);
  });

  it('falls back to the legacy pairing code when Relay has not advertised secure pairing', async () => {
    const env = {
      ...createEnv(),
      RELAY_SYNC_SERVICE: {
        fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true, capabilities: [] }), { status: 200 })),
      },
    };
    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredRegion: 'us' }),
    }), env);
    const registered = await registerRes.json() as { gatewayId: string; relaySecret: string };
    const encrypted = {
      nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    };
    const createRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registered.gatewayId,
        relaySecret: registered.relaySecret,
        codeHash: await sha256Hex('ABCD-EFGH-JKLM'),
        shortCodeHash: await sha256Hex('123456'),
        linkPayload: encrypted,
        codePayload: encrypted,
      }),
    }), env);
    expect(createRes.status).toBe(200);
    await expect(createRes.json()).resolves.toMatchObject({ capabilities: [] });
  });

  it('rate limits pairing-code resolution attempts and serves native association documents', async () => {
    const env = createEnv();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetchHandler(new Request('https://registry.example.com/v1/pair/session/resolve', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.20',
        },
        body: JSON.stringify({ codeHash: '0'.repeat(64) }),
      }), env);
      expect(response.status).toBe(404);
    }
    const limited = await fetchHandler(new Request('https://registry.example.com/v1/pair/session/resolve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.20',
      },
      body: JSON.stringify({ codeHash: '0'.repeat(64) }),
    }), env);
    expect(limited.status).toBe(429);

    const apple = await fetchHandler(new Request(
      'https://registry.example.com/.well-known/apple-app-site-association',
    ), env);
    expect(apple.status).toBe(200);
    await expect(apple.json()).resolves.toMatchObject({
      applinks: { details: [{ appIDs: ['C8TM82D73W.com.p697.clawket'] }] },
    });
    const android = await fetchHandler(new Request(
      'https://registry.example.com/.well-known/assetlinks.json',
    ), env);
    await expect(android.json()).resolves.toEqual([]);
  });

  it('registers a gateway and claims a single-use access code', async () => {
    const env = createEnv();

    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Studio Mac', preferredRegion: 'us' }),
    }), env);
    expect(registerRes.status).toBe(200);
    const registerBody = await registerRes.json() as {
      gatewayId: string;
      relaySecret: string;
      relayUrl: string;
      accessCode: string;
      accessCodeExpiresAt: string;
      displayName: string | null;
    };
    expect(registerBody.gatewayId).toMatch(/^gw_/);
    expect(registerBody.relaySecret).toMatch(/^grs_/);
    expect(registerBody.relayUrl).toBe('wss://relay-us.example.com/ws');
    expect(registerBody.accessCode).toMatch(ACCESS_CODE_PATTERN);
    expect(registerBody.displayName).toBe('Studio Mac');
    expect(Number.isFinite(Date.parse(registerBody.accessCodeExpiresAt))).toBe(true);

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registerBody.gatewayId,
        accessCode: registerBody.accessCode,
        clientLabel: 'iPhone',
      }),
    }), env);
    expect(claimRes.status).toBe(200);
    const claimBody = await claimRes.json() as { clientToken: string; relayUrl: string };
    expect(claimBody.clientToken).toMatch(/^gct_/);
    expect(claimBody.relayUrl).toBe(registerBody.relayUrl);

    const secondClaimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registerBody.gatewayId,
        accessCode: registerBody.accessCode,
      }),
    }), env);
    expect(secondClaimRes.status).toBe(409);
  });

  it('refreshes access code with the relay secret and verifies gateway/client tokens', async () => {
    const env = createEnv();

    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredRegion: 'sg' }),
    }), env);
    const registerBody = await registerRes.json() as {
      gatewayId: string;
      relaySecret: string;
      accessCode: string;
    };

    const refreshRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/access-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registerBody.gatewayId,
        relaySecret: registerBody.relaySecret,
      }),
    }), env);
    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json() as { accessCode: string };
    expect(refreshBody.accessCode).toMatch(ACCESS_CODE_PATTERN);
    expect(refreshBody.accessCode).not.toBe(registerBody.accessCode);

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registerBody.gatewayId,
        accessCode: refreshBody.accessCode,
      }),
    }), env);
    const claimBody = await claimRes.json() as { clientToken: string };

    const verifyGateway = await fetchHandler(new Request(`https://registry.example.com/v1/verify/${encodeURIComponent(registerBody.gatewayId)}`, {
      headers: { authorization: `Bearer ${registerBody.relaySecret}` },
    }), env);
    expect(verifyGateway.status).toBe(200);

    const verifyClient = await fetchHandler(new Request(`https://registry.example.com/v1/verify/${encodeURIComponent(registerBody.gatewayId)}`, {
      headers: { authorization: `Bearer ${claimBody.clientToken}` },
    }), env);
    expect(verifyClient.status).toBe(200);

    const verifyBad = await fetchHandler(new Request(`https://registry.example.com/v1/verify/${encodeURIComponent(registerBody.gatewayId)}`, {
      headers: { authorization: 'Bearer nope' },
    }), env);
    expect(verifyBad.status).toBe(401);
  });

  it('syncs active client token hashes to relay after claim when pairing sync is configured', async () => {
    const env = {
      ...createEnv(),
      PAIRING_SYNC_SECRET: 'sync-secret',
      RELAY_SYNC_SERVICE: undefined,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredRegion: 'us' }),
      }), env);
      const registerBody = await registerRes.json() as { gatewayId: string; accessCode: string };

      const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gatewayId: registerBody.gatewayId,
          accessCode: registerBody.accessCode,
        }),
      }), env);
      expect(claimRes.status).toBe(200);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://relay-us.example.com/v1/internal/pairing/client-tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-clawket-pairing-sync-secret': 'sync-secret',
          }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('prefers a Relay service binding for immediate token synchronization', async () => {
    const serviceFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const env = {
      ...createEnv(),
      PAIRING_SYNC_SECRET: 'sync-secret',
      RELAY_SYNC_SERVICE: { fetch: serviceFetch },
    };

    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredRegion: 'us' }),
    }), env as never);
    const registerBody = await registerRes.json() as { gatewayId: string; accessCode: string };
    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registerBody),
    }), env as never);

    expect(claimRes.status).toBe(200);
    expect(serviceFetch).toHaveBeenCalledWith(
      'https://relay-us.example.com/v1/internal/pairing/client-tokens',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps legacy KV pairing records readable after reusable-code fields are removed', async () => {
    const env = createEnv();

    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Legacy Host', preferredRegion: 'us' }),
    }), env);
    expect(registerRes.status).toBe(200);
    const registerBody = await registerRes.json() as {
      gatewayId: string;
      relaySecret: string;
      accessCode: string;
    };

    const key = `pair-gateway:${registerBody.gatewayId}`;
    const raw = await env.ROUTES_KV.get(key);
    expect(raw).toBeTruthy();
    const legacyRecord = JSON.parse(raw as string) as Record<string, unknown>;
    legacyRecord.clientTokens = [
      {
        hash: 'legacy-client-hash',
        label: 'Legacy Client',
        createdAt: '2026-03-01T00:00:00.000Z',
        lastUsedAt: null,
        issuedByReusableCodeId: 'prcid_legacy',
      },
    ];
    legacyRecord.reusableCodes = [
      {
        codeId: 'prcid_legacy',
        hash: 'legacy-reusable-hash',
        label: 'Legacy code',
        createdAt: '2026-03-01T00:00:00.000Z',
        createdBy: 'ops',
        lastClaimedAt: null,
        claimCount: 0,
        revokedAt: null,
        note: 'deprecated',
      },
    ];
    await env.ROUTES_KV.put(key, JSON.stringify(legacyRecord));

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registerBody.gatewayId,
        accessCode: registerBody.accessCode,
        clientLabel: 'Current iPhone',
      }),
    }), env);
    expect(claimRes.status).toBe(200);
    const claimBody = await claimRes.json() as { clientToken: string };
    expect(claimBody.clientToken).toMatch(/^gct_/);

    const verifyClient = await fetchHandler(new Request(`https://registry.example.com/v1/verify/${encodeURIComponent(registerBody.gatewayId)}`, {
      headers: { authorization: `Bearer ${claimBody.clientToken}` },
    }), env);
    expect(verifyClient.status).toBe(200);

    const updatedRaw = await env.ROUTES_KV.get(key);
    const updatedRecord = JSON.parse(updatedRaw as string) as {
      accessCodeHash: string | null;
      accessCodeExpiresAt: string | null;
      clientTokens: Array<Record<string, unknown>>;
    };
    expect(updatedRecord.accessCodeHash).toBeNull();
    expect(updatedRecord.accessCodeExpiresAt).toBeNull();
    expect(updatedRecord.clientTokens[0]).toEqual(expect.objectContaining({
      label: 'Current iPhone',
    }));
    expect(updatedRecord.clientTokens[0]).not.toHaveProperty('issuedByReusableCodeId');
  });

  it('accepts legacy unclaimed numeric access codes after the new generator format rollout', async () => {
    const env = createEnv();

    const registerRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Legacy Numeric Host', preferredRegion: 'us' }),
    }), env);
    expect(registerRes.status).toBe(200);
    const registerBody = await registerRes.json() as { gatewayId: string };

    const key = `pair-gateway:${registerBody.gatewayId}`;
    const raw = await env.ROUTES_KV.get(key);
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw as string) as Record<string, unknown>;
    record.accessCodeHash = await sha256Hex('123456');
    record.accessCodeExpiresAt = new Date(Date.now() + 60_000).toISOString();
    await env.ROUTES_KV.put(key, JSON.stringify(record));

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: registerBody.gatewayId,
        accessCode: '123456',
        clientLabel: 'Legacy iPhone',
      }),
    }), env);
    expect(claimRes.status).toBe(200);
    await expect(claimRes.json()).resolves.toEqual(expect.objectContaining({
      gatewayId: registerBody.gatewayId,
      clientToken: expect.stringMatching(/^gct_/),
      displayName: 'Legacy Numeric Host',
      region: 'us',
    }));
  });

  it('returns an explicit corruption error when a stored pairing record is invalid', async () => {
    const env = createEnv();
    await env.ROUTES_KV.put('pair-gateway:gw_broken_1', '{"gatewayId":"gw_broken_1"}');

    const claimRes = await fetchHandler(new Request('https://registry.example.com/v1/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: 'gw_broken_1',
        accessCode: '123456',
      }),
    }), env);
    expect(claimRes.status).toBe(500);
    await expect(claimRes.json()).resolves.toEqual({
      error: {
        code: 'PAIRING_RECORD_CORRUPT',
        message: 'Stored pairing record for gw_broken_1 is invalid. Reset the bridge pairing and pair again.',
      },
    });

    const verifyRes = await fetchHandler(new Request('https://registry.example.com/v1/verify/gw_broken_1', {
      headers: { authorization: 'Bearer some-token' },
    }), env);
    expect(verifyRes.status).toBe(500);
    await expect(verifyRes.json()).resolves.toEqual({
      error: {
        code: 'PAIRING_RECORD_CORRUPT',
        message: 'Stored pairing record for gw_broken_1 is invalid. Reset the bridge pairing and pair again.',
      },
    });
  });
});
