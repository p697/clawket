import {
  AdapterError,
  createMockAdapter,
  type AgentAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type ConnectionRecord,
  type ConnectionState,
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
  loadConnectionIdentityDetail,
  type ConnectionCoordinatorOptions,
  type ConnectionTelemetry,
} from './index';
import { createConnectionAdapter } from './adapters';
import { SessionCatalogSupersededError } from './adapters/session-catalog';
import { enqueueMessage, getMessageQueueStore, messageQueueScopeKey } from '../chat/messageQueue';
import { ownConnectionRuntime } from './runtime-owner';
import { onAdapterPathRecovered, recoverAdapterConnection } from './adapter-recovery';

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

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }

  has(key: string): boolean {
    return this.values.has(key);
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
    'chatCache' | 'credentialStore' | 'cronFailureAcks' | 'sessionPreferences' | 'telemetry' | 'threadActivityCache'
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
  backendKind: ConnectionDescriptor['backendKind'],
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
  const cache = new RosterCache({ storage: dashboardStorage });
  let adapter: AgentAdapter | null = null;
  let pausedIds: ReadonlyArray<string> = [];
  const coordinator = new ConnectionCoordinator({
    store,
    cache,
    watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
    adapterFactory: (_record, descriptor) => {
      adapter = instrumentAdapter(descriptor, []);
      return adapter;
    },
    pausedStore: { read: async () => pausedIds, write: async (ids) => { pausedIds = ids; } },
    ...maintenance,
  });
  return {
    cache,
    coordinator,
    getAdapter(): AgentAdapter {
      if (!adapter) throw new Error('Adapter has not been created');
      return adapter;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function controllableAdapter(
  descriptor: ConnectionDescriptor,
  connect: (emitState: (state: ConnectionState, reason?: string) => void) => Promise<void>,
): Readonly<{
  adapter: AgentAdapter;
  emitState: (state: ConnectionState, reason?: string) => void;
}> {
  const delegate = createMockAdapter({
    connection: descriptor,
    agents: [agent(descriptor.id)],
    sessions: [session(descriptor.id, 20)],
  });
  const stateListeners = new Set<(state: ConnectionState, reason?: string) => void>();
  let state: ConnectionState = 'idle';
  const emitState = (next: ConnectionState, reason?: string) => {
    state = next;
    for (const listener of stateListeners) listener(next, reason);
  };
  const adapter = {
    ...delegate,
    connect: () => connect(emitState),
    disconnect: () => emitState('idle', 'disconnected'),
    on: ((event: string, listener: (...args: never[]) => void) => {
      if (event === 'state') {
        stateListeners.add(listener as (next: ConnectionState, reason?: string) => void);
        return () => stateListeners.delete(
          listener as (next: ConnectionState, reason?: string) => void,
        );
      }
      return delegate.on(event as 'update', listener as never);
    }) as AgentAdapter['on'],
  } as AgentAdapter;
  Object.defineProperty(adapter, 'state', { configurable: true, get: () => state });
  return { adapter, emitState };
}

async function flushMaintenance(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('ConnectionCoordinator', () => {
  it('publishes scoped session patches immediately and fences stale roster polling', async () => {
    const harness = await createHarness();
    const created = { ...session('alpha', 30), key: 'new-chat', title: 'New chat', canContinue: false, continuationBlockedReason: 'in_use' as const,
      project: { id: 'qa', name: 'QA', path: '/qa', available: true } };
    const adapter = createMockAdapter({
      connection: { ...connectionInput('alpha'), isFreeSlot: true },
      agents: [agent('alpha')], sessions: [session('alpha', 20)],
      timeline: [
        { atMs: 1, update: { type: 'session_info_update', session: created } },
        { atMs: 2, update: { type: 'session_info_update', session: { key: created.key, title: 'Updated title', canContinue: true } } },
        { atMs: 3, update: { type: 'session_info_update', session: { key: 'incomplete', title: 'Incomplete' } } },
        { atMs: 4, update: { type: 'session_info_update', session: { ...created, connectionId: 'beta', title: 'Wrong connection' } } },
      ],
    });
    harness.coordinator.setAdapterFactory(() => adapter);
    await harness.coordinator.start();
    const pending = deferred<SessionDescriptor[]>();
    const list = jest.spyOn(adapter, 'listSessions').mockReturnValueOnce(pending.promise);
    const refresh = harness.coordinator.refreshRoster();
    for (let i = 0; i < 10 && !list.mock.calls.length; i++) await flushMaintenance();
    const rows = () => harness.coordinator.getSnapshot().roster[0].agents[0].sessions;
    adapter.replayTimeline(1);
    expect(rows().find(row => row.key === created.key)).toMatchObject(created);
    adapter.replayTimeline();
    expect(rows().find(row => row.key === created.key)).toMatchObject({ title: 'Updated title', project: created.project });
    expect(rows().find(row => row.key === created.key)).not.toHaveProperty('continuationBlockedReason');
    expect(rows()).toHaveLength(2);
    pending.resolve([session('alpha', 20)]);
    await refresh;
    expect(rows().find(row => row.key === created.key)?.title).toBe('Updated title');
    await harness.coordinator.stop();
  });

  it.each(['openclaw', 'hermes'] as const)(
    'retires the previous process owner before a hot-reloaded %s runtime starts',
    async (backendKind) => {
      jest.useFakeTimers();
      const scope = {};
      const old = await createMaintenanceHarness(backendKind, {
        rosterRefreshIntervalMs: 1_000, hermesProbeIntervalMs: 1_000,
      });
      const next = await createMaintenanceHarness(backendKind, {
        rosterRefreshIntervalMs: 1_000, hermesProbeIntervalMs: 1_000,
      });
      try {
        ownConnectionRuntime(old.coordinator, scope);
        await old.coordinator.start();
        const adapter = old.getAdapter();
        const disconnect = jest.spyOn(adapter, 'disconnect');
        const reconnect = jest.spyOn(adapter, 'connect');
        ownConnectionRuntime(next.coordinator, scope);
        // Cleanup happens synchronously, before queued storage work settles.
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(old.coordinator.getSnapshot().activeAdapter).toBeNull();
        await old.coordinator.start();
        await next.coordinator.start();
        await jest.advanceTimersByTimeAsync(5_000);
        expect(reconnect).not.toHaveBeenCalled();
        expect(next.coordinator.getSnapshot().activeState).toBe('ready');
        // Reclaiming the same instance must not disconnect a healthy session.
        ownConnectionRuntime(next.coordinator, scope);
        expect(next.coordinator.getSnapshot().activeState).toBe('ready');
      } finally {
        await old.coordinator.stop();
        await next.coordinator.stop();
        jest.useRealTimers();
      }
    },
  );

  it('survives overlapping cleanup and restart without losing initialized state', async () => {
    const { coordinator } = await createHarness();
    await coordinator.start();
    await Promise.all([coordinator.stop(), coordinator.start()]);
    expect(coordinator.getSnapshot()).toMatchObject({ initialized: true, activeState: 'ready' });
    await coordinator.stop();
  });

  it.each(['openclaw', 'hermes'] as const)('keeps a paused %s connection offline across restart and probes', async (backendKind) => {
    const { coordinator } = await createMaintenanceHarness(backendKind, {
      rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0,
    });
    await coordinator.start();
    const first = coordinator.getSnapshot().activeAdapter;
    await coordinator.pauseConnection('alpha');
    expect(coordinator.getSnapshot()).toMatchObject({ activeAdapter: null, pausedConnectionIds: ['alpha'] });
    await coordinator.probeActive();
    await coordinator.stop();
    await coordinator.start();
    expect(coordinator.getSnapshot().activeAdapter).toBeNull();
    await coordinator.activate('alpha');
    expect(coordinator.getSnapshot().activeState).toBe('ready');
    expect(coordinator.getSnapshot().activeAdapter).not.toBe(first);
    const resumed = coordinator.getSnapshot().activeAdapter;
    await coordinator.reconnectConnection('alpha');
    expect(coordinator.getSnapshot().activeAdapter).not.toBe(resumed);
    expect(coordinator.getSnapshot().activeState).toBe('ready');
    await coordinator.stop();
  });

  it('claims the launch paywall at most once for the coordinator process', async () => {
    const harness = await createHarness(false);

    expect(harness.coordinator.getSnapshot().launchPaywallShownThisProcess).toBe(false);
    expect(harness.coordinator.markLaunchPaywallShown()).toBe(true);
    expect(harness.coordinator.markLaunchPaywallShown()).toBe(false);
    expect(harness.coordinator.getSnapshot().launchPaywallShownThisProcess).toBe(true);

    await harness.coordinator.start();
    await harness.coordinator.stop();
    await harness.coordinator.start();

    expect(harness.coordinator.getSnapshot().launchPaywallShownThisProcess).toBe(true);
  });

  it.each(['openclaw', 'hermes', 'claude-code', 'codex', 'pi'] as const)(
    'keeps %s failure visible through retries and refreshes only after ready',
    async (backendKind) => {
      const secureStorage = new MemorySecureStorage();
      const store = new ConnectionStore({ secureStorage, legacyStorage });
      await store.load();
      await store.add({ ...connectionInput('alpha'), backendKind });
      let now = 100;
      const dashboardStorage = new MemoryDashboardStorage();
      let control!: ReturnType<typeof controllableAdapter>;
      let listAgentsCalls = 0;
      let listSessionsCalls = 0;
      const coordinator = new ConnectionCoordinator({
        store,
        cache: new RosterCache({ storage: dashboardStorage, now: () => now }),
        watermarks: new UnreadWatermarks({ storage: dashboardStorage, now: () => now }),
        now: () => now,
        rosterRefreshIntervalMs: 0,
        hermesProbeIntervalMs: 0,
        adapterFactory: (_record, descriptor) => {
          control = controllableAdapter(descriptor, async (emitState) => {
            emitState('connecting');
            emitState('error', 'first handshake failed');
            throw new Error('first handshake failed');
          });
          const listAgents = control.adapter.listAgents.bind(control.adapter);
          const listSessions = control.adapter.listSessions.bind(control.adapter);
          control.adapter.listAgents = async () => {
            listAgentsCalls += 1;
            return listAgents();
          };
          control.adapter.listSessions = async () => {
            listSessionsCalls += 1;
            return listSessions();
          };
          return control.adapter;
        },
      });

      await coordinator.start();
      expect(coordinator.getSnapshot()).toMatchObject({
        activeState: 'error',
        recoveryFailed: true,
        error: { operation: 'connect', connectionId: 'alpha' },
      });
      expect(listAgentsCalls).toBe(0);
      expect(listSessionsCalls).toBe(0);

      for (const state of ['reconnecting', 'connecting', 'handshaking'] as const) {
        control.emitState(state);
        await coordinator.refreshRoster();
        expect(coordinator.getSnapshot()).toMatchObject({
          activeState: state,
          recoveryFailed: true,
          recovering: false,
          error: { operation: 'connect', connectionId: 'alpha' },
        });
        expect(listAgentsCalls).toBe(0);
        expect(listSessionsCalls).toBe(0);
      }

      now = 200;
      control.emitState('ready');
      await flushMaintenance();

      const snapshot = coordinator.getSnapshot();
      const live = snapshot.roster.find((group) => group.connection.id === 'alpha');
      expect(snapshot).toMatchObject({ activeState: 'ready', switching: false, recoveryFailed: false, error: null });
      expect(snapshot.connectionDetails.alpha?.lastReadyAt).toBe(200);
      expect(live).toMatchObject({ source: 'live', syncedAt: 200 });
      expect(listAgentsCalls).toBe(1);
      expect(listSessionsCalls).toBe(1);
      await coordinator.stop();
    },
  );

  it.each(['openclaw', 'hermes'] as const)(
    'forces one fresh %s roster scan for each ready transition',
    async (backendKind) => {
      const secureStorage = new MemorySecureStorage();
      const store = new ConnectionStore({ secureStorage, legacyStorage });
      await store.load();
      await store.add({ ...connectionInput('alpha'), backendKind });
      let now = 100;
      const dashboardStorage = new MemoryDashboardStorage();
      let control!: ReturnType<typeof controllableAdapter>;
      let listAgentsCalls = 0;
      let listSessionsCalls = 0;
      const reconnect = jest.fn();
      const coordinator = new ConnectionCoordinator({
        store,
        cache: new RosterCache({ storage: dashboardStorage, now: () => now }),
        watermarks: new UnreadWatermarks({ storage: dashboardStorage, now: () => now }),
        now: () => now,
        rosterRefreshIntervalMs: 0,
        hermesProbeIntervalMs: 0,
        telemetry: {
          attempt: jest.fn(),
          ready: jest.fn(),
          failed: jest.fn(),
          reconnect,
        },
        adapterFactory: (_record, descriptor) => {
          control = controllableAdapter(descriptor, async (emitState) => {
            emitState('connecting');
            emitState('handshaking');
            emitState('ready');
          });
          const listAgents = control.adapter.listAgents.bind(control.adapter);
          const listSessions = control.adapter.listSessions.bind(control.adapter);
          control.adapter.listAgents = async () => {
            listAgentsCalls += 1;
            return listAgents();
          };
          control.adapter.listSessions = async () => {
            listSessionsCalls += 1;
            return listSessions();
          };
          return control.adapter;
        },
      });

      await coordinator.start();
      expect(listAgentsCalls).toBe(1);
      expect(listSessionsCalls).toBe(1);

      now = 200;
      control.emitState('reconnecting', 'socket closed');
      control.emitState('ready');
      await flushMaintenance();

      const snapshot = coordinator.getSnapshot();
      const live = snapshot.roster.find((group) => group.connection.id === 'alpha');
      expect(snapshot.connectionDetails.alpha?.lastReadyAt).toBe(200);
      expect(live).toMatchObject({ source: 'live', syncedAt: 200 });
      expect(listAgentsCalls).toBe(2);
      expect(listSessionsCalls).toBe(2);
      expect(reconnect).toHaveBeenLastCalledWith(
        expect.objectContaining({ backendKind }),
        'socket_close',
        { origin: 'transport', cause: 'socket_close' },
      );

      now = 300;
      control.emitState('ready', 'duplicate ready evidence');
      await flushMaintenance();
      expect(listAgentsCalls).toBe(2);
      expect(listSessionsCalls).toBe(2);

      control.emitState('reconnecting', 'Relay heartbeat timed out');
      control.emitState('ready');
      await flushMaintenance();
      expect(listAgentsCalls).toBe(3);
      expect(listSessionsCalls).toBe(3);
      expect(reconnect).toHaveBeenLastCalledWith(
        expect.objectContaining({ backendKind }),
        'tick_timeout',
        { origin: 'transport', cause: 'heartbeat_timeout' },
      );
      await coordinator.stop();
    },
  );

  it.each(['response', 'error'] as const)('does not let a pre-reconnect roster %s affect the new ready scan', async (outcome) => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({ secureStorage, legacyStorage });
    await store.load();
    await store.add(connectionInput('alpha'));
    let now = 100;
    const dashboardStorage = new MemoryDashboardStorage();
    let control!: ReturnType<typeof controllableAdapter>;
    const coordinator = new ConnectionCoordinator({
      store,
      cache: new RosterCache({ storage: dashboardStorage, now: () => now }),
      watermarks: new UnreadWatermarks({ storage: dashboardStorage, now: () => now }),
      now: () => now,
      rosterRefreshIntervalMs: 0,
      hermesProbeIntervalMs: 0,
      adapterFactory: (_record, descriptor) => {
        control = controllableAdapter(descriptor, async (emitState) => {
          emitState('connecting');
          emitState('handshaking');
          emitState('ready');
        });
        return control.adapter;
      },
    });
    await coordinator.start();

    const pendingAgents = deferred<AgentDescriptor[]>();
    const originalListAgents = control.adapter.listAgents.bind(control.adapter);
    const listAgents = jest.spyOn(control.adapter, 'listAgents')
      .mockImplementationOnce(() => pendingAgents.promise)
      .mockImplementation(originalListAgents);
    const staleRefresh = coordinator.refreshRoster();
    await flushMaintenance();
    expect(listAgents).toHaveBeenCalledTimes(1);

    now = 150;
    control.emitState('reconnecting', 'socket closed');
    expect(coordinator.getSnapshot().roster[0]?.source).toBe('cache');
    now = 200;
    control.emitState('ready');
    const staleErrors: string[] = [];
    const stopObserving = coordinator.subscribe(() => {
      const message = coordinator.getSnapshot().error?.message;
      if (message) staleErrors.push(message);
    });
    if (outcome === 'error') pendingAgents.reject(new Error('old roster request timed out'));
    else pendingAgents.resolve([agent('alpha')]);
    await staleRefresh;
    await flushMaintenance();
    stopObserving();

    const snapshot = coordinator.getSnapshot();
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(snapshot.connectionDetails.alpha?.lastReadyAt).toBe(200);
    expect(snapshot.roster[0]).toMatchObject({ source: 'live', syncedAt: 200 });
    expect(staleErrors).toEqual([]);
    await coordinator.stop();
  });

  it('renames a connection without disturbing a live adapter whose Agents carry their own names', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    expect(harness.coordinator.getSnapshot().activeState).toBe('ready');
    const eventsBefore = [...harness.events];

    const descriptor = await harness.coordinator.renameConnection('alpha', '  Studio  ');

    expect(descriptor.label).toBe('Studio');
    const snapshot = harness.coordinator.getSnapshot();
    expect(snapshot.connections.find((connection) => connection.id === 'alpha')?.label).toBe('Studio');
    const group = snapshot.roster.find((candidate) => candidate.connection.id === 'alpha');
    expect(group?.connection.label).toBe('Studio');
    expect(group?.agents.map(({ agent: entry }) => entry.name)).toEqual(['alpha agent']);
    expect(snapshot.activeState).toBe('ready');
    expect(harness.events).toEqual(eventsBefore);
    await expect(harness.coordinator.renameConnection('alpha', '   ')).rejects.toThrow('required');
    await harness.coordinator.stop();
  });

  it('mirrors a rename onto Agents named after the connection and re-handshakes the live one', async () => {
    const { secureStorage, store } = await createStoreHarness();
    await store.update('alpha', { label: 'Alpha desk' });
    await store.update('beta', { label: 'Beta desk' });
    const dashboardStorage = new MemoryDashboardStorage();
    const cache = new RosterCache({ storage: dashboardStorage, now: () => 50 });
    await cache.set('beta', [{ ...agent('beta'), name: 'Beta desk' }], [session('beta', 30)], 'idle');
    const events: string[] = [];
    const coordinator = new ConnectionCoordinator({
      store,
      cache,
      watermarks: new UnreadWatermarks({ storage: dashboardStorage, now: () => 50 }),
      // Like Hermes without a Bridge name or the local model, the Agent is named after the label.
      adapterFactory: (_record, descriptor) => {
        const adapter = instrumentAdapter(descriptor, events);
        adapter.listAgents = async () => [{ ...agent(descriptor.id), name: descriptor.label }];
        return adapter;
      },
      now: () => 50,
    });
    await coordinator.start();
    const agentName = (connectionId: string) => coordinator.getSnapshot().roster
      .find((candidate) => candidate.connection.id === connectionId)?.agents[0]?.agent.name;
    expect(agentName('alpha')).toBe('Alpha desk');
    expect(agentName('beta')).toBe('Beta desk');
    events.length = 0;

    await coordinator.renameConnection('alpha', 'Studio');
    expect(events).toEqual(['disconnect:alpha', 'connect:alpha']);
    expect(coordinator.getSnapshot().activeState).toBe('ready');
    expect(agentName('alpha')).toBe('Studio');

    await coordinator.renameConnection('beta', 'Lab');
    expect(events).toEqual(['disconnect:alpha', 'connect:alpha']);
    expect(agentName('beta')).toBe('Lab');
    expect(await cache.get('beta')).toMatchObject({ savedAt: 50, connectionStateAtSave: 'idle', agents: [{ name: 'Lab' }] });
    expect(JSON.stringify(await secureStorage.getItemAsync('clawket.connectionRegistry.v1'))).toContain('Lab');
    await coordinator.stop();
  });

  it.each(['codex', 'claude-code'] as const)('keeps %s device names local across rename, refresh and cached restart', async (backendKind) => {
    const { store } = await createStoreHarness();
    await store.update('alpha', { backendKind, label: 'First computer' });
    await store.update('beta', { backendKind, label: 'Second computer' });
    const storage = new MemoryDashboardStorage();
    const cache = new RosterCache({ storage, now: () => 50 });
    await cache.set('beta', [{ ...agent('beta'), name: 'Fixed backend name' }], [session('beta', 30)], 'idle');
    const events: string[] = [];
    const coordinator = new ConnectionCoordinator({
      store, cache,
      watermarks: new UnreadWatermarks({ storage, now: () => 50 }),
      adapterFactory: (_record, descriptor) => instrumentAdapter(descriptor, events),
      now: () => 50,
    });
    const names = () => ['alpha', 'beta'].map(id => coordinator.getSnapshot().roster.find(group => group.connection.id === id)?.agents[0]?.agent.name);
    await coordinator.start();
    expect(names()).toEqual(['First computer', 'Second computer']);
    events.length = 0;
    await coordinator.renameConnection('alpha', 'Studio');
    await coordinator.renameConnection('beta', 'Travel');
    expect(names()).toEqual(['Studio', 'Travel']);
    expect(coordinator.getSnapshot().activeAdapter?.connection.label).toBe('Studio');
    expect(events).toEqual([]);
    await coordinator.refreshRoster();
    expect(names()).toEqual(['Studio', 'Travel']);
    expect(await cache.get('beta')).toMatchObject({ agents: [{ name: 'Travel' }] });
    await coordinator.stop();
    await coordinator.start();
    expect(names()).toEqual(['Studio', 'Travel']);
    await coordinator.stop();
  });

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

  it('reads only the authenticated YouMind email for runtime identity detail', async () => {
    const descriptor: ConnectionDescriptor = {
      id: 'youmind-account',
      backendKind: 'youmind',
      transportKind: 'https',
      label: 'YouMind',
      createdAt: 1,
      isFreeSlot: true,
    };
    const record: ConnectionRecord = {
      ...descriptor,
      url: 'https://youmind.example.invalid',
      youmind: { authScopeKey: 'account-scope' },
    };
    const getRuntimeConnectionRecord = jest.fn(async () => record);
    const getYouMindAuthSession = jest.fn(async () => ({
      accessToken: 'private-access-token',
      refreshToken: 'private-refresh-token',
      expiresIn: 3_600,
      createdAtMs: 1,
      user: {
        id: 'private-user-id',
        email: '  owner@example.com  ',
        name: 'Private name',
      },
    }));

    await expect(loadConnectionIdentityDetail(descriptor, {
      getRuntimeConnectionRecord,
      getYouMindAuthSession,
    })).resolves.toBe('owner@example.com');
    expect(getRuntimeConnectionRecord).toHaveBeenCalledWith('youmind-account');
    expect(getYouMindAuthSession).toHaveBeenCalledWith(
      'https://youmind.example.invalid',
      'account-scope',
    );
    expect(descriptor).not.toHaveProperty('email');
    expect(JSON.stringify(descriptor)).not.toContain('owner@example.com');
  });

  it.each(['openclaw', 'hermes'] as const)(
    'does not read private identity state for %s',
    async (backendKind) => {
      const descriptor: ConnectionDescriptor = {
        id: `${backendKind}-account`,
        backendKind,
        transportKind: 'relay',
        label: backendKind,
        createdAt: 1,
        isFreeSlot: true,
      };
      const getRuntimeConnectionRecord = jest.fn();
      const getYouMindAuthSession = jest.fn();

      await expect(loadConnectionIdentityDetail(descriptor, {
        getRuntimeConnectionRecord,
        getYouMindAuthSession,
      })).resolves.toBeUndefined();
      expect(getRuntimeConnectionRecord).not.toHaveBeenCalled();
      expect(getYouMindAuthSession).not.toHaveBeenCalled();
    },
  );

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
    // This device already tracked alpha and last read it before its latest activity.
    await harness.watermarks.markRead('alpha', 'agent:main:main', 10);

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
      bridgeGeneration: 'current',
      bridgeCapabilities: ['bridge.capabilities.v2', 'backend.openclaw.v2'],
    });

    harness.adapters[0]?.disconnect();

    expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'idle' });
    expect(harness.coordinator.getSnapshot().connectionDetails.alpha).toEqual({
      lastReadyAt: 50,
      bridgeVersion: 'bridge-alpha',
      bridgeGeneration: 'current',
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

  it('keeps live run phases at connection scope without a mounted chat listener', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    const adapter = harness.coordinator.getAdapter('alpha')!;
    const { runId } = await adapter.prompt('main', { text: 'hello', idempotencyKey: 'activity' });
    expect(harness.coordinator.getSnapshot().runActivities).toEqual([
      { connectionId: 'alpha', sessionKey: 'main', runId, phase: 'thinking' },
    ]);
    await adapter.cancel('main', runId);
    expect(harness.coordinator.getSnapshot().runActivities).toEqual([]);
    await adapter.prompt('main', { text: 'again', idempotencyKey: 'activity2' });
    await harness.coordinator.activate('beta');
    expect(harness.coordinator.getSnapshot().runActivities).toEqual([]);
    await harness.coordinator.stop();
  });

  it('finishes removal without waiting for an unreachable fallback connection', async () => {
    const { store } = await createStoreHarness();
    const events: string[] = [];
    let release: (() => void) | undefined;
    const coordinator = new ConnectionCoordinator({
      store,
      cache: new RosterCache({ storage: new MemoryDashboardStorage() }),
      watermarks: new UnreadWatermarks({ storage: new MemoryDashboardStorage() }),
      adapterFactory: (_record, descriptor) => {
        const adapter = instrumentAdapter(descriptor, events);
        if (descriptor.id === 'beta') {
          adapter.connect = () => new Promise<void>((resolve) => { release = resolve; });
        }
        return adapter;
      },
    });
    await coordinator.start();
    try {
      await expect(coordinator.removeConnection('alpha')).resolves.toBe(true);
      expect(coordinator.getSnapshot().connections.map((item) => item.id)).toEqual(['beta']);
      expect(coordinator.getSnapshot().roster.some((group) => group.connection.id === 'alpha')).toBe(false);
      expect(coordinator.getAdapter('alpha')).toBeNull();
    } finally {
      release?.();
      await coordinator.stop();
    }
  });

  it('clears only the removed connection chat cache after the registry commit', async () => {
    const clearConnection = jest.fn(async (_connectionId: string) => undefined);
    const harness = await createHarness(true, {}, {
      chatCache: { clearConnection },
    });
    await harness.coordinator.start();
    const queueStore = getMessageQueueStore();
    const queuedItem = { id: 'usr_1_q1', text: 'later', images: [], createdAt: 1 };
    queueStore.update(messageQueueScopeKey('beta', 'main'), (state) => enqueueMessage(state, queuedItem));
    queueStore.update(messageQueueScopeKey('alpha', 'main'), (state) => enqueueMessage(state, queuedItem));

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(clearConnection).toHaveBeenCalledTimes(1);
    expect(clearConnection).toHaveBeenCalledWith('beta');
    expect(queueStore.read(messageQueueScopeKey('beta', 'main')).items).toHaveLength(0);
    expect(queueStore.read(messageQueueScopeKey('alpha', 'main')).items).toHaveLength(1);
    expect(harness.store.getSnapshot().connections.map((connection) => connection.id)).toEqual([
      'alpha',
    ]);
    expect(harness.coordinator.getSnapshot().error).toBeNull();
  });

  it('clears only the removed connection thread activity snapshots after the registry commit', async () => {
    const clearConnection = jest.fn(async (_connectionId: string) => undefined);
    const harness = await createHarness(true, {}, {
      threadActivityCache: { clearConnection },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(clearConnection).toHaveBeenCalledTimes(1);
    expect(clearConnection).toHaveBeenCalledWith('beta');
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

  it('clears only the removed connection cron failure acknowledgements after the registry commit', async () => {
    const clearConnection = jest.fn(async (_connectionId: string) => undefined);
    const harness = await createHarness(true, {}, {
      cronFailureAcks: { clearConnection },
    });
    await harness.coordinator.start();

    await expect(harness.coordinator.removeConnection('beta')).resolves.toBe(true);

    expect(clearConnection).toHaveBeenCalledTimes(1);
    expect(clearConnection).toHaveBeenCalledWith('beta');
    expect(harness.coordinator.getSnapshot().error).toBeNull();
  });

  it('clears operator and node device tokens only for the removed connection scope', async () => {
    const deleteDeviceToken = jest.fn(async () => undefined);
    const harness = await createHarness(true, {}, {
      credentialStore: {
        clearYouMindAuthSession: async () => undefined,
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
        clearYouMindAuthSession: async () => undefined,
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

  it('removeAllConnections forgets every record, its credentials and the persisted registry before start', async () => {
    const deleteDeviceToken = jest.fn(async () => undefined);
    const clearYouMindAuthSession = jest.fn(async () => undefined);
    const harness = await createHarness(true, {}, {
      credentialStore: {
        clearYouMindAuthSession,
        getIdentity: async () => ({
          deviceId: 'device-1',
          publicKeyHex: 'public',
          secretKeyHex: 'secret',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        deleteDeviceToken,
      },
    });
    await harness.store.add({
      id: 'youmind-account',
      backendKind: 'youmind',
      transportKind: 'https',
      label: 'YouMind',
      url: 'https://youmind.example.invalid',
      youmind: { authScopeKey: 'account-scope' },
    });
    await harness.cache.set('alpha', [agent('alpha')], []);
    expect(harness.secureStorage.has('clawket.connectionRegistry.v1')).toBe(true);

    await expect(harness.coordinator.removeAllConnections()).resolves.toBe(3);

    // Operator + node tokens for both Relay records; the HTTPS record has none.
    expect(deleteDeviceToken).toHaveBeenCalledTimes(4);
    expect(deleteDeviceToken).toHaveBeenCalledWith('device-1', {
      serverUrl: 'https://alpha.example',
      gatewayId: 'gw_alpha',
      role: 'node',
    });
    expect(clearYouMindAuthSession).toHaveBeenCalledTimes(1);
    expect(clearYouMindAuthSession).toHaveBeenCalledWith('https://youmind.example.invalid', 'account-scope');
    expect(harness.secureStorage.has('clawket.connectionRegistry.v1')).toBe(false);
    expect(harness.secureStorage.has('clawket.connectionRegistry.rollback.v1')).toBe(false);
    await expect(harness.cache.getMany(['alpha'])).resolves.toEqual([]);
    expect(harness.store.getSnapshot().connections).toEqual([]);
    expect(harness.events).toEqual([]);

    const started = await harness.coordinator.start();
    expect(started.initialized).toBe(true);
    expect(started.connections).toEqual([]);
    expect(started.activeConnectionId).toBeNull();
    expect(started.error).toBeNull();
    expect(harness.adapters).toHaveLength(0);
  });

  it('keeps a committed removal and reports device-token cleanup failure', async () => {
    const harness = await createHarness(true, {}, {
      credentialStore: {
        clearYouMindAuthSession: async () => undefined,
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
      error: {
        operation: 'remove',
        connectionId: 'alpha',
        message: 'Connection data was removed, but some local data cleanup failed.',
      },
    });
    await harness.coordinator.whenIdle();
    expect(harness.coordinator.getSnapshot().activeState).toBe('ready');
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

  it('takes a never-tracked connection\'s first live snapshot as its read baseline', async () => {
    const harness = await createHarness();
    await harness.coordinator.start();
    // History from before pairing was read elsewhere: no unread dot on a new phone.
    expect(harness.coordinator.getSnapshot().roster.find((group) => group.connection.id === 'alpha')?.unreadCount).toBe(0);
    expect(await harness.watermarks.get('alpha')).toEqual({ 'agent:main:main': 20 });

    // Activity after the baseline is unread as usual.
    harness.adapters[0]!.listSessions = async () => [session('alpha', 60)];
    await harness.coordinator.refreshRoster();
    expect(harness.coordinator.getSnapshot().roster.find((group) => group.connection.id === 'alpha')?.unreadCount).toBe(1);
    expect(await harness.watermarks.get('alpha')).toEqual({ 'agent:main:main': 20 });
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

  it('routes adapter sequence-gap telemetry through the coordinator', async () => {
    const { store } = await createStoreHarness();
    const dashboardStorage = new MemoryDashboardStorage();
    const reconnect = jest.fn();
    let reportSequenceGap: (() => void) | undefined;
    const coordinator = new ConnectionCoordinator({
      store,
      cache: new RosterCache({ storage: dashboardStorage }),
      watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
      telemetry: {
        attempt: jest.fn(),
        ready: jest.fn(),
        failed: jest.fn(),
        reconnect,
      },
      adapterFactory: (_record, descriptor, context) => {
        reportSequenceGap = () => context?.onReconnect?.('seq_gap');
        return instrumentAdapter(descriptor, []);
      },
    });

    await coordinator.start();
    reportSequenceGap?.();

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alpha' }),
      'seq_gap',
    );
    await coordinator.stop();
  });

  it('attributes a foreground-triggered reconnect to foreground instead of a generic probe failure', async () => {
    const reconnect = jest.fn();
    const telemetry: ConnectionTelemetry = {
      attempt: jest.fn(),
      ready: jest.fn(),
      failed: jest.fn(),
      reconnect,
    };
    const harness = await createHarness(true, {
      rosterRefreshIntervalMs: 0,
      hermesProbeIntervalMs: 0,
    }, { telemetry });
    await harness.coordinator.start();
    jest.spyOn(harness.adapters[0], 'probe').mockResolvedValueOnce(false);

    await expect(harness.coordinator.probeActive(undefined, 'foreground')).resolves.toBe(true);
    await flushMaintenance();

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alpha' }),
      'foreground',
      { origin: 'foreground', cause: 'health_failed' },
    );
    await harness.coordinator.stop();
  });

  it('preserves the foreground trigger when the adapter reconnects inside its probe', async () => {
    const secureStorage = new MemorySecureStorage();
    const store = new ConnectionStore({ secureStorage, legacyStorage });
    await store.load();
    await store.add(connectionInput('alpha'));
    const dashboardStorage = new MemoryDashboardStorage();
    let control!: ReturnType<typeof controllableAdapter>;
    const reconnect = jest.fn();
    const coordinator = new ConnectionCoordinator({
      store,
      cache: new RosterCache({ storage: dashboardStorage }),
      watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
      rosterRefreshIntervalMs: 0,
      hermesProbeIntervalMs: 0,
      telemetry: {
        attempt: jest.fn(),
        ready: jest.fn(),
        failed: jest.fn(),
        reconnect,
      },
      adapterFactory: (_record, descriptor) => {
        control = controllableAdapter(descriptor, async (emitState) => {
          emitState('connecting');
          emitState('handshaking');
          emitState('ready');
        });
        return control.adapter;
      },
    });
    await coordinator.start();
    control.adapter.probe = jest.fn(async () => {
      control.emitState('reconnecting');
      control.emitState('ready');
      return true;
    });

    await expect(coordinator.probeActive(undefined, 'foreground')).resolves.toBe(true);
    await flushMaintenance();

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alpha' }),
      'foreground',
      { origin: 'foreground', cause: 'unknown' },
    );
    await coordinator.stop();
  });

  describe.each(['openclaw', 'hermes', 'claude-code', 'codex', 'pi'] as const)('%s probe ownership', (backendKind) => {
    it('shows a newly connected Agent before its catalog settles and retains it after catalog failure', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      const catalog = deferred<SessionDescriptor[]>();
      let adapter!: AgentAdapter;
      harness.coordinator.setAdapterFactory((_record, descriptor) => {
        adapter = instrumentAdapter(descriptor, []);
        adapter.listSessions = jest.fn().mockReturnValueOnce(catalog.promise)
          .mockResolvedValue([session(descriptor.id, 40)]);
        return adapter;
      });
      const start = harness.coordinator.start();
      try {
        await flushMaintenance();
        const partial = harness.coordinator.getSnapshot();
        expect(partial.activeState).toBe('ready');
        expect(partial.roster[0].agents[0]?.agent.connectionId).toBe('alpha');
        expect(partial.roster[0]).toMatchObject({ source: 'cache', syncedAt: 0 });
        expect(partial.roster[0].agents[0].sessions).toEqual([]);

        catalog.reject(new AdapterError('server', 'Invalid session catalog response'));
        await start;
        await flushMaintenance();
        expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', error: { operation: 'roster' } });
        expect(harness.coordinator.getSnapshot().roster[0].agents).toHaveLength(1);
        expect(await harness.cache.get('alpha')).toBeNull();

        // A saved-connection update rehydrates caches. It must not erase the
        // current in-memory Agent merely because no complete catalog exists.
        await harness.coordinator.addConnection({ ...connectionInput('beta'), backendKind });
        expect(harness.coordinator.getSnapshot().activeConnectionId).toBe('alpha');
        expect(harness.coordinator.getSnapshot().roster.find(group => group.connection.id === 'alpha')?.agents).toHaveLength(1);

        await harness.coordinator.refreshRoster();
        expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', error: null });
        expect(harness.coordinator.getSnapshot().roster[0]).toMatchObject({ source: 'live' });
        expect(harness.coordinator.getSnapshot().roster[0].agents[0].sessions).toHaveLength(1);
        expect((await harness.cache.get('alpha'))?.sessions).toHaveLength(1);
      } finally {
        catalog.resolve([]);
        await start;
        await harness.coordinator.stop();
      }
    });

    it('does not let late Agent discovery from a superseded catalog replace the newer roster', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        const oldAgents = deferred<AgentDescriptor[]>();
        jest.spyOn(adapter, 'listAgents').mockReturnValueOnce(oldAgents.promise);
        jest.spyOn(adapter, 'listSessions').mockRejectedValueOnce(new SessionCatalogSupersededError());
        await harness.coordinator.refreshRoster();
        const current = harness.coordinator.getSnapshot().roster;
        oldAgents.resolve([{ ...agent('alpha'), agentId: 'retired-agent' }]);
        await flushMaintenance();
        expect(harness.coordinator.getSnapshot().roster).toEqual(current);
        expect(harness.coordinator.getSnapshot().error).toBeNull();
      } finally { await harness.coordinator.stop(); }
    });

    it.each([true, false])('does not wait for or trust a pre-background probe (late health=%s)', async (lateHealth) => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const old = deferred<boolean>();
        const fresh = deferred<boolean>();
        const adapter = harness.getAdapter();
        const probe = jest.spyOn(adapter, 'probe').mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
        const disconnect = jest.spyOn(adapter, 'disconnect');
        const previous = harness.coordinator.probeActive();
        await flushMaintenance();
        harness.coordinator.setAppActive(false);
        harness.coordinator.setAppActive(true);
        const resumed = harness.coordinator.probeActive(2_000, 'foreground');
        await flushMaintenance();
        expect(probe).toHaveBeenCalledTimes(2);
        fresh.resolve(true);
        await expect(resumed).resolves.toBe(true);
        old.resolve(lateHealth);
        await expect(previous).resolves.toBe(false);
        expect(disconnect).not.toHaveBeenCalled();
      } finally { await harness.coordinator.stop(); }
    });

    it('does not reuse foreground health after another brief background gap', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const probe = jest.spyOn(harness.getAdapter(), 'probe').mockResolvedValue(true);
        await harness.coordinator.probeActive(2_000, 'foreground');
        await harness.coordinator.probeActive(2_000, 'foreground');
        expect(probe).toHaveBeenCalledTimes(1);
        harness.coordinator.setAppActive(false);
        harness.coordinator.setAppActive(true);
        await harness.coordinator.probeActive(2_000, 'foreground');
        expect(probe).toHaveBeenCalledTimes(2);
      } finally { await harness.coordinator.stop(); }
    });

    it('recovers ahead of a stalled catalog request and ignores its retired result', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        const stale = deferred<SessionDescriptor[]>();
        const list = jest.spyOn(adapter, 'listSessions').mockReturnValueOnce(stale.promise);
        const oldRefresh = harness.coordinator.refreshRoster();
        await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(1);
        const probe = jest.spyOn(adapter, 'probe').mockResolvedValueOnce(false);
        const connect = jest.spyOn(adapter, 'connect');

        await expect(harness.coordinator.probeActive(2_000, 'foreground')).resolves.toBe(true);
        await flushMaintenance();
        expect(probe).toHaveBeenCalledWith(2_000);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(list).toHaveBeenCalledTimes(2);
        expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', error: null });
        const recoveredRoster = harness.coordinator.getSnapshot().roster;
        stale.resolve([]);
        await oldRefresh;
        expect(harness.coordinator.getSnapshot().roster).toEqual(recoveredRoster);
      } finally { await harness.coordinator.stop(); }
    });

    it('shares foreground and send recovery and refuses recovery from a retired adapter', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        const health = deferred<boolean>();
        const probe = jest.spyOn(adapter, 'probe').mockReturnValueOnce(health.promise);
        const connect = jest.spyOn(adapter, 'connect');
        const foreground = harness.coordinator.probeActive(2_000, 'foreground');
        const send = recoverAdapterConnection(adapter, 1_500);
        await flushMaintenance();
        expect(probe).toHaveBeenCalledTimes(1);
        health.resolve(false);
        await expect(Promise.all([foreground, send])).resolves.toEqual([true, true]);
        expect(connect).toHaveBeenCalledTimes(1);
        await harness.coordinator.stop();
        await expect(recoverAdapterConnection(adapter)).resolves.toBe(false);
        expect(connect).toHaveBeenCalledTimes(1);
      } finally { await harness.coordinator.stop(); }
    });

    it('retains a failure from the reconnect started by this probe', async () => {
      jest.useFakeTimers();
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        jest.spyOn(adapter, 'probe').mockResolvedValueOnce(false);
        jest.spyOn(adapter, 'connect').mockRejectedValueOnce(new Error('reconnect rejected'));
        await expect(harness.coordinator.probeActive()).resolves.toBe(false);
        jest.advanceTimersByTime(20_000);
        expect(harness.coordinator.getSnapshot()).toMatchObject({ recoveryFailed: true,
          error: { operation: 'probe', message: 'reconnect rejected' } });
      } finally { await harness.coordinator.stop(); jest.useRealTimers(); }
    });

    it('replaces an explicitly superseded catalog with one awaited trailing read', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter(), previousRoster = harness.coordinator.getSnapshot().roster;
        const stale = deferred<SessionDescriptor[]>(), fresh = deferred<SessionDescriptor[]>();
        const list = jest.spyOn(adapter, 'listSessions')
          .mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
        const probe = jest.spyOn(adapter, 'probe'), disconnect = jest.spyOn(adapter, 'disconnect');
        let settled = false;
        const refresh = harness.coordinator.refreshRoster().then(() => { settled = true; });
        await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(1);
        stale.reject(new SessionCatalogSupersededError());
        await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(2);
        expect(settled).toBe(false);
        expect(harness.coordinator.getSnapshot().roster).toEqual(previousRoster);
        fresh.resolve([{ ...session('alpha', 40), title: 'Renamed after management' }]);
        await refresh;
        expect(probe).not.toHaveBeenCalled(); expect(disconnect).not.toHaveBeenCalled();
        expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', error: null });
        expect(harness.coordinator.getSnapshot().roster[0].agents[0].sessions[0].title)
          .toBe('Renamed after management');
        expect(list).toHaveBeenCalledTimes(2);
      } finally { await harness.coordinator.stop(); }
    });

    it('bounds consecutive superseded catalogs and releases the flight for the next explicit refresh', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        const list = jest.spyOn(adapter, 'listSessions')
          .mockRejectedValueOnce(new SessionCatalogSupersededError())
          .mockRejectedValueOnce(new SessionCatalogSupersededError());
        const probe = jest.spyOn(adapter, 'probe');
        await harness.coordinator.refreshRoster(); await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(2);
        expect(probe).not.toHaveBeenCalled();
        expect(harness.coordinator.getSnapshot().error).toBeNull();
        await harness.coordinator.refreshRoster();
        expect(list).toHaveBeenCalledTimes(3);
      } finally { await harness.coordinator.stop(); }
    });

    it.each(['background', 'stop', 'retire'] as const)('does not trail a superseded catalog after %s', async boundary => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter(), stale = deferred<SessionDescriptor[]>();
        const list = jest.spyOn(adapter, 'listSessions').mockReturnValueOnce(stale.promise);
        const probe = jest.spyOn(adapter, 'probe');
        const refresh = harness.coordinator.refreshRoster();
        await flushMaintenance();
        if (boundary === 'background') harness.coordinator.setAppActive(false);
        else if (boundary === 'stop') void harness.coordinator.stop();
        else adapter.disconnect();
        stale.reject(new SessionCatalogSupersededError());
        await refresh; await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(1);
        expect(probe).not.toHaveBeenCalled();
        expect(harness.coordinator.getSnapshot().error).toBeNull();
      } finally { await harness.coordinator.stop(); }
    });

    it('does not let an old superseded catalog trail or clear a newer ready flight', async () => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter(), stale = deferred<SessionDescriptor[]>(), fresh = deferred<SessionDescriptor[]>();
        const list = jest.spyOn(adapter, 'listSessions')
          .mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
        const oldRefresh = harness.coordinator.refreshRoster();
        await flushMaintenance();
        jest.spyOn(adapter, 'probe').mockResolvedValueOnce(false);
        const recovery = harness.coordinator.probeActive(2_000, 'foreground');
        await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(2);
        stale.reject(new SessionCatalogSupersededError());
        await oldRefresh;
        const joined = harness.coordinator.refreshRoster();
        await flushMaintenance();
        expect(list).toHaveBeenCalledTimes(2);
        fresh.resolve([{ ...session('alpha', 50), title: 'Current ready catalog' }]);
        await recovery; await joined;
        expect(harness.coordinator.getSnapshot().roster[0].agents[0].sessions[0].title)
          .toBe('Current ready catalog');
        expect(list).toHaveBeenCalledTimes(2);
      } finally { await harness.coordinator.stop(); }
    });

    it.each(['network', 'server'] as const)('keeps ordinary catalog %s failures even with identical cancellation prose', async code => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        jest.spyOn(adapter, 'listSessions').mockRejectedValueOnce(new AdapterError(code, 'Session catalog read was superseded'));
        const probe = jest.spyOn(adapter, 'probe').mockResolvedValueOnce(true);
        await harness.coordinator.refreshRoster(); await flushMaintenance();
        expect(probe).toHaveBeenCalledWith(5_000);
        expect(harness.coordinator.getSnapshot().error).toMatchObject({ operation: 'roster' });
      } finally { await harness.coordinator.stop(); }
    });

    it.each([true, false])('checks health after a roster failure before deciding recovery (healthy=%s)', async (healthy) => {
      const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
      try {
        await harness.coordinator.start();
        const adapter = harness.getAdapter();
        jest.spyOn(adapter, 'listSessions').mockRejectedValueOnce(new Error('request timed out'));
        const pending = deferred<boolean>();
        const probe = jest.spyOn(adapter, 'probe').mockReturnValueOnce(pending.promise);
        const disconnect = jest.spyOn(adapter, 'disconnect');
        const connect = jest.spyOn(adapter, 'connect');
        await harness.coordinator.refreshRoster();
        await flushMaintenance();
        expect(probe).toHaveBeenCalledWith(5_000);
        expect(disconnect).not.toHaveBeenCalled();
        expect(harness.coordinator.getSnapshot().error).toBeNull();
        pending.resolve(healthy);
        await flushMaintenance();
        if (healthy) {
          expect(disconnect).not.toHaveBeenCalled();
          expect(harness.coordinator.getSnapshot().error).toMatchObject({ operation: 'roster' });
        } else {
          expect(disconnect).toHaveBeenCalledTimes(1);
          expect(connect).toHaveBeenCalledTimes(1);
          expect(harness.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', recoveryFailed: false, error: null });
        }
      } finally { await harness.coordinator.stop(); }
    });

    it.each(['failed', 'rejected', 'succeeded'] as const)('ignores a %s probe from a retired connection phase', async (outcome) => {
      const secureStorage = new MemorySecureStorage();
      const store = new ConnectionStore({ secureStorage, legacyStorage });
      await store.load();
      await store.add({ ...connectionInput('alpha'), backendKind });
      const dashboardStorage = new MemoryDashboardStorage();
      let control!: ReturnType<typeof controllableAdapter>;
      const coordinator = new ConnectionCoordinator({
        store,
        cache: new RosterCache({ storage: dashboardStorage }),
        watermarks: new UnreadWatermarks({ storage: dashboardStorage }),
        rosterRefreshIntervalMs: 0,
        hermesProbeIntervalMs: 0,
        adapterFactory: (_record, descriptor) => {
          control = controllableAdapter(descriptor, async emitState => {
            emitState('connecting'); emitState('ready');
          });
          return control.adapter;
        },
      });
      try {
        await coordinator.start();
        const pending = deferred<boolean>();
        const probeMock = jest.spyOn(control.adapter, 'probe').mockReturnValue(pending.promise);
        const disconnect = jest.spyOn(control.adapter, 'disconnect');
        const connect = jest.spyOn(control.adapter, 'connect');
        const probe = coordinator.probeActive(undefined, 'foreground');
        await Promise.resolve();
        expect(probeMock).toHaveBeenCalledTimes(1);
        control.emitState('reconnecting');
        control.emitState('handshaking');
        // Failures must not tear down a recovered socket; a stale success must
        // not finish recovery while its replacement is still authenticating.
        if (outcome !== 'succeeded') control.emitState('ready');
        if (outcome === 'rejected') pending.reject(new Error('old socket timed out'));
        else pending.resolve(outcome === 'succeeded');
        await probe;
        expect(disconnect).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(coordinator.getSnapshot()).toMatchObject({
          activeState: outcome === 'succeeded' ? 'handshaking' : 'ready',
          recovering: outcome === 'succeeded', recoveryFailed: false, error: null,
        });
      } finally { await coordinator.stop(); }
    });
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

  it('coalesces Hermes probes and defers optional roster work until health is confirmed', async () => {
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


describe('foreground recovery presentation for both backends', () => {
  it.each(['openclaw', 'hermes'] as const)('keeps healthy %s ready during a pending foreground probe', async (backendKind) => {
    const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
    try {
      await harness.coordinator.start();
      const pending = deferred<boolean>();
      jest.spyOn(harness.getAdapter(), 'probe').mockReturnValue(pending.promise);
      const probe = harness.coordinator.probeActive(undefined, 'foreground');
      await Promise.resolve();
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: false, recoveryFailed: false, error: null });
      pending.resolve(true);
      await probe;
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: false, error: null });
    } finally { await harness.coordinator.stop(); }
  });

  it.each(['openclaw', 'hermes'] as const)('keeps %s transient failures quiet until the recovery deadline', async (backendKind) => {
    jest.useFakeTimers();
    const harness = await createMaintenanceHarness(backendKind, { rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0 });
    try {
      await harness.coordinator.start();
      const adapter = harness.getAdapter();
      jest.spyOn(adapter, 'probe').mockRejectedValue(new Error('health timed out'));
      await harness.coordinator.probeActive(undefined, 'foreground');
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: true, error: null });
      jest.advanceTimersByTime(20_000);
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: false, recoveryFailed: true, error: { operation: 'probe' } });
      harness.coordinator.setAppActive(false);
      jest.advanceTimersByTime(120_000);
      harness.coordinator.setAppActive(true);
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: true, error: null });
      jest.spyOn(adapter, 'probe').mockResolvedValue(true);
      await harness.coordinator.probeActive(undefined, 'foreground');
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: false, recoveryFailed: false, error: null });
      await harness.coordinator.pauseConnection('alpha');
      await harness.coordinator.probeActive(undefined, 'foreground');
      expect(harness.coordinator.getSnapshot()).toMatchObject({ recovering: false, activeAdapter: null });
    } finally {
      await harness.coordinator.stop();
      jest.useRealTimers();
    }
  });
});

it.each(['openclaw', 'hermes'] as const)('retains the reached %s handshake stage and does not label unknown failures as network', async backendKind => {
  const store = new ConnectionStore({ secureStorage: new MemorySecureStorage(), legacyStorage });
  await store.load(); await store.add({ ...connectionInput('alpha'), backendKind });
  const storage = new MemoryDashboardStorage();
  const failed = jest.fn();
  const coordinator = new ConnectionCoordinator({
    store, cache: new RosterCache({ storage }), watermarks: new UnreadWatermarks({ storage }),
    rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0,
    telemetry: { attempt: jest.fn(), ready: jest.fn(), failed, reconnect: jest.fn() },
    adapterFactory: (_record, descriptor) => controllableAdapter(descriptor, async emitState => {
      emitState('connecting'); emitState('handshaking'); emitState('offline');
      throw new Error('Unclassified failure with private details');
    }).adapter,
  });
  await coordinator.start();
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ backendKind }), 'unknown', 'handshake', 1);
  await coordinator.stop();
});

describe('network restoration uses shared recovery without replaying sends', () => {
  const wifi = { type: 'WIFI', isConnected: true, isInternetReachable: true };
  const offline = { type: 'NONE', isConnected: false, isInternetReachable: false };
  const backends = ['openclaw', 'hermes', 'codex', 'claude-code', 'pi'] as const;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function setup(backendKind: ConnectionDescriptor['backendKind']) {
    const store = new ConnectionStore({ secureStorage: new MemorySecureStorage(), legacyStorage });
    await store.load(); await store.add({ ...connectionInput('alpha'), backendKind });
    const storage = new MemoryDashboardStorage();
    let control!: ReturnType<typeof controllableAdapter>;
    const coordinator = new ConnectionCoordinator({
      store, cache: new RosterCache({ storage }), watermarks: new UnreadWatermarks({ storage }),
      rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0,
      adapterFactory: (_record, descriptor) => {
        control = controllableAdapter(descriptor, async emitState => { emitState('connecting'); emitState('ready'); });
        return control.adapter;
      },
    });
    await coordinator.start();
    const probe = jest.spyOn(control.adapter, 'probe').mockResolvedValue(true);
    const connect = jest.spyOn(control.adapter, 'connect');
    const disconnect = jest.spyOn(control.adapter, 'disconnect');
    const prompt = jest.spyOn(control.adapter, 'prompt');
    coordinator.observeNetworkState(wifi);
    return { coordinator, control, probe, connect, disconnect, prompt };
  }

  it.each(backends)('checks %s ready health on the new path without reconnecting or sending', async backend => {
    const h = await setup(backend);
    const recovered = jest.fn(); const unsubscribe = onAdapterPathRecovered(h.control.adapter, recovered);
    try {
      await h.coordinator.probeActive(undefined, 'foreground'); h.probe.mockClear();
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      await jest.advanceTimersByTimeAsync(300);
      expect(h.probe).toHaveBeenCalledTimes(1);
      expect(h.connect).not.toHaveBeenCalled(); expect(h.disconnect).not.toHaveBeenCalled();
      expect(h.prompt).not.toHaveBeenCalled();
      expect(h.coordinator.getSnapshot().activeState).toBe('ready');
      expect(recovered).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); await h.coordinator.stop(); }
  });

  it.each(backends)('advances one pending %s reconnect after restoration and waits for actual ready', async backend => {
    const h = await setup(backend);
    const recovered = jest.fn(); const unsubscribe = onAdapterPathRecovered(h.control.adapter, recovered);
    try {
      h.coordinator.observeNetworkState(offline); h.control.emitState('reconnecting');
      const handshake = deferred<void>();
      h.connect.mockImplementation(() => { h.control.emitState('handshaking'); return handshake.promise; });
      h.coordinator.observeNetworkState(wifi); await jest.advanceTimersByTimeAsync(300);
      expect(h.probe).not.toHaveBeenCalled(); expect(h.connect).toHaveBeenCalledTimes(1);
      expect(h.coordinator.getSnapshot().activeState).toBe('handshaking');
      expect(h.prompt).not.toHaveBeenCalled();
      h.coordinator.observeNetworkState(wifi); await jest.advanceTimersByTimeAsync(1_000);
      expect(h.connect).toHaveBeenCalledTimes(1);
      h.control.emitState('ready'); handshake.resolve(); await jest.advanceTimersByTimeAsync(0);
      expect(h.coordinator.getSnapshot().activeState).toBe('ready');
      expect(recovered).not.toHaveBeenCalled(); // Native ready already owns this path.
    } finally { unsubscribe(); await h.coordinator.stop(); }
  });

  it.each(['connecting', 'handshaking'] as const)('does not tear down %s on a network hint', async state => {
    const h = await setup('openclaw');
    try {
      h.control.emitState(state); h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      await jest.advanceTimersByTimeAsync(300);
      expect(h.connect).not.toHaveBeenCalled(); expect(h.disconnect).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.coordinator.stop(); }
  });

  it.each(backends.flatMap(backend => (['connecting', 'handshaking'] as const).map(state => ({ backend, state }))))(
    'joins the existing $backend $state attempt after foreground without retiring its socket',
    async ({ backend, state }) => {
      const h = await setup(backend);
      const handshake = deferred<void>();
      try {
        h.coordinator.setAppActive(false);
        h.control.emitState('reconnecting');
        h.control.emitState(state);
        h.connect.mockReturnValue(handshake.promise);
        h.coordinator.setAppActive(true);
        const resumed = h.coordinator.probeActive(2_000, 'foreground');
        const sendPreflight = recoverAdapterConnection(h.control.adapter, 1_500);
        await jest.advanceTimersByTimeAsync(2_001);

        expect(h.connect).toHaveBeenCalledTimes(1);
        expect(h.probe).not.toHaveBeenCalled();
        expect(h.disconnect).not.toHaveBeenCalled();
        expect(h.prompt).not.toHaveBeenCalled();
        expect(h.coordinator.getSnapshot().activeState).toBe(state);
        h.control.emitState('ready');
        handshake.resolve();
        await expect(Promise.all([resumed, sendPreflight])).resolves.toEqual([true, true]);
        expect(h.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', recovering: false, error: null });
      } finally { handshake.resolve(); await h.coordinator.stop(); }
    },
  );

  it('surfaces the joined handshake deadline without starting a second attempt', async () => {
    const h = await setup('openclaw');
    try {
      h.control.emitState('handshaking');
      h.connect.mockImplementation(() => new Promise<void>((_resolve, reject) => {
        setTimeout(() => {
          h.control.emitState('offline', 'Connection handshake timed out');
          reject(new Error('Connection handshake timed out'));
        }, 30_000);
      }));
      const resumed = h.coordinator.probeActive(2_000, 'foreground');
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(resumed).resolves.toBe(false);
      expect(h.connect).toHaveBeenCalledTimes(1);
      expect(h.disconnect).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.coordinator.getSnapshot()).toMatchObject({
        activeState: 'offline', error: { operation: 'probe', message: 'Connection handshake timed out' },
      });
    } finally { await h.coordinator.stop(); }
  });

  it('does not certify an earlier foreground after another background gap while joining the same handshake', async () => {
    const h = await setup('codex');
    const handshake = deferred<void>();
    try {
      h.control.emitState('handshaking');
      h.connect.mockReturnValue(handshake.promise);
      const previous = h.coordinator.probeActive(2_000, 'foreground');
      await jest.advanceTimersByTimeAsync(0);
      h.coordinator.setAppActive(false);
      h.coordinator.setAppActive(true);
      const current = h.coordinator.probeActive(2_000, 'foreground');
      await jest.advanceTimersByTimeAsync(0);
      h.control.emitState('ready');
      handshake.resolve();
      await expect(Promise.all([previous, current])).resolves.toEqual([false, true]);
      expect(h.disconnect).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.prompt).not.toHaveBeenCalled();
      expect(h.coordinator.getSnapshot()).toMatchObject({ activeState: 'ready', recovering: false, error: null });
    } finally { handshake.resolve(); await h.coordinator.stop(); }
  });

  it('ignores readiness from a joined attempt after its coordinator is stopped', async () => {
    const h = await setup('hermes');
    const handshake = deferred<void>();
    try {
      h.control.emitState('handshaking');
      h.connect.mockReturnValue(handshake.promise);
      const resumed = h.coordinator.probeActive(2_000, 'foreground');
      await jest.advanceTimersByTimeAsync(0);
      await h.coordinator.stop();
      h.control.emitState('ready');
      handshake.resolve();
      await expect(resumed).resolves.toBe(false);
      expect(h.coordinator.getSnapshot().activeAdapter).toBeNull();
      expect(h.prompt).not.toHaveBeenCalled();
    } finally { handshake.resolve(); await h.coordinator.stop(); }
  });

  it('fences old path probes and never makes the stale response tear down a healthy successor', async () => {
    const h = await setup('hermes');
    try {
      const old = deferred<boolean>(); h.probe.mockReturnValueOnce(old.promise);
      const pending = h.coordinator.probeActive(undefined, 'foreground'); await Promise.resolve();
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      await jest.advanceTimersByTimeAsync(300); expect(h.probe).toHaveBeenCalledTimes(2);
      old.resolve(false); await pending;
      expect(h.disconnect).not.toHaveBeenCalled(); expect(h.coordinator.getSnapshot().activeState).toBe('ready');
    } finally { await h.coordinator.stop(); }
  });

  it('cancels network work on background or coordinator shutdown', async () => {
    const h = await setup('codex');
    try {
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      h.coordinator.setAppActive(false); await jest.advanceTimersByTimeAsync(1_000);
      h.coordinator.setAppActive(true); await jest.advanceTimersByTimeAsync(1_000);
      expect(h.probe).not.toHaveBeenCalled();
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      await h.coordinator.stop(); await jest.advanceTimersByTimeAsync(1_000);
      expect(h.probe).not.toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
    } finally { await h.coordinator.stop(); }
  });

  it.each(['background', 'stop', 'new-path', 'failed-health'] as const)('does not notify current history when network probe outlives %s', async change => {
    const h = await setup('claude-code');
    const recovered = jest.fn(); const unsubscribe = onAdapterPathRecovered(h.control.adapter, recovered);
    const pending = deferred<boolean>(); h.probe.mockReturnValueOnce(pending.promise);
    try {
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      await jest.advanceTimersByTimeAsync(300);
      if (change === 'background') h.coordinator.setAppActive(false);
      if (change === 'stop') await h.coordinator.stop();
      if (change === 'new-path') h.coordinator.observeNetworkState(offline);
      if (change === 'failed-health') h.connect.mockRejectedValueOnce(new Error('still offline'));
      pending.resolve(change !== 'failed-health'); await jest.advanceTimersByTimeAsync(0);
      expect(recovered).not.toHaveBeenCalled();
    } finally { unsubscribe(); await h.coordinator.stop(); }
  });

  it.each(backends)('halts automatic %s retries on explicit auth failure until manual reconnect', async backend => {
    const h = await setup(backend);
    try {
      h.control.emitState('error', 'auth_rejected');
      await jest.advanceTimersByTimeAsync(0);
      expect(h.disconnect).toHaveBeenCalledTimes(1);
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      h.coordinator.setAppActive(false); h.coordinator.setAppActive(true);
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(h.coordinator.probeActive(undefined, 'foreground')).resolves.toBe(false);
      await expect(recoverAdapterConnection(h.control.adapter)).resolves.toBe(false);
      expect(h.probe).not.toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
      expect(h.coordinator.getSnapshot().recoveryFailed).toBe(true);
      await h.coordinator.reconnectConnection('alpha');
      expect(h.coordinator.getSnapshot().activeAdapter).not.toBe(h.control.adapter);
      expect(h.coordinator.getSnapshot().activeState).toBe('ready');
      expect(h.coordinator.getSnapshot().recoveryFailed).toBe(false);
    } finally { await h.coordinator.stop(); }
  });

  it('uses a structured unauthorized code even if the native message has no recognizable keyword', async () => {
    const h = await setup('claude-code');
    try {
      h.control.emitState('offline');
      h.connect.mockRejectedValueOnce(Object.assign(new Error('Credentials need attention'), { code: 'unauthorized' }));
      await expect(h.coordinator.probeActive()).resolves.toBe(false);
      h.connect.mockClear(); h.probe.mockClear();
      h.coordinator.observeNetworkState(offline); h.coordinator.observeNetworkState(wifi);
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(h.coordinator.probeActive()).resolves.toBe(false);
      expect(h.connect).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.coordinator.stop(); }
  });

  it('does not reconnect when a ready health probe reports a structured auth rejection', async () => {
    const h = await setup('codex');
    try {
      h.probe.mockRejectedValueOnce(Object.assign(new Error('Credentials need attention'), { code: 'unauthorized' }));
      await expect(h.coordinator.probeActive()).resolves.toBe(false);
      await jest.advanceTimersByTimeAsync(0);
      expect(h.connect).not.toHaveBeenCalled(); expect(h.disconnect).toHaveBeenCalledTimes(1);
      await expect(h.coordinator.probeActive()).resolves.toBe(false);
      expect(h.probe).toHaveBeenCalledTimes(1);
    } finally { await h.coordinator.stop(); }
  });
});
