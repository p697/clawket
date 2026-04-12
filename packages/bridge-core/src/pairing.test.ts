import { describe, expect, it } from 'vitest';
import {
  assessPairingCompatibility,
  isCloudflareChallengeResponse,
  normalizeHttpBase,
  resolveCloudflareChallengeFallbackUrl,
} from './pairing.js';
import { getDefaultBridgeDisplayName, pickOpenClawDefaultAgentName } from './config.js';
import { buildGatewayQrPayload, buildHermesLocalPairingQrPayload, buildHermesRelayPairingQrPayload, buildPairingQrPayload } from './qr.js';
import type { PairingConfig } from './config.js';

const baseConfig: PairingConfig = {
  serverUrl: 'https://registry.example.com',
  gatewayId: 'gateway-1',
  relaySecret: 'secret-1',
  relayUrl: 'wss://relay.example.com/ws',
  instanceId: 'inst-1',
  displayName: 'Studio Mac',
  createdAt: '2026-03-08T00:00:00.000Z',
  updatedAt: '2026-03-08T00:00:00.000Z',
};

describe('pairing helpers', () => {
  it('normalizes http bases from websocket URLs', () => {
    expect(normalizeHttpBase('wss://registry.example.com/')).toBe('https://registry.example.com');
    expect(normalizeHttpBase('ws://localhost:8787')).toBe('http://localhost:8787');
  });

  it('refreshes existing pairing only on the same server', () => {
    expect(assessPairingCompatibility(baseConfig, 'https://registry.example.com')).toBe('refresh-existing');
    expect(assessPairingCompatibility(baseConfig, 'https://staging.example.com')).toBe('server-mismatch');
    expect(assessPairingCompatibility(null, 'https://registry.example.com')).toBe('register-new');
  });

  it('detects Cloudflare challenge responses from the registry edge', () => {
    const response = new Response('blocked', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
    });

    expect(isCloudflareChallengeResponse(response)).toBe(true);
  });

  it('does not ship a fallback registry mapping in source checkouts', () => {
    const response = new Response('blocked', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
    });

    expect(resolveCloudflareChallengeFallbackUrl('https://registry.example.com/v1/pair/register', response)).toBeNull();
    expect(resolveCloudflareChallengeFallbackUrl('https://example.com/v1/pair/register', response)).toBeNull();
  });

  it('returns a non-empty default bridge display name', () => {
    expect(getDefaultBridgeDisplayName().trim().length).toBeGreaterThan(0);
  });

  it('encodes password auth into the pairing QR payload', () => {
    const payload = JSON.parse(buildPairingQrPayload({
      server: 'https://registry.example.com',
      gatewayId: 'gateway-1',
      accessCode: 'AB7K9Q',
      password: 'gateway-password',
    })) as { a?: string; p?: string; t?: string; rb?: number; pv?: number; sb?: boolean };

    expect(payload.a).toBe('AB7K9Q');
    expect(payload.p).toBe('gateway-password');
    expect(payload.t).toBeUndefined();
    expect(payload.rb).toBe(1);
    expect(payload.pv).toBe(2);
    expect(payload.sb).toBe(true);
  });

  it('adds relay bootstrap capability without dropping legacy token/password fields', () => {
    const payload = JSON.parse(buildPairingQrPayload({
      server: 'https://registry.example.com',
      gatewayId: 'gateway-1',
      accessCode: 'ZX8M4R',
      token: 'gateway-token',
      password: 'gateway-password',
    })) as { a?: string; rb?: number; pv?: number; sb?: boolean; t?: string; p?: string };

    expect(payload).toMatchObject({
      a: 'ZX8M4R',
      rb: 1,
      pv: 2,
      sb: true,
      t: 'gateway-token',
      p: 'gateway-password',
    });
  });

  it('encodes password auth into the gateway QR payload', () => {
    const payload = JSON.parse(buildGatewayQrPayload({
      gatewayUrl: 'http://100.88.1.7:18789',
      password: 'gateway-password',
      expiresAt: 123,
    })) as { password?: string; token?: string; url?: string };

    expect(payload.password).toBe('gateway-password');
    expect(payload.token).toBeUndefined();
    expect(payload.url).toBe('ws://100.88.1.7:18789/');
  });

  it('builds a hermes local pairing payload on a separate kind', () => {
    const payload = JSON.parse(buildHermesLocalPairingQrPayload({
      bridgeWsUrl: 'ws://192.168.1.20:4319/v1/hermes/ws?token=secret',
      bridgeHttpUrl: 'http://192.168.1.20:4319',
      displayName: 'Hermes',
      expiresAt: 123,
    })) as {
      kind?: string;
      mode?: string;
      url?: string;
      expiresAt?: number;
      hermes?: { bridgeUrl?: string; displayName?: string };
    };

    expect(payload).toEqual({
      version: 1,
      kind: 'clawket_hermes_local',
      mode: 'hermes',
      url: 'ws://192.168.1.20:4319/v1/hermes/ws?token=secret',
      expiresAt: 123,
      hermes: {
        bridgeUrl: 'http://192.168.1.20:4319',
        displayName: 'Hermes',
      },
    });
  });

  it('builds a hermes relay pairing payload on a separate kind', () => {
    const payload = JSON.parse(buildHermesRelayPairingQrPayload({
      server: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      accessCode: 'ABC234',
      displayName: 'Hermes',
      relayUrl: 'wss://hermes-relay.example.com/ws',
    })) as {
      kind?: string;
      backend?: string;
      transport?: string;
      server?: string;
      bridgeId?: string;
      accessCode?: string;
      relayUrl?: string;
      displayName?: string;
    };

    expect(payload).toEqual({
      version: 1,
      kind: 'clawket_hermes_pair',
      backend: 'hermes',
      transport: 'relay',
      server: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      accessCode: 'ABC234',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      displayName: 'Hermes',
    });
  });

  it('prefers the default OpenClaw agent identity name', () => {
    expect(
      pickOpenClawDefaultAgentName({
        agents: {
          list: [
            { id: 'main', default: true, name: 'Main', identity: { name: 'Lucy' } },
            { id: 'other', name: 'Other' },
          ],
        },
      }),
    ).toBe('Lucy');
  });

  it('falls back to the main agent name when identity name is missing', () => {
    expect(
      pickOpenClawDefaultAgentName({
        agents: {
          list: [
            { id: 'main', name: 'Lucy' },
            { id: 'other', name: 'Other' },
          ],
        },
      }),
    ).toBe('Lucy');
  });
});
