import React from 'react';
import { Image, StyleSheet } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ControlSize, Radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme';

const marks = {
  'claude-code': require('../../../assets/brands/claude-code.png'),
  codex: require('../../../assets/brands/codex.png'),
  pi: require('../../../assets/brands/pi.png'),
  openclaw: require('../../../assets/brands/openclaw.png'),
  hermes: require('../../../assets/brands/hermes.png'),
  youmind: require('../../../assets/brands/youmind.png'),
} as const;

/** Product marks; bundled artwork provenance is recorded in assets/brands/SOURCES.md. */
export function PlatformMark({ platform, size }: { platform: keyof typeof marks | 'local-model'; size?: number }) {
  if (platform === 'local-model') return <LocalModelMark size={size} />;
  return <Image accessible={false} source={marks[platform]} resizeMode="contain" style={[platform === 'hermes' || platform === 'codex' ? styles.appIcon : styles.mark, size ? { width: size, height: size } : null]} />;
}

/** Processor outline in the 52-point frame, sized to sit inside the 42-point tile like the app-icon artwork. */
const LOCAL_MODEL_CHIP = 'M21.75 18.5h8.5a3.25 3.25 0 0 1 3.25 3.25v8.5a3.25 3.25 0 0 1-3.25 3.25h-8.5a3.25 3.25 0 0 1-3.25-3.25v-8.5a3.25 3.25 0 0 1 3.25-3.25Z'
  + 'M24.25 23h3.5a1.25 1.25 0 0 1 1.25 1.25v3.5a1.25 1.25 0 0 1-1.25 1.25h-3.5a1.25 1.25 0 0 1-1.25-1.25v-3.5a1.25 1.25 0 0 1 1.25-1.25Z'
  + 'M22.5 15v3M26 15v3M29.5 15v3M22.5 34v3M26 34v3M29.5 34v3M15 22.5h3M15 26h3M15 29.5h3M34 22.5h3M34 26h3M34 29.5h3';

/**
 * Clawket-drawn mark for the brand-less local-model backend (owner request 2026-09-26: an outline
 * on a quiet tile, never a dark backing). Theme ink and surface keep it readable in both schemes.
 */
function LocalModelMark({ size = ControlSize.settingsRow }: { size?: number }) {
  const { theme: { colors } } = useAppTheme();
  // Hold the outline at 1.2 points or more when drawn small (connection list, avatar badge).
  const strokeWidth = Math.max(1.9, (1.2 * ControlSize.settingsRow) / size);
  return <Svg testID="platform-mark-local-model" accessible={false} width={size} height={size} viewBox="0 0 52 52">
    <Rect x={5} y={5} width={42} height={42} rx={10.5} fill={colors.surface} />
    <Path d={LOCAL_MODEL_CHIP} fill="none" stroke={colors.ink} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

const styles = StyleSheet.create({
  // The official app artwork already includes its corner shape and safe area.
  appIcon: { width: ControlSize.settingsRow, height: ControlSize.settingsRow },
  mark: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.settingsGroup },
});
