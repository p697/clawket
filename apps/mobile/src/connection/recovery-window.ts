/** One presentation deadline per outage, independent of adapter retry attempts. */
export const CONNECTION_RECOVERY_GRACE_MS = 20_000;

export class ConnectionRecoveryWindow {
  phase: 'recovering' | 'failed' | null = null;
  private active = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onDeadline: () => void) {}

  begin(reset = false): void {
    if (this.phase !== null && !reset) return;
    this.clearTimer();
    this.phase = 'recovering';
    if (this.active) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.phase = 'failed';
        this.onDeadline();
      }, CONNECTION_RECOVERY_GRACE_MS);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.clearTimer();
    // Background suspension is not time spent trying to recover in front of the user.
    if (this.phase !== null) this.begin(true);
  }

  finish(): void {
    this.clearTimer();
    this.phase = null;
  }

  fail(): void {
    this.clearTimer();
    this.phase = 'failed';
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function requiresConnectionAction(reason?: string): boolean {
  return /pairing[_ ]required|auth[_ ]rejected|invalid[_ ]token|token[_ ]revoked|permission[_ ]denied/i.test(reason ?? '');
}
