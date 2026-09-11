import { selectActiveClient } from './runtime';
import {
  GATEWAY_OWNER_KEY,
  GATEWAY_OWNER_TOUCH_INTERVAL_MS,
  MIRRORED_CLIENT_TOKEN_HASHES_KEY,
  ROOM_META_KEY,
  SOCKET_CLOSE_CODES,
  type MirroredClientTokenHashesRecord,
  type PairBridgeRecord,
  type PairGatewayRecord,
  type PairRecord,
  type RoomMetaRecord,
  type SocketAttachment,
} from './types';
import type { RelayRuntime } from './runtime';
import { logRuntimeTelemetry } from './telemetry';
import { HERMES_BACKEND_POLICY, OPENCLAW_BACKEND_POLICY } from '../backend-policy';

export type RehydrateSummary = {
  totalSocketCount: number;
  openClientCount: number;
  orphanSocketsClosed: number;
  nonOpenSocketsClosed: number;
  duplicateSocketsClosed: number;
  hasGateway?: boolean;
  hasBridge?: boolean;
};

type ReconcileSocketsOptions = {
  preferredSocket?: WebSocket | null;
};

export async function loadRoomMeta(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<RoomMetaRecord>(ROOM_META_KEY);
  const principalId = raw?.[runtime.policy.principalRecordField];
  runtime.roomPrincipalId = typeof principalId === 'string' && principalId.trim() ? principalId : null;
}

export async function storeRoomMeta(runtime: RelayRuntime, principalId: string): Promise<void> {
  if (runtime.roomPrincipalId === principalId) return;
  runtime.roomPrincipalId = principalId;
  await runtime.state.storage.put(ROOM_META_KEY, {
    [runtime.policy.principalRecordField]: principalId,
  });
}

async function loadPairRecord(
  routesKv: KVNamespace,
  principalId: string | null | undefined,
  policy: typeof OPENCLAW_BACKEND_POLICY | typeof HERMES_BACKEND_POLICY,
): Promise<PairRecord | null> {
  const normalized = principalId?.trim() ?? '';
  if (!normalized) return null;
  const raw = await routesKv.get(`${policy.kvKeys.pair}${normalized}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairRecord;
    if (!parsed
      || typeof parsed[policy.principalRecordField] !== 'string'
      || typeof parsed.relaySecretHash !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function loadPairGatewayRecord(
  routesKv: KVNamespace,
  gatewayId: string | null | undefined,
): Promise<PairGatewayRecord | null> {
  return await loadPairRecord(routesKv, gatewayId, OPENCLAW_BACKEND_POLICY) as PairGatewayRecord | null;
}

export async function loadPairBridgeRecord(
  routesKv: KVNamespace,
  bridgeId: string | null | undefined,
): Promise<PairBridgeRecord | null> {
  return await loadPairRecord(routesKv, bridgeId, HERMES_BACKEND_POLICY) as PairBridgeRecord | null;
}

export async function loadMirroredClientTokenHashes(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<MirroredClientTokenHashesRecord>(MIRRORED_CLIENT_TOKEN_HASHES_KEY);
  if (!raw || !Array.isArray(raw.hashes)) {
    runtime.mirroredClientTokenHashes = new Set();
    runtime.mirroredClientTokenHashesUpdatedAt = 0;
    return;
  }
  runtime.mirroredClientTokenHashes = new Set(
    raw.hashes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  );
  runtime.mirroredClientTokenHashesUpdatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
}

export async function storeMirroredClientTokenHashes(
  runtime: RelayRuntime,
  hashes: string[],
  updatedAt = Date.now(),
): Promise<void> {
  const normalized = Array.from(new Set(
    hashes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  ));
  runtime.mirroredClientTokenHashes = new Set(normalized);
  runtime.mirroredClientTokenHashesUpdatedAt = updatedAt;
  await runtime.state.storage.put(MIRRORED_CLIENT_TOKEN_HASHES_KEY, {
    hashes: normalized,
    updatedAt,
  } satisfies MirroredClientTokenHashesRecord);
}

export async function loadGatewayOwner(runtime: RelayRuntime): Promise<void> {
  const raw = await runtime.state.storage.get<Record<string, unknown>>(GATEWAY_OWNER_KEY);
  const principalId = raw?.[runtime.policy.principalRecordField];
  const seenAt = raw?.seenAt;
  if (typeof principalId !== 'string' || typeof seenAt !== 'number') {
    runtime.owner = null;
    return;
  }
  runtime.owner = { principalId, seenAt };
  runtime.ownerTouchedAt = seenAt;
}

export async function touchGatewayOwner(runtime: RelayRuntime, principalId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force
    && runtime.owner?.principalId === principalId
    && now - runtime.ownerTouchedAt < GATEWAY_OWNER_TOUCH_INTERVAL_MS) {
    return;
  }
  runtime.owner = { principalId, seenAt: now };
  runtime.ownerTouchedAt = now;
  await runtime.state.storage.put(GATEWAY_OWNER_KEY, {
    [runtime.policy.principalRecordField]: principalId,
    seenAt: now,
  });
}

export function canAcceptGatewayOwner(
  runtime: RelayRuntime,
  principalId: string,
  now: number,
  leaseMs: number,
): boolean {
  if (!runtime.owner) return true;
  if (runtime.owner.principalId === principalId) return true;
  return now - runtime.owner.seenAt > leaseMs;
}

export const loadBridgeOwner = loadGatewayOwner;
export const touchBridgeOwner = touchGatewayOwner;
export const canAcceptBridgeOwner = canAcceptGatewayOwner;

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
    if (attachment.role === 'gateway' && attachment.targetConnectionId && runtime.policy.backend === 'openclaw') continue;
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
    const candidate = {
      socket: ws,
      connectedAt: attachment.connectedAt,
      pairing: runtime.policy.securePairing && attachment.authScope === 'pairing',
    };
    if (!existing) {
      clientCandidates.set(attachment.clientId, candidate);
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
      clientCandidates.set(attachment.clientId, candidate);
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

  // WebSockets survive hibernation while ordinary fields do not. A socket's
  // persisted route marker is authoritative; never promote a pairing-only socket.
  if (!runtime.activeClientId || !runtime.clients.has(runtime.activeClientId)) {
    const marked = [...runtime.clients].filter(([, socket]) => (
      (socket.deserializeAttachment() as SocketAttachment | null)?.activeClient === true
    ));
    const onlyClient = runtime.clients.size === 1 ? runtime.clients.keys().next().value : null;
    selectActiveClient(runtime, marked.length === 1 ? marked[0][0] : onlyClient ?? null);
  }

  const hasOwner = Boolean(runtime.gatewaySocket?.readyState === WebSocket.OPEN);
  const summary: RehydrateSummary = {
    totalSocketCount: sockets.length,
    openClientCount: runtime.clients.size,
    orphanSocketsClosed,
    nonOpenSocketsClosed,
    duplicateSocketsClosed,
    [runtime.policy.ownerPresentField]: hasOwner,
  };
  logRuntimeTelemetry(runtime, 'rehydrate_summary', {
    totalSocketCount: summary.totalSocketCount,
    openClientCount: summary.openClientCount,
    orphanSocketsClosed: summary.orphanSocketsClosed,
    nonOpenSocketsClosed: summary.nonOpenSocketsClosed,
    duplicateSocketsClosed: summary.duplicateSocketsClosed,
    [runtime.policy.ownerPresentField]: hasOwner,
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
