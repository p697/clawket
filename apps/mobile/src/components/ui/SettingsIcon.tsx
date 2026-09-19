import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { ControlSize, Radius, Space } from '../../theme/tokens';

// `row` is the 32-point tile that sits in a settings row; `feature` is the 44-point
// tile that heads a feature card (OpenClaw management menu), sized like the
// settings avatar so the two share one radius scale.
const TILE_SIZES = {
  row: { size: Space.xxl, radius: Radius.avatarSheet, glyph: 17 },
  feature: { size: ControlSize.floatingButton, radius: Radius.avatarSettings, glyph: ControlSize.floatingButton / 2 },
} as const;

export type SettingsIconTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type SettingsIconTile = keyof typeof TILE_SIZES;

type Props = {
  icon: LucideIcon;
  tone?: SettingsIconTone;
  fill?: boolean;
  /** Glyph size; defaults to the tile's own (17 in a row tile, 22 in a feature tile). */
  size?: number;
  strokeWidth?: number;
  tile?: SettingsIconTile;
};

export function SettingsIcon({
  icon: Icon,
  tone = 'accent',
  fill = false,
  size,
  strokeWidth = 2.2,
  tile = 'row',
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

  const { size: tileSize, radius, glyph } = TILE_SIZES[tile];

  return (
    <View
      style={[
        styles.badge,
        { width: tileSize, height: tileSize, borderRadius: radius, backgroundColor: palette.background },
      ]}
    >
      <Icon
        size={size ?? glyph}
        strokeWidth={strokeWidth}
        color={palette.foreground}
        fill={fill ? palette.foreground : 'none'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
