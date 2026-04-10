/**
 * types.ts — Relay type definitions for Docker self-hosted deployment.
 *
 * Ported from apps/relay-worker/src/relay/types.ts.
 * CF-specific types (DurableObjectNamespace, KVNamespace) replaced
 * with Docker equivalents.
 */

import type { MemoryKV } from '../kv-store.js';

export interface Env {
  ROUTES_KV: MemoryKV;
  REGISTRY_VERIFY_URL?: string;
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
export const CLIENT_IDLE_TIMEOUT_DEFAULT_MS = 10 * 60_000;

export const SOCKET_CLOSE_CODES = {
  REPLACED_BY_NEW_GATEWAY: 4001,
  REPLACED_BY_NEW_CLIENT_SOCKET: 4002,
  RATE_LIMITED: 4008,
  IDLE_OR_STALE_TIMEOUT: 4009,
  DEAD_SOCKET: 4010,
} as const;
