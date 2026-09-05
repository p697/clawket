import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

export type ConnectionHelpStep = {
  title: string;
  body: React.ReactNode;
};

type Props = {
  steps: ConnectionHelpStep[];
};

export function ConnectionHelpStepList({ steps }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <>
      {steps.map((step, index) => (
        <View key={index} style={[styles.step, index === steps.length - 1 && styles.stepLast]}>
          <View style={styles.stepLeft}>
            <View style={styles.numCircle}>
              <Text style={styles.numText}>{index + 1}</Text>
            </View>
            {index < steps.length - 1 && <View style={styles.connector} />}
          </View>
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <View style={styles.stepContent}>{step.body}</View>
          </View>
        </View>
      ))}
    </>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    step: {
      flexDirection: 'row',
      marginBottom: Space.lg,
    },
    stepLast: {
      marginBottom: 0,
    },
    stepLeft: {
      alignItems: 'center',
      width: 26,
      marginRight: Space.md,
    },
    numCircle: {
      width: 22,
      height: 22,
      borderRadius: Radius.full,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    numText: {
      color: colors.onAccent,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
      lineHeight: 14,
    },
    connector: {
      flex: 1,
      width: 1,
      backgroundColor: colors.line,
      marginTop: 4,
      marginBottom: -Space.lg,
    },
    stepBody: {
      flex: 1,
      paddingBottom: 2,
    },
    stepTitle: {
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
      marginBottom: Space.xs,
      marginTop: 2,
    },
    stepContent: {
      gap: 2,
    },
  });
}
