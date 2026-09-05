import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { AccentColorId, ThemeMode } from '../types';
import { resolveAccentScale } from './accents';
import { AppTheme, buildTheme, resolveThemeScheme, ThemeScheme } from './theme';

export type ThemeContextValue = {
  theme: AppTheme;
  mode: ThemeMode;
  accentId: AccentColorId;
  systemScheme: ThemeScheme;
  resolvedScheme: ThemeScheme;
  setMode: (mode: ThemeMode) => void;
  setAccentId: (accentId: AccentColorId) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

type Props = {
  mode: ThemeMode;
  accentId: AccentColorId;
  setMode: (mode: ThemeMode) => void;
  setAccentId: (accentId: AccentColorId) => void;
  children: React.ReactNode;
};

function normalizeScheme(
  input: ReturnType<typeof Appearance.getColorScheme> | undefined,
  fallback: ThemeScheme,
): ThemeScheme {
  if (input === 'dark') return 'dark';
  if (input === 'light') return 'light';
  const native = Appearance.getColorScheme();
  if (native === 'dark') return 'dark';
  if (native === 'light') return 'light';
  return fallback;
}

export function AppThemeProvider({
  mode,
  accentId,
  setMode,
  setAccentId,
  children,
}: Props): React.JSX.Element {
  const hookScheme = useColorScheme();
  const [systemScheme, setSystemScheme] = useState<ThemeScheme>(
    normalizeScheme(Appearance.getColorScheme(), 'light'),
  );

  useEffect(() => {
    setSystemScheme((prev) => normalizeScheme(hookScheme, prev));
  }, [hookScheme]);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme((prev) => normalizeScheme(colorScheme, prev));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // Keep native interface style aligned with app preference.
    // "unspecified" means "follow system".
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedScheme = resolveThemeScheme(mode, systemScheme);
    const accent = resolveAccentScale(accentId);
    return {
      mode,
      accentId,
      systemScheme,
      resolvedScheme,
      setMode,
      setAccentId,
      theme: buildTheme(mode, systemScheme, accent),
    };
  }, [mode, accentId, setMode, setAccentId, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return ctx;
}
