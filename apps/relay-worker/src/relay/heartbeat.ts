import {
  CLIENT_PONG_CAPABILITY,
  CONNECT_START_BUFFER_TTL_MS,
  GATEWAY_PING_TIMEOUT_DEFAULT_MS,
  SOCKET_CLOSE_CODES,
} from './types';
import {
  isAwaitingChallengeExpired,
  isClientIdleExpired,
  isClientStaleForHandshake,
  resolveAwaitingChallengeClientId,
} from './frames';
import { logRuntimeTelemetry } from './telemetry';
import type { RelayRuntime } from './runtime';
import { parsePositiveInt } from './utils';
import { sendControlToGateway } from './control';

export async function ensureHeartbeat(runtime: RelayRuntime): Promise<void> {
  const interval = parsePositiveInt(runtime.env.HEARTBEAT_INTERVAL_MS, runtime.policy.heartbeatIntervalMs);
  if (!hasOpenClients(runtime)) {
    await runtime.state.storage.deleteAlarm();
    return;
  }
  const now = Date.now();
  let nextAlarmAt = now + interval;
  if (runtime.policy.watchdog !== 'none' && runtime.pendingGatewayPingAt > 0) {
    const timeoutMs = parsePositiveInt(
      runtime.env.GATEWAY_PING_TIMEOUT_MS,
      runtime.policy.gatewayPingTimeoutMs ?? GATEWAY_PING_TIMEOUT_DEFAULT_MS,
    );
    nextAlarmAt = Math.min(nextAlarmAt, runtime.pendingGatewayPingAt + timeoutMs);
  }
  await runtime.state.storage.setAlarm(nextAlarmAt);
}

export function hasOpenClients(runtime: RelayRuntime): boolean {
  for (const ws of runtime.clients.values()) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  if (runtime.policy.securePairing) {
    for (const ws of runtime.pairingClients.values()) {
      if (ws.readyState === WebSocket.OPEN) return true;
    }
  }
  return false;
}

export function reconcileGatewayLiveness(runtime: RelayRuntime, now: number): void {
  if (runtime.policy.watchdog === 'none') return;
  const gateway = runtime.gatewaySocket;
  if (!gateway || gateway.readyState !== WebSocket.OPEN || !hasOpenClients(runtime)) {
    runtime.pendingGatewayPingAt = 0;
    runtime.gatewayPingCapability = gateway && gateway.readyState === WebSocket.OPEN
      ? runtime.gatewayPingCapability
      : 'unknown';
    return;
  }

  if (runtime.gatewayPingCapability === 'unsupported') {
    runtime.pendingGatewayPingAt = 0;
    return;
  }

  const timeoutMs = parsePositiveInt(
    runtime.env.GATEWAY_PING_TIMEOUT_MS,
    runtime.policy.gatewayPingTimeoutMs ?? GATEWAY_PING_TIMEOUT_DEFAULT_MS,
  );
  if (runtime.pendingGatewayPingAt > 0) {
    if (runtime.gatewayLastActivityAt >= runtime.pendingGatewayPingAt) {
      runtime.pendingGatewayPingAt = 0;
      return;
    }
    if (now - runtime.pendingGatewayPingAt < timeoutMs) return;
    runtime.pendingGatewayPingAt = 0;
    if (runtime.gatewayPingCapability !== 'supported') {
      runtime.gatewayPingCapability = 'unsupported';
      logRuntimeTelemetry(runtime, 'gateway_ping_unsupported_assumed', {
        clientCount: runtime.clients.size,
        hasBridge: true,
        timeoutMs,
      });
      return;
    }
    logRuntimeTelemetry(runtime, 'gateway_ping_timeout', {
      clientCount: runtime.clients.size,
      hasBridge: true,
      timeoutMs,
      bridgeIdleMs: runtime.gatewayLastActivityAt > 0 ? Math.max(0, now - runtime.gatewayLastActivityAt) : null,
    });
    try {
      gateway.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'stale_gateway_timeout');
    } catch {
      // Best effort cleanup; stale sockets may already be detached remotely.
    }
    return;
  }

  runtime.pendingGatewayPingAt = now;
  sendControlToGateway(runtime, 'gateway_ping', { ts: now });
  logRuntimeTelemetry(runtime, 'gateway_ping_sent', {
    clientCount: runtime.clients.size,
    hasBridge: true,
  });
}

export function prunePendingConnectStarts(runtime: RelayRuntime, now: number): void {
  for (const [clientId, pending] of runtime.pendingConnectStarts.entries()) {
    if (now - pending.queuedAt <= CONNECT_START_BUFFER_TTL_MS) continue;
    runtime.pendingConnectStarts.delete(clientId);
    logRuntimeTelemetry(runtime, 'connect_start_buffer_expired', {
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
      if (reqClientId === clientId) runtime.connectReqClientByReqId.delete(reqId);
    }
    if (runtime.challengeClientId === clientId) runtime.challengeClientId = null;
    logRuntimeTelemetry(runtime, 'awaiting_challenge_expired', {
      queuedMs: Math.max(0, now - entry.queuedAt),
      ttlMs,
      clientCount: runtime.clients.size,
    });
  }
}

export function pruneStaleHandshakeClients(runtime: RelayRuntime, now: number): void {
  let changed = false;
  const ttlMs = runtime.awaitingChallengeTtlMs();
  const pongTimeoutMs = runtime.clientPongTimeoutMs();
  for (const [clientId, client] of runtime.clients.entries()) {
    if (client.readyState !== WebSocket.OPEN) {
      changed = dropClientState(runtime, clientId, 'non_open_ready_state') || changed;
      continue;
    }
    const attachment = client.deserializeAttachment() as {
      connectedAt?: number;
      capabilities?: string[];
      lastPongAt?: number;
      challengeDeliveredAt?: number;
    } | null;
    const supportsClientPong = attachment?.capabilities?.includes(CLIENT_PONG_CAPABILITY) === true;
    const lastPongAt = attachment?.lastPongAt ?? attachment?.connectedAt ?? 0;
    if (supportsClientPong && lastPongAt > 0 && isClientIdleExpired(lastPongAt, now, pongTimeoutMs)) {
      try {
        client.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'client_pong_timeout');
      } catch {
        // Best effort cleanup; stale sockets may already be detached remotely.
      }
      changed = dropClientState(runtime, clientId, 'client_pong_timeout') || changed;
      continue;
    }
    const challengeDeliveredAt = attachment?.challengeDeliveredAt ?? 0;
    if (challengeDeliveredAt > 0 && now - challengeDeliveredAt > ttlMs) {
      try {
        client.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'stale_handshake_timeout');
      } catch {
        // Best effort cleanup; stale sockets may already be detached remotely.
      }
      changed = dropClientState(runtime, clientId, 'stale_handshake_timeout') || changed;
      continue;
    }
    const lastActivityAt = runtime.clientLastActivityAtById.get(clientId) ?? 0;
    const awaiting = runtime.awaitingChallenge.get(clientId);
    if (!awaiting) continue;
    const handshakeActivityAt = lastActivityAt > 0 ? lastActivityAt : awaiting.queuedAt;
    if (!isClientStaleForHandshake(handshakeActivityAt, awaiting.queuedAt, now, ttlMs)) continue;
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
    sendControlToGateway(runtime, 'client_disconnected', { count: 0 });
    return;
  }
  sendControlToGateway(runtime, 'client_count', { count: runtime.clients.size });
}

export function dropClientState(runtime: RelayRuntime, clientId: string, reason: string): boolean {
  if (!runtime.clients.has(clientId)) return false;
  runtime.clients.delete(clientId);
  runtime.clientLastActivityAtById.delete(clientId);
  runtime.connectStartAtByClientId.delete(clientId);
  runtime.pendingConnectStarts.delete(clientId);
  runtime.awaitingChallenge.delete(clientId);
  for (const [reqId, reqClientId] of runtime.connectReqClientByReqId.entries()) {
    if (reqClientId === clientId) runtime.connectReqClientByReqId.delete(reqId);
  }
  for (const [reqId, reqClientId] of runtime.requestClientByReqId.entries()) {
    if (reqClientId === clientId) runtime.requestClientByReqId.delete(reqId);
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
  logRuntimeTelemetry(runtime, 'client_pruned', {
    reason,
    clientCount: runtime.clients.size,
  });
  return true;
}
