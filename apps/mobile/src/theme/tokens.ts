import { StyleSheet, type ViewStyle } from 'react-native';

// ─── Spacing (4px grid) ───
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// ─── Typography ───
export const FontSize = {
  nano: 9,
  micro: 10,
  xs: 11,
  sm: 12,
  md: 13,
  bodySm: 14,
  base: 15,
  lg: 16,
  xl: 18,
  displaySm: 20,
  xxl: 22,
  emoji: 24,
  displayMd: 26,
  xxxl: 28,
  displayHero: 32,
  displayLg: 36,
  hero: 48,
} as const;

export const LineHeight = {
  xs: 14,
  sm: 16,
  md: 18,
  bodySm: 20,
  base: 21,
  lg: 22,
  xl: 24,
  xxl: 28,
  xxxl: 34,
} as const;

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// ─── Border Radius ───
export const Radius = {
  none: 0,
  micro: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  full: 9999,
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
  compact: 36,
  standard: 44,
  large: 48,
  field: 48,
  settingsRow: 56,
  settingsIcon: 32,
} as const;

// ─── Elevation (shadows) ───
export const Shadow = {
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
export const SpringPreset = {
  /** Snappy UI feedback — buttons, toggles, small movements */
  snappy: { damping: 20, stiffness: 300, mass: 0.8 },
  /** Standard sheet/modal entrance */
  sheet: { damping: 22, stiffness: 220, mass: 0.9 },
  /** Gentle float — tooltips, fade-ins */
  gentle: { damping: 18, stiffness: 160, mass: 1.0 },
} as const;

export const TimingPreset = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;
