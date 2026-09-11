export const AUTOMATIC_REVIEW_COLD_START_TARGET = 3;

export type AutoAppReviewState = {
  version: 2;
  firstSuccessfulSendAtMs?: number;
  coldStartsAfterFirstSuccessfulSend: number;
  reviewPendingAtMs?: number;
  reviewAttemptedAtMs?: number;
};

export type AutoAppReviewStateEvent = {
  type: 'successful_send' | 'cold_start' | 'review_attempt_started';
  atMs: number;
};

export type AutoAppReviewStateTransition = {
  state: AutoAppReviewState | null;
  changed: boolean;
  shouldRequestReview: boolean;
};

export type AutoAppReviewStateStore = {
  getAutoAppReviewState(): Promise<AutoAppReviewState | null>;
  setAutoAppReviewState(state: AutoAppReviewState): Promise<void>;
};

function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function normalizeAutoAppReviewState(value: unknown): AutoAppReviewState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const firstSuccessfulSendAtMs = positiveFiniteNumber(record.firstSuccessfulSendAtMs);
  const reviewAttemptedAtMs = positiveFiniteNumber(record.reviewAttemptedAtMs)
    // Conservative compatibility for an earlier v2 draft and the legacy v1 shape.
    ?? positiveFiniteNumber(record.reviewRequestedAtMs)
    // A user who saw the legacy prompt must not be prompted again during migration.
    ?? positiveFiniteNumber(record.lastAttemptAtMs);
  const reviewPendingAtMs = reviewAttemptedAtMs === undefined && firstSuccessfulSendAtMs !== undefined
    ? positiveFiniteNumber(record.reviewPendingAtMs)
    : undefined;
  const rawColdStarts = typeof record.coldStartsAfterFirstSuccessfulSend === 'number'
    && Number.isFinite(record.coldStartsAfterFirstSuccessfulSend)
    ? Math.floor(record.coldStartsAfterFirstSuccessfulSend)
    : 0;
  const coldStartsAfterFirstSuccessfulSend = Math.max(
    0,
    Math.min(AUTOMATIC_REVIEW_COLD_START_TARGET, rawColdStarts),
  );
  const recognized = record.version === 2
    || firstSuccessfulSendAtMs !== undefined
    || reviewPendingAtMs !== undefined
    || reviewAttemptedAtMs !== undefined
    // Recognize the old v1 shape without treating first use as a successful send.
    || positiveFiniteNumber(record.firstSeenAtMs) !== undefined;
  if (!recognized) return null;

  return {
    version: 2,
    coldStartsAfterFirstSuccessfulSend,
    ...(firstSuccessfulSendAtMs !== undefined ? { firstSuccessfulSendAtMs } : {}),
    ...(reviewPendingAtMs !== undefined ? { reviewPendingAtMs } : {}),
    ...(reviewAttemptedAtMs !== undefined ? { reviewAttemptedAtMs } : {}),
  };
}

export function transitionAutoAppReviewState(
  state: AutoAppReviewState | null,
  event: AutoAppReviewStateEvent,
): AutoAppReviewStateTransition {
  if (!Number.isFinite(event.atMs) || event.atMs <= 0) {
    return { state, changed: false, shouldRequestReview: false };
  }

  if (event.type === 'successful_send') {
    const current = state ?? {
      version: 2 as const,
      coldStartsAfterFirstSuccessfulSend: 0,
    };
    if (current.firstSuccessfulSendAtMs !== undefined || current.reviewAttemptedAtMs !== undefined) {
      return { state: current, changed: false, shouldRequestReview: false };
    }
    return {
      state: { ...current, firstSuccessfulSendAtMs: event.atMs },
      changed: true,
      shouldRequestReview: false,
    };
  }

  if (event.type === 'review_attempt_started') {
    if (!state?.reviewPendingAtMs || state.reviewAttemptedAtMs !== undefined) {
      return { state, changed: false, shouldRequestReview: false };
    }
    const { reviewPendingAtMs: _, ...withoutPending } = state;
    return {
      state: { ...withoutPending, reviewAttemptedAtMs: event.atMs },
      changed: true,
      shouldRequestReview: true,
    };
  }

  if (!state || state.firstSuccessfulSendAtMs === undefined || state.reviewAttemptedAtMs !== undefined) {
    return { state, changed: false, shouldRequestReview: false };
  }

  // A persisted pending trigger survives termination before the delayed native attempt.
  if (state.reviewPendingAtMs !== undefined) {
    return { state, changed: false, shouldRequestReview: true };
  }

  const coldStartsAfterFirstSuccessfulSend = Math.min(
    AUTOMATIC_REVIEW_COLD_START_TARGET,
    state.coldStartsAfterFirstSuccessfulSend + 1,
  );
  const shouldRequestReview = coldStartsAfterFirstSuccessfulSend === AUTOMATIC_REVIEW_COLD_START_TARGET;
  return {
    state: {
      ...state,
      coldStartsAfterFirstSuccessfulSend,
      ...(shouldRequestReview ? { reviewPendingAtMs: event.atMs } : {}),
    },
    changed: true,
    shouldRequestReview,
  };
}

export async function persistAutoAppReviewStateEvent(
  store: AutoAppReviewStateStore,
  event: AutoAppReviewStateEvent,
): Promise<AutoAppReviewStateTransition> {
  const transition = transitionAutoAppReviewState(await store.getAutoAppReviewState(), event);
  if (transition.changed && transition.state) {
    await store.setAutoAppReviewState(transition.state);
  }
  return transition;
}
