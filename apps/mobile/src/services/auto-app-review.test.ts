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

jest.mock('../constants/app-version', () => ({
  APP_PACKAGE_VERSION: '1.2.3',
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
  requestManualAppReview,
  scheduleAutomaticAppReview,
  shouldAttemptAutomaticReview,
} from './auto-app-review';
import { StorageService } from './storage';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('auto app review', () => {
  const mockedStoreReview = StoreReview as jest.Mocked<typeof StoreReview>;
  const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
  const mockedLinking = Linking as jest.Mocked<typeof Linking>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('requires at least one day of use before attempting', () => {
    expect(shouldAttemptAutomaticReview({
      nowMs: 2 * 24 * 60 * 60 * 1000,
      appVersion: '1.2.3',
      state: {
        firstSeenAtMs: 24 * 60 * 60 * 1000 + 1,
      },
    })).toBe(false);
  });

  it('blocks repeated attempts in the same app version', () => {
    expect(shouldAttemptAutomaticReview({
      nowMs: 100 * 24 * 60 * 60 * 1000,
      appVersion: '1.2.3',
      state: {
        firstSeenAtMs: 1,
        lastAttemptAtMs: 99 * 24 * 60 * 60 * 1000,
        lastAttemptVersion: '1.2.3',
      },
    })).toBe(false);
  });

  it('blocks repeated attempts within thirty days', () => {
    expect(shouldAttemptAutomaticReview({
      nowMs: 100 * 24 * 60 * 60 * 1000,
      appVersion: '1.2.4',
      state: {
        firstSeenAtMs: 1,
        lastAttemptAtMs: 80 * 24 * 60 * 60 * 1000 + 1,
        lastAttemptVersion: '1.2.2',
      },
    })).toBe(false);
  });

  it('stores first-seen time instead of prompting on the first eligible trigger', async () => {
    mockedStorage.getAutoAppReviewState.mockResolvedValueOnce(null);

    scheduleAutomaticAppReview('agent_created', { delayMs: 0 });
    jest.runAllTimers();
    await flushMicrotasks();

    expect(mockedStorage.setAutoAppReviewState).toHaveBeenCalledWith({
      firstSeenAtMs: expect.any(Number),
    });
    expect(mockedStoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('requests review and records the attempt when all gates pass', async () => {
    mockedStorage.getAutoAppReviewState.mockResolvedValueOnce({
      firstSeenAtMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
    });
    mockedStoreReview.isAvailableAsync.mockResolvedValueOnce(true);
    mockedStoreReview.requestReview.mockResolvedValueOnce();

    scheduleAutomaticAppReview('cron_created', { delayMs: 0 });
    jest.runAllTimers();
    await flushMicrotasks();

    expect(mockedStoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(mockedStorage.setAutoAppReviewState).toHaveBeenCalledWith({
      firstSeenAtMs: expect.any(Number),
      lastAttemptAtMs: expect.any(Number),
      lastAttemptVersion: '1.2.3',
    });
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
