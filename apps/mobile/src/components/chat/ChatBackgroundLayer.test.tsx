import React from 'react';
import { render } from '@testing-library/react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
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

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: buildTheme(mockScheme, mockScheme, builtInAccents.iceBlue) }),
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
      enabled: true,
      imagePath: 'file:///documents/chat-appearance/background.jpg',
      ...patch,
    },
  };
}

describe.each(['light', 'dark'] as const)('ChatBackgroundLayer in %s', (scheme) => {
  beforeEach(() => { mockScheme = scheme; });

  it('renders nothing while the wallpaper is off or has no image', () => {
    expect(render(<ChatBackgroundLayer appearance={DEFAULT_CHAT_APPEARANCE} />).toJSON()).toBeNull();
    expect(render(<ChatBackgroundLayer appearance={wallpaper({ imagePath: undefined })} />).toJSON()).toBeNull();
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
