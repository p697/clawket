import { describe, expect, it } from 'vitest';
import {
  constantTimeSecretEqual,
  isSecurePairingSecretConfigured,
  issuePairingRelayTicket,
  normalizeRegion,
  parseHermesRelayAuthQuery,
  parsePositiveInt,
  parseRelayAuthQuery,
  readBearerToken,
  resolveRelayAuthToken,
  sha256Hex,
  verifyPairingRelayTicket,
} from './protocol';

describe('shared protocol helpers', () => {
  it('parses relay auth query with optional fields', () => {
    const url = new URL('https://relay.example/ws?gatewayId=gw1&role=gateway&clientId=c1&token=t1');
    expect(parseRelayAuthQuery(url)).toEqual({
      gatewayId: 'gw1',
      role: 'gateway',
      clientId: 'c1',
      token: 't1',
    });
  });

  it('defaults role to client when invalid', () => {
    const url = new URL('https://relay.example/ws?gatewayId=gw1&role=invalid');
    expect(parseRelayAuthQuery(url).role).toBe('client');
  });

  it('parses Hermes relay auth query without changing its gateway compatibility alias', () => {
    const url = new URL('https://relay.example/ws?bridgeId=hbg_1&role=gateway&clientId=c1&token=t1');
    expect(parseHermesRelayAuthQuery(url)).toEqual({
      bridgeId: 'hbg_1',
      gatewayId: 'hbg_1',
      role: 'gateway',
      clientId: 'c1',
      token: 't1',
    });
  });

  it('keeps Hermes query defaults and trimming unchanged through the public barrel', async () => {
    const publicProtocol = await import('./index');
    const url = new URL('https://relay.example/ws?bridgeId=%20hbg_2%20&role=invalid&clientId=%20&token=%20');
    expect(publicProtocol.parseHermesRelayAuthQuery).toBe(parseHermesRelayAuthQuery);
    expect(publicProtocol.parseHermesRelayAuthQuery(url)).toEqual({
      bridgeId: 'hbg_2',
      gatewayId: 'hbg_2',
      role: 'client',
      clientId: undefined,
      token: undefined,
    });
  });

  it('reads bearer token', () => {
    const request = new Request('https://example.com', {
      headers: { authorization: 'Bearer abc-token' },
    });
    expect(readBearerToken(request)).toBe('abc-token');
  });

  it('prefers query token over bearer auth and reports the source', () => {
    const request = new Request('https://example.com', {
      headers: { authorization: 'Bearer bearer-token' },
    });
    expect(resolveRelayAuthToken('query-token', request)).toEqual({
      token: 'query-token',
      authSource: 'query',
    });
  });

  it('falls back to bearer auth when query token is absent', () => {
    const request = new Request('https://example.com', {
      headers: { authorization: 'Bearer bearer-token' },
    });
    expect(resolveRelayAuthToken(undefined, request)).toEqual({
      token: 'bearer-token',
      authSource: 'bearer',
    });
  });

  it('reports none when neither query nor bearer auth is provided', () => {
    const request = new Request('https://example.com');
    expect(resolveRelayAuthToken(undefined, request)).toEqual({
      token: null,
      authSource: 'none',
    });
  });

  it('compares secrets in constant-time-compatible form', async () => {
    await expect(constantTimeSecretEqual('same-secret', 'same-secret')).resolves.toBe(true);
    await expect(constantTimeSecretEqual('same-secret', 'other-secret')).resolves.toBe(false);
  });

  it('normalizes region to lower-case and fallback', () => {
    expect(normalizeRegion(' SG ')).toBe('sg');
    expect(normalizeRegion('')).toBe('us');
  });

  it('sha256Hex produces consistent hex digest', async () => {
    const hash = await sha256Hex('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(await sha256Hex('hello')).toBe(hash);
  });

  it('sha256Hex produces different digests for different inputs', async () => {
    const a = await sha256Hex('alpha');
    const b = await sha256Hex('beta');
    expect(a).not.toBe(b);
  });

  it('requires a sufficiently long secret and rejects tampered or expired pairing tickets', async () => {
    expect(isSecurePairingSecretConfigured('too-short')).toBe(false);
    expect(isSecurePairingSecretConfigured('x'.repeat(32))).toBe(true);
    const secret = 'test-pairing-ticket-secret-that-is-long-enough';
    const claims = {
      version: 2 as const,
      scope: 'pairing' as const,
      gatewayId: 'gw_ticket',
      sessionId: `ps_${'a'.repeat(64)}`,
      tokenId: '00000000-0000-4000-8000-000000000000',
      expiresAt: 20_000,
    };
    const token = await issuePairingRelayTicket(claims, secret);
    await expect(verifyPairingRelayTicket({
      token,
      secret,
      gatewayId: claims.gatewayId,
      nowMs: 10_000,
    })).resolves.toEqual(claims);
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    await expect(verifyPairingRelayTicket({
      token: tamperedToken,
      secret,
      gatewayId: claims.gatewayId,
      nowMs: 10_000,
    })).resolves.toBeNull();
    await expect(verifyPairingRelayTicket({
      token,
      secret,
      gatewayId: claims.gatewayId,
      nowMs: 20_000,
    })).resolves.toBeNull();
  });

  it('parsePositiveInt returns fallback for undefined', () => {
    expect(parsePositiveInt(undefined, 10)).toBe(10);
  });

  it('parsePositiveInt returns fallback for empty string', () => {
    expect(parsePositiveInt('', 10)).toBe(10);
  });

  it('parsePositiveInt returns fallback for zero', () => {
    expect(parsePositiveInt('0', 10)).toBe(10);
  });

  it('parsePositiveInt returns fallback for negative', () => {
    expect(parsePositiveInt('-5', 10)).toBe(10);
  });

  it('parsePositiveInt returns fallback for non-numeric', () => {
    expect(parsePositiveInt('abc', 10)).toBe(10);
  });

  it('parsePositiveInt parses valid positive integers', () => {
    expect(parsePositiveInt('120', 10)).toBe(120);
    expect(parsePositiveInt('1', 99)).toBe(1);
  });
});
