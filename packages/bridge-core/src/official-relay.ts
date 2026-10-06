/** Public service identities only. Keep this module free of Node/platform imports:
 * Mobile and Workers consume its source; the CLI consumes the compiled export. */
export type OfficialRelayBackend = 'openclaw' | 'hermes' | 'codex' | 'claude-code' | 'pi' | 'local-model';
export type OfficialRelayEnvironment = 'production' | 'preview';

export const OFFICIAL_RELAY_SERVICES = Object.freeze([
  { backend: 'openclaw', environment: 'production', registry: 'registry', relay: 'relay', worker: 'clawket' },
  { backend: 'openclaw', environment: 'preview', registry: 'registry-preview', relay: 'relay-preview', worker: 'clawket', suffix: '-preview' },
  { backend: 'hermes', environment: 'production', registry: 'hermes-registry', relay: 'hermes-relay', worker: 'clawket-hermes' },
  { backend: 'hermes', environment: 'preview', registry: 'hermes-registry-preview', relay: 'hermes-relay-preview', worker: 'clawket-hermes', suffix: '-preview' },
  { backend: 'codex', environment: 'production', registry: 'codex-registry', relay: 'codex-relay', worker: 'clawket-codex' },
  { backend: 'codex', environment: 'preview', registry: 'codex-registry-preview', relay: 'codex-relay-preview', worker: 'clawket-codex', suffix: '-preview' },
  { backend: 'claude-code', environment: 'production', registry: 'claude-code-registry', relay: 'claude-code-relay', worker: 'clawket-claude-code' },
  { backend: 'claude-code', environment: 'preview', registry: 'claude-code-registry-preview', relay: 'claude-code-relay-preview', worker: 'clawket-claude-code', suffix: '-preview' },
  { backend: 'pi', environment: 'production', registry: 'pi-registry', relay: 'pi-relay', worker: 'clawket-pi' },
  { backend: 'pi', environment: 'preview', registry: 'pi-registry-preview', relay: 'pi-relay-preview', worker: 'clawket-pi', suffix: '-preview' },
  // One isolated service, offered in every App environment; no Production twin.
  { backend: 'local-model', environment: 'preview', registry: 'local-model-registry', relay: 'local-model-relay', worker: 'clawket-local-model', suffix: '-preview' },
] as const);

export function officialRelayEndpoints(backend: OfficialRelayBackend, environment: OfficialRelayEnvironment = 'production') {
  const service = OFFICIAL_RELAY_SERVICES.find(item => item.backend === backend
    && (backend === 'local-model' || item.environment === environment));
  if (!service) throw new Error('Unknown official Relay service');
  return { registryUrl: `https://${service.registry}.clawket.ai`, relayUrl: `wss://${service.relay}.clawket.ai/ws` };
}

export function resolveOfficialRelayService(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.port) return null;
  for (const service of OFFICIAL_RELAY_SERVICES) {
    for (const role of ['registry', 'relay'] as const) {
      if (url.protocol !== (role === 'registry' ? 'https:' : 'wss:')) continue;
      const hostname = `${service[role]}.clawket.ai`;
      const legacyHostname = `${service.worker}-${role}${'suffix' in service ? service.suffix : ''}.clawket.workers.dev`;
      if (url.hostname === hostname || url.hostname === legacyHostname) return { ...service, role, hostname, legacyHostname };
    }
  }
  return null;
}

/** Only exact official aliases migrate. Preserve custom URLs, ports, credentials,
 * paths, query strings and fragments, and never cross a backend/environment. */
export function canonicalizeOfficialRelayUrl(value: string, backend?: string, environment?: string): string {
  const service = resolveOfficialRelayService(value);
  if (!service || (backend && service.backend !== backend)
    || (environment && service.backend !== 'local-model' && service.environment !== environment)) return value;
  const url = new URL(value);
  if (url.hostname !== service.legacyHostname) return value;
  url.hostname = service.hostname;
  return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href;
}

export function sameRelayRegistry(left: string | undefined, right: string): boolean {
  return Boolean(left) && canonicalizeOfficialRelayUrl(left!).replace(/\/+$/, '')
    === canonicalizeOfficialRelayUrl(right).replace(/\/+$/, '');
}

export function migrateOfficialRelayConfig<T extends { serverUrl?: string; registryUrl?: string; relayUrl?: string }>(
  config: T, backend: string, environment?: string,
): T {
  const next = { ...config };
  for (const field of ['serverUrl', 'registryUrl', 'relayUrl'] as const) {
    const value = config[field];
    if (typeof value === 'string') next[field] = canonicalizeOfficialRelayUrl(value, backend, environment);
  }
  return next;
}
