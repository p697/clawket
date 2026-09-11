import { InteractionManager, Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';
import { publicAppLinks } from '../config/public';
import {
  persistAutoAppReviewStateEvent,
  type AutoAppReviewStateEvent,
} from './auto-app-review-state';
import { StorageService } from './storage';

export type ManualAppReviewResult =
  | 'review_prompt'
  | 'store_page'
  | 'unavailable'
  | 'error';

const DEFAULT_DELAY_MS = 900;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightAttempt: Promise<boolean> | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let coldStartTask: Promise<boolean> | null = null;

function runAfterInteractions(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

function persistEventSerially(
  type: AutoAppReviewStateEvent['type'],
  atMs: number,
): Promise<Awaited<ReturnType<typeof persistAutoAppReviewStateEvent>>> {
  const task = persistenceQueue.then(() => persistAutoAppReviewStateEvent(
    StorageService,
    { type, atMs },
  ));
  persistenceQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function attemptAutomaticReview(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (inFlightAttempt) return inFlightAttempt;

  inFlightAttempt = (async () => {
    await runAfterInteractions();
    try {
      if (!await StoreReview.isAvailableAsync()) return false;
      const transition = await persistEventSerially('review_attempt_started', Date.now());
      if (!transition.shouldRequestReview) return false;
      await StoreReview.requestReview();
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await inFlightAttempt;
  } finally {
    inFlightAttempt = null;
  }
}

/** Call only after adapter.prompt has resolved successfully, never on a send tap. */
export async function recordSuccessfulSendForAutomaticReview(
  options: { nowMs?: number } = {},
): Promise<void> {
  try {
    await persistEventSerially('successful_send', options.nowMs ?? Date.now());
  } catch {
    // The send path must remain successful when this best-effort marker cannot persist.
  }
}

/** Call once during a true cold-start bootstrap; foreground transitions do not count. */
export async function scheduleAutomaticAppReviewForColdStart(
  options: { delayMs?: number; nowMs?: number } = {},
): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (coldStartTask) return coldStartTask;
  coldStartTask = (async () => {
    let transition: Awaited<ReturnType<typeof persistAutoAppReviewStateEvent>>;
    try {
      transition = await persistEventSerially('cold_start', options.nowMs ?? Date.now());
    } catch {
      // Never prompt unless the pending trigger was durably recorded first.
      return false;
    }
    if (!transition.shouldRequestReview || pendingTimer || inFlightAttempt) return false;

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void attemptAutomaticReview();
    }, options.delayMs ?? DEFAULT_DELAY_MS);
    return true;
  })();
  return coldStartTask;
}

export function __resetAutomaticAppReviewRuntimeForTests(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  inFlightAttempt = null;
  persistenceQueue = Promise.resolve();
  coldStartTask = null;
}

export async function requestManualAppReview(): Promise<ManualAppReviewResult> {
  const configuredStoreUrl = Platform.OS === 'ios' && publicAppLinks.iosAppStoreId
    ? `itms-apps://itunes.apple.com/app/id${publicAppLinks.iosAppStoreId}?action=write-review`
    : null;

  try {
    if (await StoreReview.isAvailableAsync()) {
      await StoreReview.requestReview();
      return 'review_prompt';
    }

    const storeUrl = configuredStoreUrl ?? StoreReview.storeUrl();
    if (storeUrl && await Linking.canOpenURL(storeUrl)) {
      await Linking.openURL(storeUrl);
      return 'store_page';
    }
    return 'unavailable';
  } catch {
    return 'error';
  }
}
