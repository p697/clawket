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
      accent50: '#EEF3FF',
      accent100: '#DCE6FF',
      accent200: '#B8CAFF',
      accent500: '#1F5EFF',
      accent700: '#1748C7',
    },
    dark: {
      accent50: '#10172A',
      accent100: '#16213F',
      accent200: '#243866',
      accent500: '#6B95FF',
      accent700: '#A9C0FF',
    },
  },
  jadeGreen: {
    light: {
      accent50: '#ECF8F3',
      accent100: '#D8F0E6',
      accent200: '#A8DBC8',
      accent500: '#147A5B',
      accent700: '#0F5F47',
    },
    dark: {
      accent50: '#0E1C17',
      accent100: '#142820',
      accent200: '#224437',
      accent500: '#52C49A',
      accent700: '#91DEC3',
    },
  },
  oceanTeal: {
    light: {
      accent50: '#ECF8FA',
      accent100: '#D8F0F3',
      accent200: '#A4D8DE',
      accent500: '#0F7180',
      accent700: '#0B5864',
    },
    dark: {
      accent50: '#0D1B1E',
      accent100: '#13272B',
      accent200: '#21434A',
      accent500: '#55C2D0',
      accent700: '#92DCE4',
    },
  },
  sunsetOrange: {
    light: {
      accent50: '#FFF5EC',
      accent100: '#FDE7D3',
      accent200: '#F7C79C',
      accent500: '#A85312',
      accent700: '#843F0C',
    },
    dark: {
      accent50: '#21170F',
      accent100: '#302013',
      accent200: '#50351F',
      accent500: '#F1A45B',
      accent700: '#F7C993',
    },
  },
  rosePink: {
    light: {
      accent50: '#FDF0F5',
      accent100: '#F9DDE8',
      accent200: '#F1AFC7',
      accent500: '#B12D62',
      accent700: '#8D214C',
    },
    dark: {
      accent50: '#211318',
      accent100: '#301B23',
      accent200: '#512D3A',
      accent500: '#F0709F',
      accent700: '#F5ABC4',
    },
  },
  royalPurple: {
    light: {
      accent50: '#F4F0FD',
      accent100: '#E8DEFA',
      accent200: '#CBB8F2',
      accent500: '#6C43C2',
      accent700: '#533197',
    },
    dark: {
      accent50: '#181320',
      accent100: '#241B33',
      accent200: '#3D2D57',
      accent500: '#A98BFF',
      accent700: '#CBB9FF',
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
