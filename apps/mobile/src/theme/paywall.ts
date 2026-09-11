import type { AppTheme } from './theme';

/** Owner-approved Lumen presentation scope. Never changes the application preference. */
export function buildPaywallTheme(parent: AppTheme): AppTheme {
  return {
    ...parent,
    scheme: 'dark',
    mode: 'dark',
    colors: {
      ...parent.colors,
      canvas: '#101113', canvasGrouped: '#101113', surface: '#202225', surfaceFloating: '#26282C',
      ink: '#F3F3F2', inkSecondary: '#ABAEB4', inkTertiary: '#999DA4', line: '#41454B',
      accent: '#F4F4F0', accentSoft: '#2C3035', onAccent: '#17181B',
      bad: '#FFABA7', badSoft: '#3B2729', good: '#AACDBD', goodSoft: '#21352D',
      warn: '#E4CB97', warnSoft: '#383120', scrim: 'rgba(0,0,0,0.6)',
    },
  };
}

/** Original silver companion artwork, independent of conversation accent colors. */
export const paywallArtwork = {
  silver: ['#FAFFFF', '#CBD2D7', '#6B777E', '#222A2E', '#9AA5AF', '#E2E7EB', '#515B64'],
  edge: ['#202328', '#535C63', '#E4EAEE', '#68747C', '#1B1D21'],
  eye: ['#080B0D', '#303A41'],
  halo: '#B2C5D3', shadow: '#020304', orbit: '#94A1AA', mask: '#FFFFFF',
} as const;
