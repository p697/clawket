import type { ConnectionRecord, SessionUpdate } from '@clawket/agent-protocol';
import openClawFixture from '../../../../../tests/compat/fixtures/v1/bridge/openclaw-forwarding-v1.json';
import hermesAttachmentFixture from '../../../../../tests/fixtures/hermes/m3-attachment-abort-v2.json';
import hermesSessionsFixture from '../../../../../tests/fixtures/hermes/m3-multi-session-v2.json';
import type { GatewayClient } from '../protocol';
import type { ConnectionState, GatewayConfig } from '../../types';
import {
  HermesAdapter,
  HERMES_MULTI_SESSION_CAPABILITY,
  legacyHermesMainSession,
  mapHermesSession,
} from './hermes';
import {
  hasOpenClawActivityTimestamps,
  mapOpenClawSession,
  OPENCLAW_BRIDGE_CAPABILITY,
  OpenClawAdapter,
  resolveOpenClawActivityAt,
} from './openclaw';
import { readConnectionRuntimeMetadata } from '../runtime-details';

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
  | 'pairApprovalRequested'
  | 'pairApprovalResolved'
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
  public connectResponseBridgeVersion: string | undefined;
  public gatewayVersion = '';
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

  public getConnectResponseBridgeVersion(): string | undefined {
    return this.connectResponseBridgeVersion;
  }

  public getGatewayInfo(): { version: string } | null {
    return this.gatewayVersion ? { version: this.gatewayVersion } : null;
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
      mainKey: 'main',
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
  it.each(['main', 'daily'])('scopes the gateway main alias %s to each agent', async (alias) => {
    const fake = new RecordedGateway();
    fake.listAgents = async () => ({
      defaultId: 'lucy', mainKey: alias,
      agents: [{ id: 'lucy' }, { id: 'operator' }],
    });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });
    const agents = await adapter.listAgents();
    expect(agents.map((agent) => agent.mainSessionKey)).toEqual([
      `agent:lucy:${alias}`, `agent:operator:${alias}`,
    ]);
  });

  it('reads and writes OpenClaw selection through its supported session and config APIs', async () => {
    const fake = new RecordedGateway();
    fake.sessions = [{ key: 'agent:main:main', model: 'gpt-5.6-sol', modelProvider: 'openai' }];
    const catalog = [{ id: 'gpt-5.6-sol', name: 'GPT', provider: 'openai' }];
    const listModels = jest.fn(async () => catalog);
    const getConfig = jest.fn(async () => ({ hash: 'version-1', config: { agents: { defaults: { model: { primary: 'openai/gpt-5.6-sol' } } } } }));
    const patchConfig = jest.fn(async () => ({ ok: true }));
    Object.assign(fake, { listModels, getConfig, patchConfig });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });
    await expect(adapter.management.models!.getSelection!('agent:main:main')).resolves.toMatchObject({
      currentModel: 'gpt-5.6-sol', currentProvider: 'openai', models: catalog,
    });
    await expect(adapter.management.models!.setSelection!({ scope: 'session', sessionKey: 'agent:main:main', model: 'next', provider: 'openai' }))
      .resolves.toMatchObject({ scope: 'session', currentModel: 'next' });
    expect(fake.requests).toEqual([{ method: 'sessions.patch', params: { key: 'agent:main:main', model: 'openai/next' } }]);
    await expect(adapter.management.models!.getSelection!()).resolves.toMatchObject({ currentModel: 'gpt-5.6-sol' });
    await adapter.management.models!.setSelection!({ scope: 'global', model: 'next', provider: 'openai' });
    expect(patchConfig).toHaveBeenCalledWith(JSON.stringify({ agents: { defaults: { model: { primary: 'openai/next' } } } }), 'version-1');
    expect(fake.requests.some(({ method }) => method === 'model.get' || method === 'model.set')).toBe(false);
  });

  it('reads and writes OpenClaw channel routing through versioned config', async () => {
    const fake = new RecordedGateway();
    const getConfig = jest.fn(async (): Promise<{ hash: string | null; config: Record<string, unknown> }> => ({
      hash: 'v1', config: { session: { dmScope: 'per-channel-peer' } },
    }));
    const patchConfig = jest.fn(async () => ({ ok: true }));
    Object.assign(fake, { getConfig, patchConfig });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });
    const channels = adapter.management.channels!;

    await expect(channels.getRouting!()).resolves.toEqual({ dmScope: 'per-channel-peer' });
    getConfig.mockResolvedValueOnce({ hash: 'v1', config: {} });
    await expect(channels.getRouting!()).resolves.toEqual({ dmScope: 'main' });

    await channels.setRouting!({ dmScope: 'main' });
    expect(patchConfig).toHaveBeenLastCalledWith(JSON.stringify({ session: { dmScope: 'main' } }), 'v1');
    await channels.setAccountEnabled!({ channelId: 'telegram', accountId: 'default', enabled: false });
    expect(patchConfig).toHaveBeenLastCalledWith(JSON.stringify({
      channels: { telegram: { accounts: { default: { enabled: false } } } },
    }), 'v1');
    expect(patchConfig).toHaveBeenCalledTimes(2);

    getConfig.mockResolvedValueOnce({ hash: null, config: {} });
    await expect(channels.setRouting!({ dmScope: 'per-peer' })).rejects.toMatchObject({ message: 'Gateway config hash is missing' });
    patchConfig.mockResolvedValueOnce({ ok: false });
    await expect(channels.setAccountEnabled!({ channelId: 'telegram', accountId: 'default', enabled: true }))
      .rejects.toMatchObject({ message: 'Gateway rejected the channel account change' });
    patchConfig.mockResolvedValueOnce({ ok: false });
    await expect(channels.setRouting!({ dmScope: 'per-peer' }))
      .rejects.toMatchObject({ message: 'Gateway rejected the direct message scope' });
  });

  it('manages the OpenClaw model catalog through versioned config reads and writes', async () => {
    const fake = new RecordedGateway();
    const config = {
      agents: { defaults: { model: { primary: 'openai/gpt' }, models: { 'openai/gpt': {} } } },
      models: { providers: { openai: { baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt', name: 'GPT' }] } } },
    };
    const listModels = jest.fn(async () => [{ id: 'gpt', name: 'GPT', provider: 'openai' }, { id: 'sonnet', name: 'Sonnet', provider: 'anthropic' }]);
    const getConfig = jest.fn(async (): Promise<{ hash: string | null; config: Record<string, unknown> }> => ({ hash: 'v1', config }));
    const patchConfig = jest.fn(async () => ({ ok: true }));
    const setConfig = jest.fn(async () => ({ ok: true }));
    Object.assign(fake, { listModels, getConfig, patchConfig, setConfig });
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });
    const models = adapter.management.models!;

    const catalog = await models.getCatalog!();
    expect(catalog.defaults.primary).toBe('openai/gpt');
    expect(catalog.allowlist).toEqual(['openai/gpt']);
    expect(catalog.providers.map((provider) => [provider.slug, provider.explicit, provider.models.length])).toEqual([
      ['anthropic', false, 1], ['openai', true, 1],
    ]);

    await models.saveCatalog!({ defaults: { primary: 'anthropic/sonnet', fallbacks: ['openai/gpt'], thinkingDefault: 'low' } });
    expect(patchConfig).toHaveBeenLastCalledWith(JSON.stringify({
      agents: { defaults: { model: { primary: 'anthropic/sonnet', fallbacks: ['openai/gpt'] }, thinkingDefault: 'low', models: { 'anthropic/sonnet': {} } } },
    }), 'v1');
    await models.saveCatalog!({});
    getConfig.mockResolvedValueOnce({ hash: 'v1', config: { ...config, agents: { defaults: { model: { primary: 'openai/gpt', fallbacks: ['anthropic/sonnet', 'openai/mini'] } } } } });
    await models.saveCatalog!({ defaults: { primary: 'openai/gpt', fallbacks: ['anthropic/sonnet'], thinkingDefault: '' } });
    expect(patchConfig).toHaveBeenLastCalledWith(
      JSON.stringify({ agents: { defaults: { model: { primary: 'openai/gpt', fallbacks: ['anthropic/sonnet'] } } } }),
      'v1',
      { replacePaths: ['agents.defaults.model.fallbacks'] },
    );
    expect(patchConfig).toHaveBeenCalledTimes(2);
    expect(patchConfig.mock.calls[0]).toHaveLength(2);

    await models.addModel!({ provider: 'openai', modelId: 'gpt-mini', modelName: '' });
    expect(patchConfig).toHaveBeenLastCalledWith(JSON.stringify({
      models: { providers: { openai: { models: [{ id: 'gpt-mini', name: 'gpt-mini' }] } } },
      agents: { defaults: { models: { 'openai/gpt-mini': {} } } },
    }), 'v1');
    await expect(models.addModel!({ provider: 'openai', modelId: 'gpt', modelName: 'GPT' })).rejects.toMatchObject({ message: 'This model is already configured' });

    await expect(models.inspectDeletion!({ provider: 'openai', modelId: 'gpt' })).resolves.toMatchObject({
      canDelete: false, blocks: [{ reason: 'defaults_primary' }],
    });
    await expect(models.deleteModel!({ provider: 'openai', modelId: 'gpt' })).rejects.toMatchObject({ message: 'This model is still referenced by Gateway config' });
    getConfig.mockResolvedValueOnce({ hash: 'v2', config: { ...config, agents: { defaults: { models: { 'openai/gpt': {} } } } } });
    await models.deleteModel!({ provider: 'openai', modelId: 'gpt' });
    expect(setConfig).toHaveBeenCalledWith(JSON.stringify({
      agents: { defaults: { models: {} } },
      models: { providers: { openai: { baseUrl: 'https://api.openai.com/v1', models: [] } } },
    }), 'v2');

    await models.setCost!({ provider: 'openai', modelId: 'gpt', modelName: 'GPT', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } });
    expect(patchConfig).toHaveBeenLastCalledWith(JSON.stringify({
      models: { providers: { openai: { models: [{ id: 'gpt', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] } } },
    }), 'v1');
    await expect(models.setCost!({ provider: 'anthropic', modelId: 'sonnet', modelName: 'Sonnet', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }))
      .rejects.toMatchObject({ message: 'Provider is not declared in Gateway config' });
    await expect(models.setCost!({ provider: 'openai', modelId: 'gpt', modelName: 'GPT', cost: { input: -1, output: 2, cacheRead: 0, cacheWrite: 0 } }))
      .rejects.toMatchObject({ message: 'Cost values must be non-negative numbers' });

    getConfig.mockResolvedValueOnce({ hash: null, config });
    await expect(models.saveCatalog!({ defaults: { primary: 'x/y', fallbacks: [], thinkingDefault: '' } })).rejects.toMatchObject({ message: 'Gateway config hash is missing' });
    patchConfig.mockResolvedValueOnce({ ok: false });
    await expect(models.saveCatalog!({ defaults: { primary: 'x/y', fallbacks: [], thinkingDefault: '' } })).rejects.toMatchObject({ message: 'Gateway rejected model settings' });
    expect(fake.requests).toEqual([]);
  });

  it('keeps channel deletion outside the App even when legacy metadata omits its policy', () => {
    const session = mapOpenClawSession('openclaw-recorded', {
      key: 'agent:main:channel:recorded',
      channel: 'recorded',
    });

    expect(session.kind).toBe('channel');
    expect(session.allowedActions).toEqual({
      rename: true,
      reset: true,
      delete: false,
      pin: true,
    });
  });

  it('separates human activity from heartbeat housekeeping on a current Gateway list', async () => {
    const fake = new RecordedGateway();
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    fake.sessions = [
      // Heartbeat-only main chat: 40 polls moved updatedAt, nobody ever wrote to the user.
      { key: 'agent:main:main', title: 'Main', updatedAt: 900 },
      // User turn started at 300, run completed at 320.
      { key: 'agent:main:channel:general', title: '#general', channel: 'general', updatedAt: 950, lastInteractionAt: 300, lastActivityAt: 320 },
      // Cron output counts as activity even without an interaction.
      { key: 'agent:main:cron:daily', title: '[Cron] Daily', updatedAt: 960, lastActivityAt: 310 },
    ];
    const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });
    await adapter.connect();

    const sessions = await adapter.listSessions('main');
    expect(sessions.map((entry) => [entry.key, entry.updatedAt, entry.lastActivityAt])).toEqual([
      ['agent:main:main', 900, null],
      ['agent:main:channel:general', 950, 320],
      ['agent:main:cron:daily', 960, 310],
    ]);
  });

  it('resolves the activity clock per row and detects legacy lists', () => {
    expect(hasOpenClawActivityTimestamps([{ updatedAt: 1 }, { updatedAt: 2 }])).toBe(false);
    expect(hasOpenClawActivityTimestamps([{ updatedAt: 1 }, { updatedAt: 2, lastInteractionAt: 1 }])).toBe(true);
    expect(resolveOpenClawActivityAt({ updatedAt: 500, lastInteractionAt: 200, lastActivityAt: 260 })).toBe(260);
    expect(resolveOpenClawActivityAt({ updatedAt: 500, lastInteractionAt: 200 })).toBe(200);
    expect(resolveOpenClawActivityAt({ updatedAt: 500 })).toBeNull();
    expect(resolveOpenClawActivityAt({ updatedAt: 500 }, { legacyActivity: true })).toBe(500);
    expect(resolveOpenClawActivityAt({ updatedAt: null }, { legacyActivity: true })).toBeNull();
    expect(mapOpenClawSession('c', { key: 'agent:main:main', updatedAt: 500, lastActivityAt: 90 }).lastActivityAt).toBe(90);
  });

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
    // A v1 Gateway reports no user-facing timestamps: activity falls back to updatedAt.
    expect(sessions.map((entry) => entry.lastActivityAt)).toEqual([10, 9]);

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

  it.each(['unknown', 'v2', 'legacy'] as const)('performs one no-meta fallback from %s when the Bridge rejects capability metadata', async (mode) => {
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
      bridgeCapabilityMode: mode,
      onBridgeCapabilityMode: (mode) => { persisted.push(mode); },
    });

    await adapter.connect();

    expect(fake.connectMetas).toEqual([
      { capabilities: [OPENCLAW_BRIDGE_CAPABILITY] },
      undefined,
    ]);
    expect(fake.connectCalls).toBe(2);
    expect(adapter.negotiatedBridgeCapabilityMode).toBe('legacy');
    expect(persisted).toEqual(mode === 'legacy' ? [] : ['legacy']);
  });

  it.each(['unknown', 'legacy'] as const)('learns upgraded Bridge capability from cached %s only on a matching success', async mode => {
    const fake = new RecordedGateway();
    fake.connectResponseCapabilities = [OPENCLAW_BRIDGE_CAPABILITY];
    fake.onConnect = () => fake.emit('connection', { state: 'ready' });
    const adapter = new OpenClawAdapter(connection('openclaw', 'v2'), {
      gateway: gateway(fake),
      bridgeCapabilityMode: mode,
    });

    await adapter.connect();

    expect(fake.connectMetas).toEqual([{ capabilities: [OPENCLAW_BRIDGE_CAPABILITY] }]);
    expect(adapter.negotiatedBridgeCapabilityMode).toBe('v2');
  });

  it('exposes sanitized Bridge handshake metadata to the connection layer', () => {
    const fake = new RecordedGateway();
    fake.gatewayVersion = 'openclaw-gateway-2026.9.5';
    fake.connectResponseBridgeVersion = ' 3.0.0 ';
    fake.connectResponseCapabilities = [OPENCLAW_BRIDGE_CAPABILITY];
    const adapter = new OpenClawAdapter(connection('openclaw', 'metadata'), {
      gateway: gateway(fake),
    });

    expect(readConnectionRuntimeMetadata(adapter)).toEqual({
      bridgeVersion: '3.0.0',
      bridgeCapabilities: [OPENCLAW_BRIDGE_CAPABILITY],
    });
  });

  it('never aliases an OpenClaw Gateway version to a missing Bridge version', () => {
    const fake = new RecordedGateway();
    fake.gatewayVersion = 'openclaw-gateway-2026.9.5';
    fake.connectResponseCapabilities = [OPENCLAW_BRIDGE_CAPABILITY];
    const adapter = new OpenClawAdapter(connection('openclaw', 'legacy-metadata'), {
      gateway: gateway(fake),
    });

    expect(readConnectionRuntimeMetadata(adapter)).toEqual({
      bridgeVersion: null,
      bridgeCapabilities: [OPENCLAW_BRIDGE_CAPABILITY],
    });
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
    fake.emit('health', {
      ...hermesSessionsFixture.firstFrame.payload,
      bridgeVersion: ' 3.0.0-hermes ',
    });
    await connecting;

    expect(adapter.state).toBe('ready');
    expect(adapter.capabilities.sessions).toBe(true);
    expect(adapter.connection.bridgeOutdated).toBeUndefined();
    expect(readConnectionRuntimeMetadata(adapter)).toEqual({
      bridgeVersion: '3.0.0-hermes',
      bridgeCapabilities: [
        'bridge.capabilities.v2',
        'hermes.multi-session.v2',
      ],
    });
    const sessions = await adapter.listSessions();
    expect(sessions).toEqual([expect.objectContaining({
      key: 'native-recorded-session',
      source: 'native',
      title: 'Recorded native session',
      allowedActions: { rename: false, reset: false, delete: false, pin: true },
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
      text: 'unsupported file',
      idempotencyKey: 'unsupported-file',
      attachments: [{
        type: 'file',
        mimeType: 'application/pdf',
        content: 'cGRm',
        name: 'notes.pdf',
      }],
    })).rejects.toMatchObject({ code: 'unsupported' });
    expect(fake.requests.filter((entry) => entry.method === 'chat.send')).toHaveLength(0);

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
      allowedActions: { rename: false, reset: false, delete: false, pin: true },
    })]);
    await expect(adapter.createSession('hermes')).rejects.toMatchObject({ code: 'unsupported' });
    expect(fake.requests).toEqual([]);
  });

  it('keeps local pinning for legacy sessions and every action for Bridge-created main sessions', () => {
    expect(legacyHermesMainSession('hermes-legacy').allowedActions).toEqual({
      rename: false,
      reset: false,
      delete: false,
      pin: true,
    });
    expect(mapHermesSession('hermes-recorded', {
      key: 'main',
      source: 'bridge',
    }).allowedActions).toEqual({
      rename: true,
      reset: true,
      delete: true,
      pin: true,
    });
  });

  it('reports Hermes last message time as the activity clock', () => {
    expect(mapHermesSession('hermes-recorded', { key: 'main', updatedAt: 1_234 })).toMatchObject({
      updatedAt: 1_234,
      lastActivityAt: 1_234,
    });
    expect(mapHermesSession('hermes-recorded', { key: 'main' })).toMatchObject({
      updatedAt: null,
      lastActivityAt: null,
    });
    expect(legacyHermesMainSession('hermes-legacy').lastActivityAt).toBeNull();
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

it.each(['openclaw', 'hermes'] as const)('keeps %s usage requests in the backend-owned agent scope', async (backend) => {
  const fake = Object.assign(new RecordedGateway(), {
    fetchUsage: jest.fn(async () => ({})),
    fetchCostSummary: jest.fn(async () => ({})),
  });
  const adapter = backend === 'openclaw'
    ? new OpenClawAdapter(connection(backend), { gateway: gateway(fake) })
    : new HermesAdapter(connection(backend), { gateway: gateway(fake) });
  const dates = { startDate: '2026-09-06', endDate: '2026-09-06' };
  const input = { ...dates, agentId: backend === 'openclaw' ? 'ui-operator' : 'hermes' };
  await adapter.management.usage?.sessions?.(input);
  await adapter.management.usage?.cost?.(input);
  expect(fake.fetchUsage).toHaveBeenCalledWith(backend === 'openclaw' ? input : dates);
  expect(fake.fetchCostSummary).toHaveBeenCalledWith(backend === 'openclaw' ? input : dates);
});

it('exposes OpenClaw skill document operations only when the current handshake advertises each method', async () => {
  const supported = new Set<string>();
  const fake = Object.assign(new RecordedGateway(), {
    supportsMethod: (method: string) => supported.has(method),
    getSkillDetail: jest.fn(async () => ({ content: '# source', editable: false })),
    updateSkillContent: jest.fn(async () => ({ ok: true })),
  });
  const adapter = new OpenClawAdapter(connection('openclaw'), { gateway: gateway(fake) });
  expect(adapter.management.skills?.get).toBeUndefined();
  expect(adapter.management.skills?.updateContent).toBeUndefined();
  supported.add('skills.get');
  await adapter.management.skills?.get?.('sample', { agentId: 'work' });
  expect(fake.getSkillDetail).toHaveBeenCalledWith('sample', { agentId: 'work' });
  expect(adapter.management.skills?.updateContent).toBeUndefined();
  supported.add('skills.content.update');
  await adapter.management.skills?.updateContent?.('sample', '# changed', 'work');
  expect(fake.updateSkillContent).toHaveBeenCalledWith('sample', '# changed', 'work');
  supported.clear();
  expect(adapter.management.skills?.get).toBeUndefined();
  expect(adapter.management.skills?.updateContent).toBeUndefined();
  const hermes = new HermesAdapter(connection('hermes'), { gateway: gateway(fake) });
  expect(hermes.management.skills?.get).toBeDefined();
  expect(hermes.management.skills?.updateContent).toBeDefined();
});
