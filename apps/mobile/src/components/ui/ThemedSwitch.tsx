import React, { useEffect, useMemo, useState } from 'react';
import { ColorValue, Platform, Switch, SwitchProps } from 'react-native';
import { useAppTheme } from '../../theme';

/**
 * Wrapper around RN Switch that works around an iOS bug where
 * trackColor and thumbColor are not applied on the initial render
 * when value starts as true.
 *
 * Root cause: iOS only applies custom colors when it detects a
 * prop CHANGE. On initial mount with value=true, the colors are
 * "new" but not "changed", so iOS ignores them.
 *
 * Fix: when value=true on iOS, run a short boot -> ready cycle:
 * - boot: value=false without custom colors
 * - ready: value=true with custom colors
 * and force remount between phases so UIKit fully reapplies styling.
 */
export function ThemedSwitch(props: SwitchProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { value, thumbColor, trackColor, onValueChange, ...rest } = props;
  const resolvedTrackColor = trackColor ?? {
    false: theme.colors.line,
    true: theme.colors.accentSoft,
  };
  const resolvedThumbColor = thumbColor
    ?? (value ? theme.colors.accent : theme.colors.surface);

  if (Platform.OS !== 'ios') {
    return (
      <Switch
        {...rest}
        value={value}
        thumbColor={resolvedThumbColor}
        trackColor={resolvedTrackColor}
        onValueChange={onValueChange}
      />
    );
  }

  const [phase, setPhase] = useState<'boot' | 'ready'>(value ? 'boot' : 'ready');
  const colorSignature = useMemo(() => {
    const toKey = (input: ColorValue | null | undefined): string => {
      if (input == null) return 'nil';
      return typeof input === 'string' || typeof input === 'number' ? String(input) : 'obj';
    };
    return `${toKey(resolvedTrackColor.false)}|${toKey(resolvedTrackColor.true)}|${toKey(resolvedThumbColor)}`;
  }, [resolvedThumbColor, resolvedTrackColor.false, resolvedTrackColor.true]);

  useEffect(() => {
    if (!value) {
      setPhase('ready');
      return;
    }

    setPhase('boot');
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    const fallback = setTimeout(() => {
      if (!cancelled) setPhase('ready');
    }, 120);

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!cancelled) setPhase('ready');
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(fallback);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [colorSignature, value]);

  if (phase === 'boot') {
    return (
      <Switch
        key={`ios-switch-boot-${colorSignature}`}
        {...rest}
        value={false}
        onValueChange={onValueChange}
      />
    );
  }

  return (
    <Switch
      key={`ios-switch-ready-${value ? '1' : '0'}-${colorSignature}`}
      {...rest}
      value={value}
      thumbColor={resolvedThumbColor}
      trackColor={resolvedTrackColor}
      onValueChange={onValueChange}
    />
  );
}
