import type { ConnectionRecord, SessionUpdate } from '@clawket/agent-protocol';
import openClawFixture from '../../../../../tests/compat/fixtures/v1/bridge/openclaw-forwarding-v1.json';
import hermesAttachmentFixture from '../../../../../tests/fixtures/hermes/m3-attachment-abort-v2.json';
import hermesSessionsFixture from '../../../../../tests/fixtures/hermes/m3-multi-session-v2.json';
import type { GatewayClient } from '../../services/gateway';
import type { ConnectionState, GatewayConfig } from '../../types';
import { HermesAdapter, HERMES_MULTI_SESSION_CAPABILITY } from './hermes';
import {
  OPENCLAW_BRIDGE_CAPABILITY,
  OpenClawAdapter,
} from './openclaw';

type GatewayEventName =
  | 'connection'
  | 'health'
  | 'seqGap'
  | 'chatRunStart'
  | 'chatDelta'
  | 'chatTool'
  | 'chatFinal'
  | 'chatAborted'
  | 'chatError'
  | 'chatCompaction'
  | 'execApprovalRequested'
  | 'execApprovalResolved'
  | 'pairingRequired'
  | 'pairingResolved'
  | 'error';

class RecordedGateway {
  public config: GatewayConfig | null = null;
  public state: ConnectionState = 'idle';
  public connectCalls = 0;
  public disconnectCalls = 0;
  public currentConnectMeta: { capabilities: string[] } | undefined;
  public readonly connectMetas: Array<{ capabilities: string[] } | undefined> = [];
  public connectResponseCapabilities: readonly string[] | undefined;
  public readonly requests: Array<{ method: string; params: object }> = [];
  public readonly aborts: Array<{ key: string; runId?: string }> = [];
  public sessions: Array<Record<string, unknown>> = [];
  public onConnect: ((attempt: number) => void) | undefined;
  public requestHandler: ((method: string, params: object) => unknown | Promise<unknown>) | undefined;

  private readonly listeners = new Map<string, Set<(payload: any) => void>>();

  public configure(config: GatewayConfig | null): void {
    this.config = config;
  }

  public on(event: GatewayEventName, listener: (payload: any) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  public emit(event: GatewayEventName, payload: any): void {
    if (event === 'connection') this.state = payload.state;
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  public connect(): void {
    this.connectCalls += 1;
    this.connectMetas.push(this.currentConnectMeta
      ? { capabilities: [...this.currentConnectMeta.capabilities] }
      : undefined);
    this.onConnect?.(this.connectCalls);
  }

  public disconnect(): void {
    this.disconnectCalls += 1;
    this.emit('connection', { state: 'closed' });
  }

  public setConnectRequestMeta(meta?: { capabilities: string[] }): void {
    this.currentConnectMeta = meta;
  }

  public getConnectResponseCapabilities(): readonly string[] | undefined {
    return this.connectResponseCapabilities;
  }

  public getConnectionState(): ConnectionState {
    return this.state;
  }

  public async probeConnection(): Promise<boolean> {
    return this.state === 'ready';
  }

  public async request<T>(method: string, params: object = {}): Promise<T> {
    this.requests.push({ method, params });
    return await this.requestHandler?.(method, params) as T;
  }

  public async abortChat(key: string, runId?: string): Promise<void> {
    this.aborts.push({ key, runId });
  }

  public async listSessions(): Promise<any[]> {
    return this.sessions;
  }

  public async listAgents(): Promise<any> {
    return {
      defaultId: 'main',
      mainKey: 'agent:main:main',
      agents: [{ id: 'main', name: 'Main Agent', identity: { emoji: 'M' } }],
    };
  }

  public async fetchIdentity(): Promise<any> {
    return { name: 'Recorded Main', emoji: 'R' };
  }

  public async patchSession(key: string, patch: object): Promise<any> {
    this.requests.push({ method: 'sessions.patch', params: { key, ...patch } });
    return { ok: true, key };
  }

  public async resetSession(key: string): Promise<any> {
    this.requests.push({ method: 'sessions.reset', params: { key } });
    return { ok: true, key };
  }

  public async deleteSession(key: string): Promise<any> {
    this.requests.push({ method: 'sessions.delete', params: { key } });
    return { ok: true, key };
  }
}

function gateway(value: RecordedGateway): GatewayClient {
  return value as unknown as GatewayClient;
}

function connection(
  backendKind: 'openclaw' | 'hermes',
  id = `${backendKind}-recorded`,
): ConnectionRecord {
  return {
    id,
    backendKind,
    transportKind: backendKind === 'openclaw' ? 'relay' : 'local',
    label: backendKind === 'openclaw' ? 'Recorded OpenClaw' : 'Recorded Hermes',
    createdAt: 1_700_000_000_000,
    url: backendKind === 'openclaw'
      ? 'wss://relay.fixture.invalid/ws'
      : 'ws://127.0.0.1:8787/v1/hermes/ws',
  };
}

function packet(label: string): any {
  return hermesSessionsFixture.packets.find((entry) => entry.label === label);
}

describe('OpenClawAdapter recorded v1 boundary', () => {
  it('keeps the recorded v1 prompt body and maps agents, sessions, and events', async () => {
    const fake = new RecordedGateway();
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    fake.sessions = [
      { key: 'agent:main:main', title: 'Main', updatedAt: 10 },
      { key: 'agent:main:subagent:child', title: 'Child', spawnedBy: 'agent:main:main', updatedAt: 9 },
      { key: 'agent:other:cron:daily', title: '[Cron] Daily', updatedAt: 8 },
    ];
    fake.requestHandler = (method) => method === 'chat.send' ? { runId: 'compat-run-1' } : {};
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });

    await adapter.connect();
    expect(adapter.state).toBe('ready');
    expect(adapter.negotiatedBridgeCapabilityMode).toBe('legacy');

    const agents = await adapter.listAgents();
    expect(agents).toEqual([expect.objectContaining({
      agentId: 'main',
      name: 'Recorded Main',
      isMain: true,
      mainSessionKey: 'agent:main:main',
    })]);
    const sessions = await adapter.listSessions('main');
    expect(sessions.map((entry) => [entry.key, entry.kind])).toEqual([
      ['agent:main:main', 'main'],
      ['agent:main:subagent:child', 'subagent'],
    ]);
    expect(sessions[0].allowedActions.delete).toBe(false);
    expect(sessions[1].parentSessionKey).toBe('agent:main:main');

    const recordedChat = openClawFixture.frames.find((frame) => frame.sequence === 20)?.payload as any;
    await expect(adapter.prompt('agent:main:main', {
      text: recordedChat.params.message,
      idempotencyKey: recordedChat.params.idempotencyKey,
    })).resolves.toEqual({ runId: 'compat-run-1' });
    expect(fake.requests.at(-1)).toEqual({
      method: 'chat.send',
      params: recordedChat.params,
    });

    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));
    fake.emit('chatDelta', {
      runId: 'compat-run-1',
      sessionKey: 'agent:main:main',
      text: 'recorded delta',
    });
    fake.emit('chatFinal', {
      runId: 'compat-run-1',
      sessionKey: 'agent:main:main',
      message: { role: 'assistant', content: 'recorded final' },
    });
    expect(updates).toEqual([
      expect.objectContaining({ type: 'agent_message_chunk', text: 'recorded delta' }),
      expect.objectContaining({ type: 'run_finished', stopReason: 'end_turn' }),
    ]);
  });

  it('advertises v2 once, then performs one byte-compatible no-meta fallback', async () => {
    const fake = new RecordedGateway();
    fake.onConnect = (attempt) => {
      if (attempt === 1) {
        fake.emit('connection', { state: 'challenging' });
        queueMicrotask(() => fake.emit('error', {
          code: 'invalid_request',
          message: 'unknown property meta in closed schema',
        }));
        return;
      }
      queueMicrotask(() => fake.emit('connection', { state: 'ready' }));
    };
    const persisted: string[] = [];
    const adapter = new OpenClawAdapter(connection('openclaw', 'fallback'), {
      gateway: gateway(fake),
      bridgeCapabilityMode: 'unknown',
      onBridgeCapabilityMode: (mode) => { persisted.push(mode); },
    });

    await adapter.connect();

    expect(fake.connectMetas).toEqual([
      { capabilities: [OPENCLAW_BRIDGE_CAPABILITY] },
      undefined,
    ]);
    expect(fake.connectCalls).toBe(2);
    expect(adapter.negotiatedBridgeCapabilityMode).toBe('legacy');
    expect(persisted).toEqual(['legacy']);
  });

  it('keeps v2 mode only when the matching successful response advertises it', async () => {
    const fake = new RecordedGateway();
    fake.connectResponseCapabilities = [OPENCLAW_BRIDGE_CAPABILITY];
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    const adapter = new OpenClawAdapter(connection('openclaw', 'v2'), {
      gateway: gateway(fake),
      bridgeCapabilityMode: 'unknown',
    });

    await adapter.connect();

    expect(fake.connectMetas).toEqual([{ capabilities: [OPENCLAW_BRIDGE_CAPABILITY] }]);
    expect(adapter.negotiatedBridgeCapabilityMode).toBe('v2');
  });
});

describe('HermesAdapter recorded M3 boundary', () => {
  it('waits for recorded health and maps multi-session CRUD plus two history pages', async () => {
    const fake = new RecordedGateway();
    const created = {
      ...(packet('sessions.create').expect.payload.session as Record<string, unknown>),
      key: 'bridge-recorded-session',
      sessionId: 'backing-recorded-session',
      updatedAt: 1_700_000_003_000,
    };
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    fake.requestHandler = (method, params) => {
      if (method === 'sessions.list') return packet('sessions.list.initial').expect.payload;
      if (method === 'sessions.create') return { session: created };
      if (method === 'chat.history') {
        const label = 'cursor' in params ? 'chat.history.page-2' : 'chat.history.page-1';
        const payload = structuredClone(packet(label).expect.payload);
        if (label === 'chat.history.page-1') payload.nextCursor = 'recorded-cursor';
        return payload;
      }
      return { ok: true };
    };
    const adapter = new HermesAdapter(connection('hermes'), { gateway: gateway(fake) });
    const connecting = adapter.connect();
    expect(adapter.state).toBe('handshaking');
    fake.emit('health', hermesSessionsFixture.firstFrame.payload);
    await connecting;

    expect(adapter.state).toBe('ready');
    expect(adapter.capabilities.sessions).toBe(true);
    expect(adapter.connection.bridgeOutdated).toBeUndefined();
    const sessions = await adapter.listSessions();
    expect(sessions).toEqual([expect.objectContaining({
      key: 'native-recorded-session',
      source: 'native',
      title: 'Recorded native session',
      allowedActions: { rename: false, reset: false, delete: false, pin: false },
    })]);

    const first = await adapter.loadSession('native-recorded-session', { limit: 2 });
    const second = await adapter.loadSession('native-recorded-session', {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(first.messages.map((message) => message.text)).toEqual([
      'same-timestamp-newer-id',
      'newest-message',
    ]);
    expect(second.messages.map((message) => message.text)).toEqual([
      'oldest-message',
      'same-timestamp-older-id',
    ]);
    expect(fake.requests.filter((entry) => entry.method === 'chat.history')).toEqual([
      { method: 'chat.history', params: { sessionKey: 'native-recorded-session', limit: 2 } },
      {
        method: 'chat.history',
        params: { sessionKey: 'native-recorded-session', limit: 2, cursor: 'recorded-cursor' },
      },
    ]);

    await expect(adapter.createSession('hermes', { title: 'Recorded bridge session' }))
      .resolves.toEqual(expect.objectContaining({ key: 'bridge-recorded-session', source: 'bridge' }));
    await adapter.patchSession('bridge-recorded-session', { title: 'Title field wins' });
    await adapter.resetSession('bridge-recorded-session');
    await adapter.deleteSession('bridge-recorded-session');
    expect(fake.requests).toEqual(expect.arrayContaining([
      { method: 'sessions.create', params: { title: 'Recorded bridge session' } },
      { method: 'sessions.patch', params: { key: 'bridge-recorded-session', title: 'Title field wins' } },
      { method: 'sessions.reset', params: { key: 'bridge-recorded-session' } },
      { method: 'sessions.delete', params: { key: 'bridge-recorded-session' } },
    ]));
  });

  it('locks the recorded image wrapper, abort call, and aborted terminal event', async () => {
    const fake = new RecordedGateway();
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    fake.requestHandler = (method) => method === 'chat.send' ? { runId: 'recorded-run-id' } : {};
    const adapter = new HermesAdapter(connection('hermes', 'attachment'), { gateway: gateway(fake) });
    const connecting = adapter.connect();
    fake.emit('health', hermesAttachmentFixture.firstFrame.payload);
    await connecting;

    const recorded = hermesAttachmentFixture.sendPacket.request.params;
    await expect(adapter.prompt(recorded.sessionKey, {
      text: recorded.message,
      idempotencyKey: recorded.idempotencyKey,
      attachments: recorded.attachments.map((attachment) => ({
        type: attachment.type as 'image',
        mimeType: attachment.mimeType,
        content: attachment.content,
      })),
    })).resolves.toEqual({ runId: 'recorded-run-id' });
    expect(fake.requests.at(-1)).toEqual({ method: 'chat.send', params: recorded });

    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));
    await adapter.cancel(recorded.sessionKey, 'recorded-run-id');
    fake.emit('chatAborted', {
      runId: 'recorded-run-id',
      sessionKey: recorded.sessionKey,
    });
    expect(fake.aborts).toEqual([{ key: recorded.sessionKey, runId: 'recorded-run-id' }]);
    expect(updates).toContainEqual({
      type: 'run_finished',
      sessionKey: recorded.sessionKey,
      runId: 'recorded-run-id',
      stopReason: 'cancelled',
    });
  });

  it('downgrades an old Bridge to one read-only main session', async () => {
    const fake = new RecordedGateway();
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    const adapter = new HermesAdapter(connection('hermes', 'legacy'), { gateway: gateway(fake) });
    const connecting = adapter.connect();
    fake.emit('health', {
      status: 'ok',
      hermesApiReachable: true,
      capabilities: ['bridge.capabilities.v2'],
    });
    await connecting;

    expect(adapter.capabilities.sessions).toBe(false);
    expect(adapter.capabilities.sessionCreate).toBe(false);
    expect(adapter.connection.bridgeOutdated).toBe(true);
    await expect(adapter.listSessions()).resolves.toEqual([expect.objectContaining({
      key: 'main',
      allowedActions: { rename: false, reset: false, delete: false, pin: false },
    })]);
    await expect(adapter.createSession('hermes')).rejects.toMatchObject({ code: 'unsupported' });
    expect(fake.requests).toEqual([]);
  });

  it('renders a recorded local slash-command acknowledgement as a system event', async () => {
    const fake = new RecordedGateway();
    fake.requestHandler = (_method, params) => {
      const runId = (params as { idempotencyKey: string }).idempotencyKey;
      fake.emit('chatRunStart', { runId, sessionKey: 'main' });
      fake.emit('chatFinal', {
        runId,
        sessionKey: 'main',
        message: { role: 'assistant', content: 'Model switched' },
      });
      return { runId };
    };
    const adapter = new HermesAdapter(connection('hermes', 'command'), { gateway: gateway(fake) });
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    await adapter.prompt('main', { text: '/model fixture', idempotencyKey: 'command-run' });

    expect(updates).toContainEqual({
      type: 'system_event',
      sessionKey: 'main',
      kind: 'command_ack',
      text: 'Model switched',
      timestampMs: expect.any(Number),
    });
    expect(updates).toContainEqual({
      type: 'run_finished',
      sessionKey: 'main',
      runId: 'command-run',
      stopReason: 'end_turn',
      message: undefined,
      usage: undefined,
    });
  });

  it('exposes every management group allowed by the Hermes capability matrix', async () => {
    const fake = new RecordedGateway();
    const adapter = new HermesAdapter(connection('hermes', 'management'), { gateway: gateway(fake) });
    expect(adapter.capabilities.cron).toBe(true);
    expect(adapter.management.models?.list).toBeDefined();
    expect(adapter.management.skills?.status).toBeDefined();
    expect(adapter.management.skills?.discover).toBeDefined();
    expect(adapter.management.cron?.list).toBeDefined();
    expect(adapter.management.cron?.add).toBeDefined();
    expect(adapter.management.agents?.list).toBeDefined();
    expect(adapter.management.agents?.files?.list).toBeDefined();
    expect(adapter.management.usage?.sessions).toBeDefined();
    expect(adapter.management.usage?.cost).toBeDefined();
    expect(adapter.capabilities.sessions).toBe(true);
    expect(HERMES_MULTI_SESSION_CAPABILITY).toBe('hermes.multi-session.v2');
  });
});
