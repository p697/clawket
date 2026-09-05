import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { Radius } from '../../theme/tokens';

const SETTINGS_ICON_SIZE = 32;

export type SettingsIconTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

type Props = {
  icon: LucideIcon;
  tone?: SettingsIconTone;
  fill?: boolean;
  size?: number;
  strokeWidth?: number;
};

export function SettingsIcon({
  icon: Icon,
  tone = 'accent',
  fill = false,
  size = 17,
  strokeWidth = 2.2,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const palette = useMemo(() => {
    switch (tone) {
      case 'info': return { foreground: theme.colors.accent, background: theme.colors.accentSoft };
      case 'success': return { foreground: theme.colors.good, background: theme.colors.goodSoft };
      case 'warning': return { foreground: theme.colors.warn, background: theme.colors.warnSoft };
      case 'danger': return { foreground: theme.colors.bad, background: theme.colors.badSoft };
      case 'neutral': return { foreground: theme.colors.inkSecondary, background: theme.colors.surface };
      default: return { foreground: theme.colors.accent, background: theme.colors.accentSoft };
    }
  }, [theme.colors, tone]);

  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Icon
        size={size}
        strokeWidth={strokeWidth}
        color={palette.foreground}
        fill={fill ? palette.foreground : 'none'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: SETTINGS_ICON_SIZE,
    height: SETTINGS_ICON_SIZE,
    borderRadius: Radius.avatarSheet,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
