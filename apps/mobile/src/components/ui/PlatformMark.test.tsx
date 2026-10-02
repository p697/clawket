import React from 'react';
import { render } from '@testing-library/react-native';
import { buildTheme } from '../../theme/theme';
import { builtInAccents } from '../../theme/accents';
import { ControlSize, Radius } from '../../theme/tokens';
import { isProductFacePlatform, PlatformDisc, PlatformMark } from './PlatformMark';

let mockScheme: 'light' | 'dark' = 'light';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Image: (props: Record<string, unknown>) => ReactRuntime.createElement('Image', props),
    View: ({ children, ...props }: Record<string, unknown>) => ReactRuntime.createElement('View', props, children),
    StyleSheet: { create: <T extends Record<string, unknown>>(styles: T) => styles, flatten: (style: unknown) => style },
  };
});

jest.mock('../../theme', () => {
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return { useAppTheme: () => ({ theme: createTheme(mockScheme, mockScheme, accents.iceBlue) }) };
});

describe('PlatformMark', () => {
  afterEach(() => { mockScheme = 'light'; });

  it('draws the local-model outline in theme ink on the surface tile in both schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      mockScheme = scheme;
      const { colors } = buildTheme(scheme, scheme, builtInAccents.iceBlue);
      const view = render(<PlatformMark platform="local-model" />);
      const mark = view.getByTestId('platform-mark-local-model');
      expect(mark.props).toMatchObject({ width: ControlSize.settingsRow, height: ControlSize.settingsRow, viewBox: '0 0 52 52' });
      expect(view.UNSAFE_getByType('Rect' as never).props.fill).toBe(colors.surface);
      expect(view.UNSAFE_getByType('Path' as never).props).toMatchObject({ fill: 'none', stroke: colors.ink });
      view.unmount();
    }
  });

  it('keeps the local-model outline at least 1.2 points wide when drawn small', () => {
    for (const size of [20, 32, ControlSize.settingsRow]) {
      const view = render(<PlatformMark platform="local-model" size={size} />);
      const { strokeWidth } = view.UNSAFE_getByType('Path' as never).props as { strokeWidth: number };
      expect(strokeWidth * size / ControlSize.settingsRow).toBeGreaterThanOrEqual(1.2);
      view.unmount();
    }
  });

  it('keeps the default image boxes and balances the brands for the 44-point chooser slot', () => {
    const widthOf = (element: React.ReactElement) => {
      const view = render(element);
      const style = Object.assign({}, ...(view.UNSAFE_getByType('Image' as never).props.style as object[]).filter(Boolean)) as { width: number };
      view.unmount();
      return style.width;
    };
    // Default boxes (Connection page symbol): app artwork 52, bare marks 40.
    for (const platform of ['hermes', 'codex'] as const) expect(widthOf(<PlatformMark platform={platform} />)).toBe(ControlSize.settingsRow);
    for (const platform of ['openclaw', 'claude-code', 'pi'] as const) expect(widthOf(<PlatformMark platform={platform} />)).toBe(ControlSize.pill);
    // Balanced (owner request 2026-09-27): tiles drawn below bare glyphs, Pi's wide safe area compensated.
    const balanced = { openclaw: 36, 'claude-code': 39, hermes: 46, codex: 45, pi: 50 } as const;
    for (const [platform, width] of Object.entries(balanced)) {
      expect(widthOf(<PlatformMark platform={platform as keyof typeof balanced} balanced />)).toBe(width);
      expect(widthOf(<PlatformMark platform={platform as keyof typeof balanced} balanced size={32} />)).toBeCloseTo(width * 32 / ControlSize.floatingButton);
    }
    const local = render(<PlatformMark platform="local-model" balanced />);
    expect(local.getByTestId('platform-mark-local-model').props).toMatchObject({ width: 41, height: 41 });
  });

  it('names the backends whose Agent is the product itself', () => {
    for (const platform of ['hermes', 'codex', 'claude-code', 'pi', 'local-model'] as const) {
      expect(isProductFacePlatform(platform)).toBe(true);
    }
    // OpenClaw Agents have identities of their own.
    for (const platform of ['openclaw', null, undefined] as const) {
      expect(isProductFacePlatform(platform)).toBe(false);
    }
  });

  it('fits official artwork to a disc: app tiles fill it, bare marks span the glyph share', () => {
    const imageOf = (element: React.ReactElement) => {
      const view = render(element);
      const props = view.UNSAFE_getByType('Image' as never).props as { style: { width: number; height: number } };
      view.unmount();
      return props.style;
    };
    // App artwork covers 81% of its box, so the tile is drawn past the circle to hide its corners and shadow.
    expect(imageOf(<PlatformDisc platform="codex" size={56} glyph={0.54} />).width).toBeCloseTo((56 / 0.81) * 1.02);
    expect(imageOf(<PlatformDisc platform="hermes" size={20} glyph={0.72} />).width).toBeCloseTo((20 / 0.79) * 1.02);
    // A bare mark's visible part spans the glyph share of the diameter, with optical corrections.
    expect(imageOf(<PlatformDisc platform="claude-code" size={56} glyph={0.54} />).width * 0.85).toBeCloseTo(56 * 0.54);
    expect(imageOf(<PlatformDisc platform="openclaw" size={20} glyph={0.72} />).width * 0.92).toBeCloseTo(20 * 0.72 * 1.08);
    expect(imageOf(<PlatformDisc platform="pi" size={56} glyph={0.54} />).width * 0.59).toBeCloseTo(56 * 0.54 * 0.92);

    const { colors } = buildTheme('light', 'light', builtInAccents.iceBlue);
    const face = render(<PlatformDisc testID="face" platform="claude-code" size={56} glyph={0.54} />);
    expect(Object.assign({}, ...(face.getByTestId('face').props.style as object[]))).toMatchObject({
      width: 56, height: 56, borderRadius: Radius.full, overflow: 'hidden', backgroundColor: colors.surfaceFloating,
    });
    const badge = render(<PlatformDisc testID="badge" platform="openclaw" size={20} glyph={0.72} ground="surface" />);
    expect(Object.assign({}, ...(badge.getByTestId('badge').props.style as object[])).backgroundColor).toBe(colors.surface);
  });

  it('draws the local-model chip alone on a disc and keeps exported artwork out of dark mode', () => {
    mockScheme = 'dark';
    const { colors } = buildTheme('dark', 'dark', builtInAccents.iceBlue);
    const themed = render(<PlatformDisc platform="local-model" size={56} glyph={0.54} />);
    // The disc is the quiet ground, so the chooser tile is not drawn again inside it.
    expect(themed.UNSAFE_queryAllByType('Rect' as never)).toHaveLength(0);
    const glyph = themed.getByTestId('platform-disc-local-model-glyph');
    expect(glyph.props).toMatchObject({ width: 56 * 0.54, height: 56 * 0.54 });
    const path = themed.UNSAFE_getByType('Path' as never).props as { stroke: string; strokeWidth: number };
    expect(path.stroke).toBe(colors.ink);
    // The outline draws 1.4 points wide whatever the glyph size (26 viewBox units across the glyph).
    expect(path.strokeWidth * (56 * 0.54) / 26).toBeCloseTo(1.4);
    themed.unmount();

    const poster = render(<PlatformDisc testID="poster" platform="local-model" size={56} glyph={0.54}
      artworkColors={{ ground: '#FFFFFF', ink: '#111113' }} />);
    expect(Object.assign({}, ...(poster.getByTestId('poster').props.style as object[])).backgroundColor).toBe('#FFFFFF');
    expect((poster.UNSAFE_getByType('Path' as never).props as { stroke: string }).stroke).toBe('#111113');
  });

  it('uses the bare Claude spark, not the circular-backed model-picker artwork', () => {
    const view = render(<PlatformMark platform="claude-code" />);
    // jest.setup maps assets/brands/claude-code.png to 309 and the model-picker Claude PNG to 402.
    expect(view.UNSAFE_getByType('Image' as never).props.source).toBe(309);
  });
});
