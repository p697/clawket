import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { ControlSize } from '../../theme/tokens';
import { PresenceRing } from './PresenceRing';

/** Session tiles share the header's native arc and reduced-motion behavior. */
export function SessionActivityRing({ testID }: { testID: string }) {
  const { theme } = useAppTheme();
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <PresenceRing tone="working" avatarSize={ControlSize.pill} color={theme.colors.accent} testID={testID} />
  </View>;
}
