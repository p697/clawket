import React from 'react';
import { Switch, type SwitchProps } from 'react-native';
import { useAppTheme } from '../../theme';

type ThemedSwitchProps = SwitchProps & { tone?: 'accent' | 'neutral' };

/** Keep the native control mounted and its value truthful through theme changes. */
export function ThemedSwitch({ tone = 'neutral', ...props }: ThemedSwitchProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { value, thumbColor, trackColor, ...rest } = props;
  const neutral = tone === 'neutral';
  const resolvedTrackColor = trackColor ?? {
    false: theme.colors.line,
    true: neutral
      ? (theme.scheme === 'dark' ? theme.colors.inkSecondary : theme.colors.ink)
      : theme.colors.accentSoft,
  };
  return (
    <Switch
      {...rest}
      value={value}
      ios_backgroundColor={props.ios_backgroundColor ?? resolvedTrackColor.false ?? undefined}
      thumbColor={thumbColor ?? (neutral ? (theme.scheme === 'dark' ? theme.colors.ink : theme.colors.canvas) : value ? theme.colors.accent : theme.colors.surface)}
      trackColor={resolvedTrackColor}
    />
  );
}
