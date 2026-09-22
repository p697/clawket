import React, { createContext, useContext, useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronDown, Lock } from 'lucide-react-native';
import { ChevronRight } from './DirectionalIcon';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../theme/tokens';

export type SettingsGroupProps = {
  children: React.ReactNode;
  density?: 'standard' | 'comfortable';
  /**
   * `card` (default) is the rounded floating card with 16-point row insets and a
   * full-width press fill. `plain` drops the card chrome: no fill or radius, rows
   * and hairlines sit on the surrounding content edge, and a press fades the row
   * instead of painting a fill that would start at the text edge.
   */
  chrome?: SettingsChrome;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type SettingsChrome = 'card' | 'plain';

export type SettingsRowProps = {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
  subtitleLines?: 1 | 2;
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
  /** `wide` lets a long trailing value (a model name) take up to 64% instead of 44%; the title must stay short. */
  tailWidth?: 'default' | 'wide';
  accessibilityLabel?: string;
  selected?: boolean;
  /**
   * Disclosure state of a row that reveals content beneath it. Unlike
   * `selected` (a current choice, painted as an inset fill) an expanded row
   * keeps its plain background: the chevron turns down and the title firms up.
   */
  expanded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type SettingsDividerProps = {
  /** Defaults to `icon` inside a card and `none` on plain rows. */
  inset?: 'none' | 'content' | 'icon';
  testID?: string;
};

const SettingsDensity = createContext<'standard' | 'comfortable'>('standard');
// A row rendered outside any group is a plain list row on its container's
// content edge (Runs, Heartbeat, Commands, the Add sheet menu, schedule fields).
const SettingsChromeContext = createContext<SettingsChrome>('plain');

export function SettingsGroup({ children, density = 'standard', chrome = 'card', style, testID }: SettingsGroupProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <SettingsDensity.Provider value={density}>
      <SettingsChromeContext.Provider value={chrome}>
        <View testID={testID} style={[styles.group, chrome === 'card' ? styles.groupCard : null, chrome === 'card' && density === 'comfortable' ? styles.groupComfortable : null, style]}>{children}</View>
      </SettingsChromeContext.Provider>
    </SettingsDensity.Provider>
  );
}

export function SettingsRow({
  children,
  title,
  subtitle,
  subtitleLines = 2,
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
  tailWidth = 'default',
  accessibilityLabel,
  selected,
  expanded,
  style,
  testID,
}: SettingsRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const comfortable = useContext(SettingsDensity) === 'comfortable';
  const plain = useContext(SettingsChromeContext) === 'plain';
  const rowStyle = [styles.row, comfortable ? styles.rowComfortable : null, plain ? styles.rowPlain : null];
  const layoutStyle = layout === 'column' ? styles.rowColumn : styles.rowHorizontal;
  const content = children ?? (
    <>
      {comfortable && leading ? <View style={styles.leadingComfortable}>{leading}</View> : leading}
      <View style={styles.copy}>
        {title ? <Text style={[styles.title, expanded ? styles.titleExpanded : null, destructive ? { color: theme.colors.bad } : null]} numberOfLines={comfortable ? undefined : 2}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={subtitleLines}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.tail, tailWidth === 'wide' ? styles.tailWide : null]}>
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
          expanded
            ? <ChevronDown testID={testID ? `${testID}-chevron-down` : undefined} size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2} />
            : <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2} />
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
      accessibilityState={{
        disabled,
        ...(selected !== undefined ? { selected } : {}),
        ...(expanded !== undefined ? { expanded } : {}),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        rowStyle,
        layoutStyle,
        pressed && !disabled ? (plain ? styles.rowPressedPlain : styles.rowPressed) : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {selected ? (
        <View
          pointerEvents="none"
          testID={testID ? `${testID}-selected-fill` : undefined}
          style={[styles.selectedFill, plain ? styles.selectedFillPlain : null]}
        />
      ) : null}
      {content}
    </Pressable>
  );
}

export function SettingsDivider({ inset: insetProp, testID }: SettingsDividerProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const comfortable = useContext(SettingsDensity) === 'comfortable';
  const plain = useContext(SettingsChromeContext) === 'plain';
  const inset = insetProp ?? (plain ? 'none' : 'icon');
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
    group: {},
    // Only the card carries a fill and a radius (and clips its rows to it); a
    // plain group is invisible chrome whose selected fill may breathe past its rows.
    groupCard: {
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
    rowPlain: { paddingHorizontal: 0 },
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
    titleExpanded: { fontWeight: FontWeight.semibold },
    subtitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    tailWide: { maxWidth: '64%' },
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
    // Plain rows have no card to clip a fill, so a fill would start at the
    // text edge (owner feedback 2026-09-19: an edge-hugging shadow); the row
    // fades like the app's other quiet pressables instead.
    rowPressedPlain: { opacity: Motion.pressedOpacity },
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
    // A plain row has no inset for the fill to sit inside, so it breathes 8
    // points past the text edge instead of starting after the text does.
    selectedFillPlain: { start: -Space.sm, end: -Space.sm },
    disabled: { opacity: 0.45 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    dividerContent: { marginStart: Space.lg },
    dividerIcon: { marginStart: ControlSize.settingsRow },
    dividerComfortableIcon: { marginStart: ControlSize.settingsRowComfortable, marginEnd: Space.lg },
  });
}
