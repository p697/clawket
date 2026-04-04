/**
 * relay-room.ts — Docker port of the RelayRoom Durable Object.
 *
 * Each instance represents a single gateway room with its own state,
 * WebSocket connections, and heartbeat lifecycle.
 */

import type { WebSocket as WsWebSocket } from 'ws';
import { parseRelayAuthQuery, resolveRelayAuthToken } from '@clawket/shared';
import { RoomState, serializeAttachment, deserializeAttachment } from './cf-shim.js';
import { RelayRuntime, touchClientActivity, touchGatewayActivity } from './relay/runtime.js';
import { isRelayTokenAuthorized, resolveClientLabelFromToken, sha256Hex } from './relay/auth.js';
import {
  isConnectChallengeFrame,
  isConnectStartReqFrame,
  isPendingChallengeExpired,
  normalizeMessage,
  resolveAwaitingChallengeClientId,
  isAwaitingChallengeExpired,
  isClientIdleExpired,
  isClientStaleForHandshake,
  shouldEmitClientControlAfterSocketEvent,
} from './relay/frames.js';
import { dropClientState, ensureHeartbeat, pruneExpiredAwaitingChallenges, prunePendingConnectStarts, pruneStaleHandshakeClients } from './relay/heartbeat.js';
import {
  allowMessage,
  bufferClientConnectStart,
  flushPendingChallenge,
  forwardClientControlToGateway,
  forwardClientMessageToGateway,
  handleClientConnected,
  handleGatewayConnected,
  handleGatewayMessage,
  prepareClientMessage,
} from './relay/routing.js';
import { replaceGateway, sendControlToGateway } from './relay/control.js';
import {
  canAcceptGatewayOwner,
  loadGatewayOwner,
  loadMirroredClientTokenHashes,
  loadRoomMeta,
  rehydrateSockets,
  reconcileSockets,
  storeRoomMeta,
  touchGatewayOwner,
} from './relay/storage.js';
import { logRelayTelemetry } from './relay/telemetry.js';
import { parsePositiveInt } from './relay/utils.js';
import {
  CONTROL_PREFIX,
  SOCKET_CLOSE_CODES,
  type Env,
  type SocketAttachment,
} from './relay/types.js';

const WS_OPEN = 1;

export class DockerRelayRoom {
  private readonly runtime: RelayRuntime;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private socketEventQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly roomId: string,
    env: Env,
  ) {
    const state = new RoomState(roomId);
    this.runtime = new RelayRuntime(state, env);
    // Set up alarm handler
    state.storage.setAlarmHandler(() => this.alarm());
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initializationPromise) {
      this.initializationPromise = (async () => {
        await loadRoomMeta(this.runtime);
        await loadMirroredClientTokenHashes(this.runtime);
        await loadGatewayOwner(this.runtime);
        rehydrateSockets(this.runtime);
        await ensureHeartbeat(this.runtime);
        this.initialized = true;
      })()
        .catch((error) => {
          this.initialized = false;
          throw error;
        })
        .finally(() => {
          this.initializationPromise = null;
        });
    }
    await this.initializationPromise;
  }

  /**
   * Handle a new WebSocket connection (after upgrade).
   */
  async handleWebSocket(
    ws: WsWebSocket,
    urlString: string,
    headers: Record<string, string>,
  ): Promise<{ accepted: boolean; status?: number; error?: string }> {
    await this.initialize();
    const url = new URL(urlString, 'http://localhost');
    const query = parseRelayAuthQuery(url);
    const traceId = (url.searchParams.get('traceId') ?? '').trim() || undefined;
    if (!query.gatewayId) {
      return { accepted: false, status: 400, error: 'gatewayId is required' };
    }

    await storeRoomMeta(this.runtime, query.gatewayId);
    const { token, authSource } = resolveRelayAuthToken(query.token, {
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    } as unknown as Request);
    if (!token) {
      logRelayTelemetry('relay_worker', 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'missing_token',
      });
      return { accepted: false, status: 401, error: 'Missing token for relay connection' };
    }

    const authorized = await isRelayTokenAuthorized({
      routesKv: this.runtime.env.ROUTES_KV,
      registryVerifyUrl: this.runtime.env.REGISTRY_VERIFY_URL,
      gatewayId: query.gatewayId,
      role: query.role,
      token,
      mirroredClientTokenHashes: this.runtime.mirroredClientTokenHashes,
    });
    if (!authorized) {
      logRelayTelemetry('relay_worker', 'ws_auth_rejected', {
        role: query.role,
        authSource,
        reason: 'invalid_token',
      });
      return { accepted: false, status: 401, error: 'Invalid token for relay connection' };
    }

    const gatewayId = query.role === 'gateway'
      ? (query.clientId || `legacy-${(await sha256Hex(token)).slice(0, 16)}`)
      : '';
    if (query.role === 'gateway') {
      const leaseMs = parsePositiveInt(this.runtime.env.GATEWAY_OWNER_LEASE_MS, 20_000);
      if (!canAcceptGatewayOwner(this.runtime, gatewayId, Date.now(), leaseMs)) {
        logRelayTelemetry('relay_worker', 'gateway_owner_locked', {
          role: query.role,
          hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WS_OPEN),
        });
        return { accepted: false, status: 409, error: 'Gateway owner is locked by another active gateway runtime' };
      }
    }

    const clientId = query.role === 'gateway' ? gatewayId : (query.clientId || crypto.randomUUID());
    const clientLabel = query.role === 'client'
      ? await resolveClientLabelFromToken(this.runtime.env.ROUTES_KV, query.gatewayId, token)
      : null;
    const attachment: SocketAttachment = {
      role: query.role,
      clientId,
      connectedAt: Date.now(),
      traceId,
      clientLabel,
    };

    // Track the socket in the room state
    this.runtime.state.acceptWebSocket(ws);
    serializeAttachment(ws, attachment);
    reconcileSockets(this.runtime, { preferredSocket: ws });

    if (query.role === 'gateway') {
      replaceGateway(this.runtime, ws);
      touchGatewayActivity(this.runtime, attachment.connectedAt);
      await touchGatewayOwner(this.runtime, clientId, true);
      handleGatewayConnected(this.runtime);
    } else {
      const previousClient = this.runtime.clients.get(clientId);
      if (previousClient && previousClient !== ws && previousClient.readyState === WS_OPEN) {
        previousClient.close(SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, 'replaced_by_new_client_socket');
        logRelayTelemetry('relay_worker', 'client_socket_replaced', {
          role: query.role,
          clientCount: this.runtime.clients.size,
        });
      }
      handleClientConnected(this.runtime, clientId, ws);
    }

    logRelayTelemetry('relay_worker', 'ws_connected', {
      role: query.role,
      authSource,
      clientCount: this.runtime.clients.size,
      hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WS_OPEN),
    });

    void ensureHeartbeat(this.runtime).catch((error) => {
      logRelayTelemetry('relay_worker', 'heartbeat_schedule_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });

    // Wire up ws event handlers
    ws.on('message', (message) => {
      void this.enqueueSocketEvent('message', () => this.onMessage(ws, message));
    });
    ws.on('close', () => {
      void this.enqueueSocketEvent('close', () => this.onClose(ws));
    });
    ws.on('error', () => {
      void this.enqueueSocketEvent('error', () => this.onError(ws));
    });

    return { accepted: true };
  }

  private enqueueSocketEvent(
    eventType: 'message' | 'close' | 'error',
    handler: () => Promise<void>,
  ): Promise<void> {
    const run = this.socketEventQueue.then(handler);
    this.socketEventQueue = run.catch((error) => {
      logRelayTelemetry('relay_worker', 'ws_event_handler_error', {
        eventType,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
    return this.socketEventQueue;
  }

  private async onMessage(ws: WsWebSocket, message: unknown): Promise<void> {
    const attachment = deserializeAttachment(ws) as SocketAttachment | null;
    if (!attachment) return;

    const text = normalizeMessage(message as string | ArrayBuffer | Buffer);
    if (text == null) return;
    if (attachment.role === 'client') {
      touchClientActivity(this.runtime, attachment.clientId);
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

    if (this.runtime.gatewaySocket?.readyState === WS_OPEN) {
      forwardClientMessageToGateway(this.runtime, attachment, text, isConnectStart);
      return;
    }

    if (isConnectStart) {
      bufferClientConnectStart(this.runtime, attachment, text);
    }
  }

  private async onClose(ws: WsWebSocket): Promise<void> {
    await this.removeSocket(ws, 'close');
  }

  private async onError(ws: WsWebSocket): Promise<void> {
    await this.removeSocket(ws, 'error');
  }

  private async alarm(): Promise<void> {
    const now = Date.now();
    pruneStaleHandshakeClients(this.runtime, now);
    pruneExpiredAwaitingChallenges(this.runtime, now);
    prunePendingConnectStarts(this.runtime, now);
    const flushedChallenge = flushPendingChallenge(this.runtime, now);
    const payload = JSON.stringify({ type: 'tick', ts: now });
    const deadClients: Array<{ clientId: string; socket: WsWebSocket }> = [];

    for (const [clientId, client] of this.runtime.clients.entries()) {
      if (client.readyState !== WS_OPEN) {
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
        // Best effort cleanup
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
      hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WS_OPEN),
      hasPendingChallenge: Boolean(this.runtime.pendingChallenge),
      awaitingChallengeCount: this.runtime.awaitingChallenge.size,
      flushedChallenge,
      deadClientsRemoved: removedDeadClients,
    });
    await ensureHeartbeat(this.runtime);
  }

  private async removeSocket(ws: WsWebSocket, reason: 'close' | 'error'): Promise<void> {
    // Remove from state tracking
    this.runtime.state.removeWebSocket(ws);

    const attachment = deserializeAttachment(ws) as SocketAttachment | null;
    if (!attachment) return;

    if (attachment.role === 'gateway') {
      if (this.runtime.gatewaySocket === ws) {
        this.runtime.gatewaySocket = null;
        this.runtime.pendingChallenge = null;
        await touchGatewayOwner(this.runtime, attachment.clientId, true);
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
      hasGateway: Boolean(this.runtime.gatewaySocket?.readyState === WS_OPEN),
    });

    await ensureHeartbeat(this.runtime);
  }

  /** Check if room has any active connections */
  get hasConnections(): boolean {
    return this.runtime.clients.size > 0 ||
      (this.runtime.gatewaySocket?.readyState === WS_OPEN) === true;
  }

  destroy(): void {
    this.runtime.state.destroy();
  }
}
