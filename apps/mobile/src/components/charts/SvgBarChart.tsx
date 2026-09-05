import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { formatCost, formatDayLabel, formatTokens } from '../../utils/usage-format';
import { computeYScale, easeOut } from './chart-utils';

export type BarDataPoint = {
  date: string;
  value: number;
};

type Props = {
  data: BarDataPoint[];
  mode: 'tokens' | 'cost';
  height?: number;
  width?: number;
};

function getDataSignature(data: BarDataPoint[]): string {
  return data.map((item) => `${item.date}:${item.value}`).join('|');
}

function areBarDataEqual(left: BarDataPoint[], right: BarDataPoint[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.date !== right[index]?.date || left[index]?.value !== right[index]?.value) {
      return false;
    }
  }
  return true;
}

const DEFAULT_HEIGHT = 180;
const BAR_WIDTH = 28;
const BAR_GAP = 8;
const PADDING_LEFT = 26;
const PADDING_RIGHT = 0;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 28;
const ANIMATION_DURATION = 300;
const FRAME_DROP_THRESHOLD = 32;
const MIN_BAR_WIDTH = 14;
const MAX_BAR_WIDTH = 28;
const MIN_BAR_GAP = 6;
const MAX_BAR_GAP = 24;

const MemoBar = React.memo(function MemoBar({
  x,
  y,
  width,
  barHeight,
  fill,
  opacity,
  accessibilityLabel,
}: {
  x: number;
  y: number;
  width: number;
  barHeight: number;
  fill: string;
  opacity: number;
  accessibilityLabel: string;
}) {
  if (barHeight <= 0) return null;
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={barHeight}
      rx={3}
      ry={3}
      fill={fill}
      opacity={opacity}
      accessibilityLabel={accessibilityLabel}
    />
  );
});

function SvgBarChartComponent({ data, mode, height = DEFAULT_HEIGHT, width }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');
  const [animProgress, setAnimProgress] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const dataSignature = useMemo(() => getDataSignature(data), [data]);
  const values = useMemo(() => data.map((d) => d.value), [data]);
  const { max, ticks } = useMemo(() => computeYScale(values, height), [values, height]);

  const naturalChartWidth = Math.max(
    PADDING_LEFT + data.length * (BAR_WIDTH + BAR_GAP) + PADDING_RIGHT,
    PADDING_LEFT + PADDING_RIGHT + 100,
  );
  const chartWidth = Math.max(width ?? naturalChartWidth, PADDING_LEFT + PADDING_RIGHT + 100);
  const chartAreaHeight = height - PADDING_TOP - PADDING_BOTTOM;
  const availableBarsWidth = Math.max(1, chartWidth - PADDING_LEFT - PADDING_RIGHT);
  const desiredGap = Math.max(
    MIN_BAR_GAP,
    Math.min(MAX_BAR_GAP, availableBarsWidth * 0.04),
  );
  const computedLayout = (() => {
    if (data.length <= 1) {
      return {
        barWidth: Math.min(MAX_BAR_WIDTH, availableBarsWidth),
        gap: 0,
      };
    }

    let gap = desiredGap;
    let barWidth = (availableBarsWidth - gap * (data.length - 1)) / data.length;

    if (barWidth > MAX_BAR_WIDTH) {
      barWidth = MAX_BAR_WIDTH;
      gap = (availableBarsWidth - barWidth * data.length) / (data.length - 1);
    } else if (barWidth < MIN_BAR_WIDTH) {
      barWidth = MIN_BAR_WIDTH;
      gap = (availableBarsWidth - barWidth * data.length) / (data.length - 1);
    }

    return {
      barWidth: Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, barWidth)),
      gap: Math.max(0, gap),
    };
  })();
  const computedBarWidth = computedLayout.barWidth;
  const computedGap = computedLayout.gap;

  // Animate on data change — cancel previous animation on cleanup
  useEffect(() => {
    if (data.length === 0 || max === 0) {
      setAnimProgress(1);
      return;
    }
    setAnimProgress(0);
    startTimeRef.current = 0;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === 0) {
        startTimeRef.current = timestamp;
      }
      const elapsed = timestamp - startTimeRef.current;
      const delta = timestamp - (rafRef.current ? timestamp : timestamp);

      // Frame-drop guard: if we detect a stall, snap to end
      if (elapsed > 0 && elapsed < ANIMATION_DURATION) {
        const lastFrame = startTimeRef.current + (elapsed - 16);
        if (timestamp - lastFrame > FRAME_DROP_THRESHOLD && elapsed > 50) {
          setAnimProgress(1);
          rafRef.current = null;
          return;
        }
      }

      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      setAnimProgress(easeOut(progress));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [dataSignature, max]);

  const formatLabel = useCallback(
    (value: number) => (mode === 'cost' ? formatCost(value) : formatTokens(value)),
    [mode],
  );

  const handleBarPress = useCallback(
    (index: number) => {
      setSelectedIndex((prev) => (prev === index ? null : index));
    },
    [],
  );

  const handleBackgroundPress = useCallback(() => {
    setSelectedIndex(null);
  }, []);

  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  if (data.length === 0 || max === 0) {
    return (
      <View style={[styles.emptyContainer, { height }]}>
        <Text style={styles.emptyText}>{t('No chart data')}</Text>
      </View>
    );
  }

  return (
    <Pressable onPress={handleBackgroundPress}>
      <Svg width={chartWidth} height={height}>
        {/* Grid lines + Y-axis labels */}
        {ticks.map((tick) => {
          const y = PADDING_TOP + chartAreaHeight - (tick / max) * chartAreaHeight;
          return (
            <React.Fragment key={`tick-${tick}`}>
              <Line
                x1={PADDING_LEFT}
                y1={y}
                x2={chartWidth - PADDING_RIGHT}
                y2={y}
                stroke={theme.colors.line}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
              <SvgText
                x={PADDING_LEFT - 6}
                y={y + 4}
                fontSize={FontSize.caption}
                fill={theme.colors.inkTertiary}
                textAnchor="end"
              >
                {formatLabel(tick)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Bars */}
        {data.map((point, index) => {
          const barHeight = max > 0 ? (point.value / max) * chartAreaHeight * animProgress : 0;
          const x = PADDING_LEFT + index * (computedBarWidth + computedGap);
          const y = PADDING_TOP + chartAreaHeight - barHeight;
          const label =
            mode === 'cost'
              ? `${formatDayLabel(point.date)}, ${formatCost(point.value)}`
              : `${formatDayLabel(point.date)}, ${formatTokens(point.value)} tokens`;

          return (
            <MemoBar
              key={point.date}
              x={x}
              y={y}
              width={computedBarWidth}
              barHeight={barHeight}
              fill={theme.colors.accent}
              opacity={selectedIndex === null || selectedIndex === index ? 1 : 0.4}
              accessibilityLabel={label}
            />
          );
        })}

        {/* X-axis labels */}
        {data.map((point, index) => {
          const x = PADDING_LEFT + index * (computedBarWidth + computedGap) + computedBarWidth / 2;
          return (
            <SvgText
              key={`label-${point.date}`}
              x={x}
              y={height - 6}
              fontSize={FontSize.caption}
              fill={theme.colors.inkSecondary}
              textAnchor="middle"
            >
              {formatDayLabel(point.date)}
            </SvgText>
          );
        })}
      </Svg>

      {/* Tap targets overlay */}
      <View style={[StyleSheet.absoluteFill, styles.tapOverlay]}>
        {data.map((point, index) => {
          const x = PADDING_LEFT + index * (computedBarWidth + computedGap);
          return (
            <Pressable
              key={`tap-${point.date}`}
              style={[styles.tapTarget, { left: x, width: computedBarWidth + computedGap }]}
              onPress={() => handleBarPress(index)}
            />
          );
        })}
      </View>

      {/* Tooltip */}
      {selectedIndex !== null && data[selectedIndex] && (
        <View
          style={[
            styles.tooltip,
            {
              left:
                PADDING_LEFT +
                selectedIndex * (computedBarWidth + computedGap) +
                computedBarWidth / 2 -
                50,
            },
          ]}
        >
          <Text style={styles.tooltipDate}>{formatDayLabel(data[selectedIndex].date)}</Text>
          <Text style={styles.tooltipValue}>{formatLabel(data[selectedIndex].value)}</Text>
        </View>
      )}
    </Pressable>
  );
}

export const SvgBarChart = React.memo(
  SvgBarChartComponent,
  (prevProps, nextProps) => (
    prevProps.mode === nextProps.mode
    && prevProps.height === nextProps.height
    && prevProps.width === nextProps.width
    && areBarDataEqual(prevProps.data, nextProps.data)
  ),
);

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
    },
    tapOverlay: {
      flexDirection: 'row',
    },
    tapTarget: {
      position: 'absolute',
      top: 0,
      bottom: 0,
    },
    tooltip: {
      position: 'absolute',
      top: 4,
      width: 100,
      backgroundColor: colors.ink,
      borderRadius: Radius.card,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      alignItems: 'center',
    },
    tooltipDate: {
      fontSize: FontSize.caption,
      color: colors.canvas,
    },
    tooltipValue: {
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
      color: colors.canvas,
    },
  });
}
