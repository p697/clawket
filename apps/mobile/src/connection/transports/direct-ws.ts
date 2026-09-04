import { BaseWebSocketTransport, type WebSocketTransportOptions } from './ws-base';

export const DIRECT_FIRST_FRAME_TIMEOUT_MS = 8_000;

export type DirectWsTransportOptions = WebSocketTransportOptions & {
  firstFrameTimeoutMs?: number;
  isValidFrame?: (data: unknown) => boolean;
  autoReadyOnFirstFrame?: boolean;
};

/**
 * A direct socket transport whose reconnect history is cleared only by the
 * first valid inbound frame. Adapters remain responsible for backend readiness.
 */
export class DirectWsTransport extends BaseWebSocketTransport {
  private readonly firstFrameTimeoutMs: number;
  private readonly isValidFrame: (data: unknown) => boolean;
  private readonly autoReadyOnFirstFrame: boolean;
  private firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  private receivedValidFrame = false;

  constructor(options: DirectWsTransportOptions) {
    super(options);
    this.firstFrameTimeoutMs = readPositiveNumber(
      options.firstFrameTimeoutMs,
      DIRECT_FIRST_FRAME_TIMEOUT_MS,
    );
    this.isValidFrame = options.isValidFrame ?? isJsonObjectFrame;
    this.autoReadyOnFirstFrame = options.autoReadyOnFirstFrame === true;
  }

  public get hasReceivedValidFrame(): boolean {
    return this.receivedValidFrame;
  }

  /** Marks a backend-specific handshake ready without changing backoff. */
  public markReady(): void {
    this.setReady(false);
  }

  protected handleSocketOpen(): void {
    this.receivedValidFrame = false;
    this.setHandshaking();
    this.startFirstFrameTimer();
  }

  protected handleSocketMessage(data: unknown): void {
    if (!this.receivedValidFrame && this.readValidFrame(data)) {
      this.receivedValidFrame = true;
      this.clearFirstFrameTimer();
      this.resetReconnectBackoff();
      if (this.autoReadyOnFirstFrame) this.setReady(false);
    }
    this.emitMessage(data);
  }

  protected override onSocketTerminated(): void {
    this.clearFirstFrameTimer();
    this.receivedValidFrame = false;
  }

  private readValidFrame(data: unknown): boolean {
    try {
      return this.isValidFrame(data);
    } catch (cause) {
      this.emitError({
        code: 'invalid_frame',
        message: cause instanceof Error ? cause.message : 'Invalid WebSocket frame',
        retryable: true,
        cause,
      });
      return false;
    }
  }

  private startFirstFrameTimer(): void {
    this.clearFirstFrameTimer();
    if (!this.isSocketOpen || this.state === 'closed') return;
    this.firstFrameTimer = setTimeout(() => {
      this.firstFrameTimer = null;
      if (!this.isSocketOpen || this.receivedValidFrame) return;
      this.emitError({
        code: 'first_frame_timeout',
        message: 'WebSocket first frame timed out',
        retryable: true,
      });
      this.forceReconnect(undefined, 'WebSocket first frame timed out');
    }, this.firstFrameTimeoutMs);
  }

  private clearFirstFrameTimer(): void {
    if (!this.firstFrameTimer) return;
    clearTimeout(this.firstFrameTimer);
    this.firstFrameTimer = null;
  }
}

function isJsonObjectFrame(data: unknown): boolean {
  if (typeof data !== 'string') {
    return data !== null && typeof data === 'object';
  }
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

function readPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
