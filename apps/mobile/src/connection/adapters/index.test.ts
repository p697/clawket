import type {
  BackendKind,
  ConnectionDescriptor,
  ConnectionRecord,
} from '@clawket/agent-protocol';

import {
  createConnectionAdapter,
  HermesAdapter,
  OpenClawAdapter,
  YouMindSpriteAdapter,
} from './index';

function record(backendKind: BackendKind): ConnectionRecord {
  const id = `${backendKind}-connection`;
  return {
    id,
    backendKind,
    transportKind: backendKind === 'youmind' ? 'https' : 'local',
    label: backendKind,
    createdAt: 1,
    url: backendKind === 'youmind' ? 'https://youmind.example' : 'ws://127.0.0.1:18789',
    ...(backendKind === 'youmind'
      ? { youmind: { authScopeKey: 'test:user' } }
      : {}),
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
    ['youmind', YouMindSpriteAdapter],
  ] as const)('creates the %s adapter at the single backend dispatch point', (kind, Adapter) => {
    const value = record(kind);
    const adapter = createConnectionAdapter(value, descriptor(value, kind === 'youmind'));

    expect(adapter).toBeInstanceOf(Adapter);
    expect(adapter.connection).toMatchObject({
      id: value.id,
      backendKind: kind,
      isFreeSlot: kind === 'youmind',
    });

    adapter.disconnect();
  });
});
