import React, { useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme';
import { Radius, Space, SurfaceElevation, createSurfaceStyle } from '../../theme/tokens';

type Props = {
  onPress?: () => void;
  disabled?: boolean;
  elevation?: SurfaceElevation;
  tone?: 'default' | 'muted' | 'elevated';
  selected?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function Card({
  onPress,
  disabled,
  elevation = 'flat',
  tone = 'default',
  selected = false,
  padding = 'md',
  style,
  children,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme, elevation),
    [elevation, theme.colors, theme.scheme],
  );
  const chrome = [
    styles.card,
    styles[`padding${padding.toUpperCase()}` as 'paddingNONE' | 'paddingSM' | 'paddingMD' | 'paddingLG'],
    tone === 'muted' ? styles.muted : tone === 'elevated' ? styles.elevated : null,
    selected ? styles.selected : null,
  ];

  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [
          chrome,
          pressed && !disabled ? styles.cardPressed : null,
          style,
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[chrome, style]}>{children}</View>;
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
  elevation: SurfaceElevation,
) {
  return StyleSheet.create({
    card: {
      borderRadius: Radius.md,
      ...createSurfaceStyle(colors, scheme, elevation),
    },
    paddingNONE: { padding: 0 },
    paddingSM: { padding: Space.sm },
    paddingMD: { padding: Space.md },
    paddingLG: { padding: Space.lg },
    muted: { backgroundColor: colors.surfaceMuted },
    elevated: { backgroundColor: colors.surfaceElevated },
    selected: { backgroundColor: colors.primarySoft },
    cardPressed: {
      backgroundColor: colors.surfaceMuted,
    },
  });
}
