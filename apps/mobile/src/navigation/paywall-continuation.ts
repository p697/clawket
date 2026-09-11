export type PaywallContinuation = () => void | Promise<void>;

export function consumeAcceptedPaywallPresentation(
  present: () => boolean,
  consume: () => void,
): boolean {
  if (!present()) return false;
  consume();
  return true;
}

export class PaywallContinuationCoordinator {
  private continuation: PaywallContinuation | null = null;

  tryPresent(
    openPaywall: () => boolean,
    continuation?: PaywallContinuation,
  ): boolean {
    if (!openPaywall()) return false;
    this.continuation = continuation ?? null;
    return true;
  }

  clear(): void {
    this.continuation = null;
  }

  take(): PaywallContinuation | null {
    const continuation = this.continuation;
    this.continuation = null;
    return continuation;
  }
}
