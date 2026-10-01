import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';
import {
  triggerDragEndHaptic,
  triggerDragStartHaptic,
  triggerHeavyImpact,
  triggerLightImpact,
  triggerMediumImpact,
  triggerRigidImpact,
  triggerSelectionHaptic,
  triggerSendHaptic,
  triggerSuccessHaptic,
  triggerWarningHaptic,
} from './haptics';

describe('haptics service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('triggers light impact haptics', () => {
    triggerLightImpact();

    expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith(ExpoHaptics.ImpactFeedbackStyle.Light);
  });

  it('triggers rigid impact haptics', () => {
    triggerRigidImpact();

    expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith(ExpoHaptics.ImpactFeedbackStyle.Rigid);
  });

  it('triggers selection haptics', () => {
    triggerSelectionHaptic();

    expect(ExpoHaptics.selectionAsync).toHaveBeenCalled();
  });

  it('triggers medium and heavy impacts', () => {
    triggerMediumImpact();
    triggerHeavyImpact();

    expect(ExpoHaptics.impactAsync).toHaveBeenNthCalledWith(1, ExpoHaptics.ImpactFeedbackStyle.Medium);
    expect(ExpoHaptics.impactAsync).toHaveBeenNthCalledWith(2, ExpoHaptics.ImpactFeedbackStyle.Heavy);
  });

  it('uses light impact for drag start and end', () => {
    triggerDragStartHaptic();
    triggerDragEndHaptic();

    expect(ExpoHaptics.impactAsync).toHaveBeenNthCalledWith(1, ExpoHaptics.ImpactFeedbackStyle.Light);
    expect(ExpoHaptics.impactAsync).toHaveBeenNthCalledWith(2, ExpoHaptics.ImpactFeedbackStyle.Light);
  });

  it.each(['ios', 'android'] as const)('plays the conversation beats on %s (A+: send Light, done Success, waiting or failed Warning)', (os) => {
    const replaced = jest.replaceProperty(Platform, 'OS', os);
    try {
      triggerSendHaptic();
      triggerSuccessHaptic();
      triggerWarningHaptic();
    } finally {
      replaced.restore();
    }
    if (os === 'ios') {
      expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith(ExpoHaptics.ImpactFeedbackStyle.Light);
      expect(ExpoHaptics.notificationAsync).toHaveBeenNthCalledWith(1, ExpoHaptics.NotificationFeedbackType.Success);
      expect(ExpoHaptics.notificationAsync).toHaveBeenNthCalledWith(2, ExpoHaptics.NotificationFeedbackType.Warning);
      expect(ExpoHaptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    } else {
      // Android uses the system's own haptic constants, not a vibrator pattern.
      expect(ExpoHaptics.performAndroidHapticsAsync).toHaveBeenNthCalledWith(1, ExpoHaptics.AndroidHaptics.Virtual_Key);
      expect(ExpoHaptics.performAndroidHapticsAsync).toHaveBeenNthCalledWith(2, ExpoHaptics.AndroidHaptics.Confirm);
      expect(ExpoHaptics.performAndroidHapticsAsync).toHaveBeenNthCalledWith(3, ExpoHaptics.AndroidHaptics.Reject);
      expect(ExpoHaptics.impactAsync).not.toHaveBeenCalled();
      expect(ExpoHaptics.notificationAsync).not.toHaveBeenCalled();
    }
  });
});
