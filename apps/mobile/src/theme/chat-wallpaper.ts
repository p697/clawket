import type { AccentColorId } from '../types';
import { defaultAccentId, isBuiltInAccentId } from './accents';
import type { ThemeScheme } from './theme';

/**
 * The conversation's own colors for one accent and scheme (owner-approved
 * A+ chat design, 2026-09-30). The built-in wallpaper is a 165° gradient of
 * three same-family stops under faint Clawket doodles; the user's own bubble
 * is the solid accent with white text; the Agent's bubble is white (a tinted
 * charcoal in dark); centred service pills are a deep accent-family tint.
 *
 * Every value is checked by `features/chat-appearance/resolver.test.ts`:
 * white text stays at least 4.5:1 on the outgoing bubble and on a service
 * pill over every gradient stop.
 */
export type ChatWallpaperPalette = Readonly<{
  /** Top-left, middle and bottom-right stops of the wallpaper gradient. */
  gradient: readonly [string, string, string];
  /** Doodle stroke color, drawn at `doodleOpacity`. */
  doodle: string;
  doodleOpacity: number;
  /** The user's own bubble. Always opaque. */
  outgoing: string;
  /** Text and glyphs on the user's own bubble. */
  onOutgoing: string;
  /** The Agent's bubble over the wallpaper. */
  incoming: string;
  /** Dates, system notices and process pills over the wallpaper. */
  service: string;
  /** Text on a service pill. */
  onService: string;
}>;

type AccentWallpaperPalettes = Readonly<Record<ThemeScheme, ChatWallpaperPalette>>;

const WHITE = '#FFFFFF';
const LIGHT_SERVICE_ALPHA = 0.7;
const DARK_SERVICE = 'rgba(255,255,255,0.12)';
const DARK_ON_SERVICE = '#E6E9F2';
const LIGHT_DOODLE_OPACITY = 0.09;
const DARK_DOODLE_OPACITY = 0.07;

function lightService(rgb: string): string {
  return `rgba(${rgb},${LIGHT_SERVICE_ALPHA})`;
}

export const chatWallpaperPalettes: Readonly<Record<AccentColorId, AccentWallpaperPalettes>> = {
  iceBlue: {
    light: {
      gradient: ['#DCE7FE', '#E8EEFD', '#F1E9FB'],
      doodle: '#2C4FC4',
      doodleOpacity: LIGHT_DOODLE_OPACITY,
      outgoing: '#1F5EFF',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('36,52,104'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#0F1526', '#111A33', '#1A1530'],
      doodle: '#9DB4FF',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#2A57D6',
      onOutgoing: WHITE,
      incoming: '#1E2029',
      service: DARK_SERVICE,
      onService: DARK_ON_SERVICE,
    },
  },
  royalPurple: {
    light: {
      gradient: ['#E9E1FB', '#F0EAFB', '#F8E8F2'],
      doodle: '#533197',
      doodleOpacity: LIGHT_DOODLE_OPACITY,
      outgoing: '#6C43C2',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('62,36,104'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#151028', '#1A1330', '#22122C'],
      doodle: '#CBB9FF',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#6A45C9',
      onOutgoing: WHITE,
      incoming: '#211E2B',
      service: DARK_SERVICE,
      onService: DARK_ON_SERVICE,
    },
  },
  jadeGreen: {
    light: {
      gradient: ['#DAF0E6', '#E8F3EC', '#F1F0E2'],
      doodle: '#0F5F47',
      doodleOpacity: LIGHT_DOODLE_OPACITY,
      outgoing: '#147A5B',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('20,72,56'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#0D1A16', '#10201B', '#17201A'],
      doodle: '#91DEC3',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#1E7A5C',
      onOutgoing: WHITE,
      incoming: '#1C2422',
      service: DARK_SERVICE,
      onService: DARK_ON_SERVICE,
    },
  },
  sunsetOrange: {
    light: {
      gradient: ['#FCE6D3', '#FBEEE3', '#F8E4E8'],
      doodle: '#843F0C',
      doodleOpacity: LIGHT_DOODLE_OPACITY,
      outgoing: '#A85312',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('104,52,20'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#1C140E', '#221812', '#221418'],
      doodle: '#F7C993',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#B35A1C',
      onOutgoing: WHITE,
      incoming: '#27211D',
      service: DARK_SERVICE,
      onService: DARK_ON_SERVICE,
    },
  },
  oceanTeal: {
    light: {
      gradient: ['#D7EFF2', '#E4F1F4', '#E4EAF8'],
      doodle: '#0B5864',
      doodleOpacity: LIGHT_DOODLE_OPACITY,
      outgoing: '#0F7180',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('16,70,82'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#0C181B', '#0F1D22', '#101A26'],
      doodle: '#92DCE4',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#147585',
      onOutgoing: WHITE,
      incoming: '#1B2427',
      service: DARK_SERVICE,
      onService: DARK_ON_SERVICE,
    },
  },
  rosePink: {
    light: {
      gradient: ['#F9DDE8', '#FAE8EF', '#EFE4F8'],
      doodle: '#8D214C',
      doodleOpacity: LIGHT_DOODLE_OPACITY,
      outgoing: '#B12D62',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('104,24,60'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#1C0F16', '#22121B', '#1A1226'],
      doodle: '#F5ABC4',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#B8356A',
      onOutgoing: WHITE,
      incoming: '#281E24',
      service: DARK_SERVICE,
      onService: DARK_ON_SERVICE,
    },
  },
};

/**
 * Over a photo the pill cannot know the picture, so it carries its own dark
 * backing: white text keeps 4.5:1 even over a pure white photo.
 */
export const CHAT_PHOTO_SERVICE = Object.freeze({ service: 'rgba(0,0,0,0.55)', onService: WHITE });

/** A failed step's pill on any backdrop: deep red that keeps white text at 4.5:1 over white. */
export const CHAT_SERVICE_BAD = Object.freeze({ service: 'rgba(160,40,40,0.78)', onService: WHITE });

export function resolveChatWallpaperPalette(accentId: AccentColorId | undefined, scheme: ThemeScheme | undefined): ChatWallpaperPalette {
  const id = accentId && isBuiltInAccentId(accentId) ? accentId : defaultAccentId;
  return chatWallpaperPalettes[id][scheme === 'dark' ? 'dark' : 'light'];
}
