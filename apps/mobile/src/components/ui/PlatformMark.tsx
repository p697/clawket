import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { ControlSize, Radius } from '../../theme/tokens';
import { Monitor, Pi } from 'lucide-react-native';
import { useAppTheme } from '../../theme';

const marks = {
  openclaw: require('../../../assets/brands/openclaw.png'),
  hermes: require('../../../assets/brands/hermes.png'),
  youmind: require('../../../assets/brands/youmind.png'),
} as const;

/** Product marks; bundled artwork provenance is recorded in assets/brands/SOURCES.md. */
export function PlatformMark({ platform, size }: { platform: keyof typeof marks | 'local-model' | 'pi'; size?: number }) {
  const { theme } = useAppTheme();
  if (platform === 'pi') return <Pi size={size ?? ControlSize.pill} color={theme.colors.ink} accessible={false} />;
  if (platform === 'local-model') return <Monitor size={size ?? ControlSize.pill} color={theme.colors.ink} accessible={false} />;
  return <Image accessible={false} source={marks[platform]} resizeMode="contain" style={[platform === 'hermes' ? styles.appIcon : styles.mark, size ? { width: size, height: size } : null]} />;
}

const styles = StyleSheet.create({
  // The official app artwork already includes its corner shape and safe area.
  appIcon: { width: ControlSize.settingsRow, height: ControlSize.settingsRow },
  mark: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.settingsGroup },
});
