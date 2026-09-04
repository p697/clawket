import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../../theme';
import { FontSize, Radius, Space } from '../../../theme/tokens';

function useSkeletonOpacity(): Animated.Value {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

type BlockProps = {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
};

export function SkeletonBlock({ width, height, radius = 4, style }: BlockProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View
      style={[
        {
          width: width as ViewStyle['width'],
          height,
          borderRadius: radius,
          backgroundColor: theme.colors.border,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function DiscoverSkillRowSkeleton(): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createRowStyles(theme.colors), [theme]);
  return (
    <View style={styles.row}>
      <View style={[styles.sourceBar, { backgroundColor: theme.colors.border }]} />
      <View style={styles.content}>
        <View style={styles.headRow}>
          <SkeletonBlock width={48} height={FontSize.xs} />
          <View style={{ flex: 1 }} />
          <SkeletonBlock width={56} height={FontSize.xs} />
        </View>
        <SkeletonBlock width="70%" height={FontSize.base} style={{ marginBottom: 6 }} />
        <SkeletonBlock width="92%" height={FontSize.sm} />
      </View>
    </View>
  );
}

export function DiscoverRailCardSkeleton(): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createRailStyles(theme.colors), [theme]);
  return (
    <View style={styles.card}>
      <SkeletonBlock width={48} height={FontSize.xs} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="80%" height={FontSize.base} style={{ marginBottom: 4 }} />
      <SkeletonBlock width="50%" height={FontSize.xs} style={{ marginBottom: 10 }} />
      <SkeletonBlock width="100%" height={FontSize.sm} style={{ marginBottom: 4 }} />
      <SkeletonBlock width="90%" height={FontSize.sm} />
      <View style={{ flex: 1 }} />
      <SkeletonBlock width={64} height={FontSize.xs} style={{ marginTop: 8 }} />
    </View>
  );
}

export function DiscoverRailSkeleton({ count = 3 }: { count?: number }): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createSectionStyles(theme.colors), [theme]);
  const railStyles = useMemo(() => createRailContainerStyles(), []);
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <SkeletonBlock width="55%" height={FontSize.xl} style={{ marginBottom: 6 }} />
          <SkeletonBlock width="80%" height={FontSize.sm} />
        </View>
      </View>
      <View style={railStyles.row}>
        {Array.from({ length: count }).map((_, idx) => (
          <DiscoverRailCardSkeleton key={idx} />
        ))}
      </View>
    </View>
  );
}

export function DiscoverSectionSkeleton({ rows = 4 }: { rows?: number }): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createSectionStyles(theme.colors), [theme]);
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <SkeletonBlock width="55%" height={FontSize.xl} style={{ marginBottom: 6 }} />
          <SkeletonBlock width="80%" height={FontSize.sm} />
        </View>
      </View>
      <View style={styles.list}>
        {Array.from({ length: rows }).map((_, idx) => (
          <DiscoverSkillRowSkeleton key={idx} />
        ))}
      </View>
    </View>
  );
}

function createRailStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      width: 220,
      minHeight: 168,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      paddingVertical: Space.md,
      paddingHorizontal: Space.md,
    },
  });
}

function createRailContainerStyles() {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: Space.md,
    },
  });
}

function createRowStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingVertical: Space.md,
      paddingRight: Space.md,
      overflow: 'hidden',
    },
    sourceBar: {
      width: 3,
      marginRight: Space.md,
    },
    content: {
      flex: 1,
      minWidth: 0,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      marginBottom: 8,
    },
  });
}

function createSectionStyles(_colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    section: {
      marginBottom: Space.xl,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: Space.md,
    },
    list: {
      gap: Space.sm,
    },
  });
}
