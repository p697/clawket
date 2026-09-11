import type { ConnectionRecord, SessionUpdate } from '@clawket/agent-protocol';
import type { GatewayClient } from '../protocol';
import type { ConnectionState, GatewayConfig } from '../../types';
import { mapGatewayHistoryMessage, mergeGatewayHistory } from './gateway-adapter';
import { HermesAdapter } from './hermes';
import { OPENCLAW_BRIDGE_CAPABILITY, OpenClawAdapter } from './openclaw';
import { readConnectionRuntimeMetadata } from '../runtime-details';

type GatewayEventName =
  | 'connection'
  | 'health'
  | 'sessionsChanged'
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
  | 'pairApprovalRequested'
  | 'pairApprovalResolved'
  | 'pairingRequired'
  | 'pairingResolved'
  | 'error';

class LifecycleGateway {
  public state: ConnectionState = 'idle';
  public connectCalls = 0;
  public disconnectCalls = 0;
  public currentConnectMeta: { capabilities: string[] } | undefined;
  public readonly connectMetas: Array<{ capabilities: string[] } | undefined> = [];
  public connectResponseBridgeVersion: string | undefined;
  public onConnect: (() => void) | undefined;
  public requestHandler: ((method: string, params: object) => unknown | Promise<unknown>) | undefined;
  public sessions: Array<Record<string, unknown>> = [];

  private readonly listeners = new Map<string, Set<(payload: any) => void>>();

  public configure(_config: GatewayConfig | null): void {}

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
    this.onConnect?.();
  }

  public disconnect(): void {
    this.disconnectCalls += 1;
    this.emit('connection', { state: 'closed' });
  }

  public setConnectRequestMeta(meta?: { capabilities: string[] }): void {
    this.currentConnectMeta = meta;
  }

  public getConnectResponseCapabilities(): readonly string[] | undefined {
    return undefined;
  }

  public getConnectResponseBridgeVersion(): string | undefined {
    return this.connectResponseBridgeVersion;
  }

  public async probeConnection(): Promise<boolean> {
    return this.state === 'ready';
  }

  public async request<T>(method: string, params: object = {}): Promise<T> {
    return await this.requestHandler?.(method, params) as T;
  }

  public async abortChat(): Promise<void> {}

  public async listSessions(): Promise<any[]> {
    return this.sessions;
  }

  public async listAgents(): Promise<any> {
    return { defaultId: 'main', mainKey: 'agent:main:main', agents: [] };
  }

  public async fetchIdentity(): Promise<any> {
    return {};
  }
}

function gateway(value: LifecycleGateway): GatewayClient {
  return value as unknown as GatewayClient;
}

function connection(backendKind: 'openclaw' | 'hermes', id: string = backendKind): ConnectionRecord {
  return {
    id,
    backendKind,
    transportKind: backendKind === 'openclaw' ? 'relay' : 'local',
    label: backendKind,
    createdAt: 1,
    url: backendKind === 'openclaw' ? 'wss://relay.invalid/ws' : 'ws://127.0.0.1:8787',
  };
}

function credentialConnection(
  backendKind: 'openclaw' | 'hermes',
  id: string,
): ConnectionRecord {
  return {
    ...connection(backendKind, id),
    transportKind: 'relay',
    url: `wss://${id}.invalid/ws`,
    auth: {
      token: `${id}-auth-token`,
      password: `${id}-auth-password`,
    },
    bootstrap: {
      token: `${id}-bootstrap-token`,
      strategy: 'mobile-setup',
    },
    relay: {
      serverUrl: `wss://${id}-relay.invalid`,
      gatewayId: `${id}-gateway`,
      clientToken: `${id}-client-token`,
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GatewayAdapter lifecycle boundaries', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps OpenClaw and Hermes runtime credentials out of enumerable adapter state', () => {
    const openClawRecord = credentialConnection('openclaw', 'openclaw-private');
    const hermesRecord = credentialConnection('hermes', 'hermes-private');
    const adapters = [
      new OpenClawAdapter(openClawRecord, {
        bridgeCapabilityMode: 'legacy',
        historyCache: null,
      }),
      new HermesAdapter(hermesRecord, { historyCache: null }),
    ];

    for (const [adapter, record] of [
      [adapters[0], openClawRecord],
      [adapters[1], hermesRecord],
    ] as const) {
      const serialized = JSON.stringify(adapter);
      expect(Reflect.ownKeys(adapter)).not.toEqual(expect.arrayContaining([
        'record',
        'gateway',
        'gatewayConfig',
      ]));
      expect(serialized).not.toContain(record.auth!.token!);
      expect(serialized).not.toContain(record.auth!.password!);
      expect(serialized).not.toContain(record.bootstrap!.token);
      expect(serialized).not.toContain(record.relay!.clientToken!);
      adapter.dispose();
    }
  });

  it('loads a persisted legacy bridge mode once before opening the socket', async () => {
    const fake = new LifecycleGateway();
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    const loadMode = jest.fn(async () => 'legacy' as const);
    const adapter = new OpenClawAdapter(connection('openclaw', 'persisted'), {
      gateway: gateway(fake),
      historyCache: null,
      loadBridgeCapabilityMode: loadMode,
    });

    await adapter.connect();
    adapter.disconnect();
    await adapter.connect();

    expect(loadMode).toHaveBeenCalledTimes(1);
    expect(fake.connectMetas).toEqual([undefined, undefined]);
  });

  it('clears Hermes Bridge version before a reconnect to versionless legacy health', async () => {
    const fake = new LifecycleGateway();
    const adapter = new HermesAdapter(connection('hermes', 'hermes-version'), {
      gateway: gateway(fake),
      historyCache: null,
    });

    const firstConnect = adapter.connect();
    fake.emit('health', {
      status: 'ok',
      hermesApiReachable: true,
      bridgeVersion: '3.0.0',
      capabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2'],
    });
    await firstConnect;
    expect(readConnectionRuntimeMetadata(adapter).bridgeVersion).toBe('3.0.0');
    expect(readConnectionRuntimeMetadata(adapter).bridgeCapabilities).toEqual([
      'bridge.capabilities.v2',
      'hermes.multi-session.v2',
    ]);

    adapter.disconnect();
    expect(readConnectionRuntimeMetadata(adapter)).toEqual({
      bridgeVersion: null,
      bridgeCapabilities: [],
    });
    const legacyConnect = adapter.connect();
    fake.emit('health', {
      status: 'ok',
      hermesApiReachable: true,
      capabilities: ['bridge.capabilities.v2'],
    });
    await legacyConnect;

    expect(readConnectionRuntimeMetadata(adapter).bridgeVersion).toBeNull();
  });

  it('does not downgrade a v2 handshake after a transient network failure', async () => {
    const fake = new LifecycleGateway();
    fake.onConnect = () => {
      fake.emit('connection', { state: 'challenging' });
      queueMicrotask(() => fake.emit('error', {
        code: 'network',
        message: 'socket reset during challenge',
      }));
    };
    const persistMode = jest.fn();
    const adapter = new OpenClawAdapter(connection('openclaw', 'network'), {
      gateway: gateway(fake),
      historyCache: null,
      onBridgeCapabilityMode: persistMode,
    });

    await expect(adapter.connect()).rejects.toMatchObject({ code: 'network' });

    expect(fake.connectCalls).toBe(1);
    expect(fake.connectMetas).toEqual([{ capabilities: [OPENCLAW_BRIDGE_CAPABILITY] }]);
    expect(persistMode).not.toHaveBeenCalled();
  });

  it('closes a timed-out handshake and ignores a late ready transition', async () => {
    jest.useFakeTimers();
    const fake = new LifecycleGateway();
    const adapter = new OpenClawAdapter(connection('openclaw', 'timeout'), {
      gateway: gateway(fake),
      historyCache: null,
      bridgeCapabilityMode: 'legacy',
      connectTimeoutMs: 25,
    });
    const connecting = adapter.connect();
    const rejection = expect(connecting).rejects.toMatchObject({ code: 'bridge_offline' });

    await jest.advanceTimersByTimeAsync(26);
    await rejection;
    fake.emit('connection', { state: 'ready' });

    expect(fake.disconnectCalls).toBe(1);
    expect(adapter.state).toBe('offline');
  });

  it('uses the prompted non-main session for legacy events without a session key', async () => {
    const fake = new LifecycleGateway();
    fake.requestHandler = (_method, params) => {
      fake.emit('chatDelta', { runId: 'run-child', text: 'child delta' });
      return { runId: 'run-child', params };
    };
    const adapter = new OpenClawAdapter(connection('openclaw', 'fallback-key'), {
      gateway: gateway(fake),
      historyCache: null,
      bridgeCapabilityMode: 'legacy',
    });
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    await adapter.prompt('agent:main:subagent:child', {
      text: 'continue',
      idempotencyKey: 'prompt-child',
    });

    expect(updates).toContainEqual({
      type: 'agent_message_chunk',
      sessionKey: 'agent:main:subagent:child',
      runId: 'run-child',
      text: 'child delta',
    });
  });

  it('refreshes the canonical session snapshot after a negotiated session invalidation', async () => {
    const fake = new LifecycleGateway();
    fake.sessions = [{ key: 'agent:main:main', title: 'Main', updatedAt: 42 }];
    const adapter = new OpenClawAdapter(connection('openclaw', 'sessions-changed'), {
      gateway: gateway(fake),
      historyCache: null,
      bridgeCapabilityMode: 'legacy',
    });
    const snapshots: Array<Array<{ key: string }>> = [];
    const off = adapter.on('sessions', (sessions) => snapshots.push(sessions));

    fake.emit('sessionsChanged', {});
    await flushAsync();

    expect(snapshots).toEqual([
      [expect.objectContaining({ key: 'agent:main:main' })],
    ]);
    off();
    adapter.disconnect();
  });

  it('emits reconciled history after a sequence gap', async () => {
    const fake = new LifecycleGateway();
    const onReconnect = jest.fn();
    fake.requestHandler = (method) => method === 'chat.history'
      ? { messages: [{ id: 'history-1', role: 'assistant', content: 'recovered' }] }
      : {};
    const adapter = new OpenClawAdapter(connection('openclaw', 'seq-gap'), {
      gateway: gateway(fake),
      historyCache: null,
      bridgeCapabilityMode: 'legacy',
      onReconnect,
    });
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    fake.emit('seqGap', { sessionKey: 'agent:main:main', fromSeq: 4, toSeq: 6 });
    await flushAsync();

    expect(updates).toContainEqual({
      type: 'history_reconciled',
      sessionKey: 'agent:main:main',
      history: {
        key: 'agent:main:main',
        messages: [expect.objectContaining({ id: 'history-1', text: 'recovered' })],
        hasActiveRun: false,
      },
    });
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledWith('seq_gap');
  });

  it('clears optimistic active-run state when the server proves the session idle', async () => {
    const fake = new LifecycleGateway();
    fake.sessions = [{ key: 'agent:main:main', title: 'Main', hasActiveRun: false }];
    fake.requestHandler = () => ({ runId: 'server-run' });
    const adapter = new OpenClawAdapter(connection('openclaw', 'active-state'), {
      gateway: gateway(fake),
      historyCache: null,
      bridgeCapabilityMode: 'legacy',
    });
    const snapshots: boolean[] = [];
    adapter.on('sessions', (sessions) => snapshots.push(sessions[0]?.hasActiveRun ?? false));

    await adapter.listSessions();
    await adapter.prompt('agent:main:main', { text: 'hello', idempotencyKey: 'optimistic-run' });
    await adapter.listSessions();

    expect(snapshots).toEqual([false, true, false]);
    await expect(adapter.loadSession('agent:main:main')).resolves.toMatchObject({
      hasActiveRun: false,
    });
  });

  it('maps a Hermes command final that arrives before its different response run id', async () => {
    const fake = new LifecycleGateway();
    fake.requestHandler = () => {
      fake.emit('chatFinal', {
        runId: 'server-command-run',
        sessionKey: 'main',
        message: { role: 'assistant', content: 'Model switched early' },
      });
      return { runId: 'server-command-run' };
    };
    const adapter = new HermesAdapter(connection('hermes', 'command-race'), {
      gateway: gateway(fake),
      historyCache: null,
    });
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    await adapter.prompt('main', { text: '/model fixture', idempotencyKey: 'local-command-id' });

    expect(updates).toContainEqual(expect.objectContaining({
      type: 'system_event',
      sessionKey: 'main',
      kind: 'command_ack',
      text: 'Model switched early',
    }));
    expect(updates).toContainEqual(expect.objectContaining({
      type: 'run_finished',
      sessionKey: 'main',
      runId: 'server-command-run',
      message: undefined,
    }));
    await expect(adapter.loadSession('main')).resolves.toMatchObject({ hasActiveRun: false });
  });
});

describe('mergeGatewayHistory', () => {
  it('replaces an optimistic send and its cache copy with one confirmed server message', () => {
    const remote = [{ id: 'server-user', role: 'user' as const, text: 'Hello', timestampMs: 10_140 }];
    expect(mergeGatewayHistory(remote, [
      { id: 'usr_10000', role: 'user', text: 'Hello', timestampMs: 10_000 },
      { id: 'h_user_10140_copy', role: 'user', text: 'Hello', timestampMs: 10_140 },
    ])).toEqual(remote);
    expect(mergeGatewayHistory(remote, [
      { id: 'usr_10000', role: 'user', text: 'Hello', timestampMs: 10_000 },
      { id: 'usr_11000', role: 'user', text: 'Hello', timestampMs: 11_000 },
    ]).map((message) => message.id)).toEqual(['server-user', 'usr_11000']);
  });

  it('reconciles confirmed cache copies with server timestamps without collapsing repeated sends', () => {
    const remote = [
      { id: 'server-u', role: 'user' as const, text: 'Received', timestampMs: 10_000 },
      { id: 'server-a', role: 'assistant' as const, text: 'OK', timestampMs: 11_000 },
    ];
    const pending = { id: 'u_pending', role: 'user' as const, text: 'Received', timestampMs: 11_200 };
    expect(mergeGatewayHistory(remote, [
      { ...remote[0], id: 'h_user_local', timestampMs: 10_264 },
      { ...remote[1], id: 'h_assistant_local', timestampMs: 11_340 }, pending,
    ])).toEqual([...remote, pending]);
  });

  it('keeps the remote canonical message and only the optimistic cache tail', () => {
    expect(mergeGatewayHistory(
      [
        { id: 'remote-user', role: 'user', text: 'hello', timestampMs: 2_000, idempotencyKey: 'same' },
        { id: 'remote-answer', role: 'assistant', text: 'answer', timestampMs: 3_000 },
      ],
      [
        { id: 'too-old', role: 'assistant', text: 'old', timestampMs: 1_000 },
        { id: 'cached-user', role: 'user', text: 'stale hello', timestampMs: 2_100, idempotencyKey: 'same' },
        { id: 'optimistic', role: 'user', text: 'next', timestampMs: 4_000 },
      ],
    )).toEqual([
      expect.objectContaining({ id: 'remote-user' }),
      expect.objectContaining({ id: 'remote-answer' }),
      expect.objectContaining({ id: 'optimistic' }),
    ]);
  });
});

describe('mapGatewayHistoryMessage', () => {
  it('keeps tool pairing and timing metadata in the adapter contract', () => {
    expect(mapGatewayHistoryMessage('agent:main:main', {
      id: 'result-message',
      role: 'toolResult',
      toolCallId: 'call-1',
      name: 'read',
      content: 'two lines',
      args: { path: '/tmp/file' },
      toolStartedAt: 1_000,
      toolFinishedAt: 1_050,
      toolDurationMs: 50,
    }, 0)).toMatchObject({
      id: 'result-message',
      role: 'tool',
      text: 'two lines',
      tool: {
        callId: 'call-1',
        name: 'read',
        status: 'success',
        input: { path: '/tmp/file' },
        startedAtMs: 1_000,
        finishedAtMs: 1_050,
        durationMs: 50,
      },
    });
  });
});

describe('history reconciliation ordering regression', () => {
  it('keeps untimed cached tools before new chat and converges without duplicate IDs', () => {
    const oldTool = { id: 'toolresult_old', role: 'tool' as const, text: '', tool: { name: 'bash', status: 'success' as const, callId: 'old' } };
    const remote = [
      { id: 'user-new', role: 'user' as const, text: 'hi', timestampMs: 100_000 },
      { id: 'assistant-new', role: 'assistant' as const, text: 'hello', timestampMs: 101_000 },
    ];
    const merged = mergeGatewayHistory(remote, [oldTool, ...remote, oldTool]);
    expect(merged.map((message) => message.id)).toEqual(['toolresult_old', 'user-new', 'assistant-new']);
    expect(mergeGatewayHistory(remote, merged)).toEqual(merged);
  });

  it('uses a stable call identity when cached and remote tool IDs differ', () => {
    const tool = { name: 'bash', status: 'success' as const, callId: 'call-1' };
    const remote = [{ id: 'canonical', role: 'tool' as const, text: 'ok', timestampMs: 100_000, tool }];
    expect(mergeGatewayHistory(remote, [{ id: 'toolresult_call-1', role: 'tool', text: '', tool }])).toEqual(remote);
  });

  it('reads ISO timestamps without discarding tool chronology', () => {
    expect(mapGatewayHistoryMessage('main', { role: 'toolResult', timestamp: '2026-09-06T01:00:00Z', content: 'done', name: 'bash' }, 0)?.timestampMs)
      .toBe(Date.parse('2026-09-06T01:00:00Z'));
  });
});

it('reconciles final replies timed at run start with history timed at completion', () => {
  const remote = [{ id: 'reply', role: 'assistant' as const, text: 'Test received', timestampMs: 112_000 }];
  expect(mergeGatewayHistory(remote, [{ id: 'final_run', role: 'assistant', text: 'Test received', timestampMs: 100_000 }])).toEqual(remote);
});
