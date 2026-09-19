import { StyleSheet, type ViewStyle } from 'react-native';
import type { AppTheme } from '../../theme';
import { Shadow } from '../../theme/tokens';
import { blendOntoBacking, withAlpha } from '../../theme/color';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';

export type ResolvedChatBubbleAppearance = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  shadow: boolean;
};

export type ResolvedChatAppearance = {
  userBubble: ResolvedChatBubbleAppearance;
  assistantBubble: ResolvedChatBubbleAppearance;
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

/** The wallpaper is on and has an image to draw; everything immersive keys off this. */
export function isChatWallpaperActive(settings: ChatAppearanceSettings, imageUri?: string | null): boolean {
  return settings.background.enabled && Boolean(imageUri ?? settings.background.imagePath);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Resolve the tint onto a stable canvas before applying material opacity.
 * Replacing accentSoft's alpha turns a 10% tint into a saturated fill.
 * A stable backing also protects text when a wallpaper is enabled.
 */
function resolveTintSurface(tint: string, canvas: string): string {
  return blendOntoBacking(tint, canvas);
}

export function resolveChatBubbleAppearance(
  theme: AppTheme,
  settings: ChatAppearanceSettings,
): ResolvedChatAppearance {
  const { colors, scheme } = theme;
  const userSurface = resolveTintSurface(colors.accentSoft, colors.canvas);
  const softOpacity = clamp(settings.bubbles.opacity, 0.78, 1);
  const glassUserOpacity = clamp(softOpacity - 0.1, 0.72, 0.9);
  const glassAssistantOpacity = clamp(softOpacity - 0.16, 0.66, 0.84);
  const borderAlpha = scheme === 'dark' ? 0.54 : 0.32;

  switch (settings.bubbles.style) {
    case 'soft':
      return {
        userBubble: {
          backgroundColor: withAlpha(userSurface, softOpacity),
          borderColor: withAlpha(colors.accent, settings.background.enabled ? 0.16 : 0),
          borderWidth: settings.background.enabled ? 1 : 0,
          shadow: false,
        },
        assistantBubble: {
          backgroundColor: withAlpha(colors.surface, clamp(softOpacity - 0.04, 0.82, 0.96)),
          borderColor: withAlpha(colors.line, settings.background.enabled ? 0.22 : 0),
          borderWidth: settings.background.enabled ? 1 : 0,
          shadow: false,
        },
      };
    case 'glass':
      return {
        userBubble: {
          backgroundColor: withAlpha(userSurface, glassUserOpacity),
          borderColor: withAlpha(colors.accent, scheme === 'dark' ? 0.42 : 0.26),
          borderWidth: 1,
          shadow: true,
        },
        assistantBubble: {
          backgroundColor: withAlpha(colors.surfaceFloating, glassAssistantOpacity),
          borderColor: withAlpha(colors.line, borderAlpha),
          borderWidth: 1,
          shadow: true,
        },
      };
    case 'solid':
    default:
      return {
        userBubble: {
          backgroundColor: userSurface,
          borderColor: 'transparent',
          borderWidth: 0,
          shadow: false,
        },
        assistantBubble: {
          backgroundColor: colors.surface,
          borderColor: 'transparent',
          borderWidth: 0,
          shadow: false,
        },
      };
  }
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
