import { describe, expect, it } from 'vitest';
import {
  buildGatewayDefaultName,
  getGatewayBackendCapabilities,
  getGatewayBackendDescriptor,
  getGatewayModeLabel,
  getGatewayThinkingLevels,
  isGatewayBackendKind,
  isGatewayTransportKind,
  resolveGatewayBackendKind,
  resolveGatewayTransportKind,
  resolveGlobalMainSessionKey,
  selectByBackend,
  toGatewayConfigIdentity,
  toLegacyGatewayMode,
} from './legacy-gateway';

describe('temporary legacy gateway facade', () => {
  it('keeps the exact legacy backend and transport guards', () => {
    for (const value of ['openclaw', 'hermes', 'youmind']) expect(isGatewayBackendKind(value)).toBe(true);
    for (const value of ['local', 'tailscale', 'cloudflare', 'custom', 'relay']) {
      expect(isGatewayTransportKind(value)).toBe(true);
    }
    expect(isGatewayBackendKind('other')).toBe(false);
    expect(isGatewayTransportKind('https')).toBe(false);
  });

  it('resolves explicit, transitional, and fallback identities', () => {
    expect(resolveGatewayBackendKind({ backendKind: 'youmind' })).toBe('youmind');
    expect(resolveGatewayBackendKind({ mode: 'hermes' })).toBe('hermes');
    expect(resolveGatewayBackendKind({ hermes: { bridgeUrl: 'ws://bridge' } })).toBe('hermes');
    expect(resolveGatewayBackendKind(undefined)).toBe('openclaw');

    expect(resolveGatewayTransportKind({ transportKind: 'tailscale' })).toBe('tailscale');
    expect(resolveGatewayTransportKind({ mode: 'local' })).toBe('local');
    expect(resolveGatewayTransportKind({ relay: { serverUrl: 'https://relay', gatewayId: 'g' } })).toBe('relay');
    expect(resolveGatewayTransportKind(null)).toBe('custom');
    expect(toGatewayConfigIdentity({ backendKind: 'hermes', transportKind: 'relay' })).toEqual({
      backendKind: 'hermes',
      transportKind: 'relay',
    });
  });

  it('preserves legacy mode conversion and descriptor matrices', () => {
    expect(toLegacyGatewayMode({ backendKind: 'hermes', transportKind: 'relay' })).toBe('hermes');
    expect(toLegacyGatewayMode({ transportKind: 'local' })).toBe('local');
    expect(toLegacyGatewayMode({})).toBe('custom');

    expect(getGatewayBackendDescriptor('openclaw')).toMatchObject({ kind: 'openclaw', label: 'OpenClaw' });
    expect(getGatewayBackendDescriptor({ backendKind: 'hermes' })).toMatchObject({ kind: 'hermes', label: 'Hermes' });
    expect(getGatewayBackendDescriptor('youmind')).toMatchObject({ kind: 'youmind', label: 'YouMind' });
    expect(getGatewayBackendCapabilities('hermes')).toMatchObject({
      chatAbort: false,
      chatAttachments: false,
      consoleCronCreate: false,
      consoleAgentSessionsBoard: false,
    });
    expect(getGatewayBackendCapabilities('youmind').gatewayConnection).toBe(false);
    expect(Object.values(getGatewayBackendCapabilities('openclaw')).every(Boolean)).toBe(true);
  });

  it('preserves backend dispatch, thinking choices, and global session keys', () => {
    const choices = { openclaw: 'o', hermes: 'h', youmind: 'y' };
    expect(selectByBackend('openclaw', choices)).toBe('o');
    expect(selectByBackend('hermes', choices)).toBe('h');
    expect(selectByBackend('youmind', choices)).toBe('y');
    expect(selectByBackend('youmind', { openclaw: 'o', hermes: 'h' })).toBe('o');
    expect(selectByBackend({ mode: 'hermes' }, choices)).toBe('h');

    expect(getGatewayThinkingLevels('openclaw')).toContain('adaptive');
    expect(getGatewayThinkingLevels('hermes')).not.toContain('adaptive');
    expect(getGatewayThinkingLevels('youmind')).toContain('adaptive');
    expect(resolveGlobalMainSessionKey('openclaw')).toBeNull();
    expect(resolveGlobalMainSessionKey('hermes')).toBe('main');
    expect(resolveGlobalMainSessionKey('youmind')).toBe('main');
  });

  it('keeps every legacy mode label', () => {
    expect(getGatewayModeLabel({ backendKind: 'hermes' })).toBe('Hermes');
    expect(getGatewayModeLabel({ backendKind: 'youmind' })).toBe('YouMind');
    expect(getGatewayModeLabel({ transportKind: 'relay' })).toBe('Remote');
    expect(getGatewayModeLabel({ transportKind: 'local' })).toBe('Local');
    expect(getGatewayModeLabel({ transportKind: 'tailscale' })).toBe('Tailscale');
    expect(getGatewayModeLabel({ transportKind: 'cloudflare' })).toBe('Cloudflare');
    expect(getGatewayModeLabel({ transportKind: 'custom' })).toBe('Custom');
  });

  it('builds backend-aware default names with and without a parseable host', () => {
    expect(buildGatewayDefaultName({ backendKind: 'hermes', url: 'ws://bridge.test/ws', index: 1 })).toBe(
      'Hermes (bridge.test)',
    );
    expect(buildGatewayDefaultName({ backendKind: 'youmind', url: 'https://youmind.test', index: 1 })).toBe(
      'YouMind (youmind.test)',
    );
    expect(buildGatewayDefaultName({ transportKind: 'relay', url: 'wss://relay.test/v1', index: 2 })).toBe(
      'Relay (relay.test)',
    );
    expect(buildGatewayDefaultName({ transportKind: 'local', url: 'not a url', index: 3 })).toBe(
      'Custom Gateway 3',
    );
    expect(buildGatewayDefaultName({ url: '', index: 4 })).toBe('Custom Gateway 4');
  });
});
