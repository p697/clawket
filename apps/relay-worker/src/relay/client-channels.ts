import { CONTROL_PREFIX, type SocketAttachment } from './types';
import type { RelayRuntime } from './runtime';
import { isConnectChallengeFrame, isConnectStartReqFrame } from './frames';
import { logRuntimeTelemetry } from './telemetry';

export const CLIENT_CHANNELS = 'bridge.client-sockets.v1';

export function hasClientChannels(runtime: RelayRuntime): boolean {
  const owner = runtime.gatewaySocket?.deserializeAttachment() as SocketAttachment | null;
  return runtime.policy.backend === 'openclaw' && !!owner?.capabilities?.includes(CLIENT_CHANNELS);
}

export function channelClient(runtime: RelayRuntime, connectionId: string): WebSocket | undefined {
  return [...runtime.clients.values()].find(socket => {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    return socket.readyState === WebSocket.OPEN && attachment?.authScope !== 'pairing'
      && attachment?.diagnosticId === connectionId;
  });
}

export function clientChannel(runtime: RelayRuntime, connectionId: string): WebSocket | undefined {
  return runtime.state.getWebSockets().find(socket => {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const owner = runtime.gatewaySocket?.deserializeAttachment() as SocketAttachment | null;
    return socket.readyState === WebSocket.OPEN && attachment?.role === 'gateway'
      && attachment.targetConnectionId === connectionId && attachment.clientId === owner?.clientId;
  });
}

export function syncClientChannels(runtime: RelayRuntime): void {
  if (!hasClientChannels(runtime)) return;
  const clients = [...runtime.clients.values()].flatMap(socket => {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    return socket.readyState === WebSocket.OPEN && attachment?.diagnosticId && attachment.authScope !== 'pairing'
      ? [attachment.diagnosticId] : [];
  });
  for (const socket of runtime.state.getWebSockets()) {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.targetConnectionId && !clients.includes(attachment.targetConnectionId)) socket.close(1000, 'client_disconnected');
  }
  runtime.gatewaySocket!.send(CONTROL_PREFIX + JSON.stringify({
    type: 'control', event: 'client.sockets', payload: { clients },
  }));
}

/** Raw frames retain the full 8 MiB budget; no multiplexing payload wrapper. */
export function routeClientChannel(runtime: RelayRuntime, ws: WebSocket, attachment: SocketAttachment, text: string): boolean {
  if (attachment.targetConnectionId) {
    if (!hasClientChannels(runtime) || clientChannel(runtime, attachment.targetConnectionId) !== ws) return true;
    const target = channelClient(runtime, attachment.targetConnectionId);
    if (!target) { ws.close(1000, 'client_disconnected'); return true; }
    if (text.startsWith(CONTROL_PREFIX)) {
      try {
        const control = JSON.parse(text.slice(CONTROL_PREFIX.length));
        if (control.event === 'client.reconnect-required') {
          target.close(1012, 'backend_session_restarted');
          return true;
        }
      } catch { return true; }
    }
    if (isConnectChallengeFrame(text)) {
      const current = target.deserializeAttachment() as SocketAttachment;
      target.serializeAttachment({ ...current, challengeDeliveredAt: Date.now() });
      logRuntimeTelemetry(runtime, 'challenge_delivered', { diagnosticId: current.diagnosticId, role: 'gateway' });
    }
    target.send(text);
    return true;
  }
  if (attachment.role !== 'client' || !hasClientChannels(runtime)) return false;
  if (runtime.clients.get(attachment.clientId) !== ws) return true;
  const channel = attachment.diagnosticId ? clientChannel(runtime, attachment.diagnosticId) : undefined;
  if (!channel) { ws.close(1013, 'backend_channel_pending'); return true; }
  if (isConnectStartReqFrame(text)) {
    const current = ws.deserializeAttachment() as SocketAttachment;
    delete current.challengeDeliveredAt;
    ws.serializeAttachment(current);
    logRuntimeTelemetry(runtime, 'connect_start_forward', { diagnosticId: attachment.diagnosticId, role: 'client' });
  }
  if (text.startsWith(CONTROL_PREFIX)) {
    try {
      const control = JSON.parse(text.slice(CONTROL_PREFIX.length));
      channel.send(CONTROL_PREFIX + JSON.stringify({ ...control, sourceClientId: attachment.clientId }));
    } catch { /* Invalid control frames cannot become Gateway requests. */ }
  } else channel.send(text);
  return true;
}
