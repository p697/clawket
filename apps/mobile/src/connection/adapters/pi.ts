import { artifactHistoryDisplay, artifactUpdateDisplay } from './artifact-display';
import type { ArtifactOperations } from '@clawket/agent-protocol';
import {
  AdapterError, resolveCapabilities,
  type AgentAdapter, type AgentDescriptor, type ConnectionDescriptor, type ConnectionRecord,
  type ConnectionState, type SessionDescriptor, type SessionHistory, type SessionUpdate,
  type AgentQuestion, type PromptStatus, type PromptInput, type ManagementOperations, type ModelSelectionState, type ModelSelectionWriteResult,
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

/** Project-scoped Pi sessions, native history and extension questions over the authenticated Bridge. */
export class PiAdapter implements AgentAdapter {
  private artifactsEnabled = false;
  private readonly artifactOperations: ArtifactOperations = {
    open: (sessionKey, artifactId) => this.rpc('clawket.artifacts.open', { sessionKey, artifactId }),
    read: (sessionKey, id, offset) => this.rpc('clawket.artifacts.read', { sessionKey, id, offset }),
  };
  get artifacts(): ArtifactOperations | undefined { return this.currentState === 'ready' && this.artifactsEnabled ? this.artifactOperations : undefined; }
  readonly connection: ConnectionDescriptor;
  readonly capabilities = resolveCapabilities('pi', { promptStatus: false, attachments: false });
  readonly questions = {
    list: (key: string) => this.rpc<AgentQuestion[]>('questions.list', { sessionKey: key }),
    respond: async (key: string, id: string, answer: { value?: string; confirmed?: boolean; cancelled?: boolean }) => { await this.rpc('questions.respond', { sessionKey: key, questionId: id, ...answer }); },
  };
  readonly management: ManagementOperations;
  private transport: RelayWsTransport;
  private currentState: ConnectionState = 'idle';
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
    if (record.backendKind !== 'pi') throw new TypeError('Expected pi connection');
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
    this.management = { skills: { status: () => this.rpc('skills.list') }, models: {
      list: async () => (await this.rpc<ModelSelectionState>('models.list')).models,
      getSelection: key => this.rpc<ModelSelectionState>('models.list', { sessionKey: key ?? undefined }),
      setSelection: params => this.rpc<ModelSelectionWriteResult>('models.select', { ...params }),
      listThinkingLevels: () => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    } };
  }

  get state(): ConnectionState { return this.currentState; }

  private setState(state: ConnectionState, reason?: string): void {
    this.currentState = state;
    for (const listener of this.listeners.state) listener(state, reason);
  }

  private async handshake(): Promise<void> {
    const epoch = ++this.epoch;
    this.sessionCatalog.retire();
    try {
      // Relay authenticates its socket; only direct connections need connect/token.
      // A Relay connect request starts OpenClaw's challenge lifecycle.
      const health = await this.rpc<{ artifacts?: boolean; promptStatus?: boolean; sessionCatalogSync?: unknown; backend: string; vision: boolean; model: string }>(this.record.transportKind === 'relay' ? 'health' : 'connect', { token: this.record.auth?.token });
      if (epoch !== this.epoch) return;
      if (health.backend !== 'pi') throw new AdapterError('unsupported', 'Endpoint is not a Pi Bridge');
      this.sessionCatalog.configure(health.sessionCatalogSync);
      this.artifactsEnabled = health.artifacts === true;
      this.capabilities.promptStatus = health.promptStatus === true;
      this.capabilities.attachments = true;
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
      const cancelTimeout = scheduleRequestTimeout(this.transport, 25_000, () => finish(this.handshakeError ?? new AdapterError('timeout', 'Pi Bridge did not become ready')));
      const off = this.on('state', (state, reason) => {
        if (state === 'ready') finish();
        else if (requiresConnectionAction(reason)) finish(new AdapterError('unauthorized', 'Connection authorization is required'));
      });
      this.cancelConnect = () => finish(new AdapterError('bridge_offline', 'Pi connection cancelled'));
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
      const health = await this.rpc<{ artifacts?: boolean; promptStatus?: boolean; sessionCatalogSync?: unknown; backend: string; vision: boolean; model: string }>('health', {}, timeoutMs);
      if (epoch !== this.epoch || health.backend !== 'pi') return false;
      this.sessionCatalog.configure(health.sessionCatalogSync);
      this.artifactsEnabled = health.artifacts === true;
      this.capabilities.promptStatus = health.promptStatus === true;
      this.capabilities.attachments = true;
      return true;
    } catch (error) {
      if (epoch === this.epoch && requiresConnectionAction(error)) throw error;
      return false;
    }
  }

  async listAgents(): Promise<AgentDescriptor[]> {
    return (await this.rpc<AgentDescriptor[]>('agents.list')).map(agent => ({ ...agent, connectionId: this.record.id }));
  }
  async listSessions(): Promise<SessionDescriptor[]> {
    return (await this.sessionCatalog.list()).map(session => ({ ...session, connectionId: this.record.id }));
  }
  loadSession(key: string, options?: { limit?: number; cursor?: string }): Promise<SessionHistory> {
    return this.rpc<SessionHistory>('chat.history', { sessionKey: key, cursor: options?.cursor, ...(!!this.artifacts ? { artifacts: true } : {}) }).then(artifactHistoryDisplay);
  }
  prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    if (this.state !== 'ready') throw new AdapterError('bridge_offline', 'Pi Bridge is offline');
    return this.rpc('chat.send', { sessionKey: key, ...input });
  }
  async getPromptStatus(key: string, idempotencyKey: string): Promise<PromptStatus> {
    if (!this.capabilities.promptStatus) return { status: 'unknown' };
    const result = await this.rpc<PromptStatus>('chat.promptStatus', { sessionKey: key, idempotencyKey }, 5_000);
    return result?.status === 'recorded' && typeof result.runId === 'string' && result.runId.length > 0 && result.runId.length <= 200
      ? { status: 'recorded', runId: result.runId } : { status: 'unknown' };
  }
  async cancel(key: string, runId?: string): Promise<void> { await this.rpc('chat.abort', { sessionKey: key, runId }); }
  async steer(key: string, runId: string, text: string): Promise<void> { await this.rpc('chat.steer', { sessionKey: key, runId, text }); }
  async createSession(_agentId: string, options?: { title?: string; fromSession?: string }): Promise<SessionDescriptor> {
    const session = await this.rpc<SessionDescriptor>('sessions.create', options);
    this.sessionCatalog.invalidate();
    return { ...session, connectionId: this.record.id };
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
      const cancelTimeout = scheduleRequestTimeout(this.transport, timeoutMs, () => { this.pending.delete(id); reject(new AdapterError('timeout', 'Pi request timed out')); });
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
      else pending.reject(new AdapterError(frame.error?.code === 'BRIDGE_UNAVAILABLE' ? 'bridge_offline' : requiresConnectionAction(frame.error) ? 'unauthorized' : 'server', frame.error?.code === 'BRIDGE_UNAVAILABLE' ? 'Pi Bridge is offline. Keep the Bridge running on your computer.' : frame.error?.message ?? 'Pi request failed'));
    } else if (frame.type === 'event' && frame.event === 'pi.update') {
      const update = artifactUpdateDisplay(frame.payload as SessionUpdate);
      if (!update || typeof update.type !== 'string') return;
      if (update.type === 'session_info_update') update.session.connectionId = this.record.id;
      for (const listener of this.listeners.update) listener(update.type === 'agent_message_chunk'
        ? { ...update, textMode: 'delta' } : update);
    }
  }

  private rejectPending(): void {
    for (const entry of this.pending.values()) { entry.cancelTimeout(); entry.reject(new AdapterError('network', 'Connection interrupted')); }
    this.pending.clear();
  }
}
