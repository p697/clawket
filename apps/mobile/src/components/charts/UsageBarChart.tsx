import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Space,
} from '../../theme/tokens';
import { computeYScale } from './chart-utils';

export type UsageBarChartPoint = Readonly<{
  date: string;
  value: number;
  today: boolean;
}>;

export type UsageBarChartProps = Readonly<{
  points: ReadonlyArray<UsageBarChartPoint>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  formatValue: (value: number) => string;
  formatDayLabel: (date: string) => string;
  todayLabel: string;
  accessibilityLabel?: string;
  testID?: string;
}>;

const PLOT_HEIGHT = 120;
const AXIS_WIDTH = 40;
const DEFAULT_WIDTH = 320;
const MAX_BAR_WIDTH = 22;
const MIN_BAR_WIDTH = 4;
const MIN_BAR_GAP = 3;
const BAR_RADIUS = 4;
const ZERO_STUB = 2;
const GRID_STEPS = [0.5, 1] as const;

/**
 * Daily bars in one ink: the selected day (today by default) is `ink`, the rest
 * `inkTertiary`. Grid and axis text come from the theme so both schemes read.
 * Bars grow from the baseline on data change; reduced motion shows them at rest.
 */
export function UsageBarChart({
  points,
  selectedIndex,
  onSelect,
  formatValue,
  formatDayLabel,
  todayLabel,
  accessibilityLabel,
  testID,
}: UsageBarChartProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const signature = points.map((point) => `${point.date}:${point.value}`).join('|');

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: Motion.duration.slow, easing: Easing.out(Easing.cubic) });
  }, [progress, reduceMotion, signature]);

  const growStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: progress.value }] }));

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0) setWidth(next);
  }, []);

  const { max } = useMemo(() => computeYScale(points.map((point) => point.value), PLOT_HEIGHT), [points]);
  const plotWidth = Math.max(1, width - AXIS_WIDTH);
  const count = Math.max(1, points.length);
  const slot = plotWidth / count;
  const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, slot - MIN_BAR_GAP));
  const barX = (index: number) => AXIS_WIDTH + index * slot + (slot - barWidth) / 2;
  const barHeight = (value: number) => (max > 0 ? (value / max) * PLOT_HEIGHT : 0);
  const labelEvery = count > 7 ? 7 : 1;
  const selected = selectedIndex !== null ? points[selectedIndex] ?? null : null;
  const selectedX = selectedIndex !== null ? barX(selectedIndex) + barWidth / 2 : 0;

  return (
    <View testID={testID} onLayout={onLayout} accessibilityLabel={accessibilityLabel}>
      <View style={styles.valueRow}>
        {selected ? (
          <Text
            testID={testID ? `${testID}-selected-value` : undefined}
            style={[styles.valueLabel, { left: clamp(selectedX - VALUE_LABEL_WIDTH / 2, 0, width - VALUE_LABEL_WIDTH) }]}
            numberOfLines={1}
          >
            {formatValue(selected.value)}
          </Text>
        ) : null}
      </View>
      <View style={styles.plot}>
        <Svg width={width} height={PLOT_HEIGHT} style={StyleSheet.absoluteFill}>
          <Path
            d={GRID_STEPS.map((step) => `M${AXIS_WIDTH} ${gridY(step)} H${width}`).join(' ')}
            stroke={theme.colors.line}
            strokeWidth={1}
            strokeDasharray="3 3"
            fill="none"
          />
          <Path d={`M${AXIS_WIDTH} ${PLOT_HEIGHT} H${width}`} stroke={theme.colors.line} strokeWidth={1} fill="none" />
        </Svg>
        {GRID_STEPS.map((step) => (
          <Text key={step} style={[styles.axisLabel, { top: gridY(step) - LineHeight.caption / 2 }]} numberOfLines={1}>
            {formatValue(max * step)}
          </Text>
        ))}
        <Text style={[styles.axisLabel, { top: PLOT_HEIGHT - LineHeight.caption / 2 }]} numberOfLines={1}>0</Text>
        <Animated.View style={[styles.bars, growStyle]}>
          <Svg width={width} height={PLOT_HEIGHT}>
            {points.map((point, index) => {
              const height = barHeight(point.value);
              const fill = index === selectedIndex ? theme.colors.ink : theme.colors.inkTertiary;
              return (
                <Path
                  key={point.date}
                  testID={testID ? `${testID}-bar-${point.date}` : undefined}
                  d={barPath(barX(index), barWidth, height)}
                  fill={fill}
                />
              );
            })}
          </Svg>
        </Animated.View>
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {points.map((point, index) => (
            <Pressable
              key={point.date}
              testID={testID ? `${testID}-slot-${point.date}` : undefined}
              accessibilityRole="button"
              accessibilityState={{ selected: index === selectedIndex }}
              accessibilityLabel={`${point.today ? todayLabel : formatDayLabel(point.date)}, ${formatValue(point.value)}`}
              style={[styles.slot, { left: AXIS_WIDTH + index * slot, width: slot }]}
              onPress={() => onSelect(index)}
            />
          ))}
        </View>
      </View>
      <View style={styles.axis}>
        {points.map((point, index) => {
          const isSelected = index === selectedIndex;
          const show = point.today || isSelected || index % labelEvery === 0;
          if (!show) return null;
          return (
            <Text
              key={point.date}
              style={[
                styles.dayLabel,
                isSelected ? styles.dayLabelSelected : null,
                { left: clamp(barX(index) + barWidth / 2 - DAY_LABEL_WIDTH / 2, 0, width - DAY_LABEL_WIDTH) },
              ]}
              numberOfLines={1}
            >
              {point.today ? todayLabel : formatDayLabel(point.date)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const VALUE_LABEL_WIDTH = 72;
const DAY_LABEL_WIDTH = 48;

function gridY(step: number): number {
  return PLOT_HEIGHT - step * PLOT_HEIGHT;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Rounded-top bar path anchored to the baseline; zero values keep a short stub. */
function barPath(x: number, width: number, height: number): string {
  const h = Math.max(ZERO_STUB, height);
  const r = Math.min(BAR_RADIUS, h / 2, width / 2);
  const top = PLOT_HEIGHT - h;
  const right = x + width;
  return [
    `M${x} ${PLOT_HEIGHT}`,
    `V${top + r}`,
    `Q${x} ${top} ${x + r} ${top}`,
    `H${right - r}`,
    `Q${right} ${top} ${right} ${top + r}`,
    `V${PLOT_HEIGHT}`,
    'Z',
  ].join(' ');
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    valueRow: { height: LineHeight.caption, marginBottom: Space.xs },
    valueLabel: {
      position: 'absolute',
      width: VALUE_LABEL_WIDTH,
      textAlign: 'center',
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
    plot: { height: PLOT_HEIGHT },
    bars: {
      ...StyleSheet.absoluteFill,
      transformOrigin: 'bottom',
    },
    axisLabel: {
      position: 'absolute',
      left: 0,
      width: AXIS_WIDTH - Space.sm,
      textAlign: 'right',
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
      fontVariant: ['tabular-nums'],
    },
    slot: { position: 'absolute', top: 0, bottom: 0 },
    axis: { height: LineHeight.caption, marginTop: Space.xs },
    dayLabel: {
      position: 'absolute',
      width: DAY_LABEL_WIDTH,
      textAlign: 'center',
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
      fontVariant: ['tabular-nums'],
    },
    dayLabelSelected: {
      color: colors.ink,
      fontWeight: FontWeight.semibold,
    },
  });
}
