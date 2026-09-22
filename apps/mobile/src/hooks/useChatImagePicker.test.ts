import { act, renderHook } from '@testing-library/react-native';

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

import { useChatImagePicker } from './useChatImagePicker';

describe('useChatImagePicker.attachLocalImages', () => {
  const manipulateAsync = jest.requireMock('expo-image-manipulator').manipulateAsync as jest.Mock;

  beforeEach(() => {
    manipulateAsync.mockReset();
  });

  it('re-encodes local photos as JPEG with base64 in pick order and respects the slot limit', async () => {
    manipulateAsync.mockImplementation(async (uri: string, _actions: unknown, options: { compress: number; format: string; base64: boolean }) => {
      expect(options).toEqual({ base64: true, compress: 0.8, format: 'jpeg' });
      return { uri: uri.replace('.heic', '.jpg'), width: 1200, height: 1600, base64: `b64:${uri}` };
    });
    const { result } = renderHook(() => useChatImagePicker(2));

    await act(async () => {
      await result.current.attachLocalImages(['file:///a.heic', 'file:///b.heic', 'file:///c.heic']);
    });

    expect(manipulateAsync).toHaveBeenCalledTimes(2);
    expect(result.current.pendingImages).toEqual([
      { uri: 'file:///a.jpg', base64: 'b64:file:///a.heic', mimeType: 'image/jpeg', width: 1200, height: 1600 },
      { uri: 'file:///b.jpg', base64: 'b64:file:///b.heic', mimeType: 'image/jpeg', width: 1200, height: 1600 },
    ]);
    expect(result.current.canAddMoreImages).toBe(false);

    await act(async () => {
      await result.current.attachLocalImages(['file:///d.heic']);
    });
    expect(manipulateAsync).toHaveBeenCalledTimes(2);
  });

  it('skips photos that cannot be encoded without dropping the rest', async () => {
    manipulateAsync
      .mockRejectedValueOnce(new Error('unreadable'))
      .mockResolvedValueOnce({ uri: 'file:///b.jpg', width: 10, height: 10, base64: undefined })
      .mockResolvedValueOnce({ uri: 'file:///c.jpg', width: 10, height: 10, base64: 'ok' });
    const { result } = renderHook(() => useChatImagePicker(6));

    await act(async () => {
      await result.current.attachLocalImages(['file:///a.heic', 'file:///b.heic', 'file:///c.heic']);
    });

    expect(result.current.pendingImages.map((image) => image.uri)).toEqual(['file:///c.jpg']);
  });
});

 it('discards a photo library result returned after switching conversations', async () => {
   const picker = jest.requireMock('expo-image-picker').launchImageLibraryAsync as jest.Mock;
   let resolve!: (result: unknown) => void;
   picker.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
   const view = renderHook(({ scope }: { scope: string }) => useChatImagePicker(6, scope), { initialProps: { scope: 'openclaw:main' } });
   let pending!: Promise<void>;
   act(() => { pending = view.result.current.pickImage(); });
   view.rerender({ scope: 'hermes:main' });
   await act(async () => { resolve({ canceled: false, assets: [{ uri: 'private-old-photo', base64: 'old' }] }); await pending; });
   expect(view.result.current.pendingImages).toEqual([]);
 });
