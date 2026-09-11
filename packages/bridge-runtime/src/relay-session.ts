export class RelaySessionState {
  private connectAttempt = 0;
  private lastActivityMs = 0;

  beginConnectAttempt(): number {
    this.connectAttempt += 1;
    return this.connectAttempt;
  }

  observeActivity(nowMs: number = Date.now()): void {
    this.lastActivityMs = nowMs;
  }

  confirmHealth(nowMs: number = Date.now()): boolean {
    this.observeActivity(nowMs);
    const reset = this.connectAttempt !== 0;
    this.connectAttempt = 0;
    return reset;
  }

  reconnectDelayMs(baseDelayMs: number, maxDelayMs: number): number {
    return Math.min(maxDelayMs, baseDelayMs * Math.max(1, this.connectAttempt));
  }

  heartbeatTimedOut(timeoutMs: number, nowMs: number = Date.now()): boolean {
    return nowMs - this.lastActivityMs > timeoutMs;
  }
}
