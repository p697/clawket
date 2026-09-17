jest.mock('expo-asset', () => ({
  Asset: {
    loadAsync: jest.fn(),
  },
}));

const deleteMock = jest.fn();
const copyMock = jest.fn();
const downloadFileAsyncMock = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    exists: boolean;

    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/([^:]\/)\/+/g, '$1');
      this.exists = false;
    }

    copy = copyMock;
    delete = deleteMock;
  }

  (MockFile as unknown as { downloadFileAsync: jest.Mock }).downloadFileAsync = downloadFileAsyncMock;

  return {
    File: MockFile,
    Paths: {
      cache: { uri: 'file:///cache' },
    },
  };
});

import { Asset } from 'expo-asset';
import * as MediaLibrary from 'expo-media-library/legacy';
import {
  saveBundledImageToPhotoLibrary,
  saveImageUriToPhotoLibrary,
  type SaveBundledImageToPhotoLibraryResult,
  type SaveImageUriToPhotoLibraryResult,
} from './photo-library';

describe('saveBundledImageToPhotoLibrary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns permission_denied when photo library access is not granted', async () => {
    const requestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
    requestPermissionsAsync.mockResolvedValueOnce({ granted: false });

    const result = await saveBundledImageToPhotoLibrary(123, 'wechat-group-qr');

    expect(result).toBe<SaveBundledImageToPhotoLibraryResult>('permission_denied');
    expect(Asset.loadAsync).not.toHaveBeenCalled();
  });

  it('downloads the bundled asset to a local file and saves it to the photo library', async () => {
    const requestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
    const saveToLibraryAsync = MediaLibrary.saveToLibraryAsync as jest.Mock;
    requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
    (Asset.loadAsync as jest.Mock).mockResolvedValueOnce([
      {
        localUri: 'file:///expo-cache/ExponentAsset-1.jpg',
        type: 'jpg',
      },
    ]);

    const result = await saveBundledImageToPhotoLibrary(123, 'wechat-group-qr');

    expect(result).toBe<SaveBundledImageToPhotoLibraryResult>('saved');
    expect(Asset.loadAsync).toHaveBeenCalledWith(123);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(saveToLibraryAsync).toHaveBeenCalledTimes(1);
    expect(String(saveToLibraryAsync.mock.calls[0][0])).toContain(
      'wechat-group-qr-',
    );
    expect(String(saveToLibraryAsync.mock.calls[0][0])).toMatch(/\.jpg$/);
  });

  it('throws when the asset loader does not provide a local file uri', async () => {
    const requestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
    requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
    (Asset.loadAsync as jest.Mock).mockResolvedValueOnce([
      {
        localUri: null,
        type: 'jpg',
      },
    ]);

    await expect(
      saveBundledImageToPhotoLibrary(123, 'wechat-group-qr'),
    ).rejects.toThrow('Bundled asset did not resolve to a local file URI.');
  });

  it('downloads a remote image url and saves it to the photo library', async () => {
    const requestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
    const saveToLibraryAsync = MediaLibrary.saveToLibraryAsync as jest.Mock;
    requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
    downloadFileAsyncMock.mockResolvedValueOnce({ uri: 'file:///cache/chat-image-1.webp' });

    const result = await saveImageUriToPhotoLibrary(
      'https://cdn.example.com/path/generated.webp?token=123',
      'chat-image',
    );

    expect(result).toBe<SaveImageUriToPhotoLibraryResult>('saved');
    expect(downloadFileAsyncMock).toHaveBeenCalledTimes(1);
    expect(downloadFileAsyncMock.mock.calls[0][0]).toBe('https://cdn.example.com/path/generated.webp?token=123');
    expect(String(downloadFileAsyncMock.mock.calls[0][1]?.uri ?? '')).toContain('chat-image-');
    expect(String(downloadFileAsyncMock.mock.calls[0][1]?.uri ?? '')).toMatch(/\.webp$/);
    expect(saveToLibraryAsync).toHaveBeenCalledWith(expect.stringContaining('chat-image-'));
  });

  it('copies a local image uri and saves it to the photo library', async () => {
    const requestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
    const saveToLibraryAsync = MediaLibrary.saveToLibraryAsync as jest.Mock;
    requestPermissionsAsync.mockResolvedValueOnce({ granted: true });

    const result = await saveImageUriToPhotoLibrary(
      'file:///tmp/original.png',
      'chat-image',
    );

    expect(result).toBe<SaveImageUriToPhotoLibraryResult>('saved');
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(downloadFileAsyncMock).not.toHaveBeenCalled();
    expect(saveToLibraryAsync).toHaveBeenCalledWith(expect.stringContaining('chat-image-'));
  });

  it('waits for the SDK 57 asynchronous copy before reading its destination', async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    let finishCopy!: () => void;
    copyMock.mockReturnValueOnce(new Promise<void>((resolve) => { finishCopy = resolve; }));
    const saving = saveImageUriToPhotoLibrary('file:///tmp/original.png', 'chat-image');
    await Promise.resolve();
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    finishCopy();
    await expect(saving).resolves.toBe('saved');
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledTimes(1);
  });

  it('propagates asynchronous copy failures without saving a missing file', async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    copyMock.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveImageUriToPhotoLibrary('file:///tmp/original.png', 'chat-image')).rejects.toThrow('disk full');
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });
});
