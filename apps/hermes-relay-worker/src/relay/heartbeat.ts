import {
  CONNECT_START_BUFFER_TTL_MS,
  SOCKET_CLOSE_CODES,
} from './types';
import {
  isAwaitingChallengeExpired,
  isClientIdleExpired,
  isClientStaleForHandshake,
  resolveAwaitingChallengeClientId,
} from './frames';
import { logRelayTelemetry } from './telemetry';
import type { RelayRuntime } from './runtime';
import { parsePositiveInt } from './utils';
import { sendControlToBridge } from './control';

export async function ensureHeartbeat(runtime: RelayRuntime): Promise<void> {
  const interval = parsePositiveInt(runtime.env.HEARTBEAT_INTERVAL_MS, 30_000);
  if (!hasOpenClients(runtime)) {
    await runtime.state.storage.deleteAlarm();
    return;
  }
  await runtime.state.storage.setAlarm(Date.now() + interval);
}

export function hasOpenClients(runtime: RelayRuntime): boolean {
  for (const ws of runtime.clients.values()) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

export function prunePendingConnectStarts(runtime: RelayRuntime, now: number): void {
  for (const [clientId, pending] of runtime.pendingConnectStarts.entries()) {
    if (now - pending.queuedAt <= CONNECT_START_BUFFER_TTL_MS) continue;
    runtime.pendingConnectStarts.delete(clientId);
    logRelayTelemetry('hermes_relay_worker', 'connect_start_buffer_expired', {
      role: 'client',
      queuedMs: Math.max(0, now - pending.queuedAt),
    });
  }
}

export function pruneExpiredAwaitingChallenges(runtime: RelayRuntime, now: number): void {
  const ttlMs = runtime.awaitingChallengeTtlMs();
  for (const [clientId, entry] of runtime.awaitingChallenge.entries()) {
    if (!isAwaitingChallengeExpired(entry.queuedAt, now, ttlMs)) continue;
    runtime.awaitingChallenge.delete(clientId);
    runtime.connectStartAtByClientId.delete(clientId);
    for (const [reqId, reqClientId] of runtime.connectReqClientByReqId.entries()) {
      if (reqClientId === clientId) {
        runtime.connectReqClientByReqId.delete(reqId);
      }
    }
    if (runtime.challengeClientId === clientId) {
      runtime.challengeClientId = null;
    }
    logRelayTelemetry('hermes_relay_worker', 'awaiting_challenge_expired', {
      queuedMs: Math.max(0, now - entry.queuedAt),
      ttlMs,
      clientCount: runtime.clients.size,
    });
  }
}

export function pruneStaleHandshakeClients(runtime: RelayRuntime, now: number): void {
  let changed = false;
  const ttlMs = runtime.awaitingChallengeTtlMs();
  const idleTimeoutMs = runtime.clientIdleTimeoutMs();
  for (const [clientId, client] of runtime.clients.entries()) {
    if (client.readyState !== WebSocket.OPEN) {
      changed = dropClientState(runtime, clientId, 'non_open_ready_state') || changed;
      continue;
    }
    const lastActivityAt = runtime.clientLastActivityAtById.get(clientId) ?? 0;
    if (lastActivityAt > 0 && isClientIdleExpired(lastActivityAt, now, idleTimeoutMs)) {
      try {
        client.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'idle_timeout');
      } catch {
        // Best effort cleanup; stale sockets may already be detached remotely.
      }
      changed = dropClientState(runtime, clientId, 'idle_timeout') || changed;
      continue;
    }
    const awaiting = runtime.awaitingChallenge.get(clientId);
    if (!awaiting) continue;
    const handshakeActivityAt = lastActivityAt > 0 ? lastActivityAt : awaiting.queuedAt;
    if (!isClientStaleForHandshake(handshakeActivityAt, awaiting.queuedAt, now, ttlMs)) {
      continue;
    }
    try {
      client.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'stale_handshake_timeout');
    } catch {
      // Best effort cleanup; stale sockets may already be detached remotely.
    }
    changed = dropClientState(runtime, clientId, 'stale_handshake_timeout') || changed;
  }
  if (!changed) return;
  if (runtime.clients.size === 0) {
    runtime.pendingChallenge = null;
    sendControlToBridge(runtime, 'client_disconnected', { count: 0 });
    return;
  }
  sendControlToBridge(runtime, 'client_count', { count: runtime.clients.size });
}

export function dropClientState(runtime: RelayRuntime, clientId: string, reason: string): boolean {
  if (!runtime.clients.has(clientId)) return false;
  runtime.clients.delete(clientId);
  runtime.clientLastActivityAtById.delete(clientId);
  runtime.connectStartAtByClientId.delete(clientId);
  runtime.pendingConnectStarts.delete(clientId);
  runtime.awaitingChallenge.delete(clientId);
  for (const [reqId, reqClientId] of runtime.connectReqClientByReqId.entries()) {
    if (reqClientId === clientId) {
      runtime.connectReqClientByReqId.delete(reqId);
    }
  }
  for (const [reqId, reqClientId] of runtime.requestClientByReqId.entries()) {
    if (reqClientId === clientId) {
      runtime.requestClientByReqId.delete(reqId);
    }
  }
  if (runtime.activeClientId === clientId) {
    runtime.activeClientId = null;
    for (const [nextClientId, nextClient] of runtime.clients.entries()) {
      if (nextClient.readyState === WebSocket.OPEN) {
        runtime.activeClientId = nextClientId;
        break;
      }
    }
  }
  if (runtime.challengeClientId === clientId) {
    runtime.challengeClientId = resolveAwaitingChallengeClientId({
      awaitingChallenge: Array.from(runtime.awaitingChallenge.values()),
      openClientIds: Array.from(runtime.clients.entries())
        .filter(([, client]) => client.readyState === WebSocket.OPEN)
        .map(([nextClientId]) => nextClientId),
      preferredClientId: null,
      activeClientId: runtime.activeClientId,
    });
  }
  logRelayTelemetry('hermes_relay_worker', 'client_pruned', {
    reason,
    clientCount: runtime.clients.size,
  });
  return true;
}
