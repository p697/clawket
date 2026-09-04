import React, { useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { triggerLightImpact } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Shadow,
  Space,
  createThemedShadowStyle,
} from '../../theme/tokens';

export type SegmentedTabItem<T extends string = string> = {
  key: T;
  label: string;
};

type Props<T extends string = string> = {
  tabs: SegmentedTabItem<T>[];
  active: T;
  onSwitch: (key: T) => void;
  containerStyle?: StyleProp<ViewStyle>;
};

export function SegmentedTabs<T extends string = string>({ tabs, active, onSwitch, containerStyle }: Props<T>): React.JSX.Element {
  const { theme } = useAppTheme();
  const colors = theme.colors;
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  return (
    <View style={[styles.container, containerStyle]}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => { triggerLightImpact(); onSwitch(t.key); }}
            style={({ pressed }) => [
              styles.tab,
              isActive ? styles.tabActive : null,
              pressed ? styles.tabPressed : null,
            ]}
          >
            <Text style={[
              styles.label,
              { color: isActive ? colors.text : colors.textMuted },
              isActive && styles.labelActive,
            ]}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surfaceMuted,
      flexDirection: 'row',
      marginHorizontal: Space.lg,
      marginTop: Space.sm,
      marginBottom: Space.xs,
      borderRadius: Radius.md,
      padding: Space.xs,
    },
    tab: {
      flex: 1,
      paddingVertical: Space.sm,
      borderRadius: Radius.sm,
      alignItems: 'center',
    },
    tabActive: {
      backgroundColor: colors.surface,
      ...createThemedShadowStyle(colors, scheme, Shadow.xs),
    },
    tabPressed: {
      opacity: 0.72,
    },
    label: {
      fontSize: FontSize.md,
      lineHeight: LineHeight.md,
      fontWeight: FontWeight.regular,
    },
    labelActive: {
      fontWeight: FontWeight.semibold,
    },
  });
}
