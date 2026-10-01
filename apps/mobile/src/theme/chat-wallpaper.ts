import type { AccentColorId } from '../types';
import { defaultAccentId, isBuiltInAccentId } from './accents';
import { mixColors } from './color';
import type { ThemeScheme } from './theme';

/**
 * The conversation's own colors for one accent and scheme (owner-approved
 * A+ chat design, 2026-09-30). The built-in wallpaper is a 165° gradient of
 * three same-family stops under faint Clawket doodles; the user's own bubble
 * is a solid accent-family color with white text, halfway in perceived
 * lightness and chroma between the accent (a deeper step in dark) and the
 * lighter canvas option B (owner choice 2026-10-01: the accent read too deep,
 * B too light); the Agent's bubble is white (a tinted charcoal in dark);
 * centred service pills are a deep accent-family tint.
 *
 * Every value is checked by `features/chat-appearance/resolver.test.ts`:
 * white text stays at least 4.3:1 on the outgoing bubble (17-point message
 * text) and 4.5:1 on a service pill over every gradient stop.
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
      outgoing: '#246DFD',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('36,52,104'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#0F1526', '#111A33', '#1A1530'],
      doodle: '#9DB4FF',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#2960DF',
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
      outgoing: '#744CCC',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('62,36,104'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#151028', '#1A1330', '#22122C'],
      doodle: '#CBB9FF',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#704DD1',
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
      outgoing: '#238363',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('20,72,56'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#0D1A16', '#10201B', '#17201A'],
      doodle: '#91DEC3',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#298163',
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
      outgoing: '#B15C1F',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('104,52,20'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#1C140E', '#221812', '#221418'],
      doodle: '#F7C993',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#BB6126',
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
      outgoing: '#1E7989',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('16,70,82'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#0C181B', '#0F1D22', '#101A26'],
      doodle: '#92DCE4',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#207C8C',
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
      outgoing: '#BB376A',
      onOutgoing: WHITE,
      incoming: WHITE,
      service: lightService('104,24,60'),
      onService: WHITE,
    },
    dark: {
      gradient: ['#1C0F16', '#22121B', '#1A1226'],
      doodle: '#F5ABC4',
      doodleOpacity: DARK_DOODLE_OPACITY,
      outgoing: '#C03D71',
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

/**
 * The built-in wallpaper drifts on each send (A+ motion prototype PMotion,
 * owner-approved 2026-09-30): its gradient is drawn three times the screen in
 * each direction and each send moves the visible window to the next of these
 * CSS background positions. The first window is the resting wallpaper.
 */
export const CHAT_WALLPAPER_DRIFT_POSITIONS: ReadonlyArray<readonly [x: number, y: number]> = [
  [0, 0], [0.45, 0.35], [1, 0.7], [0.6, 1],
];
/** The drifting gradient's size relative to the screen in each direction. */
export const CHAT_WALLPAPER_DRIFT_SCALE = 3;
const DRIFT_ANGLE_DEG = 165;
/** The resting window covers this share of the drifting gradient's line. */
const RESTING_WINDOW = 1 / 3;

type DriftStop = readonly [color: string, offset: number];

/**
 * Stops along the drifting gradient. The resting window keeps the palette's
 * three stops where the static wallpaper had them (the middle one 45 % of the
 * way across), so an untouched conversation looks as before; the rest of the
 * line returns through softer blends to the first color, so a full cycle of
 * sends ends where it began.
 */
export function chatWallpaperDriftStops(palette: ChatWallpaperPalette): readonly DriftStop[] {
  const [top, middle, bottom] = palette.gradient;
  return [
    [top, 0],
    [middle, RESTING_WINDOW * 0.45],
    [bottom, RESTING_WINDOW],
    [middle, 0.55],
    [mixColors(top, bottom, 0.5), 0.75],
    [top, 1],
  ];
}

/** The drifting gradient as a CSS background image for the enlarged layer. */
export function chatWallpaperDriftGradient(palette: ChatWallpaperPalette): string {
  const stops = chatWallpaperDriftStops(palette).map(([color, offset]) => `${color} ${(offset * 100).toFixed(2)}%`);
  return `linear-gradient(${DRIFT_ANGLE_DEG}deg, ${stops.join(', ')})`;
}

/** The drift position shown after `sends` sends. */
export function chatWallpaperDriftPosition(sends: number): readonly [x: number, y: number] {
  const count = CHAT_WALLPAPER_DRIFT_POSITIONS.length;
  const index = Number.isFinite(sends) ? ((Math.trunc(sends) % count) + count) % count : 0;
  return CHAT_WALLPAPER_DRIFT_POSITIONS[index]!;
}

/**
 * The drifting wallpaper's color at a point of the screen, given as fractions
 * of its width and height, for a drift position and the screen's height to
 * width ratio. It follows CSS linear-gradient geometry on the enlarged layer,
 * so the scrims can fade from the colors actually behind them.
 */
export function sampleChatWallpaperDrift(
  palette: ChatWallpaperPalette,
  position: readonly [x: number, y: number],
  point: readonly [x: number, y: number],
  aspect: number,
): string {
  const scale = CHAT_WALLPAPER_DRIFT_SCALE;
  const height = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const px = position[0] * (scale - 1) + point[0];
  const py = (position[1] * (scale - 1) + point[1]) * height;
  const angle = (DRIFT_ANGLE_DEG * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const length = Math.abs(scale * dx) + Math.abs(scale * height * dy);
  const t = Math.min(1, Math.max(0, ((px - scale / 2) * dx + (py - (scale * height) / 2) * dy) / length + 0.5));
  const stops = chatWallpaperDriftStops(palette);
  for (let index = 1; index < stops.length; index += 1) {
    const [color, offset] = stops[index]!;
    const [previousColor, previousOffset] = stops[index - 1]!;
    if (t <= offset) return mixColors(previousColor, color, offset > previousOffset ? (t - previousOffset) / (offset - previousOffset) : 1);
  }
  return stops[stops.length - 1]![0];
}

/** What the scrims fade from at a drift position: the colors at the screen's top and bottom. */
export function chatWallpaperDriftScrims(
  palette: ChatWallpaperPalette,
  position: readonly [x: number, y: number],
  aspect: number,
): { top: string; bottom: string } {
  return {
    top: sampleChatWallpaperDrift(palette, position, [0.5, 0.04], aspect),
    bottom: sampleChatWallpaperDrift(palette, position, [0.5, 0.96], aspect),
  };
}
