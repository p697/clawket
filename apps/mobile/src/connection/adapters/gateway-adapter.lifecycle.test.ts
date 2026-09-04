import type { ConnectionRecord, SessionUpdate } from '@clawket/agent-protocol';
import type { GatewayClient } from '../../services/gateway';
import type { ConnectionState, GatewayConfig } from '../../types';
import { mergeGatewayHistory } from './gateway-adapter';
import { HermesAdapter } from './hermes';
import { OPENCLAW_BRIDGE_CAPABILITY, OpenClawAdapter } from './openclaw';

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

class LifecycleGateway {
  public state: ConnectionState = 'idle';
  public connectCalls = 0;
  public disconnectCalls = 0;
  public currentConnectMeta: { capabilities: string[] } | undefined;
  public readonly connectMetas: Array<{ capabilities: string[] } | undefined> = [];
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

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GatewayAdapter lifecycle boundaries', () => {
  afterEach(() => {
    jest.useRealTimers();
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

  it('emits reconciled history after a sequence gap', async () => {
    const fake = new LifecycleGateway();
    fake.requestHandler = (method) => method === 'chat.history'
      ? { messages: [{ id: 'history-1', role: 'assistant', content: 'recovered' }] }
      : {};
    const adapter = new OpenClawAdapter(connection('openclaw', 'seq-gap'), {
      gateway: gateway(fake),
      historyCache: null,
      bridgeCapabilityMode: 'legacy',
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
