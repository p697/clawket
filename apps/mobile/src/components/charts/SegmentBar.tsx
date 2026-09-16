import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

export type SegmentBarItem = Readonly<{
  key: string;
  label: string;
  value: number;
  display: string;
}>;

export type SegmentBarProps = Readonly<{
  segments: ReadonlyArray<SegmentBarItem>;
  accessibilityLabel?: string;
  testID?: string;
}>;

const BAR_HEIGHT = 10;
const SEGMENT_GAP = 2;

/**
 * Part-to-whole bar in one ink ramp (dark to light in the order given) with a
 * two-column legend that spells out every value, so identity never relies on
 * color alone.
 */
export function SegmentBar({ segments, accessibilityLabel, testID }: SegmentBarProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const ramp = [theme.colors.ink, theme.colors.inkSecondary, theme.colors.inkTertiary, theme.colors.line];
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const visible = segments.filter((segment) => segment.value > 0);

  return (
    <View testID={testID} accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel}>
      <View style={styles.track}>
        {total > 0 ? visible.map((segment) => (
          <View
            key={segment.key}
            testID={testID ? `${testID}-segment-${segment.key}` : undefined}
            style={[styles.segment, {
              flex: segment.value,
              backgroundColor: ramp[segments.indexOf(segment)] ?? theme.colors.line,
            }]}
          />
        )) : <View style={[styles.segment, styles.segmentEmpty]} />}
      </View>
      <View style={styles.legend}>
        {segments.map((segment, index) => (
          <View key={segment.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: ramp[index] ?? theme.colors.line }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>{segment.label}</Text>
            <Text
              testID={testID ? `${testID}-value-${segment.key}` : undefined}
              style={styles.legendValue}
              numberOfLines={1}
            >
              {segment.display}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      height: BAR_HEIGHT,
      gap: SEGMENT_GAP,
      borderRadius: Radius.full,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    segment: { height: BAR_HEIGHT },
    segmentEmpty: { flex: 1, backgroundColor: colors.surface },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: Space.md,
      rowGap: Space.xs,
    },
    legendItem: {
      width: '50%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingRight: Space.md,
    },
    dot: {
      width: Space.sm,
      height: Space.sm,
      borderRadius: Radius.full,
    },
    legendLabel: {
      flexShrink: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    legendValue: {
      marginLeft: 'auto',
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
      fontVariant: ['tabular-nums'],
    },
  });
}
