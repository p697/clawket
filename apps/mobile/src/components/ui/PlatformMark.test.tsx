import React from 'react';
import { render } from '@testing-library/react-native';
import { buildTheme } from '../../theme/theme';
import { builtInAccents } from '../../theme/accents';
import { ControlSize } from '../../theme/tokens';
import { PlatformMark } from './PlatformMark';

let mockScheme: 'light' | 'dark' = 'light';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Image: (props: Record<string, unknown>) => ReactRuntime.createElement('Image', props),
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

  it('uses the bare Claude spark, not the circular-backed model-picker artwork', () => {
    const view = render(<PlatformMark platform="claude-code" />);
    // jest.setup maps assets/brands/claude-code.png to 309 and the model-picker Claude PNG to 402.
    expect(view.UNSAFE_getByType('Image' as never).props.source).toBe(309);
  });
});
