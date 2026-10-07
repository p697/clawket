import {
  dispatchNodeInvoke,
  getEnabledNodeCaps,
  getEnabledNodeCommands,
  NODE_COMMANDS,
  NODE_CAPS,
} from './node-invoke-dispatcher';
import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';

const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; });

it('excludes Android latest-photo reads from commands and namespaces even with saved toggles enabled', async () => {
  Platform.OS = 'android';
  jest.clearAllMocks();
  expect(getEnabledNodeCommands()).not.toContain('photos.latest');
  expect(getEnabledNodeCaps()).not.toContain('photos');
  expect(getEnabledNodeCommands()).toEqual(expect.arrayContaining(['camera.snap', 'media.save', 'device.info']));
  await expect(dispatchNodeInvoke('photos.latest', { limit: 1 })).resolves.toMatchObject({
    ok: false, error: { code: 'UNSUPPORTED_FEATURE' },
  });
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(MediaLibrary.getAssetsAsync).not.toHaveBeenCalled();
});

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

describe('NODE_COMMANDS', () => {
  it('contains all expected commands', () => {
    const expected = [
      'device.info',
      'device.status',
      'system.notify',
      'camera.snap',
      'photos.latest',
      'location.get',
      'clipboard.read',
      'clipboard.write',
      'media.save',
    ];
    for (const cmd of expected) {
      expect(NODE_COMMANDS).toContain(cmd);
    }
    expect(NODE_COMMANDS).toHaveLength(expected.length);
  });
});

describe('NODE_CAPS', () => {
  it('contains unique capability namespaces', () => {
    expect(NODE_CAPS).toContain('device');
    expect(NODE_CAPS).toContain('system');
    expect(NODE_CAPS).toContain('camera');
    expect(NODE_CAPS).toContain('location');
    expect(NODE_CAPS).toContain('clipboard');
    expect(NODE_CAPS).toContain('media');
    // No duplicates
    expect(new Set(NODE_CAPS).size).toBe(NODE_CAPS.length);
  });
});

describe('dispatchNodeInvoke', () => {
  it('routes device.info to handler', async () => {
    const result = await dispatchNodeInvoke('device.info', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as Record<string, unknown>;
      expect(payload.platform).toBeDefined();
    }
  });

  it('routes device.status to handler', async () => {
    const result = await dispatchNodeInvoke('device.status', {});
    expect(result.ok).toBe(true);
  });

  it('routes system.notify to handler', async () => {
    const result = await dispatchNodeInvoke('system.notify', { title: 'Test' });
    expect(result.ok).toBe(true);
  });

  it('routes camera.snap to handler', async () => {
    const result = await dispatchNodeInvoke('camera.snap', {});
    expect(result.ok).toBe(true);
  });

  it('routes photos.latest to handler', async () => {
    const result = await dispatchNodeInvoke('photos.latest', { limit: 1 });
    expect(result.ok).toBe(true);
  });

  it('routes clipboard.read to handler', async () => {
    const result = await dispatchNodeInvoke('clipboard.read', {});
    expect(result.ok).toBe(true);
  });

  it('routes location.get to handler', async () => {
    const result = await dispatchNodeInvoke('location.get', {});
    expect(result.ok).toBe(true);
  });

  it('routes media.save to handler', async () => {
    const result = await dispatchNodeInvoke('media.save', { base64: 'test' });
    expect(result.ok).toBe(true);
  });

  it('returns UNKNOWN_COMMAND for unregistered commands', async () => {
    const result = await dispatchNodeInvoke('foo.bar', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_COMMAND');
      expect(result.error.message).toContain('foo.bar');
    }
  });

  it('rejects legacy camera command names', async () => {
    const captureResult = await dispatchNodeInvoke('camera.capture', {});
    expect(captureResult.ok).toBe(false);
    if (captureResult.ok) return;
    expect(captureResult.error.code).toBe('UNKNOWN_COMMAND');

    const pickResult = await dispatchNodeInvoke('camera.pick', {});
    expect(pickResult.ok).toBe(false);
    if (pickResult.ok) return;
    expect(pickResult.error.code).toBe('UNKNOWN_COMMAND');
  });

  it('returns CAPABILITY_DISABLED when capability toggle is off', async () => {
    const result = await dispatchNodeInvoke('camera.snap', {}, {
      'device.info': true,
      'device.status': true,
      'system.notify': true,
      'camera.snap': false,
      'photos.latest': true,
      'location.get': true,
      'clipboard.read': true,
      'clipboard.write': true,
      'media.save': true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAPABILITY_DISABLED');
  });
});

describe('capability filtering', () => {
  it('filters commands by toggles', () => {
    const commands = getEnabledNodeCommands({
      'device.info': true,
      'device.status': true,
      'system.notify': true,
      'camera.snap': false,
      'photos.latest': true,
      'location.get': true,
      'clipboard.read': true,
      'clipboard.write': true,
      'media.save': false,
    });
    expect(commands).not.toContain('camera.snap');
    expect(commands).toContain('photos.latest');
    expect(commands).not.toContain('media.save');
    expect(commands).toContain('location.get');
    expect(commands).toContain('device.info');
  });

  it('filters caps by toggles', () => {
    const caps = getEnabledNodeCaps({
      'device.info': true,
      'device.status': true,
      'system.notify': true,
      'camera.snap': false,
      'photos.latest': false,
      'location.get': false,
      'clipboard.read': true,
      'clipboard.write': true,
      'media.save': true,
    });
    expect(caps).not.toContain('camera');
    expect(caps).not.toContain('location');
    expect(caps).toContain('clipboard');
    expect(caps).toContain('media');
    expect(caps).toContain('device');
  });

  it('filters notification command independently from system namespace', () => {
    const commands = getEnabledNodeCommands({
      'device.info': true,
      'device.status': true,
      'system.notify': false,
      'camera.snap': true,
      'photos.latest': true,
      'location.get': true,
      'clipboard.read': true,
      'clipboard.write': true,
      'media.save': true,
    });
    expect(commands).not.toContain('system.notify');
  });
});
