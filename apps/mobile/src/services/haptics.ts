import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function fireAndForget(task: Promise<unknown> | void): void {
  void Promise.resolve(task).catch(() => {});
}

export function triggerLightImpact(): void {
  fireAndForget(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function triggerRigidImpact(): void {
  fireAndForget(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid));
}

export function triggerSelectionHaptic(): void {
  fireAndForget(Haptics.selectionAsync());
}

export function triggerMediumImpact(): void {
  fireAndForget(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A hard knock for the Companion's claw swipe. */
export function triggerHeavyImpact(): void {
  fireAndForget(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

export function triggerDragStartHaptic(): void {
  triggerLightImpact();
}

export function triggerDragEndHaptic(): void {
  triggerLightImpact();
}

/*
 * Conversation beats (A+ chat design, owner-approved 2026-09-30): sending is
 * Light, a finished reply is Success, a failure or a request waiting for you
 * is Warning, and streaming stays silent. Android uses the system's own
 * haptic constants, which are crisper than a vibrator pattern and follow the
 * user's touch-feedback setting.
 */
export function triggerSendHaptic(): void {
  if (Platform.OS === 'android') {
    fireAndForget(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key));
    return;
  }
  triggerLightImpact();
}

export function triggerSuccessHaptic(): void {
  if (Platform.OS === 'android') {
    fireAndForget(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm));
    return;
  }
  fireAndForget(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function triggerWarningHaptic(): void {
  if (Platform.OS === 'android') {
    fireAndForget(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject));
    return;
  }
  fireAndForget(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
