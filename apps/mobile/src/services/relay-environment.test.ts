import {
  OFFICIAL_HERMES_PREVIEW_REGISTRY_URL,
  OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL,
  OFFICIAL_PREVIEW_REGISTRY_URL,
  OFFICIAL_PRODUCTION_REGISTRY_URL,
  assessRelayEnvironmentSelection,
  getOfficialHermesRegistryUrl,
  getOfficialRelayRegistryUrl,
  getRelayPairCommand,
  resolveOfficialRelayEnvironment,
} from './relay-environment';

describe('relay environment selection', () => {
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
