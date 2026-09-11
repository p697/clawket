import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
  assertWebSocketFrameWithinLimit,
  getWebSocketFrameByteLength,
} from './frame-limit';
import {
  WEB_SOCKET_CONNECTING,
  WEB_SOCKET_OPEN,
  createNativeWebSocket,
  type TransportError,
  type TransportState,
  type TransportStateChange,
  type WebSocketCloseEventLike,
  type WebSocketFactory,
  type WebSocketLike,
} from './types';

export const RECONNECT_BASE_MS = 800;
export const RECONNECT_MAX_MS = 15_000;
export const RECONNECT_FACTOR = 1.7;
export const WS_OPEN_TIMEOUT_MS = 10_000;

export type WebSocketTransportOptions = {
  url: string;
  protocols?: string | string[];
  webSocketFactory?: WebSocketFactory;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectFactor?: number;
  reconnectJitter?: boolean;
  openTimeoutMs?: number;
  random?: () => number;
};

type Listener<T> = (value: T) => void;

/**
 * Socket lifecycle shared by Relay and direct transports. Backend handshakes
 * deliberately live above this class: subclasses decide what constitutes
 * healthy evidence and when a connection may enter `ready`.
 */
export abstract class BaseWebSocketTransport {
  protected socket: WebSocketLike | null = null;

  private readonly url: string;
  private readonly protocols?: string | string[];
  private readonly webSocketFactory: WebSocketFactory;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly reconnectFactor: number;
  private readonly reconnectJitter: boolean;
  private readonly openTimeoutMs: number;
  private readonly random: () => number;
  private readonly messageListeners = new Set<Listener<unknown>>();
  private readonly stateListeners = new Set<Listener<TransportStateChange>>();
  private readonly errorListeners = new Set<Listener<TransportError>>();
  private readonly closeListeners = new Set<Listener<WebSocketCloseEventLike>>();
  private readonly openListeners = new Set<Listener<void>>();

  private currentState: TransportState = 'idle';
  private reconnectAttempts = 0;
  private attemptId = 0;
  private opening = false;
  private manuallyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(options: WebSocketTransportOptions) {
    const url = options.url.trim();
    if (!url) throw new TypeError('WebSocket transport URL is required');
    this.url = url;
    this.protocols = options.protocols;
    this.webSocketFactory = options.webSocketFactory ?? createNativeWebSocket;
    this.reconnectBaseMs = readPositiveNumber(options.reconnectBaseMs, RECONNECT_BASE_MS);
    this.reconnectMaxMs = readPositiveNumber(options.reconnectMaxMs, RECONNECT_MAX_MS);
    this.reconnectFactor = readPositiveNumber(options.reconnectFactor, RECONNECT_FACTOR);
    this.reconnectJitter = options.reconnectJitter !== false;
    this.openTimeoutMs = readPositiveNumber(options.openTimeoutMs, WS_OPEN_TIMEOUT_MS);
    this.random = options.random ?? Math.random;
  }

  public get state(): TransportState {
    return this.currentState;
  }

  public get reconnectAttempt(): number {
    return this.reconnectAttempts;
  }

  public get isSocketOpen(): boolean {
    return this.socket?.readyState === WEB_SOCKET_OPEN;
  }

  public onMessage(listener: Listener<unknown>): () => void {
    return addListener(this.messageListeners, listener);
  }

  public onStateChange(listener: Listener<TransportStateChange>): () => void {
    return addListener(this.stateListeners, listener);
  }

  public onError(listener: Listener<TransportError>): () => void {
    return addListener(this.errorListeners, listener);
  }

  public onClose(listener: Listener<WebSocketCloseEventLike>): () => void {
    return addListener(this.closeListeners, listener);
  }

  public onOpen(listener: Listener<void>): () => void {
    return addListener(this.openListeners, listener);
  }

  public connect(): void {
    if (this.opening) return;
    if (
      this.socket
      && (this.socket.readyState === WEB_SOCKET_CONNECTING || this.socket.readyState === WEB_SOCKET_OPEN)
    ) return;

    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.openConnection();
  }

  public reconnect(): void {
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.clearOpenTimer();
    this.onSocketTerminated();
    this.closeCurrentSocket();
    this.openConnection();
  }

  public disconnect(code?: number, reason?: string): void {
    this.manuallyClosed = true;
    this.attemptId += 1;
    this.clearReconnectTimer();
    this.clearOpenTimer();
    this.onSocketTerminated();
    this.closeCurrentSocket(code, reason);
    this.setState('closed', reason);
  }

  public send(data: unknown): void {
    assertWebSocketFrameWithinLimit(data);
    if (!this.socket || this.socket.readyState !== WEB_SOCKET_OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.socket.send(data);
  }

  protected setHandshaking(): void {
    this.setState('handshaking');
  }

  protected setReady(resetBackoff: boolean): void {
    if (!this.isSocketOpen) return;
    if (resetBackoff) this.resetReconnectBackoff();
    this.setState('ready');
  }

  protected resetReconnectBackoff(): void {
    this.reconnectAttempts = 0;
  }

  protected emitMessage(data: unknown): void {
    emitTo(this.messageListeners, data);
  }

  protected emitError(error: TransportError): void {
    emitTo(this.errorListeners, error);
  }

  protected forceReconnect(code?: number, reason?: string): void {
    if (this.manuallyClosed) return;
    this.clearOpenTimer();
    this.onSocketTerminated();
    this.closeCurrentSocket(code, reason);
    this.scheduleReconnect(reason);
  }

  protected abstract handleSocketOpen(attemptId: number): void;
  protected abstract handleSocketMessage(data: unknown, attemptId: number): void;

  protected onSocketTerminated(): void {
    // Subclasses clear handshake/first-frame timers here.
  }

  private openConnection(): void {
    if (this.opening) return;
    this.opening = true;
    this.attemptId += 1;
    const attemptId = this.attemptId;
    this.setState('connecting');
    if (this.manuallyClosed || this.attemptId !== attemptId) {
      this.opening = false;
      return;
    }

    let nextSocket: WebSocketLike;
    try {
      nextSocket = this.webSocketFactory(this.url, this.protocols);
    } catch (cause) {
      this.emitError({
        code: 'ws_open_failed',
        message: cause instanceof Error ? cause.message : 'WebSocket creation failed',
        retryable: true,
        cause,
      });
      this.opening = false;
      this.scheduleReconnect('WebSocket creation failed');
      return;
    }

    this.socket = nextSocket;
    this.opening = false;
    this.startOpenTimer(attemptId, nextSocket);

    nextSocket.onopen = () => {
      if (!this.isCurrentSocket(nextSocket, attemptId)) return;
      this.clearOpenTimer();
      this.handleSocketOpen(attemptId);
      if (!this.isCurrentSocket(nextSocket, attemptId)) return;
      emitTo(this.openListeners, undefined);
    };

    nextSocket.onmessage = (event) => {
      if (!this.isCurrentSocket(nextSocket, attemptId)) return;
      if (this.rejectOversizedIncomingFrame(event.data)) return;
      this.handleSocketMessage(event.data, attemptId);
    };

    nextSocket.onerror = (event) => {
      if (!this.isCurrentSocket(nextSocket, attemptId)) return;
      this.emitError({
        code: 'ws_error',
        message: event?.message || 'WebSocket error',
        retryable: true,
        cause: event,
      });
    };

    nextSocket.onclose = (event = {}) => {
      if (!this.isCurrentSocket(nextSocket, attemptId)) return;
      this.socket = null;
      this.clearOpenTimer();
      this.onSocketTerminated();
      if (this.manuallyClosed) {
        this.setState('closed', event.reason);
        emitTo(this.closeListeners, event);
        return;
      }
      this.scheduleReconnect(event.reason);
      emitTo(this.closeListeners, event);
    };
  }

  private rejectOversizedIncomingFrame(data: unknown): boolean {
    const byteLength = getWebSocketFrameByteLength(data);
    if (byteLength == null || byteLength <= WEBSOCKET_FRAME_LIMIT_BYTES) return false;
    this.emitError({
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
      retryable: true,
      cause: { byteLength, limitBytes: WEBSOCKET_FRAME_LIMIT_BYTES },
    });
    this.forceReconnect(FRAME_TOO_LARGE_CLOSE_CODE, FRAME_TOO_LARGE_ERROR_CODE);
    return true;
  }

  private scheduleReconnect(reason?: string): void {
    if (this.manuallyClosed || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const exponentialDelay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * Math.pow(this.reconnectFactor, this.reconnectAttempts - 1),
    );
    const jitter = this.reconnectJitter ? 0.75 + this.random() * 0.5 : 1;
    const delay = Math.floor(exponentialDelay * jitter);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manuallyClosed) return;
      this.openConnection();
    }, delay);
    this.setState('reconnecting', reason || `retrying in ${delay}ms`);
  }

  private startOpenTimer(attemptId: number, socket: WebSocketLike): void {
    this.clearOpenTimer();
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      if (!this.isCurrentSocket(socket, attemptId) || socket.readyState !== WEB_SOCKET_CONNECTING) return;
      this.emitError({
        code: 'ws_connect_timeout',
        message: 'WebSocket open timed out',
        retryable: true,
      });
      this.forceReconnect(undefined, 'WebSocket open timed out');
    }, this.openTimeoutMs);
  }

  private clearOpenTimer(): void {
    if (!this.openTimer) return;
    clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeCurrentSocket(code?: number, reason?: string): void {
    const current = this.socket;
    if (!current) return;
    this.socket = null;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      current.close(code, reason);
    } catch {
      // The lifecycle state is already detached; reconnect/disconnect continues.
    }
  }

  private isCurrentSocket(socket: WebSocketLike, attemptId: number): boolean {
    return this.socket === socket && this.attemptId === attemptId;
  }

  private setState(state: TransportState, reason?: string): void {
    this.currentState = state;
    emitTo(this.stateListeners, {
      state,
      ...(reason ? { reason } : {}),
      reconnectAttempt: this.reconnectAttempts,
    });
  }
}

function addListener<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitTo<T>(listeners: Set<Listener<T>>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      // One consumer must not break the transport lifecycle for the others.
    }
  }
}

function readPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
