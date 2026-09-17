import React, { createContext, useContext, useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Lock } from 'lucide-react-native';
import { ChevronRight } from './DirectionalIcon';
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
  density?: 'standard' | 'comfortable';
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
  destructive?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  layout?: 'row' | 'column';
  accessibilityLabel?: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type SettingsDividerProps = {
  inset?: 'none' | 'content' | 'icon';
  testID?: string;
};

const SettingsDensity = createContext<'standard' | 'comfortable'>('standard');

export function SettingsGroup({ children, density = 'standard', style, testID }: SettingsGroupProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <SettingsDensity.Provider value={density}>
      <View testID={testID} style={[styles.group, density === 'comfortable' ? styles.groupComfortable : null, style]}>{children}</View>
    </SettingsDensity.Provider>
  );
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
  destructive = false,
  onPress,
  disabled = false,
  layout = 'row',
  accessibilityLabel,
  selected,
  style,
  testID,
}: SettingsRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const comfortable = useContext(SettingsDensity) === 'comfortable';
  const rowStyle = [styles.row, comfortable ? styles.rowComfortable : null];
  const layoutStyle = layout === 'column' ? styles.rowColumn : styles.rowHorizontal;
  const content = children ?? (
    <>
      {comfortable && leading ? <View style={styles.leadingComfortable}>{leading}</View> : leading}
      <View style={styles.copy}>
        {title ? <Text style={[styles.title, destructive ? { color: theme.colors.bad } : null]} numberOfLines={comfortable ? undefined : 2}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <View style={styles.tail}>
        {attention ? <View testID={testID ? `${testID}-attention` : undefined} style={styles.attention} /> : null}
        {value ? <Text style={styles.value} numberOfLines={comfortable ? undefined : 2}>{value}</Text> : null}
        {trailing ?? (locked ? (
          <Lock
            testID={testID ? `${testID}-lock-icon` : undefined}
            size={IconSize.sm}
            color={theme.colors.inkTertiary}
            strokeWidth={2}
          />
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
        style={[rowStyle, layoutStyle, disabled ? styles.disabled : null, style]}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, value].filter(Boolean).join(', ')}
      accessibilityState={{ disabled, ...(selected !== undefined ? { selected } : {}) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        rowStyle,
        layoutStyle,
        pressed && !disabled ? styles.rowPressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {selected ? (
        <View
          pointerEvents="none"
          testID={testID ? `${testID}-selected-fill` : undefined}
          style={styles.selectedFill}
        />
      ) : null}
      {content}
    </Pressable>
  );
}

export function SettingsDivider({ inset = 'icon', testID }: SettingsDividerProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const comfortable = useContext(SettingsDensity) === 'comfortable';
  return (
    <View
      testID={testID}
      style={[
        styles.divider,
        inset === 'content'
          ? styles.dividerContent
          : inset === 'icon'
            ? comfortable ? styles.dividerComfortableIcon : styles.dividerIcon
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
    groupComfortable: { borderRadius: Radius.xl },
    rowComfortable: {
      minHeight: ControlSize.settingsRowComfortable,
      paddingVertical: Space.md,
      gap: Space.lg,
    },
    leadingComfortable: {
      width: Space.xxl,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
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
      maxWidth: '44%',
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
    // Selected rows carry an inset rounded fill instead of a full-bleed
    // background so a middle row does not read as a square bar; the text
    // column stays aligned with its neighbours because layout is untouched.
    selectedFill: {
      position: 'absolute',
      top: Space.xs,
      bottom: Space.xs,
      start: Space.sm,
      end: Space.sm,
      borderRadius: Radius.settingsGroup,
      backgroundColor: colors.surface,
    },
    disabled: { opacity: 0.45 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    dividerContent: { marginStart: Space.lg },
    dividerIcon: { marginStart: ControlSize.settingsRow },
    dividerComfortableIcon: { marginStart: ControlSize.settingsRowComfortable, marginEnd: Space.lg },
  });
}
