import type { ConnectionRecord, SessionUpdate } from '@clawket/agent-protocol';
import type { GatewayClient } from '../protocol';
import type { ConnectionState, GatewayConfig } from '../../types';
import { mapGatewayHistoryMessage, mergeGatewayHistory } from './gateway-adapter';
import { HermesAdapter } from './hermes';
import { OPENCLAW_BRIDGE_CAPABILITY, OpenClawAdapter } from './openclaw';
import { readConnectionRuntimeMetadata } from '../runtime-details';
import { stableMessageId } from '../../utils/chat-message';

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
    expect(fake.connectMetas).toEqual([
      { capabilities: ['bridge.capabilities.v2'] },
      { capabilities: ['bridge.capabilities.v2'] },
    ]);
    expect(adapter.negotiatedBridgeCapabilityMode).toBe('legacy');
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
  it('repairs the observed cold-restart duplicate with a reprojected ID 4622ms after the server reply', () => {
    const ts = 1789530456944;
    const user = { id: 'server-user', role: 'user' as const, text: 'Check', timestampMs: ts - 14_157 };
    const answer = { id: 'server-answer', role: 'assistant' as const, text: 'The check is complete.', timestampMs: ts };
    const duplicate = { ...answer, id: stableMessageId('assistant', ts + 4622, answer.text), timestampMs: ts + 4622 };
    expect(mergeGatewayHistory([user, answer], [user, answer, duplicate])).toEqual([user, answer]);
    const nextUser = { ...user, id: 'next-user', text: 'Check again', timestampMs: ts + 3_000 };
    expect(mergeGatewayHistory([user, answer, nextUser], [user, answer, nextUser, duplicate]))
      .toEqual([user, answer, nextUser, duplicate]);
    // Missing anchors and long gaps are not enough evidence to merge old history.
    expect(mergeGatewayHistory([answer], [duplicate])).toEqual([answer, duplicate]);
    const later = { ...duplicate, timestampMs: ts + 90_000 };
    expect(mergeGatewayHistory([user, answer], [user, later])).toEqual([user, answer, later]);
  });

  it('repairs legacy tool-turn cache copies whose display time differs from their history identity', () => {
    const timestampMs = 1789530456944;
    const remote = [
      { id: 'prompt', role: 'user' as const, text: 'Check the schedule', timestampMs: timestampMs - 30_000 },
      { id: 'tool', role: 'tool' as const, text: '', timestampMs: timestampMs - 10_000,
        tool: { name: 'read', callId: 'read-1', status: 'success' as const } },
      { id: 'answer', role: 'assistant' as const, text: 'The schedule is ready.', timestampMs },
    ];
    expect(mergeGatewayHistory(remote, [
      { ...remote[2], id: stableMessageId('assistant', timestampMs, remote[2].text), timestampMs: timestampMs + 8_000 },
      { ...remote[2], id: 'stream_segment_run_0', timestampMs: timestampMs + 8_000 },
    ])).toEqual(remote);
  });

  it('matches legacy live segments one-to-one and retains different or later replies', () => {
    const remote = [{ id: 'answer', role: 'assistant' as const, text: 'OK', timestampMs: 100_000 }];
    const second = { ...remote[0], id: 'stream_segment_next_0', timestampMs: 102_000 };
    const later = { ...remote[0], id: 'stream_segment_later_0', timestampMs: 300_000 };
    const changed = { ...remote[0], id: 'stream_segment_changed_0', text: 'Different', timestampMs: 104_000 };
    expect(mergeGatewayHistory(remote, [
      { ...remote[0], id: 'stream_segment_first_0', timestampMs: 101_000 }, second, changed, later,
    ])).toEqual([...remote, second, changed, later]);
  });

  it('does not acknowledge another user turn with an identical streamed reply inside the time window', () => {
    const first = { id: 'user-first', role: 'user' as const, text: 'Check', timestampMs: 100_000, idempotencyKey: 'send-first' };
    const next = { ...first, id: 'user-next', timestampMs: 103_000, idempotencyKey: 'send-next' };
    const remote = [first, { id: 'answer-first', role: 'assistant' as const, text: 'OK', timestampMs: 101_000 }, next];
    const pending = { id: 'stream_segment_next_0', role: 'assistant' as const, text: 'OK', timestampMs: 104_000 };
    expect(mergeGatewayHistory(remote, [next, pending])).toEqual([...remote, pending]);
  });

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
  it.each(['openclaw', 'hermes'] as const)('scopes CLI rollup suppression to OpenClaw after cache reconciliation (%s)', async backend => {
    const fake = new LifecycleGateway();
    fake.requestHandler = () => ({ messages: [
      { id: 'u', role: 'user', content: 'Check', timestamp: 100_000, __openclaw: { idempotencyKey: 'run:user' } },
      { id: 'part', role: 'assistant', content: 'Done', timestamp: 110_000,
        __openclaw: { importedFrom: 'claude-cli', cliSessionId: 'cli' } },
      { id: 'rollup', role: 'assistant', content: 'Done', timestamp: 110_300, provider: 'claude-cli',
        __openclaw: { idempotencyKey: 'cli-assistant:run' } },
    ] });
    const options = { gateway: gateway(fake), historyCache: { load: async () => [
      { id: stableMessageId('assistant', 110_300, 'Done'), role: 'assistant' as const, text: 'Done', timestampMs: 110_300 },
    ] } };
    const adapter = backend === 'hermes' ? new HermesAdapter(connection(backend), options)
      : new OpenClawAdapter(connection(backend), { ...options, bridgeCapabilityMode: 'legacy' });
    expect((await adapter.loadSession('main')).messages.map(message => message.id))
      .toEqual(backend === 'openclaw' ? ['u', 'part'] : ['u', 'part', 'rollup']);
    adapter.disconnect();
  });

  it.each(['hermes', 'openclaw'] as const)('scopes provider tool aliases to Hermes (%s)', async backend => {
    const fake = new LifecycleGateway();
    fake.requestHandler = () => ({ toolCallAliases: { native: 'live' }, messages: [{
      id: 'remote', role: 'toolResult', toolCallId: 'live', toolName: 'terminal', content: 'done', timestamp: 1_789_000_000_000,
    }] });
    const options = { gateway: gateway(fake), historyCache: { load: async () => [{
      id: 'cached', role: 'tool' as const, text: '', timestampMs: 1_789_000_000_000,
      tool: { name: 'terminal', callId: 'native', status: 'running' as const },
    }] } };
    const adapter = backend === 'hermes' ? new HermesAdapter(connection(backend), options)
      : new OpenClawAdapter(connection(backend), { ...options, bridgeCapabilityMode: 'legacy' });
    expect((await adapter.loadSession('main')).messages).toHaveLength(backend === 'hermes' ? 1 : 2);
    adapter.disconnect();
  });

  it('removes an old Hermes tool copy only with a confirmed alias and matching canonical tool', () => {
    const cached = { id: 'old-native', role: 'tool' as const, text: '', timestampMs: 100_000,
      tool: { name: 'terminal', status: 'running' as const, callId: 'native-id' } };
    const remote = [{ ...cached, id: 'new-live', text: '1147',
      tool: { ...cached.tool, status: 'success' as const, callId: 'run:tool:1' } }];
    const options = { hermesToolAliases: { 'native-id': 'run:tool:1' } };
    const merged = mergeGatewayHistory(remote, [cached], options);
    expect(merged).toEqual(remote);
    expect(mergeGatewayHistory(remote, merged, options)).toEqual(remote);
    // A real repeated invocation, missing page, wrong tool, or malformed map is retained.
    expect(mergeGatewayHistory(remote, [cached])).toHaveLength(2);
    expect(mergeGatewayHistory(remote, [cached], { hermesToolAliases: [] })).toHaveLength(2);
    expect(mergeGatewayHistory(remote, [cached], { hermesToolAliases: { 'native-id': 42 } })).toHaveLength(2);
    expect(mergeGatewayHistory([], [cached], options)).toEqual([cached]);
    expect(mergeGatewayHistory(remote, [{ ...cached, tool: { ...cached.tool, name: 'read' } }], options)).toHaveLength(2);
  });

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


describe('OpenClaw history recovery protocol', () => {
  it('reads nested activity and recovers the empty thinking snapshot on reentry', async () => {
    const fake = new LifecycleGateway();
    fake.requestHandler = () => ({ messages: [], sessionInfo: { hasActiveRun: true },
      inFlightRun: { runId: 'running', text: '', startedAt: 1000, sessionAbortable: true } });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake), historyCache: null });
    await expect(adapter.loadSession('main')).resolves.toMatchObject({ hasActiveRun: true,
      activeRun: { runId: 'running', text: '', startedAtMs: 1000, sessionAbortable: true } });
    fake.requestHandler = () => ({ messages: [], sessionInfo: { hasActiveRun: false },
      inFlightRun: { runId: 'running', text: 'stale' } });
    const idle = await adapter.loadSession('main');
    expect(idle.hasActiveRun).toBe(false);
    expect(idle.activeRun).toBeUndefined();
  });

  it('does not resurrect a run that finishes while history is pending', async () => {
    const fake = new LifecycleGateway();
    let resolve!: (value: unknown) => void;
    fake.requestHandler = () => new Promise(r => { resolve = r; });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake), historyCache: null });
    const pending = adapter.loadSession('main');
    fake.emit('chatFinal', { runId: 'running', sessionKey: 'main', message: { content: 'done' } });
    resolve({ messages: [], sessionInfo: { hasActiveRun: true }, inFlightRun: { runId: 'running', text: 'old' } });
    expect((await pending).hasActiveRun).toBe(false);
  });

  it('normalizes imported resume context before matching the optimistic bubble', () => {
    const text = "OpenClaw resumed this CLI session after prompt content changed. Follow the current turn's instructions; changed=system-prompt.\n\nHello";
    const imported = mapGatewayHistoryMessage('main', { role: 'user', content: text, timestamp: 10100,
      __openclaw: { id: 'imported', importedFrom: 'claude-cli' } }, 0)!;
    expect(imported.text).toBe('Hello');
    expect(mergeGatewayHistory([imported], [{ id: 'usr_10000', role: 'user', text: 'Hello', timestampMs: 10000 }])).toEqual([imported]);
    expect(mapGatewayHistoryMessage('main', { role: 'user', content: text }, 0)?.text).toBe(text);
  });
});

it('recovers a Hermes run from history and clears it on authoritative idle evidence', async () => {
  const fake = new LifecycleGateway();
  fake.requestHandler = () => ({ messages: [], hasActiveRun: true,
    inFlightRun: { runId: 'hermes-running', text: 'partial', startedAt: 1000, sessionAbortable: true } });
  const adapter = new HermesAdapter(connection('hermes'), { gateway: gateway(fake), historyCache: null });
  await expect(adapter.loadSession('main')).resolves.toMatchObject({ hasActiveRun: true,
    activeRun: { runId: 'hermes-running', text: 'partial', startedAtMs: 1000, sessionAbortable: true } });
  fake.requestHandler = () => ({ messages: [], hasActiveRun: false });
  const idle = await adapter.loadSession('main');
  expect(idle.hasActiveRun).toBe(false);
  expect(idle.activeRun).toBeUndefined();
});


it('keeps malformed imported tool prose inspectable without declaring execution success', () => {
  const raw = 'antml:invoke name="Bash"\n<parameter name="command">echo test</parameter>\n</invoke>\n<function_results>unverified</function_results>';
  const value = { role: 'assistant', content: raw, __openclaw: { id: 'raw-tool', importedFrom: 'claude-cli' } };
  expect(mapGatewayHistoryMessage('main', value, 0)).toMatchObject({ role: 'tool', text: '',
    tool: { name: 'Bash', status: 'unknown', input: raw } });
  expect(mapGatewayHistoryMessage('main', { ...value, __openclaw: undefined }, 0)?.role).toBe('assistant');
});

describe('OpenClaw image send recovery', () => {
  const sendKey = '1789390790301_afobgrvb';
  const cached = { id: 'usr_1789390790301', role: 'user' as const, text: '你看',
    timestampMs: 1789390790301, idempotencyKey: sendKey,
    attachments: [{ type: 'image' as const, mimeType: 'image/jpeg', uri: 'file:///one.jpg' },
      { type: 'image' as const, mimeType: 'image/jpeg', uri: 'file:///two.jpg' }] };
  const echo = () => mapGatewayHistoryMessage('agent:main:main', {
    role: 'user', content: '你看', timestamp: 1789390788461,
    idempotencyKey: `${sendKey}:user`, __openclaw: { id: 'persisted', senderIsOwner: true },
  }, 0)!;

  it('reconciles the persisted user-key suffix and retains both local images after reconnect', () => {
    const merged = mergeGatewayHistory([echo()], [cached]);
    expect(merged).toEqual([{ ...echo(), idempotencyKey: sendKey, attachments: cached.attachments }]);
    expect(mergeGatewayHistory([echo()], merged)).toEqual(merged);
  });

  it('keeps a separate intentional send with identical text and different images', () => {
    const second = { ...cached, id: 'usr_1789390791301', idempotencyKey: '1789390791301_otherkey',
      attachments: [{ type: 'image' as const, mimeType: 'image/jpeg', uri: 'file:///other.jpg' }] };
    expect(mergeGatewayHistory([echo()], [cached, second])).toEqual([
      { ...echo(), idempotencyKey: sendKey, attachments: cached.attachments }, second,
    ]);
  });

  it('repairs already persisted duplicate cache through the real OpenClaw adapter', async () => {
    const fake = new LifecycleGateway();
    fake.requestHandler = () => ({ messages: [{ role: 'user', content: '你看',
      timestamp: 1789390788461, idempotencyKey: `${sendKey}:user`,
      __openclaw: { id: 'persisted', senderIsOwner: true } }], sessionInfo: { hasActiveRun: false } });
    const legacyCopy = { ...cached, id: 'h_user_old', idempotencyKey: `${sendKey}:user`, attachments: undefined };
    const adapter = new OpenClawAdapter(connection('openclaw'), {
      gateway: gateway(fake), historyCache: { load: async () => [cached, legacyCopy] },
    });
    const recovered = await adapter.loadSession('agent:main:main');
    expect(recovered.messages).toEqual([{ ...echo(), attachments: cached.attachments }]);
    const untouched = mergeGatewayHistory([echo()], [legacyCopy]);
    expect(untouched).toHaveLength(2); // No OpenClaw cache-key migration on another backend.
  });

  it('does not collapse separate same-caption, same-image-count sends with different keys', () => {
    const second = { ...cached, id: 'usr_1789390791301', idempotencyKey: '1789390791301_otherkey' };
    expect(mergeGatewayHistory([echo()], [cached, second])).toHaveLength(2);
  });

  it('does not rewrite Hermes or arbitrary external idempotency keys', () => {
    for (const value of [
      { role: 'user', content: 'Hi', idempotencyKey: `${sendKey}:user` },
      { role: 'user', content: 'Hi', idempotencyKey: 'external:user', __openclaw: {} },
      { role: 'assistant', content: 'Hi', idempotencyKey: `${sendKey}:user`, __openclaw: {} },
    ]) expect(mapGatewayHistoryMessage('main', value, 0)?.idempotencyKey).toBe(value.idempotencyKey);
  });
});
