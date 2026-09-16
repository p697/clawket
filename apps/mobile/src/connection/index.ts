import { updateRunActivities, type RunActivity } from './run-activity';
import { clearUncertainSends } from '../chat/sendRecovery';
import type {
  AgentAdapter,
  AgentDescriptor,
  ConnectionDescriptor,
  ConnectionRecord,
  ConnectionState,
  SessionDescriptor,
} from '@clawket/agent-protocol';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { analyticsEvents } from '../services/analytics/events';
import { getMessageQueueStore } from '../chat/messageQueue';
import { ChatCacheService } from '../services/chat-cache';
import { SessionPreferencesService } from '../services/session-preferences';
import {
  StorageService,
  type YouMindAuthSession,
} from '../services/storage';

import {
  ConnectionNotFoundError,
  connectionStore,
  type ConnectionAdapterFactory,
  type ConnectionAdapterFactoryContext,
  type ConnectionRecordPatch,
  type ConnectionRecordReplacement,
  type ConnectionStore,
  type ConnectionStoreSnapshot,
  type ConnectionUpsertResult,
  type NewConnectionRecord,
} from './registry/connection-store';
import {
  aggregateRoster,
  rosterCache,
  type RosterCache,
  type RosterCacheSnapshot,
  type RosterConnectionGroup,
  type RosterSnapshotInput,
} from './registry/roster-cache';
import {
  unreadWatermarks,
  type SessionWatermarks,
  type UnreadWatermarks,
  type WatermarkSession,
} from './registry/unread-watermarks';
import { createConnectionAdapter } from './adapters';
import { ConnectionRecoveryWindow, requiresConnectionAction } from './recovery-window';
import { pausedConnectionStore, type PausedConnectionStore } from './registry/paused-connections';
import { ownConnectionRuntime } from './runtime-owner';
import {
  readConnectionRuntimeMetadata,
  type ConnectionRuntimeDetails,
} from './runtime-details';

export type ConnectionRuntimeFailure = Readonly<{
  operation: 'load' | 'connect' | 'roster' | 'probe' | 'remove';
  connectionId?: string;
  message: string;
}>;

export type ConnectionRuntimeSnapshot = Readonly<{
  revision: number;
  initialized: boolean;
  switching: boolean;
  launchPaywallShownThisProcess: boolean;
  connectionsRevision: number;
  connections: ReadonlyArray<ConnectionDescriptor>;
  activeConnectionId: string | null;
  freeConnectionId: string | null;
  activeAdapter: AgentAdapter | null;
  activeState: ConnectionState;
  runActivities?: ReadonlyArray<RunActivity>;
  recovering?: boolean;
  recoveryFailed?: boolean;
  pausedConnectionIds?: ReadonlyArray<string>;
  connectionDetails: Readonly<Record<string, ConnectionRuntimeDetails>>;
  roster: ReadonlyArray<RosterConnectionGroup>;
  error: ConnectionRuntimeFailure | null;
}>;

type ConnectionStorePort = Pick<
  ConnectionStore,
  | 'add'
  | 'createAdapter'
  | 'getRuntimeRecord'
  | 'getSnapshot'
  | 'load'
  | 'remove'
  | 'replace'
  | 'rollback'
  | 'setActive'
  | 'setFreeConnection'
  | 'subscribe'
  | 'update'
  | 'upsert'
>;

type RosterCachePort = Pick<RosterCache, 'getMany' | 'remove' | 'set'>;
type ConnectionChatCachePort = Pick<typeof ChatCacheService, 'clearConnection'>;
type ConnectionSessionPreferencesPort = Pick<
  typeof SessionPreferencesService,
  'clearConnection'
>;
type ConnectionCredentialStorePort = Pick<
  typeof StorageService,
  'deleteDeviceToken' | 'getIdentity'
>;
type UnreadWatermarksPort = Pick<
  UnreadWatermarks,
  'clearConnection' | 'get' | 'markOpened' | 'markPromptSucceeded'
>;

export interface ConnectionCoordinatorOptions {
  store?: ConnectionStorePort;
  pausedStore?: PausedConnectionStore;
  cache?: RosterCachePort;
  chatCache?: ConnectionChatCachePort;
  sessionPreferences?: ConnectionSessionPreferencesPort;
  credentialStore?: ConnectionCredentialStorePort;
  watermarks?: UnreadWatermarksPort;
  adapterFactory?: ConnectionAdapterFactory;
  now?: () => number;
  telemetry?: ConnectionTelemetry;
  rosterRefreshIntervalMs?: number;
  hermesProbeIntervalMs?: number;
}

export interface ConnectionTelemetry {
  attempt(connection: ConnectionDescriptor, reason: ConnectReason): void;
  ready(connection: ConnectionDescriptor, elapsedMs: number, attempt: number): void;
  failed(
    connection: ConnectionDescriptor,
    code: string,
    stage: 'socket' | 'handshake' | 'ready',
    attempt: number,
  ): void;
  reconnect(connection: ConnectionDescriptor, reason: ReconnectReason): void;
}

type ConnectionIdentityDetailDependencies = Readonly<{
  getRuntimeConnectionRecord: (connectionId: string) => Promise<ConnectionRecord>;
  getYouMindAuthSession: (
    url: string,
    scopeKey?: string | null,
    options?: { allowLegacyFallback?: boolean },
  ) => Promise<YouMindAuthSession | null>;
}>;

type ConnectReason = 'launch' | 'switch' | 'foreground' | 'manual' | 'retry';
type ReconnectReason = 'tick_timeout' | 'socket_close' | 'probe_failed' | 'seq_gap' | 'foreground';

type ActiveAdapterEntry = {
  connectionId: string;
  adapter: AgentAdapter;
  factoryRevision: number;
  unsubscribers: Array<() => void>;
  attempt: number;
  connectStartedAt: number;
  lastState: ConnectionState;
  rosterRefreshTimer: ReturnType<typeof setInterval> | null;
  hermesProbeTimer: ReturnType<typeof setInterval> | null;
  rosterRefreshInFlight: Promise<void> | null;
  readyRefresh: Promise<void> | null;
  readyRevision: number;
  hasReportedReady: boolean;
  probeInFlight: Promise<boolean> | null;
  probeReconnectReason: Extract<ReconnectReason, 'probe_failed' | 'foreground'> | null;
  maintenanceTail: Promise<void>;
  sessionSnapshotRevision: number;
};

export const DEFAULT_ROSTER_REFRESH_INTERVAL_MS = 30_000;
export const DEFAULT_HERMES_PROBE_INTERVAL_MS = 15_000;

const EMPTY_CONNECTIONS = Object.freeze([]) as ReadonlyArray<ConnectionDescriptor>;
const EMPTY_ROSTER = Object.freeze([]) as ReadonlyArray<RosterConnectionGroup>;
const EMPTY_CONNECTION_DETAILS = Object.freeze({}) as Readonly<Record<
  string,
  ConnectionRuntimeDetails
>>;

const INITIAL_SNAPSHOT: ConnectionRuntimeSnapshot = Object.freeze({
  revision: 0,
  initialized: false,
  switching: false,
  launchPaywallShownThisProcess: false,
  connectionsRevision: 0,
  connections: EMPTY_CONNECTIONS,
  activeConnectionId: null,
  freeConnectionId: null,
  activeAdapter: null,
  activeState: 'idle',
  connectionDetails: EMPTY_CONNECTION_DETAILS,
  roster: EMPTY_ROSTER,
  error: null,
});

/**
 * Owns the one-live-connection invariant independently from React. Adapters for
 * inactive connections are not retained; their roster data comes from cache.
 */
export class ConnectionCoordinator {
  private readonly store: ConnectionStorePort;
  private readonly cache: RosterCachePort;
  private readonly chatCache: ConnectionChatCachePort;
  private readonly sessionPreferences: ConnectionSessionPreferencesPort;
  private readonly credentialStore: ConnectionCredentialStorePort;
  private readonly watermarks: UnreadWatermarksPort;
  private readonly now: () => number;
  private readonly telemetry: ConnectionTelemetry;
  private readonly rosterRefreshIntervalMs: number | null;
  private readonly hermesProbeIntervalMs: number | null;
  private readonly listeners = new Set<() => void>();
  private readonly rosterInputs = new Map<string, RosterSnapshotInput>();
  private readonly connectionDetails = new Map<string, ConnectionRuntimeDetails>();

  private readonly pausedStore: PausedConnectionStore;
  private pausedIds: ReadonlyArray<string> = [];
  private rosterMemo: { inputs: RosterSnapshotInput[]; activeId: string | null; value: ReadonlyArray<RosterConnectionGroup> } | null = null;
  private adapterFactory: ConnectionAdapterFactory | null;
  private adapterFactoryRevision = 0;
  private active: ActiveAdapterEntry | null = null;
  private storeUnsubscribe: (() => void) | null = null;
  private operation: Promise<void> = Promise.resolve();
  private startPromise: Promise<ConnectionRuntimeSnapshot> | null = null;
  private retired = false;
  private reconcileScheduled = false;
  private started = false;
  private lifecycleRevision = 0;
  private snapshot: ConnectionRuntimeSnapshot = INITIAL_SNAPSHOT;
  private error: ConnectionRuntimeFailure | null = null;
  private nextConnectReason: ConnectReason = 'launch';
  private runActivities: ReadonlyArray<RunActivity> = [];
  private readonly recovery = new ConnectionRecoveryWindow(() => this.publish());

  setAppActive(active: boolean): void {
    this.recovery.setActive(active);
    this.publish();
  }

  constructor(options: ConnectionCoordinatorOptions = {}) {
    this.store = options.store ?? connectionStore;
    this.pausedStore = options.pausedStore ?? pausedConnectionStore;
    this.cache = options.cache ?? rosterCache;
    this.chatCache = options.chatCache ?? ChatCacheService;
    this.sessionPreferences = options.sessionPreferences ?? SessionPreferencesService;
    this.credentialStore = options.credentialStore ?? StorageService;
    this.watermarks = options.watermarks ?? unreadWatermarks;
    this.adapterFactory = options.adapterFactory ?? null;
    this.now = options.now ?? Date.now;
    this.telemetry = options.telemetry ?? defaultConnectionTelemetry;
    this.rosterRefreshIntervalMs = readMaintenanceInterval(
      options.rosterRefreshIntervalMs,
      DEFAULT_ROSTER_REFRESH_INTERVAL_MS,
    );
    this.hermesProbeIntervalMs = readMaintenanceInterval(
      options.hermesProbeIntervalMs,
      DEFAULT_HERMES_PROBE_INTERVAL_MS,
    );
  }

  getSnapshot = (): ConnectionRuntimeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getAdapter(connectionId: string | null | undefined): AgentAdapter | null {
    if (!connectionId || this.active?.connectionId !== connectionId) return null;
    return this.active.adapter;
  }

  /**
   * Trusted-runtime escape hatch for credential-dependent sidecars. The
   * returned record is a defensive clone and is never published in snapshots.
   */
  async getRuntimeConnectionRecord(connectionId: string): Promise<ConnectionRecord> {
    return this.store.getRuntimeRecord(connectionId);
  }

  setAdapterFactory(factory: ConnectionAdapterFactory): void {
    if (this.adapterFactory === factory) return;
    this.adapterFactory = factory;
    this.adapterFactoryRevision += 1;
    if (!this.started) return;
    this.disconnectActiveImmediately();
    this.scheduleReconcile();
  }

  async start(): Promise<ConnectionRuntimeSnapshot> {
    if (this.retired) return this.snapshot;
    if (this.startPromise) return this.startPromise;
    this.started = true;
    const lifecycleRevision = ++this.lifecycleRevision;
    this.startPromise = this.enqueue(async () => {
      try {
        const storeSnapshot = await this.store.load();
        this.pausedIds = await this.pausedStore.read();
        if (!this.started || lifecycleRevision !== this.lifecycleRevision) return this.snapshot;
        this.storeUnsubscribe ??= this.store.subscribe(this.handleStoreChange);
        await this.hydrateRosterCaches(storeSnapshot);
        if (!this.started || lifecycleRevision !== this.lifecycleRevision) return this.snapshot;
        this.publish({ initialized: true });
        await this.reconcileActiveAdapter(storeSnapshot);
        if (this.started && lifecycleRevision === this.lifecycleRevision) this.publish({ initialized: true });
      } catch (error) {
        if (!this.started || lifecycleRevision !== this.lifecycleRevision) return this.snapshot;
        this.error = failure('load', error);
        this.publish({ initialized: true, switching: false });
      }
      return this.snapshot;
    });
    return this.startPromise;
  }

  /** A superseded process owner must never be revived by a stale React effect. */
  retire(): void {
    this.retired = true;
    void this.stop().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.started = false;
    const lifecycleRevision = ++this.lifecycleRevision;
    this.startPromise = null;
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.disconnectActiveImmediately();
    await this.enqueue(async () => {
      if (lifecycleRevision !== this.lifecycleRevision) return;
      this.error = null;
      this.publish({ initialized: false, switching: false });
    });
  }

  async whenIdle(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.operation;
      await pending;
    } while (pending !== this.operation);
  }

  async activate(connectionId: string): Promise<ConnectionRuntimeSnapshot> {
    if (this.store.getSnapshot().activeConnectionId !== connectionId) {
      this.nextConnectReason = 'switch';
    }
    if (this.pausedIds.includes(connectionId)) {
      const next = this.pausedIds.filter((id) => id !== connectionId);
      await this.pausedStore.write(next);
      this.pausedIds = next;
    }
    await this.store.setActive(connectionId);
    this.scheduleReconcile();
    await this.whenIdle();
    return this.snapshot;
  }

  async pauseConnection(connectionId: string): Promise<void> {
    await this.store.getRuntimeRecord(connectionId);
    await this.enqueue(async () => {
      const next = [...new Set([...this.pausedIds, connectionId])];
      await this.pausedStore.write(next);
      this.pausedIds = next;
      if (this.active?.connectionId === connectionId) this.disconnectActiveImmediately();
      this.publish({ switching: false });
    });
  }

  /** An explicit user reconnect always creates a fresh adapter and backend handshake. */
  async reconnectConnection(connectionId: string): Promise<ConnectionRuntimeSnapshot> {
    const alreadyActive = this.active?.connectionId === connectionId;
    await this.activate(connectionId);
    if (!alreadyActive) return this.snapshot;
    await this.enqueue(async () => {
      if (this.store.getSnapshot().activeConnectionId !== connectionId) return;
      this.nextConnectReason = 'manual';
      this.disconnectActiveImmediately();
      await this.reconcileActiveAdapter(this.store.getSnapshot());
    });
    return this.snapshot;
  }

  async addConnection(input: NewConnectionRecord): Promise<ConnectionDescriptor> {
    const descriptor = await this.store.add(input);
    await this.whenIdle();
    return descriptor;
  }

  async upsertConnection(input: NewConnectionRecord): Promise<ConnectionUpsertResult> {
    const result = await this.store.upsert(input);
    if (!result.created && this.active?.connectionId === result.connection.id) {
      this.disconnectActiveImmediately();
      this.scheduleReconcile();
    }
    await this.whenIdle();
    return result;
  }

  async replaceConnection(
    connectionId: string,
    replacement: ConnectionRecordReplacement,
  ): Promise<ConnectionDescriptor> {
    const descriptor = await this.store.replace(connectionId, replacement);
    if (this.active?.connectionId === connectionId) {
      this.disconnectActiveImmediately();
      this.scheduleReconcile();
      await this.whenIdle();
    }
    return descriptor;
  }

  async updateConnection(
    connectionId: string,
    patch: ConnectionRecordPatch,
  ): Promise<ConnectionDescriptor> {
    const descriptor = await this.store.update(connectionId, patch);
    if (this.active?.connectionId === connectionId) {
      this.disconnectActiveImmediately();
      this.scheduleReconcile();
      await this.whenIdle();
    }
    return descriptor;
  }

  async removeConnection(connectionId: string): Promise<boolean> {
    let record: ConnectionRecord;
    try {
      record = await this.store.getRuntimeRecord(connectionId);
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) return false;
      throw error;
    }
    const removed = await this.store.remove(connectionId);
    if (!removed) return false;
    this.pausedIds = this.pausedIds.filter((id) => id !== connectionId);
    this.rosterInputs.delete(connectionId);
    this.connectionDetails.delete(connectionId);
    // Undelivered composer queues belong to the connection; drop them with it.
    getMessageQueueStore().clearConnection(connectionId);
    clearUncertainSends(connectionId);
    const cleanupPromise = Promise.allSettled([
      this.pausedStore.write(this.pausedIds),
      this.cache.remove(connectionId),
      this.chatCache.clearConnection(connectionId),
      this.sessionPreferences.clearConnection(connectionId),
      this.watermarks.clearConnection(connectionId),
      this.clearConnectionDeviceTokens(record),
    ]);
    // Removal must not wait for the fallback connection's network handshake.
    // Store reconciliation continues independently after the durable removal.
    if (this.error?.connectionId === connectionId) this.error = null;
    this.publish();
    const cleanup = await cleanupPromise;
    if (cleanup.some((result) => result.status === 'rejected')) {
      this.error = failure(
        'remove',
        new Error('Connection data was removed, but some local data cleanup failed.'),
        connectionId,
      );
    }
    this.publish();
    return true;
  }

  private async clearConnectionDeviceTokens(record: ConnectionRecord): Promise<void> {
    // HTTP-stream connections do not use Gateway device identities.
    if (record.transportKind === 'https') return;
    const identity = await this.credentialStore.getIdentity();
    if (!identity) return;
    const baseScope = record.transportKind === 'relay'
      && record.relay?.serverUrl?.trim()
      && record.relay.gatewayId?.trim()
      ? {
        serverUrl: record.relay.serverUrl.trim().replace(/\/+$/, ''),
        gatewayId: record.relay.gatewayId.trim(),
      }
      : { gatewayUrl: record.url.trim().replace(/\/+$/, '') };
    await Promise.all([
      this.credentialStore.deleteDeviceToken(identity.deviceId, baseScope),
      this.credentialStore.deleteDeviceToken(identity.deviceId, { ...baseScope, role: 'node' }),
    ]);
  }

  async setFreeConnection(connectionId: string): Promise<ConnectionRuntimeSnapshot> {
    await this.store.setFreeConnection(connectionId);
    await this.whenIdle();
    return this.snapshot;
  }

  /**
   * Claims the one automatic launch-paywall opportunity for this process.
   * This deliberately survives coordinator stop/start cycles and is never
   * persisted, so reconnects and connection switches cannot show it again.
   */
  markLaunchPaywallShown(): boolean {
    if (this.snapshot.launchPaywallShownThisProcess) return false;
    this.publish({ launchPaywallShownThisProcess: true });
    return true;
  }

  async rollbackConnections(): Promise<ConnectionRuntimeSnapshot> {
    await this.store.rollback();
    this.disconnectActiveImmediately();
    this.scheduleReconcile();
    await this.whenIdle();
    return this.snapshot;
  }

  async refreshRoster(): Promise<ReadonlyArray<RosterConnectionGroup>> {
    await this.enqueue(async () => {
      const entry = this.active;
      if (entry) await this.refreshActiveRoster(entry);
    });
    return this.snapshot.roster;
  }

  async probeActive(
    timeoutMs?: number,
    reconnectReason: Extract<ReconnectReason, 'probe_failed' | 'foreground'> = 'probe_failed',
  ): Promise<boolean> {
    let entry = this.active;
    if (!entry) {
      if (
        !this.started
        || !this.adapterFactory
        || !this.store.getSnapshot().activeConnectionId
      ) return false;
      this.nextConnectReason = 'retry';
      this.scheduleReconcile();
      await this.whenIdle();
      entry = this.active;
      if (!entry) return false;
    }
    if (this.recovery.phase === 'failed') {
      this.recovery.begin(true);
      this.publish();
    }
    return this.probeEntry(entry, timeoutMs, reconnectReason);
  }

  private async performActiveProbe(
    entry: ActiveAdapterEntry,
    timeoutMs?: number,
    reconnectReason: Extract<ReconnectReason, 'probe_failed' | 'foreground'> = 'probe_failed',
  ): Promise<boolean> {
    try {
      const healthy = await entry.adapter.probe(timeoutMs);
      if (!healthy && this.active === entry) {
        this.telemetry.reconnect(entry.adapter.connection, reconnectReason);
        this.recovery.begin();
        this.publish();
        entry.adapter.disconnect();
        await entry.adapter.connect();
        if (this.active === entry) {
          this.error = null;
          if (entry.adapter.state === 'ready') void this.handleActiveReady(entry);
          this.publish({ switching: false });
        }
      }
      if (healthy && this.active === entry) {
        this.recovery.finish();
        if (this.error?.operation === 'probe' || this.error?.operation === 'connect') this.error = null;
        this.publish();
      }
      return healthy;
    } catch (error) {
      if (this.active === entry) {
        this.recovery.begin();
        if (requiresConnectionAction(String(error))) this.recovery.fail();
        this.error = failure('probe', error, entry.connectionId);
        this.publish({ switching: false });
      }
      return false;
    }
  }

  async markSessionOpened(
    session: WatermarkSession,
    openedAt = this.now(),
  ): Promise<SessionWatermarks> {
    const values = await this.watermarks.markOpened(session, openedAt);
    this.applyWatermarks(session.connectionId, values);
    return values;
  }

  async markPromptSucceeded(
    session: WatermarkSession,
    acceptedAt = this.now(),
  ): Promise<SessionWatermarks> {
    const values = await this.watermarks.markPromptSucceeded(session, acceptedAt);
    this.applyWatermarks(session.connectionId, values);
    return values;
  }

  private readonly handleStoreChange = (): void => {
    if (!this.started) return;
    const storeSnapshot = this.store.getSnapshot();
    if (this.active && this.active.connectionId !== storeSnapshot.activeConnectionId) {
      this.disconnectActiveImmediately();
    }
    const needsSwitch = Boolean(
      storeSnapshot.activeConnectionId
      && this.adapterFactory
      && !this.pausedIds.includes(storeSnapshot.activeConnectionId)
      && (
        this.active?.connectionId !== storeSnapshot.activeConnectionId
        || this.active.factoryRevision !== this.adapterFactoryRevision
      ),
    );
    this.publishStoreSnapshot(storeSnapshot, {
      switching: needsSwitch,
    });
    this.scheduleReconcile();
  };

  private scheduleReconcile(): void {
    if (!this.started || this.reconcileScheduled) return;
    this.reconcileScheduled = true;
    void this.enqueue(async () => {
      this.reconcileScheduled = false;
      const storeSnapshot = this.store.getSnapshot();
      await this.hydrateRosterCaches(storeSnapshot);
      await this.reconcileActiveAdapter(storeSnapshot);
    });
  }

  private async reconcileActiveAdapter(storeSnapshot: ConnectionStoreSnapshot): Promise<void> {
    if (!this.started) return;
    if (this.store.getSnapshot() !== storeSnapshot) return;
    this.publishStoreSnapshot(storeSnapshot);
    const connectionId = storeSnapshot.activeConnectionId;
    const factory = this.adapterFactory;
    const factoryRevision = this.adapterFactoryRevision;
    if (!connectionId || !factory || this.pausedIds.includes(connectionId)) {
      this.disconnectActiveImmediately();
      this.publish({ switching: false });
      return;
    }
    if (
      this.active?.connectionId === connectionId
      && this.active.factoryRevision === factoryRevision
    ) {
      this.publish({ switching: false });
      return;
    }

    this.disconnectActiveImmediately();
    this.publish({ switching: true });
    let adapter: AgentAdapter;
    try {
      adapter = await this.store.createAdapter(connectionId, (record, descriptor) => factory(
        record,
        descriptor,
        {
          onReconnect: (reason) => this.telemetry.reconnect(descriptor, reason),
        },
      ));
    } catch (error) {
      if (requiresConnectionAction(String(error))) this.recovery.fail();
      this.error = failure('connect', error, connectionId);
      this.publish({ switching: false });
      return;
    }

    if (
      !this.started
      || this.store.getSnapshot().activeConnectionId !== connectionId
      || this.adapterFactoryRevision !== factoryRevision
    ) {
      disposeAdapter(adapter);
      return;
    }

    const entry: ActiveAdapterEntry = {
      connectionId,
      adapter,
      factoryRevision,
      unsubscribers: [],
      attempt: 1,
      connectStartedAt: this.now(),
      lastState: adapter.state,
      rosterRefreshTimer: null,
      hermesProbeTimer: null,
      rosterRefreshInFlight: null,
      readyRefresh: null,
      readyRevision: 0,
      hasReportedReady: false,
      probeInFlight: null,
      probeReconnectReason: null,
      maintenanceTail: Promise.resolve(),
      sessionSnapshotRevision: 0,
    };
    const connectReason = this.nextConnectReason;
    this.nextConnectReason = 'retry';
    this.telemetry.attempt(adapter.connection, connectReason);
    entry.unsubscribers.push(
      adapter.on('state', (state, reason) => {
        if (this.active !== entry) return;
        if (state === 'reconnecting' && entry.lastState !== 'reconnecting') {
          const stateReason = reconnectReasonFromAdapterState(reason);
          this.telemetry.reconnect(
            adapter.connection,
            stateReason === 'socket_close'
              ? entry.probeReconnectReason ?? stateReason
              : stateReason,
          );
        }
        const enteredReady = state === 'ready' && entry.lastState !== 'ready';
        if (state !== 'ready') {
          this.runActivities = [];
          if (entry.hasReportedReady) this.recovery.begin();
          if (requiresConnectionAction(reason)) this.recovery.fail();
          entry.readyRefresh = null;
          const roster = this.rosterInputs.get(entry.connectionId);
          if (roster?.source === 'live') {
            this.rosterInputs.set(entry.connectionId, { ...roster, source: 'cache' });
          }
        }
        entry.lastState = state;
        if (enteredReady) {
          void this.handleActiveReady(entry);
        } else {
          this.publish();
        }
      }),
      adapter.on('update', (update) => {
        if (this.active !== entry) return;
        const next = updateRunActivities(this.runActivities, entry.connectionId, update);
        if (next === this.runActivities) return;
        this.runActivities = next;
        this.publish();
      }),
      adapter.on('sessions', (sessions) => {
        if (this.active === entry) this.acceptSessionSnapshot(entry, sessions);
      }),
    );
    this.active = entry;
    this.error = null;
    this.publish({ switching: true });

    try {
      await adapter.connect();
      if (this.active !== entry) return;
      if (adapter.state === 'ready') {
        await this.handleActiveReady(entry);
      } else {
        this.publish({ switching: false });
      }
    } catch (error) {
      if (this.active !== entry) return;
      this.telemetry.failed(
        adapter.connection,
        readConnectionErrorCode(error),
        connectionFailureStage(entry.lastState),
        entry.attempt,
      );
      if (requiresConnectionAction(String(error))) this.recovery.fail();
      this.error = failure('connect', error, connectionId);
      this.publish({ switching: false });
    }
  }

  private async hydrateRosterCaches(storeSnapshot: ConnectionStoreSnapshot): Promise<void> {
    const descriptors = storeSnapshot.connections;
    const descriptorById = new Map(descriptors.map((connection) => [connection.id, connection]));
    for (const connectionId of this.rosterInputs.keys()) {
      if (!descriptorById.has(connectionId)) this.rosterInputs.delete(connectionId);
    }
    for (const connectionId of this.connectionDetails.keys()) {
      if (!descriptorById.has(connectionId)) this.connectionDetails.delete(connectionId);
    }
    let cached: Awaited<ReturnType<RosterCachePort['getMany']>> = EMPTY_CACHED_ROSTERS;
    try {
      cached = await this.cache.getMany(descriptors.map((connection) => connection.id));
    } catch (error) {
      if (this.store.getSnapshot() === storeSnapshot) {
        this.error = failure('roster', error, storeSnapshot.activeConnectionId ?? undefined);
      }
    }
    if (!this.started || this.store.getSnapshot() !== storeSnapshot) return;
    const cachedById = new Map(cached.map((entry) => [entry.connectionId, entry]));
    let activeWatermarks: SessionWatermarks = {};
    if (storeSnapshot.activeConnectionId) {
      try {
        activeWatermarks = await this.watermarks.get(storeSnapshot.activeConnectionId);
      } catch (error) {
        if (this.store.getSnapshot() === storeSnapshot) {
          this.error = failure('roster', error, storeSnapshot.activeConnectionId);
        }
      }
    }
    if (!this.started || this.store.getSnapshot() !== storeSnapshot) return;

    for (const connection of descriptors) {
      const current = this.rosterInputs.get(connection.id);
      if (current?.source === 'live' && this.active?.connectionId === connection.id) {
        this.rosterInputs.set(connection.id, {
          ...current,
          connection,
          watermarks: connection.id === storeSnapshot.activeConnectionId
            ? activeWatermarks
            : undefined,
        });
        continue;
      }
      const entry = cachedById.get(connection.id);
      if (entry?.savedAt && entry.savedAt > 0) {
        const currentDetails = this.connectionDetails.get(connection.id);
        if (entry.savedAt > (currentDetails?.lastReadyAt ?? 0)) {
          this.connectionDetails.set(connection.id, Object.freeze({
            lastReadyAt: entry.savedAt,
            bridgeVersion: currentDetails?.bridgeVersion ?? null,
            bridgeCapabilities: currentDetails?.bridgeCapabilities ?? Object.freeze([]),
          }));
        }
      }
      this.rosterInputs.set(connection.id, {
        connection,
        agents: entry?.agents ?? EMPTY_AGENTS,
        sessions: entry?.sessions ?? EMPTY_SESSIONS,
        source: 'cache',
        syncedAt: entry?.savedAt ?? 0,
        ...(connection.id === storeSnapshot.activeConnectionId
          ? { watermarks: activeWatermarks }
          : {}),
      });
    }
    this.publishStoreSnapshot(storeSnapshot);
  }

  private refreshActiveRoster(entry: ActiveAdapterEntry, force = false): Promise<void> {
    if (entry.rosterRefreshInFlight && !force) return entry.rosterRefreshInFlight;
    const operation = entry.maintenanceTail.then(async () => {
      if (!this.started || this.active !== entry) return;
      await this.performActiveRosterRefresh(entry);
    });
    entry.maintenanceTail = operation.then(() => undefined, () => undefined);
    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (entry.rosterRefreshInFlight === tracked) entry.rosterRefreshInFlight = null;
    });
    entry.rosterRefreshInFlight = tracked;
    return tracked;
  }

  private async performActiveRosterRefresh(entry: ActiveAdapterEntry): Promise<void> {
    try {
      const readyRevision = entry.readyRevision;
      const sessionSnapshotRevision = entry.sessionSnapshotRevision;
      const [agents, sessions, watermarks] = await Promise.all([
        entry.adapter.listAgents(),
        entry.adapter.listSessions(),
        this.watermarks.get(entry.connectionId),
      ]);
      if (
        this.active !== entry
        || entry.adapter.state !== 'ready'
        || entry.readyRevision !== readyRevision
      ) return;
      const connection = this.connectionDescriptor(entry.connectionId);
      if (!connection) return;
      const syncedAt = this.now();
      const acceptedSessions = entry.sessionSnapshotRevision === sessionSnapshotRevision
        ? cloneSessions(sessions)
        : cloneSessions(this.rosterInputs.get(entry.connectionId)?.sessions ?? sessions);
      const acceptedSessionRevision = entry.sessionSnapshotRevision;
      this.rosterInputs.set(entry.connectionId, {
        connection,
        agents: cloneAgents(agents),
        sessions: acceptedSessions,
        source: 'live',
        syncedAt,
        watermarks,
      });
      this.error = null;
      this.publish();
      const cacheSnapshot = await this.cache.set(
        entry.connectionId,
        agents,
        acceptedSessions,
        entry.adapter.state,
      );
      if (
        this.active !== entry
        || entry.adapter.state !== 'ready'
        || entry.readyRevision !== readyRevision
      ) return;
      if (entry.sessionSnapshotRevision !== acceptedSessionRevision) return;
      this.rosterInputs.set(entry.connectionId, {
        connection,
        agents: cacheSnapshot.agents,
        sessions: cacheSnapshot.sessions,
        source: 'live',
        syncedAt: cacheSnapshot.savedAt,
        watermarks,
      });
      this.publish();
    } catch (error) {
      if (this.active !== entry) return;
      this.error = failure('roster', error, entry.connectionId);
      this.publish();
    }
  }

  private acceptSessionSnapshot(
    entry: ActiveAdapterEntry,
    sessions: ReadonlyArray<SessionDescriptor>,
  ): void {
    const existing = this.rosterInputs.get(entry.connectionId);
    const connection = this.connectionDescriptor(entry.connectionId);
    if (!connection || this.active !== entry) return;
    entry.sessionSnapshotRevision += 1;
    const next: RosterSnapshotInput = {
      connection,
      agents: existing?.agents ?? EMPTY_AGENTS,
      sessions: cloneSessions(sessions),
      source: 'live',
      syncedAt: this.now(),
      watermarks: existing?.watermarks ?? {},
    };
    this.rosterInputs.set(entry.connectionId, next);
    this.publish();
    void this.cache.set(
      entry.connectionId,
      next.agents,
      next.sessions,
      entry.adapter.state,
    ).catch((error: unknown) => {
      if (this.active !== entry) return;
      this.error = failure('roster', error, entry.connectionId);
      this.publish();
    });
  }

  private applyWatermarks(connectionId: string, watermarks: SessionWatermarks): void {
    const existing = this.rosterInputs.get(connectionId);
    if (!existing) return;
    this.rosterInputs.set(connectionId, { ...existing, watermarks });
    this.publish();
  }

  private disconnectActiveImmediately(): void {
    this.recovery.finish();
    const entry = this.active;
    if (!entry) return;
    this.active = null;
    this.runActivities = [];
    this.clearActiveMaintenance(entry);
    let cleanupFailed = false;
    for (const unsubscribe of entry.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        cleanupFailed = true;
      }
    }
    const roster = this.rosterInputs.get(entry.connectionId);
    if (roster?.source === 'live') {
      this.rosterInputs.set(entry.connectionId, { ...roster, source: 'cache' });
    }
    try {
      disposeAdapter(entry.adapter);
    } catch {
      cleanupFailed = true;
      try {
        entry.adapter.disconnect();
      } catch {
        // The coordinator still publishes the detached state and continues the switch.
      }
    }
    if (cleanupFailed) {
      this.error = failure(
        'connect',
        new Error('The previous connection did not shut down cleanly.'),
        entry.connectionId,
      );
    }
    this.publish({ switching: false });
  }

  private probeEntry(
    entry: ActiveAdapterEntry,
    timeoutMs?: number,
    reconnectReason: Extract<ReconnectReason, 'probe_failed' | 'foreground'> = 'probe_failed',
  ): Promise<boolean> {
    if (entry.probeInFlight) return entry.probeInFlight;
    const operation = entry.maintenanceTail.then(async () => {
      if (!this.started || this.active !== entry) return false;
      entry.probeReconnectReason = reconnectReason;
      try {
        return await this.performActiveProbe(entry, timeoutMs, reconnectReason);
      } finally {
        entry.probeReconnectReason = null;
      }
    });
    entry.maintenanceTail = operation.then(() => undefined, () => undefined);
    let tracked: Promise<boolean>;
    tracked = operation.finally(() => {
      if (entry.probeInFlight === tracked) entry.probeInFlight = null;
    });
    entry.probeInFlight = tracked;
    return tracked;
  }

  private startActiveMaintenance(entry: ActiveAdapterEntry): void {
    this.clearActiveMaintenance(entry);
    if (this.rosterRefreshIntervalMs !== null) {
      entry.rosterRefreshTimer = setInterval(() => {
        if (this.active !== entry || !this.started) return;
        void this.refreshActiveRoster(entry);
      }, this.rosterRefreshIntervalMs);
      unrefTimer(entry.rosterRefreshTimer);
    }
    if (
      entry.adapter.connection.backendKind === 'hermes'
      && this.hermesProbeIntervalMs !== null
    ) {
      entry.hermesProbeTimer = setInterval(() => {
        if (this.active !== entry || !this.started) return;
        void this.probeEntry(entry);
      }, this.hermesProbeIntervalMs);
      unrefTimer(entry.hermesProbeTimer);
    }
  }

  private clearActiveMaintenance(entry: ActiveAdapterEntry): void {
    if (entry.rosterRefreshTimer !== null) {
      clearInterval(entry.rosterRefreshTimer);
      entry.rosterRefreshTimer = null;
    }
    if (entry.hermesProbeTimer !== null) {
      clearInterval(entry.hermesProbeTimer);
      entry.hermesProbeTimer = null;
    }
  }

  private connectionDescriptor(connectionId: string): ConnectionDescriptor | null {
    return this.store.getSnapshot().connections.find(
      (connection) => connection.id === connectionId,
    ) ?? null;
  }

  /**
   * Handles every non-ready -> ready transition, including adapter-owned
   * reconnects after the original connect promise has already rejected. Each
   * transition owns one forced roster refresh so approval evidence cannot be
   * mistaken for data from the previous backend session.
   */
  private handleActiveReady(entry: ActiveAdapterEntry): Promise<void> {
    if (this.active !== entry || entry.adapter.state !== 'ready') return Promise.resolve();
    this.recovery.finish();
    if (entry.readyRefresh) return entry.readyRefresh;

    entry.readyRevision += 1;
    this.captureConnectionReady(entry);
    if (!entry.hasReportedReady) {
      entry.hasReportedReady = true;
      this.telemetry.ready(
        entry.adapter.connection,
        Math.max(0, this.now() - entry.connectStartedAt),
        entry.attempt,
      );
    }
    this.error = null;
    this.publish({ switching: false });
    this.startActiveMaintenance(entry);
    const refresh = this.refreshActiveRoster(entry, true);
    entry.readyRefresh = refresh;
    return refresh;
  }

  private captureConnectionReady(entry: ActiveAdapterEntry): void {
    if (this.active !== entry) return;
    const metadata = readConnectionRuntimeMetadata(entry.adapter);
    this.connectionDetails.set(entry.connectionId, Object.freeze({
      lastReadyAt: this.now(),
      bridgeVersion: metadata.bridgeVersion,
      bridgeCapabilities: metadata.bridgeCapabilities,
    }));
  }

  private publishStoreSnapshot(
    storeSnapshot: ConnectionStoreSnapshot,
    patch: Partial<Pick<ConnectionRuntimeSnapshot, 'switching'>> = {},
  ): void {
    this.publish({
      connectionsRevision: storeSnapshot.revision,
      connections: storeSnapshot.connections,
      activeConnectionId: storeSnapshot.activeConnectionId,
      freeConnectionId: storeSnapshot.freeConnectionId,
      ...patch,
    });
  }

  private publish(patch: Partial<ConnectionRuntimeSnapshot> = {}): void {
    const storeSnapshot = this.store.getSnapshot();
    const activeConnectionId = patch.activeConnectionId === undefined
      ? storeSnapshot.activeConnectionId
      : patch.activeConnectionId;
    const retainedIds = new Set(storeSnapshot.connections.map((connection) => connection.id));
    const inputs = [...this.rosterInputs.values()].filter((input) => retainedIds.has(input.connection.id));
    if (!this.rosterMemo || this.rosterMemo.activeId !== activeConnectionId
      || inputs.length !== this.rosterMemo.inputs.length
      || inputs.some((input, index) => input !== this.rosterMemo!.inputs[index])) {
      this.rosterMemo = { inputs, activeId: activeConnectionId, value: aggregateRoster(inputs, activeConnectionId) };
    }
    const roster = this.rosterMemo.value;
    this.snapshot = Object.freeze({
      revision: this.snapshot.revision + 1,
      initialized: patch.initialized ?? this.snapshot.initialized,
      switching: patch.switching ?? this.snapshot.switching,
      launchPaywallShownThisProcess: patch.launchPaywallShownThisProcess
        ?? this.snapshot.launchPaywallShownThisProcess,
      connectionsRevision: patch.connectionsRevision ?? storeSnapshot.revision,
      connections: patch.connections ?? storeSnapshot.connections,
      activeConnectionId,
      freeConnectionId: patch.freeConnectionId === undefined
        ? storeSnapshot.freeConnectionId
        : patch.freeConnectionId,
      activeAdapter: this.active?.adapter ?? null,
      activeState: this.active?.adapter.state ?? 'idle',
      runActivities: this.runActivities,
      recovering: this.recovery.phase === 'recovering',
      recoveryFailed: this.recovery.phase === 'failed',
      pausedConnectionIds: this.pausedIds,
      connectionDetails: freezeConnectionDetails(this.connectionDetails),
      roster,
      error: this.recovery.phase === 'recovering' ? null : this.error,
    });
    for (const listener of this.listeners) listener();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operation.then(operation, operation);
    this.operation = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

const EMPTY_AGENTS = Object.freeze([]) as ReadonlyArray<AgentDescriptor>;
const EMPTY_SESSIONS = Object.freeze([]) as ReadonlyArray<SessionDescriptor>;
const EMPTY_CACHED_ROSTERS = Object.freeze([]) as ReadonlyArray<RosterCacheSnapshot>;

function freezeConnectionDetails(
  details: ReadonlyMap<string, ConnectionRuntimeDetails>,
): Readonly<Record<string, ConnectionRuntimeDetails>> {
  return Object.freeze(Object.fromEntries(details));
}

function cloneAgents(agents: ReadonlyArray<AgentDescriptor>): AgentDescriptor[] {
  return agents.map((agent) => ({ ...agent }));
}

function cloneSessions(sessions: ReadonlyArray<SessionDescriptor>): SessionDescriptor[] {
  return sessions.map((session) => ({
    ...session,
    allowedActions: { ...session.allowedActions },
  }));
}

function failure(
  operation: ConnectionRuntimeFailure['operation'],
  error: unknown,
  connectionId?: string,
): ConnectionRuntimeFailure {
  return Object.freeze({
    operation,
    ...(connectionId ? { connectionId } : {}),
    message: error instanceof Error ? error.message : String(error ?? 'Unknown connection error'),
  });
}

function readConnectionErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return 'network';
}

function connectionFailureStage(state: ConnectionState): 'socket' | 'handshake' | 'ready' {
  if (state === 'handshaking') return 'handshake';
  if (state === 'ready' || state === 'reconnecting') return 'ready';
  return 'socket';
}

function reconnectReasonFromAdapterState(reason?: string): ReconnectReason {
  const normalized = reason?.trim().toLowerCase() ?? '';
  if (
    normalized.includes('heartbeat')
    && (normalized.includes('timeout') || normalized.includes('timed out'))
  ) {
    return 'tick_timeout';
  }
  return 'socket_close';
}

function readMaintenanceInterval(value: number | undefined, fallback: number): number | null {
  if (value === 0) return null;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  const nodeTimer = timer as unknown as { unref?: () => void };
  nodeTimer.unref?.();
}

const defaultConnectionTelemetry: ConnectionTelemetry = {
  attempt(connection, reason) {
    analyticsEvents.connectAttempt({
      backend: connection.backendKind,
      transport: connection.transportKind,
      reason,
    });
  },
  ready(connection, elapsedMs, attempt) {
    analyticsEvents.connectReady({
      backend: connection.backendKind,
      transport: connection.transportKind,
      elapsed_ms: elapsedMs,
      attempt,
    });
  },
  failed(connection, code, stage, attempt) {
    analyticsEvents.connectFailed({
      backend: connection.backendKind,
      transport: connection.transportKind,
      code,
      stage,
      attempt,
    });
  },
  reconnect(connection, reason) {
    analyticsEvents.reconnect({
      backend: connection.backendKind,
      transport: connection.transportKind,
      reason,
    });
  },
};

const defaultAdapterFactory: ConnectionAdapterFactory = (
  record,
  descriptor,
  context?: ConnectionAdapterFactoryContext,
) => createConnectionAdapter(record, descriptor, {
  onReconnect: context?.onReconnect,
  onSpriteGreetingSent: () => analyticsEvents.spriteGreetingSent(),
});

let defaultCoordinator = ownConnectionRuntime(new ConnectionCoordinator({
  adapterFactory: defaultAdapterFactory,
}));

export function getConnectionRuntime(): ConnectionCoordinator {
  return defaultCoordinator;
}

/**
 * Reads the private, account-scoped identity detail needed by a mounted UI
 * route without adding it to the public connection or Agent descriptors.
 */
export async function loadConnectionIdentityDetail(
  connection: ConnectionDescriptor,
  dependencies: ConnectionIdentityDetailDependencies = {
    getRuntimeConnectionRecord: (connectionId) => (
      getConnectionRuntime().getRuntimeConnectionRecord(connectionId)
    ),
    getYouMindAuthSession: (url, scopeKey, options) => (
      StorageService.getYouMindAuthSession(url, scopeKey, options)
    ),
  },
): Promise<string | undefined> {
  if (connection.backendKind !== 'youmind') return undefined;

  try {
    const record = await dependencies.getRuntimeConnectionRecord(connection.id);
    const authScopeKey = record.youmind?.authScopeKey.trim();
    if (
      record.id !== connection.id
      || record.backendKind !== connection.backendKind
      || !authScopeKey
    ) {
      return undefined;
    }
    const session = await dependencies.getYouMindAuthSession(
      record.url,
      authScopeKey,
    );
    return session?.user?.email?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function configureConnectionRuntime(
  factory: ConnectionAdapterFactory,
): ConnectionCoordinator {
  defaultCoordinator.setAdapterFactory(factory);
  return defaultCoordinator;
}

export async function resetConnectionRuntimeForTests(
  options: ConnectionCoordinatorOptions = {},
): Promise<ConnectionCoordinator> {
  await defaultCoordinator.stop();
  defaultCoordinator = ownConnectionRuntime(new ConnectionCoordinator(options));
  return defaultCoordinator;
}

function useConnectionRuntimeSnapshot(): ConnectionRuntimeSnapshot {
  const coordinator = getConnectionRuntime();
  useEffect(() => {
    void coordinator.start();
  }, [coordinator]);
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
}

/** Connection registry state. Mutations remain on the exported coordinator. */
export function useConnections(): ConnectionRuntimeSnapshot {
  return useConnectionRuntimeSnapshot();
}

/** Returns an adapter only while that connection is the one live connection. */
export function useAdapter(connectionId: string | null | undefined): AgentAdapter | null {
  const snapshot = useConnectionRuntimeSnapshot();
  return useMemo(
    () => connectionId && snapshot.activeConnectionId === connectionId
      ? snapshot.activeAdapter
      : null,
    [connectionId, snapshot.activeAdapter, snapshot.activeConnectionId, snapshot.revision],
  );
}

/** Live active-connection rows plus cache-only rows for every inactive connection. */
export function useRoster(): ReadonlyArray<RosterConnectionGroup> {
  return useConnectionRuntimeSnapshot().roster;
}

export type {
  ConnectionAdapterFactory,
  ConnectionAdapterFactoryContext,
  ConnectionRecordPatch,
  ConnectionRecordReplacement,
  ConnectionUpsertResult,
  NewConnectionRecord,
  RosterConnectionGroup,
  ConnectionRuntimeDetails,
};

export {
  connectBackendPairingCode,
  connectBackendPairingLink,
  connectBackendPairingPayload,
} from './pairing/backend-pairing-profile';
export type {
  BackendCodePairingInput,
  BackendLinkPairingInput,
  BackendPairingPayload,
  BackendPairingResult,
  BackendPayloadPairingInput,
  PairingBackendKind,
} from './pairing/backend-pairing-profile';
export { createYouMindOnboardingConnection } from './pairing/youmind-onboarding-profile';
export type {
  YouMindEmailAuthClient,
  YouMindOnboardingAuthSession,
  YouMindOnboardingConnection,
  YouMindOnboardingResult,
} from './pairing/youmind-onboarding-profile';

function disposeAdapter(adapter: AgentAdapter): void {
  const disposable = adapter as AgentAdapter & { dispose?: () => void };
  if (typeof disposable.dispose === 'function') disposable.dispose();
  else adapter.disconnect();
}
