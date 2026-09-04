import {
  errorResponse,
  isSecurePairingSecretConfigured,
  jsonResponse,
  parseRelayAuthQuery,
  resolveRelayAuthToken,
  SECURE_PAIRING_V2_CAPABILITY,
} from '@clawket/shared';
import { authorizeRelayToken, isRelayTokenAuthorized, sha256Hex } from './relay/auth';
import {
  isAwaitingChallengeExpired,
  isClientIdleExpired,
  isClientStaleForHandshake,
  isConnectChallengeFrame,
  isConnectStartReqFrame,
  isPendingChallengeExpired,
  normalizeMessage,
  resolveAwaitingChallengeClientId,
  shouldEmitClientControlAfterSocketEvent,
} from './relay/frames';
import { dropClientState, ensureHeartbeat, pruneExpiredAwaitingChallenges, prunePendingConnectStarts, pruneStaleHandshakeClients } from './relay/heartbeat';
import { RelayRuntime, touchClientActivity, touchGatewayActivity } from './relay/runtime';
import {
  allowMessage,
  acknowledgeClientPong,
  bufferClientConnectStart,
  clearClientChallengeMarker,
  flushPendingChallenge,
  forwardClientControlToGateway,
  forwardPairingControlToGateway,
  forwardClientMessageToGateway,
  handleClientConnected,
  handleGatewayConnected,
  handleGatewayMessage,
  prepareClientMessage,
} from './relay/routing';
import { replaceGateway, sendControlToGateway } from './relay/control';
import {
  canAcceptGatewayOwner,
  loadGatewayOwner,
  loadMirroredClientTokenHashes,
  loadRoomMeta,
  rehydrateSockets,
  reconcileSockets,
  storeMirroredClientTokenHashes,
  storeRoomMeta,
  touchGatewayOwner,
} from './relay/storage';
import { logRelayTelemetry } from './relay/telemetry';
import { parsePositiveInt } from './relay/utils';
import {
  CONTROL_PREFIX,
  CLIENT_PONG_CAPABILITY,
  SOCKET_CLOSE_CODES,
  type Env,
  type SocketAttachment,
} from './relay/types';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/v1/health') {
      return jsonResponse({
        ok: true,
        runtime: 'durable-object',
        capabilities: isSecurePairingSecretConfigured(env.PAIRING_TICKET_SECRET)
          ? [SECURE_PAIRING_V2_CAPABILITY]
          : [],
      });
    }

    if (request.method === 'POST' && url.pathname === '/v1/internal/pairing/client-tokens') {
      if (!hasValidPairingSyncSecret(request, env.PAIRING_SYNC_SECRET)) {
        return errorResponse('UNAUTHORIZED', 'Invalid internal sync secret', 401);
      }
      const body = await readJson<{ gatewayId?: string }>(request);
      const gatewayId = body?.gatewayId?.trim() ?? '';
      if (!gatewayId) return errorResponse('INVALID_GATEWAY_ID', 'gatewayId is required', 400);
      const id = env.ROOM.idFromName(gatewayId);
      const stub = env.ROOM.get(id);
      return stub.fetch(new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      }));
    }

    if (url.pathname !== '/ws') {
      return errorResponse('NOT_FOUND', 'Route not found', 404);
    }

    const query = parseRelayAuthQuery(url);
    if (!query.gatewayId) return errorResponse('INVALID_GATEWAY_ID', 'gatewayId is required', 400);
    if (!request.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
      return errorResponse('UPGRADE_REQUIRED', 'Expected websocket upgrade', 426);
    }

    const id = env.ROOM.idFromName(query.gatewayId);
    const stub = env.ROOM.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class RelayRoom {
  private readonly runtime: RelayRuntime;

  constructor(state: DurableObjectState, env: Env) {
    this.runtime = new RelayRuntime(state, env);
    this.runtime.state.blockConcurrencyWhile(async () => {
      await loadRoomMeta(this.runtime);
      await loadMirroredClientTokenHashes(this.runtime);
      await loadGatewayOwner(this.runtime);
      rehydrateSockets(this.runtime);
      await ensureHeartbeat(this.runtime);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/internal/pairing/client-tokens') {
      const body = await readJson<{ gatewayId?: string; clientTokenHashes?: string[]; updatedAt?: number }>(request);
      const gatewayId = body?.gatewayId?.trim() ?? '';
      if (!gatewayId) return errorResponse('INVALID_GATEWAY_ID', 'gatewayId is required', 400);
      await storeRoomMeta(this.runtime, gatewayId);
      await storeMirroredClientTokenHashes(
        this.runtime,
        Array.isArray(body?.clientTokenHashes) ? body.clientTokenHashes : [],
        typeof body?.updatedAt === 'number' ? body.updatedAt : Date.now(),
      );
      logRelayTelemetry('relay_worker', 'client_token_hashes_synced', {
        tokenCount: this.runtime.mirroredClientTokenHashes.size,
      });
      return jsonResponse({ ok: true });
    }
    if (url.pathname !== '/ws') return errorResponse('NOT_FOUND', 'Route not found', 404);

    if (!request.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
      return errorResponse('UPGRADE_REQUIRED', 'Expected websocket upgrade', 426);
    }

    const query = parseRelayAuthQuery(url);
    const traceId = (url.searchParams.get('traceId') ?? '').trim() || undefined;
    if (!query.gatewayId) return errorResponse('INVALID_GATEWAY_ID', 'gatewayId is required', 400);
    await storeRoomMeta(this.runtime, query.gatewayId);
    const { token, authSource } = resolveRelayAuthToken(query.token, request);
    if (!token) {
      logRelayTelemetry('relay_worker', 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'missing_token',
      });
      return errorResponse('UNAUTHORIZED', 'Missing token for relay connection', 401);
    }
    const authorization = await authorizeRelayToken({
      routesKv: this.runtime.env.ROUTES_KV,
      registryVerifyUrl: this.runtime.env.REGISTRY_VERIFY_URL,
      gatewayId: query.gatewayId,
      role: query.role,
      token,
      mirroredClientTokenHashes: this.runtime.mirroredClientTokenHashes,
      pairingTicketSecret: this.runtime.env.PAIRING_TICKET_SECRET,
    });
    if (!authorization.authorized) {
      logRelayTelemetry('relay_worker', 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'invalid_token',
      });
      return errorResponse('UNAUTHORIZED', 'Invalid token for relay connection', 401);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const gatewayId = query.role === 'gateway'
      ? (query.clientId || `legacy-${(await sha256Hex(token)).slice(0, 16)}`)
      : '';
    if (query.role === 'gateway') {
      const leaseMs = parsePositiveInt(this.runtime.env.GATEWAY_OWNER_LEASE_MS, 20_000);
      if (!canAcceptGatewayOwner(this.runtime, gatewayId, Date.now(), leaseMs)) {
        logRelayTelemetry('relay_worker', 'gateway_owner_locked', {
          role: query.role,
          hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
        });
        return errorResponse('GATEWAY_OWNER_LOCKED', 'Gateway owner is locked by another active gateway runtime', 409);
      }
    }

    const clientId = query.role === 'gateway' ? gatewayId : (query.clientId || crypto.randomUUID());
    const clientLabel = query.role === 'client' ? authorization.clientLabel : null;
    const attachment: SocketAttachment = {
      role: query.role,
      clientId,
      connectedAt: Date.now(),
      traceId,
      clientLabel,
      authScope: authorization.authScope,
      ...(authorization.pairingSessionId ? { pairingSessionId: authorization.pairingSessionId } : {}),
      ...(authorization.ticketExpiresAt ? { ticketExpiresAt: authorization.ticketExpiresAt } : {}),
      ...(query.role === 'client' && parseCapabilities(url).includes(CLIENT_PONG_CAPABILITY)
        ? { capabilities: [CLIENT_PONG_CAPABILITY], lastPongAt: Date.now() }
        : {}),
    };

    this.runtime.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    reconcileSockets(this.runtime, { preferredSocket: server });

    if (query.role === 'gateway') {
      replaceGateway(this.runtime, server);
      touchGatewayActivity(this.runtime, attachment.connectedAt);
      await touchGatewayOwner(this.runtime, clientId, true);
      handleGatewayConnected(this.runtime);
    } else if (authorization.authScope === 'pairing') {
      const previousClient = this.runtime.pairingClients.get(clientId);
      if (previousClient && previousClient !== server && previousClient.readyState === WebSocket.OPEN) {
        previousClient.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, 'replaced_by_new_pairing_socket');
      }
      this.runtime.pairingClients.set(clientId, server);
    } else {
      const previousClient = this.runtime.clients.get(clientId);
      if (previousClient && previousClient !== server && previousClient.readyState === WebSocket.OPEN) {
        previousClient.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, 'replaced_by_new_client_socket');
        logRelayTelemetry('relay_worker', 'client_socket_replaced', {
          role: query.role,
          clientCount: this.runtime.clients.size,
        });
      }
      handleClientConnected(this.runtime, clientId, server);
    }

    logRelayTelemetry('relay_worker', 'ws_connected', {
      role: query.role,
      authSource,
      authPath: authorization.path,
      clientCount: this.runtime.clients.size,
      hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
    });

    void ensureHeartbeat(this.runtime);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    const text = normalizeMessage(message);
    if (text == null) return;
    if (attachment.authScope === 'pairing') {
      if ((attachment.ticketExpiresAt ?? 0) <= Date.now()
        || !allowMessage(this.runtime, ws, attachment, text)
        || !text.startsWith(CONTROL_PREFIX)
        || !forwardPairingControlToGateway(this.runtime, attachment, text)) {
        ws.close(SOCKET_CLOSE_CODES.RATE_LIMITED, 'invalid_pairing_message');
      }
      return;
    }
    if (attachment.role === 'client') {
      touchClientActivity(this.runtime, attachment.clientId);
      if (acknowledgeClientPong(this.runtime, ws, attachment, text)) return;
    }
    if (!allowMessage(this.runtime, ws, attachment, text)) {
      ws.close(SOCKET_CLOSE_CODES.RATE_LIMITED, 'rate_limited');
      return;
    }

    if (attachment.role === 'gateway') {
      await handleGatewayMessage(this.runtime, attachment, text, (gatewayClientId) =>
        touchGatewayOwner(this.runtime, gatewayClientId),
      );
      return;
    }

    if (text.startsWith(CONTROL_PREFIX)) {
      forwardClientControlToGateway(this.runtime, attachment, text);
      return;
    }

    const isConnectStart = prepareClientMessage(this.runtime, attachment, text);
    if (isConnectStart == null) return;
    if (isConnectStart) clearClientChallengeMarker(ws, attachment);

    if (this.runtime.gatewaySocket?.readyState === WebSocket.OPEN) {
      forwardClientMessageToGateway(this.runtime, attachment, text, isConnectStart);
      return;
    }

    if (isConnectStart) {
      bufferClientConnectStart(this.runtime, attachment, text);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.removeSocket(ws, 'close');
    try {
      ws.close(code, reason);
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.removeSocket(ws, 'error');
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    pruneStaleHandshakeClients(this.runtime, now);
    pruneExpiredAwaitingChallenges(this.runtime, now);
    prunePendingConnectStarts(this.runtime, now);
    const flushedChallenge = flushPendingChallenge(this.runtime, now);
    const deadClients: Array<{ clientId: string; socket: WebSocket }> = [];
    const expiredPairingClients: Array<{ clientId: string; socket: WebSocket }> = [];

    for (const [clientId, client] of this.runtime.pairingClients.entries()) {
      const attachment = client.deserializeAttachment() as SocketAttachment | null;
      if (client.readyState === WebSocket.OPEN && (attachment?.ticketExpiresAt ?? 0) > now) continue;
      expiredPairingClients.push({ clientId, socket: client });
    }

    for (const { clientId, socket } of expiredPairingClients) {
      if (this.runtime.pairingClients.get(clientId) === socket) {
        this.runtime.pairingClients.delete(clientId);
      }
      try {
        socket.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'pairing_ticket_expired');
      } catch {
        // Best effort cleanup; expired sockets may already be detached remotely.
      }
    }

    for (const [clientId, client] of this.runtime.clients.entries()) {
      if (client.readyState !== WebSocket.OPEN) {
        deadClients.push({ clientId, socket: client });
        continue;
      }
      try {
        const attachment = client.deserializeAttachment() as SocketAttachment | null;
        client.send(JSON.stringify({
          type: 'tick',
          ts: now,
          ...(attachment?.capabilities?.includes(CLIENT_PONG_CAPABILITY)
            ? { ack: CLIENT_PONG_CAPABILITY }
            : {}),
        }));
      } catch {
        deadClients.push({ clientId, socket: client });
      }
    }

    let removedDeadClients = 0;
    for (const { clientId, socket } of deadClients) {
      removedDeadClients += dropClientState(this.runtime, clientId, 'dead_socket_on_tick') ? 1 : 0;
      try {
        socket.close(SOCKET_CLOSE_CODES.DEAD_SOCKET, 'dead_socket');
      } catch {
        // Best effort cleanup; dead sockets may already be detached remotely.
      }
    }

    if (removedDeadClients > 0) {
      if (this.runtime.clients.size === 0) {
        this.runtime.pendingChallenge = null;
        sendControlToGateway(this.runtime, 'client_disconnected', { count: 0 });
      } else {
        sendControlToGateway(this.runtime, 'client_count', { count: this.runtime.clients.size });
      }
    }

    logRelayTelemetry('relay_worker', 'alarm_tick', {
      clientCount: this.runtime.clients.size,
      hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
      hasPendingChallenge: Boolean(this.runtime.pendingChallenge),
      awaitingChallengeCount: this.runtime.awaitingChallenge.size,
      flushedChallenge,
      deadClientsRemoved: removedDeadClients,
      pairingClientsExpired: expiredPairingClients.length,
    });
    await ensureHeartbeat(this.runtime);
  }

  private async removeSocket(ws: WebSocket, reason: 'close' | 'error'): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    if (attachment.role === 'gateway') {
      if (this.runtime.gatewaySocket === ws) {
        this.runtime.gatewaySocket = null;
        this.runtime.pendingChallenge = null;
        await touchGatewayOwner(this.runtime, attachment.clientId, true);
        for (const client of [...this.runtime.clients.values(), ...this.runtime.pairingClients.values()]) {
          try {
            client.close(SOCKET_CLOSE_CODES.GATEWAY_UNAVAILABLE, 'gateway_unavailable');
          } catch {
            // Best effort cleanup; clients may already be detached remotely.
          }
        }
      }
    } else if (attachment.authScope === 'pairing') {
      if (this.runtime.pairingClients.get(attachment.clientId) === ws) {
        this.runtime.pairingClients.delete(attachment.clientId);
      }
    } else {
      const wasCurrentClientMapping = this.runtime.clients.get(attachment.clientId) === ws;
      if (wasCurrentClientMapping) {
        dropClientState(this.runtime, attachment.clientId, `socket_${reason}`);
      }
      if (shouldEmitClientControlAfterSocketEvent(wasCurrentClientMapping)) {
        if (this.runtime.clients.size === 0) {
          this.runtime.pendingChallenge = null;
          sendControlToGateway(this.runtime, 'client_disconnected', { count: 0 });
        } else {
          sendControlToGateway(this.runtime, 'client_count', { count: this.runtime.clients.size });
        }
      }
    }

    logRelayTelemetry('relay_worker', 'ws_disconnected', {
      role: attachment.role,
      reason,
      clientCount: this.runtime.clients.size,
      hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
    });

    await ensureHeartbeat(this.runtime);
  }
}

function parseCapabilities(url: URL): string[] {
  return (url.searchParams.get('capabilities') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 16);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function hasValidPairingSyncSecret(request: Request, configuredSecret?: string): boolean {
  const expected = configuredSecret?.trim() ?? '';
  if (!expected) return false;
  const provided = request.headers.get('x-clawket-pairing-sync-secret')?.trim() ?? '';
  return provided.length > 0 && provided === expected;
}

export const __testing = {
  parsePositiveInt,
  normalizeMessage,
  isRelayTokenAuthorized,
  hasValidPairingSyncSecret,
  sha256Hex,
  CONTROL_PREFIX,
  isConnectStartReqFrame,
  isConnectChallengeFrame,
  isPendingChallengeExpired,
  isAwaitingChallengeExpired,
  isClientStaleForHandshake,
  isClientIdleExpired,
  shouldEmitClientControlAfterSocketEvent,
  resolveAwaitingChallengeClientId,
  handleClientConnected,
  flushPendingChallenge,
  rehydrateSockets,
  reconcileSockets,
  replaceGateway,
  SocketCloseCode: {
    DEAD_SOCKET: SOCKET_CLOSE_CODES.DEAD_SOCKET,
  },
};
