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
};

const DEFAULT_HEIGHT = 180;
const BAR_WIDTH = 28;
const BAR_GAP = 8;
const PADDING_LEFT = 48;
const PADDING_RIGHT = 12;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 28;
const ANIMATION_DURATION = 300;
const FRAME_DROP_THRESHOLD = 32;

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

export function SvgBarChart({ data, mode, height = DEFAULT_HEIGHT }: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const [animProgress, setAnimProgress] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const values = useMemo(() => data.map((d) => d.value), [data]);
  const { max, ticks } = useMemo(() => computeYScale(values, height), [values, height]);

  const chartWidth = Math.max(
    PADDING_LEFT + data.length * (BAR_WIDTH + BAR_GAP) + PADDING_RIGHT,
    PADDING_LEFT + PADDING_RIGHT + 100,
  );
  const chartAreaHeight = height - PADDING_TOP - PADDING_BOTTOM;

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
  }, [data, max]);

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
                stroke={theme.colors.chartGrid}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
              <SvgText
                x={PADDING_LEFT - 6}
                y={y + 4}
                fontSize={10}
                fill={theme.colors.textSubtle}
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
          const x = PADDING_LEFT + index * (BAR_WIDTH + BAR_GAP);
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
              width={BAR_WIDTH}
              barHeight={barHeight}
              fill={theme.colors.primary}
              opacity={selectedIndex === null || selectedIndex === index ? 1 : 0.4}
              accessibilityLabel={label}
            />
          );
        })}

        {/* X-axis labels */}
        {data.map((point, index) => {
          const x = PADDING_LEFT + index * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2;
          return (
            <SvgText
              key={`label-${point.date}`}
              x={x}
              y={height - 6}
              fontSize={10}
              fill={theme.colors.textMuted}
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
          const x = PADDING_LEFT + index * (BAR_WIDTH + BAR_GAP);
          return (
            <Pressable
              key={`tap-${point.date}`}
              style={[styles.tapTarget, { left: x, width: BAR_WIDTH + BAR_GAP }]}
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
                selectedIndex * (BAR_WIDTH + BAR_GAP) +
                BAR_WIDTH / 2 -
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

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
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
      backgroundColor: colors.text,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      alignItems: 'center',
    },
    tooltipDate: {
      fontSize: FontSize.xs,
      color: colors.background,
    },
    tooltipValue: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.background,
    },
  });
}
