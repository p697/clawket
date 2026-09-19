import type { ChatAppearanceSettings, ChatBubbleStyle } from '../../types/chat-appearance';

const DEFAULT_BLUR = 8;
/** Wallpaper dim is a canvas overlay opacity; above this the photo stops being a wallpaper. */
export const MAX_CHAT_BACKGROUND_DIM = 0.6;
const DEFAULT_OPACITY = 1;

export const DEFAULT_CHAT_FONT_SIZE = 17;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeBubbleStyle(value: unknown): ChatBubbleStyle {
  if (value === 'soft' || value === 'glass') return value;
  return 'solid';
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearanceSettings = {
  version: 1,
  background: {
    enabled: false,
    imagePath: undefined,
    blur: DEFAULT_BLUR,
    dim: 0,
    fillMode: 'cover',
  },
  bubbles: {
    style: 'solid',
    opacity: DEFAULT_OPACITY,
  },
};

export function normalizeChatAppearanceSettings(value: unknown): ChatAppearanceSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_CHAT_APPEARANCE;
  }

  const record = value as Record<string, unknown>;
  const background = record.background && typeof record.background === 'object'
    ? record.background as Record<string, unknown>
    : {};
  const bubbles = record.bubbles && typeof record.bubbles === 'object'
    ? record.bubbles as Record<string, unknown>
    : {};
  const imagePathRaw = typeof background.imagePath === 'string' ? background.imagePath.trim() : '';
  const enabled = background.enabled === true && imagePathRaw.length > 0;

  return {
    version: 1,
    background: {
      enabled,
      imagePath: imagePathRaw || undefined,
      blur: clamp(
        typeof background.blur === 'number' ? background.blur : DEFAULT_BLUR,
        0,
        24,
      ),
      dim: clamp(
        typeof background.dim === 'number' ? background.dim : 0,
        0,
        MAX_CHAT_BACKGROUND_DIM,
      ),
      fillMode: 'cover',
    },
    bubbles: {
      style: normalizeBubbleStyle(bubbles.style),
      opacity: clamp(
        typeof bubbles.opacity === 'number' ? bubbles.opacity : DEFAULT_OPACITY,
        0.78,
        1,
      ),
    },
  };
}

export function buildChatAppearanceSignature(settings: ChatAppearanceSettings): string {
  return [
    settings.background.enabled ? '1' : '0',
    settings.background.imagePath ?? '',
    settings.background.blur,
    settings.background.dim,
    settings.bubbles.style,
    settings.bubbles.opacity,
  ].join(':');
}
