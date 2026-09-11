import {
  AdapterError, resolveCapabilities,
  type AgentAdapter, type AgentDescriptor, type ConnectionDescriptor, type ConnectionRecord,
  type ConnectionState, type SessionDescriptor, type SessionHistory, type SessionUpdate,
  type PromptInput, type ManagementOperations, type ModelSelectionState, type ModelSelectionWriteResult,
} from '@clawket/agent-protocol';
import { RelayWsTransport } from '../transports/relay-ws';
import type { WebSocketFactory } from '../transports/types';

type Listeners = {
  update: (update: SessionUpdate) => void;
  state: (state: ConnectionState, reason?: string) => void;
  sessions: (sessions: SessionDescriptor[]) => void;
};

/** Backend-neutral chat UI with a Bridge-owned durable conversation. */
export class LocalModelAdapter implements AgentAdapter {
  readonly connection: ConnectionDescriptor;
  readonly capabilities = resolveCapabilities('local-model', { attachments: false });
  readonly management: ManagementOperations;
  private transport: RelayWsTransport;
  private currentState: ConnectionState = 'idle';
  private model = '';
  private active = false;
  private sequence = 0;
  private epoch = 0;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { update: new Set(), state: new Set(), sessions: new Set() };

  constructor(private readonly record: ConnectionRecord, options: { isFreeSlot?: boolean; webSocketFactory?: WebSocketFactory } = {}) {
    if (record.backendKind !== 'local-model') throw new TypeError('Expected local-model connection');
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
    this.transport = new RelayWsTransport({ url: url.toString(), webSocketFactory: options.webSocketFactory });
    this.transport.onOpen(() => { void this.handshake(); });
    this.transport.onMessage(data => this.receive(data));
    this.transport.onStateChange(change => {
      if (change.state !== 'ready') this.setState(change.state === 'closed' ? 'offline' : change.state);
    });
    this.transport.onClose(() => { this.epoch++; this.rejectPending(); });
    this.management = { models: {
      list: async () => (await this.rpc<ModelSelectionState>('models.list')).models,
      getSelection: () => this.rpc<ModelSelectionState>('models.list'),
      setSelection: async params => {
        if (params.scope === 'session') throw new AdapterError('unsupported', 'Only global model selection is supported');
        const result = await this.rpc<ModelSelectionWriteResult>('models.select', { model: params.model });
        if (!await this.probe()) throw new AdapterError('server', 'Model switched but its health check failed');
        return result;
      },
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
      const health = await this.rpc<{ backend: string; vision: boolean; model: string }>('connect', { token: this.record.auth?.token, capabilities: ['relay.client-pong.v1'] });
      if (epoch !== this.epoch) return;
      if (health.backend !== 'local-model') throw new AdapterError('unsupported', 'Endpoint is not a local model Bridge');
      this.capabilities.attachments = health.vision === true;
      this.model = health.model;
      this.transport.markReady(); this.setState('ready');
    } catch {
      if (epoch === this.epoch) this.transport.reconnect();
    }
  }

  async connect(): Promise<void> {
    if (this.state === 'ready') return;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new AdapterError('timeout', 'Local model Bridge did not become ready')); }, 25_000);
      const off = this.on('state', state => { if (state === 'ready') { clearTimeout(timer); off(); resolve(); } });
    });
    this.transport.connect();
    return ready;
  }

  disconnect(): void { this.epoch++; this.transport.disconnect(); this.rejectPending(); this.setState('offline'); }

  async probe(): Promise<boolean> {
    const epoch = this.epoch;
    try {
      const health = await this.rpc<{ backend: string; vision: boolean; model: string }>('health');
      if (epoch !== this.epoch || health.backend !== 'local-model') return false;
      this.capabilities.attachments = health.vision === true; this.model = health.model;
      return true;
    } catch { return false; }
  }

  async listAgents(): Promise<AgentDescriptor[]> {
    return [{ connectionId: this.record.id, agentId: 'main', name: this.record.label, isMain: true, mainSessionKey: 'main' }];
  }

  async listSessions(): Promise<SessionDescriptor[]> {
    return [{ connectionId: this.record.id, agentId: 'main', key: 'main', kind: 'main', title: this.record.label,
      updatedAt: null, model: this.model, modelProvider: 'local-model', hasActiveRun: this.active,
      allowedActions: { rename: false, reset: false, delete: false, pin: false } }];
  }

  async loadSession(key: string, options?: { limit?: number; cursor?: string }): Promise<SessionHistory> {
    this.assertMain(key);
    const history = await this.rpc<SessionHistory>('chat.history', { cursor: options?.cursor }); this.active = history.hasActiveRun; return history;
  }

  async prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    this.assertMain(key);
    if (this.state !== 'ready') throw new AdapterError('bridge_offline', 'Local model Bridge is offline');
    return this.rpc('chat.send', { sessionKey: key, ...input });
  }

  async cancel(key: string, runId?: string): Promise<void> { this.assertMain(key); await this.rpc('chat.abort', { runId }); }

  on<K extends keyof Listeners>(event: K, listener: Listeners[K]): () => void {
    this.listeners[event].add(listener); return () => { this.listeners[event].delete(listener); };
  }

  private assertMain(key: string): void { if (key !== 'main') throw new AdapterError('unsupported', 'Unknown local conversation'); }

  private rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `${this.record.id}-${this.epoch}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AdapterError('timeout', 'Local model request timed out')); }, method === 'models.select' ? 190_000 : 20_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.transport.send(JSON.stringify({ type: 'req', id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private receive(data: unknown): void {
    let frame: { type?: string; id?: string; ok?: boolean; payload?: unknown; event?: string; error?: { message?: string } };
    try { frame = JSON.parse(String(data)); } catch { return; }
    if (frame.type === 'res' && frame.id) {
      const pending = this.pending.get(frame.id); if (!pending) return;
      this.pending.delete(frame.id); clearTimeout(pending.timer);
      if (frame.ok) pending.resolve(frame.payload);
      else pending.reject(new AdapterError('server', frame.error?.message ?? 'Local model request failed'));
    } else if (frame.type === 'event' && frame.event === 'local-model.update') {
      const update = frame.payload as SessionUpdate;
      if (!update || typeof update.type !== 'string') return;
      if (update.type === 'run_started') this.active = true;
      if (update.type === 'run_finished') this.active = false;
      for (const listener of this.listeners.update) listener(update);
    }
  }

  private rejectPending(): void {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new AdapterError('network', 'Connection interrupted')); }
    this.pending.clear();
  }
}
