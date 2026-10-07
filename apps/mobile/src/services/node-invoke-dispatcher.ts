import { Platform } from 'react-native';
import {
  HandlerResult,
  NodeInvokeHandler,
  handleDeviceInfo,
  handleDeviceStatus,
  handleSystemNotify,
  handleCameraSnap,
  handlePhotosLatest,
  handleLocationGet,
  handleClipboardRead,
  handleClipboardWrite,
  handleMediaSave,
} from './node-handlers';
import {
  DEFAULT_NODE_CAPABILITY_TOGGLES,
  NodeCapabilityToggles,
  isNodeCommandSupported,
} from './node-capabilities';

const PRIMARY_HANDLERS: Record<string, NodeInvokeHandler> = {
  'device.info': handleDeviceInfo,
  'device.status': handleDeviceStatus,
  'system.notify': handleSystemNotify,
  'camera.snap': handleCameraSnap,
  'photos.latest': handlePhotosLatest,
  'location.get': handleLocationGet,
  'clipboard.read': handleClipboardRead,
  'clipboard.write': handleClipboardWrite,
  'media.save': handleMediaSave,
};

/** All implemented commands; the handshake uses the platform-filtered getEnabledNodeCommands. */
export const NODE_COMMANDS: string[] = Object.keys(PRIMARY_HANDLERS);

/** Capability namespaces derived from command prefixes. */
export const NODE_CAPS: string[] = [...new Set(NODE_COMMANDS.map((cmd) => cmd.split('.')[0]))];

function isCommandAllowedByToggles(command: string, toggles: NodeCapabilityToggles): boolean {
  if (command in toggles) {
    return toggles[command as keyof NodeCapabilityToggles];
  }
  return true;
}

export function getEnabledNodeCommands(toggles: NodeCapabilityToggles = DEFAULT_NODE_CAPABILITY_TOGGLES): string[] {
  return NODE_COMMANDS.filter((command) => isNodeCommandSupported(command, Platform.OS)
    && isCommandAllowedByToggles(command, toggles));
}

export function getEnabledNodeCaps(toggles: NodeCapabilityToggles = DEFAULT_NODE_CAPABILITY_TOGGLES): string[] {
  const commands = getEnabledNodeCommands(toggles);
  return [...new Set(commands.map((cmd) => cmd.split('.')[0]))];
}

/** Dispatch an invoke request to the matching handler. */
export async function dispatchNodeInvoke(
  command: string,
  params: unknown,
  toggles: NodeCapabilityToggles = DEFAULT_NODE_CAPABILITY_TOGGLES,
): Promise<HandlerResult> {
  if (!isNodeCommandSupported(command, Platform.OS)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_FEATURE',
        message: 'On Android, choose photos in the chat attachment picker instead of requesting photos.latest.',
      },
    };
  }
  if (!isCommandAllowedByToggles(command, toggles)) {
    return {
      ok: false,
      error: {
        code: 'CAPABILITY_DISABLED',
        message: `Capability is disabled for command: ${command}`,
      },
    };
  }
  const handler = PRIMARY_HANDLERS[command];
  if (!handler) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command}` },
    };
  }
  try {
    return await handler(params);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { code: 'HANDLER_ERROR', message },
    };
  }
}
