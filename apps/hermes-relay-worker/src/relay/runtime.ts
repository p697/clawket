import {
  AWAITING_CHALLENGE_TTL_DEFAULT_MS,
  CLIENT_IDLE_TIMEOUT_DEFAULT_MS,
  type Env,
  type BridgeOwnerRecord,
  type PendingChallenge,
  type PendingConnectStart,
  type RateState,
  type AwaitingChallengeEntry,
} from './types';
import { parsePositiveInt } from './utils';

export class RelayRuntime {
  bridgeSocket: WebSocket | null = null;
  bridgeLastActivityAt = 0;
  readonly clients = new Map<string, WebSocket>();
  readonly rate = new WeakMap<WebSocket, RateState>();
  bridgeOwner: BridgeOwnerRecord | null = null;
  bridgeOwnerTouchedAt = 0;
  roomBridgeId: string | null = null;
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

export function touchClientSocketActivity(runtime: RelayRuntime, ws: WebSocket, at = Date.now()): void {
  const attachment = ws.deserializeAttachment() as { role?: string; clientId?: string } | null;
  if (!attachment || attachment.role !== 'client' || typeof attachment.clientId !== 'string') return;
  touchClientActivity(runtime, attachment.clientId, at);
}

export function touchBridgeActivity(runtime: RelayRuntime, at = Date.now()): void {
  runtime.bridgeLastActivityAt = Math.max(runtime.bridgeLastActivityAt, at);
}
