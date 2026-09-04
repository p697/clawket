import { StyleSheet, type ViewStyle } from 'react-native';

// ─── Spacing (4px grid) ───
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  /** @deprecated Use `xxl`; 3.0 spacing stops at 32. */
  xxxl: 32,
} as const;

// ─── Typography ───
export const FontSize = {
  display: 28,
  title: 20,
  body: 17,
  secondary: 15,
  caption: 13,
  /** @deprecated Use `caption`. */
  nano: 13,
  /** @deprecated Use `caption`. */
  micro: 13,
  /** @deprecated Use `caption`. */
  xs: 13,
  /** @deprecated Use `caption`. */
  sm: 13,
  /** @deprecated Use `caption`. */
  md: 13,
  /** @deprecated Use `secondary`. */
  bodySm: 15,
  /** @deprecated Use `secondary`. */
  base: 15,
  /** @deprecated Use `body`. */
  lg: 17,
  /** @deprecated Use `body`. */
  xl: 17,
  /** @deprecated Use `title`. */
  displaySm: 20,
  /** @deprecated Use `title`. */
  xxl: 20,
  /** @deprecated Use `title` and size emoji independently. */
  emoji: 20,
  /** @deprecated Use `display`. */
  displayMd: 28,
  /** @deprecated Use `display`. */
  xxxl: 28,
  /** @deprecated Use `display`. */
  displayHero: 28,
  /** @deprecated Use `display`. */
  displayLg: 28,
  /** @deprecated Use `display`. */
  hero: 28,
} as const;

export const LineHeight = {
  display: 34,
  title: 26,
  body: 24,
  secondary: 20,
  caption: 18,
  /** @deprecated Use `caption`. */
  xs: 18,
  /** @deprecated Use `caption`. */
  sm: 18,
  /** @deprecated Use `caption`. */
  md: 18,
  /** @deprecated Use `secondary`. */
  bodySm: 20,
  /** @deprecated Use `secondary`. */
  base: 20,
  /** @deprecated Use `body`. */
  lg: 24,
  /** @deprecated Use `body`. */
  xl: 24,
  /** @deprecated Use `title`. */
  xxl: 26,
  /** @deprecated Use `display`. */
  xxxl: 34,
} as const;

export const FontWeight = {
  regular: '400' as const,
  semibold: '600' as const,
  /** @deprecated Use `semibold`; 3.0 has only 400 and 600. */
  medium: '600' as const,
  /** @deprecated Use `semibold`; 3.0 has only 400 and 600. */
  bold: '600' as const,
};

// ─── Border Radius ───
export const Radius = {
  bubble: 20,
  card: 16,
  settingsGroup: 14,
  avatarRoster: 18,
  avatarHeader: 9,
  avatarSettings: 14,
  avatarSheet: 10,
  xl: 22,
  bottomSheet: 28,
  sheet: 36,
  full: 9999,
  /** @deprecated Transitional alias for legacy square surfaces. */
  none: 0,
  /** @deprecated Use a component-specific 3.0 radius. */
  micro: 2,
  /** @deprecated Use a component-specific 3.0 radius. */
  xs: 4,
  /** @deprecated Use a component-specific 3.0 radius. */
  sm: 8,
  /** @deprecated Use `settingsGroup` where applicable. */
  md: 12,
  /** @deprecated Use `avatarRoster`, `card`, or `bubble`. */
  lg: 18,
} as const;

export const BorderWidth = {
  hairline: StyleSheet.hairlineWidth,
  strong: 2,
  emphasis: 3,
} as const;

// ─── Presentation Colors ───
// Theme-independent colors are reserved for media overlays, exported artwork,
// and data visualization. Ordinary application chrome must use theme.colors.
export const PresentationColor = {
  onMedia: '#FFFFFF',
  mediaScrim: 'rgba(0, 0, 0, 0.2)',
  mediaScrimSoft: 'rgba(0, 0, 0, 0.16)',
  mediaTintSoft: 'rgba(2, 4, 26, 0.04)',
  mediaOverlayStrong: 'rgba(0, 0, 0, 0.6)',
  mediaControl: 'rgba(255, 255, 255, 0.15)',
  mediaControlSoft: 'rgba(255, 255, 255, 0.1)',
  onMediaBorder: 'rgba(255, 255, 255, 0.3)',
  cameraBackground: '#000000',
  skillAvatarFallback: '#5C677D',
  creditCategory: {
    chat: '#C6BC61',
    writing: '#A088AD',
    search: '#6E9AD2',
    image: '#8DAF87',
    audio: '#C89469',
    parsing: '#708090',
    video: '#E85D75',
  },
} as const;

// ─── Icon Sizes ───
export const IconSize = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

// ─── Status Indicators ───
export const StatusSize = {
  dot: 6,
  attention: 12,
} as const;

// ─── Touch Targets ───
export const HitSize = {
  sm: 36,
  md: 44,
  lg: 48,
} as const;

// ─── Control Metrics ───
// Component chrome should consume these metrics rather than creating local
// heights/paddings. Product-specific composites may still own their layout.
export const ControlSize = {
  pill: 40,
  floatingButton: 44,
  settingsRow: 52,
  rosterRow: 88,
  /** @deprecated Use a component-specific 3.0 metric. */
  compact: 36,
  /** @deprecated Use `floatingButton`. */
  standard: 44,
  /** @deprecated Use a component-specific 3.0 metric. */
  large: 48,
  /** @deprecated Use `pill` for canonical pill controls. */
  field: 48,
  /** @deprecated Use a component-specific avatar metric. */
  settingsIcon: 32,
} as const;

// ─── Elevation (shadows) ───
export const Shadow = {
  floating: {
    shadowColor: '#111113',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  xs: {
    shadowColor: '#071218',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#071218',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 7,
    elevation: 2,
  },
  md: {
    shadowColor: '#071218',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 22,
    elevation: 5,
  },
  lg: {
    shadowColor: '#071218',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 10,
  },
} as const;

type ThemedShadowColors = {
  border: string;
  shadow: string;
};

export type SurfaceElevation = 'flat' | 'raised' | 'floating' | 'overlay';

type SurfaceColors = ThemedShadowColors & {
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
};

/**
 * Shared edge and lift treatment for raised Clawket surfaces. Dark surfaces
 * use a quiet hairline instead of a heavy black halo.
 */
export function createThemedShadowStyle(
  colors: ThemedShadowColors,
  scheme: 'light' | 'dark',
  shadow: ViewStyle = Shadow.sm,
): ViewStyle {
  if (scheme === 'dark') {
    return {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOffset: shadow.shadowOffset,
      shadowOpacity: 0,
      shadowRadius: shadow.shadowRadius,
      elevation: 0,
    };
  }
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow,
  };
}

/**
 * The single chrome recipe for ordinary Clawket surfaces.
 *
 * - `flat`: cards and grouped rows; structure comes from the hairline edge.
 * - `raised`: controls such as search, composer chrome, and primary actions.
 * - `floating`: FABs, popovers, and detached toolbars.
 * - `overlay`: modal cards and other top-level overlays.
 *
 * Dark mode deliberately drops shadows and relies on surface contrast plus the
 * shared edge. Changing the semantic border or shadow tokens therefore updates
 * every compliant surface without editing individual components.
 */
export function createSurfaceStyle(
  colors: SurfaceColors,
  scheme: 'light' | 'dark',
  elevation: SurfaceElevation = 'flat',
): ViewStyle {
  const backgroundColor = elevation === 'overlay'
    ? colors.surfaceElevated
    : colors.surface;
  if (elevation === 'flat') {
    return {
      backgroundColor,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    };
  }
  const shadow = elevation === 'raised'
    ? Shadow.sm
    : elevation === 'floating'
      ? Shadow.md
      : Shadow.lg;
  return {
    backgroundColor,
    ...createThemedShadowStyle(colors, scheme, shadow),
  };
}

// ─── Animation Presets ───
/** @deprecated Use the canonical ease-out `Motion` timings. */
export const SpringPreset = {
  /** Snappy UI feedback — buttons, toggles, small movements */
  snappy: { damping: 20, stiffness: 300, mass: 0.8 },
  /** Standard sheet/modal entrance */
  sheet: { damping: 22, stiffness: 220, mass: 0.9 },
  /** Gentle float — tooltips, fade-ins */
  gentle: { damping: 18, stiffness: 160, mass: 1.0 },
} as const;

export const Motion = {
  duration: {
    fast: 120,
    normal: 200,
    slow: 320,
  },
  easing: 'easeOut',
  pressedScale: 0.96,
  messageEnterOffset: 4,
  avatarWorkingLoop: 1_200,
  avatarDoneFade: 3_000,
} as const;

/** @deprecated Use `Motion.duration`. */
export const TimingPreset = Motion.duration;
