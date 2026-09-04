export interface Env {
  ROOM: DurableObjectNamespace;
  ROUTES_KV: KVNamespace;
  REGISTRY_VERIFY_URL?: string;
  PAIRING_SYNC_SECRET?: string;
  PAIRING_TICKET_SECRET?: string;
  MAX_MESSAGES_PER_10S: string;
  MAX_CLIENT_MESSAGES_PER_10S?: string;
  HEARTBEAT_INTERVAL_MS: string;
  GATEWAY_OWNER_LEASE_MS?: string;
  AWAITING_CHALLENGE_TTL_MS?: string;
  CLIENT_PONG_TIMEOUT_MS?: string;
}

export type SocketAttachment = {
  role: 'gateway' | 'client';
  clientId: string;
  connectedAt: number;
  traceId?: string;
  clientLabel?: string | null;
  capabilities?: string[];
  lastPongAt?: number;
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

export type PairGatewayRecord = {
  gatewayId: string;
  displayName?: string | null;
  relaySecretHash: string;
  clientTokens?: Array<{
    hash: string;
    label?: string | null;
    createdAt?: string;
    lastUsedAt?: string | null;
  }>;
};

export type GatewayOwnerRecord = {
  gatewayId: string;
  seenAt: number;
};

export type PendingChallenge = {
  data: string;
  queuedAt: number;
  gatewayClientId: string;
  traceId?: string;
};

export type AwaitingChallengeEntry = {
  clientId: string;
  queuedAt: number;
};

export type RoomMetaRecord = {
  gatewayId: string;
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
export const MIRRORED_CLIENT_TOKEN_HASHES_KEY = 'mirrored-client-token-hashes';
export const CONTROL_PREFIX = '__clawket_relay_control__:';
export const GATEWAY_OWNER_KEY = 'gateway-owner';
export const GATEWAY_OWNER_TOUCH_INTERVAL_MS = 5_000;
export const CONNECT_START_BUFFER_TTL_MS = 12_000;
export const PENDING_CHALLENGE_TTL_MS = 5_000;
export const AWAITING_CHALLENGE_TTL_DEFAULT_MS = 25_000;
export const CLIENT_PONG_CAPABILITY = 'relay.client-pong.v1';
export const CLIENT_PONG_TIMEOUT_DEFAULT_MS = 120_000;

export const SOCKET_CLOSE_CODES = {
  REPLACED_BY_NEW_GATEWAY: 4001,
  REPLACED_BY_NEW_CLIENT_SOCKET: 4002,
  RATE_LIMITED: 4008,
  IDLE_OR_STALE_TIMEOUT: 4009,
  DEAD_SOCKET: 4010,
  GATEWAY_UNAVAILABLE: 4011,
  GATEWAY_RECONNECT_REQUIRED: 4012,
} as const;
