import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Radius } from '../../theme/tokens';
import { MessageAttachmentAlbum } from './MessageAttachmentAlbum';
import { ALBUM_TILE_GAP } from './attachmentAlbumLayout';

const mockGetSize = jest.fn();

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  const Image = primitive('Image') as ((props: Record<string, unknown>) => unknown) & { getSize?: unknown };
  Image.getSize = (...args: unknown[]) => mockGetSize(...args);
  const flatten = (style: unknown): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const append = (value: unknown): void => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(append);
      else if (typeof value === 'object') Object.assign(result, value);
    };
    append(style);
    return result;
  };
  return {
    Image,
    Pressable: primitive('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten, hairlineWidth: 1 },
    View: primitive('View'),
  };
});

jest.mock('./ChatPresentation', () => ({
  useConversationTheme: () => ({ colors: { surface: '#f2f2f4' } }),
}));

function flattenStyle(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  return Object.assign({}, ...value.map(flattenStyle));
}

const WIDTH = 274;
const label = (index: number, count: number) => `Photo ${index} of ${count}`;

describe('MessageAttachmentAlbum', () => {
  beforeEach(() => {
    mockGetSize.mockReset();
  });

  it('renders every photo as its own tile with a spoken position and opens the tapped index', () => {
    const onPressImage = jest.fn();
    const uris = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
    const view = render(
      <MessageAttachmentAlbum
        testID="album"
        uris={uris}
        metas={uris.map((uri) => ({ uri, width: 100, height: 100 }))}
        maxWidth={WIDTH}
        align="end"
        label="4 attachments"
        formatTileLabel={label}
        onPressImage={onPressImage}
      />,
    );
    expect(mockGetSize).not.toHaveBeenCalled();
    expect(view.getByLabelText('4 attachments')).toBeTruthy();
    const album = flattenStyle(view.getByTestId('album').props.style);
    expect(album).toMatchObject({ width: WIDTH, alignSelf: 'flex-end', borderRadius: Radius.bubble, overflow: 'hidden' });
    for (let index = 0; index < uris.length; index += 1) {
      const tile = view.getByLabelText(`Photo ${index + 1} of 4`);
      expect(tile.props.accessibilityRole).toBe('imagebutton');
      expect(view.getByTestId(`album-${index}`)).toBe(tile);
    }
    fireEvent.press(view.getByLabelText('Photo 3 of 4'));
    expect(onPressImage).toHaveBeenCalledWith(2);
    // 2 × 2: the second row starts one gap below the first.
    const frames = uris.map((_, index) => flattenStyle(view.getByTestId(`album-${index}`).props.style));
    expect(frames[2].top).toBe((frames[0].height as number) + ALBUM_TILE_GAP);
    expect(frames[1].left).toBe((frames[0].width as number) + ALBUM_TILE_GAP);
  });

  it('forwards a long press with the row delay so photos open the message actions', () => {
    const onLongPress = jest.fn();
    const view = render(
      <MessageAttachmentAlbum
        testID="album"
        uris={['a.jpg']}
        metas={[{ uri: 'a.jpg', width: 100, height: 100 }]}
        maxWidth={WIDTH}
        align="start"
        label="1 attachments"
        formatTileLabel={label}
        onLongPress={onLongPress}
        longPressDelay={220}
      />,
    );
    const tile = view.getByTestId('album-0');
    expect(tile.props.delayLongPress).toBe(220);
    fireEvent(tile, 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(flattenStyle(view.getByTestId('album').props.style).alignSelf).toBe('flex-start');
  });

  it('starts from a stable square footprint and re-lays out once unknown sizes resolve', async () => {
    let resolveSize: ((width: number, height: number) => void) | undefined;
    mockGetSize.mockImplementation((_uri: string, onSuccess: (width: number, height: number) => void) => {
      resolveSize = onSuccess;
    });
    const view = render(
      <MessageAttachmentAlbum
        testID="album"
        uris={['shot.png']}
        maxWidth={WIDTH}
        align="end"
        label="1 attachments"
        formatTileLabel={label}
      />,
    );
    expect(flattenStyle(view.getByTestId('album').props.style)).toMatchObject({ width: WIDTH, height: WIDTH });
    expect(mockGetSize).toHaveBeenCalledWith('shot.png', expect.any(Function), expect.any(Function));

    await act(async () => {
      resolveSize?.(1179, 2556);
      await Promise.resolve();
    });
    const resolved = flattenStyle(view.getByTestId('album').props.style);
    expect(resolved.height).toBe(Math.round(WIDTH * 1.25));
    expect(resolved.width).toBe(Math.round((resolved.height as number) * 0.5));
  });

  it('keeps a usable album when a size lookup fails', async () => {
    mockGetSize.mockImplementation((_uri: string, _onSuccess: unknown, onError: (error: Error) => void) => {
      onError(new Error('decode failed'));
    });
    const view = render(
      <MessageAttachmentAlbum
        testID="album"
        uris={['broken.png', 'fine.png']}
        maxWidth={WIDTH}
        align="end"
        label="2 attachments"
        formatTileLabel={label}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    const frames = [0, 1].map((index) => flattenStyle(view.getByTestId(`album-${index}`).props.style));
    // Both read as squares; the last tile absorbs the odd point so the row still spans the album.
    expect(Math.abs((frames[0].width as number) - (frames[1].width as number))).toBeLessThanOrEqual(1);
    expect((frames[0].width as number) + ALBUM_TILE_GAP + (frames[1].width as number)).toBe(WIDTH);
  });

  it('renders nothing without photos', () => {
    const view = render(
      <MessageAttachmentAlbum uris={[]} maxWidth={WIDTH} align="end" label="0 attachments" formatTileLabel={label} />,
    );
    expect(view.toJSON()).toBeNull();
  });
});
