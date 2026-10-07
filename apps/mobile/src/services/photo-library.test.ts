import { manipulateAsync } from 'expo-image-manipulator';
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
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
import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import {
  saveBundledImageToPhotoLibrary,
  saveImageUriToPhotoLibrary,
  type SaveBundledImageToPhotoLibraryResult,
  type SaveImageUriToPhotoLibraryResult,
} from './photo-library';
import { requestPhotoLibraryWritePermission } from './photo-library-permissions';

const originalPlatform = { OS: Platform.OS, Version: Platform.Version };
afterEach(() => { Object.assign(Platform, originalPlatform); });

describe('photo write permissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([33, 34, 36])('saves on Android API %s without requesting permission to read media', async (version) => {
    Object.assign(Platform, { OS: 'android', Version: version });
    await expect(saveImageUriToPhotoLibrary('file:///original.png', 'chat-image')).resolves.toBe('saved');
    expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalled();
  });

  it.each([24, 29, 32])('requests only legacy write access on Android API %s', async (version) => {
    Object.assign(Platform, { OS: 'android', Version: version });
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    await expect(requestPhotoLibraryWritePermission()).resolves.toBe(true);
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, ['photo']);
  });
});

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
    let announceCopy!: () => void;
    const copyStarted = new Promise<void>((resolve) => { announceCopy = resolve; });
    copyMock.mockImplementationOnce(() => {
      announceCopy();
      return new Promise<void>((resolve) => { finishCopy = resolve; });
    });
    const saving = saveImageUriToPhotoLibrary('file:///tmp/original.png', 'chat-image');
    await copyStarted;
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

it('saves inline images through a temporary local file with write-only photo permission', async () => {
  jest.clearAllMocks();
  (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
  (manipulateAsync as jest.Mock).mockResolvedValueOnce({ uri: 'file:///inline.jpg' });
  await expect(saveImageUriToPhotoLibrary('data:image/png;base64,aA==', 'chat-image')).resolves.toBe('saved');
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, ['photo']);
  expect(manipulateAsync).toHaveBeenCalled();
  expect(downloadFileAsyncMock).not.toHaveBeenCalled();
  expect(deleteMock).toHaveBeenCalledTimes(2);
});
it('cleans image save scratch files after a library write failure', async () => {
  jest.clearAllMocks();
  (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
  (MediaLibrary.saveToLibraryAsync as jest.Mock).mockRejectedValueOnce(new Error('full'));
  await expect(saveImageUriToPhotoLibrary('file:///original.png', 'chat-image')).rejects.toThrow('full');
  expect(deleteMock).toHaveBeenCalledTimes(1);
});
