import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';
import { formatCost } from '../../utils/usage-format';
import { describeArc, easeOut } from './chart-utils';

export type RingSegment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  segments: RingSegment[];
  totalCost: number;
  size?: number;
  strokeWidth?: number;
};

const DEFAULT_SIZE = 160;
const DEFAULT_STROKE_WIDTH = 24;
const ANIMATION_DURATION = 300;
const FRAME_DROP_THRESHOLD = 32;

export function SvgRingChart({
  segments,
  totalCost,
  size = DEFAULT_SIZE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const [animProgress, setAnimProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2;

  const total = useMemo(
    () => segments.reduce((sum, s) => sum + s.value, 0),
    [segments],
  );

  // Animate on data change
  useEffect(() => {
    if (totalCost === 0 || total === 0) {
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

      // Frame-drop guard
      if (elapsed > 50 && elapsed < ANIMATION_DURATION) {
        // Check if we've been stalling
        const expectedFrames = elapsed / 16;
        if (expectedFrames > 0 && elapsed / expectedFrames > FRAME_DROP_THRESHOLD) {
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
  }, [segments, totalCost, total]);

  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const isEmpty = totalCost === 0;

  // Build arc paths
  const arcs = useMemo(() => {
    if (isEmpty || total === 0) return [];
    const result: { d: string; color: string; label: string }[] = [];
    let currentAngle = 0;
    for (const segment of segments) {
      const sweep = (segment.value / total) * 360 * animProgress;
      if (sweep > 0.5) {
        const d = describeArc(cx, cy, r, currentAngle, currentAngle + sweep);
        if (d) {
          result.push({ d, color: segment.color, label: segment.label });
        }
      }
      currentAngle += (segment.value / total) * 360 * animProgress;
    }
    return result;
  }, [isEmpty, total, segments, animProgress, cx, cy, r]);

  return (
    <View style={styles.container}>
      <Svg width={size} height={size}>
        {isEmpty ? (
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={theme.colors.chartGrid}
            strokeWidth={strokeWidth}
            fill="none"
            accessibilityLabel={t('No cost data')}
          />
        ) : (
          arcs.map((arc, i) => (
            <Path
              key={`${arc.label}-${i}`}
              d={arc.d}
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeLinecap="butt"
              fill="none"
              accessibilityLabel={`${arc.label}: ${formatCost(segments[i]?.value ?? 0)}`}
            />
          ))
        )}
      </Svg>
      <View style={[styles.centerText, { width: size, height: size }]}>
        <Text style={styles.centerValue}>{formatCost(totalCost)}</Text>
        {!isEmpty && <Text style={styles.centerLabel}>{t('Total')}</Text>}
      </View>

      {/* Legend */}
      {!isEmpty && (
        <View style={styles.legend}>
          {segments.map((segment) => (
            <View key={segment.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
              <Text style={styles.legendLabel}>
                {`${segment.label} ${formatCost(segment.value)}`}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
    },
    centerText: {
      position: 'absolute',
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerValue: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    centerLabel: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      marginTop: 2,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
      marginTop: Space.md,
      justifyContent: 'center',
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: Space.md,
    },
    legendDot: {
      width: Space.sm,
      height: Space.sm,
      borderRadius: 9999,
      marginRight: Space.xs + 2,
    },
    legendLabel: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
  });
}
