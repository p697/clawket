import {
  CLIENT_PONG_CAPABILITY,
  CONTROL_PREFIX,
  SOCKET_CLOSE_CODES,
  type RelayControlEnvelope,
  type SocketAttachment,
} from './types';
import {
  isConnectChallengeFrame,
  isConnectStartReqFrame,
  isPendingChallengeExpired,
  parseConnectReqId,
  parseRequestFrame,
  parseResponseId,
  resolveAwaitingChallengeClientId,
} from './frames';
import { logRuntimeTelemetry } from './telemetry';
import type { RelayRuntime } from './runtime';
import { selectActiveClient, touchClientActivity, touchGatewayActivity } from './runtime';
import { dropClientState, ensureHeartbeat, prunePendingConnectStarts } from './heartbeat';
import {
  logControlRoutingTelemetry,
  parseControlEnvelope,
  sendControlToGateway,
  serializeControlEnvelope,
} from './control';
import { parsePositiveInt } from './utils';

export function allowMessage(
  runtime: RelayRuntime,
  ws: WebSocket,
  attachment: SocketAttachment,
  text: string,
): boolean {
  if (attachment.role === 'gateway') {
    return true;
  }

  if (isConnectStartReqFrame(text)) {
    return true;
  }

  const fallback = parsePositiveInt(runtime.env.MAX_MESSAGES_PER_10S, 120);
  const max = parsePositiveInt(runtime.env.MAX_CLIENT_MESSAGES_PER_10S, Math.max(300, fallback));
  const now = Date.now();
  const existing = runtime.rate.get(ws);
  if (!existing) {
    runtime.rate.set(ws, { windowStart: now, count: 1 });
    return true;
  }

  if (now - existing.windowStart >= 10_000) {
    existing.windowStart = now;
    existing.count = 1;
    return true;
  }

  existing.count += 1;
  return existing.count <= max;
}

export function markAwaitingChallenge(runtime: RelayRuntime, clientId: string, queuedAt: number): void {
  const existing = runtime.awaitingChallenge.get(clientId);
  if (existing && existing.queuedAt <= queuedAt) {
    return;
  }
  runtime.awaitingChallenge.set(clientId, { clientId, queuedAt });
}

export function resolveChallengeClientId(runtime: RelayRuntime, now: number): string | null {
  const awaitingClientId = resolveAwaitingChallengeClientId({
    awaitingChallenge: Array.from(runtime.awaitingChallenge.values()),
    openClientIds: Array.from(runtime.clients.entries())
      .filter(([, client]) => client.readyState === WebSocket.OPEN)
      .map(([clientId]) => clientId),
    preferredClientId: runtime.challengeClientId,
    activeClientId: runtime.activeClientId,
    now,
  });
  if (awaitingClientId) {
    runtime.challengeClientId = awaitingClientId;
    return awaitingClientId;
  }

  const preferredClientId = runtime.challengeClientId ?? runtime.activeClientId;
  if (preferredClientId) {
    const preferredClient = runtime.clients.get(preferredClientId);
    if (preferredClient?.readyState === WebSocket.OPEN) {
      if (runtime.challengeClientId !== preferredClientId) {
        runtime.challengeClientId = preferredClientId;
      }
      return preferredClientId;
    }
  }

  for (const [clientId, client] of runtime.clients.entries()) {
    if (client.readyState !== WebSocket.OPEN) continue;
    runtime.challengeClientId = clientId;
    return clientId;
  }

  runtime.challengeClientId = null;
  return null;
}

export function tryDeliverChallenge(
  runtime: RelayRuntime,
  data: string,
  gatewayAttachment: SocketAttachment,
  now: number,
  buffered: boolean,
): boolean {
  const challengeClientId = resolveChallengeClientId(runtime, now);
  const challengeClient = challengeClientId ? runtime.clients.get(challengeClientId) : null;
  if (!challengeClientId || challengeClient?.readyState !== WebSocket.OPEN) {
    return false;
  }

  challengeClient.send(data);
  const challengeAttachment = challengeClient.deserializeAttachment() as SocketAttachment | null;
  if (challengeAttachment) {
    challengeAttachment.challengeDeliveredAt = now;
    challengeClient.serializeAttachment(challengeAttachment);
  }
  touchClientActivity(runtime, challengeClientId);
  runtime.awaitingChallenge.delete(challengeClientId);
  const connectStartAt = runtime.connectStartAtByClientId.get(challengeClientId);
  const payload: Record<string, unknown> = {
    role: 'gateway',
    buffered,
    awaitingChallengeCount: runtime.awaitingChallenge.size,
    clientCount: runtime.clients.size,
  };
  if (typeof connectStartAt === 'number') {
    payload.relayLegMs = Math.max(0, now - connectStartAt);
    runtime.connectStartAtByClientId.delete(challengeClientId);
  }
  payload.diagnosticId = challengeAttachment?.diagnosticId;
  logRuntimeTelemetry(runtime, 'challenge_delivered', payload);
  return true;
}

export function flushPendingChallenge(runtime: RelayRuntime, now: number): boolean {
  const pending = runtime.pendingChallenge;
  if (!pending) return false;
  const pendingOwnerClientId = pending[runtime.policy.pendingOwnerField];
  if (runtime.awaitingChallenge.size === 0) {
    logRuntimeTelemetry(runtime, 'challenge_buffer_dropped_without_awaiting_client', {
      role: 'gateway',
      queuedMs: Math.max(0, now - pending.queuedAt),
      clientCount: runtime.clients.size,
    });
    runtime.pendingChallenge = null;
    return false;
  }
  const currentGatewayAttachment = runtime.gatewaySocket?.deserializeAttachment() as SocketAttachment | null;
  if (!currentGatewayAttachment
    || currentGatewayAttachment.role !== 'gateway'
    || currentGatewayAttachment.clientId !== pendingOwnerClientId) {
    logRuntimeTelemetry(runtime, 'challenge_buffer_dropped_stale_gateway', {
      role: 'gateway',
      [runtime.policy.ownerReplacedField]: true,
      queuedMs: Math.max(0, now - pending.queuedAt),
    });
    runtime.pendingChallenge = null;
    return false;
  }
  if (isPendingChallengeExpired(pending.queuedAt, now)) {
    logRuntimeTelemetry(runtime, 'challenge_buffer_expired', {
      role: 'gateway',
      queuedMs: Math.max(0, now - pending.queuedAt),
      awaitingChallengeCount: runtime.awaitingChallenge.size,
      clientCount: runtime.clients.size,
    });
    runtime.pendingChallenge = null;
    return false;
  }
  if (tryDeliverChallenge(runtime, pending.data, {
    role: 'gateway',
    clientId: pendingOwnerClientId ?? '',
    connectedAt: pending.queuedAt,
    traceId: pending.traceId,
  }, now, true)) {
    runtime.pendingChallenge = null;
    return true;
  }
  return false;
}

export function forwardGatewayChallengeFastPath(
  runtime: RelayRuntime,
  text: string,
  gatewayAttachment: SocketAttachment,
): void {
  const now = Date.now();
  if (tryDeliverChallenge(runtime, text, gatewayAttachment, now, false)) {
    runtime.pendingChallenge = null;
    return;
  }
  runtime.pendingChallenge = {
    data: text,
    queuedAt: now,
    [runtime.policy.pendingOwnerField]: gatewayAttachment.clientId,
    traceId: gatewayAttachment.traceId,
  };
  logRuntimeTelemetry(runtime, 'challenge_buffered_no_client', {
    role: 'gateway',
    hasActiveClient: Boolean(runtime.activeClientId),
    hasChallengeClient: Boolean(runtime.challengeClientId),
    awaitingChallengeCount: runtime.awaitingChallenge.size,
    clientCount: runtime.clients.size,
  });
}

export function flushPendingConnectStarts(runtime: RelayRuntime): void {
  if (!runtime.gatewaySocket || runtime.gatewaySocket.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  prunePendingConnectStarts(runtime, now);

  let flushed = 0;
  for (const [clientId, pending] of runtime.pendingConnectStarts.entries()) {
    const client = runtime.clients.get(clientId);
    if (!client || client.readyState !== WebSocket.OPEN) {
      runtime.pendingConnectStarts.delete(clientId);
      continue;
    }
    runtime.gatewaySocket.send(pending.data);
    runtime.connectStartAtByClientId.set(clientId, pending.queuedAt);
    markAwaitingChallenge(runtime, clientId, pending.queuedAt);
    runtime.pendingConnectStarts.delete(clientId);
    flushed += 1;
    logRuntimeTelemetry(runtime, 'connect_start_flushed', {
      role: 'client',
      queuedMs: Math.max(0, now - pending.queuedAt),
    });
  }

  if (flushed > 0) {
    logRuntimeTelemetry(runtime, 'connect_start_flush_done', {
      flushed,
      remaining: runtime.pendingConnectStarts.size,
      clientCount: runtime.clients.size,
    });
  }
}

export async function handleGatewayMessage(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
  touchGatewayOwner: (gatewayId: string) => Promise<void>,
): Promise<void> {
  await touchGatewayOwner(attachment.clientId);
  touchGatewayActivity(runtime);
  if (text.startsWith(CONTROL_PREFIX)) {
    const gatewayControl = parseControlEnvelope(text);
    if (gatewayControl) {
      if (runtime.policy.watchdog !== 'none' && gatewayControl.event === 'gateway_pong') {
        runtime.pendingGatewayPingAt = 0;
        runtime.gatewayPingCapability = 'supported';
        logRuntimeTelemetry(runtime, 'gateway_pong_received', {
          role: 'gateway',
          clientCount: runtime.clients.size,
        });
        await ensureHeartbeat(runtime, { resetDeadline: true });
        return;
      }
      if (runtime.policy.reconnectClientsOnOwnerRequest
        && gatewayControl.event === 'client.reconnect-required') {
        disconnectClientsForGatewayRestart(runtime);
        return;
      }
      routeGatewayControl(runtime, attachment, gatewayControl);
    } else {
      logRuntimeTelemetry(runtime, runtime.policy.ownerControlInvalidEvent, {
        role: 'gateway',
        clientCount: runtime.clients.size,
      });
    }
    return;
  }
  if (isConnectChallengeFrame(text)) {
    logRuntimeTelemetry(runtime, 'challenge_forward', {
      role: 'gateway',
      clientCount: runtime.clients.size,
    });
    forwardGatewayChallengeFastPath(runtime, text, attachment);
    return;
  }
  const connectResId = parseResponseId(text);
  if ((runtime.policy.backend === 'local-model' || runtime.policy.backend === 'pi') && !connectResId) {
    // These backends own their session state. Stream updates reach every
    // fully paired device; temporary pairing-ticket sockets are kept separate.
    let event: { type?: string; event?: string };
    try { event = JSON.parse(text); } catch { return; }
    if (event?.type !== 'event' || event.event !== `${runtime.policy.backend}.update`) return;
    for (const [clientId, client] of runtime.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(text);
      touchClientActivity(runtime, clientId);
    }
    return;
  }
  if (connectResId) {
    if (runtime.policy.routeRequestsByOrigin) {
      const mappedClientId = runtime.requestClientByReqId.get(connectResId);
      if (mappedClientId) {
        const mappedClient = runtime.clients.get(mappedClientId);
        runtime.requestClientByReqId.delete(connectResId);
        if (mappedClient?.readyState === WebSocket.OPEN) {
          mappedClient.send(text);
          touchClientActivity(runtime, mappedClientId);
          logRuntimeTelemetry(runtime, 'request_response_delivered', {
            role: 'gateway',
            targetClientId: mappedClientId,
            clientCount: runtime.clients.size,
          });
          return;
        }
        logRuntimeTelemetry(runtime, 'request_response_target_missing', {
          role: 'gateway',
          targetClientId: mappedClientId,
          clientCount: runtime.clients.size,
        });
      }
    }
    const targetClientId = runtime.connectReqClientByReqId.get(connectResId);
    if (targetClientId) {
      const targetClient = runtime.clients.get(targetClientId);
      if (targetClient?.readyState === WebSocket.OPEN) {
        targetClient.send(text);
        touchClientActivity(runtime, targetClientId);
        logRuntimeTelemetry(runtime, 'connect_response_delivered', {
          diagnosticId: (targetClient.deserializeAttachment() as SocketAttachment | null)?.diagnosticId,
          role: 'gateway',
          matchedRequest: true,
        });
        runtime.connectReqClientByReqId.delete(connectResId);
        return;
      }
      logRuntimeTelemetry(runtime, 'connect_response_target_missing', {
        role: 'gateway',
        matchedRequest: true,
      });
      runtime.connectReqClientByReqId.delete(connectResId);
    }
  }
  let delivered = 0;
  const activeClient = runtime.activeClientId ? runtime.clients.get(runtime.activeClientId) : null;
  if (activeClient?.readyState === WebSocket.OPEN) {
    activeClient.send(text);
    touchClientActivity(runtime, runtime.activeClientId!);
    delivered = 1;
  }
  if (delivered === 0) {
    logRuntimeTelemetry(runtime, runtime.policy.ownerMessageDroppedEvent, {
      role: 'gateway',
      [runtime.policy.ownerPresentField]: true,
      clientCount: runtime.clients.size,
    });
  }
}

export const handleBridgeMessage = handleGatewayMessage;

function disconnectClientsForGatewayRestart(runtime: RelayRuntime): void {
  let disconnected = 0;
  for (const [clientId, client] of Array.from(runtime.clients.entries())) {
    try {
      client.close(SOCKET_CLOSE_CODES.GATEWAY_RECONNECT_REQUIRED, 'gateway_reconnect_required');
    } catch {
      // Best effort cleanup; the client may already be detached remotely.
    }
    if (dropClientState(runtime, clientId, 'gateway_reconnect_required')) disconnected += 1;
  }
  runtime.pendingChallenge = null;
  sendControlToGateway(runtime, 'client_disconnected', { count: 0 });
  logRuntimeTelemetry(runtime, 'clients_reconnect_required', {
    role: 'gateway',
    disconnected,
  });
}

function routeGatewayControl(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  envelope: RelayControlEnvelope,
): void {
  const targetClientId = typeof envelope.targetClientId === 'string' && envelope.targetClientId.trim()
    ? envelope.targetClientId.trim()
    : null;

  if (targetClientId) {
    const targetClient = runtime.clients.get(targetClientId)
      ?? (runtime.policy.securePairing ? runtime.pairingClients.get(targetClientId) : undefined);
    if (targetClient?.readyState === WebSocket.OPEN) {
      targetClient.send(serializeControlEnvelope(envelope));
      touchClientActivity(runtime, targetClientId);
      logControlRoutingTelemetry(runtime, 'gateway_control_target_delivered', attachment, envelope);
      return;
    }
    logControlRoutingTelemetry(runtime, 'gateway_control_target_missing', attachment, envelope);
    return;
  }

  const activeClientId = runtime.activeClientId;
  const activeClient = activeClientId ? runtime.clients.get(activeClientId) : null;
  if (activeClientId && activeClient?.readyState === WebSocket.OPEN) {
    activeClient.send(serializeControlEnvelope(envelope));
    touchClientActivity(runtime, activeClientId);
    logControlRoutingTelemetry(runtime, 'gateway_control_delivered', attachment, envelope);
    return;
  }

  logControlRoutingTelemetry(runtime, 'gateway_control_no_active_client', attachment, envelope);
}

export function handleClientConnected(runtime: RelayRuntime, clientId: string, server: WebSocket): void {
  const wasEmpty = runtime.clients.size === 0;
  runtime.clients.set(clientId, server);
  touchClientActivity(runtime, clientId);
  if (!runtime.activeClientId) {
    selectActiveClient(runtime, clientId);
  }
  if (!runtime.challengeClientId) {
    runtime.challengeClientId = clientId;
  }
  if (wasEmpty) {
    sendControlToGateway(runtime, 'client_connected', { count: runtime.clients.size });
  } else {
    sendControlToGateway(runtime, 'client_count', { count: runtime.clients.size });
  }
}

export function handleGatewayConnected(runtime: RelayRuntime): void {
  sendControlToGateway(runtime, 'gateway_connected');
  sendControlToGateway(runtime, 'client_count', { count: runtime.clients.size });
  flushPendingConnectStarts(runtime);
}

export const handleBridgeConnected = handleGatewayConnected;

export function handleInactiveClientMessage(runtime: RelayRuntime, attachment: SocketAttachment): boolean {
  if (runtime.activeClientId !== attachment.clientId) {
    logRuntimeTelemetry(runtime, 'inactive_client_message_dropped', {
      role: 'client',
      reason: 'non_connect_before_active',
    });
    return true;
  }
  return false;
}

export function prepareClientMessage(runtime: RelayRuntime, attachment: SocketAttachment, text: string): boolean | null {
  const isConnectStart = isConnectStartReqFrame(text);
  const requestFrame = parseRequestFrame(text);
  if (isConnectStart) {
    if (runtime.activeClientId !== attachment.clientId) {
      selectActiveClient(runtime, attachment.clientId);
      logRuntimeTelemetry(runtime, 'active_client_switched', {
        role: 'client',
        reason: 'connect_start',
      });
    }
    if (runtime.challengeClientId === attachment.clientId) {
      runtime.challengeClientId = null;
    }
  } else if (runtime.policy.routeRequestsByOrigin) {
    if (requestFrame) runtime.requestClientByReqId.set(requestFrame.id, attachment.clientId);
    if (runtime.activeClientId !== attachment.clientId) {
      selectActiveClient(runtime, attachment.clientId);
      logRuntimeTelemetry(runtime, 'active_client_switched', {
        role: 'client',
        reason: requestFrame ? `request:${requestFrame.method}` : 'client_message',
      });
    }
  } else if (handleInactiveClientMessage(runtime, attachment)) {
    return null;
  }
  return isConnectStart;
}

export function acknowledgeClientPong(
  runtime: RelayRuntime,
  ws: WebSocket,
  attachment: SocketAttachment,
  text: string,
): boolean {
  if (!attachment.capabilities?.includes(CLIENT_PONG_CAPABILITY)) return false;
  let parsed: { type?: unknown; ts?: unknown };
  try {
    parsed = JSON.parse(text) as { type?: unknown; ts?: unknown };
  } catch {
    return false;
  }
  if (parsed.type !== 'pong' || typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts)) {
    return false;
  }
  const now = Date.now();
  attachment.lastPongAt = now;
  ws.serializeAttachment(attachment);
  touchClientActivity(runtime, attachment.clientId, now);
  return true;
}

export function clearClientChallengeMarker(ws: WebSocket, attachment: SocketAttachment): void {
  if (!attachment.challengeDeliveredAt) return;
  const current = ws.deserializeAttachment() as SocketAttachment | null;
  if (!current) return;
  delete current.challengeDeliveredAt;
  ws.serializeAttachment(current);
}

export function forwardClientMessageToGateway(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
  isConnectStart: boolean,
): void {
  if (!runtime.gatewaySocket || runtime.gatewaySocket.readyState !== WebSocket.OPEN) return;
  if (isConnectStart) {
    const queuedAt = Date.now();
    runtime.connectStartAtByClientId.set(attachment.clientId, queuedAt);
    markAwaitingChallenge(runtime, attachment.clientId, queuedAt);
    const connectReqId = parseConnectReqId(text);
    if (connectReqId) {
      runtime.connectReqClientByReqId.set(connectReqId, attachment.clientId);
    }
    logRuntimeTelemetry(runtime, 'connect_start_forward', {
      diagnosticId: attachment.diagnosticId,
      sinceSocketOpenMs: Math.max(0, queuedAt - attachment.connectedAt),
      role: 'client',
      hasRequestId: Boolean(connectReqId),
      clientCount: runtime.clients.size,
    });
  }
  runtime.gatewaySocket.send(text);
}

export const forwardClientMessageToBridge = forwardClientMessageToGateway;

export function rejectClientRequestWithoutBridge(
  runtime: RelayRuntime,
  ws: WebSocket,
  attachment: SocketAttachment,
  text: string,
): boolean {
  if (!runtime.policy.rejectRequestWithoutOwner) return false;
  const frame = parseRequestFrame(text);
  if (!frame || isConnectStartReqFrame(text)) return false;

  const response = JSON.stringify({
    type: 'res',
    id: frame.id,
    ok: false,
    error: {
      code: 'BRIDGE_UNAVAILABLE',
      message: `${runtime.policy.backend === 'pi' ? 'Pi' : 'Hermes'} bridge is temporarily unavailable. Please retry.`,
    },
  });
  try {
    ws.send(response);
    touchClientActivity(runtime, attachment.clientId);
  } catch {
    // Best effort error delivery; the client may retry on the same socket.
  }
  logRuntimeTelemetry(runtime, 'client_request_rejected_no_bridge', {
    role: 'client',
    method: frame.method,
    clientCount: runtime.clients.size,
  });
  return true;
}

export function forwardClientControlToGateway(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
): void {
  const envelope = parseControlEnvelope(text);
  if (!envelope) {
    logRuntimeTelemetry(runtime, 'client_control_invalid', {
      role: 'client',
      clientCount: runtime.clients.size,
    });
    return;
  }

  if (!runtime.gatewaySocket || runtime.gatewaySocket.readyState !== WebSocket.OPEN) {
    logControlRoutingTelemetry(runtime, 'client_control_no_gateway', attachment, envelope);
    return;
  }

  const gatewayAttachment = runtime.gatewaySocket.deserializeAttachment() as SocketAttachment | null;
  const forwardedEnvelope: RelayControlEnvelope = {
    ...envelope,
    type: typeof envelope.type === 'string' && envelope.type.trim() ? envelope.type : 'control',
    sourceClientId: attachment.clientId,
  };
  runtime.gatewaySocket.send(serializeControlEnvelope(forwardedEnvelope));
  logControlRoutingTelemetry(runtime, 'client_control_forwarded', attachment, forwardedEnvelope, {
    [runtime.policy.pendingOwnerField]: gatewayAttachment?.clientId ?? null,
  });
}

export const forwardClientControlToBridge = forwardClientControlToGateway;

export function forwardPairingControlToGateway(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
): boolean {
  const envelope = parseControlEnvelope(text);
  if (!envelope || envelope.event !== 'pairing.secure.start') return false;
  const payload = envelope.payload as Record<string, unknown> | undefined;
  if (!payload
    || typeof payload !== 'object'
    || payload.sessionId !== attachment.pairingSessionId) {
    return false;
  }
  if (!runtime.gatewaySocket || runtime.gatewaySocket.readyState !== WebSocket.OPEN) {
    logControlRoutingTelemetry(runtime, 'pairing_control_no_gateway', attachment, envelope);
    return true;
  }
  runtime.gatewaySocket.send(serializeControlEnvelope({
    ...envelope,
    type: 'control',
    sourceClientId: attachment.clientId,
  }));
  logControlRoutingTelemetry(runtime, 'pairing_control_forwarded', attachment, envelope);
  return true;
}

export function bufferClientConnectStart(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
): void {
  const queuedAt = Date.now();
  markAwaitingChallenge(runtime, attachment.clientId, queuedAt);
  const connectReqId = parseConnectReqId(text);
  if (connectReqId) {
    runtime.connectReqClientByReqId.set(connectReqId, attachment.clientId);
  }
  runtime.pendingConnectStarts.set(attachment.clientId, {
    clientId: attachment.clientId,
    data: text,
    queuedAt,
    traceId: attachment.traceId,
  });
  prunePendingConnectStarts(runtime, queuedAt);
  logRuntimeTelemetry(runtime, runtime.policy.connectStartMissingEvent, {
    role: 'client',
    hasRequestId: Boolean(connectReqId),
    clientCount: runtime.clients.size,
    pendingCount: runtime.pendingConnectStarts.size,
  });
}
