import { describe, expect, it } from 'vitest';
import { canonicalizeOfficialRelayUrl, migrateOfficialRelayConfig, OFFICIAL_RELAY_SERVICES, officialRelayEndpoints, resolveOfficialRelayService, sameRelayRegistry } from './official-relay.js';

describe('official service domain migration', () => {
  for (const service of OFFICIAL_RELAY_SERVICES) {
    it(`preserves ${service.backend}/${service.environment} identity on both domains`, () => {
      const endpoints = officialRelayEndpoints(service.backend, service.environment);
      for (const role of ['registry', 'relay'] as const) {
        const protocol = role === 'registry' ? 'https' : 'wss';
        const path = role === 'registry' ? '' : '/ws';
        const legacy = `${protocol}://${service.worker}-${role}${'suffix' in service ? service.suffix : ''}.clawket.workers.dev${path}`;
        const canonical = role === 'registry' ? endpoints.registryUrl : endpoints.relayUrl;
        expect(canonicalizeOfficialRelayUrl(legacy, service.backend, service.environment)).toBe(canonical);
        expect(resolveOfficialRelayService(legacy)).toMatchObject({ backend: service.backend, environment: service.environment, role });
        expect(resolveOfficialRelayService(canonical)).toMatchObject({ backend: service.backend, environment: service.environment, role });
      }
    });
  }

  it('retains paths, queries and link decryption fragments', () => {
    expect(canonicalizeOfficialRelayUrl('https://clawket-codex-registry.clawket.workers.dev/pair/example?x=1#k=private'))
      .toBe('https://codex-registry.clawket.ai/pair/example?x=1#k=private');
    expect(canonicalizeOfficialRelayUrl('wss://clawket-codex-relay.clawket.workers.dev/ws?gatewayId=g&token=t'))
      .toBe('wss://codex-relay.clawket.ai/ws?gatewayId=g&token=t');
  });

  it.each([
    'bad URL', 'https://other.workers.dev', 'https://codex-registry.example.com',
    'https://clawket-codex-registry.clawket.workers.dev.example.com',
    'https://user:password@clawket-codex-registry.clawket.workers.dev',
    'https://clawket-codex-registry.clawket.workers.dev:8443',
    'http://clawket-codex-registry.clawket.workers.dev',
    'https://clawket-codex-relay.clawket.workers.dev',
  ])('leaves unverified/custom endpoint unchanged: %s', value => {
    expect(resolveOfficialRelayService(value)).toBeNull();
    expect(canonicalizeOfficialRelayUrl(value)).toBe(value);
  });

  it('never crosses backend or environment, and keeps local-model independent', () => {
    const value = 'https://clawket-codex-registry-preview.clawket.workers.dev';
    expect(canonicalizeOfficialRelayUrl(value, 'hermes')).toBe(value);
    expect(canonicalizeOfficialRelayUrl(value, 'codex', 'production')).toBe(value);
    expect(officialRelayEndpoints('local-model', 'production')).toEqual(officialRelayEndpoints('local-model', 'preview'));
    expect(canonicalizeOfficialRelayUrl('https://clawket-local-model-registry-preview.clawket.workers.dev', 'local-model', 'production'))
      .toBe('https://local-model-registry.clawket.ai');
    expect(() => officialRelayEndpoints('invalid' as 'codex')).toThrow();
  });

  it('aliases the same Registry without accepting different scopes or custom paths', () => {
    expect(sameRelayRegistry('https://clawket-codex-registry.clawket.workers.dev/', 'https://codex-registry.clawket.ai')).toBe(true);
    expect(sameRelayRegistry(undefined, 'https://codex-registry.clawket.ai')).toBe(false);
    expect(sameRelayRegistry('https://codex-registry-preview.clawket.ai', 'https://codex-registry.clawket.ai')).toBe(false);
    expect(sameRelayRegistry('https://custom.example/one', 'https://custom.example/two')).toBe(false);
  });

  it('migrates addresses without mutating credentials or existing invitations', () => {
    const config = { registryUrl: 'https://clawket-codex-registry.clawket.workers.dev', relayUrl: 'wss://clawket-codex-relay.clawket.workers.dev/ws', gatewayId: 'original', relaySecret: 'secret', invitation: { qrPayload: 'original ciphertext source' } };
    const next = migrateOfficialRelayConfig(config, 'codex');
    expect(next).toEqual({ ...config, ...officialRelayEndpoints('codex') });
    expect(next.invitation).toBe(config.invitation);
    expect(config.registryUrl).toContain('workers.dev');
    expect(migrateOfficialRelayConfig({}, 'codex')).toEqual({});
  });
});
