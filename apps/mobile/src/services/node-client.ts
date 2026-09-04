import nacl from 'tweetnacl';
import {
  hexToBytes,
  bytesToBase64Url,
  buildDeviceAuthPayload,
  normalizeWsUrl,
  generateId,
  ensureIdentity,
} from './gateway-auth';
import { StorageService } from './storage';
import type { GatewayConfig, DeviceIdentity } from '../types';
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

// ---- NodeClient ----

export class NodeClient {
  private ws: WebSocket | null = null;
  private config: GatewayConfig | null = null;
  private state: NodeConnectionState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private deviceId: string | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private encoder = new TextEncoder();
  private capabilityToggles: NodeCapabilityToggles = { ...DEFAULT_NODE_CAPABILITY_TOGGLES };

  private listeners: ListenerStore = {
    connection: new Set(),
    invokeRequest: new Set(),
    error: new Set(),
  };

  // ---- Public API ----

  public configure(config: GatewayConfig | null): void {
    this.config = config;
  }

  public getConnectionState(): NodeConnectionState {
    return this.state;
  }

  public getDeviceId(): string | null {
    return this.deviceId;
  }

  private getDeviceTokenStorageScope(): {
    serverUrl?: string;
    gatewayId?: string;
    gatewayUrl?: string;
  } | undefined {
    const relayServerUrl = this.config?.relay?.serverUrl?.trim().replace(/\/+$/, '');
    const relayGatewayId = this.config?.relay?.gatewayId?.trim();
    if (relayServerUrl && relayGatewayId) {
      return {
        serverUrl: relayServerUrl,
        gatewayId: relayGatewayId,
      };
    }

    const gatewayUrl = this.config?.url?.trim().replace(/\/+$/, '');
    if (gatewayUrl) {
      return { gatewayUrl };
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
    if (!this.config?.url) {
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

    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const wsUrl = normalizeWsUrl(this.config.url);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('challenging');
    };

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      this.handleRawMessage(event.data);
    };

    this.ws.onerror = () => {
      this.emit('error', { code: 'ws_error', message: 'WebSocket error' });
    };

    this.ws.onclose = () => {
      this.ws = null;

      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Connection closed'));
      }
      this.pendingRequests.clear();

      if (this.manuallyClosed) {
        this.setState('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  public disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
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

  private async handleConnectChallenge(nonce: string): Promise<void> {
    const identity = await ensureIdentity();
    this.deviceId = identity.deviceId;
    const secretKey = hexToBytes(identity.secretKeyHex);
    const publicKeyBytes = hexToBytes(identity.publicKeyHex);

    const signedAt = Date.now();
    const token = this.config?.token ?? '';
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
      token,
      nonce,
      platform,
      deviceFamily,
    });

    const payloadBytes = this.encoder.encode(authPayload);
    const signatureBytes = nacl.sign.detached(payloadBytes, secretKey);

    const publicKeyB64 = bytesToBase64Url(publicKeyBytes);
    const signatureB64 = bytesToBase64Url(signatureBytes);

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
        publicKey: publicKeyB64,
        signature: signatureB64,
        signedAt,
        nonce,
      },
      auth: {
        token: this.config?.token,
      },
    };

    try {
      const result = await this.sendRequest('connect', connectParams);
      const helloOk = result as { auth?: { deviceToken?: string } } | null;
      if (helloOk?.auth?.deviceToken) {
        await StorageService.setDeviceToken(
          identity.deviceId,
          helloOk.auth.deviceToken,
          this.getDeviceTokenStorageScope(),
        );
      }
      this.setState('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', { code: 'auth_failed', message: msg });
      this.ws?.close();
    }
  }

  // ---- Private: request/response ----

  private sendRequest(method: string, params?: object): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'));
        return;
      }
      const id = generateId();
      const frame = { type: 'req', id, method, params };
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.sendWireFrame(JSON.stringify(frame));
      } catch (sendErr: unknown) {
        this.pendingRequests.delete(id);
        reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
      }
    });
  }

  // ---- Private: message routing ----

  private sendWireFrame(data: string): void {
    assertWebSocketFrameWithinLimit(data);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.ws.send(data);
  }

  private rejectOversizedIncomingFrame(rawData: unknown): boolean {
    const byteLength = getWebSocketFrameByteLength(rawData);
    if (byteLength == null || byteLength <= WEBSOCKET_FRAME_LIMIT_BYTES) return false;
    this.emit('error', {
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
    });
    this.ws?.close(FRAME_TOO_LARGE_CLOSE_CODE, FRAME_TOO_LARGE_ERROR_CODE);
    return true;
  }

  private handleRawMessage(rawData: unknown): void {
    if (this.rejectOversizedIncomingFrame(rawData)) return;
    let parsed: unknown;
    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const frame = parsed as Record<string, unknown>;

    // Handle response frames
    if (frame.type === 'res' && typeof frame.id === 'string') {
      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        this.pendingRequests.delete(frame.id);
        if (frame.error) {
          const errObj = frame.error as Record<string, unknown>;
          pending.reject(new Error(String(errObj.message ?? errObj.code ?? 'Unknown error')));
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
        if (nonce) void this.handleConnectChallenge(nonce);
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

function tryParseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
