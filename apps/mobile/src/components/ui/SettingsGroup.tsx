import React, { useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useAppTheme } from '../../theme';
import { ControlSize, Radius, Space, createSurfaceStyle } from '../../theme/tokens';

type GroupProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

type RowProps = {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  layout?: 'row' | 'column';
  style?: StyleProp<ViewStyle>;
};

type DividerProps = {
  inset?: 'none' | 'content' | 'icon';
};

export function SettingsGroup({ children, style }: GroupProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  return <View style={[styles.group, style]}>{children}</View>;
}

export function SettingsRow({ children, onPress, disabled = false, layout = 'row', style }: RowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme.colors, theme.scheme]);
  const layoutStyle = layout === 'column' ? styles.rowColumn : styles.rowHorizontal;
  if (!onPress) return <View style={[styles.row, layoutStyle, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        layoutStyle,
        pressed && !disabled ? styles.rowPressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function SettingsDivider({ inset = 'icon' }: DividerProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme.colors, theme.scheme]);
  return <View style={[styles.divider, inset === 'content' ? styles.dividerContent : inset === 'icon' ? styles.dividerIcon : null]} />;
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    group: {
      borderRadius: Radius.md,
      overflow: 'hidden',
      ...createSurfaceStyle(colors, scheme, 'flat'),
    },
    row: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
    },
    rowHorizontal: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowColumn: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    disabled: { opacity: 0.45 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    dividerContent: { marginLeft: Space.lg },
    dividerIcon: { marginLeft: 52 },
  });
}
