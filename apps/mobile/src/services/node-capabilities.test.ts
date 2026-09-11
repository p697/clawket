import {
  DEFAULT_NODE_CAPABILITY_TOGGLES,
  normalizeNodeCapabilityToggles,
  shouldStartNodeSidecar,
} from './node-capabilities';

describe('normalizeNodeCapabilityToggles', () => {
  it('returns defaults for non-object values', () => {
    expect(normalizeNodeCapabilityToggles(null)).toEqual(DEFAULT_NODE_CAPABILITY_TOGGLES);
  });

  it('preserves command-level toggles', () => {
    expect(normalizeNodeCapabilityToggles({
      'device.info': false,
      'device.status': true,
      'system.notify': false,
      'camera.snap': false,
      'photos.latest': true,
      'location.get': true,
      'clipboard.read': false,
      'clipboard.write': true,
      'media.save': false,
    })).toEqual({
      'device.info': false,
      'device.status': true,
      'system.notify': false,
      'camera.snap': false,
      'photos.latest': true,
      'location.get': true,
      'clipboard.read': false,
      'clipboard.write': true,
      'media.save': false,
    });
  });

  it('migrates old camera command keys to the official names', () => {
    expect(normalizeNodeCapabilityToggles({
      'camera.capture': false,
      'camera.pick': true,
    })).toEqual({
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
  });

  it('migrates legacy family toggles to command-level toggles', () => {
    expect(normalizeNodeCapabilityToggles({
      notification: false,
      camera: false,
      location: true,
      clipboard: false,
      media: true,
    })).toEqual({
      'device.info': true,
      'device.status': true,
      'system.notify': false,
      'camera.snap': false,
      'photos.latest': false,
      'location.get': true,
      'clipboard.read': false,
      'clipboard.write': false,
      'media.save': true,
    });
  });
});

describe('shouldStartNodeSidecar', () => {
  it('waits for the primary adapter handshake before starting the Node role', () => {
    for (const activeState of ['idle', 'connecting', 'reconnecting', 'offline']) {
      expect(shouldStartNodeSidecar({
        activeConnectionId: 'gateway',
        activeState,
        nodeEnabled: true,
        supportsNodes: true,
      })).toBe(false);
    }
    expect(shouldStartNodeSidecar({
      activeConnectionId: 'gateway',
      activeState: 'ready',
      nodeEnabled: true,
      supportsNodes: true,
    })).toBe(true);
  });

  it('still requires an active connection, user opt-in, and Node capability', () => {
    expect(shouldStartNodeSidecar({
      activeConnectionId: null,
      activeState: 'ready',
      nodeEnabled: true,
      supportsNodes: true,
    })).toBe(false);
    expect(shouldStartNodeSidecar({
      activeConnectionId: 'gateway',
      activeState: 'ready',
      nodeEnabled: false,
      supportsNodes: true,
    })).toBe(false);
    expect(shouldStartNodeSidecar({
      activeConnectionId: 'gateway',
      activeState: 'ready',
      nodeEnabled: true,
      supportsNodes: false,
    })).toBe(false);
  });
});
