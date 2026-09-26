import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BorderWidth, Radius, StatusSize } from '../../theme/tokens';

export type StatusDotProps = Readonly<{
  color: string;
  /** The surface the dot sits on; the ring cuts the dot out of the mark beneath it. */
  ringColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/**
 * The one corner status dot: 12 points including a 2-point ring, 2 points
 * outside the bottom-right corner of its positioned parent. Avatar states and
 * connection marks share it so a green dot means the live connection everywhere.
 */
export function StatusDot({ color, ringColor, style, testID }: StatusDotProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[styles.dot, { backgroundColor: color, borderColor: ringColor }, style]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    right: -BorderWidth.strong,
    bottom: -BorderWidth.strong,
    width: StatusSize.attention,
    height: StatusSize.attention,
    borderRadius: Radius.full,
    borderWidth: BorderWidth.strong,
  },
});
