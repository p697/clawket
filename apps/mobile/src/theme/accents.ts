import { AccentColorId } from '../types';

export type AccentScheme = 'light' | 'dark';

export type AccentToneScale = {
  accent50: string;
  accent100: string;
  accent200: string;
  accent500: string;
  accent700: string;
};

export type AccentScale = {
  light: AccentToneScale;
  dark: AccentToneScale;
};

export type BuiltInAccentColorId = Exclude<AccentColorId, 'custom'>;

export const builtInAccents: Record<BuiltInAccentColorId, AccentScale> = {
  iceBlue: {
    light: {
      accent50: '#F2F6F8',
      accent100: '#E2EBF0',
      accent200: '#B8CBD7',
      accent500: '#6F97AE',
      accent700: '#4E7188',
    },
    dark: {
      accent50: '#111A20',
      accent100: '#17222A',
      accent200: '#243540',
      accent500: '#86AABD',
      accent700: '#A9C4D2',
    },
  },
  jadeGreen: {
    light: {
      accent50: '#F1F8F3',
      accent100: '#DFEDE4',
      accent200: '#B2D0BD',
      accent500: '#5A9A76',
      accent700: '#3F7358',
    },
    dark: {
      accent50: '#131C17',
      accent100: '#1A261F',
      accent200: '#273A30',
      accent500: '#78AF8F',
      accent700: '#9AC4AE',
    },
  },
  oceanTeal: {
    light: {
      accent50: '#F1F8F8',
      accent100: '#DFEEED',
      accent200: '#B1CFCC',
      accent500: '#5A9792',
      accent700: '#3E716D',
    },
    dark: {
      accent50: '#121B1B',
      accent100: '#182424',
      accent200: '#253939',
      accent500: '#79B1AB',
      accent700: '#9CC7C1',
    },
  },
  sunsetOrange: {
    light: {
      accent50: '#FBF4EF',
      accent100: '#F4E5D8',
      accent200: '#DEC1A4',
      accent500: '#C98557',
      accent700: '#9F6540',
    },
    dark: {
      accent50: '#211710',
      accent100: '#2B1F17',
      accent200: '#433125',
      accent500: '#D59A6E',
      accent700: '#E4B48E',
    },
  },
  rosePink: {
    light: {
      accent50: '#FAF1F4',
      accent100: '#F0E0E7',
      accent200: '#D9B3C0',
      accent500: '#B96A81',
      accent700: '#915065',
    },
    dark: {
      accent50: '#1D1519',
      accent100: '#281C22',
      accent200: '#3F2C34',
      accent500: '#CB88A0',
      accent700: '#DBA8B9',
    },
  },
  royalPurple: {
    light: {
      accent50: '#F4F1F8',
      accent100: '#E7E0F0',
      accent200: '#C4B6D8',
      accent500: '#8B72B2',
      accent700: '#69548B',
    },
    dark: {
      accent50: '#18141D',
      accent100: '#211B28',
      accent200: '#342A3F',
      accent500: '#A591C5',
      accent700: '#C1B3D8',
    },
  },
};

export const defaultAccentId: BuiltInAccentColorId = 'iceBlue';

export function isBuiltInAccentId(value: string): value is BuiltInAccentColorId {
  return value === 'iceBlue' || value === 'jadeGreen' || value === 'oceanTeal' || value === 'sunsetOrange' || value === 'rosePink' || value === 'royalPurple';
}

export function resolveAccentScale(
  accentId: AccentColorId,
  customAccent?: AccentScale | null,
): AccentScale {
  if (accentId === 'custom' && customAccent) return customAccent;
  if (isBuiltInAccentId(accentId)) return builtInAccents[accentId];
  return builtInAccents[defaultAccentId];
}

function isAccentToneScale(value: unknown): value is AccentToneScale {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['accent50'] === 'string' &&
    typeof v['accent100'] === 'string' &&
    typeof v['accent200'] === 'string' &&
    typeof v['accent500'] === 'string' &&
    typeof v['accent700'] === 'string'
  );
}

export function isAccentScale(value: unknown): value is AccentScale {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return isAccentToneScale(v['light']) && isAccentToneScale(v['dark']);
}
