export type RegistryBackend = 'openclaw' | 'hermes' | 'local-model' | 'pi';

export type RegistryKvBinding = 'ROUTES_KV' | 'HERMES_ROUTES_KV';
export type RegistryPrincipalParam = 'gatewayId' | 'bridgeId';

export type RegistryBackendPolicy = {
  backend: RegistryBackend;
  wireProtocol: 'gateway' | 'hermes';
  principalParam: RegistryPrincipalParam;
  principalLabel: 'Gateway' | 'Bridge';
  principalIdPrefix: 'gw_' | 'hbg_';
  relaySecretPrefix: 'grs_' | 'hrs_';
  clientTokenPrefix: 'gct_' | 'hct_';
  kvBinding: RegistryKvBinding;
  pairKeyPrefix: 'pair-gateway:' | 'hermes-pair-bridge:';
  pairBasePath: '/v1/pair' | '/v1/hermes/pair';
  verifyPathPrefix: '/v1/verify/' | '/v1/hermes/verify/';
  relaySyncPath: '/v1/internal/pairing/client-tokens' | '/v1/internal/hermes/pairing/client-tokens';
  useRelaySyncServiceBinding: boolean;
  telemetryScope: 'registry_worker' | 'hermes_registry_worker';
  errors: {
    invalidPrincipal: 'INVALID_GATEWAY_ID' | 'INVALID_BRIDGE_ID';
    principalNotFound: 'GATEWAY_NOT_FOUND' | 'BRIDGE_NOT_FOUND';
    corruptRecordMessage: (principalId: string) => string;
  };
};

export const OPENCLAW_REGISTRY_POLICY: RegistryBackendPolicy = {
  backend: 'openclaw',
  wireProtocol: 'gateway',
  principalParam: 'gatewayId',
  principalLabel: 'Gateway',
  principalIdPrefix: 'gw_',
  relaySecretPrefix: 'grs_',
  clientTokenPrefix: 'gct_',
  kvBinding: 'ROUTES_KV',
  pairKeyPrefix: 'pair-gateway:',
  pairBasePath: '/v1/pair',
  verifyPathPrefix: '/v1/verify/',
  relaySyncPath: '/v1/internal/pairing/client-tokens',
  useRelaySyncServiceBinding: true,
  telemetryScope: 'registry_worker',
  errors: {
    invalidPrincipal: 'INVALID_GATEWAY_ID',
    principalNotFound: 'GATEWAY_NOT_FOUND',
    corruptRecordMessage: (gatewayId) => (
      `Stored pairing record for ${gatewayId} is invalid. Reset the bridge pairing and pair again.`
    ),
  },
};

export const HERMES_REGISTRY_POLICY: RegistryBackendPolicy = {
  backend: 'hermes',
  wireProtocol: 'hermes',
  principalParam: 'bridgeId',
  principalLabel: 'Bridge',
  principalIdPrefix: 'hbg_',
  relaySecretPrefix: 'hrs_',
  clientTokenPrefix: 'hct_',
  kvBinding: 'HERMES_ROUTES_KV',
  pairKeyPrefix: 'hermes-pair-bridge:',
  pairBasePath: '/v1/hermes/pair',
  verifyPathPrefix: '/v1/hermes/verify/',
  relaySyncPath: '/v1/internal/hermes/pairing/client-tokens',
  useRelaySyncServiceBinding: false,
  telemetryScope: 'hermes_registry_worker',
  errors: {
    invalidPrincipal: 'INVALID_BRIDGE_ID',
    principalNotFound: 'BRIDGE_NOT_FOUND',
    corruptRecordMessage: (bridgeId) => (
      `Stored Hermes pairing record for ${bridgeId} is invalid. Reset the Hermes bridge pairing and pair again.`
    ),
  },
};

// Same secure pairing wire protocol; deployed with isolated KV and service bindings.
export const LOCAL_MODEL_REGISTRY_POLICY: RegistryBackendPolicy = {
  ...OPENCLAW_REGISTRY_POLICY, backend: 'local-model',
};

export const PI_REGISTRY_POLICY: RegistryBackendPolicy = { ...OPENCLAW_REGISTRY_POLICY, backend: 'pi' };

export function resolveRegistryBackendPolicy(value: string | undefined): RegistryBackendPolicy {
  if (value === undefined) return OPENCLAW_REGISTRY_POLICY;
  if (value === 'openclaw') return OPENCLAW_REGISTRY_POLICY;
  if (value === 'pi') return PI_REGISTRY_POLICY;
  if (value === 'local-model') return LOCAL_MODEL_REGISTRY_POLICY;
  if (value === 'hermes') return HERMES_REGISTRY_POLICY;
  throw new Error(`Unsupported RELAY_BACKEND: ${value}`);
}
