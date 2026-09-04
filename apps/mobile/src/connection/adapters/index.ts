import type {
  AgentAdapter,
  ConnectionDescriptor,
  ConnectionRecord,
} from '@clawket/agent-protocol';

import { bridgeCapabilityStore } from '../registry/bridge-capability-store';
import { HermesAdapter } from './hermes';
import { OpenClawAdapter } from './openclaw';
import { YouMindSpriteAdapter } from './youmind-sprite';

/**
 * The only backend dispatch point in the mobile runtime. UI consumers receive
 * AgentAdapter and capability metadata instead of selecting backend clients.
 */
export function createConnectionAdapter(
  record: Readonly<ConnectionRecord>,
  descriptor: ConnectionDescriptor,
): AgentAdapter {
  const isFreeSlot = descriptor.isFreeSlot;
  switch (record.backendKind) {
    case 'openclaw':
      return new OpenClawAdapter(record, {
        isFreeSlot,
        loadBridgeCapabilityMode: () => bridgeCapabilityStore.get(record.id),
        onBridgeCapabilityMode: (mode) => bridgeCapabilityStore.set(record.id, mode),
      });
    case 'hermes':
      return new HermesAdapter(record, { isFreeSlot });
    case 'youmind':
      return new YouMindSpriteAdapter(record, { isFreeSlot });
    default:
      return assertNever(record.backendKind);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported backend kind: ${String(value)}`);
}

export { HermesAdapter } from './hermes';
export { OpenClawAdapter } from './openclaw';
export { YouMindSpriteAdapter } from './youmind-sprite';
