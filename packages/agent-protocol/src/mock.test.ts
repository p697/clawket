import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  CAPABILITY_MATRIX,
  createMockAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type ManagementOperations,
  type SessionDescriptor,
  type SessionUpdate,
} from './index';

const connection: ConnectionDescriptor = {
  id: 'connection-1',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Test gateway',
  environment: 'preview',
  createdAt: 1,
  isFreeSlot: true,
};

const agents: AgentDescriptor[] = [
  {
    connectionId: connection.id,
    agentId: 'main',
    name: 'Main',
    isMain: true,
    mainSessionKey: 'agent:main:main',
  },
  {
    connectionId: connection.id,
    agentId: 'writer',
    name: 'Writer',
    isMain: false,
    mainSessionKey: 'agent:writer:main',
  },
];

const sessions: SessionDescriptor[] = [
  {
    connectionId: connection.id,
    agentId: 'main',
    key: 'agent:main:main',
    kind: 'main',
    title: 'Main',
    updatedAt: 10,
    hasActiveRun: false,
    allowedActions: { rename: true, reset: true, delete: false, pin: true },
  },
  {
    connectionId: connection.id,
    agentId: 'writer',
    key: 'agent:writer:main',
    kind: 'main',
    title: 'Writer',
    updatedAt: 20,
    hasActiveRun: false,
    allowedActions: { rename: true, reset: true, delete: false, pin: true },
  },
];

const timeline: Array<{ atMs: number; update: SessionUpdate }> = [
  {
    atMs: 20,
    update: { type: 'agent_message_chunk', sessionKey: 'agent:main:main', runId: 'r1', text: 'done' },
  },
  {
    atMs: 10,
    update: { type: 'run_started', sessionKey: 'agent:main:main', runId: 'r1' },
  },
];

function fixture() {
  return {
    connection,
    agents,
    sessions,
    histories: {
      'agent:main:main': {
        key: 'agent:main:main',
        messages: [
          { id: 'm1', role: 'user' as const, text: 'one' },
          { id: 'm2', role: 'assistant' as const, text: 'two' },
          { id: 'm3', role: 'assistant' as const, text: 'three' },
        ],
        hasActiveRun: true,
      },
    },
    timeline,
  };
}

describe('createMockAdapter', () => {
  it('implements state, probe, event subscriptions, and deterministic timeline playback', async () => {
    const adapter = createMockAdapter(fixture());
    const states: string[] = [];
    const updates: SessionUpdate[] = [];
    const stopState = adapter.on('state', (state, reason) => states.push(`${state}:${reason ?? ''}`));
    const stopUpdates = adapter.on('update', (update) => updates.push(update));

    expect(adapter.state).toBe('idle');
    expect(await adapter.probe(1)).toBe(false);
    await adapter.connect();
    expect(adapter.state).toBe('ready');
    expect(await adapter.probe()).toBe(true);
    expect(states).toEqual(['connecting:', 'handshaking:', 'ready:']);

    adapter.replayTimeline(10);
    expect(updates.map((update) => update.type)).toEqual(['run_started']);
    adapter.replayTimeline();
    expect(updates.map((update) => update.type)).toEqual(['run_started', 'agent_message_chunk']);
    adapter.resetTimeline();
    adapter.replayTimeline(9);
    expect(updates).toHaveLength(2);
    adapter.replayTimeline(10);
    expect(updates).toHaveLength(3);

    stopUpdates();
    stopState();
    adapter.disconnect();
    expect(states).toHaveLength(3);
    expect(adapter.state).toBe('idle');
  });

  it('supports fixed probe outcomes, initial state, empty fixtures, and empty timelines', async () => {
    const adapter = createMockAdapter({
      connection: { ...connection, backendKind: 'youmind', transportKind: 'https' },
      initialState: 'offline',
      probeResult: false,
    });
    expect(adapter.state).toBe('offline');
    expect(await adapter.probe()).toBe(false);
    expect(await adapter.listAgents()).toEqual([]);
    expect(await adapter.listSessions()).toEqual([]);
    expect(adapter.management).toBeUndefined();
    expect(adapter.createSession).toBeUndefined();
    expect(adapter.patchSession).toBeUndefined();
    expect(adapter.resetSession).toBeUndefined();
    expect(adapter.deleteSession).toBeUndefined();
    adapter.replayTimeline();
  });

  it('clones fixture data and filters sessions by agent', async () => {
    const adapter = createMockAdapter(fixture());
    const listedAgents = await adapter.listAgents();
    const listedSessions = await adapter.listSessions();
    listedAgents[0].name = 'Mutated';
    listedSessions[0].allowedActions.rename = false;
    expect((await adapter.listAgents())[0].name).toBe('Main');
    expect((await adapter.listSessions())[0].allowedActions.rename).toBe(true);
    expect(await adapter.listSessions('writer')).toEqual([sessions[1]]);
  });

  it('paginates known history and returns an empty unknown history', async () => {
    const adapter = createMockAdapter(fixture());
    expect(await adapter.loadSession('agent:main:main', { limit: 1 })).toMatchObject({
      key: 'agent:main:main',
      nextCursor: '1',
      hasActiveRun: true,
      messages: [{ id: 'm1' }],
    });
    expect(await adapter.loadSession('agent:main:main', { cursor: '1', limit: 2 })).toMatchObject({
      messages: [{ id: 'm2' }, { id: 'm3' }],
    });
    expect((await adapter.loadSession('agent:main:main', { cursor: 'bad', limit: -1 })).messages).toEqual([]);
    expect((await adapter.loadSession('agent:main:main', { cursor: '-1' })).messages).toHaveLength(3);
    expect(await adapter.loadSession('missing')).toEqual({
      key: 'missing',
      messages: [],
      hasActiveRun: false,
    });
  });

  it('emits start and cancellation updates for prompt lifecycle calls', async () => {
    const adapter = createMockAdapter(fixture());
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));
    await expect(adapter.prompt('agent:main:main', { text: 'hi', idempotencyKey: 'id-1' })).resolves.toEqual({
      runId: 'mock:id-1',
    });
    await adapter.cancel('agent:main:main', 'mock:id-1');
    await adapter.cancel('agent:main:main');
    expect(updates.map((update) => update.type)).toEqual(['run_started', 'run_finished', 'run_finished']);
    expect(updates[2]).toMatchObject({ runId: 'mock:cancelled', stopReason: 'cancelled' });
  });

  it('implements capability-gated session mutation helpers', async () => {
    const adapter = createMockAdapter(fixture());
    const sessionSnapshots: SessionDescriptor[][] = [];
    const updates: SessionUpdate[] = [];
    adapter.on('sessions', (next) => sessionSnapshots.push(next));
    adapter.on('update', (update) => updates.push(update));

    const created = await adapter.createSession?.('main', { title: 'Created' });
    const untitled = await adapter.createSession?.('main');
    expect(created?.title).toBe('Created');
    expect(untitled?.title).toBe('Session 4');
    await adapter.patchSession?.(created!.key, { title: 'Renamed' });
    await adapter.patchSession?.(created!.key, {});
    expect((await adapter.listSessions()).find((session) => session.key === created!.key)?.title).toBe('Renamed');
    await expect(adapter.patchSession?.('missing', { title: 'x' })).rejects.toBeInstanceOf(AdapterError);

    await adapter.resetSession?.(created!.key);
    expect(await adapter.loadSession(created!.key)).toMatchObject({ messages: [], hasActiveRun: false });
    expect(updates.at(-1)?.type).toBe('system_event');
    await expect(adapter.resetSession?.('missing')).rejects.toBeInstanceOf(AdapterError);

    await adapter.deleteSession?.(created!.key);
    expect((await adapter.listSessions()).some((session) => session.key === created!.key)).toBe(false);
    await expect(adapter.deleteSession?.('missing')).rejects.toBeInstanceOf(AdapterError);
    expect(sessionSnapshots.length).toBeGreaterThan(0);
  });

  it('materializes every supported management group and omits unsupported groups', () => {
    const openclaw = createMockAdapter(fixture());
    expect(Object.keys(openclaw.management ?? {}).sort()).toEqual([
      'agents',
      'approvals',
      'channels',
      'config',
      'cron',
      'devices',
      'logs',
      'models',
      'nodes',
      'skills',
      'tools',
      'usage',
    ]);
    expect(openclaw.management?.cron?.heartbeat).toBeDefined();
    expect(openclaw.management?.skills?.discover).toBeDefined();

    const hermes = createMockAdapter({ ...fixture(), connection: { ...connection, backendKind: 'hermes' } });
    expect(hermes.management).toMatchObject({
      models: expect.any(Object),
      skills: expect.any(Object),
      cron: expect.any(Object),
      agents: expect.any(Object),
      usage: expect.any(Object),
    });
    expect(hermes.management?.cron?.heartbeat).toBeUndefined();
    expect(hermes.management?.cron?.add).toBeDefined();
    expect(hermes.management?.agents?.create).toBeUndefined();
    expect(hermes.management?.agents?.update).toBeUndefined();
    expect(hermes.management?.agents?.remove).toBeUndefined();
    expect(hermes.management?.agents?.list).toBeDefined();
    expect(hermes.management?.agents?.files?.list).toBeDefined();
    expect(hermes.management?.config).toBeUndefined();
    expect(hermes.management?.approvals).toBeUndefined();

    const downgraded = createMockAdapter({
      ...fixture(),
      capabilities: { skillDiscover: false, heartbeat: false },
    });
    expect(downgraded.management?.skills?.discover).toBeUndefined();
    expect(downgraded.management?.cron?.heartbeat).toBeUndefined();
  });

  it('keeps groups usable while independently downgraded methods stay absent', () => {
    const adapter = createMockAdapter({
      ...fixture(),
      capabilities: {
        models: false,
        skills: false,
        cron: false,
        cronCreate: false,
        agents: false,
        agentEdit: false,
        files: false,
        usage: false,
        configManage: false,
        diagnostics: false,
      },
    });

    expect(Object.keys(adapter.management?.models ?? {})).toEqual(['listThinkingLevels']);
    expect(Object.keys(adapter.management?.skills ?? {})).toEqual(['discover']);
    expect(Object.keys(adapter.management?.cron ?? {})).toEqual(['heartbeat']);
    expect(Object.keys(adapter.management?.agents ?? {}).sort()).toEqual(['create', 'files']);
    expect(Object.keys(adapter.management?.agents?.files ?? {})).toEqual(['set']);
    expect(Object.keys(adapter.management?.usage ?? {})).toEqual(['cost']);
    expect(Object.keys(adapter.management?.config ?? {}).sort()).toEqual(['backups', 'permissions']);
    expect(adapter.management?.cron?.add).toBeUndefined();
    expect(adapter.management?.agents?.update).toBeUndefined();
    expect(adapter.management?.config?.view).toBeUndefined();
  });

  it('separates node and device inventory from pair-request operations', () => {
    const provided = createMockAdapter(fixture()).management!;
    const pairingOnly = createMockAdapter({
      ...fixture(),
      management: provided,
      capabilities: { nodes: false, devices: false },
    });
    expect(Object.keys(pairingOnly.management?.devices ?? {}).sort()).toEqual(['approve', 'reject']);
    expect(Object.keys(pairingOnly.management?.nodes ?? {}).sort()).toEqual(['approve', 'pairRequests', 'reject']);

    const inventoryOnly = createMockAdapter({
      ...fixture(),
      management: provided,
      capabilities: { pairRequests: false },
    });
    expect(Object.keys(inventoryOnly.management?.devices ?? {}).sort()).toEqual(['list', 'remove']);
    expect(Object.keys(inventoryOnly.management?.nodes ?? {}).sort()).toEqual(['list', 'rename']);
  });

  it('provides callable defaults for every management operation', async () => {
    const adapter = createMockAdapter(fixture());
    const management = adapter.management!;
    expect(await management.models!.list!()).toEqual([]);
    expect(await management.models!.getSelection!()).toMatchObject({ models: [] });
    expect(await management.models!.setSelection!({ model: 'p/m' })).toMatchObject({ ok: true, scope: 'global' });
    expect(management.models!.listThinkingLevels!()).toEqual([]);

    expect(await management.skills!.status!()).toMatchObject({ skills: [] });
    expect(await management.skills!.get!('skill')).toMatchObject({ skillKey: 'skill' });
    expect(await management.skills!.update!('skill', { enabled: true })).toMatchObject({ ok: true });
    expect(await management.skills!.updateContent!('skill', '# Skill')).toMatchObject({ path: '' });
    expect(await management.skills!.remove!('skill')).toMatchObject({ skillKey: 'skill' });
    expect(await management.skills!.discover?.('query')).toMatchObject({ items: [] });

    expect(await management.cron!.list!({ limit: 10 })).toMatchObject({ jobs: [], total: 0, hasMore: false });
    const jobInput = {
      name: 'job',
      enabled: true,
      schedule: { kind: 'every' as const, everyMs: 1000 },
      sessionTarget: 'main' as const,
      wakeMode: 'now' as const,
      payload: { kind: 'systemEvent' as const, text: 'tick' },
    };
    expect(await management.cron!.add!(jobInput)).toMatchObject({ id: 'mock-cron', name: 'job' });
    expect(await management.cron!.update!('job', {})).toMatchObject({ id: 'job', enabled: false });
    expect(await management.cron!.update!('job', {
      ...jobInput,
      updatedAtMs: 2,
    })).toMatchObject({ name: 'job', enabled: true, updatedAtMs: 2 });
    expect(await management.cron!.remove!('job')).toEqual({ ok: true });
    await management.cron!.run!('job', 'force');
    expect(await management.cron!.runs!({ scope: 'job', id: 'job' })).toMatchObject({ entries: [], total: 0 });
    expect(await management.cron!.heartbeat?.get()).toMatchObject({ every: '' });
    await management.cron!.heartbeat?.set({
      every: '1h',
      activeStart: '',
      activeEnd: '',
      activeTimezone: '',
      session: '',
      model: '',
    });

    expect(await management.agents!.list!()).toMatchObject({
      defaultId: 'main',
      agents: [{ id: 'main' }, { id: 'writer' }],
    });
    expect(await management.agents!.create!({ name: 'new' })).toMatchObject({
      ok: true,
      agentId: 'new',
      workspace: '~/.openclaw/workspace-new',
    });
    expect(await management.agents!.update!('main', { name: 'Main' })).toEqual({ ok: true, agentId: 'main' });
    expect(await management.agents!.remove!('main', true)).toEqual({ ok: true, agentId: 'main' });
    expect(await management.agents!.files!.list!('main')).toEqual([]);
    expect(await management.agents!.files!.get!('USER.md', 'main')).toMatchObject({ missing: true });
    expect(await management.agents!.files!.set!('USER.md', 'content', 'main')).toEqual({ ok: true });

    expect(await management.usage!.sessions!({ startDate: '2026-01-01', endDate: '2026-01-01' })).toEqual({});
    expect(await management.usage!.cost!({ startDate: '2026-01-01', endDate: '2026-01-01' })).toEqual({});
    expect(await management.config!.view!()).toEqual({ config: null, hash: null });
    expect(await management.config!.patch!('{}', 'hash')).toEqual({ ok: true });
    expect(await management.config!.set!('{}', 'hash')).toEqual({ ok: true });
    expect(await management.config!.permissions!()).toMatchObject({ configPath: '', exec: { currentAgentId: 'main' } });
    expect(await management.config!.repair!()).toMatchObject({ ok: true });
    expect(await management.config!.doctor!()).toMatchObject({ ok: true });
    expect(await management.config!.backups!.list()).toEqual([]);
    expect(await management.config!.backups!.create()).toMatchObject({ id: 'mock-backup' });
    await management.config!.backups!.restore('mock-backup');
    expect(await management.tools!.catalog('main')).toMatchObject({ groups: [] });
    await management.tools!.save({ agentId: 'main' });
    expect(await management.channels!.status({ probe: true, timeoutMs: 100 })).toMatchObject({ channels: {} });
    expect(await management.devices!.list!()).toEqual({ pending: [], paired: [] });
    await management.devices!.approve!('d');
    await management.devices!.reject!('d');
    await management.devices!.remove!('d');
    expect(await management.nodes!.list!()).toEqual({ ts: 0, nodes: [] });
    expect(await management.nodes!.rename!('n', 'Node')).toEqual({ nodeId: 'n', displayName: 'Node' });
    expect(await management.nodes!.pairRequests!()).toEqual({ pending: [], nodes: [] });
    await management.nodes!.approve!('n');
    await management.nodes!.reject!('n');
    expect(await management.logs!.fetch({})).toMatchObject({ lines: [], reset: false });
    await management.approvals!.resolveExec('approval', 'allow-once');
  });

  it('uses caller-provided management groups intact', () => {
    const defaults = createMockAdapter(fixture()).management!;
    const provided: ManagementOperations = {
      models: defaults.models,
      skills: defaults.skills,
      cron: defaults.cron,
      agents: defaults.agents,
      usage: defaults.usage,
      config: defaults.config,
      tools: defaults.tools,
      channels: defaults.channels,
      devices: defaults.devices,
      nodes: defaults.nodes,
      logs: defaults.logs,
      approvals: defaults.approvals,
    };
    const adapter = createMockAdapter({ ...fixture(), management: provided });
    expect(adapter.management).toEqual(provided);
  });

  it('filters caller-provided operations after granular runtime downgrades', () => {
    const provided = createMockAdapter(fixture()).management!;
    const adapter = createMockAdapter({
      ...fixture(),
      management: provided,
      capabilities: {
        models: false,
        modelPerSession: false,
        thinkingLevels: false,
        skills: false,
        skillDiscover: false,
        skillInstall: false,
        cron: false,
        cronCreate: false,
        heartbeat: false,
        agents: false,
        agentCreate: false,
        agentEdit: false,
        files: false,
        fileEdit: false,
        usage: false,
        cost: false,
        configManage: false,
        permissions: false,
        diagnostics: false,
        backups: false,
        tools: false,
        channels: false,
        devices: false,
        nodes: false,
        logs: false,
        execApproval: false,
        pairRequests: false,
      },
    });
    expect(adapter.management).toBeUndefined();
  });

  it('exposes a usable group or method for every true management capability', () => {
    const adapter = createMockAdapter(fixture());
    const mapping = {
      models: adapter.management?.models?.list,
      modelPerSession: adapter.management?.models?.setSelection,
      thinkingLevels: adapter.management?.models?.listThinkingLevels,
      skills: adapter.management?.skills?.status,
      skillDiscover: adapter.management?.skills?.discover,
      skillInstall: adapter.prompt,
      cron: adapter.management?.cron?.list,
      cronCreate: adapter.management?.cron?.add,
      heartbeat: adapter.management?.cron?.heartbeat?.get,
      agents: adapter.management?.agents?.list,
      agentEdit: adapter.management?.agents?.update,
      agentCreate: adapter.management?.agents?.create,
      files: adapter.management?.agents?.files?.list,
      fileEdit: adapter.management?.agents?.files?.set,
      usage: adapter.management?.usage?.sessions,
      cost: adapter.management?.usage?.cost,
      configManage: adapter.management?.config?.view,
      permissions: adapter.management?.config?.permissions,
      diagnostics: adapter.management?.config?.doctor,
      backups: adapter.management?.config?.backups,
      tools: adapter.management?.tools?.catalog,
      channels: adapter.management?.channels?.status,
      devices: adapter.management?.devices?.list,
      nodes: adapter.management?.nodes?.list,
      logs: adapter.management?.logs?.fetch,
      pairRequests: adapter.management?.nodes?.pairRequests,
      execApproval: adapter.management?.approvals?.resolveExec,
    } as const;
    for (const [capability, operation] of Object.entries(mapping)) {
      expect(CAPABILITY_MATRIX.openclaw[capability as keyof typeof mapping]).toBe(true);
      expect(operation).toBeDefined();
    }
  });

  it('documents capability refinements without inventing management methods', () => {
    const adapter = createMockAdapter(fixture());
    expect(adapter.capabilities.modelPerSession).toBe(true);
    expect(adapter.management?.models?.setSelection).toBeDefined();
    expect(adapter.capabilities.skillInstall).toBe(true);
    expect(adapter.prompt).toBeTypeOf('function');
    expect('install' in (adapter.management?.skills ?? {})).toBe(false);
  });
});
