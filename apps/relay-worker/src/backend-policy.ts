import {
  CLIENT_PONG_TIMEOUT_DEFAULT_MS,
  GATEWAY_PING_TIMEOUT_DEFAULT_MS,
  HERMES_CLIENT_PONG_TIMEOUT_DEFAULT_MS,
  type BackendPolicy,
  type Env,
} from './relay/types';

export const PRINCIPAL_EXISTENCE_CACHE_TTL_MS = 60_000;
export const PRINCIPAL_EXISTENCE_CACHE_MAX_ENTRIES = 10_000;

type PrincipalExistenceCacheEntry = {
  expiresAt: number;
};

/**
 * Isolate-local bounded cache for positive pair-record existence checks. It
 * intentionally stores no request or binding objects; misses are retried so a
 * newly registered principal is not hidden by KV propagation delay.
 */
export class PrincipalExistenceCache {
  private readonly entries = new Map<string, PrincipalExistenceCacheEntry>();

  constructor(
    private readonly ttlMs = PRINCIPAL_EXISTENCE_CACHE_TTL_MS,
    private readonly maxEntries = PRINCIPAL_EXISTENCE_CACHE_MAX_ENTRIES,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be a positive integer');
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('maxEntries must be a positive integer');
    }
  }

  has(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string, now: number): void {
    // Reinsert updates eviction order without extending other entries' TTLs.
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { expiresAt: now + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const principalExistenceCache = new PrincipalExistenceCache();

export const OPENCLAW_BACKEND_POLICY: BackendPolicy = {
  backend: 'openclaw',
  principalParam: 'gatewayId',
  principalIdPrefix: 'gw_',
  principalRecordField: 'gatewayId',
  pendingOwnerField: 'gatewayClientId',
  kvKeys: { pair: 'pair-gateway:' },
  registryVerifyPath: '/v1/verify/',
  doBinding: 'ROOM',
  kvBinding: 'ROUTES_KV',
  internalRoutes: {
    clientTokens: '/v1/internal/pairing/client-tokens',
    bridgeStatus: null,
  },
  telemetryScope: 'relay_worker',
  ownerRole: 'gateway',
  ownerLeaseMs: 20_000,
  heartbeatIntervalMs: 30_000,
  clientPongTimeoutMs: CLIENT_PONG_TIMEOUT_DEFAULT_MS,
  gatewayPingTimeoutMs: null,
  watchdog: 'none',
  ownerPresentField: 'hasGateway',
  ownerReplacedField: 'gatewayReplaced',
  ownerLockedEvent: 'gateway_owner_locked',
  ownerLockedMessage: 'Gateway owner is locked by another active gateway runtime',
  ownerReplacedReason: 'replaced_by_new_gateway',
  ownerUnavailableReason: 'gateway_unavailable',
  ownerMessageDroppedEvent: 'gateway_message_dropped_without_active_client',
  ownerControlInvalidEvent: 'gateway_control_invalid',
  connectStartMissingEvent: 'connect_start_no_gateway',
  securePairing: true,
  routeRequestsByOrigin: false,
  rejectRequestWithoutOwner: false,
  reconnectClientsOnOwnerRequest: true,
  traceHints: false,
};

export const HERMES_BACKEND_POLICY: BackendPolicy = {
  backend: 'hermes',
  principalParam: 'bridgeId',
  principalIdPrefix: 'hbg_',
  principalRecordField: 'bridgeId',
  pendingOwnerField: 'bridgeClientId',
  kvKeys: { pair: 'hermes-pair-bridge:' },
  registryVerifyPath: '/v1/hermes/verify/',
  doBinding: 'HERMES_ROOM',
  kvBinding: 'HERMES_ROUTES_KV',
  internalRoutes: {
    clientTokens: '/v1/internal/hermes/pairing/client-tokens',
    bridgeStatus: '/v1/internal/hermes/bridge-status',
  },
  telemetryScope: 'hermes_relay_worker',
  ownerRole: 'bridge',
  ownerLeaseMs: 20_000,
  heartbeatIntervalMs: 30_000,
  clientPongTimeoutMs: HERMES_CLIENT_PONG_TIMEOUT_DEFAULT_MS,
  gatewayPingTimeoutMs: GATEWAY_PING_TIMEOUT_DEFAULT_MS,
  watchdog: 'hermes-bridge-probe',
  ownerPresentField: 'hasBridge',
  ownerReplacedField: 'bridgeReplaced',
  ownerLockedEvent: 'bridge_owner_locked',
  ownerLockedMessage: 'Bridge owner is locked by another active bridge runtime',
  ownerReplacedReason: 'replaced_by_new_bridge',
  ownerUnavailableReason: 'bridge_unavailable',
  ownerMessageDroppedEvent: 'bridge_message_dropped_without_active_client',
  ownerControlInvalidEvent: 'bridge_control_invalid',
  connectStartMissingEvent: 'connect_start_no_bridge',
  securePairing: false,
  routeRequestsByOrigin: true,
  rejectRequestWithoutOwner: true,
  reconnectClientsOnOwnerRequest: false,
  traceHints: true,
};

export function policyForBackend(backend: string | undefined): BackendPolicy {
  if (backend === undefined) return OPENCLAW_BACKEND_POLICY;
  if (backend === 'openclaw') return OPENCLAW_BACKEND_POLICY;
  if (backend === 'hermes') return HERMES_BACKEND_POLICY;
  throw new Error(`Unsupported RELAY_BACKEND: ${backend}`);
}

export function roomNamespace(env: Env, policy: BackendPolicy): DurableObjectNamespace {
  const namespace = env[policy.doBinding];
  if (!namespace) throw new Error(`Missing ${policy.doBinding} Durable Object binding`);
  return namespace;
}

export function routesKv(env: Env, policy: BackendPolicy): KVNamespace {
  const binding = env[policy.kvBinding];
  if (!binding) throw new Error(`Missing ${policy.kvBinding} KV binding`);
  return binding;
}

export async function pairedPrincipalExists(
  env: Env,
  policy: BackendPolicy,
  principalId: string,
  now = Date.now(),
): Promise<boolean> {
  const pairKey = `${policy.kvKeys.pair}${principalId}`;
  const cacheKey = `${policy.backend}:${pairKey}`;
  if (principalExistenceCache.has(cacheKey, now)) return true;

  const exists = await routesKv(env, policy).get(pairKey) !== null;
  if (exists) principalExistenceCache.add(cacheKey, now);
  return exists;
}

export function clearPrincipalExistenceCache(): void {
  principalExistenceCache.clear();
}
