import { errorResponse, jsonResponse, parseHermesRelayAuthQuery, resolveRelayAuthToken } from '@clawket/shared';
import { isRelayTokenAuthorized, resolveClientLabelFromToken, sha256Hex } from './relay/auth';
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
import { RelayRuntime, touchClientActivity, touchBridgeActivity } from './relay/runtime';
import {
  allowMessage,
  bufferClientConnectStart,
  flushPendingChallenge,
  forwardClientControlToBridge,
  forwardClientMessageToBridge,
  handleClientConnected,
  handleBridgeConnected,
  handleBridgeMessage,
  prepareClientMessage,
  rejectClientRequestWithoutBridge,
} from './relay/routing';
import { replaceBridge, sendControlToBridge } from './relay/control';
import {
  canAcceptBridgeOwner,
  loadBridgeOwner,
  loadMirroredClientTokenHashes,
  loadRoomMeta,
  rehydrateSockets,
  reconcileSockets,
  storeMirroredClientTokenHashes,
  storeRoomMeta,
  touchBridgeOwner,
} from './relay/storage';
import { logRelayTelemetry } from './relay/telemetry';
import { parsePositiveInt } from './relay/utils';
import {
  CONTROL_PREFIX,
  SOCKET_CLOSE_CODES,
  type Env,
  type SocketAttachment,
} from './relay/types';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/v1/health') {
      return jsonResponse({ ok: true, runtime: 'durable-object' });
    }

    if (request.method === 'POST' && url.pathname === '/v1/internal/hermes/pairing/client-tokens') {
      if (!hasValidPairingSyncSecret(request, env.PAIRING_SYNC_SECRET)) {
        return errorResponse('UNAUTHORIZED', 'Invalid internal sync secret', 401);
      }
      const body = await readJson<{ bridgeId?: string }>(request);
      const bridgeId = body?.bridgeId?.trim() ?? '';
      if (!bridgeId) return errorResponse('INVALID_BRIDGE_ID', 'bridgeId is required', 400);
      const id = env.HERMES_ROOM.idFromName(bridgeId);
      const stub = env.HERMES_ROOM.get(id);
      return stub.fetch(new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      }));
    }

    if (request.method === 'GET' && url.pathname === '/v1/internal/hermes/bridge-status') {
      const bridgeId = url.searchParams.get('bridgeId')?.trim() ?? '';
      if (!bridgeId) return errorResponse('INVALID_BRIDGE_ID', 'bridgeId is required', 400);
      const id = env.HERMES_ROOM.idFromName(bridgeId);
      const stub = env.HERMES_ROOM.get(id);
      return stub.fetch(new Request(request.url, {
        method: request.method,
        headers: request.headers,
      }));
    }

    if (url.pathname !== '/ws') {
      return errorResponse('NOT_FOUND', 'Route not found', 404);
    }

    const query = parseHermesRelayAuthQuery(url);
    if (!query.bridgeId) return errorResponse('INVALID_BRIDGE_ID', 'bridgeId is required', 400);
    if (!request.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
      return errorResponse('UPGRADE_REQUIRED', 'Expected websocket upgrade', 426);
    }

    const id = env.HERMES_ROOM.idFromName(query.bridgeId);
    const stub = env.HERMES_ROOM.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class HermesRelayRoom {
  private readonly runtime: RelayRuntime;

  constructor(state: DurableObjectState, env: Env) {
    this.runtime = new RelayRuntime(state, env);
    this.runtime.state.blockConcurrencyWhile(async () => {
      await loadRoomMeta(this.runtime);
      await loadMirroredClientTokenHashes(this.runtime);
      await loadBridgeOwner(this.runtime);
      rehydrateSockets(this.runtime);
      await ensureHeartbeat(this.runtime);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/internal/hermes/pairing/client-tokens') {
      const body = await readJson<{ bridgeId?: string; clientTokenHashes?: string[]; updatedAt?: number }>(request);
      const bridgeId = body?.bridgeId?.trim() ?? '';
      if (!bridgeId) return errorResponse('INVALID_BRIDGE_ID', 'bridgeId is required', 400);
      await storeRoomMeta(this.runtime, bridgeId);
      await storeMirroredClientTokenHashes(
        this.runtime,
        Array.isArray(body?.clientTokenHashes) ? body.clientTokenHashes : [],
        typeof body?.updatedAt === 'number' ? body.updatedAt : Date.now(),
      );
      logRelayTelemetry('hermes_relay_worker', 'client_token_hashes_synced', {
        tokenCount: this.runtime.mirroredClientTokenHashes.size,
      });
      return jsonResponse({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/v1/internal/hermes/bridge-status') {
      const bridgeId = url.searchParams.get('bridgeId')?.trim() ?? '';
      if (!bridgeId) return errorResponse('INVALID_BRIDGE_ID', 'bridgeId is required', 400);
      const { token } = resolveRelayAuthToken(undefined, request);
      if (!token) {
        return errorResponse('UNAUTHORIZED', 'Missing token for relay bridge status', 401);
      }
      await storeRoomMeta(this.runtime, bridgeId);
      const authorized = await isRelayTokenAuthorized({
        routesKv: this.runtime.env.HERMES_ROUTES_KV,
        registryVerifyUrl: this.runtime.env.REGISTRY_VERIFY_URL,
        bridgeId,
        role: 'gateway',
        token,
        mirroredClientTokenHashes: this.runtime.mirroredClientTokenHashes,
      });
      if (!authorized) {
        return errorResponse('UNAUTHORIZED', 'Invalid token for relay bridge status', 401);
      }
      reconcileSockets(this.runtime);
      return jsonResponse({
        ok: true,
        bridgeId,
        hasBridge: Boolean(this.runtime.bridgeSocket?.readyState === WebSocket.OPEN),
        clientCount: this.runtime.clients.size,
      });
    }
    if (url.pathname !== '/ws') return errorResponse('NOT_FOUND', 'Route not found', 404);

    if (!request.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
      return errorResponse('UPGRADE_REQUIRED', 'Expected websocket upgrade', 426);
    }

    const query = parseHermesRelayAuthQuery(url);
    const traceId = (url.searchParams.get('traceId') ?? '').trim() || undefined;
    if (!query.bridgeId) return errorResponse('INVALID_BRIDGE_ID', 'bridgeId is required', 400);
    await storeRoomMeta(this.runtime, query.bridgeId);
    const { token, authSource } = resolveRelayAuthToken(query.token, request);
    if (!token) {
      logRelayTelemetry('hermes_relay_worker', 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'missing_token',
      });
      return errorResponse('UNAUTHORIZED', 'Missing token for relay connection', 401);
    }
    const authorized = await isRelayTokenAuthorized({
      routesKv: this.runtime.env.HERMES_ROUTES_KV,
      registryVerifyUrl: this.runtime.env.REGISTRY_VERIFY_URL,
      bridgeId: query.bridgeId,
      role: query.role,
      token,
      mirroredClientTokenHashes: this.runtime.mirroredClientTokenHashes,
    });
    if (!authorized) {
      logRelayTelemetry('hermes_relay_worker', 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'invalid_token',
      });
      return errorResponse('UNAUTHORIZED', 'Invalid token for relay connection', 401);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const bridgeId = query.role === 'gateway'
      ? (query.clientId || `legacy-${(await sha256Hex(token)).slice(0, 16)}`)
      : '';
    if (query.role === 'gateway') {
      const leaseMs = parsePositiveInt(this.runtime.env.GATEWAY_OWNER_LEASE_MS, 20_000);
      if (!canAcceptBridgeOwner(this.runtime, bridgeId, Date.now(), leaseMs)) {
        logRelayTelemetry('hermes_relay_worker', 'bridge_owner_locked', {
          role: query.role,
          hasBridge: Boolean(this.runtime.bridgeSocket?.readyState === WebSocket.OPEN),
        });
        return errorResponse('GATEWAY_OWNER_LOCKED', 'Bridge owner is locked by another active bridge runtime', 409);
      }
    }

    const clientId = query.role === 'gateway' ? bridgeId : (query.clientId || crypto.randomUUID());
    const clientLabel = query.role === 'client'
      ? await resolveClientLabelFromToken(this.runtime.env.HERMES_ROUTES_KV, query.bridgeId, token)
      : null;
    const attachment: SocketAttachment = {
      role: query.role,
      clientId,
      connectedAt: Date.now(),
      traceId,
      clientLabel,
    };

    this.runtime.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    reconcileSockets(this.runtime, { preferredSocket: server });

    if (query.role === 'gateway') {
      replaceBridge(this.runtime, server);
      touchBridgeActivity(this.runtime, attachment.connectedAt);
      await touchBridgeOwner(this.runtime, clientId, true);
      handleBridgeConnected(this.runtime);
    } else {
      const previousClient = this.runtime.clients.get(clientId);
      if (previousClient && previousClient !== server && previousClient.readyState === WebSocket.OPEN) {
        previousClient.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, 'replaced_by_new_client_socket');
        logRelayTelemetry('hermes_relay_worker', 'client_socket_replaced', {
          role: query.role,
          clientCount: this.runtime.clients.size,
        });
      }
      handleClientConnected(this.runtime, clientId, server);
    }

    logRelayTelemetry('hermes_relay_worker', 'ws_connected', {
      role: query.role,
      authSource,
      clientCount: this.runtime.clients.size,
      hasBridge: Boolean(this.runtime.bridgeSocket?.readyState === WebSocket.OPEN),
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
    if (attachment.role === 'client') {
      touchClientActivity(this.runtime, attachment.clientId);
    }
    if (!allowMessage(this.runtime, ws, attachment, text)) {
      ws.close(SOCKET_CLOSE_CODES.RATE_LIMITED, 'rate_limited');
      return;
    }

    if (attachment.role === 'gateway') {
      await handleBridgeMessage(this.runtime, attachment, text, (bridgeClientId) =>
        touchBridgeOwner(this.runtime, bridgeClientId),
      );
      return;
    }

    if (text.startsWith(CONTROL_PREFIX)) {
      forwardClientControlToBridge(this.runtime, attachment, text);
      return;
    }

    const isConnectStart = prepareClientMessage(this.runtime, attachment, text);
    if (isConnectStart == null) return;

    if (this.runtime.bridgeSocket?.readyState === WebSocket.OPEN) {
      forwardClientMessageToBridge(this.runtime, attachment, text, isConnectStart);
      return;
    }

    if (isConnectStart) {
      bufferClientConnectStart(this.runtime, attachment, text);
      return;
    }

    if (rejectClientRequestWithoutBridge(this.runtime, ws, attachment, text)) {
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.removeSocket(ws, 'close');
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
    const payload = JSON.stringify({ type: 'tick', ts: now });
    const deadClients: Array<{ clientId: string; socket: WebSocket }> = [];

    for (const [clientId, client] of this.runtime.clients.entries()) {
      if (client.readyState !== WebSocket.OPEN) {
        deadClients.push({ clientId, socket: client });
        continue;
      }
      try {
        client.send(payload);
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
        sendControlToBridge(this.runtime, 'client_disconnected', { count: 0 });
      } else {
        sendControlToBridge(this.runtime, 'client_count', { count: this.runtime.clients.size });
      }
    }

    logRelayTelemetry('hermes_relay_worker', 'alarm_tick', {
      clientCount: this.runtime.clients.size,
      hasBridge: Boolean(this.runtime.bridgeSocket?.readyState === WebSocket.OPEN),
      hasPendingChallenge: Boolean(this.runtime.pendingChallenge),
      awaitingChallengeCount: this.runtime.awaitingChallenge.size,
      flushedChallenge,
      deadClientsRemoved: removedDeadClients,
    });
    await ensureHeartbeat(this.runtime);
  }

  private async removeSocket(ws: WebSocket, reason: 'close' | 'error'): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    if (attachment.role === 'gateway') {
      if (this.runtime.bridgeSocket === ws) {
        this.runtime.bridgeSocket = null;
        this.runtime.pendingChallenge = null;
        await touchBridgeOwner(this.runtime, attachment.clientId, true);
        for (const client of this.runtime.clients.values()) {
          try {
            client.close(SOCKET_CLOSE_CODES.BRIDGE_UNAVAILABLE, 'bridge_unavailable');
          } catch {
            // Best effort cleanup; clients may already be detached remotely.
          }
        }
      }
    } else {
      const wasCurrentClientMapping = this.runtime.clients.get(attachment.clientId) === ws;
      if (wasCurrentClientMapping) {
        dropClientState(this.runtime, attachment.clientId, `socket_${reason}`);
      }
      if (shouldEmitClientControlAfterSocketEvent(wasCurrentClientMapping)) {
        if (this.runtime.clients.size === 0) {
          this.runtime.pendingChallenge = null;
          sendControlToBridge(this.runtime, 'client_disconnected', { count: 0 });
        } else {
          sendControlToBridge(this.runtime, 'client_count', { count: this.runtime.clients.size });
        }
      }
    }

    logRelayTelemetry('hermes_relay_worker', 'ws_disconnected', {
      role: attachment.role,
      reason,
      clientCount: this.runtime.clients.size,
      hasBridge: Boolean(this.runtime.bridgeSocket?.readyState === WebSocket.OPEN),
    });

    await ensureHeartbeat(this.runtime);
  }
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
  replaceBridge,
  SocketCloseCode: {
    DEAD_SOCKET: SOCKET_CLOSE_CODES.DEAD_SOCKET,
    BRIDGE_UNAVAILABLE: SOCKET_CLOSE_CODES.BRIDGE_UNAVAILABLE,
  },
};
