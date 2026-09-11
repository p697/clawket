import nacl from 'tweetnacl';
import {
  resolveCapabilities,
  type ConnectionRecord,
} from '@clawket/agent-protocol';
import {
  hexToBytes,
  bytesToBase64Url,
  buildDeviceAuthPayload,
  normalizeWsUrl,
  generateId,
  ensureIdentity,
} from './gateway-auth';
import { StorageService, type DeviceTokenStorageScope } from './storage';
import { getEnabledNodeCaps, getEnabledNodeCommands } from './node-invoke-dispatcher';
import {
  DEFAULT_NODE_CAPABILITY_TOGGLES,
  NodeCapabilityToggles,
} from './node-capabilities';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import { getRuntimeClientId, getRuntimeDeviceFamily, getRuntimePlatform } from '../utils/platform';
import {
  assertWebSocketFrameWithinLimit,
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  getWebSocketFrameByteLength,
  WEBSOCKET_FRAME_LIMIT_BYTES,
  WebSocketFrameTooLargeError,
} from './websocket-frame-limit';
import {
  buildRelayClientWsUrl,
  RELAY_CLIENT_PONG_CAPABILITY,
  selectConnectAuth,
} from '../connection/protocol/relay-control';

// Advertise the protocol range Clawket can speak across OpenClaw 4.x and 5.x.
const MIN_PROTOCOL_VERSION = 3;
const PROTOCOL_VERSION = 4;

// Reconnect config
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15_000;

// ---- Event types ----

type NodeConnectionState = 'idle' | 'connecting' | 'reconnecting' | 'challenging' | 'ready' | 'closed';

export type NodeInvokeRequestEvent = {
  id: string;
  nodeId: string;
  command: string;
  params: unknown;
  timeoutMs?: number;
  source?: string;
  sessionKey?: string;
  requestedByDeviceId?: string;
  requestedByClientId?: string;
  requestedByConnId?: string;
};

type NodeClientEvents = {
  connection: { state: NodeConnectionState; reason?: string };
  invokeRequest: NodeInvokeRequestEvent;
  error: { code: string; message: string };
};

type Listener<T> = (event: T) => void;

type ListenerStore = {
  [K in keyof NodeClientEvents]: Set<Listener<NodeClientEvents[K]>>;
};

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
};

type SocketAttempt = {
  generation: number;
  socket: WebSocket;
  connection: ConnectionRecord;
  pendingRequests: Map<string, PendingRequest>;
};

// ---- NodeClient ----

export class NodeClient {
  private ws: WebSocket | null = null;
  private activeAttempt: SocketAttempt | null = null;
  private socketGeneration = 0;
  private connection: ConnectionRecord | null = null;
  private state: NodeConnectionState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private deviceId: string | null = null;
  private encoder = new TextEncoder();
  private capabilityToggles: NodeCapabilityToggles = { ...DEFAULT_NODE_CAPABILITY_TOGGLES };

  private listeners: ListenerStore = {
    connection: new Set(),
    invokeRequest: new Set(),
    error: new Set(),
  };

  // ---- Public API ----

  public configure(connection: ConnectionRecord | null): void {
    if (connection && !resolveCapabilities(connection.backendKind).nodes) {
      throw new Error('NodeClient requires a connection with the nodes capability');
    }
    this.connection = connection ? cloneConnectionRecord(connection) : null;
  }

  public getConnectionState(): NodeConnectionState {
    return this.state;
  }

  public getDeviceId(): string | null {
    return this.deviceId;
  }

  private getDeviceTokenStorageScope(
    connection: ConnectionRecord | null,
  ): DeviceTokenStorageScope | undefined {
    const relay = connection?.transportKind === 'relay'
      ? connection.relay
      : undefined;
    const relayServerUrl = relay?.serverUrl?.trim().replace(/\/+$/, '');
    const relayGatewayId = relay?.gatewayId?.trim();
    if (relayServerUrl && relayGatewayId) {
      return {
        serverUrl: relayServerUrl,
        gatewayId: relayGatewayId,
        role: 'node',
      };
    }

    const gatewayUrl = connection?.url?.trim().replace(/\/+$/, '');
    if (gatewayUrl) {
      return { gatewayUrl, role: 'node' };
    }

    return undefined;
  }

  public on<K extends keyof NodeClientEvents>(event: K, listener: Listener<NodeClientEvents[K]>): () => void {
    (this.listeners[event] as Set<Listener<NodeClientEvents[K]>>).add(listener);
    return () => {
      (this.listeners[event] as Set<Listener<NodeClientEvents[K]>>).delete(listener);
    };
  }

  public setCapabilityToggles(toggles: NodeCapabilityToggles): void {
    this.capabilityToggles = { ...toggles };
  }

  public connect(): void {
    const connection = this.connection;
    if (!connection?.url) {
      this.emit('error', { code: 'config_missing', message: 'Gateway URL is not configured' });
      return;
    }

    this.clearReconnectTimer();
    this.manuallyClosed = false;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.activeAttempt) {
      const superseded = this.activeAttempt;
      this.activeAttempt = null;
      this.ws = null;
      superseded.socket.onopen = null;
      superseded.socket.onmessage = null;
      superseded.socket.onerror = null;
      superseded.socket.onclose = null;
      this.rejectPendingRequests(superseded, new Error('Connection superseded'));
      superseded.socket.close();
    }

    let wsUrl: string;
    try {
      wsUrl = resolveNodeSocketUrl(connection);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Relay connection is not configured';
      this.emit('error', {
        code: 'config_missing',
        message,
      });
      this.setState('closed', message);
      return;
    }
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(wsUrl);
    const attempt: SocketAttempt = {
      generation: ++this.socketGeneration,
      socket,
      connection,
      pendingRequests: new Map(),
    };
    this.ws = socket;
    this.activeAttempt = attempt;

    socket.onopen = () => {
      if (!this.isCurrentAttempt(attempt)) return;
      this.setState('challenging');
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (!this.isCurrentAttempt(attempt)) return;
      this.handleRawMessage(event.data, attempt);
    };

    socket.onerror = () => {
      if (!this.isCurrentAttempt(attempt)) return;
      this.emit('error', { code: 'ws_error', message: 'WebSocket error' });
    };

    socket.onclose = () => {
      this.handleSocketClose(attempt);
    };
  }

  public disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    const attempt = this.activeAttempt;
    this.activeAttempt = null;
    this.ws = null;
    if (attempt) {
      attempt.socket.onopen = null;
      attempt.socket.onmessage = null;
      attempt.socket.onerror = null;
      attempt.socket.onclose = null;
      this.rejectPendingRequests(attempt, new Error('Connection closed'));
      attempt.socket.close();
    }
    this.setState('closed');
  }

  /** Send an invoke result back to the gateway. */
  public sendInvokeResult(
    invokeId: string,
    result: { ok: boolean; payload?: unknown; error?: { code: string; message: string } },
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.deviceId) return;
    const frame = {
      type: 'req',
      id: generateId(),
      method: 'node.invoke.result',
      params: {
        id: invokeId,
        nodeId: this.deviceId,
        ok: result.ok,
        ...(result.payload !== undefined ? { payload: result.payload } : {}),
        ...(result.error ? { error: result.error } : {}),
      },
    };
    try {
      this.sendWireFrame(JSON.stringify(frame));
    } catch (error) {
      if (error instanceof WebSocketFrameTooLargeError) {
        this.emit('error', { code: error.code, message: error.message });
      }
      // Swallow send errors — connection will reconnect
    }
  }

  // ---- Private: event emission ----

  private emit<K extends keyof NodeClientEvents>(event: K, payload: NodeClientEvents[K]): void {
    for (const listener of this.listeners[event]) {
      (listener as Listener<NodeClientEvents[K]>)(payload);
    }
  }

  private setState(state: NodeConnectionState, reason?: string): void {
    this.state = state;
    this.emit('connection', { state, reason });
  }

  // ---- Private: handshake ----

  private async handleConnectChallenge(
    nonce: string,
    attempt: SocketAttempt | null = this.activeAttempt,
  ): Promise<void> {
    if (!attempt || !this.isCurrentAttempt(attempt)) return;
    let deviceTokenInUse = false;
    let identityDeviceId: string | null = null;
    const deviceTokenScope = this.getDeviceTokenStorageScope(attempt.connection);
    try {
      const identity = await ensureIdentity();
      if (!this.isCurrentAttempt(attempt)) return;
      identityDeviceId = identity.deviceId;
      this.deviceId = identity.deviceId;
      const secretKey = hexToBytes(identity.secretKeyHex);
      const publicKeyBytes = hexToBytes(identity.publicKeyHex);

      const storedDeviceTokenRecord = await StorageService
        .getDeviceTokenRecord(identity.deviceId, deviceTokenScope)
        .catch(() => null);
      if (!this.isCurrentAttempt(attempt)) return;
      const connectAuth = selectConnectAuth({
        storedDeviceToken: storedDeviceTokenRecord?.role === 'node'
          ? storedDeviceTokenRecord.token
          : null,
        bootstrapToken: attempt.connection.bootstrap?.token,
        bootstrapStrategy: attempt.connection.bootstrap?.strategy,
        token: attempt.connection.auth?.token,
        password: attempt.connection.auth?.password,
      });
      deviceTokenInUse = connectAuth.source === 'device-token';

      const signedAt = Date.now();
      const clientId = getRuntimeClientId();
      const clientMode = 'node';
      const role = 'node';
      const scopes: string[] = [];
      const platform = getRuntimePlatform();
      const deviceFamily = getRuntimeDeviceFamily();

      const authPayload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs: signedAt,
        token: connectAuth.signatureToken,
        nonce,
        platform,
        deviceFamily,
      });

      const payloadBytes = this.encoder.encode(authPayload);
      const signatureBytes = nacl.sign.detached(payloadBytes, secretKey);

      const connectParams = {
        minProtocol: MIN_PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: clientId,
          displayName: 'Clawket Node',
          version: APP_PACKAGE_VERSION,
          platform,
          mode: clientMode,
          deviceFamily,
        },
        caps: getEnabledNodeCaps(this.capabilityToggles),
        commands: getEnabledNodeCommands(this.capabilityToggles),
        role,
        scopes,
        device: {
          id: identity.deviceId,
          publicKey: bytesToBase64Url(publicKeyBytes),
          signature: bytesToBase64Url(signatureBytes),
          signedAt,
          nonce,
        },
        auth: connectAuth.auth,
      };

      const result = await this.sendRequest('connect', connectParams, attempt);
      if (!this.isCurrentAttempt(attempt)) return;
      const helloOk = result as { auth?: { deviceToken?: string } } | null;
      if (helloOk?.auth?.deviceToken) {
        await StorageService.setDeviceTokenRecord(
          identity.deviceId,
          {
            token: helloOk.auth.deviceToken,
            role: 'node',
            scopes: [],
          },
          deviceTokenScope,
        );
      }
      if (
        !this.isCurrentAttempt(attempt)
        || attempt.socket.readyState !== WebSocket.OPEN
      ) return;
      // A socket open only proves that the transport exists. Preserve the
      // accumulated backoff until the Gateway has accepted the signed
      // protocol handshake and any returned credentials are durable.
      this.reconnectAttempts = 0;
      this.setState('ready');
    } catch (err: unknown) {
      if (!this.isCurrentAttempt(attempt)) return;
      if (deviceTokenInUse && identityDeviceId && isDeviceTokenMismatch(err)) {
        await StorageService.deleteDeviceToken(identityDeviceId, deviceTokenScope).catch(() => undefined);
        if (!this.isCurrentAttempt(attempt)) return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', { code: 'auth_failed', message: msg });
      attempt.socket.close();
    }
  }

  // ---- Private: request/response ----

  private sendRequest(
    method: string,
    params?: object,
    attempt: SocketAttempt | null = this.activeAttempt,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!attempt || !this.isCurrentAttempt(attempt) || attempt.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'));
        return;
      }
      const id = generateId();
      const frame = { type: 'req', id, method, params };
      attempt.pendingRequests.set(id, { resolve, reject });
      try {
        this.sendWireFrame(JSON.stringify(frame), attempt);
      } catch (sendErr: unknown) {
        attempt.pendingRequests.delete(id);
        reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
      }
    });
  }

  // ---- Private: message routing ----

  private sendWireFrame(
    data: string,
    attempt: SocketAttempt | null = this.activeAttempt,
  ): void {
    assertWebSocketFrameWithinLimit(data);
    if (!attempt || !this.isCurrentAttempt(attempt) || attempt.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    attempt.socket.send(data);
  }

  private rejectOversizedIncomingFrame(rawData: unknown, attempt: SocketAttempt): boolean {
    const byteLength = getWebSocketFrameByteLength(rawData);
    if (byteLength == null || byteLength <= WEBSOCKET_FRAME_LIMIT_BYTES) return false;
    this.emit('error', {
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
    });
    attempt.socket.close(FRAME_TOO_LARGE_CLOSE_CODE, FRAME_TOO_LARGE_ERROR_CODE);
    return true;
  }

  private handleRawMessage(rawData: unknown, attempt: SocketAttempt): void {
    if (!this.isCurrentAttempt(attempt)) return;
    if (this.rejectOversizedIncomingFrame(rawData, attempt)) return;
    let parsed: unknown;
    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const frame = parsed as Record<string, unknown>;

    if (
      attempt.connection.transportKind === 'relay'
      && frame.type === 'tick'
      && frame.ack === RELAY_CLIENT_PONG_CAPABILITY
      && typeof frame.ts === 'number'
      && Number.isFinite(frame.ts)
    ) {
      try {
        this.sendWireFrame(JSON.stringify({ type: 'pong', ts: frame.ts }), attempt);
      } catch {
        // The attempt close handler owns reconnect scheduling.
      }
      return;
    }

    // Handle response frames
    if (frame.type === 'res' && typeof frame.id === 'string') {
      const pending = attempt.pendingRequests.get(frame.id);
      if (pending) {
        attempt.pendingRequests.delete(frame.id);
        if (frame.error) {
          const errObj = frame.error as Record<string, unknown>;
          const error = new Error(String(errObj.message ?? errObj.code ?? 'Unknown error')) as Error & {
            code?: string;
          };
          if (typeof errObj.code === 'string') error.code = errObj.code;
          pending.reject(error);
        } else {
          pending.resolve(frame.result);
        }
      }
      return;
    }

    // Handle event frames
    if (frame.type === 'event' && typeof frame.event === 'string') {
      const event = frame.event as string;
      const payload = (frame.payload ?? {}) as Record<string, unknown>;

      if (event === 'connect.challenge') {
        const nonce = String(payload.nonce ?? '');
        if (nonce) void this.handleConnectChallenge(nonce, attempt);
        return;
      }

      if (event === 'node.invoke.request') {
        const invokeEvent: NodeInvokeRequestEvent = {
          id: String(payload.id ?? ''),
          nodeId: String(payload.nodeId ?? ''),
          command: String(payload.command ?? ''),
          params: payload.paramsJSON != null ? tryParseJSON(payload.paramsJSON) : payload.params,
          timeoutMs: typeof payload.timeoutMs === 'number' ? payload.timeoutMs : undefined,
          source: typeof payload.source === 'string' ? payload.source : undefined,
          sessionKey: typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined,
          requestedByDeviceId: typeof payload.requestedByDeviceId === 'string' ? payload.requestedByDeviceId : undefined,
          requestedByClientId: typeof payload.requestedByClientId === 'string' ? payload.requestedByClientId : undefined,
          requestedByConnId: typeof payload.requestedByConnId === 'string' ? payload.requestedByConnId : undefined,
        };
        this.emit('invokeRequest', invokeEvent);
        return;
      }
    }
  }

  // ---- Private: reconnect ----

  private isCurrentAttempt(attempt: SocketAttempt): boolean {
    return !this.manuallyClosed
      && this.activeAttempt?.generation === attempt.generation
      && this.activeAttempt === attempt
      && this.ws === attempt.socket;
  }

  private handleSocketClose(attempt: SocketAttempt): void {
    this.rejectPendingRequests(attempt, new Error('Connection closed'));
    if (!this.isCurrentAttempt(attempt)) return;

    this.activeAttempt = null;
    this.ws = null;
    this.scheduleReconnect();
  }

  private rejectPendingRequests(attempt: SocketAttempt, error: Error): void {
    for (const pending of attempt.pendingRequests.values()) {
      pending.reject(error);
    }
    attempt.pendingRequests.clear();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function cloneConnectionRecord(record: ConnectionRecord): ConnectionRecord {
  return JSON.parse(JSON.stringify(record)) as ConnectionRecord;
}

function resolveNodeSocketUrl(connection: ConnectionRecord): string {
  if (connection.transportKind !== 'relay') return normalizeWsUrl(connection.url);

  const gatewayId = connection.relay?.gatewayId?.trim();
  const clientToken = connection.relay?.clientToken?.trim();
  const connectionId = connection.id.trim();
  if (!gatewayId || !clientToken || !connectionId) {
    throw new Error('Relay connection is not configured');
  }
  return buildRelayClientWsUrl({
    relayUrl: connection.url,
    gatewayId,
    token: clientToken,
    clientId: `clawket-node:${connectionId}`,
    relayIdQueryParam: 'gatewayId',
  });
}

function tryParseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isDeviceTokenMismatch(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === 'AUTH_TOKEN_MISMATCH'
    || code === 'AUTH_SCOPE_MISMATCH'
    || error.message.toLowerCase().includes('device token mismatch');
}
