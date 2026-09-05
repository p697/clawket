import { InteractionManager, Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import { publicAppLinks } from '../config/public';
import { AutoAppReviewState, StorageService } from './storage';

export type AutoAppReviewTrigger =
  | 'agent_created'
  | 'cron_created'
  | 'model_added';

export type ManualAppReviewResult =
  | 'review_prompt'
  | 'store_page'
  | 'unavailable'
  | 'error';

const MIN_FIRST_USE_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_BETWEEN_ATTEMPTS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DELAY_MS = 900;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightAttempt: Promise<boolean> | null = null;

export function shouldAttemptAutomaticReview(params: {
  nowMs: number;
  appVersion: string;
  state: AutoAppReviewState | null;
}): boolean {
  const { appVersion, nowMs, state } = params;
  if (!state) return false;
  if (nowMs - state.firstSeenAtMs < MIN_FIRST_USE_AGE_MS) return false;
  if (state.lastAttemptVersion === appVersion) return false;
  if (typeof state.lastAttemptAtMs === 'number' && nowMs - state.lastAttemptAtMs < MIN_BETWEEN_ATTEMPTS_MS) {
    return false;
  }
  return true;
}

function runAfterInteractions(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

async function attemptAutomaticReview(_trigger: AutoAppReviewTrigger): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (inFlightAttempt) return inFlightAttempt;

  inFlightAttempt = (async () => {
    await runAfterInteractions();

    const nowMs = Date.now();
    const existingState = await StorageService.getAutoAppReviewState();
    if (!existingState) {
      await StorageService.setAutoAppReviewState({ firstSeenAtMs: nowMs });
      return false;
    }

    if (!shouldAttemptAutomaticReview({
      nowMs,
      appVersion: APP_PACKAGE_VERSION,
      state: existingState,
    })) {
      return false;
    }

    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;

    await StorageService.setAutoAppReviewState({
      ...existingState,
      lastAttemptAtMs: nowMs,
      lastAttemptVersion: APP_PACKAGE_VERSION,
    });

    try {
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

export function scheduleAutomaticAppReview(
  trigger: AutoAppReviewTrigger,
  options?: { delayMs?: number },
): void {
  if (Platform.OS !== 'ios') return;
  if (pendingTimer || inFlightAttempt) return;

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void attemptAutomaticReview(trigger);
  }, options?.delayMs ?? DEFAULT_DELAY_MS);
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
