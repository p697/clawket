import {
  createMockAdapter,
  type AgentAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type SessionDescriptor,
} from '@clawket/agent-protocol';

import {
  ConnectionStore,
  type LegacyConnectionStorage,
  type SecureConnectionStorage,
} from './registry/connection-store';
import { RosterCache, type RosterCacheStorage } from './registry/roster-cache';
import { UnreadWatermarks } from './registry/unread-watermarks';
import {
  ConnectionCoordinator,
  type ConnectionCoordinatorOptions,
  type ConnectionTelemetry,
} from './index';
import { createConnectionAdapter } from './adapters';

class MemorySecureStorage implements SecureConnectionStorage {
  private readonly values = new Map<string, string>();
  failNextCurrentWrite = false;

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (key === 'clawket.connectionRegistry.v1' && this.failNextCurrentWrite) {
      this.failNextCurrentWrite = false;
      throw new Error('secure write failed');
    }
    this.values.set(key, value);
  }
}

class MemoryDashboardStorage implements RosterCacheStorage {
  private readonly values = new Map<string, unknown>();

  async getDashboardCache<T>(scopeKey: string): Promise<T | null> {
    return (this.values.get(scopeKey) as T | undefined) ?? null;
  }

  async setDashboardCache<T>(scopeKey: string, entry: T): Promise<void> {
    this.values.set(scopeKey, entry);
  }
}

const legacyStorage: LegacyConnectionStorage = {
  async readLegacyGatewayConfigsState() {
    return { activeId: null, configs: [] };
  },
  async migrateLegacyYouMindState() {},
};

function connectionInput(id: string) {
  return {
    id,
    createdAt: id === 'alpha' ? 1 : 2,
    backendKind: 'openclaw' as const,
    transportKind: 'relay' as const,
    label: id,
    environment: 'preview' as const,
    url: `wss://${id}.example/ws`,
    relay: {
      serverUrl: `https://${id}.example`,
      gatewayId: `gw_${id}`,
      clientToken: `gct_${id}`,
    },
  };
}

function agent(connectionId: string): AgentDescriptor {
  return {
    connectionId,
    agentId: 'main',
    name: `${connectionId} agent`,
    isMain: true,
    mainSessionKey: `agent:main:main`,
  };
}

function session(connectionId: string, updatedAt: number): SessionDescriptor {
  return {
    connectionId,
    agentId: 'main',
    key: 'agent:main:main',
    kind: 'main',
    title: `${connectionId} session`,
    updatedAt,
    preview: `${connectionId} preview`,
    hasActiveRun: false,
    attention: null,
    allowedActions: { rename: true, reset: true, delete: false, pin: true },
  };
}

async function createStore(): Promise<ConnectionStore> {
  return (await createStoreHarness()).store;
}

async function createStoreHarness(): Promise<{
  secureStorage: MemorySecureStorage;
  store: ConnectionStore;
}> {
  const secureStorage = new MemorySecureStorage();
  const store = new ConnectionStore({
    secureStorage,
    legacyStorage,
    now: () => 100,
    random: () => 0.5,
  });
  await store.load();
  await store.add(connectionInput('alpha'));
  await store.add(connectionInput('beta'));
  return { secureStorage, store };
}

function instrumentAdapter(
  descriptor: ConnectionDescriptor,
  events: string[],
): AgentAdapter {
  const adapter = createMockAdapter({
    connection: descriptor,
    agents: [agent(descriptor.id)],
    sessions: [session(descriptor.id, descriptor.id === 'alpha' ? 20 : 30)],
  });
  const connect = adapter.connect.bind(adapter);
  const disconnect = adapter.disconnect.bind(adapter);
  adapter.connect = async () => {
    events.push(`connect:${descriptor.id}`);
    await connect();
  };
  adapter.disconnect = () => {
    events.push(`disconnect:${descriptor.id}`);
    disconnect();
  };
  Object.assign(adapter, {
    getConnectionRuntimeMetadata: () => ({
      bridgeVersion: `bridge-${descriptor.id}`,
      bridgeCapabilities: ['bridge.capabilities.v2', `backend.${descriptor.backendKind}.v2`],
    }),
  });
  return adapter;
}

async function createHarness(
  withFactory = true,
  maintenance: Pick<
    ConnectionCoordinatorOptions,
    'rosterRefreshIntervalMs' | 'hermesProbeIntervalMs'
  > = {},
  runtimeOptions: Pick<
    ConnectionCoordinatorOptions,
    'chatCache' | 'credentialStore' | 'sessionPreferences'
  > = {},
) {
  const { secureStorage, store } = await createStoreHarness();
  const dashboardStorage = new MemoryDashboardStorage();
  const cache = new RosterCache({ storage: dashboardStorage, now: () => 50 });
  const watermarks = new UnreadWatermarks({ storage: dashboardStorage, now: () => 50 });
  const events: string[] = [];
  const adapters: AgentAdapter[] = [];
  const factory = (_record: unknown, descriptor: ConnectionDescriptor): AgentAdapter => {
    const adapter = instrumentAdapter(descriptor, events);
    adapters.push(adapter);
    return adapter;
  };
  const coordinator = new ConnectionCoordinator({
    store,
    cache,
    watermarks,
    ...(withFactory ? { adapterFactory: factory } : {}),
    now: () => 50,
    ...maintenance,
    ...runtimeOptions,
  });
  return { adapters, cache, coordinator, events, factory, secureStorage, store, watermarks };
}

async function createMaintenanceHarness(
  backendKind: 'openclaw' | 'hermes',
  maintenance: Pick<
    ConnectionCoordinatorOptions,
    'rosterRefreshIntervalMs' | 'hermesProbeIntervalMs'
  >,
) {
  const secureStorage = new MemorySecureStorage();
  const store = new ConnectionStore({ secureStorage, legacyStorage });
  await store.load();
  await store.add({ ...connectionInput('alpha'), backendKind });
  const dashboardStorage = new MemoryDashboardStorage();
  let adapter: AgentAdapter | null = null;
  const coordinator = new ConnectionCoordinator({
    store,
    cache: new RosterCache({ storage: dashboardStorage }),
    watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
    adapterFactory: (_record, descriptor) => {
      adapter = instrumentAdapter(descriptor, []);
      return adapter;
    },
    ...maintenance,
  });
  return {
    coordinator,
    getAdapter(): AgentAdapter {
      if (!adapter) throw new Error('Adapter has not been created');
      return adapter;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('ConnectionCoordinator', () => {
  it('reads isolated credential records for trusted runtime consumers', async () => {
    const harness = await createHarness(false);
    await harness.store.update('alpha', {
      auth: { token: 'alpha-runtime-token', password: 'alpha-runtime-password' },
    });

    const first = await harness.coordinator.getRuntimeConnectionRecord('alpha');
    expect(first.auth).toEqual({
      token: 'alpha-runtime-token',
      password: 'alpha-runtime-password',
    });
    expect(JSON.stringify(harness.coordinator.getSnapshot())).not.toContain('alpha-runtime-token');

    first.auth!.token = 'mutated-outside-coordinator';
    const second = await harness.coordinator.getRuntimeConnectionRecord('alpha');
    expect(second.auth?.token).toBe('alpha-runtime-token');
    await expect(
      harness.coordinator.getRuntimeConnectionRecord('missing-runtime-record'),
    ).rejects.toBeInstanceOf(Error);
  });

  it('keeps real adapter credentials out of the published runtime snapshot', async () => {
    const { store } = await createStoreHarness();
    await store.update('alpha', {
      auth: {
        token: 'snapshot-auth-secret',
        password: 'snapshot-password-secret',
      },
      bootstrap: {
        token: 'snapshot-bootstrap-secret',
        strategy: 'legacy-bound',
      },
      relay: {
        serverUrl: 'https://alpha.example',
        gatewayId: 'gw_alpha',
        clientToken: 'snapshot-relay-secret',
      },
    });
    const dashboardStorage = new MemoryDashboardStorage();
    const coordinator = new ConnectionCoordinator({
      store,
      cache: new RosterCache({ storage: dashboardStorage }),
      watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
      chatCache: { clearConnection: async () => undefined },
      adapterFactory: (record, descriptor) => {
        const adapter = createConnectionAdapter(record, descriptor);
        adapter.connect = async () => undefined;
        adapter.listAgents = async () => [];
        adapter.listSessions = async () => [];
        return adapter;
      },
    });

    await coordinator.start();

    const serialized = JSON.stringify(coordinator.getSnapshot());
    expect(serialized).not.toContain('snapshot-auth-secret');
    expect(serialized).not.toContain('snapshot-password-secret');
    expect(serialized).not.toContain('snapshot-bootstrap-secret');
    expect(serialized).not.toContain('snapshot-relay-secret');
    expect(coordinator.getSnapshot().activeAdapter?.connection.id).toBe('alpha');
    await coordinator.stop();
  });

  it('connects only the active adapter and serves inactive roster rows from cache', async () => {
    const harness = await createHarness();
    await harness.cache.set('beta', [agent('beta')], [session('beta', 30)]);

    await harness.coordinator.start();

    const snapshot = harness.coordinator.getSnapshot();
    expect(harness.events).toEqual(['connect:alpha']);
    expect(snapshot.initialized).toBe(true);
    expect(snapshot.activeConnectionId).toBe('alpha');
    expect(snapshot.activeAdapter?.connection.id).toBe('alpha');
    expect(snapshot.activeState).toBe('ready');
    expect(snapshot.roster.find((group) => group.connection.id === 'alpha')?.source).toBe('live');
    expect(snapshot.roster.find((group) => group.connection.id === 'beta')?.source).toBe('cache');
    expect(snapshot.roster.find((group) => group.connection.id === 'alpha')?.unreadCount).toBe(1);
    expect(snapshot.roster.find((group) => group.connection.id === 'beta')?.unreadCount).toBe(0);
    expect(snapshot.connectionDetails.beta).toEqual({
      lastReadyAt: 50,
      bridgeVersion: null,
      bridgeCapabilities: [],
    });
  });

  it('projects handshake metadata and retains last-ready evidence while offline', async () => {
    const harness = await createHarness();

    await harness.coordinator.start();

    expect(harness.coordinator.getSnapshot().connectionDetails.alpha).toEqual({
      lastReadyAt: 50,
      bridgeVersion: 'bridge-alpha',
      bridgeCapabilities: ['bridge.capabilities.v2', 'backend.openclaw.v2'],
    });

    harness.adapters[0]?.disconnect();

    expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'idle' });
    expect(harness.coordinator.getSnapshot().connectionDetails.alpha).toEqual({
      lastReadyAt: 50,
      bridgeVersion: 'bridge-alpha',
      bridgeCapabilities: ['bridge.capabilities.v2', 'backend.openclaw.v2'],
    });
  });

  it('disconnects the old adapter before connecting the newly active one', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();

    await harness.coordinator.activate('beta');

    expect(harness.events).toEqual([
      'connect:alpha',
      'disconnect:alpha',
      'connect:beta',
    ]);
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      activeConnectionId: 'beta',
      activeState: 'ready',
      switching: false,
    });
    expect(harness.adapters.filter((adapter) => adapter.state === 'ready')).toHaveLength(1);
    expect(harness.adapters.find((adapter) => adapter.connection.id === 'alpha')?.state).toBe('idle');
  });

  it('disposes an adapter lifecycle when switching instead of leaving protocol listeners behind', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    const first = harness.adapters[0] as AgentAdapter & { dispose?: () => void };
    first.dispose = jest.fn(() => first.disconnect());

    await harness.coordinator.activate('beta');

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(harness.events).toEqual([
      'connect:alpha',
      'disconnect:alpha',
      'connect:beta',
    ]);
  });

  it('does not reconnect when the active id is selected again', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();

    await harness.coordinator.activate('alpha');

    expect(harness.events).toEqual(['connect:alpha']);
  });

  it('reconnects an active pairing after upserting its stable Relay identity', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();

    const saved = await harness.coordinator.upsertConnection({
      ...connectionInput('alpha'),
      label: 'Updated alpha',
      url: 'wss://alpha-new.example/ws',
      relay: {
        ...connectionInput('alpha').relay,
        clientToken: 'gct_alpha_new',
      },
    });

    expect(saved).toMatchObject({
      created: false,
      connection: { id: 'alpha', label: 'alpha' },
    });
    expect(harness.events).toEqual([
      'connect:alpha',
      'disconnect:alpha',
      'connect:alpha',
    ]);
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      activeConnectionId: 'alpha',
      activeState: 'ready',
    });
  });

  it('disconnects an in-flight adapter before a rapid switch can connect another', async () => {
    const store = await createStore();
    const dashboardStorage = new MemoryDashboardStorage();
    const cache = new RosterCache({ storage: dashboardStorage });
    const watermarks = new UnreadWatermarks({ storage: dashboardStorage });
    const events: string[] = [];
    let rejectAlpha: ((error: Error) => void) | null = null;
    const adapters: AgentAdapter[] = [];
    const coordinator = new ConnectionCoordinator({
      store,
      cache,
      watermarks,
      adapterFactory: (_record, descriptor) => {
        const adapter = instrumentAdapter(descriptor, events);
        if (descriptor.id === 'alpha') {
          adapter.connect = () => {
            events.push('pending:alpha');
            return new Promise<void>((_resolve, reject) => {
              rejectAlpha = reject;
            });
          };
          const disconnect = adapter.disconnect.bind(adapter);
          adapter.disconnect = () => {
            disconnect();
            rejectAlpha?.(new Error('superseded'));
            rejectAlpha = null;
          };
        }
        adapters.push(adapter);
        return adapter;
      },
    });

    const started = coordinator.start();
    for (let attempt = 0; attempt < 10 && !events.includes('pending:alpha'); attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(events).toContain('pending:alpha');

    await Promise.all([started, coordinator.activate('beta')]);

    expect(events.indexOf('disconnect:alpha')).toBeLessThan(events.indexOf('connect:beta'));
    expect(adapters.filter((adapter) => adapter.state === 'ready')).toHaveLength(1);
    expect(coordinator.getSnapshot().activeConnectionId).toBe('beta');
  });

  it('keeps the active adapter connected when removing its record fails', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    harness.secureStorage.failNextCurrentWrite = true;

    await expect(harness.coordinator.removeConnection('alpha')).rejects.toThrow('secure write failed');

    expect(harness.coordinator.getAdapter('alpha')?.state).toBe('ready');
    expect(harness.events).toEqual(['connect:alpha']);
  });

  it('clears only the removed connection chat cache after the registry commit', async () => {
    const clearConnection = jest.fn(async (_connectionId: string) => undefined);
    const harness = await createHarness(true, {}, {
      chatCache: { clearConnection },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(clearConnection).toHaveBeenCalledTimes(1);
    expect(clearConnection).toHaveBeenCalledWith('beta');
    expect(harness.store.getSnapshot().connections.map((connection) => connection.id)).toEqual([
      'alpha',
    ]);
    expect(harness.coordinator.getSnapshot().error).toBeNull();
  });

  it('clears only the removed connection session preferences after the registry commit', async () => {
    const clearConnection = jest.fn(async (_connectionId: string) => undefined);
    const harness = await createHarness(true, {}, {
      sessionPreferences: { clearConnection },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(clearConnection).toHaveBeenCalledTimes(1);
    expect(clearConnection).toHaveBeenCalledWith('beta');
    expect(harness.store.getSnapshot().connections.map((connection) => connection.id)).toEqual([
      'alpha',
    ]);
    expect(harness.coordinator.getSnapshot().error).toBeNull();
  });

  it('clears operator and node device tokens only for the removed connection scope', async () => {
    const deleteDeviceToken = jest.fn(async () => undefined);
    const harness = await createHarness(true, {}, {
      credentialStore: {
        getIdentity: async () => ({
          deviceId: 'device-1',
          publicKeyHex: 'public',
          secretKeyHex: 'secret',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        deleteDeviceToken,
      },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(deleteDeviceToken).toHaveBeenCalledTimes(2);
    expect(deleteDeviceToken).toHaveBeenNthCalledWith(1, 'device-1', {
      serverUrl: 'https://beta.example',
      gatewayId: 'gw_beta',
    });
    expect(deleteDeviceToken).toHaveBeenNthCalledWith(2, 'device-1', {
      serverUrl: 'https://beta.example',
      gatewayId: 'gw_beta',
      role: 'node',
    });
  });

  it('clears both device-token roles using the normalized direct Gateway URL', async () => {
    const deleteDeviceToken = jest.fn(async () => undefined);
    const harness = await createHarness(true, {}, {
      credentialStore: {
        getIdentity: async () => ({
          deviceId: 'device-1',
          publicKeyHex: 'public',
          secretKeyHex: 'secret',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        deleteDeviceToken,
      },
    });
    await harness.store.update('beta', {
      transportKind: 'local',
      url: 'wss://beta-gateway.example/ws///',
      relay: null,
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(deleteDeviceToken).toHaveBeenNthCalledWith(1, 'device-1', {
      gatewayUrl: 'wss://beta-gateway.example/ws',
    });
    expect(deleteDeviceToken).toHaveBeenNthCalledWith(2, 'device-1', {
      gatewayUrl: 'wss://beta-gateway.example/ws',
      role: 'node',
    });
  });

  it('keeps a committed removal and reports device-token cleanup failure', async () => {
    const harness = await createHarness(true, {}, {
      credentialStore: {
        getIdentity: async () => ({
          deviceId: 'device-1',
          publicKeyHex: 'public',
          secretKeyHex: 'secret',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        deleteDeviceToken: async () => {
          throw new Error('keychain unavailable');
        },
      },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('alpha')).resolves.toBe(true);

    expect(harness.store.getSnapshot().connections.map((connection) => connection.id)).toEqual([
      'beta',
    ]);
    expect(harness.coordinator.getSnapshot().error).toMatchObject({
      operation: 'remove',
      connectionId: 'alpha',
    });
  });

  it('keeps a committed removal and reports local cache cleanup failure', async () => {
    const clearConnection = jest.fn(async () => {
      throw new Error('cache unavailable');
    });
    const harness = await createHarness(true, {}, {
      chatCache: { clearConnection },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('alpha')).resolves.toBe(true);

    expect(clearConnection).toHaveBeenCalledWith('alpha');
    expect(harness.store.getSnapshot()).toMatchObject({
      activeConnectionId: 'beta',
      connections: [expect.objectContaining({ id: 'beta' })],
    });
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      activeConnectionId: 'beta',
      activeState: 'ready',
      error: {
        operation: 'remove',
        connectionId: 'alpha',
        message: 'Connection data was removed, but some local data cleanup failed.',
      },
    });
  });

  it('can load descriptors and cache before the adapter factory is configured', async () => {
    const harness = await createHarness(false);
    await harness.cache.set('beta', [agent('beta')], [session('beta', 30)]);
    await harness.coordinator.start();

    expect(harness.coordinator.getSnapshot()).toMatchObject({
      initialized: true,
      activeConnectionId: 'alpha',
      activeAdapter: null,
    });
    expect(harness.coordinator.getSnapshot().roster).toHaveLength(2);

    harness.coordinator.setAdapterFactory(harness.factory);
    await harness.coordinator.whenIdle();

    expect(harness.events).toEqual(['connect:alpha']);
    expect(harness.coordinator.getAdapter('alpha')?.state).toBe('ready');
    expect(harness.coordinator.getAdapter('beta')).toBeNull();
  });

  it('reconciles a missing active adapter when retry probes after factory failure', async () => {
    const harness = await createHarness(false);
    let factoryAttempts = 0;
    harness.coordinator.setAdapterFactory((_record, descriptor) => {
      factoryAttempts += 1;
      if (factoryAttempts === 1) throw new Error('factory unavailable');
      return instrumentAdapter(descriptor, harness.events);
    });

    await harness.coordinator.start();
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      activeConnectionId: 'alpha',
      activeAdapter: null,
      error: { operation: 'connect', connectionId: 'alpha' },
    });

    await expect(harness.coordinator.probeActive()).resolves.toBe(true);

    expect(factoryAttempts).toBe(2);
    expect(harness.coordinator.getSnapshot()).toMatchObject({
      activeConnectionId: 'alpha',
      activeState: 'ready',
      error: null,
    });
  });

  it('never republishes a stale active id when a switch overtakes cache hydration', async () => {
    const { store } = await createStoreHarness();
    const dashboardStorage = new MemoryDashboardStorage();
    const cache = new RosterCache({ storage: dashboardStorage });
    const pendingCache = deferred<Awaited<ReturnType<RosterCache['getMany']>>>();
    const getMany = jest.spyOn(cache, 'getMany').mockImplementationOnce(
      () => pendingCache.promise,
    );
    const coordinator = new ConnectionCoordinator({
      store,
      cache,
      watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
      adapterFactory: (_record, descriptor) => instrumentAdapter(descriptor, []),
      chatCache: { clearConnection: async () => undefined },
    });
    const observedActiveIds: Array<string | null> = [];
    const unsubscribe = coordinator.subscribe(() => {
      observedActiveIds.push(coordinator.getSnapshot().activeConnectionId);
    });

    const started = coordinator.start();
    for (let attempt = 0; attempt < 10 && getMany.mock.calls.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(getMany).toHaveBeenCalledTimes(1);
    await store.setActive('beta');
    const switchedAt = observedActiveIds.length - 1;

    pendingCache.resolve([]);
    await started;
    await coordinator.whenIdle();

    expect(observedActiveIds[switchedAt]).toBe('beta');
    expect(observedActiveIds.slice(switchedAt)).not.toContain('alpha');
    expect(coordinator.getSnapshot()).toMatchObject({
      activeConnectionId: 'beta',
      activeState: 'ready',
    });
    unsubscribe();
    await coordinator.stop();
  });

  it('continues a switch when adapter cleanup throws', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    const alpha = harness.adapters[0] as AgentAdapter & { dispose?: () => void };
    alpha.dispose = jest.fn(() => {
      throw new Error('dispose failed');
    });

    await expect(harness.coordinator.activate('beta')).resolves.toMatchObject({
      activeConnectionId: 'beta',
      activeState: 'ready',
    });
    expect(harness.coordinator.getAdapter('alpha')).toBeNull();
    expect(harness.coordinator.getAdapter('beta')?.state).toBe('ready');
  });

  it('updates unread state when a thread is opened without affecting cached connections', async () => {
    const harness = await createHarness();
    await harness.cache.set('beta', [agent('beta')], [session('beta', 30)]);
    await harness.coordinator.start();
    const alphaSession = session('alpha', 20);

    await harness.coordinator.markSessionOpened(alphaSession, 25);

    const snapshot = harness.coordinator.getSnapshot();
    expect(snapshot.roster.find((group) => group.connection.id === 'alpha')?.unreadCount).toBe(0);
    expect(snapshot.roster.find((group) => group.connection.id === 'beta')?.unreadCount).toBe(0);
  });

  it('keeps external-store snapshots stable between publications', async () => {
    const harness = await createHarness();
    const before = harness.coordinator.getSnapshot();
    expect(harness.coordinator.getSnapshot()).toBe(before);

    await harness.coordinator.start();

    const after = harness.coordinator.getSnapshot();
    expect(after).not.toBe(before);
    expect(harness.coordinator.getSnapshot()).toBe(after);
  });

  it('emits low-cardinality lifecycle telemetry without connection ids or labels', async () => {
    const { store } = await createStoreHarness();
    const dashboardStorage = new MemoryDashboardStorage();
    const events: string[] = [];
    const telemetry = {
      attempt: jest.fn((connection, reason) => events.push(`attempt:${connection.backendKind}:${reason}`)),
      ready: jest.fn((connection, elapsedMs, attempt) => (
        events.push(`ready:${connection.transportKind}:${elapsedMs}:${attempt}`)
      )),
      failed: jest.fn(),
      reconnect: jest.fn(),
    } satisfies ConnectionTelemetry;
    const coordinator = new ConnectionCoordinator({
      store,
      cache: new RosterCache({ storage: dashboardStorage }),
      watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
      adapterFactory: (_record, descriptor) => instrumentAdapter(descriptor, []),
      now: () => 50,
      telemetry,
    });

    await coordinator.start();

    expect(events).toEqual(['attempt:openclaw:launch', 'ready:relay:0:1']);
    expect(events.join('|')).not.toContain('alpha');
  });

  it('refreshes active roster on the injected interval and clears timers on switch and stop', async () => {
    jest.useFakeTimers();
    try {
      const harness = await createHarness(true, {
        rosterRefreshIntervalMs: 100,
        hermesProbeIntervalMs: 50,
      });
      await harness.coordinator.start();
      const alpha = harness.adapters[0];
      const alphaListSessions = jest.spyOn(alpha, 'listSessions');

      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(99);
      expect(alphaListSessions).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(alphaListSessions).toHaveBeenCalledTimes(1);

      await harness.coordinator.activate('beta');
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(200);
      expect(alphaListSessions).toHaveBeenCalledTimes(1);

      await harness.coordinator.stop();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs Hermes request probes every interval without overlapping probe or roster work', async () => {
    jest.useFakeTimers();
    try {
      const harness = await createMaintenanceHarness('hermes', {
        rosterRefreshIntervalMs: 100,
        hermesProbeIntervalMs: 50,
      });
      await harness.coordinator.start();
      const adapter = harness.getAdapter();
      const pendingProbe = deferred<boolean>();
      const probe = jest.spyOn(adapter, 'probe').mockImplementation(() => pendingProbe.promise);
      const listSessions = jest.spyOn(adapter, 'listSessions');

      await jest.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(200);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(listSessions).not.toHaveBeenCalled();

      pendingProbe.resolve(true);
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(0);
      expect(listSessions).toHaveBeenCalledTimes(1);

      probe.mockResolvedValue(true);
      await jest.advanceTimersByTimeAsync(50);
      expect(probe).toHaveBeenCalledTimes(2);
      await harness.coordinator.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('coalesces roster ticks while a prior fallback refresh is still running', async () => {
    jest.useFakeTimers();
    try {
      const harness = await createMaintenanceHarness('openclaw', {
        rosterRefreshIntervalMs: 50,
        hermesProbeIntervalMs: 0,
      });
      await harness.coordinator.start();
      const adapter = harness.getAdapter();
      const originalListAgents = adapter.listAgents.bind(adapter);
      const pendingAgents = deferred<AgentDescriptor[]>();
      const listAgents = jest.spyOn(adapter, 'listAgents')
        .mockImplementationOnce(() => pendingAgents.promise)
        .mockImplementation(originalListAgents);

      await jest.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      expect(listAgents).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(200);
      expect(listAgents).toHaveBeenCalledTimes(1);

      pendingAgents.resolve([agent('alpha')]);
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(50);
      expect(listAgents).toHaveBeenCalledTimes(2);
      await harness.coordinator.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let a slow roster poll overwrite a newer pushed session snapshot', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    const adapter = harness.adapters[0];
    const pendingSessions = deferred<SessionDescriptor[]>();
    const listSessions = jest.spyOn(adapter, 'listSessions')
      .mockImplementationOnce(() => pendingSessions.promise);

    const refresh = harness.coordinator.refreshRoster();
    for (let attempt = 0; attempt < 10 && listSessions.mock.calls.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(listSessions).toHaveBeenCalledTimes(1);

    const created = await adapter.createSession?.('main', { title: 'Pushed session' });
    expect(created).toBeDefined();
    expect(
      harness.coordinator.getSnapshot().roster
        .find((group) => group.connection.id === 'alpha')
        ?.agents[0]?.sessions.map((candidate) => candidate.key),
    ).toContain(created?.key);

    pendingSessions.resolve([session('alpha', 20)]);
    await refresh;

    expect(
      harness.coordinator.getSnapshot().roster
        .find((group) => group.connection.id === 'alpha')
        ?.agents[0]?.sessions.map((candidate) => candidate.key),
    ).toContain(created?.key);
    await harness.coordinator.stop();
  });
});
