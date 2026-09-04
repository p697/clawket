import {
  GATEWAY_OWNER_KEY,
  GATEWAY_OWNER_TOUCH_INTERVAL_MS,
  MIRRORED_CLIENT_TOKEN_HASHES_KEY,
  ROOM_META_KEY,
  SOCKET_CLOSE_CODES,
  type GatewayOwnerRecord,
  type MirroredClientTokenHashesRecord,
  type PairGatewayRecord,
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
  hasGateway: boolean;
};

type ReconcileSocketsOptions = {
  preferredSocket?: WebSocket | null;
};

export async function loadRoomMeta(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<RoomMetaRecord>(ROOM_META_KEY);
  if (!raw || typeof raw.gatewayId !== 'string' || !raw.gatewayId.trim()) {
    runtime.roomGatewayId = null;
    return;
  }
  runtime.roomGatewayId = raw.gatewayId;
}

export async function storeRoomMeta(runtime: RelayRuntime, gatewayId: string): Promise<void> {
  if (runtime.roomGatewayId === gatewayId) return;
  runtime.roomGatewayId = gatewayId;
  await runtime.state.storage.put(ROOM_META_KEY, { gatewayId });
}

export async function loadPairGatewayRecord(
  routesKv: KVNamespace,
  gatewayId: string | null | undefined,
): Promise<PairGatewayRecord | null> {
  const normalized = gatewayId?.trim() ?? '';
  if (!normalized) return null;
  const raw = await routesKv.get(`pair-gateway:${normalized}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairGatewayRecord;
    if (!parsed || typeof parsed.gatewayId !== 'string' || typeof parsed.relaySecretHash !== 'string') {
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

export async function loadGatewayOwner(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<GatewayOwnerRecord>(GATEWAY_OWNER_KEY);
  if (!raw || typeof raw.gatewayId !== 'string' || typeof raw.seenAt !== 'number') {
    runtime.gatewayOwner = null;
    return;
  }
  runtime.gatewayOwner = raw;
  runtime.gatewayOwnerTouchedAt = raw.seenAt;
}

export async function touchGatewayOwner(runtime: RelayRuntime, gatewayId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force
    && runtime.gatewayOwner?.gatewayId === gatewayId
    && now - runtime.gatewayOwnerTouchedAt < GATEWAY_OWNER_TOUCH_INTERVAL_MS) {
    return;
  }
  runtime.gatewayOwner = {
    gatewayId,
    seenAt: now,
  };
  runtime.gatewayOwnerTouchedAt = now;
  await runtime.state.storage.put(GATEWAY_OWNER_KEY, runtime.gatewayOwner);
}

export function canAcceptGatewayOwner(runtime: RelayRuntime, gatewayId: string, now: number, leaseMs: number): boolean {
  if (!runtime.gatewayOwner) return true;
  if (runtime.gatewayOwner.gatewayId === gatewayId) return true;
  return now - runtime.gatewayOwner.seenAt > leaseMs;
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
  const previousGatewayLastActivityAt = runtime.gatewayLastActivityAt;
  runtime.gatewaySocket = null;
  runtime.gatewayLastActivityAt = 0;
  runtime.clients.clear();
  runtime.pairingClients.clear();
  runtime.clientLastActivityAtById.clear();

  const sockets = runtime.state.getWebSockets();
  let orphanSocketsClosed = 0;
  let nonOpenSocketsClosed = 0;
  let duplicateSocketsClosed = 0;
  let gatewayCandidate: { socket: WebSocket; connectedAt: number } | null = null;
  const clientCandidates = new Map<string, { socket: WebSocket; connectedAt: number; pairing: boolean }>();
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
      clientCandidates.set(attachment.clientId, {
        socket: ws,
        connectedAt: attachment.connectedAt,
        pairing: attachment.authScope === 'pairing',
      });
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
      clientCandidates.set(attachment.clientId, {
        socket: ws,
        connectedAt: attachment.connectedAt,
        pairing: attachment.authScope === 'pairing',
      });
    } else {
      duplicateSocketsClosed += 1;
      closeSocketBestEffort(ws, 'duplicate_socket');
    }
  }

  runtime.gatewaySocket = gatewayCandidate?.socket ?? null;
  runtime.gatewayLastActivityAt = gatewayCandidate
    ? Math.max(previousGatewayLastActivityAt, gatewayCandidate.connectedAt)
    : 0;
  for (const [clientId, candidate] of clientCandidates.entries()) {
    (candidate.pairing ? runtime.pairingClients : runtime.clients).set(clientId, candidate.socket);
    const previousActivityAt = previousClientLastActivityAtById.get(clientId);
    runtime.clientLastActivityAtById.set(
      clientId,
      typeof previousActivityAt === 'number'
        ? Math.max(previousActivityAt, candidate.connectedAt, attachmentTimestamp(candidate.socket, 'lastPongAt'))
        : Math.max(candidate.connectedAt, attachmentTimestamp(candidate.socket, 'lastPongAt')),
    );
  }

  const summary: RehydrateSummary = {
    totalSocketCount: sockets.length,
    openClientCount: runtime.clients.size,
    orphanSocketsClosed,
    nonOpenSocketsClosed,
    duplicateSocketsClosed,
    hasGateway: Boolean(runtime.gatewaySocket?.readyState === WebSocket.OPEN),
  };
  logRelayTelemetry('relay_worker', 'rehydrate_summary', {
    totalSocketCount: summary.totalSocketCount,
    openClientCount: summary.openClientCount,
    orphanSocketsClosed: summary.orphanSocketsClosed,
    nonOpenSocketsClosed: summary.nonOpenSocketsClosed,
    duplicateSocketsClosed: summary.duplicateSocketsClosed,
    hasGateway: summary.hasGateway,
    pendingConnectStarts: runtime.pendingConnectStarts.size,
    awaitingChallengeCount: runtime.awaitingChallenge.size,
    hasPendingChallenge: Boolean(runtime.pendingChallenge),
  });
  return summary;
}

function attachmentTimestamp(socket: WebSocket, key: 'lastPongAt'): number {
  const attachment = socket.deserializeAttachment() as Record<string, unknown> | null;
  const value = attachment?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function rehydrateSockets(runtime: RelayRuntime): RehydrateSummary {
  return reconcileSockets(runtime);
}
