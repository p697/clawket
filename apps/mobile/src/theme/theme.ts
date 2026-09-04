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
  good: string;
  goodSoft: string;
  warn: string;
  warnSoft: string;
  bad: string;
  badSoft: string;
};

/**
 * @deprecated Temporary aliases for pre-3.0 screens. New code must use
 * `CanonicalThemeColors`; remove this surface once those screens migrate.
 */
export type LegacyThemeColorAliases = {
  /** @deprecated Use `canvas`. */
  background: string;
  /** @deprecated Use `surface`. */
  surfaceMuted: string;
  /** @deprecated Use `surfaceFloating`. */
  surfaceElevated: string;
  /** @deprecated Use `line`. */
  border: string;
  /** @deprecated Use `line`. */
  borderStrong: string;
  /** @deprecated Use `ink`. */
  text: string;
  /** @deprecated Use `inkSecondary`. */
  textMuted: string;
  /** @deprecated Use `inkTertiary`. */
  textSubtle: string;
  /** @deprecated Use `accent` or `accentSoft`. */
  accent50: string;
  /** @deprecated Use `accent` or `accentSoft`. */
  accent100: string;
  /** @deprecated Use `accent` or `accentSoft`. */
  accent200: string;
  /** @deprecated Use `accent`. */
  accent500: string;
  /** @deprecated Use `accent`. */
  accent700: string;
  /** @deprecated Use `accent`. */
  primary: string;
  /** @deprecated Use an explicit foreground appropriate to `accent`. */
  primaryText: string;
  /** @deprecated Use `accentSoft`. */
  primarySoft: string;
  /** @deprecated Use `accentSoft`. */
  searchHighlightBg: string;
  /** @deprecated Use `good`. */
  success: string;
  /** @deprecated Use `goodSoft`. */
  successSoft: string;
  /** @deprecated Use `warn`. */
  warning: string;
  /** @deprecated Use `warnSoft`. */
  warningSoft: string;
  /** @deprecated Use `bad`. */
  error: string;
  /** @deprecated Use `badSoft`. */
  errorSoft: string;
  /** @deprecated Use `accent`. */
  info: string;
  /** @deprecated Use `accentSoft`. */
  infoSoft: string;
  /** @deprecated Presentation-only compatibility token. */
  overlay: string;
  /** @deprecated Debug-only compatibility token. */
  debugOverlay: string;
  /** @deprecated Use `good`. */
  debugText: string;
  /** @deprecated Use `accentSoft`. */
  bubbleUser: string;
  /** @deprecated Use `surface`. */
  bubbleAssistant: string;
  /** @deprecated Use `surface`. */
  bubbleSystem: string;
  /** @deprecated Use `inkSecondary`. */
  bubbleSystemText: string;
  /** @deprecated Use `surfaceFloating`. */
  inputBackground: string;
  /** @deprecated Use `line`. */
  imageAddBorder: string;
  /** @deprecated Use `inkTertiary`. */
  imageAddText: string;
  /** @deprecated Presentation-only compatibility token. */
  chatPreviewMask: string;
  /** @deprecated Presentation-only compatibility token. */
  sidebarBackdrop: string;
  /** @deprecated Use an explicit on-color foreground. */
  iconOnColor: string;
  /** @deprecated Use `agentPalette`. */
  sessionBadgeSubagent: string;
  /** @deprecated Use `agentPalette`. */
  sessionBadgeCron: string;
  /** @deprecated Use `agentPalette`. */
  sessionBadgeTelegram: string;
  /** @deprecated Use `agentPalette`. */
  sessionBadgeDiscord: string;
  /** @deprecated Use `agentPalette`. */
  sessionBadgeSlack: string;
  /** @deprecated Data-visualization compatibility token. */
  usageCostOutput: string;
  /** @deprecated Data-visualization compatibility token. */
  usageCostInput: string;
  /** @deprecated Data-visualization compatibility token. */
  usageCostCacheWrite: string;
  /** @deprecated Data-visualization compatibility token. */
  usageCostCacheRead: string;
  /** @deprecated Use `agentPalette`. */
  badgeModel: string;
  /** @deprecated Use `agentPalette`. */
  badgeThinking: string;
  /** @deprecated Use `agentPalette`. */
  badgeTools: string;
  /** @deprecated Use `agentPalette`. */
  badgePrompts: string;
  /** @deprecated Use `line`. */
  chartGrid: string;
  /** @deprecated Use the shared `Shadow` recipes. */
  shadow: string;
};

export type AppThemeColors = CanonicalThemeColors & LegacyThemeColorAliases;

export type AppTheme = {
  scheme: ThemeScheme;
  mode: ThemeMode;
  colors: AppThemeColors;
};

type DerivedAccentKeys =
  | 'accent'
  | 'accentSoft'
  | 'accent50'
  | 'accent100'
  | 'accent200'
  | 'accent500'
  | 'accent700'
  | 'primary'
  | 'primaryText'
  | 'primarySoft'
  | 'searchHighlightBg'
  | 'bubbleUser'
  | 'info'
  | 'infoSoft';
type FixedPalette = Omit<AppThemeColors, DerivedAccentKeys>;

const lightCanonical = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
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
  good: '#2FA07C',
  goodSoft: 'rgba(47,160,124,0.2)',
  warn: '#D07F30',
  warnSoft: 'rgba(208,127,48,0.2)',
  bad: '#E06060',
  badSoft: 'rgba(224,96,96,0.2)',
} as const;

const lightPalette: FixedPalette = {
  ...lightCanonical,
  background: lightCanonical.canvas,
  surfaceMuted: lightCanonical.surface,
  surfaceElevated: lightCanonical.surfaceFloating,
  border: lightCanonical.line,
  borderStrong: lightCanonical.line,
  text: lightCanonical.ink,
  textMuted: lightCanonical.inkSecondary,
  textSubtle: lightCanonical.inkTertiary,
  success: lightCanonical.good,
  successSoft: lightCanonical.goodSoft,
  warning: lightCanonical.warn,
  warningSoft: lightCanonical.warnSoft,
  error: lightCanonical.bad,
  errorSoft: lightCanonical.badSoft,
  overlay: 'rgba(0,0,0,0.4)',
  debugOverlay: 'rgba(0,0,0,0.85)',
  debugText: lightCanonical.good,
  bubbleAssistant: lightCanonical.surface,
  bubbleSystem: lightCanonical.surface,
  bubbleSystemText: lightCanonical.inkSecondary,
  inputBackground: lightCanonical.surfaceFloating,
  imageAddBorder: lightCanonical.line,
  imageAddText: lightCanonical.inkTertiary,
  chatPreviewMask: 'rgba(0,0,0,0.96)',
  sidebarBackdrop: 'rgba(0,0,0,0.35)',
  iconOnColor: '#FFFFFF',
  sessionBadgeSubagent: agentPalette[4],
  sessionBadgeCron: agentPalette[1],
  sessionBadgeTelegram: agentPalette[5],
  sessionBadgeDiscord: agentPalette[0],
  sessionBadgeSlack: agentPalette[3],
  usageCostOutput: lightCanonical.bad,
  usageCostInput: agentPalette[0],
  usageCostCacheWrite: lightCanonical.warn,
  usageCostCacheRead: lightCanonical.good,
  badgeModel: agentPalette[4],
  badgeThinking: lightCanonical.warn,
  badgeTools: agentPalette[0],
  badgePrompts: lightCanonical.good,
  chartGrid: lightCanonical.line,
  shadow: lightCanonical.ink,
};

const darkPalette: FixedPalette = {
  ...darkCanonical,
  background: darkCanonical.canvas,
  surfaceMuted: darkCanonical.surface,
  surfaceElevated: darkCanonical.surfaceFloating,
  border: darkCanonical.line,
  borderStrong: darkCanonical.line,
  text: darkCanonical.ink,
  textMuted: darkCanonical.inkSecondary,
  textSubtle: darkCanonical.inkTertiary,
  success: darkCanonical.good,
  successSoft: darkCanonical.goodSoft,
  warning: darkCanonical.warn,
  warningSoft: darkCanonical.warnSoft,
  error: darkCanonical.bad,
  errorSoft: darkCanonical.badSoft,
  overlay: 'rgba(0,0,0,0.4)',
  debugOverlay: 'rgba(5,8,14,0.92)',
  debugText: darkCanonical.good,
  bubbleAssistant: darkCanonical.surface,
  bubbleSystem: darkCanonical.surface,
  bubbleSystemText: darkCanonical.inkSecondary,
  inputBackground: darkCanonical.surfaceFloating,
  imageAddBorder: darkCanonical.line,
  imageAddText: darkCanonical.inkTertiary,
  chatPreviewMask: 'rgba(2,4,8,0.98)',
  sidebarBackdrop: 'rgba(0,0,0,0.5)',
  iconOnColor: '#FFFFFF',
  sessionBadgeSubagent: agentPalette[4],
  sessionBadgeCron: agentPalette[1],
  sessionBadgeTelegram: agentPalette[5],
  sessionBadgeDiscord: agentPalette[0],
  sessionBadgeSlack: agentPalette[3],
  usageCostOutput: darkCanonical.bad,
  usageCostInput: agentPalette[0],
  usageCostCacheWrite: darkCanonical.warn,
  usageCostCacheRead: darkCanonical.good,
  badgeModel: agentPalette[4],
  badgeThinking: darkCanonical.warn,
  badgeTools: agentPalette[0],
  badgePrompts: darkCanonical.good,
  chartGrid: darkCanonical.line,
  shadow: '#000000',
};

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
    accent50: accent.accent50,
    accent100: accent.accent100,
    accent200: accent.accent200,
    accent500: accent.accent500,
    accent700: accent.accent700,
    primary: accent.accent500,
    primaryText: scheme === 'dark' ? fixedPalette.canvas : '#FFFFFF',
    primarySoft: accentSoft,
    searchHighlightBg: accentSoft,
    bubbleUser: accentSoft,
    info: accent.accent500,
    infoSoft: accentSoft,
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
