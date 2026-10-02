import type {
  BackendKind,
  ConnectionDescriptor,
  ConnectionRecord,
} from '@clawket/agent-protocol';

import {
  createConnectionAdapter,
  HermesAdapter,
  OpenClawAdapter,
} from './index';

function record(backendKind: BackendKind): ConnectionRecord {
  const id = `${backendKind}-connection`;
  return {
    id,
    backendKind,
    transportKind: 'local',
    label: backendKind,
    createdAt: 1,
    url: 'ws://127.0.0.1:18789',
    ...(backendKind === 'hermes'
      ? { hermes: { bridgeUrl: 'ws://127.0.0.1:8789/v1/hermes/ws' } }
      : {}),
  };
}

function descriptor(value: ConnectionRecord, isFreeSlot: boolean): ConnectionDescriptor {
  return {
    id: value.id,
    backendKind: value.backendKind,
    transportKind: value.transportKind,
    label: value.label,
    createdAt: value.createdAt,
    isFreeSlot,
  };
}

describe('createConnectionAdapter', () => {
  it.each([
    ['openclaw', OpenClawAdapter],
    ['hermes', HermesAdapter],
  ] as const)('creates the %s adapter at the single backend dispatch point', (kind, Adapter) => {
    const value = record(kind);
    const adapter = createConnectionAdapter(value, descriptor(value, kind === 'hermes'));

    expect(adapter).toBeInstanceOf(Adapter);
    expect(adapter.connection).toMatchObject({
      id: value.id,
      backendKind: kind,
      isFreeSlot: kind === 'hermes',
    });

    adapter.disconnect();
  });
});
