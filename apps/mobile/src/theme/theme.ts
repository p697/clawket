import { ThemeMode } from '../types';
import { AccentScale, AccentToneScale } from './accents';

export type ThemeScheme = 'light' | 'dark';

export const agentPalette = [
  '#1F5EFF',
  '#D9791C',
  '#178A6A',
  '#E2477B',
  '#7A5AF8',
  '#1C8FA3',
  '#8A5A3C',
  '#5B6673',
] as const;

export type CanonicalThemeColors = {
  canvas: string;
  canvasGrouped: string;
  surface: string;
  surfaceFloating: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  line: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  scrim: string;
  good: string;
  goodSoft: string;
  warn: string;
  warnSoft: string;
  bad: string;
  badSoft: string;
};

export type AppThemeColors = CanonicalThemeColors;

export type AppTheme = {
  scheme: ThemeScheme;
  mode: ThemeMode;
  colors: AppThemeColors;
};

type FixedPalette = Omit<AppThemeColors, 'accent' | 'accentSoft'>;

const lightCanonical = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  onAccent: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.4)',
  good: '#178A6A',
  goodSoft: 'rgba(23,138,106,0.12)',
  warn: '#D9791C',
  warnSoft: 'rgba(217,121,28,0.12)',
  bad: '#D64545',
  badSoft: 'rgba(214,69,69,0.12)',
} as const;

const darkCanonical = {
  canvas: '#0C0C0D',
  canvasGrouped: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
  line: '#2A2A2F',
  onAccent: '#0C0C0D',
  scrim: 'rgba(0,0,0,0.4)',
  good: '#2FA07C',
  goodSoft: 'rgba(47,160,124,0.2)',
  warn: '#D07F30',
  warnSoft: 'rgba(208,127,48,0.2)',
  bad: '#E06060',
  badSoft: 'rgba(224,96,96,0.2)',
} as const;

const lightPalette: FixedPalette = lightCanonical;
const darkPalette: FixedPalette = darkCanonical;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const raw = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  const value = Number.parseInt(raw, 16);
  if (!Number.isFinite(value) || raw.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function applyAccentPalette(
  scheme: ThemeScheme,
  fixedPalette: FixedPalette,
  accent: AccentToneScale,
): AppThemeColors {
  const accentSoft = withAlpha(accent.accent500, scheme === 'dark' ? 0.16 : 0.1);
  return {
    ...fixedPalette,
    accent: accent.accent500,
    accentSoft,
  };
}

export function resolveThemeScheme(mode: ThemeMode, systemScheme: ThemeScheme): ThemeScheme {
  return mode === 'system' ? systemScheme : mode;
}

export function buildTheme(mode: ThemeMode, systemScheme: ThemeScheme, accent: AccentScale): AppTheme {
  const scheme = resolveThemeScheme(mode, systemScheme);
  const fixedPalette = scheme === 'dark' ? darkPalette : lightPalette;
  const accentPalette = scheme === 'dark' ? accent.dark : accent.light;
  return {
    scheme,
    mode,
    colors: applyAccentPalette(scheme, fixedPalette, accentPalette),
  };
}
