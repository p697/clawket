export type BackendKind = 'openclaw' | 'hermes' | 'local-model';

export interface Env {
  RELAY_BACKEND?: BackendKind;
  ROOM?: DurableObjectNamespace;
  HERMES_ROOM?: DurableObjectNamespace;
  ROUTES_KV?: KVNamespace;
  HERMES_ROUTES_KV?: KVNamespace;
  REGISTRY_VERIFY_URL?: string;
  PAIRING_SYNC_SECRET?: string;
  PAIRING_TICKET_SECRET?: string;
  MAX_MESSAGES_PER_10S: string;
  MAX_CLIENT_MESSAGES_PER_10S?: string;
  HEARTBEAT_INTERVAL_MS: string;
  GATEWAY_OWNER_LEASE_MS?: string;
  AWAITING_CHALLENGE_TTL_MS?: string;
  CLIENT_PONG_TIMEOUT_MS?: string;
  GATEWAY_PING_TIMEOUT_MS?: string;
}

export type BackendPolicy = {
  backend: BackendKind;
  principalParam: 'gatewayId' | 'bridgeId';
  principalIdPrefix: 'gw_' | 'hbg_';
  principalRecordField: 'gatewayId' | 'bridgeId';
  pendingOwnerField: 'gatewayClientId' | 'bridgeClientId';
  kvKeys: { pair: 'pair-gateway:' | 'hermes-pair-bridge:' };
  registryVerifyPath: '/v1/verify/' | '/v1/hermes/verify/';
  doBinding: 'ROOM' | 'HERMES_ROOM';
  kvBinding: 'ROUTES_KV' | 'HERMES_ROUTES_KV';
  internalRoutes: {
    clientTokens: '/v1/internal/pairing/client-tokens' | '/v1/internal/hermes/pairing/client-tokens';
    bridgeStatus: '/v1/internal/hermes/bridge-status' | null;
  };
  telemetryScope: 'relay_worker' | 'hermes_relay_worker';
  ownerRole: 'gateway' | 'bridge';
  ownerLeaseMs: number;
  heartbeatIntervalMs: number;
  clientPongTimeoutMs: number;
  gatewayPingTimeoutMs: number | null;
  watchdog: 'none' | 'hermes-bridge-probe';
  ownerPresentField: 'hasGateway' | 'hasBridge';
  ownerReplacedField: 'gatewayReplaced' | 'bridgeReplaced';
  ownerLockedEvent: 'gateway_owner_locked' | 'bridge_owner_locked';
  ownerLockedMessage: string;
  ownerReplacedReason: 'replaced_by_new_gateway' | 'replaced_by_new_bridge';
  ownerUnavailableReason: 'gateway_unavailable' | 'bridge_unavailable';
  ownerMessageDroppedEvent: 'gateway_message_dropped_without_active_client' | 'bridge_message_dropped_without_active_client';
  ownerControlInvalidEvent: 'gateway_control_invalid' | 'bridge_control_invalid';
  connectStartMissingEvent: 'connect_start_no_gateway' | 'connect_start_no_bridge';
  securePairing: boolean;
  routeRequestsByOrigin: boolean;
  rejectRequestWithoutOwner: boolean;
  reconnectClientsOnOwnerRequest: boolean;
  traceHints: boolean;
};

export type SocketAttachment = {
  /** Server-generated per-socket diagnostic marker; never an identity or credential. */
  diagnosticId?: string;
  /** Authenticated owner channel bound to one full-client socket incarnation. */
  targetConnectionId?: string;
  role: 'gateway' | 'client';
  clientId: string;
  connectedAt: number;
  traceId?: string;
  clientLabel?: string | null;
  capabilities?: string[];
  lastPongAt?: number;
  /** Routing identity survives Durable Object hibernation; never contains payloads. */
  activeClient?: boolean;
  challengeDeliveredAt?: number;
  authScope?: 'full' | 'pairing';
  pairingSessionId?: string;
  ticketExpiresAt?: number;
};

export type PendingConnectStart = {
  clientId: string;
  data: string;
  queuedAt: number;
  traceId?: string;
};

export type RateState = {
  windowStart: number;
  count: number;
};

export type PairRecord = {
  gatewayId?: string;
  bridgeId?: string;
  displayName?: string | null;
  relaySecretHash: string;
  clientTokens?: Array<{
    hash: string;
    label?: string | null;
    createdAt?: string;
    lastUsedAt?: string | null;
  }>;
};

export type PairGatewayRecord = PairRecord & { gatewayId: string };
export type PairBridgeRecord = PairRecord & { bridgeId: string };

export type OwnerRecord = {
  principalId: string;
  seenAt: number;
};

export type GatewayOwnerRecord = { gatewayId: string; seenAt: number };
export type BridgeOwnerRecord = { bridgeId: string; seenAt: number };

export type PendingChallenge = {
  data: string;
  queuedAt: number;
  gatewayClientId?: string;
  bridgeClientId?: string;
  traceId?: string;
};

export type AwaitingChallengeEntry = {
  clientId: string;
  queuedAt: number;
};

export type RoomMetaRecord = {
  gatewayId?: string;
  bridgeId?: string;
};

export type MirroredClientTokenHashesRecord = {
  hashes: string[];
  updatedAt: number;
};

export type RelayControlEnvelope = Record<string, unknown> & {
  type?: string;
  event?: string;
  sourceClientId?: string;
  targetClientId?: string;
};

export const ROOM_META_KEY = 'room-meta';
export const HERMES_ROOM_META_KEY = ROOM_META_KEY;
export const MIRRORED_CLIENT_TOKEN_HASHES_KEY = 'mirrored-client-token-hashes';
export const CONTROL_PREFIX = '__clawket_relay_control__:';
export const GATEWAY_OWNER_KEY = 'gateway-owner';
export const BRIDGE_OWNER_KEY = GATEWAY_OWNER_KEY;
export const GATEWAY_OWNER_TOUCH_INTERVAL_MS = 5_000;
export const BRIDGE_OWNER_TOUCH_INTERVAL_MS = GATEWAY_OWNER_TOUCH_INTERVAL_MS;
export const CONNECT_START_BUFFER_TTL_MS = 12_000;
export const PENDING_CHALLENGE_TTL_MS = 5_000;
export const AWAITING_CHALLENGE_TTL_DEFAULT_MS = 25_000;
export const CLIENT_PONG_CAPABILITY = 'relay.client-pong.v1';
export const CLIENT_PONG_TIMEOUT_DEFAULT_MS = 120_000;
export const HERMES_CLIENT_PONG_TIMEOUT_DEFAULT_MS = 30_000;
export const GATEWAY_PING_TIMEOUT_DEFAULT_MS = 45_000;
export const RELAY_FRAME_MAX_BYTES = 8 * 1024 * 1024;

export const SOCKET_CLOSE_CODES = {
  FRAME_TOO_LARGE: 1009,
  REPLACED_BY_NEW_GATEWAY: 4001,
  REPLACED_BY_NEW_BRIDGE: 4001,
  REPLACED_BY_NEW_CLIENT_SOCKET: 4002,
  RATE_LIMITED: 4008,
  IDLE_OR_STALE_TIMEOUT: 4009,
  DEAD_SOCKET: 4010,
  GATEWAY_UNAVAILABLE: 4011,
  BRIDGE_UNAVAILABLE: 4011,
  GATEWAY_RECONNECT_REQUIRED: 4012,
} as const;
