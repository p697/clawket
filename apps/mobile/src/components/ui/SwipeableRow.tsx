import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';

/** Icon-over-caption cells, like the message actions capsule; wide enough for a 44-point target. */
export const SWIPEABLE_ROW_ACTION_WIDTH = 80;

export type SwipeableRowTone = 'neutral' | 'destructive';

export type SwipeableRowAction = Readonly<{
  key: string;
  label: string;
  icon: LucideIcon;
  tone?: SwipeableRowTone;
  accessibilityLabel?: string;
  onPress: () => void;
}>;

/** One list keeps at most one tray open; scrolling or opening another row closes it. */
export type SwipeableRowGroup = Readonly<{
  register: (key: string, methods: SwipeableMethods | null) => void;
  opened: (key: string) => void;
  closed: (key: string) => void;
  closeAll: () => void;
}>;

export function useSwipeableRowGroup(): SwipeableRowGroup {
  const rows = useRef(new Map<string, SwipeableMethods>());
  const openKey = useRef<string | null>(null);
  return useMemo<SwipeableRowGroup>(() => ({
    register: (key, methods) => {
      if (methods) {
        rows.current.set(key, methods);
        return;
      }
      rows.current.delete(key);
      if (openKey.current === key) openKey.current = null;
    },
    opened: (key) => {
      if (openKey.current && openKey.current !== key) rows.current.get(openKey.current)?.close();
      openKey.current = key;
    },
    closed: (key) => {
      if (openKey.current === key) openKey.current = null;
    },
    closeAll: () => {
      if (!openKey.current) return;
      rows.current.get(openKey.current)?.close();
      openKey.current = null;
    },
  }), []);
}

export type SwipeableRowProps = Readonly<{
  /** Stable identity inside the owning group. */
  rowKey: string;
  actions: ReadonlyArray<SwipeableRowAction>;
  group?: SwipeableRowGroup;
  enabled?: boolean;
  children: React.ReactNode;
  testID?: string;
}>;

function SwipeableRowActions({
  progress,
  actions,
  testID,
  onAction,
}: Readonly<{
  progress: SharedValue<number>;
  actions: ReadonlyArray<SwipeableRowAction>;
  testID?: string;
  onAction: (action: SwipeableRowAction) => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const width = SWIPEABLE_ROW_ACTION_WIDTH * actions.length;
  // The tray slides in with the row instead of sitting exposed under it.
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * width }],
  }), [width]);

  return (
    <Animated.View
      testID={testID ? `${testID}-actions` : undefined}
      style={[styles.tray, { width }, slideStyle]}
    >
      {actions.map((action) => {
        const destructive = action.tone === 'destructive';
        const Icon = action.icon;
        const color = destructive ? theme.colors.onAccent : theme.colors.ink;
        return (
          <Pressable
            key={action.key}
            testID={testID ? `${testID}-action-${action.key}` : undefined}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            onPress={() => onAction(action)}
            style={({ pressed }) => [
              styles.cell,
              { backgroundColor: destructive ? theme.colors.bad : theme.colors.surface },
              pressed ? styles.cellPressed : null,
            ]}
          >
            <Icon size={IconSize.md} color={color} strokeWidth={BorderWidth.strong} />
            <Text style={[styles.caption, { color }]} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

/**
 * Trailing swipe tray for list rows. The gesture reveals at most three short
 * actions; anything destructive still confirms through the row's owner, and
 * every action stays reachable elsewhere for assistive technologies.
 */
export function SwipeableRow({
  rowKey,
  actions,
  group,
  enabled = true,
  children,
  testID,
}: SwipeableRowProps): React.JSX.Element {
  const swipeable = useRef<SwipeableMethods>(null);
  const active = enabled && actions.length > 0;

  useEffect(() => {
    if (!group || !active) return;
    group.register(rowKey, swipeable.current);
    return () => group.register(rowKey, null);
  }, [active, group, rowKey]);

  const handleAction = useCallback((action: SwipeableRowAction) => {
    swipeable.current?.close();
    action.onPress();
  }, []);
  const renderRightActions = useCallback((progress: SharedValue<number>) => (
    <SwipeableRowActions
      progress={progress}
      actions={actions}
      testID={testID}
      onAction={handleAction}
    />
  ), [actions, handleAction, testID]);

  if (!active) return <>{children}</>;

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      testID={testID}
      friction={2}
      overshootRight={false}
      rightThreshold={SWIPEABLE_ROW_ACTION_WIDTH / 2}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={() => group?.opened(rowKey)}
      onSwipeableClose={() => group?.closed(rowKey)}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  cell: {
    width: SWIPEABLE_ROW_ACTION_WIDTH,
    minHeight: ControlSize.floatingButton,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.xs,
  },
  cellPressed: {
    opacity: 0.84,
  },
  caption: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
  },
});
