import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { Orbit } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { IconSize } from '../../theme/tokens';
import { resolveModelIconSource, type ModelIconInput } from './model-icons';

/** Bundled artwork retains its original backing and colors in either theme. */
export function ModelIcon({ testID, compact = false, ...model }: ModelIconInput & { testID?: string; compact?: boolean }) {
  const { theme } = useAppTheme();
  const source = resolveModelIconSource(model);
  return source ? <Image testID={testID} accessible={false} source={source} resizeMode="contain" style={compact ? styles.compact : styles.icon} />
    : <Orbit testID={testID} accessible={false} size={compact ? IconSize.md : IconSize.lg} color={theme.colors.inkSecondary} strokeWidth={1.75} />;
}

const styles = StyleSheet.create({
  compact: { width: IconSize.md, height: IconSize.md },
  icon: { width: IconSize.lg, height: IconSize.lg },
});
