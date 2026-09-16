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

  activityAgeMs(nowMs: number = Date.now()): number {
    return Math.max(0, nowMs - this.lastActivityMs);
  }

  heartbeatTimedOut(timeoutMs: number, nowMs: number = Date.now()): boolean {
    return this.activityAgeMs(nowMs) > timeoutMs;
  }
}
