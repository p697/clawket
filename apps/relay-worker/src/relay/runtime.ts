import {
  AWAITING_CHALLENGE_TTL_DEFAULT_MS,
  CLIENT_PONG_TIMEOUT_DEFAULT_MS,
  type Env,
  type GatewayOwnerRecord,
  type PendingChallenge,
  type PendingConnectStart,
  type RateState,
  type AwaitingChallengeEntry,
} from './types';
import { parsePositiveInt } from './utils';

export class RelayRuntime {
  gatewaySocket: WebSocket | null = null;
  gatewayLastActivityAt = 0;
  readonly clients = new Map<string, WebSocket>();
  readonly pairingClients = new Map<string, WebSocket>();
  readonly rate = new WeakMap<WebSocket, RateState>();
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
    readonly state: DurableObjectState,
    readonly env: Env,
  ) {}

  awaitingChallengeTtlMs(): number {
    return parsePositiveInt(this.env.AWAITING_CHALLENGE_TTL_MS, AWAITING_CHALLENGE_TTL_DEFAULT_MS);
  }

  clientPongTimeoutMs(): number {
    return parsePositiveInt(this.env.CLIENT_PONG_TIMEOUT_MS, CLIENT_PONG_TIMEOUT_DEFAULT_MS);
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

export function touchClientSocketActivity(runtime: RelayRuntime, ws: WebSocket, at = Date.now()): void {
  const attachment = ws.deserializeAttachment() as { role?: string; clientId?: string } | null;
  if (!attachment || attachment.role !== 'client' || typeof attachment.clientId !== 'string') return;
  touchClientActivity(runtime, attachment.clientId, at);
}

export function touchGatewayActivity(runtime: RelayRuntime, at = Date.now()): void {
  runtime.gatewayLastActivityAt = Math.max(runtime.gatewayLastActivityAt, at);
}
