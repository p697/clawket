import { buildTheme } from '../../theme/theme';
import { builtInAccents, defaultAccentId } from '../../theme/accents';
import { DEFAULT_CHAT_APPEARANCE } from './defaults';
import { resolveChatBubbleAppearance } from './resolver';

describe('resolveChatBubbleAppearance', () => {
  it('keeps the default solid bubbles unbordered', () => {
    const theme = buildTheme('light', 'light', builtInAccents[defaultAccentId]);

    const result = resolveChatBubbleAppearance(theme, DEFAULT_CHAT_APPEARANCE);

    expect(result.userBubble.borderWidth).toBe(0);
    expect(result.userBubble.shadow).toBe(false);
    expect(result.assistantBubble.borderWidth).toBe(0);
    expect(result.assistantBubble.shadow).toBe(false);
  });

  it('adds translucent borders and shadows for glass bubbles', () => {
    const theme = buildTheme('dark', 'dark', builtInAccents[defaultAccentId]);

    const result = resolveChatBubbleAppearance(theme, {
      ...DEFAULT_CHAT_APPEARANCE,
      background: {
        ...DEFAULT_CHAT_APPEARANCE.background,
        enabled: true,
        imagePath: 'file:///wallpaper.jpg',
      },
      bubbles: {
        style: 'glass',
        opacity: 0.9,
      },
    });

    expect(result.userBubble.borderWidth).toBe(1);
    expect(result.userBubble.shadow).toBe(true);
    expect(result.userBubble.backgroundColor).toContain('rgba(');
    expect(result.assistantBubble.borderWidth).toBe(1);
    expect(result.assistantBubble.shadow).toBe(true);
  });
});

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

it.each(Object.keys(builtInAccents) as (keyof typeof builtInAccents)[])('keeps %s body text readable across materials, schemes and wallpaper extremes', (accentId) => {
  for (const scheme of ['light', 'dark'] as const) {
    const theme = buildTheme(scheme, scheme, builtInAccents[accentId]);
    for (const style of ['solid', 'soft', 'glass'] as const) {
      for (const opacity of [0.78, 0.9, 1]) {
        const result = resolveChatBubbleAppearance(theme, { ...DEFAULT_CHAT_APPEARANCE, bubbles: { style, opacity } });
        for (const bubble of [result.userBubble, result.assistantBubble]) {
          for (const backdrop of [theme.colors.canvas, '#000000', '#FFFFFF']) {
            const [r, g, b, alpha = 1] = channels(bubble.backgroundColor);
            const behind = channels(backdrop);
            const bg = luminance([r, g, b].map((v, i) => v * alpha + behind[i] * (1 - alpha)));
            const fg = luminance(channels(theme.colors.ink));
            expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  }
});
