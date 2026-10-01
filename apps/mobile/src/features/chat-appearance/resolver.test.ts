import { Platform, StyleSheet } from 'react-native';
import { buildTheme } from '../../theme/theme';
import { builtInAccents, defaultAccentId } from '../../theme/accents';
import { chatWallpaperPalettes, CHAT_PHOTO_SERVICE, CHAT_SERVICE_BAD } from '../../theme/chat-wallpaper';
import { Shadow } from '../../theme/tokens';
import type { ChatAppearanceSettings, ChatWallpaperKind } from '../../types/chat-appearance';
import { DEFAULT_CHAT_APPEARANCE, normalizeChatAppearanceSettings } from './defaults';
import {
  createChatGlassStyle,
  isChatWallpaperActive,
  resolveChatBubbleAppearance,
  resolveChatChromeAppearance,
  resolveChatPresenceColors,
  resolveChatSurfaces,
  resolveChatWallpaperKind,
} from './resolver';

type AccentId = keyof typeof builtInAccents;
const ACCENTS = Object.keys(builtInAccents) as AccentId[];
const PHOTO = 'file:///wallpaper.jpg';

function channels(color: string): number[] {
  if (/^#[\da-f]{6}$/i.test(color)) return color.slice(1).match(/../g)!.map((part) => parseInt(part, 16));
  const match = color.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error(`Unsupported test color: ${color}`);
  const values = match[1].split(',').map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values.length < 3) throw new Error('Invalid color');
  return values;
}
function luminance(rgb: number[]): number {
  const linear = rgb.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
/** Composites `front` over an opaque `backdrop` and returns the contrast of `text` on the result. */
function contrastOn(text: string, front: string, backdrop: string): number {
  const [r, g, b, alpha = 1] = channels(front);
  const behind = channels(backdrop);
  const surface = [r, g, b].map((value, index) => value * alpha + behind[index]! * (1 - alpha));
  const fg = luminance(channels(text).slice(0, 3));
  const bg = luminance(surface);
  return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
}
function appearance(kind: ChatWallpaperKind, patch: Partial<ChatAppearanceSettings['bubbles']> = {}): ChatAppearanceSettings {
  return {
    ...DEFAULT_CHAT_APPEARANCE,
    background: { ...DEFAULT_CHAT_APPEARANCE.background, kind, enabled: kind === 'photo', imagePath: kind === 'photo' ? PHOTO : undefined },
    bubbles: { ...DEFAULT_CHAT_APPEARANCE.bubbles, ...patch },
  };
}
/** Every opaque color the pill or bubble could sit on for this wallpaper. */
function backdrops(kind: ChatWallpaperKind, accentId: AccentId, scheme: 'light' | 'dark'): string[] {
  const canvas = buildTheme(scheme, scheme, builtInAccents[accentId]).colors.canvas;
  if (kind === 'pattern') return [...chatWallpaperPalettes[accentId][scheme].gradient];
  if (kind === 'photo') return ['#000000', '#FFFFFF', canvas];
  return [canvas];
}

describe('wallpaper kind', () => {
  it('defaults to the built-in pattern and treats it as immersive', () => {
    expect(DEFAULT_CHAT_APPEARANCE.background.kind).toBe('pattern');
    expect(resolveChatWallpaperKind(DEFAULT_CHAT_APPEARANCE)).toBe('pattern');
    expect(isChatWallpaperActive(DEFAULT_CHAT_APPEARANCE)).toBe(true);
  });

  it('draws a photo only when there is an image, and nothing on the plain canvas', () => {
    const photo = appearance('photo');
    expect(resolveChatWallpaperKind(photo)).toBe('photo');
    const photoWithoutImage = { ...photo, background: { ...photo.background, imagePath: undefined } };
    expect(resolveChatWallpaperKind(photoWithoutImage)).toBe('pattern');
    expect(resolveChatWallpaperKind(photoWithoutImage, 'file:///picked.jpg')).toBe('photo');
    expect(resolveChatWallpaperKind(appearance('plain'))).toBe('plain');
    expect(isChatWallpaperActive(appearance('plain'))).toBe(false);
  });

  it('migrates settings saved before the wallpaper kind existed', () => {
    const legacy = { version: 1, background: { enabled: true, imagePath: PHOTO, blur: 8, dim: 0 }, bubbles: { style: 'soft', opacity: 1 } };
    expect(normalizeChatAppearanceSettings(legacy).background).toMatchObject({ kind: 'photo', enabled: true, imagePath: PHOTO });
    const legacyWithoutPhoto = { ...legacy, background: { enabled: false, blur: 8, dim: 0 } };
    expect(normalizeChatAppearanceSettings(legacyWithoutPhoto).background).toMatchObject({ kind: 'pattern', enabled: false });
    expect(normalizeChatAppearanceSettings({ ...legacy, background: { kind: 'plain', enabled: true, imagePath: PHOTO } }).background)
      .toMatchObject({ kind: 'plain', enabled: false });
    expect(normalizeChatAppearanceSettings({ ...legacy, background: { kind: 'neon' } }).background.kind).toBe('pattern');
  });
});

describe('resolveChatSurfaces', () => {
  it('keeps default bubbles solid and unoutlined, with tails on both sides', () => {
    const theme = buildTheme('light', 'light', builtInAccents[defaultAccentId]);
    const surfaces = resolveChatSurfaces(theme, DEFAULT_CHAT_APPEARANCE, defaultAccentId);
    const palette = chatWallpaperPalettes.iceBlue.light;
    expect(surfaces.wallpaper).toBe('pattern');
    expect(surfaces.outgoing).toMatchObject({ backgroundColor: palette.outgoing, textColor: palette.onOutgoing, borderWidth: 0, tail: true });
    expect(surfaces.incoming).toMatchObject({ backgroundColor: palette.incoming, textColor: theme.colors.ink, borderWidth: 0, tail: true });
    expect(surfaces.card).toBe(palette.incoming);
    expect(surfaces.scrim).toEqual({ top: palette.gradient[0], bottom: palette.gradient[2] });
  });

  it('keeps the neutral surface for bubbles, cards and pills on the plain canvas', () => {
    const theme = buildTheme('light', 'light', builtInAccents.jadeGreen);
    const surfaces = resolveChatSurfaces(theme, appearance('plain'), 'jadeGreen');
    expect(surfaces.incoming.backgroundColor).toBe(theme.colors.surface);
    expect(surfaces.card).toBe(theme.colors.surface);
    expect(surfaces.service).toMatchObject({ backgroundColor: theme.colors.surface, textColor: theme.colors.inkSecondary });
    expect(surfaces.scrim).toEqual({ top: theme.colors.canvas, bottom: theme.colors.canvas });
    // The user's own bubble stays the solid accent everywhere.
    expect(surfaces.outgoing.backgroundColor).toBe(chatWallpaperPalettes.jadeGreen.light.outgoing);
  });

  it('outlines translucent bubbles over a photo, drops their tails, and keeps the user bubble solid', () => {
    const theme = buildTheme('dark', 'dark', builtInAccents[defaultAccentId]);
    const glass = resolveChatSurfaces(theme, appearance('photo', { style: 'glass', opacity: 0.9 }), defaultAccentId);
    expect(glass.incoming).toMatchObject({ borderWidth: 1, shadow: true, tail: false });
    expect(glass.incoming.backgroundColor).toContain('rgba(');
    expect(glass.outgoing).toMatchObject({ backgroundColor: chatWallpaperPalettes.iceBlue.dark.outgoing, borderWidth: 0, tail: true });
    expect(glass.service.backgroundColor).toBe(CHAT_PHOTO_SERVICE.service);
    const soft = resolveChatSurfaces(theme, appearance('pattern', { style: 'soft', opacity: 0.9 }), defaultAccentId);
    expect(soft.incoming).toMatchObject({ borderWidth: 0, tail: true });
    expect(resolveChatSurfaces(theme, appearance('photo', { style: 'soft' }), defaultAccentId).incoming).toMatchObject({ borderWidth: 1, tail: false });
  });

  it('keeps the legacy bubble pair on the same surfaces', () => {
    const theme = buildTheme('light', 'light', builtInAccents.rosePink);
    const legacy = resolveChatBubbleAppearance(theme, DEFAULT_CHAT_APPEARANCE, 'rosePink');
    const surfaces = resolveChatSurfaces(theme, DEFAULT_CHAT_APPEARANCE, 'rosePink');
    expect(legacy).toEqual({ userBubble: surfaces.outgoing, assistantBubble: surfaces.incoming });
  });
});

it.each(ACCENTS)('keeps %s message text readable across materials, schemes and wallpapers', (accentId) => {
  let checked = 0;
  for (const scheme of ['light', 'dark'] as const) {
    const theme = buildTheme(scheme, scheme, builtInAccents[accentId]);
    for (const kind of ['pattern', 'photo', 'plain'] as const) {
      for (const style of ['solid', 'soft', 'glass'] as const) {
        for (const opacity of [0.78, 0.9, 1]) {
          const surfaces = resolveChatSurfaces(theme, appearance(kind, { style, opacity }), accentId);
          for (const bubble of [surfaces.outgoing, surfaces.incoming]) {
            for (const backdrop of backdrops(kind, accentId, scheme)) {
              expect(contrastOn(bubble.textColor, bubble.backgroundColor, backdrop)).toBeGreaterThanOrEqual(4.5);
              checked += 1;
            }
          }
        }
      }
    }
  }
  expect(checked).toBe(2 * 3 * 3 * 2 * (3 + 3 + 1));
});

it.each(ACCENTS)('keeps %s service pill text readable over every wallpaper', (accentId) => {
  for (const scheme of ['light', 'dark'] as const) {
    const theme = buildTheme(scheme, scheme, builtInAccents[accentId]);
    for (const kind of ['pattern', 'photo', 'plain'] as const) {
      const { service } = resolveChatSurfaces(theme, appearance(kind), accentId);
      for (const backdrop of backdrops(kind, accentId, scheme)) {
        expect(contrastOn(service.textColor, service.backgroundColor, backdrop)).toBeGreaterThanOrEqual(4.5);
        expect(contrastOn(service.badTextColor, service.badBackgroundColor, backdrop)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  expect(CHAT_SERVICE_BAD.onService).toBe('#FFFFFF');
});

describe('immersive wallpaper chrome', () => {
  it.each(['light', 'dark'] as const)('floats %s chrome on translucent surface with a hairline', (scheme) => {
    const theme = buildTheme(scheme, scheme, builtInAccents[defaultAccentId]);
    const chrome = resolveChatChromeAppearance(theme);
    const [, , , alpha] = channels(chrome.backgroundColor);
    expect(alpha).toBeGreaterThanOrEqual(0.7);
    expect(alpha).toBeLessThan(1);
    expect(channels(chrome.backgroundColor).slice(0, 3)).toEqual(channels(theme.colors.surfaceFloating).slice(0, 3));
    expect(chrome.borderWidth).toBe(StyleSheet.hairlineWidth);
    expect(chrome.borderColor).toContain('rgba(');
    // Dark glass on a dark wallpaper keeps a faint light rim (owner report 2026-10-01).
    expect(channels(chrome.borderColor).slice(0, 3))
      .toEqual(channels(scheme === 'dark' ? theme.colors.ink : theme.colors.line).slice(0, 3));
    expect(chrome.shadow).toBe(scheme === 'light');
    const style = createChatGlassStyle(theme);
    expect(style).toMatchObject({ backgroundColor: chrome.backgroundColor, borderColor: chrome.borderColor });
    if (scheme === 'light') expect(style).toMatchObject(Shadow.floating);
    else expect(style).toMatchObject({ elevation: 0, shadowOpacity: 0 });
  });

  it('draws the Android glass shadow outside the see-through fill only', () => {
    // Android draws `elevation` beneath the whole outline; under the 80% fill it
    // showed as a grey cast or a pale octagon (owner report 2026-10-01).
    const replaced = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const light = createChatGlassStyle(buildTheme('light', 'light', builtInAccents[defaultAccentId]));
      expect(light).toMatchObject(Shadow.floatingOutside);
      expect(light).toMatchObject({ elevation: 0, shadowOpacity: 0 });
      expect(String(light.boxShadow)).toMatch(/^0px 2px 8px 0px rgba\(/);
      const dark = createChatGlassStyle(buildTheme('dark', 'dark', builtInAccents[defaultAccentId]));
      expect(dark).toMatchObject({ elevation: 0, shadowOpacity: 0 });
      expect(dark.boxShadow).toBeUndefined();
    } finally {
      replaced.restore();
    }
  });

  it('keeps ink readable on glass chrome over black and white wallpapers and every built-in gradient', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const accentId of ACCENTS) {
        const theme = buildTheme(scheme, scheme, builtInAccents[accentId]);
        const chrome = resolveChatChromeAppearance(theme).backgroundColor;
        for (const backdrop of ['#000000', '#FFFFFF', theme.colors.canvas, ...chatWallpaperPalettes[accentId][scheme].gradient]) {
          expect(contrastOn(theme.colors.ink, chrome, backdrop)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('presence colors', () => {
  it.each(['light', 'dark'] as const)('keeps the %s status sentence readable on the header glass', (scheme) => {
    for (const accentId of ACCENTS) {
      const theme = buildTheme(scheme, scheme, builtInAccents[accentId]);
      const presence = resolveChatPresenceColors(theme);
      const glass = resolveChatChromeAppearance(theme).backgroundColor;
      expect(presence.working).toBe(theme.colors.accent);
      expect(presence.attentionRing).toBe(theme.colors.warn);
      for (const backdrop of chatWallpaperPalettes[accentId][scheme].gradient) {
        expect(contrastOn(presence.attentionText, glass, backdrop)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives insets a color that reads against the card they sit in', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);
      const pattern = resolveChatSurfaces(theme, appearance('pattern'), 'iceBlue');
      expect(pattern.well).not.toBe(pattern.card);
      expect(pattern.well).toBe(scheme === 'dark' ? theme.colors.canvas : theme.colors.surface);
      const plain = resolveChatSurfaces(theme, appearance('plain'), 'iceBlue');
      expect(plain.card).toBe(theme.colors.surface);
      expect(plain.well).toBe(theme.colors.canvas);
    }
  });
});
