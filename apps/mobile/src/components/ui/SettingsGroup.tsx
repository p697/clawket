import React, { useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronRight, Lock } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

export type SettingsGroupProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type SettingsRowProps = {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
  value?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  showChevron?: boolean;
  locked?: boolean;
  attention?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  layout?: 'row' | 'column';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type SettingsDividerProps = {
  inset?: 'none' | 'content' | 'icon';
  testID?: string;
};

export function SettingsGroup({ children, style, testID }: SettingsGroupProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return <View testID={testID} style={[styles.group, style]}>{children}</View>;
}

export function SettingsRow({
  children,
  title,
  subtitle,
  value,
  leading,
  trailing,
  showChevron = false,
  locked = false,
  attention = false,
  onPress,
  disabled = false,
  layout = 'row',
  accessibilityLabel,
  style,
  testID,
}: SettingsRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const layoutStyle = layout === 'column' ? styles.rowColumn : styles.rowHorizontal;
  const content = children ?? (
    <>
      {leading}
      <View style={styles.copy}>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={styles.tail}>
        {attention ? <View testID={testID ? `${testID}-attention` : undefined} style={styles.attention} /> : null}
        {value ? <Text style={styles.value} numberOfLines={1}>{value}</Text> : null}
        {trailing ?? (locked ? (
          <Lock size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2} />
        ) : showChevron ? (
          <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2} />
        ) : null)}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        style={[styles.row, layoutStyle, disabled ? styles.disabled : null, style]}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
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
      {content}
    </Pressable>
  );
}

export function SettingsDivider({ inset = 'icon', testID }: SettingsDividerProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View
      testID={testID}
      style={[
        styles.divider,
        inset === 'content'
          ? styles.dividerContent
          : inset === 'icon'
            ? styles.dividerIcon
            : null,
      ]}
    />
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    group: {
      backgroundColor: colors.surfaceFloating,
      borderRadius: Radius.settingsGroup,
      overflow: 'hidden',
    },
    row: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      gap: Space.md,
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
    copy: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
    subtitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    tail: {
      maxWidth: '50%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Space.sm,
    },
    value: {
      flexShrink: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'right',
    },
    attention: {
      width: Space.sm,
      height: Space.sm,
      borderRadius: Radius.full,
      backgroundColor: colors.bad,
    },
    rowPressed: { backgroundColor: colors.surface },
    disabled: { opacity: 0.45 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    dividerContent: { marginLeft: Space.lg },
    dividerIcon: { marginLeft: ControlSize.settingsRow },
  });
}
