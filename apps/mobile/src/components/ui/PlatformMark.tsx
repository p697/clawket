import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { ControlSize, Radius } from '../../theme/tokens';

const marks = {
  openclaw: require('../../../assets/brands/openclaw.png'),
  hermes: require('../../../assets/brands/hermes.png'),
  youmind: require('../../../assets/brands/youmind.png'),
} as const;

/** Official identity artwork; provenance is recorded in assets/brands/SOURCES.md. */
export function PlatformMark({ platform }: { platform: keyof typeof marks }) {
  return <Image accessible={false} source={marks[platform]} resizeMode="contain" style={platform === 'hermes' ? styles.appIcon : styles.mark} />;
}

const styles = StyleSheet.create({
  // The official app artwork already includes its corner shape and safe area.
  appIcon: { width: ControlSize.settingsRow, height: ControlSize.settingsRow },
  mark: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.settingsGroup },
});
