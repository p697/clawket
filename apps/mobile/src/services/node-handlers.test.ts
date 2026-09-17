import {
  handleDeviceInfo,
  handleDeviceStatus,
  handleSystemNotify,
  handleCameraSnap,
  handlePhotosLatest,
  handleCameraCapture,
  handleCameraPick,
  handleClipboardRead,
  handleClipboardWrite,
  handleMediaSave,
} from './node-handlers';
import { Platform } from 'react-native';
import { NodeCameraCaptureError, requestNodeCameraCapture } from './node-camera-capture';

jest.mock('./node-camera-capture', () => ({
  NodeCameraCaptureError: class NodeCameraCaptureError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'NodeCameraCaptureError';
    }
  },
  requestNodeCameraCapture: jest.fn(() => Promise.resolve({
    uri: 'file://captured-auto.jpg',
    width: 2000,
    height: 4000,
    format: 'jpg',
  })),
}));

const mutablePlatform = Platform as typeof Platform & { isMacCatalyst?: boolean };
const originalPlatformOS = mutablePlatform.OS;
const originalIsMacCatalyst = mutablePlatform.isMacCatalyst;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  mutablePlatform.OS = originalPlatformOS;
  mutablePlatform.isMacCatalyst = originalIsMacCatalyst;
  jest.resetModules();
});

// ── device ──────────────────────────────────────────────────────────────────

describe('handleDeviceInfo', () => {
  it('returns ok with device platform info', async () => {
    const result = await handleDeviceInfo();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as Record<string, unknown>;
    expect(payload.platform).toBe('ios');
    expect(payload.systemName).toBe('iOS');
    expect(typeof payload.systemVersion).toBe('string');
    expect(typeof payload.model).toBe('string');
  });

  it('reports macOS identity for Mac Catalyst', async () => {
    jest.resetModules();
    const runtimePlatform = require('react-native').Platform as typeof Platform & { isMacCatalyst?: boolean };
    runtimePlatform.OS = 'ios';
    runtimePlatform.isMacCatalyst = true;

    const { handleDeviceInfo: handleCatalystDeviceInfo } = await import('./node-handlers');
    const result = await handleCatalystDeviceInfo();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as Record<string, unknown>;
    expect(payload.platform).toBe('macos');
    expect(payload.systemName).toBe('macOS');
  });
});

describe('handleDeviceStatus', () => {
  it('returns battery/network status and appState', async () => {
    const result = await handleDeviceStatus();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as Record<string, unknown>;
    expect(payload.batteryLevel).toBe(0.67);
    expect(payload.batteryState).toBe('charging');
    expect(payload.lowPowerMode).toBe(false);
    expect(payload.networkType).toBe('wifi');
    expect(payload.isConnected).toBe(true);
    expect(payload.isInternetReachable).toBe(true);
    expect(typeof payload.appState).toBe('string');
  });
});

describe('handleSystemNotify', () => {
  it('schedules system notification with title and body', async () => {
    const Notifications = require('expo-notifications');
    const result = await handleSystemNotify({ title: 'Hello', body: 'World' });
    expect(result.ok).toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Hello', body: 'World' },
      trigger: null,
    });
  });

  it('uses default title when params are empty', async () => {
    const Notifications = require('expo-notifications');
    const result = await handleSystemNotify({});
    expect(result.ok).toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Notification', body: undefined },
      trigger: null,
    });
  });

  it('handles null params gracefully', async () => {
    const Notifications = require('expo-notifications');
    const result = await handleSystemNotify(null);
    expect(result.ok).toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Notification', body: undefined },
      trigger: null,
    });
  });

  it('returns PERMISSION_DENIED when notifications permission is denied', async () => {
    const Notifications = require('expo-notifications');
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const result = await handleSystemNotify({ title: 'Hello' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

// ── camera ──────────────────────────────────────────────────────────────────

describe('handleCameraCapture', () => {
  it('returns photo data on success', async () => {
    const result = await handleCameraCapture();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as Record<string, unknown>;
    expect(payload.base64).toBe('abc123');
    expect(payload.width).toBe(2000);
    expect(payload.height).toBe(4000);
    expect(payload.uri).toBe('file://photo.jpg');
  });

  it('returns PERMISSION_DENIED when camera is denied', async () => {
    const ImagePicker = require('expo-image-picker');
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const result = await handleCameraCapture();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  it('returns canceled when user cancels', async () => {
    const ImagePicker = require('expo-image-picker');
    ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    const result = await handleCameraCapture();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload as Record<string, unknown>).canceled).toBe(true);
  });

  it('uses image library instead of camera on Mac Catalyst', async () => {
    jest.resetModules();
    const ImagePicker = require('expo-image-picker');
    const runtimePlatform = require('react-native').Platform as typeof Platform & { isMacCatalyst?: boolean };
    runtimePlatform.OS = 'ios';
    runtimePlatform.isMacCatalyst = true;
    const { handleCameraCapture: handleCatalystCameraCapture } = await import('./node-handlers');

    const result = await handleCatalystCameraCapture();

    expect(result.ok).toBe(true);
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      base64: true,
      quality: 0.8,
      mediaTypes: ['images'],
    });
  });
});

describe('handleCameraPick', () => {
  it('returns picked image data on success', async () => {
    const result = await handleCameraPick();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as Record<string, unknown>;
    expect(payload.base64).toBe('def456');
    expect(payload.width).toBe(300);
    expect(payload.height).toBe(400);
  });

  it('returns PERMISSION_DENIED when media library is denied', async () => {
    const ImagePicker = require('expo-image-picker');
    ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const result = await handleCameraPick();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('handleCameraSnap', () => {
  it('returns the official camera.snap payload shape', async () => {
    const result = await handleCameraSnap();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as Record<string, unknown>;
    expect(payload.format).toBe('jpg');
    expect(payload.base64).toBe('camera-base64-jpg-0.95');
    expect(payload.width).toBe(1600);
    expect(payload.height).toBe(3200);
    expect(payload).not.toHaveProperty('uri');
    expect(requestNodeCameraCapture).toHaveBeenCalledWith({
      facing: 'front',
      quality: 0.95,
    });
  });

  it('honors official facing, maxWidth, quality and format params', async () => {
    const ImageManipulator = require('expo-image-manipulator');

    const result = await handleCameraSnap({
      facing: 'back',
      maxWidth: 800,
      quality: 0.4,
      format: 'jpg',
      delayMs: 0,
    });

    expect(result.ok).toBe(true);
    expect(requestNodeCameraCapture).toHaveBeenCalledWith({
      facing: 'back',
      quality: 0.4,
    });
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      'file://captured-auto.jpg',
      [{ resize: { width: 800 } }],
      expect.objectContaining({
        base64: true,
        compress: 0.4,
        format: 'jpeg',
      }),
    );
  });

  it('rejects unsupported camera.snap formats', async () => {
    const result = await handleCameraSnap({ format: 'png' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PARAMS');
  });

  it('returns USER_CANCELLED when user dismisses capture', async () => {
    (requestNodeCameraCapture as jest.Mock).mockRejectedValueOnce(
      new NodeCameraCaptureError('USER_CANCELLED', 'Camera capture was canceled by the user.'),
    );
    const result = await handleCameraSnap();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('USER_CANCELLED');
  });

  it('rejects unsupported deviceId', async () => {
    const result = await handleCameraSnap({ deviceId: 'camera-1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FEATURE');
  });

  it('returns PERMISSION_DENIED when automatic capture permission is denied', async () => {
    (requestNodeCameraCapture as jest.Mock).mockRejectedValueOnce(
      new NodeCameraCaptureError('PERMISSION_DENIED', 'Camera permission was denied.'),
    );
    const result = await handleCameraSnap();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('handlePhotosLatest', () => {
  it('returns the official photos.latest payload shape', async () => {
    const MediaLibrary = require('expo-media-library/legacy');
    const result = await handlePhotosLatest({ limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as { photos?: Array<Record<string, unknown>> };
    expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledWith({
      first: 1,
      sortBy: [['creationTime', false]],
      mediaType: 'photo',
    });
    expect(payload.photos).toHaveLength(1);
    expect(payload.photos?.[0]?.format).toBe('jpg');
    expect(payload.photos?.[0]?.base64).toBe('latest-base64-jpg-0.85');
    expect(payload.photos?.[0]?.width).toBe(1600);
    expect(payload.photos?.[0]?.height).toBe(1067);
    expect(payload.photos?.[0]?.createdAt).toBe('2026-03-28T08:30:00.000Z');
  });

  it('honors limit, maxWidth and quality params', async () => {
    const MediaLibrary = require('expo-media-library/legacy');
    const ImageManipulator = require('expo-image-manipulator');

    const result = await handlePhotosLatest({ limit: 3, maxWidth: 900, quality: 0.5 });

    expect(result.ok).toBe(true);
    expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledWith({
      first: 3,
      sortBy: [['creationTime', false]],
      mediaType: 'photo',
    });
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      'file://latest.jpg',
      [{ resize: { width: 900 } }],
      expect.objectContaining({
        base64: true,
        compress: 0.5,
        format: 'jpeg',
      }),
    );
  });

  it('returns an empty photos list when the library is empty', async () => {
    const MediaLibrary = require('expo-media-library/legacy');
    MediaLibrary.getAssetsAsync.mockResolvedValueOnce({ assets: [] });
    const result = await handlePhotosLatest({ limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload as { photos?: unknown[] }).photos).toEqual([]);
  });

  it('returns PERMISSION_DENIED when media library is denied', async () => {
    const MediaLibrary = require('expo-media-library/legacy');
    MediaLibrary.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied', granted: false });
    const result = await handlePhotosLatest({ limit: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

// ── clipboard ───────────────────────────────────────────────────────────────

describe('handleClipboardRead', () => {
  it('returns clipboard text', async () => {
    const Clip = require('expo-clipboard');
    Clip.getStringAsync.mockResolvedValueOnce('hello');
    const result = await handleClipboardRead();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload as Record<string, unknown>).text).toBe('hello');
  });
});

describe('handleClipboardWrite', () => {
  it('writes text to clipboard', async () => {
    const Clip = require('expo-clipboard');
    const result = await handleClipboardWrite({ text: 'copied' });
    expect(result.ok).toBe(true);
    expect(Clip.setStringAsync).toHaveBeenCalledWith('copied');
  });

  it('returns INVALID_PARAMS when text is missing', async () => {
    const result = await handleClipboardWrite({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PARAMS');
  });
});

// ── media ───────────────────────────────────────────────────────────────────

describe('handleMediaSave', () => {
  it('saves base64 image to library', async () => {
    const FS = require('expo-file-system/legacy') as Record<string, jest.Mock>;
    const ML = require('expo-media-library/legacy');
    const result = await handleMediaSave({ base64: 'imagedata', filename: 'test.png' });
    expect(result.ok).toBe(true);
    expect(FS.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/test.png',
      'imagedata',
      { encoding: 'base64' },
    );
    expect(ML.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/test.png');
  });

  it('uses default filename when not provided', async () => {
    const FS = require('expo-file-system/legacy') as Record<string, jest.Mock>;
    await handleMediaSave({ base64: 'imagedata' });
    expect(FS.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/clawket_media.png',
      'imagedata',
      { encoding: 'base64' },
    );
  });

  it('returns INVALID_PARAMS when base64 is missing', async () => {
    const result = await handleMediaSave({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PARAMS');
  });

  it('returns PERMISSION_DENIED when media library is denied', async () => {
    const ML = require('expo-media-library/legacy');
    ML.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    const result = await handleMediaSave({ base64: 'imagedata' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});
