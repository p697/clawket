import type { ConnectionAdapterRuntimeMetadata } from '../runtime-details';
import { sessionActivityUpdate, validateSessionActivity } from './session-activity';
import { artifactHistoryDisplay, artifactUpdateDisplay } from './artifact-display';
import type { ArtifactOperations } from '@clawket/agent-protocol';
import {
  AdapterError, resolveCapabilities,
  type AgentAdapter, type AgentDescriptor, type ConnectionDescriptor, type ConnectionRecord,
  type ConnectionState, type SessionDescriptor, type SessionHistory, type SessionUpdate,
  type AgentQuestion, type PromptStatus, type PromptInput, type ManagementOperations, type ModelSelectionState, type ModelSelectionWriteResult,
  type ApprovalRequest,
} from '@clawket/agent-protocol';
import { generateId } from '../../services/gateway-auth';
import { RelayWsTransport } from '../transports/relay-ws';
import { scheduleRequestTimeout } from '../transports/request-timeout';
import { RELAY_CLIENT_CAPABILITIES } from '../protocol/relay-control';
import { createTransportDiagnosticReporter } from '../../services/transport-diagnostics';
import { bridgeUnavailableDelay } from './bridge-availability';
import { SessionCatalogConsumer } from './session-catalog';
import { requiresConnectionAction } from '../recovery-window';
import type { WebSocketFactory } from '../transports/types';

type Listeners = {
  update: (update: SessionUpdate) => void;
  state: (state: ConnectionState, reason?: string) => void;
  sessions: (sessions: SessionDescriptor[]) => void;
};

function withNativeModelOrder<T extends ModelSelectionState>(state: T): T {
  return { ...state, models: state.models.map((model, sortOrder) => ({ ...model, sortOrder })) };
}

/** Project-scoped ClaudeCode sessions, native history and extension questions over the authenticated Bridge. */
export class ClaudeCodeAdapter implements AgentAdapter {
  private artifactsEnabled = false;
  private readonly artifactOperations: ArtifactOperations = {
    open: (sessionKey, artifactId) => this.rpc('clawket.artifacts.open', { sessionKey, artifactId }),
    read: (sessionKey, id, offset) => this.rpc('clawket.artifacts.read', { sessionKey, id, offset }),
  };
  get artifacts(): ArtifactOperations | undefined { return this.currentState === 'ready' && this.artifactsEnabled ? this.artifactOperations : undefined; }
  readonly connection: ConnectionDescriptor;
  readonly capabilities = resolveCapabilities('claude-code', { promptStatus: false, attachments: false });
  readonly projects = { list: () => this.rpc<import('@clawket/agent-protocol').ProjectDescriptor[]>('projects.list') };
  readonly questions = {
    list: (key: string) => this.rpc<AgentQuestion[]>('questions.list', { sessionKey: key }),
    respond: async (key: string, id: string, answer: { value?: string; confirmed?: boolean; cancelled?: boolean; answers?: Record<string, string[]> }) => { await this.rpc('questions.respond', { sessionKey: key, questionId: id, ...answer }); },
  };
  readonly management: ManagementOperations;
  private activityEnabled = false;
  private readonly readActivity = async (keys: readonly string[]) => {
    validateSessionActivity(keys.map(key => ({ key, state: 'unknown' })), keys);
    if (!this.activityEnabled || this.state !== 'ready') throw new AdapterError('unsupported', 'Session activity is unavailable');
    const epoch = this.epoch;
    const value = await this.rpc<unknown>('sessions.activity', { keys }, 10_000);
    if (epoch !== this.epoch || this.state !== 'ready') throw new AdapterError('network', 'Session activity belongs to a previous connection');
    return validateSessionActivity(value, keys);
  };
  get readSessionActivity() { return this.activityEnabled && this.state === 'ready' ? this.readActivity : undefined; }
  private transport: RelayWsTransport;
  private currentState: ConnectionState = 'idle';
  private bridgeVersion: string | undefined;
  getConnectionRuntimeMetadata(): ConnectionAdapterRuntimeMetadata { return { bridgeVersion: this.bridgeVersion }; }
  private epoch = 0;
  private readonly sessionCatalog = new SessionCatalogConsumer((method, params) => this.rpc(method, params));
  private handshakeError: AdapterError | null = null;
  private unavailableAttempts = 0;
  private previouslyReady = false;
  private connectPromise: Promise<void> | null = null;
  private cancelConnect: (() => void) | null = null;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; cancelTimeout: () => void }>();
  private listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { update: new Set(), state: new Set(), sessions: new Set() };

  constructor(private readonly record: ConnectionRecord, options: { isFreeSlot?: boolean; webSocketFactory?: WebSocketFactory } = {}) {
    if (record.backendKind !== 'claude-code') throw new TypeError('Expected claude-code connection');
    this.connection = { id: record.id, backendKind: record.backendKind, transportKind: record.transportKind, label: record.label, createdAt: record.createdAt, environment: record.environment, isFreeSlot: options.isFreeSlot ?? false };
    const url = new URL(record.url);
    if (record.transportKind === 'relay') {
      if (!record.relay?.gatewayId || !record.relay.clientToken) throw new TypeError('Missing Relay credentials');
      url.searchParams.set('gatewayId', record.relay.gatewayId);
      url.searchParams.set('role', 'client');
      url.searchParams.set('clientId', record.id);
      url.searchParams.set('token', record.relay.clientToken);
      url.searchParams.set('capabilities', RELAY_CLIENT_CAPABILITIES);
    }
    this.transport = new RelayWsTransport({ url: url.toString(), webSocketFactory: options.webSocketFactory,
      onDiagnostic: createTransportDiagnosticReporter({ backend: record.backendKind, transport: record.transportKind, environment: record.environment }),
      tickIntervalMs: 30_000, missedTickTolerance: 3 });
    this.transport.onOpen(() => { void this.handshake(); });
    this.transport.onMessage(data => this.receive(data));
    this.transport.onStateChange(change => {
      if (change.state !== 'ready') this.setState(change.state === 'closed' ? 'offline' : change.state, change.reason);
    });
    this.transport.onSocketRetired(() => { this.epoch++; this.sessionCatalog.retire(); this.rejectPending(); });
    this.management = { approvals: {
      listExec: async sessionKey => (await this.rpc<Array<Extract<ApprovalRequest, { kind: 'exec' }>>>('approvals.list', { sessionKey }))
        .map(approval => ({ sessionKey, approval })),
      resolveExec: async (id, decision) => { await this.rpc('approvals.resolve', { id, decision }); },
    }, models: {
      list: async () => withNativeModelOrder(await this.rpc<ModelSelectionState>('models.list')).models,
      getSelection: async key => withNativeModelOrder(await this.rpc<ModelSelectionState>('models.list', { sessionKey: key ?? undefined })),
      setSelection: async params => withNativeModelOrder(await this.rpc<ModelSelectionWriteResult>('models.select', { ...params })),
      listThinkingLevels: () => [],
    } };
  }

  get state(): ConnectionState { return this.currentState; }

  private setState(state: ConnectionState, reason?: string): void {
    if (state !== 'ready') this.activityEnabled = false;
    this.currentState = state;
    for (const listener of this.listeners.state) listener(state, reason);
  }

  private async handshake(): Promise<void> {
    const epoch = ++this.epoch;
    this.bridgeVersion = undefined;
    this.sessionCatalog.retire();
    try {
      // Relay authenticates its socket; only direct connections need connect/token.
      // A Relay connect request starts OpenClaw's challenge lifecycle.
      const health = await this.rpc<{ bridgeVersion?: string; sessionActivity?: unknown; artifacts?: boolean; promptStatus?: boolean; sessionCatalogSync?: unknown; backend: string; vision: boolean; model: string; projects?: boolean }>(this.record.transportKind === 'relay' ? 'health' : 'connect', { token: this.record.auth?.token });
      if (epoch !== this.epoch) return;
      if (health.backend !== 'claude-code') throw new AdapterError('unsupported', 'Endpoint is not a Claude Code Bridge');
      this.bridgeVersion = typeof health.bridgeVersion === 'string' ? health.bridgeVersion : undefined;
      this.activityEnabled = health.sessionActivity === 1;
      this.sessionCatalog.configure(health.sessionCatalogSync);
      this.artifactsEnabled = health.artifacts === true;
      this.capabilities.promptStatus = health.promptStatus === true;
      this.capabilities.attachments = health.vision === true; this.capabilities.projects = health.projects === true;
      this.handshakeError = null; this.unavailableAttempts = 0;
      this.previouslyReady = true;
      this.transport.markReady(); this.setState('ready');
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.handshakeError = error instanceof AdapterError ? error : null;
      if (requiresConnectionAction(error)) {
        this.transport.disconnect(1000, 'unauthorized');
        this.setState('error', 'unauthorized');
        return;
      }
      const unavailable = this.handshakeError?.code === 'bridge_offline';
      // A recovered owner may return seconds after this response. Bound that
      // fast window, then preserve the longer absent-computer backoff.
      const delay = unavailable ? bridgeUnavailableDelay(this.unavailableAttempts++, this.previouslyReady) : 0;
      this.transport.retryHandshake(delay);
    }
  }

  connect(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    const ready = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        cancelTimeout(); off(); this.cancelConnect = null;
        error ? reject(error) : resolve();
      };
      const cancelTimeout = scheduleRequestTimeout(this.transport, 25_000, () => finish(this.handshakeError ?? new AdapterError('timeout', 'Claude Code Bridge did not become ready')));
      const off = this.on('state', (state, reason) => {
        if (state === 'ready') finish();
        else if (requiresConnectionAction(reason)) finish(new AdapterError('unauthorized', 'Connection authorization is required'));
      });
      this.cancelConnect = () => finish(new AdapterError('bridge_offline', 'Claude Code connection cancelled'));
    });
    const attempt = ready.finally(() => { if (this.connectPromise === attempt) this.connectPromise = null; });
    this.connectPromise = attempt;
    this.transport.connect();
    return attempt;
  }

  disconnect(): void {
    this.epoch++; this.sessionCatalog.retire(); this.cancelConnect?.(); this.connectPromise = null;
    this.transport.disconnect(); this.rejectPending(); this.setState('offline');
    this.handshakeError = null;
    if (!this.previouslyReady) this.unavailableAttempts = 0;
  }

  async probe(timeoutMs = 5_000): Promise<boolean> {
    const epoch = this.epoch;
    try {
      const health = await this.rpc<{ bridgeVersion?: string; sessionActivity?: unknown; artifacts?: boolean; promptStatus?: boolean; sessionCatalogSync?: unknown; backend: string; vision: boolean; model: string; projects?: boolean }>('health', {}, timeoutMs);
      if (epoch !== this.epoch || health.backend !== 'claude-code') return false;
      this.bridgeVersion = typeof health.bridgeVersion === 'string' ? health.bridgeVersion : undefined;
      this.activityEnabled = health.sessionActivity === 1;
      this.sessionCatalog.configure(health.sessionCatalogSync);
      this.artifactsEnabled = health.artifacts === true;
      this.capabilities.promptStatus = health.promptStatus === true;
      this.capabilities.attachments = health.vision === true; this.capabilities.projects = health.projects === true;
      return true;
    } catch (error) {
      if (epoch === this.epoch && requiresConnectionAction(error)) throw error;
      return false;
    }
  }

  async listAgents(): Promise<AgentDescriptor[]> {
    return (await this.rpc<AgentDescriptor[]>('agents.list')).map(agent => ({ ...agent, connectionId: this.record.id, name: this.connection.label }));
  }
  async listSessions(): Promise<SessionDescriptor[]> {
    return (await this.sessionCatalog.list()).map(session => ({ ...session, connectionId: this.record.id }));
  }
  loadSession(key: string, options?: { limit?: number; cursor?: string }): Promise<SessionHistory> {
    return this.rpc<SessionHistory>('chat.history', { sessionKey: key, cursor: options?.cursor }).then(artifactHistoryDisplay);
  }
  prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    if (this.state !== 'ready') throw new AdapterError('bridge_offline', 'Claude Code Bridge is offline');
    return this.rpc('chat.send', { sessionKey: key, ...input, thinkingLevel: input.thinkingLevel === 'off' ? undefined : input.thinkingLevel });
  }
  async getPromptStatus(key: string, idempotencyKey: string): Promise<PromptStatus> {
    if (!this.capabilities.promptStatus) return { status: 'unknown' };
    const result = await this.rpc<PromptStatus>('chat.promptStatus', { sessionKey: key, idempotencyKey }, 5_000);
    return result?.status === 'recorded' && typeof result.runId === 'string' && result.runId.length > 0 && result.runId.length <= 200
      ? { status: 'recorded', runId: result.runId } : { status: 'unknown' };
  }
  async cancel(key: string, runId?: string): Promise<void> { await this.rpc('chat.abort', { sessionKey: key, runId }); }
  async createSession(_agentId: string, options?: { title?: string; fromSession?: string; projectId?: string }): Promise<SessionDescriptor> {
    const session = await this.rpc<SessionDescriptor>('sessions.create', options);
    this.sessionCatalog.invalidate();
    const scoped = { ...session, connectionId: this.record.id };
    for (const listener of this.listeners.update) listener({ type: 'session_info_update', session: scoped });
    return scoped;
  }
  async patchSession(key: string, patch: { title?: string }): Promise<void> { await this.rpc('sessions.rename', { sessionKey: key, ...patch }); this.sessionCatalog.invalidate(); }
  async resetSession(key: string): Promise<void> { await this.rpc('sessions.reset', { sessionKey: key }); this.sessionCatalog.invalidate(); }
  async deleteSession(key: string): Promise<void> { await this.rpc('sessions.delete', { sessionKey: key }); this.sessionCatalog.invalidate(); }

  on<K extends keyof Listeners>(event: K, listener: Listeners[K]): () => void {
    this.listeners[event].add(listener); return () => { this.listeners[event].delete(listener); };
  }


  private rpc<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = method === 'models.select' ? 190_000 : 20_000): Promise<T> {
    // Fresh identity across adapter replacement and process restarts; late replies
    // must never resolve a different request on the same saved connection.
    const id = generateId();
    return new Promise<T>((resolve, reject) => {
      const cancelTimeout = scheduleRequestTimeout(this.transport, timeoutMs, () => { this.pending.delete(id); reject(new AdapterError('timeout', 'Claude Code request timed out')); });
      this.pending.set(id, { resolve: value => resolve(value as T), reject, cancelTimeout });
      try { this.transport.send(JSON.stringify({ type: 'req', id, method, params })); }
      catch (error) { cancelTimeout(); this.pending.delete(id); reject(error); }
    });
  }

  private receive(data: unknown): void {
    let frame: { type?: string; id?: string; ok?: boolean; payload?: unknown; event?: string; error?: { code?: string; message?: string } };
    try { frame = JSON.parse(String(data)); } catch { return; }
    if (frame.type === 'res' && frame.id) {
      const pending = this.pending.get(frame.id); if (!pending) return;
      this.pending.delete(frame.id); pending.cancelTimeout();
      if (frame.ok) pending.resolve(frame.payload);
      else pending.reject(new AdapterError(frame.error?.code === 'BRIDGE_UNAVAILABLE' ? 'bridge_offline' : requiresConnectionAction(frame.error) ? 'unauthorized' : 'server', frame.error?.code === 'BRIDGE_UNAVAILABLE' ? 'Claude Code Bridge is offline. Keep the Bridge running on your computer.' : frame.error?.message ?? 'Claude Code request failed'));
    } else if (frame.type === 'event' && frame.event === 'claude-code.update') {
      let update = artifactUpdateDisplay(frame.payload as SessionUpdate);
      if (!update || typeof update.type !== 'string') return;
      if (update.type === 'session_activity_update') {
        if (!this.activityEnabled) return;
        const checked = sessionActivityUpdate(update); if (!checked) return; update = checked;
      }
      if (update.type === 'session_info_update') update.session.connectionId = this.record.id;
      for (const listener of this.listeners.update) listener(update.type === 'agent_message_chunk'
        ? { ...update, textMode: update.textMode ?? 'snapshot' } : update);
    }
  }

  private rejectPending(): void {
    for (const entry of this.pending.values()) { entry.cancelTimeout(); entry.reject(new AdapterError('network', 'Connection interrupted')); }
    this.pending.clear();
  }
}
