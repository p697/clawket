import type {
  AgentAdapter,
  ConnectionDescriptor,
  ConnectionRecord,
} from '@clawket/agent-protocol';

import { bridgeCapabilityStore } from '../registry/bridge-capability-store';
import type { GatewayClient } from '../protocol';
import type { ConnectionAdapterFactoryContext } from '../registry/connection-store';
import { HermesAdapter } from './hermes';
import { OpenClawAdapter } from './openclaw';
import { YouMindSpriteAdapter } from './youmind-sprite';
import { LocalModelAdapter } from './local-model';

type CreateConnectionAdapterOptions = ConnectionAdapterFactoryContext & Readonly<{
  gateway?: GatewayClient;
  onSpriteGreetingSent?: () => void;
}>;

/**
 * The only backend dispatch point in the mobile runtime. UI consumers receive
 * AgentAdapter and capability metadata instead of selecting backend clients.
 */
export function createConnectionAdapter(
  record: Readonly<ConnectionRecord>,
  descriptor: ConnectionDescriptor,
  options: CreateConnectionAdapterOptions = {},
): AgentAdapter {
  const isFreeSlot = descriptor.isFreeSlot;
  switch (record.backendKind) {
    case 'local-model':
      return new LocalModelAdapter(record, { isFreeSlot });
    case 'openclaw':
      return new OpenClawAdapter(record, {
        isFreeSlot,
        gateway: options.gateway,
        onReconnect: options.onReconnect,
        loadBridgeCapabilityMode: () => bridgeCapabilityStore.get(record.id),
        onBridgeCapabilityMode: (mode) => bridgeCapabilityStore.set(record.id, mode),
      });
    case 'hermes':
      return new HermesAdapter(record, {
        isFreeSlot,
        gateway: options.gateway,
        onReconnect: options.onReconnect,
      });
    case 'youmind':
      return new YouMindSpriteAdapter(record, {
        isFreeSlot,
        onGreetingSent: options.onSpriteGreetingSent,
      });
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
