import {
  errorResponse,
  isSecurePairingSecretConfigured,
  jsonResponse,
  parseHermesRelayAuthQuery,
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
import {
  dropClientState,
  ensureHeartbeat,
  pruneExpiredAwaitingChallenges,
  prunePendingConnectStarts,
  pruneStaleHandshakeClients,
  reconcileGatewayLiveness,
} from './relay/heartbeat';
import {
  HERMES_BACKEND_POLICY,
  OPENCLAW_BACKEND_POLICY,
  policyForBackend,
  roomNamespace,
  routesKv,
} from './backend-policy';
import { RelayRuntime, touchClientActivity, touchGatewayActivity } from './relay/runtime';
import {
  allowMessage,
  acknowledgeClientPong,
  bufferClientConnectStart,
  clearClientChallengeMarker,
  flushPendingChallenge,
  forwardClientControlToGateway,
  forwardClientMessageToGateway,
  forwardPairingControlToGateway,
  handleClientConnected,
  handleGatewayConnected,
  handleGatewayMessage,
  prepareClientMessage,
  rejectClientRequestWithoutBridge,
} from './relay/routing';
import { replaceBridge, replaceGateway, sendControlToGateway } from './relay/control';
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
import { logRuntimeTelemetry } from './relay/telemetry';
import { parsePositiveInt } from './relay/utils';
import {
  CONTROL_PREFIX,
  CLIENT_PONG_CAPABILITY,
  SOCKET_CLOSE_CODES,
  type BackendPolicy,
  type Env,
  type SocketAttachment,
} from './relay/types';

type NormalizedRelayQuery = {
  principalId: string;
  role: 'gateway' | 'client';
  clientId?: string;
  token?: string;
};

function parseBackendQuery(url: URL, policy: BackendPolicy): NormalizedRelayQuery {
  if (policy.backend === 'hermes') {
    const query = parseHermesRelayAuthQuery(url);
    return { principalId: query.bridgeId, role: query.role, clientId: query.clientId, token: query.token };
  }
  const query = parseRelayAuthQuery(url);
  return { principalId: query.gatewayId, role: query.role, clientId: query.clientId, token: query.token };
}

function invalidPrincipalResponse(policy: BackendPolicy): Response {
  const noun = policy.principalParam;
  return errorResponse(`INVALID_${noun === 'gatewayId' ? 'GATEWAY' : 'BRIDGE'}_ID`, `${noun} is required`, 400);
}

function toTraceHint(traceId: string | null | undefined): string | undefined {
  const trimmed = traceId?.trim();
  return trimmed ? trimmed.slice(-8) : undefined;
}

async function fetchForPolicy(request: Request, env: Env, policy: BackendPolicy): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/v1/health') {
    if (!policy.securePairing) return jsonResponse({ ok: true, runtime: 'durable-object' });
    return jsonResponse({
      ok: true,
      runtime: 'durable-object',
      capabilities: isSecurePairingSecretConfigured(env.PAIRING_TICKET_SECRET)
        ? [SECURE_PAIRING_V2_CAPABILITY]
        : [],
    });
  }

  if (request.method === 'POST' && url.pathname === policy.internalRoutes.clientTokens) {
    if (!hasValidPairingSyncSecret(request, env.PAIRING_SYNC_SECRET)) {
      return errorResponse('UNAUTHORIZED', 'Invalid internal sync secret', 401);
    }
    const body = await readJson<Record<string, unknown>>(request);
    const rawPrincipal = body?.[policy.principalParam];
    const principalId = typeof rawPrincipal === 'string' ? rawPrincipal.trim() : '';
    if (!principalId) return invalidPrincipalResponse(policy);
    const namespace = roomNamespace(env, policy);
    return namespace.get(namespace.idFromName(principalId)).fetch(new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    }));
  }

  if (policy.internalRoutes.bridgeStatus
    && request.method === 'GET'
    && url.pathname === policy.internalRoutes.bridgeStatus) {
    const principalId = url.searchParams.get(policy.principalParam)?.trim() ?? '';
    if (!principalId) return invalidPrincipalResponse(policy);
    const namespace = roomNamespace(env, policy);
    return namespace.get(namespace.idFromName(principalId)).fetch(new Request(request.url, {
      method: request.method,
      headers: request.headers,
    }));
  }

  if (url.pathname !== '/ws') return errorResponse('NOT_FOUND', 'Route not found', 404);
  const query = parseBackendQuery(url, policy);
  if (!query.principalId) return invalidPrincipalResponse(policy);
  if (!request.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
    return errorResponse('UPGRADE_REQUIRED', 'Expected websocket upgrade', 426);
  }
  const namespace = roomNamespace(env, policy);
  return namespace.get(namespace.idFromName(query.principalId)).fetch(request);
}

export default {
  async fetch(request, env): Promise<Response> {
    return fetchForPolicy(request, env, policyForBackend(env.RELAY_BACKEND));
  },
} satisfies ExportedHandler<Env>;

class BaseRelayRoom {
  private readonly runtime: RelayRuntime;

  constructor(state: DurableObjectState, env: Env, policy: BackendPolicy) {
    this.runtime = new RelayRuntime(state, env, policy);
    this.runtime.state.blockConcurrencyWhile(async () => {
      await loadRoomMeta(this.runtime);
      await loadMirroredClientTokenHashes(this.runtime);
      await loadGatewayOwner(this.runtime);
      rehydrateSockets(this.runtime);
      await ensureHeartbeat(this.runtime);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const { policy } = this.runtime;
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === policy.internalRoutes.clientTokens) {
      const body = await readJson<Record<string, unknown>>(request);
      const rawPrincipal = body?.[policy.principalParam];
      const principalId = typeof rawPrincipal === 'string' ? rawPrincipal.trim() : '';
      if (!principalId) return invalidPrincipalResponse(policy);
      await storeRoomMeta(this.runtime, principalId);
      await storeMirroredClientTokenHashes(
        this.runtime,
        Array.isArray(body?.clientTokenHashes)
          ? body.clientTokenHashes.filter((item): item is string => typeof item === 'string')
          : [],
        typeof body?.updatedAt === 'number' ? body.updatedAt : Date.now(),
      );
      logRuntimeTelemetry(this.runtime, 'client_token_hashes_synced', {
        tokenCount: this.runtime.mirroredClientTokenHashes.size,
      });
      return jsonResponse({ ok: true });
    }

    if (policy.internalRoutes.bridgeStatus
      && request.method === 'GET'
      && url.pathname === policy.internalRoutes.bridgeStatus) {
      return this.fetchHermesBridgeStatus(request, url);
    }
    if (url.pathname !== '/ws') return errorResponse('NOT_FOUND', 'Route not found', 404);
    if (!request.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
      return errorResponse('UPGRADE_REQUIRED', 'Expected websocket upgrade', 426);
    }

    const query = parseBackendQuery(url, policy);
    const traceId = (url.searchParams.get('traceId') ?? '').trim() || undefined;
    if (!query.principalId) return invalidPrincipalResponse(policy);
    await storeRoomMeta(this.runtime, query.principalId);
    const { token, authSource } = resolveRelayAuthToken(query.token, request);
    if (!token) {
      logRuntimeTelemetry(this.runtime, 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'missing_token',
      });
      return errorResponse('UNAUTHORIZED', 'Missing token for relay connection', 401);
    }
    const authorization = await authorizeRelayToken({
      routesKv: routesKv(this.runtime.env, policy),
      registryVerifyUrl: this.runtime.env.REGISTRY_VERIFY_URL,
      principalId: query.principalId,
      policy,
      role: query.role,
      token,
      mirroredClientTokenHashes: this.runtime.mirroredClientTokenHashes,
      pairingTicketSecret: this.runtime.env.PAIRING_TICKET_SECRET,
    });
    if (!authorization.authorized) {
      logRuntimeTelemetry(this.runtime, 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'invalid_token',
      });
      return errorResponse('UNAUTHORIZED', 'Invalid token for relay connection', 401);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const ownerClientId = query.role === 'gateway'
      ? (query.clientId || `legacy-${(await sha256Hex(token)).slice(0, 16)}`)
      : '';
    if (query.role === 'gateway') {
      const leaseMs = parsePositiveInt(this.runtime.env.GATEWAY_OWNER_LEASE_MS, policy.ownerLeaseMs);
      if (!canAcceptGatewayOwner(this.runtime, ownerClientId, Date.now(), leaseMs)) {
        logRuntimeTelemetry(this.runtime, policy.ownerLockedEvent, {
          role: query.role,
          [policy.ownerPresentField]: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
          ...(policy.traceHints ? { traceHint: toTraceHint(traceId) } : {}),
        });
        return errorResponse('GATEWAY_OWNER_LOCKED', policy.ownerLockedMessage, 409);
      }
    }

    const clientId = query.role === 'gateway' ? ownerClientId : (query.clientId || crypto.randomUUID());
    const attachment: SocketAttachment = {
      role: query.role,
      clientId,
      connectedAt: Date.now(),
      traceId,
      clientLabel: query.role === 'client' ? authorization.clientLabel : null,
      ...(policy.securePairing ? {
        authScope: authorization.authScope,
        ...(authorization.pairingSessionId ? { pairingSessionId: authorization.pairingSessionId } : {}),
        ...(authorization.ticketExpiresAt ? { ticketExpiresAt: authorization.ticketExpiresAt } : {}),
      } : {}),
      ...(query.role === 'client' && parseCapabilities(url).includes(CLIENT_PONG_CAPABILITY)
        ? { capabilities: [CLIENT_PONG_CAPABILITY], lastPongAt: Date.now() }
        : {}),
    };

    // Keep the constructor-rehydrated map intact until the public replacement
    // branch has closed the previous peer with the backend-specific reason.
    this.runtime.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    if (query.role === 'gateway') {
      replaceGateway(this.runtime, server);
      touchGatewayActivity(this.runtime, attachment.connectedAt);
      await touchGatewayOwner(this.runtime, clientId, true);
      handleGatewayConnected(this.runtime);
    } else if (policy.securePairing && authorization.authScope === 'pairing') {
      const previousClient = this.runtime.pairingClients.get(clientId);
      if (previousClient && previousClient !== server && previousClient.readyState === WebSocket.OPEN) {
        previousClient.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, 'replaced_by_new_pairing_socket');
      }
      this.runtime.pairingClients.set(clientId, server);
    } else {
      const previousClient = this.runtime.clients.get(clientId);
      if (previousClient && previousClient !== server && previousClient.readyState === WebSocket.OPEN) {
        previousClient.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, 'replaced_by_new_client_socket');
        logRuntimeTelemetry(this.runtime, 'client_socket_replaced', {
          role: query.role,
          clientCount: this.runtime.clients.size,
        });
      }
      handleClientConnected(this.runtime, clientId, server);
    }

    logRuntimeTelemetry(this.runtime, 'ws_connected', {
      role: query.role,
      authSource,
      authPath: authorization.path,
      clientCount: this.runtime.clients.size,
      [policy.ownerPresentField]: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
      ...(policy.traceHints ? { traceHint: toTraceHint(traceId) } : {}),
    });
    void ensureHeartbeat(this.runtime);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const text = normalizeMessage(message);
    if (text == null) return;

    if (this.runtime.policy.securePairing && attachment.authScope === 'pairing') {
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
      await handleGatewayMessage(this.runtime, attachment, text, (ownerClientId) =>
        touchGatewayOwner(this.runtime, ownerClientId));
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
      return;
    }
    rejectClientRequestWithoutBridge(this.runtime, ws, attachment, text);
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
    reconcileGatewayLiveness(this.runtime, now);
    const flushedChallenge = flushPendingChallenge(this.runtime, now);
    const deadClients: Array<{ clientId: string; socket: WebSocket }> = [];
    const expiredPairingClients: Array<{ clientId: string; socket: WebSocket }> = [];

    if (this.runtime.policy.securePairing) {
      for (const [clientId, client] of this.runtime.pairingClients.entries()) {
        const attachment = client.deserializeAttachment() as SocketAttachment | null;
        if (client.readyState === WebSocket.OPEN && (attachment?.ticketExpiresAt ?? 0) > now) continue;
        expiredPairingClients.push({ clientId, socket: client });
      }
      for (const { clientId, socket } of expiredPairingClients) {
        if (this.runtime.pairingClients.get(clientId) === socket) this.runtime.pairingClients.delete(clientId);
        try {
          socket.close(SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, 'pairing_ticket_expired');
        } catch {
          // Best effort cleanup; expired sockets may already be detached remotely.
        }
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

    logRuntimeTelemetry(this.runtime, 'alarm_tick', {
      clientCount: this.runtime.clients.size,
      [this.runtime.policy.ownerPresentField]: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
      hasPendingChallenge: Boolean(this.runtime.pendingChallenge),
      awaitingChallengeCount: this.runtime.awaitingChallenge.size,
      flushedChallenge,
      deadClientsRemoved: removedDeadClients,
      ...(this.runtime.policy.securePairing ? { pairingClientsExpired: expiredPairingClients.length } : {}),
    });
    await ensureHeartbeat(this.runtime);
  }

  private async fetchHermesBridgeStatus(request: Request, url: URL): Promise<Response> {
    const { policy } = this.runtime;
    const principalId = url.searchParams.get(policy.principalParam)?.trim() ?? '';
    if (!principalId) return invalidPrincipalResponse(policy);
    const { token } = resolveRelayAuthToken(undefined, request);
    if (!token) return errorResponse('UNAUTHORIZED', 'Missing token for relay bridge status', 401);
    await storeRoomMeta(this.runtime, principalId);
    const authorized = await isRelayTokenAuthorized({
      routesKv: routesKv(this.runtime.env, policy),
      registryVerifyUrl: this.runtime.env.REGISTRY_VERIFY_URL,
      principalId,
      policy,
      role: 'gateway',
      token,
      mirroredClientTokenHashes: this.runtime.mirroredClientTokenHashes,
    });
    if (!authorized) return errorResponse('UNAUTHORIZED', 'Invalid token for relay bridge status', 401);
    reconcileSockets(this.runtime);
    return jsonResponse({
      ok: true,
      bridgeId: principalId,
      hasBridge: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
      clientCount: this.runtime.clients.size,
    });
  }

  private async removeSocket(ws: WebSocket, reason: 'close' | 'error'): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const { policy } = this.runtime;

    if (attachment.role === 'gateway') {
      if (policy.watchdog !== 'none') {
        this.runtime.pendingGatewayPingAt = 0;
        this.runtime.gatewayPingCapability = 'unknown';
      }
      if (this.runtime.gatewaySocket === ws) {
        this.runtime.gatewaySocket = null;
        this.runtime.pendingChallenge = null;
        await touchGatewayOwner(this.runtime, attachment.clientId, true);
        const clients = policy.securePairing
          ? [...this.runtime.clients.values(), ...this.runtime.pairingClients.values()]
          : this.runtime.clients.values();
        for (const client of clients) {
          try {
            client.close(SOCKET_CLOSE_CODES.GATEWAY_UNAVAILABLE, policy.ownerUnavailableReason);
          } catch {
            // Best effort cleanup; clients may already be detached remotely.
          }
        }
      }
    } else if (policy.securePairing && attachment.authScope === 'pairing') {
      if (this.runtime.pairingClients.get(attachment.clientId) === ws) {
        this.runtime.pairingClients.delete(attachment.clientId);
      }
    } else {
      const wasCurrentClientMapping = this.runtime.clients.get(attachment.clientId) === ws;
      if (wasCurrentClientMapping) dropClientState(this.runtime, attachment.clientId, `socket_${reason}`);
      if (shouldEmitClientControlAfterSocketEvent(wasCurrentClientMapping)) {
        if (this.runtime.clients.size === 0) {
          this.runtime.pendingChallenge = null;
          sendControlToGateway(this.runtime, 'client_disconnected', { count: 0 });
        } else {
          sendControlToGateway(this.runtime, 'client_count', { count: this.runtime.clients.size });
        }
      }
    }

    logRuntimeTelemetry(this.runtime, 'ws_disconnected', {
      role: attachment.role,
      reason,
      clientCount: this.runtime.clients.size,
      [policy.ownerPresentField]: Boolean(this.runtime.gatewaySocket?.readyState === WebSocket.OPEN),
      ...(policy.traceHints ? {
        traceHint: toTraceHint(attachment.traceId),
        socketAgeMs: Date.now() - attachment.connectedAt,
      } : {}),
    });
    await ensureHeartbeat(this.runtime);
  }
}

export class RelayRoom extends BaseRelayRoom {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, OPENCLAW_BACKEND_POLICY);
  }
}

export class HermesRelayRoom extends BaseRelayRoom {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, HERMES_BACKEND_POLICY);
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
  reconcileGatewayLiveness,
  rehydrateSockets,
  reconcileSockets,
  replaceGateway,
  replaceBridge,
  BackendPolicy: {
    openclaw: OPENCLAW_BACKEND_POLICY,
    hermes: HERMES_BACKEND_POLICY,
  },
  SocketCloseCode: {
    IDLE_OR_STALE_TIMEOUT: SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT,
    DEAD_SOCKET: SOCKET_CLOSE_CODES.DEAD_SOCKET,
    BRIDGE_UNAVAILABLE: SOCKET_CLOSE_CODES.BRIDGE_UNAVAILABLE,
  },
};
