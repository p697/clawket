import { shouldPreserveOptimisticAssistant } from './cacheHydrationPolicy';

describe('shouldPreserveOptimisticAssistant', () => {
  it('returns false during pending cache hydration for the same session', () => {
    expect(shouldPreserveOptimisticAssistant({
      pendingHydrationSessionKey: 'agent:main:main',
      targetSessionKey: 'agent:main:main',
    })).toBe(false);
  });

  it('returns true when hydration is pending for a different session', () => {
    expect(shouldPreserveOptimisticAssistant({
      pendingHydrationSessionKey: 'agent:other:main',
      targetSessionKey: 'agent:main:main',
    })).toBe(true);
  });
});
