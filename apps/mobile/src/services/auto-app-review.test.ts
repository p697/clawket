jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: (callback: () => void) => callback(),
  },
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
  Platform: {
    OS: 'ios',
  },
}));

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(),
  requestReview: jest.fn(),
  storeUrl: jest.fn(),
}));

jest.mock('./storage', () => ({
  StorageService: {
    getAutoAppReviewState: jest.fn(),
    setAutoAppReviewState: jest.fn(),
  },
}));

import * as StoreReview from 'expo-store-review';
import { Linking } from 'react-native';
import {
  __resetAutomaticAppReviewRuntimeForTests,
  recordSuccessfulSendForAutomaticReview,
  requestManualAppReview,
  scheduleAutomaticAppReviewForColdStart,
} from './auto-app-review';
import type { AutoAppReviewState } from './auto-app-review-state';
import { StorageService } from './storage';

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('auto app review', () => {
  const mockedStoreReview = StoreReview as jest.Mocked<typeof StoreReview>;
  const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
  const mockedLinking = Linking as jest.Mocked<typeof Linking>;
  let persistedState: AutoAppReviewState | null;

  function usePersistedState(state: AutoAppReviewState | null): void {
    persistedState = state;
    mockedStorage.getAutoAppReviewState.mockImplementation(async () => persistedState);
    mockedStorage.setAutoAppReviewState.mockImplementation(async (next) => {
      persistedState = next;
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetAutomaticAppReviewRuntimeForTests();
    usePersistedState(null);
  });

  afterEach(() => {
    __resetAutomaticAppReviewRuntimeForTests();
    jest.useRealTimers();
  });

  it('records only the first successful adapter send', async () => {
    await recordSuccessfulSendForAutomaticReview({ nowMs: 1_000 });

    expect(mockedStorage.setAutoAppReviewState).toHaveBeenCalledWith({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 0,
    });

    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 1,
    });
    mockedStorage.setAutoAppReviewState.mockClear();
    await recordSuccessfulSendForAutomaticReview({ nowMs: 2_000 });
    expect(mockedStorage.setAutoAppReviewState).not.toHaveBeenCalled();
  });

  it('does not count or prompt on a cold start before a successful send', async () => {
    await expect(scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 1_000 }))
      .resolves.toBe(false);
    expect(mockedStorage.setAutoAppReviewState).not.toHaveBeenCalled();
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('counts at most once when cold-start bootstrap is invoked repeatedly in one process', async () => {
    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 0,
    });

    const first = scheduleAutomaticAppReviewForColdStart({ nowMs: 2_000 });
    const duplicate = scheduleAutomaticAppReviewForColdStart({ nowMs: 2_001 });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([false, false]);
    expect(mockedStorage.getAutoAppReviewState).toHaveBeenCalledTimes(1);
    expect(mockedStorage.setAutoAppReviewState).toHaveBeenCalledTimes(1);
    expect(mockedStorage.setAutoAppReviewState).toHaveBeenCalledWith(expect.objectContaining({
      coldStartsAfterFirstSuccessfulSend: 1,
    }));
  });

  it('persists and schedules the request on the third later cold start', async () => {
    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 2,
    });
    mockedStoreReview.isAvailableAsync.mockResolvedValueOnce(true);
    mockedStoreReview.requestReview.mockResolvedValueOnce();

    await expect(scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 4_000 }))
      .resolves.toBe(true);
    expect(mockedStorage.setAutoAppReviewState).toHaveBeenCalledWith({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 3,
      reviewPendingAtMs: 4_000,
    });
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();

    jest.runAllTimers();
    await flushMicrotasks();
    expect(mockedStorage.setAutoAppReviewState).toHaveBeenLastCalledWith(expect.objectContaining({
      coldStartsAfterFirstSuccessfulSend: 3,
      reviewAttemptedAtMs: expect.any(Number),
    }));
    expect(mockedStoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it('keeps the third-start trigger pending until a later cold start can reach the native prompt', async () => {
    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 2,
    });
    mockedStoreReview.isAvailableAsync.mockResolvedValueOnce(false);

    await scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 4_000 });
    jest.runAllTimers();
    await flushMicrotasks();

    expect(persistedState).toEqual({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 3,
      reviewPendingAtMs: 4_000,
    });
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();

    __resetAutomaticAppReviewRuntimeForTests();
    mockedStoreReview.isAvailableAsync.mockResolvedValueOnce(true);
    mockedStoreReview.requestReview.mockResolvedValueOnce();
    await expect(scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 5_000 }))
      .resolves.toBe(true);
    jest.runAllTimers();
    await flushMicrotasks();

    expect(persistedState).toEqual(expect.objectContaining({
      coldStartsAfterFirstSuccessfulSend: 3,
      reviewAttemptedAtMs: expect.any(Number),
    }));
    expect(mockedStoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it('contains native availability failures without consuming the pending trigger', async () => {
    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 2,
    });
    mockedStoreReview.isAvailableAsync.mockRejectedValueOnce(new Error('native failure'));

    await expect(scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 4_000 }))
      .resolves.toBe(true);
    jest.runAllTimers();
    await flushMicrotasks();

    expect(persistedState).toEqual(expect.objectContaining({ reviewPendingAtMs: 4_000 }));
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('does not schedule a prompt when the pending marker cannot be persisted', async () => {
    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 2,
    });
    mockedStorage.setAutoAppReviewState.mockRejectedValueOnce(new Error('disk full'));

    await expect(scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 4_000 }))
      .resolves.toBe(false);
    jest.runAllTimers();
    await flushMicrotasks();

    expect(mockedStoreReview.isAvailableAsync).not.toHaveBeenCalled();
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('does not call the native prompt when persisting the attempt fails', async () => {
    usePersistedState({
      version: 2,
      firstSuccessfulSendAtMs: 1_000,
      coldStartsAfterFirstSuccessfulSend: 2,
    });
    mockedStoreReview.isAvailableAsync.mockResolvedValueOnce(true);

    await expect(scheduleAutomaticAppReviewForColdStart({ delayMs: 0, nowMs: 4_000 }))
      .resolves.toBe(true);
    mockedStorage.setAutoAppReviewState.mockRejectedValueOnce(new Error('disk full'));
    jest.runAllTimers();
    await flushMicrotasks();

    expect(persistedState).toEqual(expect.objectContaining({ reviewPendingAtMs: 4_000 }));
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('opens the native review prompt on a manual request', async () => {
    mockedStoreReview.isAvailableAsync.mockResolvedValueOnce(true);
    mockedStoreReview.requestReview.mockResolvedValueOnce();

    await expect(requestManualAppReview()).resolves.toBe('review_prompt');
    expect(mockedStoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(mockedLinking.openURL).not.toHaveBeenCalled();
  });

  it('falls back to the store page and reports unavailable devices', async () => {
    mockedStoreReview.isAvailableAsync.mockResolvedValue(false);
    mockedStoreReview.storeUrl.mockReturnValue('https://store.example/clawket');
    mockedLinking.canOpenURL.mockResolvedValueOnce(true);
    mockedLinking.openURL.mockResolvedValueOnce(true);

    await expect(requestManualAppReview()).resolves.toBe('store_page');
    expect(mockedLinking.openURL).toHaveBeenCalledWith('https://store.example/clawket');

    mockedLinking.canOpenURL.mockResolvedValueOnce(false);
    await expect(requestManualAppReview()).resolves.toBe('unavailable');
  });

  it('contains native failures in a manual request', async () => {
    mockedStoreReview.isAvailableAsync.mockRejectedValueOnce(new Error('native failure'));
    await expect(requestManualAppReview()).resolves.toBe('error');
  });
});
