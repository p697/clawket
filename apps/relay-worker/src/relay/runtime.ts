import {
  AWAITING_CHALLENGE_TTL_DEFAULT_MS,
  type AwaitingChallengeEntry,
  type BackendPolicy,
  type Env,
  type OwnerRecord,
  type PendingChallenge,
  type PendingConnectStart,
  type RateState,
} from './types';
import { parsePositiveInt } from './utils';

export class RelayRuntime {
  gatewaySocket: WebSocket | null = null;
  gatewayLastActivityAt = 0;
  pendingGatewayPingAt = 0;
  gatewayPingCapability: 'unknown' | 'supported' | 'unsupported' = 'unknown';
  readonly clients = new Map<string, WebSocket>();
  readonly pairingClients = new Map<string, WebSocket>();
  readonly rate = new WeakMap<WebSocket, RateState>();
  owner: OwnerRecord | null = null;
  ownerTouchedAt = 0;
  roomPrincipalId: string | null = null;
  readonly connectStartAtByClientId = new Map<string, number>();
  readonly pendingConnectStarts = new Map<string, PendingConnectStart>();
  readonly connectReqClientByReqId = new Map<string, string>();
  readonly requestClientByReqId = new Map<string, string>();
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
    readonly policy: BackendPolicy,
  ) {}

  awaitingChallengeTtlMs(): number {
    return parsePositiveInt(this.env.AWAITING_CHALLENGE_TTL_MS, AWAITING_CHALLENGE_TTL_DEFAULT_MS);
  }

  clientPongTimeoutMs(): number {
    return parsePositiveInt(this.env.CLIENT_PONG_TIMEOUT_MS, this.policy.clientPongTimeoutMs);
  }

  objectId(): string | null {
    try {
      return this.state.id.toString();
    } catch {
      return null;
    }
  }

  // Compatibility aliases keep the two existing test suites readable while
  // the shared runtime follows the wire protocol's historical gateway role.
  get bridgeSocket(): WebSocket | null {
    return this.gatewaySocket;
  }

  set bridgeSocket(value: WebSocket | null) {
    this.gatewaySocket = value;
  }

  get bridgeLastActivityAt(): number {
    return this.gatewayLastActivityAt;
  }

  set bridgeLastActivityAt(value: number) {
    this.gatewayLastActivityAt = value;
  }

  get roomGatewayId(): string | null {
    return this.roomPrincipalId;
  }

  set roomGatewayId(value: string | null) {
    this.roomPrincipalId = value;
  }

  get roomBridgeId(): string | null {
    return this.roomPrincipalId;
  }

  set roomBridgeId(value: string | null) {
    this.roomPrincipalId = value;
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

export const touchBridgeActivity = touchGatewayActivity;
