import {
  AdapterError, resolveCapabilities,
  type AgentAdapter, type AgentDescriptor, type ConnectionDescriptor, type ConnectionRecord,
  type ConnectionState, type SessionDescriptor, type SessionHistory, type SessionUpdate,
  type AgentQuestion, type PromptInput, type ManagementOperations, type ModelSelectionState, type ModelSelectionWriteResult,
} from '@clawket/agent-protocol';
import { RelayWsTransport } from '../transports/relay-ws';
import type { WebSocketFactory } from '../transports/types';

type Listeners = {
  update: (update: SessionUpdate) => void;
  state: (state: ConnectionState, reason?: string) => void;
  sessions: (sessions: SessionDescriptor[]) => void;
};

function withNativeModelOrder<T extends ModelSelectionState>(state: T): T {
  return { ...state, models: state.models.map((model, sortOrder) => ({ ...model, sortOrder })) };
}

/** Project-scoped Codex sessions, native history and extension questions over the authenticated Bridge. */
export class CodexAdapter implements AgentAdapter {
  readonly connection: ConnectionDescriptor;
  readonly capabilities = resolveCapabilities('codex', { attachments: false });
  readonly projects = { list: () => this.rpc<import('@clawket/agent-protocol').ProjectDescriptor[]>('projects.list') };
  readonly questions = {
    list: (key: string) => this.rpc<AgentQuestion[]>('questions.list', { sessionKey: key }),
    respond: async (key: string, id: string, answer: { value?: string; confirmed?: boolean; cancelled?: boolean; answers?: Record<string, string[]> }) => { await this.rpc('questions.respond', { sessionKey: key, questionId: id, ...answer }); },
  };
  readonly management: ManagementOperations;
  private transport: RelayWsTransport;
  private currentState: ConnectionState = 'idle';
  private sequence = 0;
  private epoch = 0;
  private handshakeError: AdapterError | null = null;
  private unavailableAttempts = 0;
  private connectPromise: Promise<void> | null = null;
  private cancelConnect: (() => void) | null = null;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { update: new Set(), state: new Set(), sessions: new Set() };

  constructor(private readonly record: ConnectionRecord, options: { isFreeSlot?: boolean; webSocketFactory?: WebSocketFactory } = {}) {
    if (record.backendKind !== 'codex') throw new TypeError('Expected codex connection');
    this.connection = { id: record.id, backendKind: record.backendKind, transportKind: record.transportKind, label: record.label, createdAt: record.createdAt, environment: record.environment, isFreeSlot: options.isFreeSlot ?? false };
    const url = new URL(record.url);
    if (record.transportKind === 'relay') {
      if (!record.relay?.gatewayId || !record.relay.clientToken) throw new TypeError('Missing Relay credentials');
      url.searchParams.set('gatewayId', record.relay.gatewayId);
      url.searchParams.set('role', 'client');
      url.searchParams.set('clientId', record.id);
      url.searchParams.set('token', record.relay.clientToken);
      url.searchParams.set('capabilities', 'relay.client-pong.v1');
    }
    this.transport = new RelayWsTransport({ url: url.toString(), webSocketFactory: options.webSocketFactory,
      tickIntervalMs: 30_000, missedTickTolerance: 3 });
    this.transport.onOpen(() => { void this.handshake(); });
    this.transport.onMessage(data => this.receive(data));
    this.transport.onStateChange(change => {
      if (change.state !== 'ready') this.setState(change.state === 'closed' ? 'offline' : change.state);
    });
    this.transport.onClose(() => { this.epoch++; this.rejectPending(); });
    this.management = { approvals: { listExec: sessionKey => this.rpc('approvals.list', { sessionKey }), resolveExec: async (id, decision) => { await this.rpc('approvals.resolve', { id, decision }); } }, skills: { status: () => this.rpc('skills.list') }, models: {
      list: async () => withNativeModelOrder(await this.rpc<ModelSelectionState>('models.list')).models,
      getSelection: async key => withNativeModelOrder(await this.rpc<ModelSelectionState>('models.list', { sessionKey: key ?? undefined })),
      setSelection: async params => withNativeModelOrder(await this.rpc<ModelSelectionWriteResult>('models.select', { ...params })),
      listThinkingLevels: () => [],
      setThinkingLevel: async (sessionKey, level) => withNativeModelOrder(await this.rpc<ModelSelectionState>('models.thinking', { sessionKey, level })),
    } };
  }

  get state(): ConnectionState { return this.currentState; }

  private setState(state: ConnectionState): void {
    this.currentState = state;
    for (const listener of this.listeners.state) listener(state);
  }

  private async handshake(): Promise<void> {
    const epoch = ++this.epoch;
    try {
      // Relay authenticates its socket; only direct connections need connect/token.
      // A Relay connect request starts OpenClaw's challenge lifecycle.
      const health = await this.rpc<{ backend: string; vision: boolean; model: string; projects?: boolean }>(this.record.transportKind === 'relay' ? 'health' : 'connect', { token: this.record.auth?.token });
      if (epoch !== this.epoch) return;
      if (health.backend !== 'codex') throw new AdapterError('unsupported', 'Endpoint is not a Codex Bridge');
      this.capabilities.attachments = true; this.capabilities.projects = health.projects === true;
      this.handshakeError = null; this.unavailableAttempts = 0;
      this.transport.markReady(); this.setState('ready');
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.handshakeError = error instanceof AdapterError ? error : null;
      const unavailable = this.handshakeError?.code === 'bridge_offline';
      // An absent computer cannot recover through rapid phone handshakes.
      const delay = unavailable ? Math.min(120_000, 30_000 * 2 ** Math.min(this.unavailableAttempts++, 2)) : 0;
      this.transport.retryHandshake(delay);
    }
  }

  connect(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    const ready = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); off(); this.cancelConnect = null;
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => finish(this.handshakeError ?? new AdapterError('timeout', 'Codex Bridge did not become ready')), 25_000);
      const off = this.on('state', state => { if (state === 'ready') finish(); });
      this.cancelConnect = () => finish(new AdapterError('bridge_offline', 'Codex connection cancelled'));
    });
    const attempt = ready.finally(() => { if (this.connectPromise === attempt) this.connectPromise = null; });
    this.connectPromise = attempt;
    this.transport.connect();
    return attempt;
  }

  disconnect(): void {
    this.epoch++; this.cancelConnect?.(); this.connectPromise = null;
    this.transport.disconnect(); this.rejectPending(); this.setState('offline');
    this.handshakeError = null; this.unavailableAttempts = 0;
  }

  async probe(): Promise<boolean> {
    const epoch = this.epoch;
    try {
      const health = await this.rpc<{ backend: string; vision: boolean; model: string; projects?: boolean }>('health');
      if (epoch !== this.epoch || health.backend !== 'codex') return false;
      this.capabilities.attachments = true; this.capabilities.projects = health.projects === true;
      return true;
    } catch { return false; }
  }

  async listAgents(): Promise<AgentDescriptor[]> {
    return (await this.rpc<AgentDescriptor[]>('agents.list')).map(agent => ({ ...agent, connectionId: this.record.id }));
  }
  async listSessions(): Promise<SessionDescriptor[]> {
    return (await this.rpc<SessionDescriptor[]>('sessions.list')).map(session => ({ ...session, connectionId: this.record.id }));
  }
  loadSession(key: string, options?: { limit?: number; cursor?: string }): Promise<SessionHistory> {
    return this.rpc('chat.history', { sessionKey: key, cursor: options?.cursor });
  }
  prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    if (this.state !== 'ready') throw new AdapterError('bridge_offline', 'Codex Bridge is offline');
    return this.rpc('chat.send', { sessionKey: key, ...input, thinkingLevel: input.thinkingLevel === 'off' ? undefined : input.thinkingLevel });
  }
  async cancel(key: string, runId?: string): Promise<void> { await this.rpc('chat.abort', { sessionKey: key, runId }); }
  async steer(key: string, runId: string, text: string): Promise<void> { await this.rpc('chat.steer', { sessionKey: key, runId, text }); }
  async createSession(_agentId: string, options?: { title?: string; fromSession?: string; projectId?: string }): Promise<SessionDescriptor> {
    const session = await this.rpc<SessionDescriptor>('sessions.create', options);
    const scoped = { ...session, connectionId: this.record.id };
    for (const listener of this.listeners.update) listener({ type: 'session_info_update', session: scoped });
    return scoped;
  }
  async patchSession(key: string, patch: { title?: string }): Promise<void> { await this.rpc('sessions.rename', { sessionKey: key, ...patch }); }
  async resetSession(key: string): Promise<void> { await this.rpc('sessions.reset', { sessionKey: key }); }
  async deleteSession(key: string): Promise<void> { await this.rpc('sessions.delete', { sessionKey: key }); }

  on<K extends keyof Listeners>(event: K, listener: Listeners[K]): () => void {
    this.listeners[event].add(listener); return () => { this.listeners[event].delete(listener); };
  }


  private rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `${this.record.id}-${this.epoch}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AdapterError('timeout', 'Codex request timed out')); }, method === 'models.select' ? 190_000 : 20_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.transport.send(JSON.stringify({ type: 'req', id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private receive(data: unknown): void {
    let frame: { type?: string; id?: string; ok?: boolean; payload?: unknown; event?: string; error?: { code?: string; message?: string } };
    try { frame = JSON.parse(String(data)); } catch { return; }
    if (frame.type === 'res' && frame.id) {
      const pending = this.pending.get(frame.id); if (!pending) return;
      this.pending.delete(frame.id); clearTimeout(pending.timer);
      if (frame.ok) pending.resolve(frame.payload);
      else pending.reject(new AdapterError(frame.error?.code === 'BRIDGE_UNAVAILABLE' ? 'bridge_offline' : 'server', frame.error?.code === 'BRIDGE_UNAVAILABLE' ? 'Codex Bridge is offline. Keep the Bridge running on your computer.' : frame.error?.message ?? 'Codex request failed'));
    } else if (frame.type === 'event' && frame.event === 'codex.update') {
      const update = frame.payload as SessionUpdate;
      if (!update || typeof update.type !== 'string') return;
      if (update.type === 'session_info_update') update.session.connectionId = this.record.id;
      for (const listener of this.listeners.update) listener(update.type === 'agent_message_chunk'
        ? { ...update, textMode: update.textMode ?? 'snapshot' } : update);
    }
  }

  private rejectPending(): void {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new AdapterError('network', 'Connection interrupted')); }
    this.pending.clear();
  }
}
