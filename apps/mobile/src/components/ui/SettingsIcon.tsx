import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { ControlSize, Radius } from '../../theme/tokens';

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
      case 'info': return { foreground: theme.colors.info, background: theme.colors.infoSoft };
      case 'success': return { foreground: theme.colors.success, background: theme.colors.successSoft };
      case 'warning': return { foreground: theme.colors.warning, background: theme.colors.warningSoft };
      case 'danger': return { foreground: theme.colors.error, background: theme.colors.errorSoft };
      case 'neutral': return { foreground: theme.colors.textMuted, background: theme.colors.surfaceMuted };
      default: return { foreground: theme.colors.primary, background: theme.colors.primarySoft };
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
    width: ControlSize.settingsIcon,
    height: ControlSize.settingsIcon,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
