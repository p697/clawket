import {
  consumeAcceptedPaywallPresentation,
  PaywallContinuationCoordinator,
} from './paywall-continuation';

describe('consumeAcceptedPaywallPresentation', () => {
  it.each(['generic', 'three-point-zero intro'])(
    'keeps a blocked %s attempt retryable and consumes only the accepted attempt',
    () => {
      const present = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      const consume = jest.fn();

      expect(consumeAcceptedPaywallPresentation(present, consume)).toBe(false);
      expect(consume).not.toHaveBeenCalled();
      expect(consumeAcceptedPaywallPresentation(present, consume)).toBe(true);
      expect(consume).toHaveBeenCalledTimes(1);
    },
  );
});

describe('PaywallContinuationCoordinator', () => {
  it('keeps the first continuation when a visible paywall rejects a second gate', () => {
    const coordinator = new PaywallContinuationCoordinator();
    const first = jest.fn();
    const second = jest.fn();

    expect(coordinator.tryPresent(() => true, first)).toBe(true);
    expect(coordinator.tryPresent(() => false, second)).toBe(false);

    coordinator.take()?.();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(coordinator.take()).toBeNull();
  });

  it('clears a dismissed continuation without running it', () => {
    const coordinator = new PaywallContinuationCoordinator();
    const continuation = jest.fn();

    coordinator.tryPresent(() => true, continuation);
    coordinator.clear();

    expect(coordinator.take()).toBeNull();
    expect(continuation).not.toHaveBeenCalled();
  });
});
