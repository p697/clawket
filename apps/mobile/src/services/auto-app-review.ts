import { AppState, Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';
import { publicAppLinks } from '../config/public';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import { analyticsEvents } from './analytics/events';
import { completedReviewTurn, emptyReviewState, recordReviewAttempt, reviewEligibility, type AutoAppReviewState } from './auto-app-review-state';
import { StorageService } from './storage';

export type ManualAppReviewResult = 'review_prompt' | 'store_page' | 'unavailable' | 'error';
let persistenceQueue: Promise<unknown> = Promise.resolve();
let attemptedThisProcess = false;
function serial<T>(work: () => Promise<T>): Promise<T> {
  const task = persistenceQueue.then(work);
  persistenceQueue = task.catch(() => undefined);
  return task;
}
async function readState(): Promise<AutoAppReviewState> {
  return await StorageService.getAutoAppReviewState() ?? emptyReviewState();
}

/** Only a scoped, phone-initiated live turn with a normal, nonempty reply qualifies. */
export async function recordCompletedTurnForAutomaticReview(): Promise<void> {
  if (Platform.OS !== 'ios' || __DEV__) return;
  try {
    await serial(async () => {
      await StorageService.setAutoAppReviewState(completedReviewTurn(await readState(), Date.now()));
    });
  } catch { /* Review bookkeeping cannot change chat delivery. */ }
}

/** The caller owns a cancellable quiet window and revalidates it after each await. */
export async function requestAutomaticAppReview(isSafe: () => boolean): Promise<void> {
  if (Platform.OS !== 'ios' || __DEV__) return;
  await serial(async () => {
    const safe = () => !attemptedThisProcess && AppState.currentState === 'active' && isSafe();
    if (!safe()) return;
    try {
      const state = await readState();
      if (!safe()) return;
      const reason = reviewEligibility(state, Date.now(), APP_PACKAGE_VERSION);
      if (reason !== 'eligible') {
        analyticsEvents.appReviewRequest({ outcome: 'skipped', reason });
        return;
      }
      if (!await StoreReview.isAvailableAsync()) {
        if (safe()) analyticsEvents.appReviewRequest({ outcome: 'unavailable', reason: 'native' });
        return;
      }
      if (!safe()) return;
      // Persist before native dispatch; a crash or native no-op must not cause repeated requests.
      await StorageService.setAutoAppReviewState(recordReviewAttempt(state, Date.now(), APP_PACKAGE_VERSION));
      if (!safe()) return;
      attemptedThisProcess = true;
      analyticsEvents.appReviewRequest({ outcome: 'requested', reason: 'eligible' });
      await StoreReview.requestReview();
      // No API result proves display, a submitted review, or the user's star rating.
    } catch {
      analyticsEvents.appReviewRequest({ outcome: 'error', reason: 'operation' });
    }
  });
}

export async function requestManualAppReview(): Promise<ManualAppReviewResult> {
  // Keep Android's existing manual native flow; this change targets App Store growth.
  if (Platform.OS !== 'ios') {
    try {
      if (await StoreReview.isAvailableAsync()) { await StoreReview.requestReview(); return 'review_prompt'; }
      const url = StoreReview.storeUrl();
      if (url && await Linking.canOpenURL(url)) { await Linking.openURL(url); return 'store_page'; }
      return 'unavailable';
    } catch { return 'error'; }
  }
  const base = publicAppLinks.iosAppStoreId
    ? `https://apps.apple.com/app/id${publicAppLinks.iosAppStoreId}` : StoreReview.storeUrl();
  if (!base) return 'unavailable';
  const url = `${base}${base.includes('?') ? '&' : '?'}action=write-review`;
  attemptedThisProcess = true;
  // Suppress automatic requests even when storage is temporarily unavailable.
  try {
    await serial(async () => {
      const state = await readState();
      await StorageService.setAutoAppReviewState({ ...state, lastManualAtMs: Date.now() });
    });
  } catch { /* A manual store link must remain usable. */ }
  try { await Linking.openURL(url); return 'store_page'; } catch { return 'error'; }
}

export function __resetAutomaticAppReviewRuntimeForTests(): void {
  persistenceQueue = Promise.resolve();
  attemptedThisProcess = false;
}
