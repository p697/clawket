import {
  AdapterError,
  resolveCapabilities,
  type AgentAdapter,
  type Capabilities,
  type ChatMessage,
  type ConnectionDescriptor,
  type ConnectionRecord,
  type ConnectionState,
  type SessionDescriptor,
  type SessionHistory,
  type SessionKind,
  type SessionUpdate,
} from '@clawket/agent-protocol';
import {
  GatewayClient,
  type GatewayEvents,
  type GatewayProtocolProfile,
} from '../protocol';
import type {
  ConnectionState as LegacyConnectionState,
  GatewayConfig,
  SessionInfo,
} from '../../types';
import {
  mapGatewayAdapterEvent,
  mapGatewayErrorCode,
  type GatewayAdapterEvent,
} from './gateway-session-update';
import {
  DEFAULT_GATEWAY_HISTORY_CACHE,
  mapGatewayHistoryMessages,
  mergeGatewayHistory,
  preserveOpenClawCliHistorySegments,
  type GatewayHistoryCache,
} from './gateway-history';
import type { ConnectionAdapterRuntimeMetadata } from '../runtime-details';

export {
  mapGatewayHistoryMessage,
  mergeGatewayHistory,
  type GatewayHistoryCache,
} from './gateway-history';

export const DEFAULT_ADAPTER_CONNECT_TIMEOUT_MS = 30_000;

export type GatewayAdapterOptions = {
  gateway?: GatewayClient;
  isFreeSlot?: boolean;
  connectTimeoutMs?: number;
  historyCache?: GatewayHistoryCache | null;
  onReconnect?: (reason: 'seq_gap') => void;
};

type AdapterListenerMap = {
  update: (update: SessionUpdate) => void;
  state: (state: ConnectionState, reason?: string) => void;
  sessions: (sessions: SessionDescriptor[]) => void;
};

type PendingConnect = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type GatewaySessionRecord = SessionInfo & {
  hasActiveRun?: boolean;
  attention?: SessionDescriptor['attention'];
  parentSessionKey?: string;
  source?: SessionDescriptor['source'];
  allowedActions?: Partial<SessionDescriptor['allowedActions']>;
};

type GatewayHistoryPayload = {
  messages?: unknown[];
  toolCallAliases?: unknown;
  nextCursor?: string;
  hasActiveRun?: boolean;
  sessionId?: string;
  thinkingLevel?: string;
  sessionInfo?: { hasActiveRun?: boolean; activeRunIds?: string[] };
  inFlightRun?: { runId?: string; text?: string; startedAt?: number; sessionAbortable?: boolean };
};

/**
 * Protocol-backed adapter base with no backend selection. Concrete adapters
 * provide one fixed GatewayConfig and normalize their own agent/session
 * semantics.
 */
export abstract class GatewayAdapterBase implements AgentAdapter {
  public readonly connection: ConnectionDescriptor;

  readonly #gateway: GatewayClient;
  readonly #gatewayConfig: GatewayConfig;
  protected currentCapabilities: Capabilities;

  private readonly connectTimeoutMs: number;
  private readonly historyCache: GatewayHistoryCache | null;
  private readonly onReconnect?: GatewayAdapterOptions['onReconnect'];
  private readonly listeners: {
    [K in keyof AdapterListenerMap]: Set<AdapterListenerMap[K]>;
  } = {
    update: new Set(),
    state: new Set(),
    sessions: new Set(),
  };
  private readonly gatewayUnsubscribers: Array<() => void> = [];
  private readonly activeRuns = new Map<string, string>();
  private readonly runRevisions = new Map<string, number>();
  private readonly terminalRuns = new Set<string>();
  private currentState: ConnectionState = 'idle';
  private pendingConnect: PendingConnect | null = null;
  private manuallyDisconnected = false;
  private fallbackSessionKey: string;
  private lastSessions: SessionDescriptor[] = [];

  protected get gateway(): GatewayClient {
    return this.#gateway;
  }

  protected constructor(input: {
    record: ConnectionRecord;
    gatewayConfig: GatewayConfig;
    backendCapabilities: 'openclaw' | 'hermes';
    protocolProfile: GatewayProtocolProfile;
    fallbackSessionKey: string;
    options?: GatewayAdapterOptions;
  }) {
    this.#gatewayConfig = input.gatewayConfig;
    this.#gateway = input.options?.gateway ?? new GatewayClient({
      profile: input.protocolProfile,
    });
    this.connectTimeoutMs = readPositiveNumber(
      input.options?.connectTimeoutMs,
      DEFAULT_ADAPTER_CONNECT_TIMEOUT_MS,
    );
    this.historyCache = input.options?.historyCache === undefined
      ? DEFAULT_GATEWAY_HISTORY_CACHE
      : input.options.historyCache;
    this.onReconnect = input.options?.onReconnect;
    this.fallbackSessionKey = input.fallbackSessionKey;
    this.currentCapabilities = resolveCapabilities(input.backendCapabilities);
    this.connection = {
      id: input.record.id,
      backendKind: input.backendCapabilities,
      transportKind: input.record.transportKind,
      label: input.record.label,
      environment: input.record.environment,
      createdAt: input.record.createdAt,
      isFreeSlot: input.options?.isFreeSlot ?? false,
    };
    this.#gateway.configure(this.#gatewayConfig, input.protocolProfile);
    this.subscribeToGateway();
  }

  public get capabilities(): Capabilities {
    return this.currentCapabilities;
  }

  public get state(): ConnectionState {
    return this.currentState;
  }

  public getConnectionRuntimeMetadata(): ConnectionAdapterRuntimeMetadata {
    const runtimeGateway = this.gateway as typeof this.gateway & Readonly<{
      getConnectResponseBridgeVersion?: () => string | undefined;
      getConnectResponseCapabilities?: () => readonly string[] | undefined;
    }>;
    return {
      bridgeVersion: runtimeGateway.getConnectResponseBridgeVersion?.(),
      bridgeCapabilities: runtimeGateway.getConnectResponseCapabilities?.(),
    };
  }

  public connect(): Promise<void> {
    return this.connectGateway();
  }

  public disconnect(): void {
    this.manuallyDisconnected = true;
    this.rejectPendingConnect(new AdapterError('network', 'Connection closed'));
    this.clearActiveRunState();
    this.gateway.disconnect();
    this.setAdapterState('idle');
  }

  public async probe(timeoutMs?: number): Promise<boolean> {
    try {
      const ok = await this.gateway.probeConnection(timeoutMs);
      if (ok && !this.requiresHealthEvidence()) this.setAdapterState('ready');
      return ok;
    } catch {
      return false;
    }
  }

  public abstract listAgents(): Promise<import('@clawket/agent-protocol').AgentDescriptor[]>;

  public abstract listSessions(agentId?: string): Promise<SessionDescriptor[]>;

  public async loadSession(
    key: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<SessionHistory> {
    const params = {
      sessionKey: key,
      limit: options?.limit ?? 50,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    };
    if (!this.runRevisions.has(key)) this.runRevisions.set(key, 0);
    const runRevision = this.runRevisions.get(key);
    const payload = await this.invoke(() => (
      this.gateway.request<GatewayHistoryPayload>('chat.history', params)
    ));
    const rawMessages = Array.isArray(payload?.messages) ? payload.messages : [];
    const remoteMessages = mapGatewayHistoryMessages(key, rawMessages);
    const cachedMessages = !options?.cursor && this.historyCache
      ? await this.historyCache.load(
          this.connection.id,
          this.historyCacheAgentId(key),
          key,
          options?.limit ?? 50,
        ).catch(() => [])
      : [];
    const reportedActive = payload?.sessionInfo?.hasActiveRun ?? payload?.hasActiveRun;
    if (reportedActive === false && runRevision === this.runRevisions.get(key)) this.clearActiveRunsForSession(key);
    const localRunId = [...this.activeRuns].find(([, session]) => session === key)?.[0];
    const snapshot = payload?.inFlightRun;
    const snapshotRunId = readNonEmptyString(snapshot?.runId)
      ?? (Array.isArray(payload?.sessionInfo?.activeRunIds)
        ? payload.sessionInfo.activeRunIds.find(id => typeof id === 'string' && id.trim()) : undefined);
    const hasActiveRun = Boolean(localRunId) || (runRevision === this.runRevisions.get(key)
      && (reportedActive === true || (reportedActive !== false && Boolean(snapshotRunId)))
      && (!snapshotRunId || !this.terminalRuns.has(snapshotRunId)));
    const recoveredRunId = localRunId ?? snapshotRunId;
    const mergedMessages = mergeGatewayHistory(remoteMessages, cachedMessages, {
      openclawUserEchoes: this.connection.backendKind === 'openclaw',
      hermesToolAliases: this.connection.backendKind === 'hermes' ? payload?.toolCallAliases : undefined,
    });
    return {
      key,
      messages: this.connection.backendKind === 'openclaw'
        ? preserveOpenClawCliHistorySegments(key, rawMessages, mergedMessages) : mergedMessages,
      ...(typeof payload?.nextCursor === 'string' && payload.nextCursor
        ? { nextCursor: payload.nextCursor }
        : {}),
      hasActiveRun,
      ...(hasActiveRun && recoveredRunId ? { activeRun: {
        runId: recoveredRunId,
        text: snapshotRunId === recoveredRunId && typeof snapshot?.text === 'string' ? snapshot.text : '',
        ...(snapshotRunId === recoveredRunId && typeof snapshot?.startedAt === 'number'
          && Number.isFinite(snapshot.startedAt) ? { startedAtMs: snapshot.startedAt } : {}),
        ...(snapshotRunId === recoveredRunId && snapshot?.sessionAbortable === true
          ? { sessionAbortable: true } : {}),
      } } : {}),
      ...(readNonEmptyString(payload?.sessionId) ? { sessionId: readNonEmptyString(payload?.sessionId) } : {}),
      ...(readNonEmptyString(payload?.thinkingLevel)
        ? { thinkingLevel: readNonEmptyString(payload?.thinkingLevel) }
        : {}),
    };
  }

  public abstract prompt(
    key: string,
    input: import('@clawket/agent-protocol').PromptInput,
  ): Promise<{ runId: string }>;

  public async cancel(key: string, runId?: string): Promise<void> {
    await this.invoke(() => this.gateway.abortChat(key, runId));
  }

  public on(event: 'update', listener: (update: SessionUpdate) => void): () => void;
  public on(
    event: 'state',
    listener: (state: ConnectionState, reason?: string) => void,
  ): () => void;
  public on(event: 'sessions', listener: (sessions: SessionDescriptor[]) => void): () => void;
  public on<K extends keyof AdapterListenerMap>(
    event: K,
    listener: AdapterListenerMap[K],
  ): () => void {
    const listeners = this.listeners[event] as Set<AdapterListenerMap[K]>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Test/lifecycle escape hatch until the registry owns adapter disposal. */
  public dispose(): void {
    this.disconnect();
    while (this.gatewayUnsubscribers.length > 0) {
      this.gatewayUnsubscribers.pop()?.();
    }
    this.listeners.update.clear();
    this.listeners.state.clear();
    this.listeners.sessions.clear();
  }

  protected connectGateway(): Promise<void> {
    if (this.currentState === 'ready') return Promise.resolve();
    if (this.pendingConnect) return this.pendingConnect.promise;

    this.manuallyDisconnected = false;
    this.#gateway.configure(this.#gatewayConfig);
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      if (this.pendingConnect?.promise !== promise) return;
      const error = new AdapterError('bridge_offline', 'Connection handshake timed out');
      this.pendingConnect = null;
      this.manuallyDisconnected = true;
      this.clearActiveRunState();
      this.gateway.disconnect();
      this.setAdapterState('offline', error.message);
      rejectPromise(error);
    }, this.connectTimeoutMs);
    this.pendingConnect = {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
    };

    try {
      this.gateway.connect();
    } catch (error) {
      this.rejectPendingConnect(toAdapterError(error));
    }
    return promise;
  }

  protected restartGatewayForCompatibilityRetry(): void {
    this.gateway.disconnect();
    this.setAdapterState('reconnecting');
  }

  protected setFallbackSessionKey(key: string): void {
    if (key.trim()) this.fallbackSessionKey = key;
  }

  protected beginPrompt(key: string, provisionalRunId: string): void {
    this.setFallbackSessionKey(key);
    this.terminalRuns.delete(provisionalRunId);
    this.runRevisions.set(key, (this.runRevisions.get(key) ?? 0) + 1);
    this.activeRuns.set(provisionalRunId, key);
    this.refreshActiveRunSnapshots(key);
  }

  protected confirmPrompt(key: string, provisionalRunId: string, runId: string): void {
    this.activeRuns.delete(provisionalRunId);
    const alreadyFinished = this.terminalRuns.delete(provisionalRunId)
      || this.terminalRuns.delete(runId);
    if (!alreadyFinished) this.activeRuns.set(runId, key);
    this.refreshActiveRunSnapshots(key);
  }

  protected failPrompt(key: string, provisionalRunId: string): void {
    this.activeRuns.delete(provisionalRunId);
    this.terminalRuns.delete(provisionalRunId);
    this.refreshActiveRunSnapshots(key);
  }

  protected historyCacheAgentId(_key: string): string {
    return 'main';
  }

  protected hasActiveRunForSession(key: string): boolean {
    for (const sessionKey of this.activeRuns.values()) {
      if (sessionKey === key) return true;
    }
    return false;
  }

  protected rememberSessions(sessions: SessionDescriptor[], emit = true): SessionDescriptor[] {
    for (const session of sessions) {
      if (!session.hasActiveRun) this.clearActiveRunsForSession(session.key);
    }
    this.lastSessions = sessions.map((session) => ({
      ...session,
      allowedActions: { ...session.allowedActions },
      hasActiveRun: session.hasActiveRun || this.hasActiveRunForSession(session.key),
    }));
    if (emit) this.emit('sessions', this.lastSessions.map(cloneSession));
    return this.lastSessions.map(cloneSession);
  }

  protected emitUpdate(update: SessionUpdate): void {
    this.trackRun(update);
    this.emit('update', update);
  }

  protected setAdapterState(state: ConnectionState, reason?: string): void {
    if (this.currentState === state && !reason) return;
    if (state === 'idle' || state === 'offline' || state === 'error') {
      this.clearActiveRunState();
    }
    this.currentState = state;
    this.emit('state', state, reason);
    if (state === 'ready') this.resolvePendingConnect();
  }

  protected confirmHealthReady(): void {
    this.setAdapterState('ready');
  }

  protected failAdapterConnection(error: AdapterError): void {
    this.setAdapterState('error', error.message);
    this.rejectPendingConnect(error);
    this.emitUpdate({ type: 'error', code: error.code, message: error.message });
  }

  protected requiresHealthEvidence(): boolean {
    return false;
  }

  protected handleGatewayHealth(_payload: GatewayEvents['health']): void {
    // Concrete adapters may use the first health frame as their handshake.
  }

  protected handleGatewayConnectionTransition(
    _state: LegacyConnectionState,
    _reason?: string,
  ): void {
    // Concrete adapters may invalidate backend-specific handshake evidence.
  }

  protected shouldSuppressConnectError(_error: AdapterError): boolean {
    return false;
  }

  protected transformGatewayUpdates(
    _event: GatewayAdapterEvent,
    updates: SessionUpdate[],
  ): SessionUpdate[] {
    return updates;
  }

  protected async invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  private subscribeToGateway(): void {
    this.gatewayUnsubscribers.push(
      this.gateway.on('connection', ({ state, reason }) => {
        this.handleGatewayConnectionState(state, reason);
      }),
      this.gateway.on('health', (payload) => this.handleGatewayHealth(payload)),
      this.gateway.on('sessionsChanged', () => {
        void this.listSessions().catch((error: unknown) => {
          const normalized = toAdapterError(error);
          this.emitUpdate({
            type: 'error',
            code: normalized.code,
            message: normalized.message,
          });
        });
      }),
      this.gateway.on('seqGap', ({ sessionKey }) => {
        try {
          this.onReconnect?.('seq_gap');
        } catch {
          // Analytics must never interrupt the required history reconciliation.
        }
        const key = sessionKey || this.fallbackSessionKey;
        void this.loadSession(key, { limit: 50 })
          .then((history) => this.emitUpdate({
            type: 'history_reconciled',
            sessionKey: key,
            history,
          }))
          .catch((error: unknown) => {
            const normalized = toAdapterError(error);
            this.emitUpdate({
              type: 'error',
              sessionKey: key,
              code: normalized.code,
              message: normalized.message,
            });
          });
      }),
    );

    const forwardedEvents = [
      'chatRunStart',
      'chatDelta',
      'chatTool',
      'chatFinal',
      'chatAborted',
      'chatError',
      'chatCompaction',
      'execApprovalRequested',
      'execApprovalResolved',
      'pairApprovalRequested',
      'pairApprovalResolved',
      'pairingRequired',
      'pairingResolved',
      'error',
    ] as const;
    for (const type of forwardedEvents) {
      this.gatewayUnsubscribers.push(this.subscribeForwardedEvent(type));
    }
  }

  private subscribeForwardedEvent<K extends typeof FORWARDED_GATEWAY_EVENTS[number]>(
    type: K,
  ): () => void {
    return this.gateway.on(type, (payload) => {
      const event = { type, payload } as GatewayAdapterEvent;
      if (type === 'error' && this.currentState !== 'ready') {
        const raw = payload as GatewayEvents['error'];
        const error = new AdapterError(
          mapGatewayErrorCode(`${raw.code} ${raw.message}`),
          raw.message,
        );
        const suppress = this.shouldSuppressConnectError(error);
        if (!suppress) this.setAdapterState('error', error.message);
        this.rejectPendingConnect(error);
        if (suppress) return;
      }
      const updates = this.transformGatewayUpdates(
        event,
        mapGatewayAdapterEvent(event, this.fallbackSessionKey),
      );
      for (const update of updates) this.emitUpdate(update.type === 'agent_message_chunk'
        ? { ...update, textMode: this.connection.backendKind === 'openclaw' ? 'snapshot' : 'delta' }
        : update);
    });
  }

  private handleGatewayConnectionState(state: LegacyConnectionState, reason?: string): void {
    if (this.manuallyDisconnected && state !== 'closed' && state !== 'idle') return;
    this.handleGatewayConnectionTransition(state, reason);
    switch (state) {
      case 'idle':
        this.setAdapterState('idle', reason);
        return;
      case 'connecting':
        this.setAdapterState('connecting', reason);
        return;
      case 'challenging':
      case 'pairing_pending':
        this.setAdapterState('handshaking', reason);
        return;
      case 'reconnecting':
        this.setAdapterState('reconnecting', reason);
        return;
      case 'ready':
        if (this.requiresHealthEvidence()) {
          this.setAdapterState('handshaking', reason);
        } else {
          this.setAdapterState('ready', reason);
        }
        return;
      case 'closed': {
        const nextState = this.manuallyDisconnected ? 'idle' : 'offline';
        this.setAdapterState(nextState, reason);
        if (!this.manuallyDisconnected) {
          this.rejectPendingConnect(new AdapterError('network', reason || 'Connection closed'));
        }
        return;
      }
    }
  }

  private trackRun(update: SessionUpdate): void {
    if ('runId' in update && update.runId) {
      const key = update.sessionKey;
      if (key) this.runRevisions.set(key, (this.runRevisions.get(key) ?? 0) + 1);
    }
    if (
      update.type === 'run_started'
      || update.type === 'agent_message_chunk'
      || update.type === 'agent_thought_chunk'
      || update.type === 'tool_call'
      || update.type === 'tool_call_update'
    ) {
      this.terminalRuns.delete(update.runId);
      this.activeRuns.set(update.runId, update.sessionKey);
      this.refreshActiveRunSnapshots(update.sessionKey);
      return;
    }
    if (update.type === 'run_finished') {
      this.activeRuns.delete(update.runId);
      this.rememberTerminalRun(update.runId);
      this.refreshActiveRunSnapshots(update.sessionKey);
    }
  }

  private rememberTerminalRun(runId: string): void {
    this.terminalRuns.add(runId);
    if (this.terminalRuns.size <= 100) return;
    const oldest = this.terminalRuns.values().next().value as string | undefined;
    if (oldest) this.terminalRuns.delete(oldest);
  }

  private clearActiveRunsForSession(sessionKey: string): void {
    for (const [runId, key] of this.activeRuns) {
      if (key === sessionKey) this.activeRuns.delete(runId);
    }
  }

  private clearActiveRunState(): void {
    const hadActiveState = this.activeRuns.size > 0
      || this.lastSessions.some((session) => session.hasActiveRun);
    for (const key of this.runRevisions.keys()) this.runRevisions.set(key, (this.runRevisions.get(key) ?? 0) + 1);
    this.activeRuns.clear();
    this.terminalRuns.clear();
    if (!hadActiveState) return;
    this.lastSessions = this.lastSessions.map((session) => ({
      ...session,
      hasActiveRun: false,
    }));
    this.emit('sessions', this.lastSessions.map(cloneSession));
  }

  private refreshActiveRunSnapshots(sessionKey: string): void {
    let changed = false;
    this.lastSessions = this.lastSessions.map((session) => {
      if (session.key !== sessionKey) return session;
      const hasActiveRun = this.hasActiveRunForSession(sessionKey);
      if (session.hasActiveRun === hasActiveRun) return session;
      changed = true;
      return { ...session, hasActiveRun };
    });
    if (changed) this.emit('sessions', this.lastSessions.map(cloneSession));
  }

  private resolvePendingConnect(): void {
    const pending = this.pendingConnect;
    if (!pending) return;
    this.pendingConnect = null;
    clearTimeout(pending.timer);
    pending.resolve();
  }

  private rejectPendingConnect(error: Error): void {
    const pending = this.pendingConnect;
    if (!pending) return;
    this.pendingConnect = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private emit<K extends keyof AdapterListenerMap>(
    event: K,
    ...args: Parameters<AdapterListenerMap[K]>
  ): void {
    const listeners = this.listeners[event] as Set<(...values: never[]) => void>;
    for (const listener of listeners) {
      try {
        (listener as unknown as (...values: Parameters<AdapterListenerMap[K]>) => void)(...args);
      } catch {
        // A consumer cannot break transport or other subscribers.
      }
    }
  }
}

const FORWARDED_GATEWAY_EVENTS = [
  'chatRunStart',
  'chatDelta',
  'chatTool',
  'chatFinal',
  'chatAborted',
  'chatError',
  'chatCompaction',
  'execApprovalRequested',
  'execApprovalResolved',
  'pairApprovalRequested',
  'pairApprovalResolved',
  'pairingRequired',
  'pairingResolved',
  'error',
] as const satisfies ReadonlyArray<keyof GatewayEvents>;

export function inferOpenClawAgentId(key: string, fallback = 'main'): string {
  const match = key.match(/^agent:([^:]+):/);
  return match?.[1] || fallback;
}

export function inferOpenClawSessionKind(session: Pick<SessionInfo, 'key' | 'kind' | 'channel'>): SessionKind {
  if (/^agent:[^:]+:main$/.test(session.key) || session.key === 'main') return 'main';
  if (session.key.includes(':cron:')) return 'cron';
  if (session.key.includes(':subagent:')) return 'subagent';
  if (session.channel) return 'channel';
  if (session.kind === 'direct') return 'direct';
  if (session.kind === 'group') return 'group';
  return 'other';
}

export function toAdapterError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  const record = isRecord(error) ? error : null;
  const message = error instanceof Error ? error.message : String(error ?? 'Request failed');
  const rawCode = readNonEmptyString(record?.code) ?? message;
  return new AdapterError(mapGatewayErrorCode(`${rawCode} ${message}`), message);
}

export function sessionTitle(session: SessionInfo): string {
  return session.title?.trim()
    || session.displayName?.trim()
    || session.label?.trim()
    || session.derivedTitle?.trim()
    || session.key;
}

export function normalizeSessionUpdatedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneSession(session: SessionDescriptor): SessionDescriptor {
  return { ...session, allowedActions: { ...session.allowedActions } };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
