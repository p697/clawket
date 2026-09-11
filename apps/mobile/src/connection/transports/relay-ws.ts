import { BaseWebSocketTransport, type WebSocketTransportOptions } from './ws-base';

export const RELAY_CLIENT_PONG_CAPABILITY = 'relay.client-pong.v1';
export const RELAY_HANDSHAKE_TIMEOUT_MS = 20_000;

export type RelayWsTransportOptions = WebSocketTransportOptions & {
  handshakeTimeoutMs?: number;
  pongCapability?: string;
  tickIntervalMs?: number;
  missedTickTolerance?: number;
};

/**
 * Backend-neutral Relay socket lifecycle. The adapter owns the contents of the
 * challenge response and calls `markReady` only after its handshake succeeds.
 */
export class RelayWsTransport extends BaseWebSocketTransport {
  public readonly advertisedCapabilities: readonly string[];

  private readonly handshakeTimeoutMs: number;
  private readonly pongCapability: string;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private tickIntervalMs: number;
  private missedTickTolerance: number;
  private lastTickAt: number | null = null;
  private tickWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RelayWsTransportOptions) {
    super(options);
    this.handshakeTimeoutMs = readPositiveNumber(
      options.handshakeTimeoutMs,
      RELAY_HANDSHAKE_TIMEOUT_MS,
    );
    this.pongCapability = options.pongCapability?.trim() || RELAY_CLIENT_PONG_CAPABILITY;
    this.advertisedCapabilities = Object.freeze([this.pongCapability]);
    this.tickIntervalMs = readPositiveNumber(options.tickIntervalMs, 15_000);
    this.missedTickTolerance = readPositiveNumber(options.missedTickTolerance, 3);
  }

  public get lastHeartbeatAt(): number | null {
    return this.lastTickAt;
  }

  /** Applies a negotiated server heartbeat policy without backend knowledge. */
  public configureHeartbeat(options: { tickIntervalMs: number; missedTickTolerance?: number }): void {
    this.tickIntervalMs = readPositiveNumber(options.tickIntervalMs, this.tickIntervalMs);
    this.missedTickTolerance = readPositiveNumber(
      options.missedTickTolerance,
      this.missedTickTolerance,
    );
    if (this.state === 'ready') this.startTickWatchdog();
  }

  /**
   * Confirms a completed backend handshake. A raw socket open deliberately
   * does not reset reconnect backoff.
   */
  public markReady(): void {
    if (!this.isSocketOpen) return;
    this.clearHandshakeTimer();
    this.setReady(true);
    if (this.state === 'ready' && this.isSocketOpen) this.startTickWatchdog();
  }

  /** Keeps the public phase explicit if an adapter restarts its handshake. */
  public markHandshakeStarted(): void {
    if (!this.isSocketOpen) return;
    this.setHandshaking();
    this.startHandshakeTimer();
  }

  protected handleSocketOpen(): void {
    this.setHandshaking();
    this.startHandshakeTimer();
  }

  protected handleSocketMessage(data: unknown): void {
    const tick = readTickFrame(data);
    if (tick) {
      this.lastTickAt = Date.now();
      this.acknowledgeNegotiatedTick(tick);
    }
    this.emitMessage(data);
  }

  protected override onSocketTerminated(): void {
    this.clearHandshakeTimer();
    this.clearTickWatchdog();
    this.lastTickAt = null;
  }

  private acknowledgeNegotiatedTick(frame: TickFrame): void {
    if (
      frame.type !== 'tick'
      || frame.ack !== this.pongCapability
      || typeof frame.ts !== 'number'
      || !Number.isFinite(frame.ts)
    ) return;

    try {
      this.send(JSON.stringify({ type: 'pong', ts: frame.ts }));
    } catch {
      // Socket close/error handling owns reconnect scheduling.
    }
  }

  private startTickWatchdog(): void {
    this.clearTickWatchdog();
    this.lastTickAt = Date.now();
    const toleranceMs = this.tickIntervalMs * this.missedTickTolerance;
    const check = () => {
      this.tickWatchdogTimer = null;
      if (this.state !== 'ready' || !this.isSocketOpen) return;
      const elapsed = this.lastTickAt == null
        ? Number.POSITIVE_INFINITY
        : Date.now() - this.lastTickAt;
      if (elapsed >= toleranceMs) {
        this.emitError({
          code: 'heartbeat_timeout',
          message: 'Relay heartbeat timed out',
          retryable: true,
        });
        this.forceReconnect(undefined, 'Relay heartbeat timed out');
        return;
      }
      this.tickWatchdogTimer = setTimeout(check, this.tickIntervalMs);
    };
    this.tickWatchdogTimer = setTimeout(check, toleranceMs);
  }

  private clearTickWatchdog(): void {
    if (!this.tickWatchdogTimer) return;
    clearTimeout(this.tickWatchdogTimer);
    this.tickWatchdogTimer = null;
  }

  private startHandshakeTimer(): void {
    this.clearHandshakeTimer();
    if (!this.isSocketOpen || this.state === 'closed') return;
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      if (!this.isSocketOpen || this.state === 'ready') return;
      this.emitError({
        code: 'challenge_timeout',
        message: 'Relay handshake timed out',
        retryable: true,
      });
      this.forceReconnect(undefined, 'Relay handshake timed out');
    }, this.handshakeTimeoutMs);
  }

  private clearHandshakeTimer(): void {
    if (!this.handshakeTimer) return;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }
}

type TickFrame = { type: 'tick'; ts?: unknown; ack?: unknown };

function readTickFrame(data: unknown): TickFrame | null {
  if (typeof data !== 'string') return null;
  try {
    const frame = JSON.parse(data) as { type?: unknown; ts?: unknown; ack?: unknown };
    return frame.type === 'tick' ? { ...frame, type: 'tick' } : null;
  } catch {
    return null;
  }
}

function readPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
