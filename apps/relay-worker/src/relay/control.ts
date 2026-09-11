import { hasClientChannels, syncClientChannels } from './client-channels';
import { RELAY_FRAME_LIMIT_V2 } from '@clawket/shared';
import {
  CONTROL_PREFIX,
  SOCKET_CLOSE_CODES,
  type RelayControlEnvelope,
  type SocketAttachment,
} from './types';
import { logRuntimeTelemetry } from './telemetry';
import type { RelayRuntime } from './runtime';

export function replaceGateway(runtime: RelayRuntime, nextGateway: WebSocket): void {
  if (runtime.gatewaySocket
    && runtime.gatewaySocket !== nextGateway
    && runtime.gatewaySocket.readyState === WebSocket.OPEN) {
    runtime.pendingChallenge = null;
    for (const channel of runtime.state.getWebSockets()) {
      if ((channel.deserializeAttachment() as SocketAttachment | null)?.targetConnectionId) channel.close(1012, 'owner_replaced');
    }
    runtime.gatewaySocket.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_GATEWAY, runtime.policy.ownerReplacedReason);
  }
  runtime.gatewaySocket = nextGateway;
  if (runtime.policy.watchdog !== 'none') {
    runtime.pendingGatewayPingAt = 0;
    runtime.gatewayPingCapability = 'unknown';
  }
}

export const replaceBridge = replaceGateway;

export function parseControlEnvelope(text: string): RelayControlEnvelope | null {
  if (!text.startsWith(CONTROL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(CONTROL_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as RelayControlEnvelope;
  } catch {
    return null;
  }
}

export function serializeControlEnvelope(envelope: RelayControlEnvelope): string {
  return `${CONTROL_PREFIX}${JSON.stringify(envelope)}`;
}

export function sendRelayReady(socket: WebSocket): void {
  socket.send(serializeControlEnvelope({
    type: 'control',
    event: 'relay.ready',
    payload: { capabilities: [RELAY_FRAME_LIMIT_V2] },
  }));
}

function normalizeControlEvent(envelope: RelayControlEnvelope): string | null {
  return typeof envelope.event === 'string' && envelope.event.trim()
    ? envelope.event.trim()
    : null;
}

export function sendControlToGateway(
  runtime: RelayRuntime,
  event: string,
  payload?: Record<string, unknown>,
): void {
  if (!runtime.gatewaySocket || runtime.gatewaySocket.readyState !== WebSocket.OPEN) return;
  if (hasClientChannels(runtime) && ['client_count', 'client_connected', 'client_disconnected'].includes(event)) {
    syncClientChannels(runtime);
    return;
  }
  runtime.gatewaySocket.send(serializeControlEnvelope({
    type: 'control',
    event,
    ...(payload ?? {}),
  }));
  logRuntimeTelemetry(runtime, 'control_sent', {
    controlEvent: event,
    count: payload?.count,
    clientCount: runtime.clients.size,
  });
}

export const sendControlToBridge = sendControlToGateway;

export function logControlRoutingTelemetry(
  runtime: RelayRuntime,
  event: string,
  attachment: SocketAttachment,
  envelope: RelayControlEnvelope,
  extra: Record<string, unknown> = {},
): void {
  logRuntimeTelemetry(runtime, event, {
    role: attachment.role,
    controlEvent: normalizeControlEvent(envelope),
    hasSourceClient: typeof envelope.sourceClientId === 'string' && envelope.sourceClientId.trim().length > 0,
    hasTargetClient: typeof envelope.targetClientId === 'string' && envelope.targetClientId.trim().length > 0,
    clientCount: runtime.clients.size,
    ...extra,
  });
}
