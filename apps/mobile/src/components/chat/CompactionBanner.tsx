import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';

export function CompactionBanner({ message }: { message: string }): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    banner: {
      backgroundColor: colors.accentSoft,
      borderBottomColor: colors.line,
      borderBottomWidth: 1,
      paddingHorizontal: Space.lg,
      paddingVertical: 6,
      alignItems: 'center',
    },
    text: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
  });
}
