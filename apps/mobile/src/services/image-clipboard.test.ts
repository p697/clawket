import { copyImageToClipboard } from './image-clipboard';
import { manipulateAsync } from 'expo-image-manipulator';
import { setImageAsync } from 'expo-clipboard';
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({ File: class { delete = mockDelete; } }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { PNG: 'png' } }));
jest.mock('expo-clipboard', () => ({ setImageAsync: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); (manipulateAsync as jest.Mock).mockResolvedValue({ uri: 'file:///copy.png', base64: 'pixels' }); });
it.each(['file:///original.png', 'data:image/png;base64,pixels', 'https://example.com/image.webp'])('copies image pixels and cleans the converted cache: %s', async uri => {
  await copyImageToClipboard(uri);
  expect(manipulateAsync).toHaveBeenCalledWith(uri, [], { format: 'png', base64: true });
  expect(setImageAsync).toHaveBeenCalledWith('pixels'); expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('cleans cache even when the clipboard rejects the write', async () => {
  (setImageAsync as jest.Mock).mockRejectedValueOnce(new Error('clipboard unavailable'));
  await expect(copyImageToClipboard('file:///original.png')).rejects.toThrow();
  expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('does not delete the source image or copy an empty result', async () => {
  (manipulateAsync as jest.Mock).mockResolvedValue({ uri: 'file:///original.png' });
  await expect(copyImageToClipboard('file:///original.png')).rejects.toThrow();
  expect(mockDelete).not.toHaveBeenCalled(); expect(setImageAsync).not.toHaveBeenCalled();
});
