import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PairingConfig } from './config.js';
import { pairGateway, refreshAccessCode } from './pairing.js';

const { state, readPairingConfigMock, writePairingConfigMock } = vi.hoisted(() => {
  const sharedState: { config: PairingConfig | null } = {
    config: null,
  };

  return {
    state: sharedState,
    readPairingConfigMock: vi.fn(() => sharedState.config),
    writePairingConfigMock: vi.fn((config: PairingConfig) => {
      sharedState.config = config;
    }),
  };
});

vi.mock('./config.js', () => ({
  getDefaultBridgeDisplayName: vi.fn(() => 'Lucy'),
  pickOpenClawDefaultAgentName: vi.fn(() => 'Lucy'),
  readPairingConfig: readPairingConfigMock,
  writePairingConfig: writePairingConfigMock,
}));

describe('pairing api responses', () => {
  beforeEach(() => {
    state.config = null;
    readPairingConfigMock.mockClear();
    writePairingConfigMock.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts an alphanumeric access code from pair/register', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      gatewayId: 'gateway-1',
      relaySecret: 'secret-1',
      relayUrl: 'wss://relay.example.com/ws',
      accessCode: 'AB7K9Q',
      accessCodeExpiresAt: '2026-03-22T01:00:00.000Z',
      displayName: 'Studio Mac',
      region: 'global',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await pairGateway({
      serverUrl: 'https://registry.example.com',
      displayName: 'Studio Mac',
    });

    expect(result.accessCode).toBe('AB7K9Q');
    expect(JSON.parse(result.qrPayload)).toMatchObject({
      g: 'gateway-1',
      a: 'AB7K9Q',
      s: 'https://registry.example.com',
    });
    expect(writePairingConfigMock).toHaveBeenCalledTimes(1);
  });

  it('adds an encrypted one-tap pairing session while preserving the compatibility QR', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        gatewayId: 'gateway-1',
        relaySecret: 'secret-1',
        relayUrl: 'wss://relay.example.com/ws',
        accessCode: 'AB7K9Q',
        accessCodeExpiresAt: '2026-03-22T01:00:00.000Z',
        displayName: 'Studio Mac',
        region: 'global',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sessionId: `ps_${'a'.repeat(64)}`,
        pairingUrl: `https://registry.example.com/pair/ps_${'a'.repeat(64)}`,
        expiresAt: '2026-03-22T01:00:00.000Z',
        displayName: 'Studio Mac',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await pairGateway({
      serverUrl: 'https://registry.example.com',
      displayName: 'Studio Mac',
    });

    expect(JSON.parse(result.qrPayload)).toMatchObject({
      g: 'gateway-1',
      a: 'AB7K9Q',
    });
    expect(result.pairingSession?.pairingUrl).toContain(`/pair/ps_${'a'.repeat(64)}#`);
    expect(result.pairingSession?.pairingCode).toMatch(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/);
    const sessionRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Record<string, unknown>;
    expect(sessionRequest).not.toHaveProperty('qrPayload');
    expect(JSON.stringify(sessionRequest)).not.toContain('AB7K9Q');
  });

  it('reads and writes Preview pairing state without touching production state', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      gatewayId: 'gateway-preview',
      relaySecret: 'secret-preview',
      relayUrl: 'wss://relay-preview.example.com/ws',
      accessCode: 'PV8W2K',
      accessCodeExpiresAt: '2026-03-22T01:00:00.000Z',
      displayName: 'Preview Mac',
      region: 'global',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await pairGateway({
      serverUrl: 'https://registry-preview.example.com',
      displayName: 'Preview Mac',
      environment: 'preview',
    });

    expect(readPairingConfigMock).toHaveBeenCalledWith('preview');
    expect(writePairingConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      gatewayId: 'gateway-preview',
    }), 'preview');
  });

  it('accepts an alphanumeric access code from pair/access-code refresh', async () => {
    state.config = {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gateway-1',
      relaySecret: 'secret-1',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'inst-1',
      displayName: 'Studio Mac',
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      gatewayId: 'gateway-1',
      relayUrl: 'wss://relay.example.com/ws',
      accessCode: 'ZX8M4R',
      accessCodeExpiresAt: '2026-03-22T01:00:00.000Z',
      displayName: 'Studio Mac',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await refreshAccessCode();

    expect(result.accessCode).toBe('ZX8M4R');
    expect(JSON.parse(result.qrPayload)).toMatchObject({
      g: 'gateway-1',
      a: 'ZX8M4R',
      s: 'https://registry.example.com',
    });
    expect(writePairingConfigMock).toHaveBeenCalledTimes(1);
  });
});
