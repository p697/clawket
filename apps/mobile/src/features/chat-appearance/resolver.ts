import type { AppTheme } from '../../theme';
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

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseHexColor(value: string): RgbColor | null {
  const normalized = value.replace('#', '').trim();
  const raw = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  if (!/^[\da-fA-F]{6}$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function parseRgbColor(value: string): RgbColor | null {
  const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!match) return null;
  return {
    r: clamp(Number.parseFloat(match[1]), 0, 255),
    g: clamp(Number.parseFloat(match[2]), 0, 255),
    b: clamp(Number.parseFloat(match[3]), 0, 255),
  };
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color) ?? parseRgbColor(color);
  if (!rgb) return color;
  return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${clamp(alpha, 0, 1)})`;
}

export function resolveChatBubbleAppearance(
  theme: AppTheme,
  settings: ChatAppearanceSettings,
): ResolvedChatAppearance {
  const { colors, scheme } = theme;
  const softOpacity = clamp(settings.bubbles.opacity, 0.78, 1);
  const glassUserOpacity = clamp(softOpacity - 0.1, 0.72, 0.9);
  const glassAssistantOpacity = clamp(softOpacity - 0.16, 0.66, 0.84);
  const borderAlpha = scheme === 'dark' ? 0.54 : 0.32;

  switch (settings.bubbles.style) {
    case 'soft':
      return {
        userBubble: {
          backgroundColor: withAlpha(colors.accentSoft, softOpacity),
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
          backgroundColor: withAlpha(colors.accentSoft, glassUserOpacity),
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
          backgroundColor: colors.accentSoft,
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
