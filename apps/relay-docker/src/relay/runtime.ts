/**
 * runtime.ts — Relay runtime state container.
 * Ported from apps/relay-worker/src/relay/runtime.ts.
 * Adapted: uses RoomState shim instead of DurableObjectState.
 */

import type { WebSocket as WsWebSocket } from 'ws';
import {
  AWAITING_CHALLENGE_TTL_DEFAULT_MS,
  CLIENT_IDLE_TIMEOUT_DEFAULT_MS,
  type Env,
  type GatewayOwnerRecord,
  type PendingChallenge,
  type PendingConnectStart,
  type RateState,
  type AwaitingChallengeEntry,
} from './types.js';
import { parsePositiveInt } from './utils.js';
import type { RoomState } from '../cf-shim.js';
import { deserializeAttachment } from '../cf-shim.js';

export class RelayRuntime {
  gatewaySocket: WsWebSocket | null = null;
  gatewayLastActivityAt = 0;
  readonly clients = new Map<string, WsWebSocket>();
  readonly rate = new WeakMap<WsWebSocket, RateState>();
  gatewayOwner: GatewayOwnerRecord | null = null;
  gatewayOwnerTouchedAt = 0;
  roomGatewayId: string | null = null;
  readonly connectStartAtByClientId = new Map<string, number>();
  readonly pendingConnectStarts = new Map<string, PendingConnectStart>();
  readonly connectReqClientByReqId = new Map<string, string>();
  readonly awaitingChallenge = new Map<string, AwaitingChallengeEntry>();
  readonly clientLastActivityAtById = new Map<string, number>();
  mirroredClientTokenHashes = new Set<string>();
  mirroredClientTokenHashesUpdatedAt = 0;
  activeClientId: string | null = null;
  challengeClientId: string | null = null;
  pendingChallenge: PendingChallenge | null = null;

  constructor(
    readonly state: RoomState,
    readonly env: Env,
  ) {}

  awaitingChallengeTtlMs(): number {
    return parsePositiveInt(this.env.AWAITING_CHALLENGE_TTL_MS, AWAITING_CHALLENGE_TTL_DEFAULT_MS);
  }

  clientIdleTimeoutMs(): number {
    return parsePositiveInt(this.env.CLIENT_IDLE_TIMEOUT_MS, CLIENT_IDLE_TIMEOUT_DEFAULT_MS);
  }

  objectId(): string | null {
    try {
      return this.state.id.toString();
    } catch {
      return null;
    }
  }
}

export function touchClientActivity(runtime: RelayRuntime, clientId: string, at = Date.now()): void {
  runtime.clientLastActivityAtById.set(clientId, at);
}

export function touchClientSocketActivity(runtime: RelayRuntime, ws: WsWebSocket, at = Date.now()): void {
  const attachment = deserializeAttachment(ws) as { role?: string; clientId?: string } | null;
  if (!attachment || attachment.role !== 'client' || typeof attachment.clientId !== 'string') return;
  touchClientActivity(runtime, attachment.clientId, at);
}

export function touchGatewayActivity(runtime: RelayRuntime, at = Date.now()): void {
  runtime.gatewayLastActivityAt = Math.max(runtime.gatewayLastActivityAt, at);
}
