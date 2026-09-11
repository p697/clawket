import type { RelayServiceEnvironment } from '../types';

export const OFFICIAL_PRODUCTION_REGISTRY_URL = 'https://registry.clawket.ai';
export const OFFICIAL_PREVIEW_REGISTRY_URL = 'https://clawket-registry-preview.clawket.workers.dev';
export const OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL = 'https://hermes-registry.clawket.ai';
export const OFFICIAL_HERMES_PREVIEW_REGISTRY_URL = 'https://clawket-hermes-registry-preview.clawket.workers.dev';

export type RelayEnvironmentSelectionIssue =
  | 'preview_requires_debug_mode'
  | 'official_environment_mismatch';

export function resolveOfficialRelayEnvironment(serverUrl?: string): RelayServiceEnvironment | null {
  const origin = normalizeOrigin(serverUrl);
  if (!origin) return null;
  if (OFFICIAL_PREVIEW_REGISTRY_ORIGINS.has(origin)) return 'preview';
  if (OFFICIAL_PRODUCTION_REGISTRY_ORIGINS.has(origin)) return 'production';
  return null;
}

export function assessRelayEnvironmentSelection(input: {
  serverUrl?: string;
  selectedEnvironment: RelayServiceEnvironment;
  debugMode: boolean;
}): RelayEnvironmentSelectionIssue | null {
  const qrEnvironment = resolveOfficialRelayEnvironment(input.serverUrl);
  if (qrEnvironment === 'preview' && !input.debugMode) {
    return 'preview_requires_debug_mode';
  }
  const effectiveEnvironment = input.debugMode ? input.selectedEnvironment : 'production';
  if (qrEnvironment && qrEnvironment !== effectiveEnvironment) {
    return 'official_environment_mismatch';
  }
  return null;
}

export function getRelayPairCommand(environment: RelayServiceEnvironment): string {
  return environment === 'preview' ? 'clawket pair --preview' : 'clawket pair';
}

export function getOfficialRelayRegistryUrl(environment: RelayServiceEnvironment): string {
  return environment === 'preview' ? OFFICIAL_PREVIEW_REGISTRY_URL : OFFICIAL_PRODUCTION_REGISTRY_URL;
}

export function getOfficialHermesRegistryUrl(environment: RelayServiceEnvironment): string {
  return environment === 'preview'
    ? OFFICIAL_HERMES_PREVIEW_REGISTRY_URL
    : OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL;
}

const OFFICIAL_PREVIEW_REGISTRY_ORIGINS = new Set([
  normalizeOrigin(OFFICIAL_PREVIEW_REGISTRY_URL),
  normalizeOrigin(OFFICIAL_HERMES_PREVIEW_REGISTRY_URL),
]);

const OFFICIAL_PRODUCTION_REGISTRY_ORIGINS = new Set([
  normalizeOrigin(OFFICIAL_PRODUCTION_REGISTRY_URL),
  normalizeOrigin(OFFICIAL_HERMES_PRODUCTION_REGISTRY_URL),
]);

function normalizeOrigin(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
}
