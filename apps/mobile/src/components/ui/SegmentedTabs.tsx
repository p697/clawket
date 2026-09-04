import React, { useMemo } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { triggerLightImpact } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
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

export type SegmentedTabsProps<T extends string = string> = {
  tabs: SegmentedTabItem<T>[];
  active: T;
  onSwitch: (key: T) => void;
  size?: 'md' | 'sm';
  variant?: 'pill' | 'text';
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SegmentedTabs<T extends string = string>({
  tabs,
  active,
  onSwitch,
  size = 'md',
  variant = 'pill',
  containerStyle,
  testID,
}: SegmentedTabsProps<T>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const compact = size === 'sm';
  const textOnly = variant === 'text';

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[
        styles.container,
        compact ? styles.containerCompact : null,
        textOnly ? styles.containerText : null,
        containerStyle,
      ]}
    >
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            testID={testID ? `${testID}-${tab.key}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              triggerLightImpact();
              onSwitch(tab.key);
            }}
            style={({ pressed }) => [
              styles.tab,
              compact ? styles.tabCompact : null,
              selected && !textOnly ? styles.tabSelected : null,
              pressed ? styles.tabPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: selected ? theme.colors.ink : theme.colors.inkSecondary },
                selected ? styles.labelSelected : null,
              ]}
            >
              {tab.label}
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
      minHeight: ControlSize.floatingButton,
      padding: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'stretch',
    },
    containerCompact: {
      minHeight: Space.xxl,
      padding: 0,
    },
    containerText: {
      backgroundColor: 'transparent',
    },
    tab: {
      flex: 1,
      minHeight: ControlSize.compact,
      paddingHorizontal: Space.md,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabCompact: {
      minHeight: Space.xxl,
      paddingHorizontal: Space.sm,
    },
    tabSelected: {
      backgroundColor: colors.surfaceFloating,
      ...createThemedShadowStyle(colors, scheme, Shadow.xs),
    },
    tabPressed: {
      opacity: 0.72,
    },
    label: {
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    labelSelected: {
      fontWeight: FontWeight.semibold,
    },
  });
}
