import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import LottieView from 'lottie-react-native';

type Props = {
  source: object;
  style?: StyleProp<ViewStyle>;
  size?: number;
  autoPlay?: boolean;
  loop?: boolean;
};

/**
 * Thin Lottie wrapper for pairing onboarding cards.
 * Falls back to an empty sized box if the native module is unavailable in tests.
 */
export function PairingTransportLottie({
  source,
  style,
  size = 88,
  autoPlay = true,
  loop = true,
}: Props): React.JSX.Element {
  const boxStyle = useMemo(
    () => [{ width: size, height: size }, styles.box, style],
    [size, style],
  );

  if (!LottieView) {
    return <View style={boxStyle} />;
  }

  return (
    <View style={boxStyle}>
      <LottieView
        source={source as any}
        autoPlay={autoPlay}
        loop={loop}
        style={styles.animation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  animation: {
    width: '100%',
    height: '100%',
  },
});
