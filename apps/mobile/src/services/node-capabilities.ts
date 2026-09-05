export const NODE_CAPABILITY_COMMANDS = [
  'device.info',
  'device.status',
  'system.notify',
  'camera.snap',
  'photos.latest',
  'location.get',
  'clipboard.read',
  'clipboard.write',
  'media.save',
] as const;

export type NodeCapabilityToggleKey = typeof NODE_CAPABILITY_COMMANDS[number];

export type NodeCapabilityToggles = Record<NodeCapabilityToggleKey, boolean>;

type LegacyNodeCapabilityToggles = {
  camera?: boolean;
  location?: boolean;
  clipboard?: boolean;
  media?: boolean;
  notification?: boolean;
};

export const DEFAULT_NODE_CAPABILITY_TOGGLES: NodeCapabilityToggles = {
  'device.info': true,
  'device.status': true,
  'system.notify': true,
  'camera.snap': true,
  'photos.latest': true,
  'location.get': true,
  'clipboard.read': true,
  'clipboard.write': true,
  'media.save': true,
};

export function shouldStartNodeSidecar(input: Readonly<{
  activeConnectionId: string | null;
  activeState: string;
  nodeEnabled: boolean;
  supportsNodes: boolean;
}>): boolean {
  return Boolean(input.activeConnectionId)
    && input.activeState === 'ready'
    && input.nodeEnabled
    && input.supportsNodes;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeNodeCapabilityToggles(value: unknown): NodeCapabilityToggles {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_NODE_CAPABILITY_TOGGLES };
  }

  const record = value as Record<string, unknown>;
  const legacy = record as LegacyNodeCapabilityToggles;

  const hasCommandKeys = NODE_CAPABILITY_COMMANDS.some((key) => typeof record[key] === 'boolean')
    || typeof record['camera.capture'] === 'boolean'
    || typeof record['camera.pick'] === 'boolean';
  if (hasCommandKeys) {
    return {
      'device.info': readBoolean(record, 'device.info', true),
      'device.status': readBoolean(record, 'device.status', true),
      'system.notify': readBoolean(record, 'system.notify', true),
      'camera.snap': readBoolean(record, 'camera.snap', readBoolean(record, 'camera.capture', true)),
      'photos.latest': readBoolean(record, 'photos.latest', readBoolean(record, 'camera.pick', true)),
      'location.get': readBoolean(record, 'location.get', true),
      'clipboard.read': readBoolean(record, 'clipboard.read', true),
      'clipboard.write': readBoolean(record, 'clipboard.write', true),
      'media.save': readBoolean(record, 'media.save', true),
    };
  }

  return {
    'device.info': readBoolean(record, 'device.info', true),
    'device.status': readBoolean(record, 'device.status', true),
    'system.notify': legacy.notification !== false,
    'camera.snap': legacy.camera !== false,
    'photos.latest': legacy.camera !== false,
    'location.get': legacy.location !== false,
    'clipboard.read': legacy.clipboard !== false,
    'clipboard.write': legacy.clipboard !== false,
    'media.save': legacy.media !== false,
  };
}
