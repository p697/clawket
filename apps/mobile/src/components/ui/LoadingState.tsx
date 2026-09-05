import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, Space } from '../../theme/tokens';

type Props = {
  message?: string;
};

export function LoadingState({ message }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" color={theme.colors.accent} />
      {message ? <Text style={[styles.text, { color: theme.colors.inkSecondary }]}>{message}</Text> : null}
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
    marginTop: Space.md,
    fontSize: FontSize.caption,
    textAlign: 'center',
  },
});
