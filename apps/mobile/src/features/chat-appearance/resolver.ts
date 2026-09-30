import { StyleSheet, type ViewStyle } from 'react-native';
import type { AppTheme } from '../../theme';
import { Shadow } from '../../theme/tokens';
import { blendOntoBacking, withAlpha } from '../../theme/color';
import {
  CHAT_PHOTO_SERVICE,
  CHAT_SERVICE_BAD,
  resolveChatWallpaperPalette,
  type ChatWallpaperPalette,
} from '../../theme/chat-wallpaper';
import type { AccentColorId } from '../../types';
import type { ChatAppearanceSettings, ChatWallpaperKind } from '../../types/chat-appearance';

export type ResolvedChatBubbleAppearance = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  shadow: boolean;
};

/** One speaker's bubble: its material plus what is drawn on it. */
export type ChatBubbleSurface = ResolvedChatBubbleAppearance & {
  /** Message text. */
  textColor: string;
  /** Clock and delivery glyphs inside the bubble. */
  metaColor: string;
  /**
   * Whether the last bubble of a group grows a tail. Only unoutlined
   * materials do: an outline cannot follow the tail's curve.
   */
  tail: boolean;
};

export type ResolvedChatAppearance = {
  userBubble: ChatBubbleSurface;
  assistantBubble: ChatBubbleSurface;
};

/** Centred pills over the conversation: dates, system notices, tool activity. */
export type ChatServiceSurface = {
  backgroundColor: string;
  textColor: string;
  /** Quieter text inside a pill, such as a running step's elapsed time. */
  secondaryTextColor: string;
  /** A failed step's pill; its text stays `badTextColor`. */
  badBackgroundColor: string;
  badTextColor: string;
};

/**
 * Everything the conversation paints, resolved once from the saved
 * appearance, the conversation accent and the scheme (A+ chat design,
 * owner decision 2026-09-30).
 */
export type ChatSurfaces = {
  /** What is actually drawn behind the conversation. */
  wallpaper: ChatWallpaperKind;
  palette: ChatWallpaperPalette;
  /** The Agent's (and other participants') bubbles. */
  incoming: ChatBubbleSurface;
  /** The user's own bubbles. */
  outgoing: ChatBubbleSurface;
  /** Cards that sit among the bubbles: scheduled runs, approvals, artifacts. */
  card: string;
  /** An inset inside a card or bubble (a command, a file glyph): it must read against `card`. */
  well: string;
  service: ChatServiceSurface;
  /** Colors the header and composer scrims fade from, so they melt into the wallpaper. */
  scrim: { top: string; bottom: string };
};

export type ResolvedChatMetaAppearance = {
  backgroundColor: string;
  borderColor: string;
  shadow: boolean;
};

/**
 * Translucent chrome for controls that float over a wallpaper: the Thread
 * header buttons and pill, the compact composer card and time labels.
 */
export type ResolvedChatChromeAppearance = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  shadow: boolean;
};

/** Incoming meta sits between secondary and tertiary ink: present, never competing with the text. */
const INCOMING_META_ALPHA = 0.8;
/** Time and ticks on the user's solid bubble: the bubble's own white, softened. */
const OUTGOING_META_ALPHA = 0.78;
/** A running step's elapsed time inside a pill. */
const SERVICE_SECONDARY_ALPHA = 0.72;

/**
 * What is drawn behind the conversation. A photo choice without an image to
 * draw falls back to the built-in wallpaper, as saved settings do.
 */
export function resolveChatWallpaperKind(settings: ChatAppearanceSettings, imageUri?: string | null): ChatWallpaperKind {
  const { kind } = settings.background;
  if (kind === 'plain') return 'plain';
  if (kind === 'photo') return imageUri ?? settings.background.imagePath ? 'photo' : 'pattern';
  return 'pattern';
}

/** Something is drawn behind the conversation; everything immersive keys off this. */
export function isChatWallpaperActive(settings: ChatAppearanceSettings, imageUri?: string | null): boolean {
  return resolveChatWallpaperKind(settings, imageUri) !== 'plain';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function resolveChatSurfaces(
  theme: Pick<AppTheme, 'colors' | 'scheme'>,
  settings: ChatAppearanceSettings,
  accentId?: AccentColorId,
  imageUri?: string | null,
): ChatSurfaces {
  const { colors, scheme } = theme;
  const palette = resolveChatWallpaperPalette(accentId, scheme);
  const wallpaper = resolveChatWallpaperKind(settings, imageUri);
  const onWallpaper = wallpaper !== 'plain';
  const photo = wallpaper === 'photo';
  // Over a wallpaper the Agent speaks on white (a tinted charcoal in dark);
  // on the plain canvas the neutral surface keeps the bubble visible.
  const incomingBase = onWallpaper ? palette.incoming : colors.surface;
  const softOpacity = clamp(settings.bubbles.opacity, 0.78, 1);
  const glassOpacity = clamp(softOpacity - 0.16, 0.66, 0.84);
  const incomingText = { textColor: colors.ink, metaColor: withAlpha(colors.inkSecondary, INCOMING_META_ALPHA) };
  let incoming: ChatBubbleSurface;
  switch (settings.bubbles.style) {
    case 'soft':
      incoming = {
        ...incomingText,
        backgroundColor: withAlpha(incomingBase, clamp(softOpacity - 0.04, 0.82, 0.96)),
        // Only an unknown photo needs the edge spelled out.
        borderColor: withAlpha(colors.line, photo ? 0.22 : 0),
        borderWidth: photo ? 1 : 0,
        shadow: false,
        tail: !photo,
      };
      break;
    case 'glass':
      incoming = {
        ...incomingText,
        backgroundColor: withAlpha(onWallpaper ? palette.incoming : colors.surfaceFloating, glassOpacity),
        borderColor: withAlpha(colors.line, scheme === 'dark' ? 0.54 : 0.32),
        borderWidth: 1,
        shadow: true,
        tail: false,
      };
      break;
    case 'solid':
    default:
      incoming = { ...incomingText, backgroundColor: incomingBase, borderColor: 'transparent', borderWidth: 0, shadow: false, tail: true };
  }
  // The user's own words are always the solid accent with white text: a
  // translucent accent would lose the text contrast over a photo.
  const outgoing: ChatBubbleSurface = {
    backgroundColor: palette.outgoing,
    borderColor: 'transparent',
    borderWidth: 0,
    shadow: settings.bubbles.style === 'glass',
    textColor: palette.onOutgoing,
    metaColor: withAlpha(palette.onOutgoing, OUTGOING_META_ALPHA),
    tail: true,
  };
  const service: ChatServiceSurface = wallpaper === 'pattern'
    ? {
      backgroundColor: palette.service,
      textColor: palette.onService,
      secondaryTextColor: withAlpha(palette.onService, SERVICE_SECONDARY_ALPHA),
      badBackgroundColor: CHAT_SERVICE_BAD.service,
      badTextColor: CHAT_SERVICE_BAD.onService,
    }
    : photo
      ? {
        backgroundColor: CHAT_PHOTO_SERVICE.service,
        textColor: CHAT_PHOTO_SERVICE.onService,
        secondaryTextColor: withAlpha(CHAT_PHOTO_SERVICE.onService, SERVICE_SECONDARY_ALPHA),
        badBackgroundColor: CHAT_SERVICE_BAD.service,
        badTextColor: CHAT_SERVICE_BAD.onService,
      }
      : {
        backgroundColor: colors.surface,
        textColor: colors.inkSecondary,
        secondaryTextColor: colors.inkTertiary,
        badBackgroundColor: CHAT_SERVICE_BAD.service,
        badTextColor: CHAT_SERVICE_BAD.onService,
      };
  return {
    wallpaper,
    palette,
    incoming,
    outgoing,
    card: onWallpaper ? palette.incoming : colors.surface,
    well: !onWallpaper || scheme === 'dark' ? colors.canvas : colors.surface,
    service,
    scrim: wallpaper === 'pattern'
      ? { top: palette.gradient[0], bottom: palette.gradient[2] }
      : { top: colors.canvas, bottom: colors.canvas },
  };
}

/** The Agent's presence colors around the header avatar (A+ chat design). */
export type ChatPresenceColors = {
  /** The turning arc and the status sentence while the Agent works. */
  working: string;
  /** The breathing ring while the Agent waits for you. */
  attentionRing: string;
  /** The "Waiting for your approval" sentence: amber that still reads as text on light glass. */
  attentionText: string;
};

/** Light glass is near white; the attention amber darkens toward ink until it reads as text (≥ 4.5:1). */
const LIGHT_ATTENTION_TEXT_WEIGHT = 0.75;

export function resolveChatPresenceColors(theme: Pick<AppTheme, 'colors' | 'scheme'>): ChatPresenceColors {
  const { colors, scheme } = theme;
  return {
    working: colors.accent,
    attentionRing: colors.warn,
    attentionText: scheme === 'dark'
      ? colors.warn
      : blendOntoBacking(withAlpha(colors.warn, LIGHT_ATTENTION_TEXT_WEIGHT), colors.ink),
  };
}

/** Both speakers' bubbles; kept for the legacy message bubble. */
export function resolveChatBubbleAppearance(
  theme: Pick<AppTheme, 'colors' | 'scheme'>,
  settings: ChatAppearanceSettings,
  accentId?: AccentColorId,
): ResolvedChatAppearance {
  const surfaces = resolveChatSurfaces(theme, settings, accentId);
  return { userBubble: surfaces.outgoing, assistantBubble: surfaces.incoming };
}

export function resolveChatMetaAppearance(theme: AppTheme): ResolvedChatMetaAppearance {
  const { colors, scheme } = theme;

  return {
    backgroundColor: withAlpha(
      scheme === 'dark' ? colors.surfaceFloating : colors.surface,
      scheme === 'dark' ? 0.72 : 0.82,
    ),
    borderColor: withAlpha(
      scheme === 'dark' ? colors.line : colors.line,
      scheme === 'dark' ? 0.42 : 0.58,
    ),
    shadow: scheme === 'light',
  };
}

/**
 * Glass over a photo: the floating surface at a bounded opacity with a soft
 * hairline, so the wallpaper reads through without losing the control edge.
 * Light mode keeps the floating shadow; dark mode relies on the hairline, as
 * every other lifted surface does.
 */
export function resolveChatChromeAppearance(theme: Pick<AppTheme, 'colors' | 'scheme'>): ResolvedChatChromeAppearance {
  const { colors, scheme } = theme;
  return {
    backgroundColor: withAlpha(colors.surfaceFloating, scheme === 'dark' ? 0.74 : 0.8),
    borderColor: withAlpha(colors.line, scheme === 'dark' ? 0.64 : 0.5),
    borderWidth: StyleSheet.hairlineWidth,
    shadow: scheme === 'light',
  };
}

/** The glass recipe as one view style, shared by every control that floats over the wallpaper. */
export function createChatGlassStyle(theme: Pick<AppTheme, 'colors' | 'scheme'>): ViewStyle {
  const glass = resolveChatChromeAppearance(theme);
  return {
    backgroundColor: glass.backgroundColor,
    borderWidth: glass.borderWidth,
    borderColor: glass.borderColor,
    ...(glass.shadow ? Shadow.floating : { elevation: 0, shadowOpacity: 0 }),
  };
}
