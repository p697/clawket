import React from 'react';
import { render } from '@testing-library/react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { chatWallpaperDriftGradient, chatWallpaperPalettes } from '../../theme/chat-wallpaper';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';

let mockScheme: 'light' | 'dark' = 'light';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Image: primitive('Image'),
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    StyleSheet: {
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        const append = (value: unknown): void => {
          if (!value) return;
          if (Array.isArray(value)) value.forEach(append);
          else if (typeof value === 'object') Object.assign(result, value);
        };
        append(style);
        return result;
      },
      hairlineWidth: 1,
    },
    View: primitive('View'),
  };
});

let mockAccentId: 'iceBlue' | 'jadeGreen' = 'iceBlue';

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: buildTheme(mockScheme, mockScheme, builtInAccents[mockAccentId]), accentId: mockAccentId }),
}));

function flattenStyle(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  return Object.assign({}, ...value.map(flattenStyle));
}

function wallpaper(patch: Partial<ChatAppearanceSettings['background']> = {}): ChatAppearanceSettings {
  return {
    ...DEFAULT_CHAT_APPEARANCE,
    background: {
      ...DEFAULT_CHAT_APPEARANCE.background,
      kind: 'photo',
      enabled: true,
      imagePath: 'file:///documents/chat-appearance/background.jpg',
      ...patch,
    },
  };
}

describe.each(['light', 'dark'] as const)('ChatBackgroundLayer in %s', (scheme) => {
  beforeEach(() => { mockScheme = scheme; mockAccentId = 'iceBlue'; });

  it('draws nothing on the plain canvas', () => {
    const plain = { ...DEFAULT_CHAT_APPEARANCE, background: { ...DEFAULT_CHAT_APPEARANCE.background, kind: 'plain' as const } };
    expect(render(<ChatBackgroundLayer appearance={plain} />).toJSON()).toBeNull();
  });

  it('draws the built-in wallpaper by default and when a photo choice has no image', () => {
    const view = render(<ChatBackgroundLayer appearance={DEFAULT_CHAT_APPEARANCE} />);
    expect(view.getByTestId('chat-background-layer').props.pointerEvents).toBe('none');
    expect(view.getByTestId('chat-background-layer-pattern')).toBeTruthy();
    expect(view.queryByTestId('chat-background-layer-image')).toBeNull();
    view.rerender(<ChatBackgroundLayer appearance={wallpaper({ imagePath: undefined })} />);
    expect(view.getByTestId('chat-background-layer-pattern')).toBeTruthy();
  });

  it('colors the built-in wallpaper from the conversation accent', () => {
    mockAccentId = 'jadeGreen';
    const palette = chatWallpaperPalettes.jadeGreen[scheme];
    const view = render(<ChatBackgroundLayer appearance={DEFAULT_CHAT_APPEARANCE} />);
    // One native gradient three screens wide and tall: each send slides it to the next window.
    expect(flattenStyle(view.getByTestId('chat-background-layer-pattern-gradient').props.style)).toMatchObject({
      position: 'absolute', left: 0, top: 0, width: '300%', height: '300%',
      experimental_backgroundImage: chatWallpaperDriftGradient(palette),
    });
    const doodles = view.UNSAFE_root.findAll((node) => (node.type as unknown) === 'G' && node.props.stroke !== undefined);
    expect(doodles[0]?.props).toMatchObject({ stroke: palette.doodle, strokeOpacity: palette.doodleOpacity, fill: 'none' });
  });

  it('fills its host edge to edge with the blurred photo over the theme canvas and takes no touches', () => {
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);
    const view = render(<ChatBackgroundLayer appearance={wallpaper({ blur: 12.4 })} />);
    const root = view.getByTestId('chat-background-layer');
    expect(root.props.pointerEvents).toBe('none');
    expect(flattenStyle(root.props.style)).toMatchObject({
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden', backgroundColor: theme.colors.canvas,
    });
    const image = view.getByTestId('chat-background-layer-image');
    expect(image.props.source).toEqual({ uri: 'file:///documents/chat-appearance/background.jpg' });
    expect(image.props.resizeMode).toBe('cover');
    expect(image.props.blurRadius).toBe(12);
    expect(view.queryByTestId('chat-background-layer-dim')).toBeNull();
  });

  it('lays the canvas over the photo at the saved dim, bounded to the wallpaper maximum', () => {
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);
    const view = render(<ChatBackgroundLayer appearance={wallpaper({ dim: 0.3 })} />);
    expect(flattenStyle(view.getByTestId('chat-background-layer-dim').props.style)).toMatchObject({
      position: 'absolute', backgroundColor: withAlpha(theme.colors.canvas, 0.3),
    });
    view.rerender(<ChatBackgroundLayer appearance={wallpaper({ dim: 0.95 })} />);
    expect(flattenStyle(view.getByTestId('chat-background-layer-dim').props.style).backgroundColor)
      .toBe(withAlpha(theme.colors.canvas, 0.6));
  });

  it('prefers an explicit preview image over the saved path', () => {
    const view = render(<ChatBackgroundLayer appearance={wallpaper()} imageUri="file:///picked.jpg" />);
    expect(view.getByTestId('chat-background-layer-image').props.source).toEqual({ uri: 'file:///picked.jpg' });
  });
});
