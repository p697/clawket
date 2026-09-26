import {
  OFFICIAL_HERMES_PREVIEW_REGISTRY_URL,
  OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL,
  OFFICIAL_LOCAL_MODEL_PREVIEW_REGISTRY_URL,
  OFFICIAL_PREVIEW_REGISTRY_URL,
  OFFICIAL_PRODUCTION_REGISTRY_URL,
  assessRelayEnvironmentSelection,
  getOfficialHermesRegistryUrl,
  getOfficialRelayRegistryUrl,
  getRelayPairCommand,
  isEnvironmentIndependentRegistry,
  resolveOfficialRelayEnvironment,
} from './relay-environment';

describe('relay environment selection', () => {
  it('isolates the official Pi Preview registry from normal production pairing', () => {
    const serverUrl = 'https://clawket-pi-registry-preview.clawket.workers.dev';
    expect(resolveOfficialRelayEnvironment(serverUrl)).toBe('preview');
    expect(isEnvironmentIndependentRegistry(serverUrl)).toBe(false);
    expect(assessRelayEnvironmentSelection({ serverUrl, selectedEnvironment: 'production', debugMode: false })).toBe('preview_requires_debug_mode');
    expect(assessRelayEnvironmentSelection({ serverUrl, selectedEnvironment: 'production', debugMode: true })).toBe('official_environment_mismatch');
    expect(assessRelayEnvironmentSelection({ serverUrl, selectedEnvironment: 'preview', debugMode: true })).toBeNull();
  });
  it('recognizes official production and Preview registry URLs', () => {
    expect(resolveOfficialRelayEnvironment(OFFICIAL_PRODUCTION_REGISTRY_URL)).toBe('production');
    expect(resolveOfficialRelayEnvironment(`${OFFICIAL_PREVIEW_REGISTRY_URL}/v1/pair/claim`)).toBe('preview');
    expect(resolveOfficialRelayEnvironment(OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL)).toBe('production');
    expect(resolveOfficialRelayEnvironment(`${OFFICIAL_HERMES_PREVIEW_REGISTRY_URL}/v1/hermes/pair/claim`)).toBe('preview');
    expect(resolveOfficialRelayEnvironment('https://self-hosted.example.com')).toBeNull();
  });

  it('requires Debug Mode for the official Preview environment', () => {
    expect(assessRelayEnvironmentSelection({
      serverUrl: OFFICIAL_PREVIEW_REGISTRY_URL,
      selectedEnvironment: 'preview',
      debugMode: false,
    })).toBe('preview_requires_debug_mode');
  });

  it('accepts the dedicated local-model Registry from any environment without Debug Mode', () => {
    // Still an official pairing server (pairing-session trusts it), but never a Preview gate.
    expect(resolveOfficialRelayEnvironment(`${OFFICIAL_LOCAL_MODEL_PREVIEW_REGISTRY_URL}/v1/pair/claim`)).toBe('preview');
    expect(isEnvironmentIndependentRegistry(`${OFFICIAL_LOCAL_MODEL_PREVIEW_REGISTRY_URL}/v1/pair/claim`)).toBe(true);
    expect(isEnvironmentIndependentRegistry(OFFICIAL_PREVIEW_REGISTRY_URL)).toBe(false);
    expect(isEnvironmentIndependentRegistry(OFFICIAL_HERMES_PREVIEW_REGISTRY_URL)).toBe(false);
    expect(isEnvironmentIndependentRegistry('https://self-hosted.example.com')).toBe(false);
    for (const selectedEnvironment of ['production', 'preview'] as const) {
      for (const debugMode of [false, true]) {
        expect(assessRelayEnvironmentSelection({
          serverUrl: OFFICIAL_LOCAL_MODEL_PREVIEW_REGISTRY_URL,
          selectedEnvironment,
          debugMode,
        })).toBeNull();
      }
    }
  });

  it('rejects official QR codes from a different selected environment', () => {
    expect(assessRelayEnvironmentSelection({
      serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
      selectedEnvironment: 'preview',
      debugMode: true,
    })).toBe('official_environment_mismatch');
  });

  it('allows self-hosted registry URLs and builds the Preview CLI command', () => {
    expect(assessRelayEnvironmentSelection({
      serverUrl: 'https://self-hosted.example.com',
      selectedEnvironment: 'preview',
      debugMode: true,
    })).toBeNull();
    expect(getRelayPairCommand('preview')).toBe('clawket pair --preview');
    expect(getOfficialRelayRegistryUrl('preview')).toBe(OFFICIAL_PREVIEW_REGISTRY_URL);
    expect(getOfficialRelayRegistryUrl('production')).toBe(OFFICIAL_PRODUCTION_REGISTRY_URL);
    expect(getOfficialHermesRegistryUrl('preview')).toBe(OFFICIAL_HERMES_PREVIEW_REGISTRY_URL);
    expect(getOfficialHermesRegistryUrl('production')).toBe(OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL);
  });
});
