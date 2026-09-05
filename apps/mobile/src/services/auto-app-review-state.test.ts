import {
  AUTOMATIC_REVIEW_COLD_START_TARGET,
  AutoAppReviewState,
  normalizeAutoAppReviewState,
  persistAutoAppReviewStateEvent,
  transitionAutoAppReviewState,
} from './auto-app-review-state';

describe('automatic app review state', () => {
  it('does not count cold starts before the first successful send', () => {
    expect(transitionAutoAppReviewState(null, { type: 'cold_start', atMs: 1_000 })).toEqual({
      state: null,
      changed: false,
      shouldRequestReview: false,
    });
  });

  it('persists a pending request on the third cold start and consumes it only when an attempt starts', () => {
    let state: AutoAppReviewState | null = null;
    const sent = transitionAutoAppReviewState(state, { type: 'successful_send', atMs: 1_000 });
    state = sent.state;
    expect(sent.shouldRequestReview).toBe(false);

    for (let coldStart = 1; coldStart < AUTOMATIC_REVIEW_COLD_START_TARGET; coldStart += 1) {
      const transition = transitionAutoAppReviewState(state, {
        type: 'cold_start',
        atMs: 1_000 + coldStart,
      });
      state = transition.state;
      expect(transition.shouldRequestReview).toBe(false);
    }

    const third = transitionAutoAppReviewState(state, { type: 'cold_start', atMs: 2_000 });
    expect(third.shouldRequestReview).toBe(true);
    expect(third.state).toEqual({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 3,
      reviewPendingAtMs: 2_000,
    });

    const later = transitionAutoAppReviewState(third.state, { type: 'cold_start', atMs: 3_000 });
    expect(later).toEqual({ state: third.state, changed: false, shouldRequestReview: true });

    const attempted = transitionAutoAppReviewState(later.state, {
      type: 'review_attempt_started',
      atMs: 3_001,
    });
    expect(attempted).toEqual({
      state: {
        version: 2,
        firstSuccessfulSendAtMs: 1_000,
        coldStartsAfterFirstSuccessfulSend: 3,
        reviewAttemptedAtMs: 3_001,
      },
      changed: true,
      shouldRequestReview: true,
    });
    expect(transitionAutoAppReviewState(attempted.state, { type: 'cold_start', atMs: 4_000 }))
      .toEqual({ state: attempted.state, changed: false, shouldRequestReview: false });
  });

  it('does not reset the launch counter on later successful sends', () => {
    const state: AutoAppReviewState = {
      version: 2,
      firstSuccessfulSendAtMs: 100,
      coldStartsAfterFirstSuccessfulSend: 2,
    };
    expect(transitionAutoAppReviewState(state, { type: 'successful_send', atMs: 500 }))
      .toEqual({ state, changed: false, shouldRequestReview: false });
  });

  it('migrates legacy attempts but never mistakes first-seen time for a successful send', () => {
    expect(normalizeAutoAppReviewState({
      firstSeenAtMs: 10,
      lastAttemptAtMs: 20,
      lastAttemptVersion: '2.1.2',
    })).toEqual({
      version: 2,
      coldStartsAfterFirstSuccessfulSend: 0,
      reviewAttemptedAtMs: 20,
    });
    expect(normalizeAutoAppReviewState({ firstSeenAtMs: 10 })).toEqual({
      version: 2,
      coldStartsAfterFirstSuccessfulSend: 0,
    });
    expect(normalizeAutoAppReviewState({ coldStartsAfterFirstSuccessfulSend: 2 })).toBeNull();
  });

  it('persists only changed transitions before returning the prompt decision', async () => {
    let state: AutoAppReviewState | null = {
      version: 2,
      firstSuccessfulSendAtMs: 100,
      coldStartsAfterFirstSuccessfulSend: 2,
    };
    const store = {
      getAutoAppReviewState: jest.fn(async () => state),
      setAutoAppReviewState: jest.fn(async (next: AutoAppReviewState) => {
        state = next;
      }),
    };

    await expect(persistAutoAppReviewStateEvent(store, { type: 'cold_start', atMs: 500 }))
      .resolves.toMatchObject({ shouldRequestReview: true, changed: true });
    expect(store.setAutoAppReviewState).toHaveBeenCalledWith(expect.objectContaining({
      coldStartsAfterFirstSuccessfulSend: 3,
      reviewPendingAtMs: 500,
    }));

    store.setAutoAppReviewState.mockClear();
    await expect(persistAutoAppReviewStateEvent(store, { type: 'cold_start', atMs: 600 }))
      .resolves.toMatchObject({ shouldRequestReview: true, changed: false });
    expect(store.setAutoAppReviewState).not.toHaveBeenCalled();

    await expect(persistAutoAppReviewStateEvent(store, {
      type: 'review_attempt_started',
      atMs: 700,
    })).resolves.toMatchObject({ shouldRequestReview: true, changed: true });
    expect(store.setAutoAppReviewState).toHaveBeenCalledWith(expect.objectContaining({
      reviewAttemptedAtMs: 700,
    }));
  });

  it('propagates persistence failure instead of authorizing the one-time side effect', async () => {
    const store = {
      getAutoAppReviewState: jest.fn(async () => ({
        version: 2 as const,
        firstSuccessfulSendAtMs: 100,
        coldStartsAfterFirstSuccessfulSend: 2,
      })),
      setAutoAppReviewState: jest.fn(async () => {
        throw new Error('disk full');
      }),
    };

    await expect(persistAutoAppReviewStateEvent(store, { type: 'cold_start', atMs: 500 }))
      .rejects.toThrow('disk full');
  });
});
