import {
  getGatewayBackendCapabilities,
  getGatewayBackendDescriptor,
  getGatewayModeLabel,
  isGatewayBackendKind,
  isGatewayTransportKind,
  resolveGatewayBackendKind,
  resolveGatewayTransportKind,
  resolveGlobalMainSessionKey,
  selectByBackend,
  toLegacyGatewayMode,
} from './gateway-backends';

describe('gateway-backends', () => {
  describe('resolveGatewayBackendKind', () => {
    it('returns openclaw for null/undefined config so legacy reads never break', () => {
      expect(resolveGatewayBackendKind(null)).toBe('openclaw');
      expect(resolveGatewayBackendKind(undefined)).toBe('openclaw');
      expect(resolveGatewayBackendKind({} as any)).toBe('openclaw');
    });

    it('honors explicit backendKind field when set', () => {
      expect(resolveGatewayBackendKind({ backendKind: 'hermes' } as any)).toBe('hermes');
      expect(resolveGatewayBackendKind({ backendKind: 'openclaw' } as any)).toBe('openclaw');
    });

    it('falls back to legacy mode === hermes for pre-migration configs', () => {
      expect(resolveGatewayBackendKind({ mode: 'hermes' } as any)).toBe('hermes');
    });

    it('falls back to presence of hermes config block', () => {
      expect(resolveGatewayBackendKind({ hermes: { bridgeUrl: 'ws://host:4319' } } as any)).toBe('hermes');
    });

    it('defaults to openclaw when mode is a legacy transport', () => {
      expect(resolveGatewayBackendKind({ mode: 'relay' } as any)).toBe('openclaw');
      expect(resolveGatewayBackendKind({ mode: 'local' } as any)).toBe('openclaw');
      expect(resolveGatewayBackendKind({ mode: 'custom' } as any)).toBe('openclaw');
    });
  });

  describe('resolveGatewayTransportKind', () => {
    it('returns custom for null/undefined so legacy reads remain stable', () => {
      expect(resolveGatewayTransportKind(null)).toBe('custom');
      expect(resolveGatewayTransportKind(undefined)).toBe('custom');
      expect(resolveGatewayTransportKind({} as any)).toBe('custom');
    });

    it('honors explicit transportKind field when set', () => {
      expect(resolveGatewayTransportKind({ transportKind: 'relay' } as any)).toBe('relay');
      expect(resolveGatewayTransportKind({ transportKind: 'local' } as any)).toBe('local');
    });

    it('accepts a legacy mode when it is a valid transport kind', () => {
      expect(resolveGatewayTransportKind({ mode: 'relay' } as any)).toBe('relay');
      expect(resolveGatewayTransportKind({ mode: 'tailscale' } as any)).toBe('tailscale');
    });

    it('infers relay transport when a relay config block is present without an explicit field', () => {
      expect(resolveGatewayTransportKind({ relay: { serverUrl: 'wss://relay.example.com' } } as any)).toBe('relay');
    });
  });

  describe('selectByBackend', () => {
    it('returns the openclaw branch for openclaw config', () => {
      expect(selectByBackend({ backendKind: 'openclaw' } as any, { openclaw: 'A', hermes: 'B' })).toBe('A');
    });

    it('returns the hermes branch for hermes config', () => {
      expect(selectByBackend({ backendKind: 'hermes' } as any, { openclaw: 'A', hermes: 'B' })).toBe('B');
    });

    it('accepts a bare backend kind string', () => {
      expect(selectByBackend('openclaw', { openclaw: 1, hermes: 2 })).toBe(1);
      expect(selectByBackend('hermes', { openclaw: 1, hermes: 2 })).toBe(2);
    });

    it('defaults to the openclaw branch for null/undefined so OpenClaw rendering is preserved', () => {
      expect(selectByBackend(null, { openclaw: 'legacy', hermes: 'new' })).toBe('legacy');
      expect(selectByBackend(undefined, { openclaw: 'legacy', hermes: 'new' })).toBe('legacy');
    });

    it('treats unknown string inputs as openclaw', () => {
      expect(selectByBackend('totally-unknown' as any, { openclaw: 'A', hermes: 'B' })).toBe('A');
    });
  });

  describe('resolveGlobalMainSessionKey', () => {
    it('returns null for openclaw so per-agent main sessions are preserved', () => {
      expect(resolveGlobalMainSessionKey('openclaw')).toBeNull();
      expect(resolveGlobalMainSessionKey(null)).toBeNull();
      expect(resolveGlobalMainSessionKey({ backendKind: 'openclaw' } as any)).toBeNull();
    });

    it('returns "main" for hermes so bootstrap converges on a single global session', () => {
      expect(resolveGlobalMainSessionKey('hermes')).toBe('main');
      expect(resolveGlobalMainSessionKey({ backendKind: 'hermes' } as any)).toBe('main');
    });
  });

  describe('getGatewayModeLabel', () => {
    it('keeps explicit transport labels for OpenClaw configs', () => {
      expect(getGatewayModeLabel({ backendKind: 'openclaw', transportKind: 'relay' } as any)).toBe('Remote');
      expect(getGatewayModeLabel({ backendKind: 'openclaw', transportKind: 'local' } as any)).toBe('Local');
      expect(getGatewayModeLabel({ backendKind: 'openclaw', transportKind: 'tailscale' } as any)).toBe('Tailscale');
      expect(getGatewayModeLabel({ backendKind: 'openclaw', transportKind: 'cloudflare' } as any)).toBe('Cloudflare');
      expect(getGatewayModeLabel({ backendKind: 'openclaw', transportKind: 'custom' } as any)).toBe('Custom');
    });

    it('keeps the backend label for Hermes irrespective of transport', () => {
      expect(getGatewayModeLabel({ backendKind: 'hermes', transportKind: 'relay' } as any)).toBe('Hermes');
      expect(getGatewayModeLabel({ backendKind: 'hermes', transportKind: 'local' } as any)).toBe('Hermes');
    });
  });

  describe('getGatewayBackendCapabilities', () => {
    it('gives OpenClaw every console capability (non-regression guard)', () => {
      const caps = getGatewayBackendCapabilities('openclaw');
      expect(caps.consoleCron).toBe(true);
      expect(caps.consoleCronCreate).toBe(true);
      expect(caps.consoleChannels).toBe(true);
      expect(caps.consoleNodes).toBe(true);
      expect(caps.consoleTools).toBe(true);
      expect(caps.consoleAgentDetail).toBe(true);
      expect(caps.consoleAgentSessionsBoard).toBe(true);
      expect(caps.consoleHeartbeat).toBe(true);
      expect(caps.consoleDiscover).toBe(true);
      expect(caps.consoleClawHub).toBe(true);
      expect(caps.modelSelection).toBe(true);
      expect(caps.configRead).toBe(true);
      expect(caps.configWrite).toBe(true);
      expect(caps.openClawConfigScreens).toBe(true);
    });

    it('disables console-cron-create for Hermes phase 1 while leaving consoleCron enabled for viewing', () => {
      const caps = getGatewayBackendCapabilities('hermes');
      expect(caps.consoleCron).toBe(true);
      expect(caps.consoleCronCreate).toBe(false);
    });

    it('disables OpenClaw-only capabilities for Hermes', () => {
      const caps = getGatewayBackendCapabilities('hermes');
      expect(caps.consoleDiscover).toBe(false);
      expect(caps.consoleClawHub).toBe(false);
      expect(caps.consoleChannels).toBe(false);
      expect(caps.consoleNodes).toBe(false);
      expect(caps.consoleTools).toBe(false);
      expect(caps.consoleHeartbeat).toBe(false);
      expect(caps.consoleAgentDetail).toBe(false);
      expect(caps.consoleAgentSessionsBoard).toBe(false);
      expect(caps.configRead).toBe(false);
      expect(caps.configWrite).toBe(false);
      expect(caps.openClawConfigScreens).toBe(false);
    });
  });

  describe('getGatewayBackendDescriptor', () => {
    it('returns the OpenClaw descriptor for null/undefined', () => {
      expect(getGatewayBackendDescriptor(null).kind).toBe('openclaw');
      expect(getGatewayBackendDescriptor(undefined).kind).toBe('openclaw');
    });

    it('returns the matching descriptor for a string kind', () => {
      expect(getGatewayBackendDescriptor('hermes').kind).toBe('hermes');
      expect(getGatewayBackendDescriptor('openclaw').kind).toBe('openclaw');
    });
  });

  describe('type guards', () => {
    it('isGatewayBackendKind accepts only the two known backends', () => {
      expect(isGatewayBackendKind('openclaw')).toBe(true);
      expect(isGatewayBackendKind('hermes')).toBe(true);
      expect(isGatewayBackendKind('other')).toBe(false);
      expect(isGatewayBackendKind(undefined)).toBe(false);
    });

    it('isGatewayTransportKind accepts each legal transport', () => {
      expect(isGatewayTransportKind('relay')).toBe(true);
      expect(isGatewayTransportKind('local')).toBe(true);
      expect(isGatewayTransportKind('tailscale')).toBe(true);
      expect(isGatewayTransportKind('cloudflare')).toBe(true);
      expect(isGatewayTransportKind('custom')).toBe(true);
      expect(isGatewayTransportKind('hermes')).toBe(false);
      expect(isGatewayTransportKind('unknown')).toBe(false);
    });
  });

  describe('toLegacyGatewayMode', () => {
    it('maps Hermes to the legacy "hermes" mode irrespective of transport', () => {
      expect(toLegacyGatewayMode({ backendKind: 'hermes', transportKind: 'local' })).toBe('hermes');
      expect(toLegacyGatewayMode({ backendKind: 'hermes', transportKind: 'relay' })).toBe('hermes');
    });

    it('passes through OpenClaw transport as the legacy mode', () => {
      expect(toLegacyGatewayMode({ backendKind: 'openclaw', transportKind: 'relay' })).toBe('relay');
      expect(toLegacyGatewayMode({ backendKind: 'openclaw', transportKind: 'local' })).toBe('local');
    });

    it('defaults to "custom" when no transport is provided for OpenClaw', () => {
      expect(toLegacyGatewayMode({ backendKind: 'openclaw' })).toBe('custom');
    });
  });
});
