import { CONTROL_PREFIX, type RelayControlEnvelope, type SocketAttachment } from './types';
import {
  isConnectChallengeFrame,
  isConnectStartReqFrame,
  isPendingChallengeExpired,
  parseConnectReqId,
  parseRequestFrame,
  parseResponseId,
  resolveAwaitingChallengeClientId,
} from './frames';
import { logRelayTelemetry } from './telemetry';
import type { RelayRuntime } from './runtime';
import { touchClientActivity, touchBridgeActivity } from './runtime';
import { prunePendingConnectStarts } from './heartbeat';
import {
  logControlRoutingTelemetry,
  parseControlEnvelope,
  sendControlToBridge,
  serializeControlEnvelope,
} from './control';
import { parsePositiveInt } from './utils';
import { SOCKET_CLOSE_CODES } from './types';

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
  logRelayTelemetry('hermes_relay_worker', 'challenge_delivered', payload);
  return true;
}

export function flushPendingChallenge(runtime: RelayRuntime, now: number): boolean {
  const pending = runtime.pendingChallenge;
  if (!pending) return false;
  if (runtime.awaitingChallenge.size === 0) {
    logRelayTelemetry('hermes_relay_worker', 'challenge_buffer_dropped_without_awaiting_client', {
      role: 'gateway',
      queuedMs: Math.max(0, now - pending.queuedAt),
      clientCount: runtime.clients.size,
    });
    runtime.pendingChallenge = null;
    return false;
  }
  const currentGatewayAttachment = runtime.bridgeSocket?.deserializeAttachment() as SocketAttachment | null;
  if (!currentGatewayAttachment
    || currentGatewayAttachment.role !== 'gateway'
    || currentGatewayAttachment.clientId !== pending.bridgeClientId) {
    logRelayTelemetry('hermes_relay_worker', 'challenge_buffer_dropped_stale_gateway', {
      role: 'gateway',
      bridgeReplaced: true,
      queuedMs: Math.max(0, now - pending.queuedAt),
    });
    runtime.pendingChallenge = null;
    return false;
  }
  if (isPendingChallengeExpired(pending.queuedAt, now)) {
    logRelayTelemetry('hermes_relay_worker', 'challenge_buffer_expired', {
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
    clientId: pending.bridgeClientId,
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
    bridgeClientId: gatewayAttachment.clientId,
    traceId: gatewayAttachment.traceId,
  };
  logRelayTelemetry('hermes_relay_worker', 'challenge_buffered_no_client', {
    role: 'gateway',
    hasActiveClient: Boolean(runtime.activeClientId),
    hasChallengeClient: Boolean(runtime.challengeClientId),
    awaitingChallengeCount: runtime.awaitingChallenge.size,
    clientCount: runtime.clients.size,
  });
}

export function flushPendingConnectStarts(runtime: RelayRuntime): void {
  if (!runtime.bridgeSocket || runtime.bridgeSocket.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  prunePendingConnectStarts(runtime, now);

  let flushed = 0;
  for (const [clientId, pending] of runtime.pendingConnectStarts.entries()) {
    const client = runtime.clients.get(clientId);
    if (!client || client.readyState !== WebSocket.OPEN) {
      runtime.pendingConnectStarts.delete(clientId);
      continue;
    }
    runtime.bridgeSocket.send(pending.data);
    runtime.connectStartAtByClientId.set(clientId, pending.queuedAt);
    markAwaitingChallenge(runtime, clientId, pending.queuedAt);
    runtime.pendingConnectStarts.delete(clientId);
    flushed += 1;
    logRelayTelemetry('hermes_relay_worker', 'connect_start_flushed', {
      role: 'client',
      queuedMs: Math.max(0, now - pending.queuedAt),
    });
  }

  if (flushed > 0) {
    logRelayTelemetry('hermes_relay_worker', 'connect_start_flush_done', {
      flushed,
      remaining: runtime.pendingConnectStarts.size,
      clientCount: runtime.clients.size,
    });
  }
}

export async function handleBridgeMessage(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
  touchBridgeOwner: (bridgeId: string) => Promise<void>,
): Promise<void> {
  await touchBridgeOwner(attachment.clientId);
  touchBridgeActivity(runtime);
  if (text.startsWith(CONTROL_PREFIX)) {
    const gatewayControl = parseControlEnvelope(text);
    if (gatewayControl) {
      routeGatewayControl(runtime, attachment, gatewayControl);
    } else {
      logRelayTelemetry('hermes_relay_worker', 'bridge_control_invalid', {
        role: 'gateway',
        clientCount: runtime.clients.size,
      });
    }
    return;
  }
  if (isConnectChallengeFrame(text)) {
    logRelayTelemetry('hermes_relay_worker', 'challenge_forward', {
      role: 'gateway',
      clientCount: runtime.clients.size,
    });
    forwardGatewayChallengeFastPath(runtime, text, attachment);
    return;
  }
  const connectResId = parseResponseId(text);
  if (connectResId) {
    const mappedClientId = runtime.requestClientByReqId.get(connectResId);
    if (mappedClientId) {
      const mappedClient = runtime.clients.get(mappedClientId);
      runtime.requestClientByReqId.delete(connectResId);
      if (mappedClient?.readyState === WebSocket.OPEN) {
        mappedClient.send(text);
        touchClientActivity(runtime, mappedClientId);
        logRelayTelemetry('hermes_relay_worker', 'request_response_delivered', {
          role: 'gateway',
          targetClientId: mappedClientId,
          clientCount: runtime.clients.size,
        });
        return;
      }
      logRelayTelemetry('hermes_relay_worker', 'request_response_target_missing', {
        role: 'gateway',
        targetClientId: mappedClientId,
        clientCount: runtime.clients.size,
      });
    }
    const targetClientId = runtime.connectReqClientByReqId.get(connectResId);
    if (targetClientId) {
      const targetClient = runtime.clients.get(targetClientId);
      if (targetClient?.readyState === WebSocket.OPEN) {
        targetClient.send(text);
        touchClientActivity(runtime, targetClientId);
        logRelayTelemetry('hermes_relay_worker', 'connect_response_delivered', {
          role: 'gateway',
          matchedRequest: true,
        });
        runtime.connectReqClientByReqId.delete(connectResId);
        return;
      }
      logRelayTelemetry('hermes_relay_worker', 'connect_response_target_missing', {
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
    logRelayTelemetry('hermes_relay_worker', 'bridge_message_dropped_without_active_client', {
      role: 'gateway',
      hasBridge: true,
      clientCount: runtime.clients.size,
    });
  }
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
    const targetClient = runtime.clients.get(targetClientId);
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
    runtime.activeClientId = clientId;
  }
  if (!runtime.challengeClientId) {
    runtime.challengeClientId = clientId;
  }
  if (wasEmpty) {
    sendControlToBridge(runtime, 'client_connected', { count: runtime.clients.size });
  } else {
    sendControlToBridge(runtime, 'client_count', { count: runtime.clients.size });
  }
}

export function handleBridgeConnected(runtime: RelayRuntime): void {
  sendControlToBridge(runtime, 'gateway_connected');
  sendControlToBridge(runtime, 'client_count', { count: runtime.clients.size });
  flushPendingConnectStarts(runtime);
}

export function handleInactiveClientMessage(runtime: RelayRuntime, attachment: SocketAttachment): boolean {
  if (runtime.activeClientId !== attachment.clientId) {
    logRelayTelemetry('hermes_relay_worker', 'inactive_client_message_dropped', {
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
      runtime.activeClientId = attachment.clientId;
      logRelayTelemetry('hermes_relay_worker', 'active_client_switched', {
        role: 'client',
        reason: 'connect_start',
      });
    }
    if (runtime.challengeClientId === attachment.clientId) {
      runtime.challengeClientId = null;
    }
  } else {
    if (requestFrame) {
      runtime.requestClientByReqId.set(requestFrame.id, attachment.clientId);
    }
    if (runtime.activeClientId !== attachment.clientId) {
      runtime.activeClientId = attachment.clientId;
      logRelayTelemetry('hermes_relay_worker', 'active_client_switched', {
        role: 'client',
        reason: requestFrame ? `request:${requestFrame.method}` : 'client_message',
      });
    }
  }
  return isConnectStart;
}

export function forwardClientMessageToBridge(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
  isConnectStart: boolean,
): void {
  if (!runtime.bridgeSocket || runtime.bridgeSocket.readyState !== WebSocket.OPEN) return;
  if (isConnectStart) {
    const queuedAt = Date.now();
    runtime.connectStartAtByClientId.set(attachment.clientId, queuedAt);
    markAwaitingChallenge(runtime, attachment.clientId, queuedAt);
    const connectReqId = parseConnectReqId(text);
    if (connectReqId) {
      runtime.connectReqClientByReqId.set(connectReqId, attachment.clientId);
    }
    logRelayTelemetry('hermes_relay_worker', 'connect_start_forward', {
      role: 'client',
      hasRequestId: Boolean(connectReqId),
      clientCount: runtime.clients.size,
    });
  }
  runtime.bridgeSocket.send(text);
}

export function rejectClientRequestWithoutBridge(
  runtime: RelayRuntime,
  ws: WebSocket,
  attachment: SocketAttachment,
  text: string,
): boolean {
  const frame = parseRequestFrame(text);
  if (!frame || isConnectStartReqFrame(text)) {
    return false;
  }

  const response = JSON.stringify({
    type: 'res',
    id: frame.id,
    ok: false,
    error: {
      code: 'BRIDGE_UNAVAILABLE',
      message: 'Hermes bridge is temporarily unavailable. Please retry.',
    },
  });

  try {
    ws.send(response);
    touchClientActivity(runtime, attachment.clientId);
  } catch {
    // Best effort error delivery; closing below still prompts the client to reconnect.
  }

  try {
    ws.close(SOCKET_CLOSE_CODES.BRIDGE_UNAVAILABLE, 'bridge_unavailable');
  } catch {
    // Ignore close errors; the socket may already be detached remotely.
  }

  logRelayTelemetry('hermes_relay_worker', 'client_request_rejected_no_bridge', {
    role: 'client',
    method: frame.method,
    clientCount: runtime.clients.size,
  });
  return true;
}

export function forwardClientControlToBridge(
  runtime: RelayRuntime,
  attachment: SocketAttachment,
  text: string,
): void {
  const envelope = parseControlEnvelope(text);
  if (!envelope) {
    logRelayTelemetry('hermes_relay_worker', 'client_control_invalid', {
      role: 'client',
      clientCount: runtime.clients.size,
    });
    return;
  }

  if (!runtime.bridgeSocket || runtime.bridgeSocket.readyState !== WebSocket.OPEN) {
    logControlRoutingTelemetry(runtime, 'client_control_no_gateway', attachment, envelope);
    return;
  }

  const gatewayAttachment = runtime.bridgeSocket.deserializeAttachment() as SocketAttachment | null;
  const forwardedEnvelope: RelayControlEnvelope = {
    ...envelope,
    type: typeof envelope.type === 'string' && envelope.type.trim() ? envelope.type : 'control',
    sourceClientId: attachment.clientId,
  };
  runtime.bridgeSocket.send(serializeControlEnvelope(forwardedEnvelope));
  logControlRoutingTelemetry(runtime, 'client_control_forwarded', attachment, forwardedEnvelope, {
    bridgeClientId: gatewayAttachment?.clientId ?? null,
  });
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
  logRelayTelemetry('hermes_relay_worker', 'connect_start_no_bridge', {
    role: 'client',
    hasRequestId: Boolean(connectReqId),
    clientCount: runtime.clients.size,
    pendingCount: runtime.pendingConnectStarts.size,
  });
}
