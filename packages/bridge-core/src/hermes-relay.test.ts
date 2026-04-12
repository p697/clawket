import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('hermes relay helpers', () => {
  const originalFetch = global.fetch;
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'clawket-hermes-relay-home-'));
    vi.stubEnv('HOME', homeDir);
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    rmSync(homeDir, { recursive: true, force: true });
  });

  async function loadSubject() {
    return import('./hermes-relay.js');
  }

  it('normalizes websocket registry bases into http urls', async () => {
    const { normalizeHermesRelayHttpBase } = await loadSubject();
    expect(normalizeHermesRelayHttpBase('wss://registry.example.com/')).toBe('https://registry.example.com');
    expect(normalizeHermesRelayHttpBase('ws://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeHermesRelayHttpBase('registry.example.com')).toBe('https://registry.example.com');
  });

  it('only refreshes Hermes relay pairing on the same server', async () => {
    const { assessHermesRelayPairingCompatibility } = await loadSubject();
    expect(assessHermesRelayPairingCompatibility(null, 'https://registry.example.com')).toBe('register-new');
    expect(assessHermesRelayPairingCompatibility({
      serverUrl: 'https://registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_123',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }, 'https://registry.example.com')).toBe('refresh-existing');
    expect(assessHermesRelayPairingCompatibility({
      serverUrl: 'https://registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_123',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }, 'https://staging.example.com')).toBe('server-mismatch');
  });

  it('registers a new Hermes relay pairing into isolated config state', async () => {
    const { pairHermesRelay, readHermesRelayConfig } = await loadSubject();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_secret',
      relayUrl: 'wss://relay.example.com/ws',
      accessCode: 'ABCD23',
      accessCodeExpiresAt: '2026-04-11T01:00:00.000Z',
      displayName: 'Hermes',
      region: 'us',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await pairHermesRelay({
      serverUrl: 'wss://registry.example.com',
      displayName: 'Hermes',
    });

    expect(global.fetch).toHaveBeenCalledWith('https://registry.example.com/v1/hermes/pair/register', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.config.bridgeId).toBe('hbg_123');
    expect(result.qrPayload).toContain('"kind":"clawket_hermes_pair"');
    expect(readHermesRelayConfig()).toMatchObject({
      serverUrl: 'https://registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_secret',
      relayUrl: 'wss://relay.example.com/ws',
    });
  });

  it('refreshes an existing Hermes relay pairing without re-registering', async () => {
    const { refreshHermesRelayAccessCode } = await loadSubject();
    const configDir = join(homeDir, '.clawket');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'hermes-relay.json'), JSON.stringify({
      serverUrl: 'https://registry.example.com',
      bridgeId: 'hbg_existing',
      relaySecret: 'hrs_existing',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }, null, 2));

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      bridgeId: 'hbg_existing',
      relayUrl: 'wss://relay.example.com/ws',
      accessCode: 'ZXCV12',
      accessCodeExpiresAt: '2026-04-11T02:00:00.000Z',
      displayName: 'Hermes',
      region: 'us',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await refreshHermesRelayAccessCode();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.action).toBe('refreshed');
    expect(result.config.bridgeId).toBe('hbg_existing');
    expect(result.qrPayload).toContain('"accessCode":"ZXCV12"');
  });

  it('falls back to register when refresh hits BRIDGE_NOT_FOUND on the same server', async () => {
    const { pairHermesRelay, readHermesRelayConfig } = await loadSubject();
    const configDir = join(homeDir, '.clawket');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'hermes-relay.json'), JSON.stringify({
      serverUrl: 'http://127.0.0.1:8787',
      bridgeId: 'hbg_missing',
      relaySecret: 'hrs_missing',
      relayUrl: 'ws://127.0.0.1:8788/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }, null, 2));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/hermes/pair/access-code')) {
        return new Response(JSON.stringify({
          error: {
            code: 'BRIDGE_NOT_FOUND',
            message: 'Bridge not found',
          },
        }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/hermes/pair/register')) {
        return new Response(JSON.stringify({
          bridgeId: 'hbg_new',
          relaySecret: 'hrs_new',
          relayUrl: 'ws://127.0.0.1:8788/ws',
          accessCode: 'MNOP45',
          accessCodeExpiresAt: '2026-04-11T03:00:00.000Z',
          displayName: 'Hermes Local',
          region: 'local',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await pairHermesRelay({
      serverUrl: 'http://127.0.0.1:8787',
      displayName: 'Hermes Local',
    });

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))).toEqual([
      'http://127.0.0.1:8787/v1/hermes/pair/access-code',
      'http://127.0.0.1:8787/v1/hermes/pair/register',
    ]);
    expect(result.action).toBe('registered');
    expect(readHermesRelayConfig()).toMatchObject({
      bridgeId: 'hbg_new',
      relaySecret: 'hrs_new',
    });
  });

  it('re-pairs Hermes against a different server by replacing the old config', async () => {
    const { pairHermesRelay, readHermesRelayConfig } = await loadSubject();
    const configDir = join(homeDir, '.clawket');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'hermes-relay.json'), JSON.stringify({
      serverUrl: 'https://registry.example.com',
      bridgeId: 'hbg_existing',
      relaySecret: 'hrs_existing',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }, null, 2));

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      bridgeId: 'hbg_new',
      relaySecret: 'hrs_new',
      relayUrl: 'wss://relay-local.example.com/ws',
      accessCode: 'MNOP45',
      accessCodeExpiresAt: '2026-04-11T03:00:00.000Z',
      displayName: 'Hermes Local',
      region: 'local',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await pairHermesRelay({
      serverUrl: 'http://127.0.0.1:8787',
      displayName: 'Hermes Local',
    });

    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:8787/v1/hermes/pair/register', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.action).toBe('registered');
    expect(readHermesRelayConfig()).toMatchObject({
      serverUrl: 'http://127.0.0.1:8787',
      bridgeId: 'hbg_new',
      relaySecret: 'hrs_new',
      relayUrl: 'wss://relay-local.example.com/ws',
    });
  });
});
