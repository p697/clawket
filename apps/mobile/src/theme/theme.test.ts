import { builtInAccents, defaultAccentId } from './accents';
import { agentPalette, buildTheme } from './theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Radius,
  Shadow,
  Space,
  TimingPreset,
} from './tokens';

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3 || channels.some(Number.isNaN)) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Clawket 3.0 theme tokens', () => {
  it('exposes the canonical light and dark semantic palettes', () => {
    const accent = builtInAccents[defaultAccentId];
    const light = buildTheme('light', 'dark', accent);
    const dark = buildTheme('dark', 'light', accent);

    expect(light.colors).toMatchObject({
      canvas: '#FFFFFF',
      canvasGrouped: '#F5F5F7',
      surface: '#F2F2F4',
      surfaceFloating: '#FFFFFF',
      ink: '#111113',
      inkSecondary: '#6B6B72',
      inkTertiary: '#A3A3AB',
      line: '#E6E6EA',
      accent: '#1F5EFF',
      accentSoft: 'rgba(31,94,255,0.1)',
      good: '#178A6A',
      goodSoft: 'rgba(23,138,106,0.12)',
      warn: '#D9791C',
      warnSoft: 'rgba(217,121,28,0.12)',
      bad: '#D64545',
      badSoft: 'rgba(214,69,69,0.12)',
    });
    expect(dark.colors).toMatchObject({
      canvas: '#0C0C0D',
      canvasGrouped: '#0C0C0D',
      surface: '#1A1A1D',
      surfaceFloating: '#222225',
      ink: '#F3F3F5',
      inkSecondary: '#9A9AA3',
      inkTertiary: '#6A6A73',
      line: '#2A2A2F',
      accent: '#6B95FF',
      accentSoft: 'rgba(107,149,255,0.16)',
      good: '#2FA07C',
      goodSoft: 'rgba(47,160,124,0.2)',
      warn: '#D07F30',
      warnSoft: 'rgba(208,127,48,0.2)',
      bad: '#E06060',
      badSoft: 'rgba(224,96,96,0.2)',
    });
    expect(agentPalette).toEqual([
      '#1F5EFF',
      '#D9791C',
      '#178A6A',
      '#E2477B',
      '#7A5AF8',
      '#1C8FA3',
      '#8A5A3C',
      '#5B6673',
    ]);
  });

  it('keeps old color names as aliases of their canonical semantics', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colors = buildTheme(scheme, scheme, builtInAccents[defaultAccentId]).colors;
      expect(colors.background).toBe(colors.canvas);
      expect(colors.surfaceMuted).toBe(colors.surface);
      expect(colors.surfaceElevated).toBe(colors.surfaceFloating);
      expect(colors.border).toBe(colors.line);
      expect(colors.text).toBe(colors.ink);
      expect(colors.textMuted).toBe(colors.inkSecondary);
      expect(colors.textSubtle).toBe(colors.inkTertiary);
      expect(colors.primary).toBe(colors.accent);
      expect(colors.primarySoft).toBe(colors.accentSoft);
      expect(colors.success).toBe(colors.good);
      expect(colors.warning).toBe(colors.warn);
      expect(colors.error).toBe(colors.bad);
    }
  });

  it('keeps every built-in link accent readable on its canvas', () => {
    for (const accent of Object.values(builtInAccents)) {
      const light = buildTheme('light', 'light', accent).colors;
      const dark = buildTheme('dark', 'dark', accent).colors;
      expect(contrastRatio(light.accent, light.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark.accent, dark.canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps canonical text colors readable on each canvas', () => {
    const accent = builtInAccents[defaultAccentId];
    for (const scheme of ['light', 'dark'] as const) {
      const colors = buildTheme(scheme, scheme, accent).colors;
      expect(contrastRatio(colors.ink, colors.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.inkSecondary, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('limits typography, spacing, weight, shape, and motion to the 3.0 values', () => {
    expect([FontSize.display, FontSize.title, FontSize.body, FontSize.secondary, FontSize.caption])
      .toEqual([28, 20, 17, 15, 13]);
    expect([...new Set(Object.values(FontSize))].sort((a, b) => a - b))
      .toEqual([13, 15, 17, 20, 28]);
    expect([LineHeight.display, LineHeight.title, LineHeight.body, LineHeight.secondary, LineHeight.caption])
      .toEqual([34, 26, 24, 20, 18]);
    expect([...new Set(Object.values(LineHeight))].sort((a, b) => a - b))
      .toEqual([18, 20, 24, 26, 34]);
    expect([...new Set(Object.values(FontWeight))].sort()).toEqual(['400', '600']);
    expect([...new Set(Object.values(Space))].sort((a, b) => a - b))
      .toEqual([4, 8, 12, 16, 24, 32]);
    expect(Radius).toMatchObject({
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
    });
    expect(ControlSize).toMatchObject({
      pill: 40,
      floatingButton: 44,
      settingsRow: 52,
      rosterRow: 88,
    });
    expect(Motion).toEqual({
      duration: { fast: 120, normal: 200, slow: 320 },
      easing: 'easeOut',
      pressedScale: 0.96,
      messageEnterOffset: 4,
      avatarWorkingLoop: 1_200,
      avatarDoneFade: 3_000,
    });
    expect(TimingPreset).toBe(Motion.duration);
    expect(Shadow.floating).toEqual({
      shadowColor: '#111113',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 2,
    });
  });
});
