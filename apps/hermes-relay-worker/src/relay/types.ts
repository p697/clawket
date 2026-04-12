export interface Env {
  HERMES_ROOM: DurableObjectNamespace;
  HERMES_ROUTES_KV: KVNamespace;
  REGISTRY_VERIFY_URL?: string;
  PAIRING_SYNC_SECRET?: string;
  MAX_MESSAGES_PER_10S: string;
  MAX_CLIENT_MESSAGES_PER_10S?: string;
  HEARTBEAT_INTERVAL_MS: string;
  GATEWAY_OWNER_LEASE_MS?: string;
  AWAITING_CHALLENGE_TTL_MS?: string;
  CLIENT_IDLE_TIMEOUT_MS?: string;
}

export type SocketAttachment = {
  role: 'gateway' | 'client';
  clientId: string;
  connectedAt: number;
  traceId?: string;
  clientLabel?: string | null;
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

export type PairBridgeRecord = {
  bridgeId: string;
  displayName?: string | null;
  relaySecretHash: string;
  clientTokens?: Array<{
    hash: string;
    label?: string | null;
    createdAt?: string;
    lastUsedAt?: string | null;
  }>;
};

export type BridgeOwnerRecord = {
  bridgeId: string;
  seenAt: number;
};

export type PendingChallenge = {
  data: string;
  queuedAt: number;
  bridgeClientId: string;
  traceId?: string;
};

export type AwaitingChallengeEntry = {
  clientId: string;
  queuedAt: number;
};

export type RoomMetaRecord = {
  bridgeId: string;
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

export const HERMES_ROOM_META_KEY = 'room-meta';
export const MIRRORED_CLIENT_TOKEN_HASHES_KEY = 'mirrored-client-token-hashes';
export const CONTROL_PREFIX = '__clawket_relay_control__:';
export const BRIDGE_OWNER_KEY = 'gateway-owner';
export const BRIDGE_OWNER_TOUCH_INTERVAL_MS = 5_000;
export const CONNECT_START_BUFFER_TTL_MS = 12_000;
export const PENDING_CHALLENGE_TTL_MS = 5_000;
export const AWAITING_CHALLENGE_TTL_DEFAULT_MS = 25_000;
export const CLIENT_IDLE_TIMEOUT_DEFAULT_MS = 10 * 60_000;

export const SOCKET_CLOSE_CODES = {
  REPLACED_BY_NEW_BRIDGE: 4001,
  REPLACED_BY_NEW_CLIENT_SOCKET: 4002,
  RATE_LIMITED: 4008,
  IDLE_OR_STALE_TIMEOUT: 4009,
  DEAD_SOCKET: 4010,
  BRIDGE_UNAVAILABLE: 4011,
} as const;
