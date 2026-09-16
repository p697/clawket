import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  HitSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

export type ShareRowProps = Readonly<{
  name: string;
  value: string;
  /** 0..1 share of the leading entry, drawn as a thin ink track under the row. */
  share: number;
  testID?: string;
}>;

const TRACK_HEIGHT = 4;

/** Ranked list row: name, value, and a proportional bar for at-a-glance comparison. */
export function ShareRow({ name, value, share, testID }: ShareRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` as const;
  return (
    <View testID={testID} accessible accessibilityLabel={`${name}, ${value}`}>
      <View style={styles.row}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.value} numberOfLines={1}>{value}</Text>
      </View>
      <View style={styles.track}>
        <View testID={testID ? `${testID}-share` : undefined} style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      minHeight: HitSize.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    name: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    value: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      fontVariant: ['tabular-nums'],
    },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: Radius.full,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      marginBottom: Space.sm,
    },
    fill: {
      height: TRACK_HEIGHT,
      borderRadius: Radius.full,
      backgroundColor: colors.ink,
    },
  });
}
