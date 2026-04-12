import {
  BRIDGE_OWNER_KEY,
  BRIDGE_OWNER_TOUCH_INTERVAL_MS,
  MIRRORED_CLIENT_TOKEN_HASHES_KEY,
  HERMES_ROOM_META_KEY,
  SOCKET_CLOSE_CODES,
  type BridgeOwnerRecord,
  type MirroredClientTokenHashesRecord,
  type PairBridgeRecord,
  type RoomMetaRecord,
  type SocketAttachment,
} from './types';
import type { RelayRuntime } from './runtime';
import { logRelayTelemetry } from './telemetry';

export type RehydrateSummary = {
  totalSocketCount: number;
  openClientCount: number;
  orphanSocketsClosed: number;
  nonOpenSocketsClosed: number;
  duplicateSocketsClosed: number;
  hasBridge: boolean;
};

type ReconcileSocketsOptions = {
  preferredSocket?: WebSocket | null;
};

export async function loadRoomMeta(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<RoomMetaRecord>(HERMES_ROOM_META_KEY);
  if (!raw || typeof raw.bridgeId !== 'string' || !raw.bridgeId.trim()) {
    runtime.roomBridgeId = null;
    return;
  }
  runtime.roomBridgeId = raw.bridgeId;
}

export async function storeRoomMeta(runtime: RelayRuntime, bridgeId: string): Promise<void> {
  if (runtime.roomBridgeId === bridgeId) return;
  runtime.roomBridgeId = bridgeId;
  await runtime.state.storage.put(HERMES_ROOM_META_KEY, { bridgeId });
}

export async function loadPairBridgeRecord(
  routesKv: KVNamespace,
  bridgeId: string | null | undefined,
): Promise<PairBridgeRecord | null> {
  const normalized = bridgeId?.trim() ?? '';
  if (!normalized) return null;
  const raw = await routesKv.get(`hermes-pair-bridge:${normalized}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairBridgeRecord;
    if (!parsed || typeof parsed.bridgeId !== 'string' || typeof parsed.relaySecretHash !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function loadMirroredClientTokenHashes(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<MirroredClientTokenHashesRecord>(MIRRORED_CLIENT_TOKEN_HASHES_KEY);
  if (!raw || !Array.isArray(raw.hashes)) {
    runtime.mirroredClientTokenHashes = new Set();
    runtime.mirroredClientTokenHashesUpdatedAt = 0;
    return;
  }
  runtime.mirroredClientTokenHashes = new Set(
    raw.hashes
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  );
  runtime.mirroredClientTokenHashesUpdatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
}

export async function storeMirroredClientTokenHashes(
  runtime: RelayRuntime,
  hashes: string[],
  updatedAt = Date.now(),
): Promise<void> {
  const normalized = Array.from(new Set(
    hashes
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  ));
  runtime.mirroredClientTokenHashes = new Set(normalized);
  runtime.mirroredClientTokenHashesUpdatedAt = updatedAt;
  await runtime.state.storage.put(MIRRORED_CLIENT_TOKEN_HASHES_KEY, {
    hashes: normalized,
    updatedAt,
  } satisfies MirroredClientTokenHashesRecord);
}

export async function loadBridgeOwner(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<BridgeOwnerRecord>(BRIDGE_OWNER_KEY);
  if (!raw || typeof raw.bridgeId !== 'string' || typeof raw.seenAt !== 'number') {
    runtime.bridgeOwner = null;
    return;
  }
  runtime.bridgeOwner = raw;
  runtime.bridgeOwnerTouchedAt = raw.seenAt;
}

export async function touchBridgeOwner(runtime: RelayRuntime, bridgeId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force
    && runtime.bridgeOwner?.bridgeId === bridgeId
    && now - runtime.bridgeOwnerTouchedAt < BRIDGE_OWNER_TOUCH_INTERVAL_MS) {
    return;
  }
  runtime.bridgeOwner = {
    bridgeId,
    seenAt: now,
  };
  runtime.bridgeOwnerTouchedAt = now;
  await runtime.state.storage.put(BRIDGE_OWNER_KEY, runtime.bridgeOwner);
}

export function canAcceptBridgeOwner(runtime: RelayRuntime, bridgeId: string, now: number, leaseMs: number): boolean {
  if (!runtime.bridgeOwner) return true;
  if (runtime.bridgeOwner.bridgeId === bridgeId) return true;
  return now - runtime.bridgeOwner.seenAt > leaseMs;
}

function closeSocketBestEffort(ws: WebSocket, reason: 'orphan_socket' | 'dead_socket' | 'duplicate_socket'): void {
  try {
    ws.close(SOCKET_CLOSE_CODES.DEAD_SOCKET, reason);
  } catch {
    // Best effort cleanup; hibernated sockets may already be detached remotely.
  }
}

function shouldPreferSocketCandidate(input: {
  currentConnectedAt: number;
  nextConnectedAt: number;
  currentSocket: WebSocket;
  nextSocket: WebSocket;
  preferredSocket?: WebSocket | null;
}): boolean {
  if (input.preferredSocket && input.nextSocket === input.preferredSocket && input.currentSocket !== input.preferredSocket) {
    return true;
  }
  if (input.preferredSocket && input.currentSocket === input.preferredSocket && input.nextSocket !== input.preferredSocket) {
    return false;
  }
  return input.nextConnectedAt >= input.currentConnectedAt;
}

export function reconcileSockets(runtime: RelayRuntime, options: ReconcileSocketsOptions = {}): RehydrateSummary {
  const previousClientLastActivityAtById = new Map(runtime.clientLastActivityAtById);
  const previousBridgeLastActivityAt = runtime.bridgeLastActivityAt;
  runtime.bridgeSocket = null;
  runtime.bridgeLastActivityAt = 0;
  runtime.clients.clear();
  runtime.clientLastActivityAtById.clear();

  const sockets = runtime.state.getWebSockets();
  let orphanSocketsClosed = 0;
  let nonOpenSocketsClosed = 0;
  let duplicateSocketsClosed = 0;
  let gatewayCandidate: { socket: WebSocket; connectedAt: number } | null = null;
  const clientCandidates = new Map<string, { socket: WebSocket; connectedAt: number }>();
  for (const ws of sockets) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      orphanSocketsClosed += 1;
      closeSocketBestEffort(ws, 'orphan_socket');
      continue;
    }
    if (ws.readyState !== WebSocket.OPEN) {
      nonOpenSocketsClosed += 1;
      closeSocketBestEffort(ws, 'dead_socket');
      continue;
    }
    if (attachment.role === 'gateway') {
      if (!gatewayCandidate) {
        gatewayCandidate = { socket: ws, connectedAt: attachment.connectedAt };
        continue;
      }
      const nextWins = shouldPreferSocketCandidate({
        currentConnectedAt: gatewayCandidate.connectedAt,
        nextConnectedAt: attachment.connectedAt,
        currentSocket: gatewayCandidate.socket,
        nextSocket: ws,
        preferredSocket: options.preferredSocket,
      });
      if (nextWins) {
        duplicateSocketsClosed += 1;
        closeSocketBestEffort(gatewayCandidate.socket, 'duplicate_socket');
        gatewayCandidate = { socket: ws, connectedAt: attachment.connectedAt };
      } else {
        duplicateSocketsClosed += 1;
        closeSocketBestEffort(ws, 'duplicate_socket');
      }
      continue;
    }

    const existing = clientCandidates.get(attachment.clientId);
    if (!existing) {
      clientCandidates.set(attachment.clientId, { socket: ws, connectedAt: attachment.connectedAt });
      continue;
    }
    const nextWins = shouldPreferSocketCandidate({
      currentConnectedAt: existing.connectedAt,
      nextConnectedAt: attachment.connectedAt,
      currentSocket: existing.socket,
      nextSocket: ws,
      preferredSocket: options.preferredSocket,
    });
    if (nextWins) {
      duplicateSocketsClosed += 1;
      closeSocketBestEffort(existing.socket, 'duplicate_socket');
      clientCandidates.set(attachment.clientId, { socket: ws, connectedAt: attachment.connectedAt });
    } else {
      duplicateSocketsClosed += 1;
      closeSocketBestEffort(ws, 'duplicate_socket');
    }
  }

  runtime.bridgeSocket = gatewayCandidate?.socket ?? null;
  runtime.bridgeLastActivityAt = gatewayCandidate
    ? Math.max(previousBridgeLastActivityAt, gatewayCandidate.connectedAt)
    : 0;
  for (const [clientId, candidate] of clientCandidates.entries()) {
    runtime.clients.set(clientId, candidate.socket);
    const previousActivityAt = previousClientLastActivityAtById.get(clientId);
    runtime.clientLastActivityAtById.set(
      clientId,
      typeof previousActivityAt === 'number'
        ? Math.max(previousActivityAt, candidate.connectedAt)
        : candidate.connectedAt,
    );
  }

  const summary: RehydrateSummary = {
    totalSocketCount: sockets.length,
    openClientCount: runtime.clients.size,
    orphanSocketsClosed,
    nonOpenSocketsClosed,
    duplicateSocketsClosed,
    hasBridge: Boolean(runtime.bridgeSocket?.readyState === WebSocket.OPEN),
  };
  logRelayTelemetry('hermes_relay_worker', 'rehydrate_summary', {
    totalSocketCount: summary.totalSocketCount,
    openClientCount: summary.openClientCount,
    orphanSocketsClosed: summary.orphanSocketsClosed,
    nonOpenSocketsClosed: summary.nonOpenSocketsClosed,
    duplicateSocketsClosed: summary.duplicateSocketsClosed,
    hasBridge: summary.hasBridge,
    pendingConnectStarts: runtime.pendingConnectStarts.size,
    awaitingChallengeCount: runtime.awaitingChallenge.size,
    hasPendingChallenge: Boolean(runtime.pendingChallenge),
  });
  return summary;
}

export function rehydrateSockets(runtime: RelayRuntime): RehydrateSummary {
  return reconcileSockets(runtime);
}
