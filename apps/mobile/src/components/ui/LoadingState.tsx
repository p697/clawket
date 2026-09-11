import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { Companion, type CompanionPose } from './Companion';

type Props = {
  message?: string;
  pose?: CompanionPose;
  testID?: string;
};

export function LoadingState({ message, pose = 'loading', testID }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View testID={testID} style={styles.root} accessible accessibilityRole="progressbar" accessibilityLabel={message} accessibilityState={{ busy: true }}>
      <Companion pose={pose} />
      {message ? <Text style={[styles.text, { color: theme.colors.ink }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
  },
  text: {
      marginTop: Space.xl,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    textAlign: 'center',
  },
});
