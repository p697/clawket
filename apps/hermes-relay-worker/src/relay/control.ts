import {
  CONTROL_PREFIX,
  SOCKET_CLOSE_CODES,
  type RelayControlEnvelope,
  type SocketAttachment,
} from './types';
import { logRelayTelemetry } from './telemetry';
import type { RelayRuntime } from './runtime';

export function replaceBridge(runtime: RelayRuntime, nextGateway: WebSocket): void {
  if (runtime.bridgeSocket
    && runtime.bridgeSocket !== nextGateway
    && runtime.bridgeSocket.readyState === WebSocket.OPEN) {
    runtime.pendingChallenge = null;
    runtime.bridgeSocket.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_BRIDGE, 'replaced_by_new_bridge');
  }
  runtime.bridgeSocket = nextGateway;
}

export function parseControlEnvelope(text: string): RelayControlEnvelope | null {
  if (!text.startsWith(CONTROL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(CONTROL_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as RelayControlEnvelope;
  } catch {
    return null;
  }
}

export function serializeControlEnvelope(envelope: RelayControlEnvelope): string {
  return `${CONTROL_PREFIX}${JSON.stringify(envelope)}`;
}

function normalizeControlEvent(envelope: RelayControlEnvelope): string | null {
  return typeof envelope.event === 'string' && envelope.event.trim()
    ? envelope.event.trim()
    : null;
}

export function sendControlToBridge(
  runtime: RelayRuntime,
  event: string,
  payload?: Record<string, unknown>,
): void {
  if (!runtime.bridgeSocket || runtime.bridgeSocket.readyState !== WebSocket.OPEN) return;
  runtime.bridgeSocket.send(serializeControlEnvelope({
    type: 'control',
    event,
    ...(payload ?? {}),
  }));
  logRelayTelemetry('hermes_relay_worker', 'control_sent', {
    controlEvent: event,
    count: payload?.count,
    clientCount: runtime.clients.size,
  });
}

export function logControlRoutingTelemetry(
  runtime: RelayRuntime,
  event: string,
  attachment: SocketAttachment,
  envelope: RelayControlEnvelope,
  extra: Record<string, unknown> = {},
): void {
  logRelayTelemetry('hermes_relay_worker', event, {
    role: attachment.role,
    controlEvent: normalizeControlEvent(envelope),
    hasSourceClient: typeof envelope.sourceClientId === 'string' && envelope.sourceClientId.trim().length > 0,
    hasTargetClient: typeof envelope.targetClientId === 'string' && envelope.targetClientId.trim().length > 0,
    clientCount: runtime.clients.size,
    ...extra,
  });
}
