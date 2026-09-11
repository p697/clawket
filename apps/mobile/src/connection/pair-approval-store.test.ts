import { CAPABILITY_MATRIX, type AgentAdapter, type ConnectionState, type SessionUpdate } from '@clawket/agent-protocol';
import {
  ConnectionPairApprovalStore,
  getConnectionPairApprovalStore,
} from './pair-approval-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createAdapter() {
  const listeners = {
    update: new Set<(update: SessionUpdate) => void>(),
    state: new Set<(state: ConnectionState) => void>(),
    sessions: new Set<(sessions: never[]) => void>(),
  };
  const listDevices = jest.fn(async () => ({
    pending: [{
      requestId: 'device-hydrated',
      deviceId: 'phone-1',
      displayName: 'Hydrated phone',
      platform: 'ios',
      requestedAtMs: 20,
    }],
    paired: [],
  }));
  const listNodePairRequests = jest.fn(async () => ({
    pending: [{
      requestId: 'node-hydrated',
      nodeId: 'node-1',
      displayName: 'Hydrated node',
      requestedAtMs: 10,
    }],
    nodes: [],
  }));
  const adapter = {
    connection: {
      id: 'connection-1',
      backendKind: 'openclaw' as const,
      transportKind: 'relay' as const,
      label: 'OpenClaw',
      createdAt: 1,
      isFreeSlot: false,
    },
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    state: 'ready' as const,
    management: {
      devices: { list: listDevices },
      nodes: { pairRequests: listNodePairRequests },
    },
    on: jest.fn((event: keyof typeof listeners, listener: (...args: never[]) => void) => {
      listeners[event].add(listener as never);
      return () => listeners[event].delete(listener as never);
    }),
    emitUpdate(update: SessionUpdate) {
      for (const listener of listeners.update) listener(update);
    },
    emitState(state: ConnectionState) {
      for (const listener of listeners.state) listener(state);
    },
  } as unknown as AgentAdapter & Readonly<{
    emitUpdate(update: SessionUpdate): void;
    emitState(state: ConnectionState): void;
  }>;
  return { adapter, listDevices, listNodePairRequests };
}

describe('ConnectionPairApprovalStore', () => {
  it('hydrates both targets on mount and shares one connection projection', async () => {
    const { adapter, listDevices, listNodePairRequests } = createAdapter();
    const first = getConnectionPairApprovalStore(adapter);
    const second = getConnectionPairApprovalStore(adapter);

    expect(second).toBe(first);
    expect(adapter.on).toHaveBeenCalledTimes(2);
    await first.refresh();

    expect(listDevices).toHaveBeenCalledTimes(1);
    expect(listNodePairRequests).toHaveBeenCalledTimes(1);
    expect(first.getSnapshot()).toEqual([
      expect.objectContaining({ id: 'device-hydrated', target: 'device', status: 'pending' }),
      expect.objectContaining({ id: 'node-hydrated', target: 'node', status: 'pending' }),
    ]);
  });

  it('deduplicates events and resolves only the exact target and request id', () => {
    const { adapter } = createAdapter();
    const store = new ConnectionPairApprovalStore(adapter, () => 99);
    const approval = {
      kind: 'pair' as const,
      id: 'same-id',
      target: 'device' as const,
      displayName: 'Phone',
      platform: null,
      receivedAtMs: 42,
    };
    const request: SessionUpdate = { type: 'approval_requested', approval };

    adapter.emitUpdate(request);
    adapter.emitUpdate(request);
    adapter.emitUpdate({
      ...request,
      approval: { ...approval, target: 'node' },
    });
    expect(store.getSnapshot()).toHaveLength(2);

    adapter.emitUpdate({
      type: 'approval_resolved',
      approvalId: 'same-id',
      decision: 'approved',
      kind: 'pair',
      target: 'device',
    });
    expect(store.get('same-id', 'device')?.status).toBe('allowed');
    expect(store.get('same-id', 'node')?.status).toBe('pending');
  });

  it('refreshes the authoritative pending snapshot after reconciliation', async () => {
    const { adapter, listDevices } = createAdapter();
    const store = new ConnectionPairApprovalStore(adapter);
    await store.refresh();
    listDevices.mockResolvedValueOnce({ pending: [], paired: [] });

    adapter.emitUpdate({
      type: 'history_reconciled',
      sessionKey: 'agent:main:other',
      history: { key: 'agent:main:other', messages: [], hasActiveRun: false },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(listDevices).toHaveBeenCalledTimes(2);
    expect(store.get('device-hydrated', 'device')).toBeUndefined();
  });

  it('tombstones an unknown resolution before a two-target refresh can revive it', async () => {
    const { adapter, listDevices, listNodePairRequests } = createAdapter();
    const devices = deferred<Awaited<ReturnType<typeof listDevices>>>();
    const nodes = deferred<Awaited<ReturnType<typeof listNodePairRequests>>>();
    listDevices.mockReturnValueOnce(devices.promise);
    listNodePairRequests.mockReturnValueOnce(nodes.promise);
    const store = new ConnectionPairApprovalStore(adapter);
    const refresh = store.refresh();

    devices.resolve({
      pending: [{
        requestId: 'already-resolved',
        deviceId: 'phone-2',
        displayName: 'Resolved phone',
        platform: 'ios',
        requestedAtMs: 30,
      }],
      paired: [],
    });
    await Promise.resolve();
    adapter.emitUpdate({
      type: 'approval_resolved',
      approvalId: 'already-resolved',
      decision: 'approved',
      kind: 'pair',
      target: 'device',
    });
    nodes.resolve({ pending: [], nodes: [] });
    await refresh;
    await Promise.resolve();
    await Promise.resolve();

    expect(store.get('already-resolved', 'device')).toBeUndefined();
    adapter.emitUpdate({
      type: 'approval_requested',
      approval: {
        kind: 'pair',
        id: 'already-resolved',
        target: 'device',
        displayName: 'Late event',
        platform: 'ios',
        receivedAtMs: 31,
      },
    });
    expect(store.get('already-resolved', 'device')).toBeUndefined();
  });

  it('bounds resolution tombstones while retaining the newest decisions', () => {
    const { adapter } = createAdapter();
    const store = new ConnectionPairApprovalStore(adapter);
    for (let index = 0; index <= 100; index += 1) {
      store.recordResolution(`resolved-${index}`, 'device', 'approved');
    }

    store.recordRequest({
      kind: 'pair',
      id: 'resolved-0',
      target: 'device',
      displayName: 'Oldest evicted tombstone',
      platform: null,
      receivedAtMs: 1,
    });
    store.recordRequest({
      kind: 'pair',
      id: 'resolved-100',
      target: 'device',
      displayName: 'Newest retained tombstone',
      platform: null,
      receivedAtMs: 2,
    });

    expect(store.get('resolved-0', 'device')?.status).toBe('pending');
    expect(store.get('resolved-100', 'device')).toBeUndefined();
  });

  it('keeps an in-flight decision through an absent refresh and restores failed retries', async () => {
    const { adapter, listDevices, listNodePairRequests } = createAdapter();
    const store = new ConnectionPairApprovalStore(adapter);
    await store.refresh();
    expect(store.beginResolution('device-hydrated', 'device')).toBe(true);
    expect(store.beginResolution('device-hydrated', 'device')).toBe(false);
    listDevices.mockResolvedValueOnce({ pending: [], paired: [] });
    listNodePairRequests.mockResolvedValueOnce({ pending: [], nodes: [] });

    await store.refresh();
    expect(store.get('device-hydrated', 'device')).toMatchObject({
      status: 'pending',
      resolving: true,
    });
    expect(store.completeResolution('device-hydrated', 'device', 'approve')).toMatchObject({
      status: 'allowed',
      resolving: false,
      resolutionError: false,
    });

    store.recordRequest({
      kind: 'pair',
      id: 'retry-request',
      target: 'device',
      displayName: 'Retry phone',
      platform: 'ios',
      receivedAtMs: 40,
    });
    expect(store.beginResolution('retry-request', 'device')).toBe(true);
    store.failResolution('retry-request', 'device');
    expect(store.get('retry-request', 'device')).toMatchObject({
      status: 'pending',
      resolving: false,
      resolutionError: true,
    });
    expect(store.beginResolution('retry-request', 'device')).toBe(true);
    expect(store.get('retry-request', 'device')).toMatchObject({
      resolving: true,
      resolutionError: false,
    });
  });
});
