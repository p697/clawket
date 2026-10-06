import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { execFileSync } from 'node:child_process';
const mock = vi.hoisted(() => ({ instances: [] as any[], request: vi.fn(), respond: vi.fn(), refuse: vi.fn(), resumeSpeed: vi.fn() }));
vi.mock('./resume-settings.js', () => ({ nativeResumeSpeed: (...args: any[]) => mock.resumeSpeed(...args) }));
vi.mock('./rpc.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { CodexRpc: class extends EventEmitter {
    constructor() { super(); mock.instances.push(this); }
    nativeVersion = '0.153.3';
    request = mock.request; respond = mock.respond; refuse = mock.refuse;
    async stop() { this.emit('closed'); }
  } };
});
vi.mock('./desktop-ipc.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./desktop-ipc.js')>();
  const { EventEmitter } = await import('node:events');
  return { ...actual, DesktopIpc: class extends EventEmitter {
    ready = true; snapshots = new Map(); handler: unknown;
    permanent = new Set<string>(); observed = new Set<string>();
    async connect() {} follow(id: string) { this.permanent.add(id); } stop() {} broadcast() {}
    observe(id: string) { this.observed.add(id); return true; }
    unobserve(id: string) { this.observed.delete(id); }
    isObservationOnly(id: string) { return this.observed.has(id) && !this.permanent.has(id); }
    async request() { throw new actual.DesktopIpcError('no-owner', 'No owner'); }
  } };
});
import { CodexService } from './service.js';
import { codexMessages } from './history.js';
import { desktopTurns } from './desktop-state.js';
import { DesktopIpcError } from './desktop-ipc.js';
import { desktopTurns } from './desktop-state.js';
import { permissionPatch } from './settings.js';
// Use Node's standalone loader rather than Vitest's cross-workspace transform.
function validateRows(rows: unknown[]) {
  const diagnostic = new URL('../../../../scripts/diagnostics/codex-roster.mjs', import.meta.url).href;
  const code = `import { readFileSync } from 'node:fs'; import { validateRows } from ${JSON.stringify(diagnostic)};
    console.log(JSON.stringify(validateRows(JSON.parse(readFileSync(0, 'utf8')))));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    input: JSON.stringify(rows), encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true,
  }));
}
let root: string, project: string, service: CodexService, key: string, threadId: string;
let updates: any[];
let settings: any;
function initialSettings(cwd = project) {
  return { cwd, model: 'native-model', modelProvider: 'custom', effort: null, serviceTier: null,
    approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
    activePermissionProfile: { id: ':workspace', extends: null }, collaborationMode: { mode: 'default', settings: { model: 'native-model', reasoning_effort: null, developer_instructions: null } },
    summary: null, personality: null, multiAgentMode: 'explicitRequestOnly' };
}
function response(cwd = project) {
  return { ...settings, cwd, thread: { id: threadId, cwd }, sandbox: settings.sandboxPolicy, reasoningEffort: settings.effort };
}
const request = (method: string, params: Record<string, unknown> = {}) => service.request({ type: 'req', id: randomUUID(), method, params }) as Promise<any>;
const notify = (method: string, params: object, emittedAtMs?: unknown) => mock.instances.at(-1).emit('notification', { method, params: { threadId, ...params }, emittedAtMs });
async function start() {
  const result = await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'send-1' });
  await Promise.resolve(); notify('turn/started', { turn: { id: 'turn-1' } }); return result;
}
beforeEach(async () => {
  mock.request.mockReset(); mock.respond.mockReset(); mock.refuse.mockReset(); mock.instances.length = 0;
  mock.resumeSpeed.mockReset().mockResolvedValue({ kind: 'absent' });
  root = mkdtempSync(join(tmpdir(), 'clawket-codex-test-')); project = join(root, 'project'); mkdirSync(project); project = realpathSync(project); threadId = randomUUID();
  settings = initialSettings();
  mock.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === 'model/list') return { data: [{ model: 'native-model', displayName: 'Native model', isDefault: true, inputModalities: ['text', 'image'], supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] }] };
    if (method === 'thread/start' || method === 'thread/resume') {
      if (params.permissions) {
        const mode = params.permissions === ':danger-full-access' ? 'full-access' : params.permissions === ':read-only' ? 'read-only' : 'workspace';
        settings = { ...settings, ...permissionPatch(mode, project), activePermissionProfile: { id: params.permissions, extends: null } };
      }
      if (params.approvalPolicy) settings.approvalPolicy = params.approvalPolicy;
      return response(params.cwd ?? project);
    }
    if (method === 'thread/settings/update') { const { threadId: id, ...patch } = params; settings = { ...settings, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
      if (patch.permissions) {
        const mode = patch.permissions === ':danger-full-access' ? 'full-access' : patch.permissions === ':read-only' ? 'read-only' : 'workspace';
        settings.sandboxPolicy = permissionPatch(mode, project).sandboxPolicy;
        settings.activePermissionProfile = { id: patch.permissions, extends: null };
      }
      settings.collaborationMode = patch.collaborationMode ?? { ...settings.collaborationMode, settings: { ...settings.collaborationMode.settings, model: settings.model, reasoning_effort: settings.effort } };
      notify('thread/settings/updated', { threadId: id, threadSettings: settings }); return {}; }
    if (method === 'thread/list') return { data: [] };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    if (method === 'thread/turns/list') return { data: [{ id: 'turn-1', status: 'completed', items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hello' }] }] }] };
    if (method === 'thread/items/list') return { data: [{ turnId: 'turn-1', item: { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hello' }] } }] };
    if (method === 'thread/read') return { thread: { id: threadId, cwd: project, turns: [{ id: 'turn-1', items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hello' }] }] }] } };
    return {};
  });
  service = new CodexService({ project, directory: join(root, 'state') }); updates = []; service.on('update', u => updates.push(u));
  key = (await request('sessions.create')).key;
});
afterEach(async () => { await service.stop(); rmSync(root, { recursive: true, force: true }); });
describe('Codex owned sessions', () => {
  it('publishes the original receipt-bound native input immediately and never promotes a guide', async () => {
    const sent = await start();
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'a', delta: 'Before the tool.' });
    notify('item/started', { turnId: 'turn-1', item: { id: 'main', type: 'userMessage', clientId: 'send-1', content: [] } });
    expect(updates.filter(update => update.type === 'run_started')).toEqual([
      expect.objectContaining({ runId: sent.runId }),
      expect.objectContaining({ runId: sent.runId, turnId: 'turn-1', inputMessageId: 'main' }),
    ]);
    notify('item/started', { turnId: 'turn-1', item: { id: 'guide1', type: 'userMessage', content: [] } });
    notify('item/completed', { turnId: 'turn-1', item: { id: 'guide2', type: 'userMessage', clientId: 'unknown-key', content: [] } });
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'b', delta: 'After the guide.' });
    const history = await request('chat.history', { sessionKey: key });
    expect(history.activeRun).toMatchObject({ runId: sent.runId, turnId: 'turn-1', inputMessageId: 'main' });
    expect(history.messages.filter((message: any) => ['main', 'guide1', 'guide2'].includes(message.id)))
      .toEqual([expect.objectContaining({ id: 'main', turnId: 'turn-1', idempotencyKey: 'send-1' }),
        expect.objectContaining({ id: 'guide1', turnId: 'turn-1' }), expect.objectContaining({ id: 'guide2', turnId: 'turn-1' })]);
    expect(updates.at(-1)).toMatchObject({ type: 'agent_message_chunk', turnId: 'turn-1', inputMessageId: 'main' });
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
  });

  describe('0.160 lazy first thread permissions', () => {
    const refused = 'Codex did not restore the conversation permissions. Select and confirm permissions before sending.';
    const owned = () => (service as any).records[0];
    const metadata = () => ({ thread: { id: threadId, cwd: project, status: { type: 'idle' } } });
    const prepare = async () => {
      mock.instances.at(-1).nativeVersion = '0.160.0';
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation(async (method, params) => {
        if (method === 'thread/resume') throw new Error('Unmaterialized native thread');
        if (method === 'thread/read') return metadata();
        const result = await original(method, params);
        return method === 'thread/start' ? { ...result, thread: { ...result.thread, status: { type: 'idle' } } } : result;
      });
      await request('models.list', { sessionKey: key });
    };
    const replaceRead = (read: () => any | Promise<any>) => {
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((method, params) => method === 'thread/read' ? read() : original(method, params));
    };
    const input = () => request('chat.send', { sessionKey: key, text: 'first input', idempotencyKey: 'first' });
    const notSent = () => {
      expect(owned().keys).toEqual({}); expect((service as any).runs.size).toBe(0);
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(0);
    };
    it('selects fresh Read-only without resuming an unmaterialized thread and binds it to the first turn', async () => {
      await prepare();
      await expect(request('models.permissions', { sessionKey: key, mode: 'read-only' })).resolves.toMatchObject({ permissions: { mode: 'read-only', requiresConfirmation: false } });
      await input();
      expect(mock.request.mock.calls.filter(([method]) => method === 'thread/resume')).toHaveLength(0);
      expect(mock.request).toHaveBeenCalledWith('thread/read', { threadId, includeTurns: false });
      const params = mock.request.mock.calls.find(([method]) => method === 'turn/start')![1];
      expect(params).toMatchObject({ permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', clientUserMessageId: 'first' });
      expect(params).not.toHaveProperty('sandboxPolicy');
    });
    it.each(['workspace', 'full-access'] as const)('binds the confirmed %s named profile to the first turn', async mode => {
      await prepare(); await request('models.permissions', { sessionKey: key, mode }); await input();
      expect(mock.request.mock.calls.find(([method]) => method === 'turn/start')![1]).toMatchObject({
        permissions: mode === 'workspace' ? ':workspace' : ':danger-full-access', approvalPolicy: mode === 'workspace' ? 'on-request' : 'never', approvalsReviewer: 'user',
      });
    });
    it('retains a native-confirmed custom named profile and supported granular review policy', async () => {
      await prepare();
      const policy = { granular: { mcp_elicitations: true, rules: false, sandbox_approval: true } };
      await (service as any).desktop.handler.request('thread-follower-update-thread-settings', {
        conversationId: threadId, threadSettings: { permissions: ':managed-team', approvalPolicy: policy, approvalsReviewer: 'auto_review' },
      });
      await input();
      const params = mock.request.mock.calls.find(([method]) => method === 'turn/start')![1];
      expect(params).toMatchObject({ permissions: ':managed-team', approvalPolicy: policy, approvalsReviewer: 'auto_review' });
      expect(params).not.toHaveProperty('sandboxPolicy');
    });
    it.each(['foreign-id', 'foreign-cwd', 'active', 'notLoaded', 'missing-status', 'missing-thread'])('rejects unsafe fresh metadata before receipt: %s', async shape => {
      await prepare(); replaceRead(() => {
        const result: any = metadata();
        if (shape === 'foreign-id') result.thread.id = randomUUID();
        if (shape === 'foreign-cwd') result.thread.cwd = root;
        if (shape === 'active' || shape === 'notLoaded') result.thread.status.type = shape;
        if (shape === 'missing-status') delete result.thread.status;
        if (shape === 'missing-thread') delete result.thread;
        return result;
      });
      await expect(input()).rejects.toThrow(refused); notSent();
    });
    it.each(['replaced-rpc', 'replaced-record', 'changed-id', 'changed-cwd', 'changed-record-id', 'active-run', 'same-value-notification'])('retires a pending fresh read on context change: %s', async change => {
      await prepare(); replaceRead(() => {
        if (change === 'replaced-rpc') (service as any).rpc = { nativeVersion: '0.160.0', stop: async () => {} };
        if (change === 'replaced-record') (service as any).records[0] = { ...owned() };
        if (change === 'changed-id') owned().threadId = randomUUID();
        if (change === 'changed-cwd') owned().cwd = root;
        if (change === 'changed-record-id') { const previous = owned().id; owned().id = randomUUID();
          (service as any).loaded.add(owned().id); (service as any).effectiveSettings.set(owned().id, (service as any).effectiveSettings.get(previous)); }
        if (change === 'active-run') (service as any).runs.set(key, { id: 'other-run' });
        if (change === 'same-value-notification') notify('thread/settings/updated', { threadSettings: { ...settings } });
        return metadata();
      });
      await expect(input()).rejects.toThrow(refused);
      expect(owned().keys).toEqual({}); expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(0);
    });
    it.each(['absent-profile', 'invalid-profile', 'future-sandbox', 'future-reviewer', 'future-policy', 'missing-granular-field', 'future-granular-field', 'invalid-granular-field'])('never dispatches an unknown permission projection: %s', async shape => {
      await prepare();
      const saved = (service as any).effectiveSettings.get(key);
      (service as any).effectiveSettings.set(key, { ...saved,
        ...(shape === 'absent-profile' ? { activePermissionProfile: null } : {}),
        ...(shape === 'invalid-profile' ? { activePermissionProfile: { id: ' '.repeat(3) } } : {}),
        ...(shape === 'future-sandbox' ? { sandboxPolicy: { type: 'futureSandbox' } } : {}),
        ...(shape === 'future-reviewer' ? { approvalsReviewer: 'future-reviewer' } : {}),
        ...(shape === 'future-policy' ? { approvalPolicy: 'future-policy' } : {}),
        ...(shape === 'missing-granular-field' ? { approvalPolicy: { granular: { mcp_elicitations: true, rules: false } } } : {}),
        ...(shape === 'future-granular-field' ? { approvalPolicy: { granular: { mcp_elicitations: true, rules: false, sandbox_approval: true, future: true } } } : {}),
        ...(shape === 'invalid-granular-field' ? { approvalPolicy: { granular: { mcp_elicitations: true, rules: false, sandbox_approval: 'yes' } } } : {}),
      });
      await expect(input()).rejects.toThrow(refused); notSent();
    });
    it('uses the warm configured probe after the first actual dispatch and never retries it as fresh', async () => {
      await prepare(); await input();
      notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', items: [] } });
      await expect(request('chat.send', { sessionKey: key, text: 'next input', idempotencyKey: 'next' })).rejects.toThrow(refused);
      expect(mock.request).toHaveBeenCalledWith('thread/resume', { threadId, excludeTurns: true });
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
      expect(Object.keys(owned().keys)).toEqual(['first']);
    });
    it('does not derive fresh eligibility from an old empty index when actual recreation fails', async () => {
      await prepare(); await service.stop();
      service = new CodexService({ project, directory: join(root, 'state') });
      mock.instances.at(-1).nativeVersion = '0.160.0';
      // Empty persisted threads are explicitly recreated by the existing path;
      // only that successful creation, never the old ID, grants fresh eligibility.
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((method, params) => method === 'thread/start' ? Promise.reject(new Error('start unavailable')) : original(method, params));
      await expect(input()).rejects.toThrow('start unavailable'); notSent();
    });
    it('grants fresh eligibility only after the existing cold-empty path actually starts a new native thread', async () => {
      await prepare(); const oldNativeId = threadId; await service.stop();
      service = new CodexService({ project, directory: join(root, 'state') }); mock.instances.at(-1).nativeVersion = '0.160.0';
      threadId = randomUUID(); mock.request.mockClear();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' }); await input();
      expect(mock.request.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(1);
      expect(mock.request.mock.calls.filter(([method]) => method === 'thread/resume')).toHaveLength(0);
      expect(mock.request.mock.calls.find(([method]) => method === 'turn/start')![1]).toMatchObject({ threadId, permissions: ':read-only' });
      expect(threadId).not.toBe(oldNativeId);
    });
    it('never reuses fresh admission after an uncertain first dispatch', async () => {
      await prepare();
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((method, params) => method === 'turn/start' ? Promise.reject(new Error('Unknown acknowledgement')) : original(method, params));
      const accepted = await input(); await Promise.resolve();
      expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'first' })).toMatchObject({ status: 'recorded', runId: accepted.runId });
      await expect(request('chat.send', { sessionKey: key, text: 'later input', idempotencyKey: 'later' })).rejects.toThrow('busy');
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
      expect(mock.request.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(1);
    });
    it('rejects a complete settings ACK followed by native close before allocating a turn receipt', async () => {
      await prepare();
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation(async (method, params) => {
        const result = await original(method, params);
        if (method === 'thread/settings/update') mock.instances.at(-1).emit('closed');
        return result;
      });
      await expect((service as any).desktop.handler.request('thread-follower-start-turn', {
        conversationId: threadId, turnStart: { request: { threadId, input: [{ type: 'text', text: 'first input' }],
          permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', clientUserMessageId: 'first' } },
      })).rejects.toThrow(refused);
      notSent(); expect((service as any).loaded.size).toBe(0);
    });
    it('keeps the pre-0.160 first-turn path unchanged', async () => {
      await start();
      const params = mock.request.mock.calls.find(([method]) => method === 'turn/start')![1];
      expect(params).not.toHaveProperty('permissions'); expect(params).not.toHaveProperty('approvalPolicy');
    });
  });
  describe('0.160 configured permission confirmation', () => {
    const restored = 'Codex did not restore the conversation permissions. Select and confirm permissions before sending.';
    const permissionState = (mode: 'workspace' | 'read-only' | 'full-access') => ({
      ...permissionPatch(mode, project), activePermissionProfile: {
        id: mode === 'full-access' ? ':danger-full-access' : mode === 'read-only' ? ':read-only' : ':workspace', extends: null,
      },
    });
    // These resume responses model saved future configuration, not running-turn execution.
    const configuredView = (state: object) => ({ ...response(project), ...state, thread: { id: threadId, cwd: project, status: { type: 'idle' } },
      sandbox: (state as any).sandboxPolicy ?? settings.sandboxPolicy });
    const overrideConfigured = (read: () => any | Promise<any>) => {
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((method, params) => method === 'thread/resume' && params.excludeTurns === true && !params.cwd
        ? read() : original(method, params));
    };
    const prepare = async () => {
      mock.instances.at(-1).nativeVersion = '0.160.0';
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation(async (method, params) => {
        const value = await original(method, params);
        return method === 'thread/start' || method === 'thread/resume'
          ? { ...value, thread: { ...value.thread, status: { type: 'idle' } } } : value;
      });
      // This suite exercises already-materialized owned threads. An index entry
      // is never evidence of this process having just created a native thread.
      await service.stop();
      const record = { ...JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0], threadId, activity: 1 };
      writeFileSync(join(root, 'state', 'sessions.json'), JSON.stringify({ project, sessions: [record] }));
      service = new CodexService({ project, directory: join(root, 'state') });
      updates = []; service.on('update', u => updates.push(u)); mock.instances.at(-1).nativeVersion = '0.160.0';
      mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: null,
        permissions: { resume: { approvalPolicy: 'on-request', approvalsReviewer: 'user', permissions: ':workspace' }, expected: { ...permissionPatch('workspace', project), permissions: ':workspace' } } });
      await request('models.list', { sessionKey: key });
    };
    it('does not confirm a Read-only ACK when the independent configured profile remains Workspace', async () => {
      await prepare();
      overrideConfigured(() => configuredView(permissionState('workspace')));
      await expect(request('models.permissions', { sessionKey: key, mode: 'read-only' })).rejects.toThrow(restored);
      expect((service as any).records[0]).toMatchObject({ permissionsUnconfirmed: true, keys: {} });
      expect((await request('models.list', { sessionKey: key })).permissions).toMatchObject({ mode: 'read-only', requiresConfirmation: true });
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('rejects first-send permission drift before allocating a receipt or dispatching input', async () => {
      await prepare();
      expect((await request('models.permissions', { sessionKey: key, mode: 'read-only' })).permissions)
        .toMatchObject({ mode: 'read-only', requiresConfirmation: false });
      overrideConfigured(() => configuredView(permissionState('workspace')));
      await expect(request('chat.send', { sessionKey: key, text: 'first input', idempotencyKey: 'first-read-only' })).rejects.toThrow(restored);
      expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'first-read-only' })).toEqual({ status: 'unknown' });
      expect((service as any).records[0].keys).toEqual({});
      expect((service as any).runs.size).toBe(0);
      expect(updates.some(update => update.type === 'run_started')).toBe(false);
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
      // Repair is explicit; the failed input is never automatically replayed.
      await request('models.permissions', { sessionKey: key, mode: 'workspace' });
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
      await request('chat.send', { sessionKey: key, text: 'explicit new input', idempotencyKey: 'explicit-workspace' });
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
    });
    it('allows a matching future Read-only configuration on the same already-owned writer', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      settings = { ...settings, summary: 'concise', personality: 'pragmatic' };
      notify('thread/settings/updated', { threadSettings: settings });
      const saved = (service as any).effectiveSettings.get(key);
      overrideConfigured(() => {
        const configured = configuredView(permissionState('read-only'));
        delete configured.summary; delete configured.personality;
        return configured;
      });
      mock.request.mockClear();
      await request('chat.send', { sessionKey: key, text: 'read-only input', idempotencyKey: 'safe-read-only' });
      expect(mock.request).toHaveBeenCalledWith('thread/resume', { threadId, excludeTurns: true });
      expect(mock.request.mock.calls.find(([method]) => method === 'thread/resume')?.[1]).not.toHaveProperty('permissions');
      expect(mock.request.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(0);
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
      expect((service as any).records[0].permissionsUnconfirmed).toBeUndefined();
      expect((service as any).effectiveSettings.get(key)).toBe(saved);
      expect(saved).toMatchObject({ summary: 'concise', personality: 'pragmatic' });
    });
    it.each(['serviceTier', 'reasoningEffort', 'collaborationMode', 'all-optional'])('confirms permissions independently of omitted non-permission resume metadata: %s', async field => {
      await prepare();
      overrideConfigured(() => {
        const configured = configuredView(permissionState('read-only'));
        for (const name of field === 'all-optional' ? ['serviceTier', 'reasoningEffort', 'collaborationMode'] : [field]) delete configured[name];
        return configured;
      });
      await expect(request('models.permissions', { sessionKey: key, mode: 'read-only' })).resolves.toMatchObject({
        permissions: { mode: 'read-only', requiresConfirmation: false },
      });
      const saved = (service as any).effectiveSettings.get(key);
      await request('chat.send', { sessionKey: key, text: 'explicit readonly input', idempotencyKey: 'optional-metadata' });
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
      expect((service as any).effectiveSettings.get(key)).toBe(saved);
      expect(saved).toMatchObject({ model: 'native-model', serviceTier: null, effort: null, collaborationMode: { mode: 'default' } });
    });
    it('keeps full native ACK confirmation for mixed Desktop permission and model writes', async () => {
      await prepare();
      overrideConfigured(() => {
        const configured = configuredView(permissionState('read-only'));
        for (const field of ['model', 'modelProvider', 'reasoningEffort', 'serviceTier', 'collaborationMode']) delete configured[field];
        return configured;
      });
      await expect((service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
        threadSettings: { permissions: ':read-only', model: 'new-native-model', effort: 'high' } })).resolves.toMatchObject({ applied: true });
      expect((service as any).effectiveSettings.get(key)).toMatchObject({ model: 'new-native-model', effort: 'high', activePermissionProfile: { id: ':read-only' } });
      expect((service as any).records[0].permissionsUnconfirmed).toBeUndefined();
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it.each(['missing-policy', 'empty-policy', 'array-policy', 'null-reviewer', 'array-reviewer', 'null-sandbox',
      'array-sandbox', 'empty-sandbox-type', 'invalid-roots', 'array-profile'])('rejects invalid permission evidence before receipt and reports only its shape: %s', async field => {
      await prepare();
      overrideConfigured(() => {
        const configured = configuredView(permissionState('workspace'));
        if (field === 'missing-policy') delete configured.approvalPolicy;
        if (field === 'empty-policy') configured.approvalPolicy = '';
        if (field === 'array-policy') configured.approvalPolicy = [];
        if (field === 'null-reviewer') configured.approvalsReviewer = null;
        if (field === 'array-reviewer') configured.approvalsReviewer = [];
        if (field === 'null-sandbox') configured.sandbox = null;
        if (field === 'array-sandbox') configured.sandbox = [];
        if (field === 'empty-sandbox-type') configured.sandbox = { type: '' };
        if (field === 'invalid-roots') configured.sandbox = { ...configured.sandbox, writableRoots: [123] };
        if (field === 'array-profile') configured.activePermissionProfile = [];
        return configured;
      });
      const diagnostics: any[] = []; service.on('permissionDiagnostic', value => diagnostics.push(value));
      await expect(request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: field })).rejects.toThrow(restored);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ failureCategory: 'response_invalid', observedPermissionMode: 'unknown',
        sameThreadId: true, sameProjectCwd: true, idleThreadReported: true });
      expect((service as any).records[0]).toMatchObject({ permissionsUnconfirmed: true, keys: {} });
      expect((service as any).runs.size).toBe(0);
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('keeps native identifiers, paths, profiles, model values and errors out of permission diagnostics', async () => {
      await prepare();
      const privateThreadId = randomUUID(), privateProfile = 'private-profile-name', privateModel = 'private-model-name';
      const privateCwd = join(root, 'private-path'), privateError = 'private-native-error';
      overrideConfigured(() => ({ ...configuredView(permissionState('workspace')), cwd: privateCwd, model: privateModel,
        error: privateError, activePermissionProfile: { id: privateProfile, extends: 'private-parent-profile' },
        thread: { id: privateThreadId, cwd: privateCwd, status: { type: 'idle' } } }));
      const diagnostics: any[] = []; service.on('permissionDiagnostic', value => diagnostics.push(value));
      await expect(request('chat.send', { sessionKey: key, text: 'private-user-input', idempotencyKey: 'private-client-key' })).rejects.toThrow(restored);
      expect(diagnostics).toEqual([{ failureCategory: 'response_invalid', expectedPermissionMode: 'workspace', observedPermissionMode: 'unknown',
        sameThreadId: false, sameProjectCwd: false, idleThreadReported: true,
        responseFieldTypes: { cwd: 'string', approvalPolicy: 'string', approvalsReviewer: 'string', sandbox: 'object', activePermissionProfile: 'object',
          model: 'string', modelProvider: 'string', reasoningEffort: 'null', serviceTier: 'null', collaborationMode: 'object', thread: 'object' },
        threadFieldTypes: { id: 'string', cwd: 'string', status: 'object' } }]);
      const serialized = JSON.stringify(diagnostics);
      for (const secret of [threadId, key, project, privateThreadId, privateProfile, privateModel, privateCwd, privateError,
        'private-parent-profile', 'private-user-input', 'private-client-key']) expect(serialized).not.toContain(secret);
      expect((service as any).records[0].keys).toEqual({});
    });
    it('requires confirmation after a passive native permission change instead of silently widening a send', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      settings = { ...settings, ...permissionState('workspace') };
      notify('thread/settings/updated', { threadSettings: settings });
      expect((await request('models.list', { sessionKey: key })).permissions).toMatchObject({ mode: 'workspace', requiresConfirmation: true });
      await expect(request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: 'passive-change' })).rejects.toThrow(restored);
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('does not authorize unrelated permission widening during a partial approval-policy write', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((method, params) => method === 'thread/settings/update'
        ? original(method, { ...params, permissions: ':workspace' }) : original(method, params));
      await expect((service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
        threadSettings: { approvalPolicy: 'never' } })).rejects.toThrow(restored);
      expect((service as any).records[0].permissionsUnconfirmed).toBe(true);
      await expect(request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: 'partial-permission' })).rejects.toThrow(restored);
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('lets an explicit Desktop permission selection repair the same owned writer without replaying input', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      settings = { ...settings, ...permissionState('workspace') };
      notify('thread/settings/updated', { threadSettings: settings });
      expect((service as any).records[0].permissionsUnconfirmed).toBe(true);
      await (service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
        threadSettings: { permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'user' } });
      expect((service as any).records[0].permissionsUnconfirmed).toBeUndefined();
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it.each(['profile', 'thread', 'cwd', 'sandbox', 'reviewer', 'invalid-profile', 'active', 'status'])('fails closed on an unproven configured readback: %s', async field => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      overrideConfigured(() => {
        const value = configuredView(permissionState('read-only'));
        if (field === 'profile') delete value.activePermissionProfile;
        if (field === 'thread') value.thread = { ...value.thread, id: randomUUID() };
        if (field === 'cwd') value.cwd = join(root, 'outside');
        if (field === 'sandbox') delete value.sandbox;
        if (field === 'reviewer') delete value.approvalsReviewer;
        if (field === 'invalid-profile') value.activePermissionProfile = { id: ':future-permission' };
        if (field === 'active') value.thread.status = { type: 'active' };
        if (field === 'status') delete (value.thread as any).status;
        return value;
      });
      await expect(request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: `invalid-${field}` })).rejects.toThrow(restored);
      expect((service as any).records[0]).toMatchObject({ permissionsUnconfirmed: true, keys: {} });
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('never treats a failed metadata confirmation as uncertain prompt dispatch', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      overrideConfigured(() => Promise.reject(Object.assign(new Error('private metadata timeout'), { outcome: 'uncertain' })));
      await expect(request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: 'metadata-timeout' })).rejects.toThrow(restored);
      expect((service as any).records[0].keys).toEqual({});
      expect((service as any).runs.size).toBe(0);
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('rejects a late configured snapshot after the original owned AppServer has closed', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      let resolve!: (value: any) => void;
      overrideConfigured(() => new Promise(done => { resolve = done; }));
      const pending = request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: 'retired-owner' });
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
      mock.instances.at(-1).emit('closed');
      resolve(configuredView(permissionState('read-only')));
      await expect(pending).rejects.toThrow(restored);
      expect((service as any).loaded.size).toBe(0);
      expect((service as any).records[0].keys).toEqual({});
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('does not overwrite a newer native permission notification with an older metadata response', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      let resolve!: (value: any) => void;
      overrideConfigured(() => new Promise(done => { resolve = done; }));
      const pending = request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: 'late-snapshot' });
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
      settings = { ...settings, ...permissionState('workspace') };
      notify('thread/settings/updated', { threadSettings: settings });
      resolve(configuredView(permissionState('read-only')));
      await expect(pending).rejects.toThrow(restored);
      expect((service as any).effectiveSettings.get(key).activePermissionProfile.id).toBe(':workspace');
      expect((service as any).records[0]).toMatchObject({ permissionsUnconfirmed: true, keys: {} });
      expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    });
    it('does not mark the replacement RPC generation unconfirmed from a late old readback', async () => {
      await prepare();
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      let resolve!: (value: any) => void;
      overrideConfigured(() => new Promise(done => { resolve = done; }));
      const originalRpc = (service as any).rpc;
      const pending = request('chat.send', { sessionKey: key, text: 'blocked input', idempotencyKey: 'replaced-owner' });
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
      (service as any).rpc = { nativeVersion: '0.160.0' };
      try {
        resolve(configuredView(permissionState('read-only')));
        await expect(pending).rejects.toThrow(restored);
        expect((service as any).records[0].permissionsUnconfirmed).toBeUndefined();
        expect((service as any).records[0].keys).toEqual({});
        expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
      } finally { (service as any).rpc = originalRpc; }
    });
    it('does not add a warm-resume probe to legacy or imported ownership paths', async () => {
      await request('models.list', { sessionKey: key });
      await request('models.permissions', { sessionKey: key, mode: 'read-only' });
      mock.request.mockClear();
      await request('chat.send', { sessionKey: key, text: 'legacy input', idempotencyKey: 'legacy-read-only' });
      expect(mock.request).not.toHaveBeenCalledWith('thread/resume', expect.anything());
      notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      mock.instances.at(-1).nativeVersion = '0.160.0';
      (service as any).records[0].native = true;
      mock.request.mockClear();
      await request('chat.send', { sessionKey: key, text: 'imported owned input', idempotencyKey: 'imported-owned' });
      expect(mock.request).not.toHaveBeenCalledWith('thread/resume', expect.anything());
    });
  });
  it.each([null, 42, false, { name: 'private-native-value' }, ['private-native-value']])(
    'keeps the complete catalog when a native model is not a string: %j', async model => {
      const knownId = randomUUID();
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation((method, params) => method === 'thread/list'
        ? Promise.resolve({ data: [
          { id: threadId, cwd: project, updatedAt: 1, model, modelProvider: 'custom' },
          { id: knownId, cwd: project, updatedAt: 1, model: 'native-model', modelProvider: 'custom' },
        ] }) : original(method, params));
      const snapshot = await request('sessions.sync');
      const wire = JSON.parse(JSON.stringify(snapshot.sessions));
      expect(snapshot).toMatchObject({ kind: 'full', total: 3 });
      expect(validateRows(wire)).toEqual({ rowCount: 3, invalidRows: 0, invalidFields: [] });
      expect(wire.find((row: any) => row.sessionId === threadId)).not.toHaveProperty('model');
      expect(wire.find((row: any) => row.sessionId === knownId)).toMatchObject({ model: 'native-model' });
      expect(JSON.parse(JSON.stringify(await request('sessions.list')))).toEqual(wire);
      expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'thread/settings/update', 'turn/start'].includes(method))).toBe(false);
    },
  );
  it('keeps older indexed null-model sessions valid in lists, live metadata and archives without rewriting the model', async () => {
    Object.assign((service as any).records[0], { model: null, threadId, activity: 1000 }); (service as any).save();
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    const events: any[] = []; service.on('update', update => events.push(update));
    const wire = JSON.parse(JSON.stringify(await request('sessions.list')));
    expect(validateRows(wire)).toEqual({ rowCount: 1, invalidRows: 0, invalidFields: [] });
    expect(wire[0]).not.toHaveProperty('model');
    expect((await request('sessions.sync')).sessions).toEqual(await request('sessions.list'));
    expect(JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0].model).toBeNull();
    await request('sessions.rename', { sessionKey: key, title: 'Renamed' });
    expect(validateRows(JSON.parse(JSON.stringify([events.find(update => update.type === 'session_info_update').session]))).invalidRows).toBe(0);
    await request('sessions.archive', { sessionKey: key, archived: true });
    const archived = JSON.parse(JSON.stringify(await request('sessions.archived')));
    expect(validateRows(archived)).toEqual({ rowCount: 1, invalidRows: 0, invalidFields: [] });
    expect(archived[0]).not.toHaveProperty('model');
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'thread/settings/update', 'turn/start'].includes(method))).toBe(false);
  });
  it('indexes a native conversation with unknown model metadata without inventing a model or changing native settings', async () => {
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state'), device: true });
    const native = { id: threadId, cwd: project, updatedAt: 1, model: null, modelProvider: 'custom' };
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [native] }) : original(method, params));
    await request('sessions.list');
    await request('sessions.rename', { sessionKey: `native:${threadId}`, title: 'Renamed' });
    const indexed = JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions.find((row: any) => row.threadId === threadId);
    expect(indexed).toMatchObject({ native: true, provider: 'custom', title: 'Renamed' });
    expect(indexed).not.toHaveProperty('model');
    expect(native.model).toBeNull();
    expect(validateRows(JSON.parse(JSON.stringify(await request('sessions.list')))).invalidRows).toBe(0);
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'thread/settings/update', 'turn/start'].includes(method))).toBe(false);
  });
  it('sync negotiates immutable pages and does not report removed rows after an incomplete native scan', async () => {
    const original = mock.request.getMockImplementation()!;
    const native = { id: threadId, cwd: project, updatedAt: 1, name: 'Native' };
    const outside = { id: randomUUID(), cwd: join(root, 'outside'), updatedAt: 1 };
    let failure = false, malformed = false, deleted = false;
    mock.request.mockImplementation(async (method: string, params: any) => {
      if (method === 'thread/list') {
        if (failure) throw new Error('private native details');
        return { data: malformed ? [{ id: 'invalid' }, outside] : deleted ? [] : [native] };
      }
      return original(method, params);
    });
    const first = await request('sessions.sync'), base = { epoch: first.epoch, revision: first.revision };
    expect(first).toMatchObject({ kind: 'full', total: 2, nextOffset: null });
    expect(await service.health()).toMatchObject({ sessionCatalogSync: 1, sessionCatalogPageIndex: 1 });
    expect(await request('sessions.list')).toEqual(first.sessions);
    expect(await request('sessions.sync', { base })).toEqual({ kind: 'unchanged', ...base });
    failure = true;
    await expect(request('sessions.sync', { base })).rejects.toThrow('Conversation catalog could not be refreshed completely');
    expect(await request('sessions.sync', { page: { ...base, offset: 0 } })).toEqual(first);
    failure = false; malformed = true;
    await expect(request('sessions.sync', { base })).rejects.toThrow('Conversation catalog could not be refreshed completely');
    expect(await request('chat.history', { sessionKey: `native:${threadId}` })).toMatchObject({ messages: [expect.objectContaining({ text: 'hello' })] });
    await expect(request('chat.history', { sessionKey: `native:${outside.id}` })).rejects.toThrow('Session unavailable');
    await expect(request('chat.send', { sessionKey: `native:${threadId}`, text: 'must not send', idempotencyKey: 'old-cache' })).rejects.toThrow('read-only');
    malformed = false;
    expect(await request('sessions.sync', { base })).toEqual({ kind: 'unchanged', ...base });
    deleted = true;
    expect(await request('sessions.sync')).toMatchObject({ kind: 'full', total: 1 });
    await expect(request('chat.history', { sessionKey: `native:${threadId}` })).rejects.toThrow('Session unavailable');
  });
  it('delivers the same final completion clock live and after native history reload', async () => {
    await start();
    const turn = { id: 'turn-1', status: 'completed', startedAt: 1727996280, completedAt: 1727998140, items: [
      { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'hello' }] },
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
    ] };
    notify('item/completed', { turnId: turn.id, item: turn.items[1] });
    notify('turn/completed', { turn });
    const live = updates.find(update => update.type === 'run_finished');
    expect(live).toMatchObject({ stopReason: 'end_turn', message: { content: 'Done', timestampMs: turn.completedAt * 1000 } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/turns/list' ? Promise.resolve({ data: [turn] })
      : method === 'thread/items/list' ? Promise.resolve({ data: [...turn.items].reverse().map(item => ({ turnId: turn.id, item })) }) : original(method, params));
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages.find((message: any) => message.id === 'answer').timestampMs).toBe(live.message.timestampMs);
    expect(history.messages.find((message: any) => message.id === 'user').timestampMs).toBe(turn.startedAt * 1000);
    expect(history.hasActiveRun).toBe(false);
  });

  it.each([undefined, null, NaN, Infinity, -1, 9, 10.5])('omits an unproven native completion clock from the successful live final: %j', async completedAt => {
    await start();
    notify('item/completed', { turnId: 'turn-1', item: { id: 'answer', type: 'agentMessage', text: 'Done' } });
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', startedAt: 10, completedAt } });
    expect(updates.find(update => update.type === 'run_finished').message).not.toHaveProperty('timestampMs');
  });
  it.each(['commentary', 'future-phase'])('does not project %s text as a final reply clock from a terminal notification', async phase => {
    await start();
    const item = { id: 'answer', type: 'agentMessage', phase, text: 'Progress' };
    notify('item/completed', { turnId: 'turn-1', item });
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', startedAt: 10, completedAt: 1870, items: [item] } });
    expect(updates.find(update => update.type === 'run_finished').message).not.toHaveProperty('timestampMs');
  });
  it.each(['commentary', 'future-phase'])('does not borrow a prior final-answer clock for a later %s live body', async phase => {
    await start();
    const first = { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Done' };
    const later = { id: 'later', type: 'agentMessage', phase, text: 'Later progress' };
    notify('item/completed', { turnId: 'turn-1', item: first });
    notify('item/completed', { turnId: 'turn-1', item: later });
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', startedAt: 10, completedAt: 1870, items: [first, later] } });
    const live = updates.find(update => update.type === 'run_finished');
    expect(live.message.content).toBe('Later progress');
    expect(live.message).not.toHaveProperty('timestampMs');
  });
  it('retimes the legacy final on the head page but preserves a preceding paragraph on an older partial page', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/turns/list') return Promise.resolve({ data: [{ id: 'turn-1', status: 'completed', startedAt: 10, completedAt: 1870 }] });
      if (method === 'thread/items/list') return Promise.resolve(params.cursor ? { data: [
        { turnId: 'turn-1', item: { id: 'progress', type: 'agentMessage', text: 'Earlier paragraph' } },
      ] } : { data: [{ turnId: 'turn-1', item: { id: 'final', type: 'agentMessage', text: 'Done' } }], nextCursor: 'older' });
      return original(method, params);
    });
    const head = await request('chat.history', { sessionKey: key });
    expect(head.messages[0]).toMatchObject({ id: 'final', timestampMs: 1870000 });
    const older = await request('chat.history', { sessionKey: key, cursor: head.nextCursor });
    expect(older.messages[0]).toMatchObject({ id: 'progress', timestampMs: 10000 });
  });

  it('preserves a native failed-turn notice with the same identity in live delivery and reloaded history', async () => {
    await start();
    const turn = { id: 'turn-1', status: 'failed', startedAt: 10, completedAt: 12,
      error: { codexErrorInfo: 'unauthorized', message: 'private provider body' } };
    notify('turn/completed', { turn });
    const live = updates.find(u => u.type === 'run_finished');
    expect(live).toMatchObject({ stopReason: 'error', terminalMessage: { id: 'codex-turn-error:turn-1', role: 'system',
      text: 'Model authentication failed. Sign in again on your computer.', timestampMs: 12000 } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/turns/list' ? Promise.resolve({ data: [turn] }) : original(method, params));
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages.filter((m: any) => m.role === 'system')).toEqual([live.terminalMessage]);
    expect(history.hasActiveRun).toBe(false);
    expect(JSON.stringify(live)).not.toContain('private'); expect(JSON.stringify(history)).not.toContain('private');
  });
  it('does not report an incomplete native turn as successfully finished', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'incomplete' } });
    expect(updates.some(u => u.type === 'run_finished')).toBe(false);
    expect((service as any).runs.has(key)).toBe(true);
  });
  it('ignores a delayed Desktop settings echo after taking native ownership', async () => {
    await request('models.list', { sessionKey: key });
    const foreign = { ...initialSettings(), model: 'stale-model', sandboxPolicy: { type: 'dangerFullAccess' }, approvalPolicy: 'never' };
    (service as any).desktopSnapshot(threadId, { fresh: true, state: { latestThreadSettings: foreign, latestModel: 'stale-model', turns: [] } });
    const state = await request('models.list', { sessionKey: key });
    expect(state.currentModel).toBe('native-model');
    expect(state.permissions.mode).toBe('workspace');
  });
  it('prepares effective settings before sending on a safely released persisted thread', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    mock.request.mockClear();
    const state = await request('models.list', { sessionKey: key });
    expect(state.permissions).toMatchObject({ available: true, mode: 'workspace' });
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId, excludeTurns: true }));
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  });
  it.each(['read-only', 'workspace', 'full-access'] as const)('restores native %s permissions before a cold continuation instead of global Full access', async mode => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    const permissions = mode === 'full-access' ? ':danger-full-access' : mode === 'read-only' ? ':read-only' : ':workspace';
    const approvalPolicy = mode === 'full-access' ? 'never' : 'on-request';
    mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: 'priority', permissions: {
      resume: { permissions, approvalPolicy, approvalsReviewer: 'user' }, expected: { permissions, approvalPolicy, approvalsReviewer: 'user' },
    } });
    settings = { ...settings, ...permissionPatch('full-access', project), activePermissionProfile: null };
    const selected = await request('models.list', { sessionKey: key });
    expect(selected.permissions.mode).toBe(mode);
    await request('chat.send', { sessionKey: key, text: 'continue', idempotencyKey: `cold-${mode}` });
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId, permissions, approvalPolicy, serviceTier: 'priority' }));
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(2);
  });
  it.each(['unknown-profile', 'unknown-version', 'managed-rejection', 'mismatched-result'])('never silently dispatches under a global permission fallback: %s', async reason => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    (service as any).desktop.connect = async () => { throw new DesktopIpcError('uncertain', 'Broker unavailable', 'broker-unavailable'); };
    mock.request.mockClear();
    const permissions = { resume: { permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' }, expected: { permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' }, ...(reason === 'unknown-version' ? { anonymous: true } : {}) };
    mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: null, ...(reason === 'unknown-profile' ? {} : { permissions }) });
    if (reason === 'unknown-version') mock.instances.at(-1).nativeVersion = '0.999.0';
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/resume' && reason === 'managed-rejection') throw new Error('Managed profile restriction');
      if (method === 'thread/resume' && reason === 'mismatched-result') {
        settings = { ...settings, ...permissionPatch('full-access', project), activePermissionProfile: null };
        return response();
      }
      return original(method, params);
    });
    await expect(request('models.list', { sessionKey: key })).rejects.toThrow(reason === 'managed-rejection' ? 'Managed' : 'permissions');
    await expect(request('chat.send', { sessionKey: key, text: 'must not dispatch', idempotencyKey: 'guarded' })).rejects.toThrow();
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
    expect((service as any).records[0].keys.guarded).toBeUndefined();
  });
  it('can explicitly repair a guarded 0.153 cold resume after an incomplete response without inventing settings or allowing a send', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: null, permissions: {
      resume: { permissions: ':read-only' }, expected: { permissions: ':read-only' },
    } });
    const original = mock.request.getMockImplementation()!; let first = true;
    mock.request.mockImplementation(async (method, params) => {
      const result = await original(method, params);
      if (method === 'thread/resume') {
        delete result.collaborationMode;
        if (first) { first = false; delete result.approvalsReviewer; }
      }
      return result;
    });
    await expect(request('models.list', { sessionKey: key })).rejects.toThrow('permissions');
    await expect(request('chat.send', { sessionKey: key, text: 'blocked', idempotencyKey: 'unconfirmed' })).rejects.toThrow('permissions');
    const repaired = await request('models.permissions', { sessionKey: key, mode: 'read-only' });
    expect(repaired.permissions.mode).toBe('read-only');
    expect((service as any).records[0].permissionsUnconfirmed).toBeUndefined();
  });
  it('retains an unconfirmed permission restore across Bridge restart and Desktop routing until an explicit verified choice', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const record = (service as any).records[0]; record.permissionsUnconfirmed = true; (service as any).save();
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    mock.request.mockClear();
    const selection = await request('models.list', { sessionKey: key });
    expect(selection.permissions).toMatchObject({ requiresConfirmation: true, available: true });
    await expect(request('chat.send', { sessionKey: key, text: 'blocked', idempotencyKey: 'persisted-guard' })).rejects.toThrow('permissions');
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'turn/start'].includes(method))).toBe(false);
    expect((service as any).records[0].keys['persisted-guard']).toBeUndefined();
    const repaired = await request('models.permissions', { sessionKey: key, mode: 'workspace' });
    expect(repaired.permissions).toMatchObject({ mode: 'workspace' });
    expect(repaired.permissions.requiresConfirmation).toBe(false);
    expect(JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0].permissionsUnconfirmed).toBeUndefined();
  });
  it('allows a fresh named native profile on a newer runtime after explicit no-owner evidence', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    mock.instances.at(-1).nativeVersion = '0.999.0';
    mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: null, permissions: {
      resume: { permissions: ':read-only' }, expected: { permissions: ':read-only' },
    } });
    expect((await request('models.list', { sessionKey: key })).permissions.mode).toBe('read-only');
  });
  it('does not treat an unavailable owner broker as permission to prepare a persisted thread', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    (service as any).desktop.request = async () => { throw new DesktopIpcError('uncertain', 'Broker unavailable'); };
    mock.request.mockClear();
    expect((await request('models.list', { sessionKey: key })).permissions.available).toBe(false);
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume' || method === 'turn/start')).toBe(false);
  });
  it('uses audited native atomic writer acquisition only for its own CLI-only thread', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    (service as any).desktop.request = async () => { throw new DesktopIpcError('uncertain', 'Broker unavailable', 'broker-unavailable'); };
    mock.request.mockClear();
    expect((await request('models.list', { sessionKey: key })).permissions.mode).toBe('workspace');
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId }));
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  });
  it('continues its CLI-only thread directly after restart without opening the model picker first', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    (service as any).desktop.connect = async () => { throw new DesktopIpcError('uncertain', 'Broker unavailable', 'broker-unavailable'); };
    mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: 'priority', permissions: { resume: { permissions: ':workspace' }, expected: { permissions: ':workspace' } } }); settings.serviceTier = 'priority';
    mock.request.mockClear();
    const sent = await request('chat.send', { sessionKey: key, text: 'continue', idempotencyKey: 'direct-cold-send' });
    await Promise.resolve();
    expect(sent.runId).toEqual(expect.any(String));
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId, serviceTier: 'priority' }));
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
    expect(mock.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId, serviceTier: 'priority', clientUserMessageId: 'direct-cold-send' }));
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/start')).toBe(false);
  });
  it.each(['unknown-connection', 'unknown-version', 'native-import', 'active-native-turn', 'writer-busy', 'unknown-speed'])(
    'does not dispatch or record a cold direct send with unproven ownership/settings: %s', async reason => {
      await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
      (service as any).desktop.connect = async () => { throw new DesktopIpcError('uncertain', 'Broker unavailable', reason === 'unknown-connection' ? undefined : 'broker-unavailable'); };
      if (reason === 'unknown-version') mock.instances.at(-1).nativeVersion = '0.999.0';
      if (reason === 'native-import') (service as any).records[0].native = true;
      if (reason === 'unknown-speed') mock.resumeSpeed.mockResolvedValue({ kind: 'unknown' });
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation(async (method, params) => {
        if (reason === 'active-native-turn' && method === 'thread/turns/list') return { data: [{ id: 'turn-1', status: 'inProgress', items: [] }] };
        if (reason === 'writer-busy' && method === 'thread/resume') throw new Error('This conversation is in use by another Codex process');
        return original(method, params);
      });
      mock.request.mockClear();
      await expect(request('chat.send', { sessionKey: key, text: 'continue', idempotencyKey: 'unsafe-cold-send' })).rejects.toThrow();
      expect(mock.request.mock.calls.some(([method]) => method === 'turn/start' || method === 'thread/start')).toBe(false);
      if (reason !== 'writer-busy') expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume')).toBe(false);
      expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'unsafe-cold-send' })).toEqual({ status: 'unknown' });
    },
  );
  it.each(['unknown-version', 'native-import', 'active-native-turn'])('refuses CLI-only acquisition for %s', async reason => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    (service as any).desktop.request = async () => { throw new DesktopIpcError('uncertain', 'Broker unavailable', 'broker-unavailable'); };
    if (reason === 'unknown-version') mock.instances.at(-1).nativeVersion = '0.999.0';
    if (reason === 'native-import') (service as any).records[0].native = true;
    if (reason === 'active-native-turn') {
      const original = mock.request.getMockImplementation()!;
      mock.request.mockImplementation(async (method, params) => method === 'thread/turns/list' ? { data: [{ id: 'turn-1', status: 'inProgress', items: [] }] } : original(method, params));
    }
    mock.request.mockClear();
    await expect(request('models.list', { sessionKey: key })).rejects.toThrow();
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume' || method === 'turn/start')).toBe(false);
  });
  it('uses ordinary conversations and scopes native discovery', async () => {
    expect((await request('agents.list'))[0]).toMatchObject({ mainSessionKey: '', entryMode: 'sessions' });
    expect((await request('sessions.list'))[0]).toMatchObject({ key, kind: 'direct', source: 'bridge', allowedActions: { delete: true } });
    expect(mock.request).toHaveBeenCalledWith('thread/list', expect.objectContaining({ cwd: project }));
    await expect(request('chat.send', { sessionKey: '../foreign', text: 'x' })).rejects.toThrow('read-only');
    await expect(request('thread/start', { cwd: '/' })).rejects.toThrow('Unsupported');
  });
  it('projects two native same-turn guides with their own item clocks through history', async () => {
    await start();
    const original = mock.request.getMockImplementation()!;
    const user = (id: string, clientId?: string) => ({ id, type: 'userMessage', content: [{ type: 'text', text: 'Keep waiting' }], ...(clientId ? { clientId } : {}) });
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/items/list') return Promise.resolve({ data: [
        { turnId: 'turn-1', startedAtMs: 220100, completedAtMs: 220100, item: user('guide-2') },
        { turnId: 'turn-1', startedAtMs: 160100, completedAtMs: 160100, item: user('guide-1') },
        { turnId: 'turn-1', startedAtMs: 100100, completedAtMs: 100100, item: user('main', 'send-1') },
      ] });
      if (method === 'thread/turns/list') return Promise.resolve({ data: [{ id: 'turn-1', startedAt: 100, status: 'inProgress' }] });
      return original(method, params);
    });
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages.map((message: any) => [message.id, message.timestampMs])).toEqual([
      ['main', 100100], ['guide-1', 160100], ['guide-2', 220100],
    ]);
    expect(history.messages[0].idempotencyKey).toBe('send-1');
    expect(history.messages[1].idempotencyKey).toBeUndefined();
    expect(history.messages[2].idempotencyKey).toBeUndefined();
  });

  it.each([
    [160100, 160200, 160100], [undefined, 160200, 160200], [160100, undefined, 160100],
    [160100, 160099, 100000], ['160100', 160200, 100000], [160100, NaN, 100000],
    [0, 160200, 100000], [8.64e15 + 1, undefined, 100000], [undefined, undefined, 100000],
  ])('validates native user item timing pairs before history projection: %s / %s', async (startedAtMs, completedAtMs, expected) => {
    await start();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/items/list') return Promise.resolve({ data: [{ turnId: 'turn-1', startedAtMs, completedAtMs,
        item: { id: 'guide', type: 'userMessage', content: [{ type: 'text', text: 'Keep waiting' }] } }] });
      if (method === 'thread/turns/list') return Promise.resolve({ data: [{ id: 'turn-1', startedAt: 100 }] });
      return original(method, params);
    });
    expect((await request('chat.history', { sessionKey: key })).messages[0].timestampMs).toBe(expected);
  });

  it('preserves older item-page timestamps using bounded metadata-only pages', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/items/list') return { data: [{ turnId: 'old-turn', item: { type: 'agentMessage', id: 'old-reply', text: 'Older reply' } }] };
      if (method === 'thread/turns/list' && params.itemsView === 'notLoaded') return params.cursor ? { data: [{ id: 'old-turn', startedAt: 123, status: 'completed' }] } : { data: [{ id: 'recent-turn', startedAt: 456 }], nextCursor: 'older-metadata' };
      return original(method, params);
    });
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages[0]).toMatchObject({ id: 'old-reply', timestampMs: 123000 });
    expect(mock.request).toHaveBeenCalledWith('thread/turns/list', expect.objectContaining({ itemsView: 'notLoaded', cursor: 'older-metadata' }));
  });
  it('retains Native per-item commentary clocks in item history rather than dating every paragraph at turn start', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/items/list') return { data: [
        { turnId: 'turn-1', startedAtMs: 16000, completedAtMs: 17000, item: { type: 'agentMessage', id: 'third', phase: 'commentary', text: 'The second command started.' } },
        { turnId: 'turn-1', startedAtMs: null, completedAtMs: 15000, item: { type: 'agentMessage', id: 'second', phase: 'commentary', text: 'Still waiting.' } },
        { turnId: 'turn-1', startedAtMs: 13000, completedAtMs: 14000, item: { type: 'agentMessage', id: 'first', phase: 'commentary', text: 'Starting.' } },
      ] };
      if (method === 'thread/turns/list' && params.itemsView === 'notLoaded') return { data: [{ id: 'turn-1', startedAt: 10, completedAt: 18, status: 'completed' }] };
      return original(method, params);
    });
    expect((await request('chat.history', { sessionKey: key })).messages.map((message: any) => [message.id, message.timestampMs]))
      .toEqual([['first', 13000], ['second', 15000], ['third', 16000]]);
  });
  it.each([
    [null, null], ['13000', null], [NaN, null], [Infinity, null], [-1, null], [0, null], [1e20, null], [13000, 12000],
  ])('keeps legacy turn timing for missing or invalid Native item clocks %j/%j', async (startedAtMs, completedAtMs) => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/items/list') return { data: [{ turnId: 'turn-1', startedAtMs, completedAtMs,
        item: { type: 'agentMessage', id: 'legacy', phase: 'commentary', text: 'Older runtime.' } }] };
      if (method === 'thread/turns/list' && params.itemsView === 'notLoaded') return { data: [{ id: 'turn-1', startedAt: 10, status: 'inProgress' }] };
      return original(method, params);
    });
    expect((await request('chat.history', { sessionKey: key })).messages[0]).toMatchObject({ id: 'legacy', timestampMs: 10000 });
  });
  it('retains each Native item first emission clock across later deltas and active-history recovery', async () => {
    await start();
    notify('item/started', { turnId: 'turn-1', item: { type: 'agentMessage', id: 'first', text: '', phase: 'commentary' } }, 13000);
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first', delta: 'Starting.' }, 14000);
    expect(updates.at(-1)).toMatchObject({ type: 'agent_message_chunk', timestampMs: 13000 });
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first', delta: ' Still working.' }, 15000);
    expect(updates.at(-1)).toMatchObject({ timestampMs: 13000 });
    notify('item/agentMessage/delta', { turnId: 'other-turn', itemId: 'first', delta: 'Wrong turn.' }, 99999);
    expect(updates.at(-1)).toMatchObject({ timestampMs: 13000 });
    notify('item/started', { turnId: 'turn-1', item: { id: 'exec', type: 'commandExecution', command: 'true', status: 'inProgress' } }, 16000);
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'second', delta: 'A later paragraph.' }, 19000);
    expect(updates.at(-1)).toMatchObject({ type: 'agent_message_chunk', timestampMs: 19000 });
    const history = await request('chat.history', { sessionKey: key });
    expect(history.activeRun).toMatchObject({ messageTimestampMs: 19000 });
    expect(history.messages.filter((message: any) => message.role === 'assistant').map((message: any) => message.timestampMs)).toEqual([13000, 19000]);
    expect((service as any).runs.get(key).items.get('first')).not.toHaveProperty('timestampMs');
  });
  it('prefers the same Native item lifecycle start over a later notification emission in live and cold history', async () => {
    await start();
    notify('item/started', { turnId: 'turn-1', startedAtMs: 59000,
      item: { type: 'agentMessage', id: 'first', text: '', phase: 'commentary' } }, 61000);
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first', delta: 'A paragraph across the minute.' }, 62000);
    expect(updates.at(-1)).toMatchObject({ timestampMs: 59000 });
    notify('item/started', { turnId: 'turn-1', startedAtMs: 63000,
      item: { type: 'agentMessage', id: 'first', text: '', phase: 'commentary' } }, 64000);
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first', delta: ' More.' }, 65000);
    expect(updates.at(-1)).toMatchObject({ timestampMs: 59000 });
    notify('item/started', { turnId: 'other-turn', startedAtMs: 99999,
      item: { type: 'agentMessage', id: 'first', text: '', phase: 'commentary' } }, 99999);
    const implementation = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method: string, params: any) => method === 'thread/items/list'
      ? { data: [{ turnId: 'turn-1', startedAtMs: 59000, completedAtMs: 66000,
          item: { type: 'agentMessage', id: 'first', text: 'A paragraph across the minute. More.', phase: 'commentary' } }] }
      : implementation(method, params));
    const history = await request('chat.history', { sessionKey: key });
    expect(history.activeRun.messageTimestampMs).toBe(59000);
    expect(history.messages.find((message: any) => message.id === 'first').timestampMs).toBe(59000);
  });
  it.each([undefined, null, 0, -1, '123', Infinity, NaN, 1e20])('uses first emission when Native lifecycle start is missing or invalid: %j', async startedAtMs => {
    await start();
    notify('item/started', { turnId: 'turn-1', startedAtMs, item: { type: 'agentMessage', id: 'first', text: '' } }, 13000);
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first', delta: 'A paragraph.' }, 14000);
    expect(updates.at(-1)).toMatchObject({ timestampMs: 13000 });
  });
  it('does not enable unsafe approvals and persists before turn submission', async () => {
    mock.request.mockImplementationOnce(async () => response());
    await start();
    expect(mock.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ cwd: project, approvalPolicy: 'on-request', permissions: ':workspace', approvalsReviewer: 'user' }));
    const stored = JSON.parse(readFileSync(join(root, 'state/sessions.json'), 'utf8'));
    expect(stored.sessions[0].keys['send-1']).toHaveProperty('runId');
  });
  it('deduplicates retries and rejects conflicting content', async () => {
    const first = await start();
    expect(await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'send-1' })).toEqual(first);
    await expect(request('chat.send', { sessionKey: key, text: 'different', idempotencyKey: 'send-1' })).rejects.toThrow('different content');
    expect(mock.request.mock.calls.filter(c => c[0] === 'turn/start')).toHaveLength(1);
  });
  it('keeps whitespace deltas and ignores another turn completion', async () => {
    const run = await start(); notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'a', delta: 'hello\n ' });
    notify('turn/completed', { turn: { id: 'other', status: 'completed' } });
    expect((await request('chat.history', { sessionKey: key })).activeRun).toMatchObject({ runId: run.runId, text: 'hello\n ' });
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    expect(updates.filter(u => u.type === 'run_finished')).toHaveLength(1);
  });
  it.each(['webSearch', 'imageView'].flatMap(type => ['success', 'error'].map(status => [type, status])))('keeps status-less native %s running until completion and retains its %s result after reload', async (type, status) => {
    await start();
    // Both native item schemas omit status, including on item/started.
    const started = Object.freeze({ id: 'search', type, ...(type === 'webSearch'
      ? { query: '', action: null, results: null } : { path: 'file:///image.png' }) });
    notify('item/started', { turnId: 'turn-1', item: started });
    expect(updates.filter(u => u.type.startsWith('tool_call'))).toEqual([
      expect.objectContaining({ type: 'tool_call', toolCallId: 'search', title: type === 'webSearch' ? 'web_search' : 'view_image' }),
    ]);
    const row = (history: any) => history.messages.find((message: any) => message.id === 'toolcall_search');
    const active = await request('chat.history', { sessionKey: key });
    expect(active.hasActiveRun).toBe(true);
    expect(row(active)).toMatchObject({ tool: { callId: 'search', status: 'running' } });
    expect(started).not.toHaveProperty('status');
    const desktop = (service as any).desktop;
    desktop.broadcast = vi.fn();
    const followerRow = () => {
      const state = desktop.broadcast.mock.calls.at(-1)[1].change.conversationState;
      return row({ messages: codexMessages([state.turnHistory.history.entitiesByKey['turn:turn-1']]) });
    };
    desktop.emit('follow', threadId, true, 'desktop-tool-reader');
    await vi.waitFor(() => expect(desktop.broadcast).toHaveBeenCalled());
    expect(followerRow()).toMatchObject({ tool: { callId: 'search', status: 'running' } });
    const completed = Object.freeze({ ...started, ...(type === 'webSearch' ? { query: 'release notes', action: { type: 'search', query: 'release notes' },
      results: [{ title: 'Release notes', snippet: 'Native result', future_field: true }] } : {}), ...(status === 'error' ? { error: { message: 'Search unavailable' } } : {}) });
    notify('item/completed', { turnId: 'turn-1', item: completed });
    expect(updates.filter(u => u.type === 'tool_call_update')).toEqual([
      expect.objectContaining({ toolCallId: 'search', status }),
    ]);
    const completedRow = row(await request('chat.history', { sessionKey: key }));
    expect(completedRow).toMatchObject({ tool: { callId: 'search', status } });
    if (type === 'webSearch') expect(completedRow.tool.output).toBe(JSON.stringify(completed.results));
    expect(completed).not.toHaveProperty('status');
    desktop.emit('follow', threadId, true, 'desktop-tool-reader');
    await vi.waitFor(() => expect(followerRow()).toMatchObject({ id: completedRow.id, tool: completedRow.tool }));
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/items/list'
      ? Promise.resolve({ data: [{ turnId: 'turn-1', item: completed }] }) : original(method, params));
    const reloaded = await request('chat.history', { sessionKey: key });
    expect(reloaded.hasActiveRun).toBe(false);
    expect(row(reloaded)).toEqual(completedRow);
  });
  it.each(['webSearch', 'imageView'])('does not replace explicit future native %s completion state with success', async type => {
    await start();
    const item = Object.freeze({ id: 'future', type, status: 'future-native-state', query: '', action: { type: 'other' }, results: [{ title: 'Native result' }], path: 'file:///image.png' });
    notify('item/started', { turnId: 'turn-1', item });
    notify('item/completed', { turnId: 'turn-1', item });
    expect(updates.filter(u => u.type.startsWith('tool_call')).map(u => u.status)).toEqual(['unknown', 'unknown']);
    const history = await request('chat.history', { sessionKey: key });
    expect(history.hasActiveRun).toBe(true);
    expect(history.messages.at(-1).tool.status).toBe('unknown');
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([]);
    expect(item.status).toBe('future-native-state');
  });
  it('cancels the exact turn without claiming completion from its acknowledgement', async () => {
    const run = await start(); await request('chat.abort', { sessionKey: key, runId: run.runId });
    expect(mock.request).toHaveBeenCalledWith('turn/interrupt', { threadId, turnId: 'turn-1' });
    expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(true);
    notify('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } });
    expect(updates.at(-2)).toMatchObject({ type: 'run_finished', stopReason: 'cancelled' });
  });
  it('steers only the current run', async () => {
    const run = await start(); await expect(request('chat.steer', { sessionKey: key, runId: 'old', text: 'x' })).rejects.toThrow();
    await request('chat.steer', { sessionKey: key, runId: run.runId, text: 'do less' });
    expect(mock.request).toHaveBeenCalledWith('turn/steer', { threadId, expectedTurnId: 'turn-1', input: [{ type: 'text', text: 'do less', text_elements: [] }] });
    expect(mock.request.mock.calls.find(([method]) => method === 'turn/start')?.[1].input).toEqual([{ type: 'text', text: 'hello', text_elements: [] }]);
  });
  it('withholds reset and delete from dispatch through cancellation until native confirms the original turn ended', async () => {
    const original = mock.request.getMockImplementation()!;
    let accept!: (value: any) => void;
    mock.request.mockImplementation((method, params) => method === 'turn/start'
      ? new Promise(resolve => { accept = resolve; }) : original(method, params));
    const actions = async () => (await request('sessions.list')).find((row: any) => row.key === key).allowedActions;
    expect(await actions()).toMatchObject({ reset: true, delete: true });
    const run = await request('chat.send', { sessionKey: key, text: 'active', idempotencyKey: 'active-actions' });
    const reportedActions = () => updates.filter(update => update.type === 'session_info_update' && update.session.key === key).at(-1)?.session.allowedActions;
    expect(await actions()).toMatchObject({ reset: false, delete: false });
    expect(reportedActions()).toMatchObject({ reset: false, delete: false });
    await expect(request('sessions.reset', { sessionKey: key })).rejects.toThrow('Stop');
    await expect(request('sessions.delete', { sessionKey: key })).rejects.toThrow('Stop');
    accept({ turn: { id: 'turn-1' } }); await Promise.resolve();
    notify('turn/started', { turn: { id: 'turn-1' } });
    await request('chat.abort', { sessionKey: key, runId: run.runId });
    expect(await actions()).toMatchObject({ reset: false, delete: false });
    expect(reportedActions()).toMatchObject({ reset: false, delete: false });
    notify('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } });
    expect(await actions()).toMatchObject({ reset: true, delete: true });
    expect(reportedActions()).toMatchObject({ reset: true, delete: true });
  });

  it('rejects reset while work is running and preserves retry fingerprints after reset', async () => {
    const run = await start(); await expect(request('sessions.reset', { sessionKey: key })).rejects.toThrow('Stop');
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } }); await request('sessions.reset', { sessionKey: key });
    expect((await request('chat.history', { sessionKey: key })).messages).toEqual([]);
    expect(await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'send-1' })).toEqual(run);
  });
  it('does not allow a second owner', () => { expect(() => new CodexService({ project, directory: join(root, 'state') })).toThrow('already managed'); });
  it('maps native model reasoning levels without inventing provider choices', async () => {
    const state = await request('models.list', { sessionKey: key }); expect(state.models[0]).toMatchObject({ provider: 'custom', reasoningLevels: ['ultra'] });
    await expect(request('models.select', { sessionKey: key, scope: 'session', provider: 'other', model: 'native-model' })).rejects.toThrow('available model');
  });
  it('refreshes every picker request and follows native model pagination', async () => {
    await request('models.list', { sessionKey: key });
    const original = mock.request.getMockImplementation()!;
    let newest = 'second-page-model';
    mock.request.mockImplementation(async (method: string, params: any) => {
      if (method !== 'model/list') return original(method, params);
      expect(params.includeHidden).toBe(false);
      return params.cursor ? { data: [{ model: newest, displayName: newest }], nextCursor: null }
        : { data: [{ model: 'native-model', displayName: 'Native' }, { model: 'internal', hidden: true }], nextCursor: 'next' };
    });
    expect((await request('models.list', { sessionKey: key })).models.map((m: any) => m.id)).toEqual(['native-model', newest]);
    newest = 'newly-available-model';
    const state = await request('models.select', { sessionKey: key, scope: 'session', provider: 'custom', model: newest });
    expect(state.currentModel).toBe(newest);
    expect(state.models.map((m: any) => m.id)).toEqual(['native-model', newest]);
  });
  it.each([
    {}, { data: [null] }, { data: [{ model: '' }] }, { data: [], nextCursor: 12 },
    { data: [], nextCursor: '' }, { data: [], nextCursor: 'repeated' },
  ])('rejects malformed or looping model pages instead of returning a partial catalog: %j', async response => {
    await request('models.list', { sessionKey: key });
    mock.request.mockResolvedValue(response);
    await expect(request('models.list', { sessionKey: key })).rejects.toThrow('Invalid Codex model catalog');
  });
});
describe('native approvals', () => {
  async function approval(method = 'item/commandExecution/requestApproval', params = {}) {
    await start(); mock.instances.at(-1).emit('request', { id: 51, method, params: { threadId, turnId: 'turn-1', itemId: 'cmd', command: 'echo safe', ...params } });
    return (await request('approvals.list', { sessionKey: key }))[0].approval;
  }
  it('retains consent over disconnection, rejects broad consent and sends one native answer', async () => {
    const a = await approval(); expect(a).toMatchObject({ expiresAtMs: null, decisions: ['allow-once', 'deny'] });
    expect((await request('sessions.list')).find((row: any) => row.key === key).attention).toBe('approval');
    await expect(request('approvals.resolve', { id: a.id, decision: 'allow-always' })).rejects.toThrow();
    await request('approvals.resolve', { id: a.id, decision: 'allow-once' });
    expect(mock.respond).toHaveBeenCalledWith(51, { decision: 'accept' });
    expect((await request('sessions.list')).find((row: any) => row.key === key).attention).toBeNull();
    await expect(request('approvals.resolve', { id: a.id, decision: 'allow-once' })).rejects.toThrow('no longer');
  });
  it('retains an approval when dispatch fails', async () => {
    const a = await approval(); mock.respond.mockImplementationOnce(() => { throw Error('socket closed'); });
    await expect(request('approvals.resolve', { id: a.id, decision: 'deny' })).rejects.toThrow();
    expect(await request('approvals.list', { sessionKey: key })).toHaveLength(1);
  });
  it('clears consent only for the completed run', async () => {
    const a = await approval(); notify('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } });
    await expect(request('approvals.resolve', { id: a.id, decision: 'allow-once' })).rejects.toThrow(); expect(mock.respond).not.toHaveBeenCalled();
  });
  it('denies permissions with an empty grant, never accepting session scope', async () => {
    const a = await approval('item/permissions/requestApproval', { permissions: { network: { enabled: true } } });
    await request('approvals.resolve', { id: a.id, decision: 'deny' }); expect(mock.respond).toHaveBeenCalledWith(51, { permissions: {}, scope: 'turn' });
  });
  it('refuses unknown interactions instead of hanging or approving', async () => {
    await start(); mock.instances.at(-1).emit('request', { id: 90, method: 'unknown', params: { threadId, turnId: 'turn-1' } }); expect(mock.refuse).toHaveBeenCalledWith(90);
  });
});
it('preserves stable native IDs and actual command failures', () => {
  const messages = codexMessages([{ startedAt: 10, items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'run' }] }, { id: 'c', type: 'commandExecution', command: 'false', status: 'completed', exitCode: 1, aggregatedOutput: 'oops' }, { id: 'a', type: 'agentMessage', text: 'failed' }] }]);
  expect(messages.map(m => m.id)).toEqual(['u', 'toolcall_c', 'a']); expect(messages[1].tool).toMatchObject({ callId: 'c', status: 'error', output: 'oops' }); expect(messages[0].timestampMs).toBe(10000);
});


describe('history and recovery boundaries', () => {
  it('does not hydrate unmaterialized threads just to render an empty conversation', async () => {
    await request('models.list', { sessionKey: key });
    expect((await request('chat.history', { sessionKey: key })).messages).toEqual([]);
    expect(mock.request.mock.calls.some(c => c[0] === 'thread/read')).toBe(false);
  });
  it('uses native pagination without full-history reads and rejects malformed cursors', async () => {
    await start(); await request('chat.history', { sessionKey: key });
    expect(mock.request).toHaveBeenCalledWith('thread/read', { threadId, includeTurns: false });
    expect(mock.request).toHaveBeenCalledWith('thread/items/list', expect.objectContaining({ limit: 32, sortDirection: 'desc' }));
    await expect(request('chat.history', { sessionKey: key, cursor: 'bad' })).rejects.toThrow('cursor');
  });
  it('archives an owned native thread before deleting its local record', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await request('sessions.reset', { sessionKey: key });
    expect(mock.request).toHaveBeenCalledWith('thread/archive', { threadId });
  });
  it('retires approvals resolved by the native server', async () => {
    await start(); mock.instances.at(-1).emit('request', { id: 17, method: 'item/commandExecution/requestApproval', params: { threadId, turnId: 'turn-1', command: 'echo safe' } });
    expect(await request('approvals.list', { sessionKey: key })).toHaveLength(1);
    notify('serverRequest/resolved', { requestId: 17 });
    expect(await request('approvals.list', { sessionKey: key })).toHaveLength(0);
  });
  it('retains a proven running turn when its start acknowledgement is lost', async () => {
    let rejectStart: (e: Error) => void = () => {};
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method: string, p: object) => method === 'turn/start' ? new Promise((_r, reject) => { rejectStart = reject; }) : original(method, p));
    await start(); rejectStart(Object.assign(new Error('timeout'), { outcome: 'uncertain' })); await Promise.resolve(); await Promise.resolve();
    expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(true);
    expect(updates.some(u => u.type === 'run_finished')).toBe(false);
  });
  it('keeps inline image history without fetching arbitrary URLs', () => {
    const messages = codexMessages([{ items: [{ id: 'image', type: 'userMessage', content: [{ type: 'image', url: 'data:image/png;base64,YQ==' }, { type: 'image', url: 'https://untrusted.test/image' }] }] }]);
    expect(messages[0].attachments).toEqual([{ type: 'image', mimeType: 'image/png', content: 'YQ==' }]);
  });
});

it('recovers pending tool boundaries and streams cumulative snapshots across assistant items', async () => {
  await start();
  notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'comment', delta: 'Working.' });
  notify('item/started', { turnId: 'turn-1', item: { id: 'exec', type: 'commandExecution', command: 'printf ok', status: 'inProgress' } });
  const restored = await request('chat.history', { sessionKey: key });
  expect(restored.messages.at(-1)).toMatchObject({ id: 'toolcall_exec', tool: { name: 'exec', status: 'running' } });
  notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'final', delta: 'Done.' });
  expect(updates.at(-1)).toMatchObject({ type: 'agent_message_chunk', textMode: 'snapshot', text: 'Working.\n\nDone.' });
  notify('item/completed', { turnId: 'turn-1', item: { id: 'final', type: 'agentMessage', text: 'Done.' } });
  notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  expect(updates.find(u => u.type === 'run_finished')).toMatchObject({ message: { content: 'Done.' } });
});

it('recreates a never-submitted native thread after restart without losing its model', async () => {
  await request('models.list', { sessionKey: key });
  await service.stop(); mock.request.mockClear();
  service = new CodexService({ project, directory: join(root, 'state') });
  await request('models.list', { sessionKey: key });
  expect(mock.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ model: 'native-model' }));
  expect(mock.request.mock.calls.some(c => c[0] === 'thread/resume')).toBe(false);
});
it('changes reasoning natively without creating a chat turn and rejects unsupported levels', async () => {
  await request('models.list', { sessionKey: key });
  const selection = await request('models.thinking', { sessionKey: key, level: 'ultra' });
  expect(selection.thinkingLevel).toBe('ultra');
  expect(mock.request.mock.calls.some(c => c[0] === 'turn/start')).toBe(false);
  await expect(request('models.thinking', { sessionKey: key, level: 'bogus' })).rejects.toThrow('reasoning level');
  await start();
  expect(mock.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ effort: 'ultra' }));
});

it.each([false, true])('retains draft choices and inherits materialized native settings across restart (materialized=%s)', async materialized => {
  await request('models.thinking', { sessionKey: key, level: 'ultra' });
  if (materialized) {
    await start();
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  }
  await service.stop();
  service = new CodexService({ project, directory: join(root, 'state') });
  const nativeRequest = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (method: string, params: object) => {
    const result = await nativeRequest(method, params);
    return ['thread/start', 'thread/resume'].includes(method) ? { ...result, reasoningEffort: 'medium' } : result;
  });
  expect((await request('models.list', { sessionKey: key })).thinkingLevel).toBe(materialized ? 'medium' : 'ultra');
  await request('chat.send', { sessionKey: key, text: 'continue', idempotencyKey: 'send-after-restart' });
  await new Promise(resolve => setTimeout(resolve, 0));
  if (materialized) {
    expect(mock.request).toHaveBeenCalledWith('thread/resume', { threadId, cwd: project, excludeTurns: true });
    expect(mock.request).toHaveBeenLastCalledWith('turn/start', expect.not.objectContaining({ effort: 'ultra' }));
  } else expect(mock.request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ effort: 'ultra' }));
});

it('renames a never-submitted session after restart without referencing a missing native rollout', async () => {
  await request('models.list', { sessionKey: key });
  await service.stop(); mock.request.mockClear();
  service = new CodexService({ project, directory: join(root, 'state') });
  await request('sessions.rename', { sessionKey: key, title: 'My project' });
  expect(mock.request.mock.calls.some(c => c[0] === 'thread/name/set')).toBe(false);
  expect((await request('sessions.list'))[0].title).toBe('My project');
});

describe('structured user input', () => {
  async function ask() {
    await start();
    mock.instances.at(-1).emit('request', { id: 70, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn-1', questions: [
      { id: 'target', question: 'Which platform?', isOther: true, options: [{ label: 'Mobile', description: 'iOS and Android' }] },
      { id: 'scope', question: 'What should change?', options: null },
    ] } });
    return (await request('questions.list', { sessionKey: key }))[0];
  }
  it('keeps choices and custom input, submits all question IDs once, and rejects partial responses', async () => {
    const q = await ask(); expect(q).toMatchObject({ kind: 'form', fields: [{ id: 'target', allowCustom: true }, { id: 'scope', allowCustom: true }] });
    await expect(request('questions.respond', { sessionKey: key, questionId: q.id, answers: { target: ['Mobile'] } })).rejects.toThrow('every question');
    expect(mock.respond).not.toHaveBeenCalled();
    await request('questions.respond', { sessionKey: key, questionId: q.id, answers: { target: ['Tablet'], scope: ['Project picker'] } });
    expect(mock.respond).toHaveBeenCalledExactlyOnceWith(70, { answers: { target: { answers: ['Tablet'] }, scope: { answers: ['Project picker'] } } });
    expect(await request('questions.list', { sessionKey: key })).toEqual([]);
  });
  it('retains the whole questionnaire after a failed dispatch and clears it on authoritative resolution', async () => {
    const q = await ask(); mock.respond.mockImplementationOnce(() => { throw Error('disconnected'); });
    await expect(request('questions.respond', { sessionKey: key, questionId: q.id, answers: { target: ['Mobile'], scope: ['Continue'] } })).rejects.toThrow();
    expect(await request('questions.list', { sessionKey: key })).toHaveLength(1);
    notify('serverRequest/resolved', { requestId: 70 });
    expect(await request('questions.list', { sessionKey: key })).toEqual([]);
  });
  it('cancels the task without submitting an empty answer or pretending it has finished', async () => {
    const q = await ask(); await request('questions.respond', { sessionKey: key, questionId: q.id, cancelled: true });
    expect(mock.request).toHaveBeenCalledWith('turn/interrupt', { threadId, turnId: 'turn-1' });
    expect(mock.respond).not.toHaveBeenCalled(); expect(await request('questions.list', { sessionKey: key })).toHaveLength(1);
  });
  it('refuses malformed and secret questionnaires without crashing or leaking their content', async () => {
    await start();
    for (const q of [{ id: 's', question: 'Secret', isSecret: true }, { id: '__proto__', question: 'Invalid' }]) mock.instances.at(-1).emit('request', { id: 99, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn-1', questions: [q] } });
    expect(mock.refuse).toHaveBeenCalledTimes(2); expect(await request('questions.list', { sessionKey: key })).toEqual([]);
  });
});

describe('device project discovery and desktop routing', () => {
  async function device() {
    const { EventEmitter } = await import('node:events');
    const desktop = Object.assign(new EventEmitter(), { ready: true, snapshots: new Map(), connect: vi.fn(async () => {}), follow: vi.fn(), stop: vi.fn(), broadcast: vi.fn(), request: vi.fn(async (_method: string, _params?: object): Promise<any> => ({ result: { turn: { id: 'desktop-turn' } } })) });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'device'), device: true, env: { CODEX_HOME: root }, desktop: desktop as any });
    return desktop;
  }
  it('replays caught-up Desktop text and tools in native item order without replaying unchanged snapshots', async () => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    await request('chat.history', { sessionKey: `native:${threadId}` });
    const items = [
      { id: 'prompt', type: 'userMessage', content: [{ type: 'text', text: 'Inspect the project' }] },
      { id: 'a', type: 'agentMessage', text: 'First.' },
      { id: 'one', type: 'commandExecution', command: 'pwd', status: 'completed', exitCode: 0, aggregatedOutput: 'one' },
      { id: 'b', type: 'agentMessage', text: 'Second.' },
      { id: 'two', type: 'commandExecution', command: 'sleep 1', status: 'inProgress' },
      { id: 'c', type: 'assistantMessage', message: 'Third.' },
    ];
    const snapshot = { fresh: true, state: { turns: [{ id: 'ordered-turn', status: 'inProgress', items }], requests: [] } };
    const presentation = () => updates.filter(update => ['run_started', 'agent_message_chunk', 'tool_call', 'tool_call_update', 'run_finished'].includes(update.type));
    updates.length = 0;
    desktop.emit('snapshot', threadId, snapshot);
    expect(presentation()).toEqual([
      expect.objectContaining({ type: 'run_started', runId: 'desktop:ordered-turn' }),
      expect.objectContaining({ type: 'agent_message_chunk', text: 'First.', textMode: 'snapshot' }),
      expect.objectContaining({ type: 'tool_call', toolCallId: 'one' }),
      expect.objectContaining({ type: 'tool_call_update', toolCallId: 'one', status: 'success', rawOutput: 'one' }),
      expect.objectContaining({ type: 'agent_message_chunk', text: 'First.\n\nSecond.', textMode: 'snapshot' }),
      expect.objectContaining({ type: 'tool_call', toolCallId: 'two' }),
      expect.objectContaining({ type: 'agent_message_chunk', text: 'First.\n\nSecond.\n\nThird.', textMode: 'snapshot' }),
    ]);
    updates.length = 0;
    desktop.emit('snapshot', threadId, structuredClone(snapshot));
    expect(presentation()).toEqual([]);
    const stale = structuredClone(snapshot);
    stale.fresh = false;
    stale.state.turns[0].items[5] = { id: 'c', type: 'assistantMessage', message: 'Stale text' };
    desktop.emit('snapshot', threadId, stale);
    expect(presentation()).toEqual([]);
    const completed = { fresh: true, state: { turns: [{ id: 'ordered-turn', status: 'completed', items }], requests: [] } };
    desktop.emit('snapshot', threadId, completed);
    desktop.emit('snapshot', threadId, structuredClone(completed));
    expect(presentation()).toEqual([expect.objectContaining({ type: 'run_finished', runId: 'desktop:ordered-turn', stopReason: 'end_turn' })]);
    updates.length = 0;
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'next-turn', status: 'inProgress', items: [{ id: 'next', type: 'agentMessage', text: 'New turn.' }] }], requests: [] } });
    expect(presentation()).toEqual([
      expect.objectContaining({ type: 'run_started', runId: 'desktop:next-turn' }),
      expect.objectContaining({ type: 'agent_message_chunk', runId: 'desktop:next-turn', text: 'New turn.', textMode: 'snapshot' }),
    ]);
  });
  it('updates the current Desktop tail without temporarily replaying earlier text or tool calls', async () => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    await request('chat.history', { sessionKey: `native:${threadId}` });
    const items = [
      { id: 'a', type: 'agentMessage', text: 'Before.' },
      { id: 'one', type: 'commandExecution', command: 'pwd', status: 'inProgress' },
      { id: 'b', type: 'agentMessage', text: 'After' },
    ];
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'growing-turn', status: 'inProgress', items }], requests: [] } });
    updates.length = 0;
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'growing-turn', status: 'inProgress', items: [
      items[0], { ...items[1], status: 'completed', exitCode: 0, aggregatedOutput: 'done' }, { ...items[2], text: 'After the tool.' },
    ] }], requests: [] } });
    expect(updates.filter(update => ['agent_message_chunk', 'tool_call', 'tool_call_update'].includes(update.type))).toEqual([
      expect.objectContaining({ type: 'tool_call_update', toolCallId: 'one', status: 'success', rawOutput: 'done' }),
      expect.objectContaining({ type: 'agent_message_chunk', text: 'Before.\n\nAfter the tool.', textMode: 'snapshot' }),
    ]);
    updates.length = 0;
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'growing-turn', status: 'inProgress', items: [
      { ...items[0], text: 'Corrected before.' }, { ...items[1], status: 'completed', exitCode: 0, aggregatedOutput: 'done' }, { ...items[2], text: 'After the tool.' },
    ] }], requests: [] } });
    expect(updates.filter(update => ['agent_message_chunk', 'tool_call', 'tool_call_update'].includes(update.type))).toEqual([
      expect.objectContaining({ type: 'agent_message_chunk', text: 'Corrected before.\n\nAfter the tool.', textMode: 'snapshot' }),
    ]);
  });
  it.each(['completed', 'interrupted', 'failed'])('settles a coalesced Desktop %s turn before starting the next native turn', async status => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    await request('chat.history', { sessionKey: `native:${threadId}` });
    const first = { id: 'first-turn', status: 'inProgress', items: [
      { id: 'a', type: 'agentMessage', text: 'Before the tool.' },
      { id: 'one', type: 'commandExecution', command: 'pwd', status: 'inProgress' },
    ] };
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [first], requests: [] } });
    const completed = { ...first, status, items: [first.items[0], { ...first.items[1], status: 'completed', exitCode: 0, aggregatedOutput: 'done' },
      { id: 'b', type: 'agentMessage', text: 'After the tool.' }] };
    const second = { id: 'second-turn', status: 'inProgress', items: [
      { id: 'next', type: 'agentMessage', text: 'Second turn.' },
      { id: 'two', type: 'commandExecution', command: 'sleep 1', status: 'inProgress' },
    ] };
    const snapshot = { fresh: true, state: { turns: [completed, second], requests: [] } };
    updates.length = 0;
    desktop.emit('snapshot', threadId, { ...snapshot, fresh: false });
    expect(updates).toEqual([]);
    desktop.emit('snapshot', threadId, snapshot);
    const presentation = () => updates.filter(update => ['run_started', 'agent_message_chunk', 'tool_call', 'tool_call_update', 'run_finished'].includes(update.type));
    expect(presentation()).toEqual([
      expect.objectContaining({ type: 'tool_call_update', runId: 'desktop:first-turn', toolCallId: 'one', status: 'success' }),
      expect.objectContaining({ type: 'agent_message_chunk', runId: 'desktop:first-turn', text: 'Before the tool.\n\nAfter the tool.', textMode: 'snapshot' }),
      expect.objectContaining({ type: 'run_finished', runId: 'desktop:first-turn', stopReason: status === 'interrupted' ? 'cancelled' : status === 'failed' ? 'error' : 'end_turn' }),
      expect.objectContaining({ type: 'run_started', runId: 'desktop:second-turn' }),
      expect.objectContaining({ type: 'agent_message_chunk', runId: 'desktop:second-turn', text: 'Second turn.', textMode: 'snapshot' }),
      expect.objectContaining({ type: 'tool_call', runId: 'desktop:second-turn', toolCallId: 'two' }),
    ]);
    expect((service as any).runs.get(`native:${threadId}`)).toMatchObject({ id: 'desktop:second-turn', turnId: 'second-turn', text: 'Second turn.' });
    expect([...(service as any).runs.get(`native:${threadId}`).items.keys()]).toEqual(['next', 'two']);
    updates.length = 0;
    desktop.emit('snapshot', threadId, structuredClone(snapshot));
    expect(presentation()).toEqual([]);
    await service.stop();
    desktop.emit('snapshot', threadId, snapshot);
    expect(presentation()).toEqual([]);
    expect(desktop.request).not.toHaveBeenCalled();
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'turn/start'].includes(method))).toBe(false);
  });
  it('preserves an unconfirmed Desktop turn instead of assigning a different active turn to its run', async () => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    await request('chat.history', { sessionKey: `native:${threadId}` });
    const first = { id: 'unconfirmed-turn', status: 'inProgress', items: [{ id: 'a', type: 'agentMessage', text: 'Original turn.' }] };
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [first], requests: [] } });
    const run = (service as any).runs.get(`native:${threadId}`);
    updates.length = 0;
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [
      { ...first, status: 'unknown' }, { id: 'different-turn', status: 'inProgress', items: [{ id: 'b', type: 'agentMessage', text: 'Different turn.' }] },
    ], requests: [] } });
    expect(updates).toEqual([expect.objectContaining({ type: 'error', code: 'unsupported' })]);
    expect((service as any).runs.get(`native:${threadId}`)).toBe(run);
    expect(run).toMatchObject({ id: 'desktop:unconfirmed-turn', turnId: 'unconfirmed-turn', text: 'Original turn.' });
    expect([...run.items.keys()]).toEqual(['a']);
    expect(desktop.request).not.toHaveBeenCalled();
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'turn/start'].includes(method))).toBe(false);

  });
  it('does not index a native conversation when follow admission fails', async () => {
    const desktop = await device(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    const save = vi.spyOn(service as any, 'save');
    desktop.follow.mockImplementationOnce(() => { throw new Error('Too many active or unconfirmed desktop conversations'); });
    await expect(request('chat.history', { sessionKey: `native:${threadId}` })).rejects.toThrow('unconfirmed');
    expect(save).not.toHaveBeenCalled(); expect((service as any).records).toHaveLength(0);
    await request('chat.history', { sessionKey: `native:${threadId}` });
    expect((service as any).records).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(root, 'device', 'sessions.json'), 'utf8')).sessions).toHaveLength(1);
  });
  it('rolls back the in-memory native record when its index cannot be persisted', async () => {
    await device(); const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    const save = vi.spyOn(service as any, 'save').mockImplementationOnce(() => { throw new Error('index unavailable'); });
    await expect(request('chat.history', { sessionKey: `native:${threadId}` })).rejects.toThrow('index unavailable');
    expect((service as any).records).toHaveLength(0); save.mockRestore();
    await request('chat.history', { sessionKey: `native:${threadId}` }); expect((service as any).records).toHaveLength(1);
  });
  it('rejects a retired indexed chat before receipt at actual follow capacity and accepts only an explicit new send after capacity returns', async () => {
    const { DesktopIpc } = await vi.importActual<typeof import('./desktop-ipc.js')>('./desktop-ipc.js');
    const desktop = new DesktopIpc([]);
    const receive = (frame: object) => (desktop as any).receive(frame);
    const snapshot = (id: string, status: string) => receive({ type: 'broadcast', method: 'thread-stream-state-changed',
      version: 11, sourceClientId: 'owner', params: { hostId: 'local', conversationId: id,
        change: { type: 'snapshot', conversationState: { turns: [{ id: `turn:${id}`, status, items: [] }], requests: [] } } } });
    const write = vi.fn(frame => { if (frame.method === 'thread-owner-discovery') queueMicrotask(() => receive({ type: 'response', requestId: frame.requestId, resultType: 'success', result: {} })); });
    Object.assign(desktop, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
    vi.spyOn(desktop, 'connect').mockResolvedValue(undefined);
    const dispatch = vi.spyOn(desktop, 'request').mockImplementation(async method => method === 'thread-follower-start-turn'
      ? { result: { turn: { id: 'sent-turn' } } } : { owner: true });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'capacity'), device: true, env: { CODEX_HOME: root }, desktop });
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`;
    await request('chat.history', { sessionKey: key }); snapshot(threadId, 'completed');
    for (let i = 0; i < 64; i++) { desktop.follow(`occupied-${i}`); snapshot(`occupied-${i}`, 'inProgress'); }
    expect(desktop.snapshots.has(threadId)).toBe(false); expect((desktop as any).followed.size).toBe(64);
    const before = readFileSync(join(root, 'capacity', 'sessions.json'), 'utf8');
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'capacity-unsent' })).rejects.toThrow('unconfirmed');
      expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'capacity-unsent' })).toEqual({ status: 'unknown' });
      expect((service as any).runs.has(key)).toBe(false);
    }
    expect(readFileSync(join(root, 'capacity', 'sessions.json'), 'utf8')).toBe(before);
    expect(updates.filter(update => update.type === 'run_started')).toEqual([]);
    expect(dispatch.mock.calls.filter(([method]) => method === 'thread-follower-start-turn')).toEqual([]);
    snapshot('occupied-0', 'completed');
    await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'explicit-capacity-recovery' });
    await new Promise(resolve => setImmediate(resolve));
    expect(dispatch.mock.calls.filter(([method]) => method === 'thread-follower-start-turn')).toHaveLength(1);
    expect((service as any).runs.get(key)).toMatchObject({ desktop: true, turnId: 'sent-turn' });
    await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'explicit-capacity-recovery' });
    expect(dispatch.mock.calls.filter(([method]) => method === 'thread-follower-start-turn')).toHaveLength(1);
  });
  it('settles a repeat follow write failure after receipt without replaying the recorded key', async () => {
    const desktop = await device(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`; await request('chat.history', { sessionKey: key });
    service.on('update', update => updates.push(update));
    desktop.follow.mockReset().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('Desktop transfer is busy; refresh shortly'); });
    const sent = await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'observation-unsent' });
    await new Promise(resolve => setImmediate(resolve));
    expect((service as any).runs.has(key)).toBe(false);
    expect(updates.filter(update => update.type === 'run_finished')).toEqual([expect.objectContaining({ runId: sent.runId, stopReason: 'error' })]);
    expect(dispatches()).toHaveLength(0);
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'observation-unsent' })).toMatchObject({ status: 'recorded', runId: sent.runId });
    expect(await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'observation-unsent' })).toEqual(sent);
    expect(dispatches()).toHaveLength(0);
    await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'explicit-observation-recovery' });
    await new Promise(resolve => setImmediate(resolve)); expect(dispatches()).toHaveLength(1);
    expect(mock.request.mock.calls.filter(([method]) => ['thread/resume', 'turn/start'].includes(method))).toEqual([]);
    function dispatches() { return desktop.request.mock.calls.filter(([method]) => method === 'thread-follower-start-turn'); }
  });
  it('does not require a Desktop follow slot for a warm locally owned native conversation', async () => {
    const desktop = await device(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`;
    desktop.request.mockImplementation(async (method?: string) => {
      if (method === 'thread-owner-discovery' || method === 'thread-follower-start-turn') throw new DesktopIpcError('no-owner', 'No owner');
      return {};
    });
    await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'take-local-ownership' });
    await new Promise(resolve => setImmediate(resolve)); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    expect((service as any).loaded.has(key)).toBe(true); expect((service as any).runs.has(key)).toBe(false);
    desktop.follow.mockClear().mockImplementation(() => { throw new Error('Too many active or unconfirmed desktop conversations'); });
    desktop.request.mockClear(); mock.request.mockClear();
    await request('chat.send', { sessionKey: key, text: 'Continue locally', idempotencyKey: 'warm-local-owned' });
    await new Promise(resolve => setImmediate(resolve));
    expect(desktop.follow).not.toHaveBeenCalled(); expect(desktop.request).not.toHaveBeenCalled();
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
  });
  it('preserves an active snapshot delivered during renewed follow admission before receipt', async () => {
    const desktop = await device(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`; await request('chat.history', { sessionKey: key });
    desktop.follow.mockImplementationOnce(() => {
      const snapshot = { fresh: true, state: { turns: [{ id: 'active-owner', status: 'inProgress', items: [] }], requests: [] } };
      desktop.snapshots.set(threadId, snapshot); desktop.emit('snapshot', threadId, snapshot);
    });
    await expect(request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'active-renewal' })).rejects.toThrow('busy');
    expect((service as any).runs.get(key)).toMatchObject({ desktop: true, turnId: 'active-owner' });
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'active-renewal' })).toEqual({ status: 'unknown' });
    expect(desktop.request.mock.calls.filter(([method]) => method === 'thread-follower-start-turn')).toHaveLength(0);
  });
  it('protects unknown Desktop dispatch from idle follow reuse', async () => {
    const desktop = await device(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    desktop.request.mockImplementation(async (method?: string) => {
      if (method === 'thread-owner-discovery') return { owner: true };
      throw new DesktopIpcError('uncertain', 'Unknown dispatch');
    });
    await request('chat.send', { sessionKey: `native:${threadId}`, text: 'Continue', idempotencyKey: 'follow-uncertain' });
    await new Promise(resolve => setImmediate(resolve));
    const snapshot = { fresh: true, state: { turns: [{ id: 'previous-turn', status: 'completed' }], requests: [] } };
    desktop.snapshots.set(threadId, snapshot); desktop.emit('snapshot', threadId, snapshot);
    expect((desktop as any).followProtected(threadId)).toBe(true);
    expect((service as any).runs.get(`native:${threadId}`)).toMatchObject({ desktop: true });
    expect(mock.request.mock.calls.filter(([method]) => ['turn/start', 'thread/resume'].includes(method))).toEqual([]);
  });
  it.each(['approvals', 'questions'])('protects pending %s independently of a cached terminal snapshot', async kind => {
    const desktop = await device(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); await request('chat.history', { sessionKey: `native:${threadId}` });
    const record = (service as any).records[0];
    expect((desktop as any).followProtected(threadId)).toBe(false);
    (service as any)[kind].set('pending', { entry: record });
    expect((desktop as any).followProtected(threadId)).toBe(true);
    (service as any)[kind].clear(); expect((desktop as any).followProtected(threadId)).toBe(false);

  });
  async function followed() {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`;
    await request('chat.history', { sessionKey: key });
    return desktop;
  }
  it('completes a status-less Desktop search once, consistently with history, without completing unresolved tools or the turn', async () => {
    const desktop = await followed();
    const search = { id: 'search', type: 'webSearch', query: 'release notes', action: { type: 'search', query: 'release notes' } };
    const snapshot = { fresh: true, state: { turns: [{ id: 'turn-1', status: 'inProgress', items: [
      search,
      { id: 'running', type: 'commandExecution', status: 'inProgress', command: 'sleep 15' },
      { id: 'unknown', type: 'commandExecution', command: 'pwd' },
    ] }], requests: [] } };
    desktop.emit('snapshot', threadId, snapshot);
    expect(updates.filter(u => u.type === 'tool_call').map(u => u.toolCallId)).toEqual(['search', 'running', 'unknown']);
    const terminal = [expect.objectContaining({ type: 'tool_call_update', toolCallId: 'search', status: 'success' }),
      expect.objectContaining({ type: 'tool_call_update', toolCallId: 'unknown', status: 'unknown' })];
    expect(updates.filter(u => u.type === 'tool_call_update')).toEqual(terminal);
    desktop.emit('snapshot', threadId, snapshot);
    const history = await request('chat.history', { sessionKey: key });
    expect(history.hasActiveRun).toBe(true);
    expect(history.messages.filter((message: any) => message.role === 'tool').map((message: any) => [message.id, message.tool.status]))
      .toEqual([['toolcall_search', 'success'], ['toolcall_running', 'running'], ['toolcall_unknown', 'unknown']]);
    expect(updates.filter(u => u.type === 'tool_call')).toHaveLength(3);
    expect(updates.filter(u => u.type === 'tool_call_update')).toEqual(terminal);
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([]);
    expect(desktop.request).not.toHaveBeenCalled();
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'turn/start'].includes(method))).toBe(false);
  });
  it('recovers ten completed image views and one running command without inventing execution for unknown items', async () => {
    const desktop = await followed();
    const images = Array.from({ length: 10 }, (_, i) => ({ id: `image-${i}`, type: 'imageView', path: `file:///image-${i}.png` }));
    const publish = (status?: string) => desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'turn-1', status: 'inProgress', items: [
      ...images, { id: 'running', type: 'commandExecution', status: 'inProgress', command: 'sleep 15' },
      { id: 'unknown', type: 'mcpToolCall', tool: 'read', ...(status ? { status } : {}) },
    ] }], requests: [] } });
    publish(); publish();
    expect(updates.filter(u => u.type === 'tool_call').map(u => [u.toolCallId, u.status]))
      .toEqual([...images.map(item => [item.id, 'success']), ['running', 'running'], ['unknown', 'unknown']]);
    expect(updates.filter(u => u.type === 'tool_call_update')).toHaveLength(11);
    const active = await request('chat.history', { sessionKey: key });
    expect(active.hasActiveRun).toBe(true);
    expect(active.messages.filter((message: any) => message.tool?.status === 'running').map((message: any) => message.id)).toEqual(['toolcall_running']);
    expect(active.messages.at(-1).tool).toMatchObject({ status: 'unknown', statusReported: true });
    publish('inProgress'); publish('inProgress'); publish(); publish();
    expect(updates.filter(u => u.type === 'tool_call_update' && u.toolCallId === 'unknown').map(u => u.status)).toEqual(['unknown', 'running', 'unknown']);
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([]);
    expect(desktop.request).not.toHaveBeenCalled();
  });
  it('finishes an explicitly running Desktop search when a canonical status-less result arrives', async () => {
    const desktop = await followed();
    const snapshot = (item: any) => ({ fresh: true, state: { turns: [{ id: 'turn-1', status: 'inProgress', items: [item] }], requests: [] } });
    const search = { id: 'search', type: 'webSearch', query: 'release notes', action: { type: 'search', query: 'release notes' } };
    desktop.emit('snapshot', threadId, snapshot({ ...search, status: 'inProgress' }));
    expect(updates.filter(u => u.type === 'tool_call_update')).toEqual([]);
    expect((await request('chat.history', { sessionKey: key })).messages.at(-1).tool.status).toBe('running');
    desktop.emit('snapshot', threadId, snapshot(search));
    desktop.emit('snapshot', threadId, snapshot(search));
    expect(updates.filter(u => u.type === 'tool_call')).toHaveLength(1);
    expect(updates.filter(u => u.type === 'tool_call_update')).toEqual([
      expect.objectContaining({ toolCallId: 'search', status: 'success' }),
    ]);
    expect((await request('chat.history', { sessionKey: key })).messages.at(-1).tool.status).toBe('success');
  });
  it('keeps a canonical search Begin unknown, then completes its same row with End results and later output corrections', async () => {
    const desktop = await followed();
    const begin = { id: 'search', type: 'webSearch', query: '', action: null, results: null };
    const firstResults = [{ type: 'text_result', title: 'Result', snippet: 'First', future_field: { preserved: true } }];
    const end = { ...begin, query: 'search', action: { type: 'search', query: 'search' }, results: firstResults };
    const corrected = { ...end, results: [{ ...firstResults[0], snippet: 'Corrected' }] };
    const publish = (item: any, status = 'inProgress') => desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'turn-1', status, items: [item] }], requests: [] } });
    publish(begin); publish(begin);
    expect(updates.filter(u => u.type.startsWith('tool_call')).map(u => u.status)).toEqual(['unknown', 'unknown']);
    expect((await request('chat.history', { sessionKey: key })).messages.at(-1).tool).toMatchObject({ status: 'unknown', output: '' });
    publish(end); publish(end); publish(corrected); publish(corrected);
    expect(updates.filter(u => u.type === 'tool_call')).toHaveLength(1);
    expect(updates.filter(u => u.type === 'tool_call_update').map(u => [u.status, u.rawOutput]))
      .toEqual([['unknown', ''], ['success', JSON.stringify(firstResults)], ['success', JSON.stringify(corrected.results)]]);
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([]);
    const activeRow = (await request('chat.history', { sessionKey: key })).messages.at(-1);
    expect(activeRow.tool).toMatchObject({ status: 'success', output: JSON.stringify(corrected.results) });
    publish(corrected, 'completed');
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/items/list'
      ? Promise.resolve({ data: [{ turnId: 'turn-1', item: corrected }] }) : original(method, params));
    const cold = await request('chat.history', { sessionKey: key });
    expect(cold.hasActiveRun).toBe(false);
    expect(cold.messages.at(-1)).toEqual(activeRow);
    expect(updates.filter(u => u.type === 'run_finished')).toHaveLength(1);
    expect(desktop.request).not.toHaveBeenCalled();
  });
  it('does not turn a start-only canonical search into a completed tool during terminal/cold recovery', async () => {
    const desktop = await followed();
    const begin = { id: 'search', type: 'webSearch', query: '', action: null, results: null };
    const publish = (status: string) => desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'turn-1', status, items: [begin] }], requests: [] } });
    publish('inProgress'); publish('interrupted');
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/items/list'
      ? Promise.resolve({ data: [{ turnId: 'turn-1', item: begin }] }) : original(method, params));
    const cold = await request('chat.history', { sessionKey: key });
    expect(cold.hasActiveRun).toBe(false);
    expect(cold.messages.at(-1).tool).toMatchObject({ status: 'unknown', output: '' });
    expect(updates.filter(u => u.type === 'tool_call_update').map(u => u.status)).toEqual(['unknown']);
    expect(updates.filter(u => u.type === 'run_finished')).toHaveLength(1);
  });
  it('applies completed Desktop tool output and exit-code corrections even when native status stays unchanged', async () => {
    const desktop = await followed();
    const command = { id: 'command', type: 'commandExecution', command: 'printf result', status: 'completed', exitCode: 0, aggregatedOutput: 'partial' };
    const publish = (item: any) => desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [{ id: 'turn-1', status: 'inProgress', items: [item] }], requests: [] } });
    publish(command);
    publish({ ...command, aggregatedOutput: 'full result' });
    publish({ ...command, aggregatedOutput: 'full result', exitCode: 1 });
    publish({ ...command, aggregatedOutput: 'full result', exitCode: 1, durationMs: 10 });
    expect(updates.filter(u => u.type === 'tool_call')).toHaveLength(1);
    expect(updates.filter(u => u.type === 'tool_call_update').map(u => [u.status, u.rawOutput]))
      .toEqual([['success', 'partial'], ['success', 'full result'], ['error', 'full result']]);
    expect((await request('chat.history', { sessionKey: key })).messages.at(-1))
      .toMatchObject({ id: 'toolcall_command', tool: { status: 'error', output: 'full result' } });
  });
  it('uses the last visible native message instead of the first prompt and caches the tail', async () => {
    await device();
    const original = mock.request.getMockImplementation()!;
    let recency = 2;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/list') return Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 2, recencyAt: recency, preview: 'First prompt' }] });
      if (method === 'thread/turns/list') return Promise.resolve({ data: [
        { id: 'second', startedAt: 200, completedAt: 250, items: [{ id: 'answer', type: 'agentMessage', text: '**Latest reply**' }, { id: 'tool', type: 'commandExecution', command: 'pwd' }] },
        { id: 'first', startedAt: 100, items: [{ id: 'prompt', type: 'userMessage', content: [{ type: 'text', text: 'First prompt' }] }] },
      ] });
      return original(method, params);
    });
    expect((await request('sessions.list')).find((row: any) => row.key === `native:${threadId}`))
      .toMatchObject({ preview: 'Latest reply', lastActivityAt: 250000 });
    expect(mock.request).toHaveBeenCalledWith('thread/turns/list', expect.objectContaining({ itemsView: 'summary', limit: 3 }));
    await request('chat.history', { sessionKey: `native:${threadId}` });
    expect((await request('sessions.list')).find((row: any) => row.key === `native:${threadId}`))
      .toMatchObject({ preview: 'Latest reply', lastActivityAt: 250000 });
    await request('sessions.list');
    expect(mock.request.mock.calls.filter(([method]) => method === 'thread/turns/list')).toHaveLength(2); // one list tail, one history page
    recency = 3;
    await request('sessions.list');
    expect(mock.request.mock.calls.filter(([method]) => method === 'thread/turns/list')).toHaveLength(3);
  });
  it('continues reconciling native metadata after importing a conversation into the local index', async () => {
    await device();
    const original = mock.request.getMockImplementation()!;
    let name = 'Original native title', archived = false;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: params.archived === archived ? [{ id: threadId, cwd: project, name, updatedAt: 2 }] : [] }) : original(method, params));
    const nativeKey = `native:${threadId}`;
    await request('sessions.list');
    await request('chat.history', { sessionKey: nativeKey });
    name = 'Changed in Desktop';
    expect((await request('sessions.list'))[0]).toMatchObject({ key: nativeKey, title: name, source: 'native' });
    archived = true;
    expect((await request('sessions.archived'))[0]).toMatchObject({ key: nativeKey, title: name, archived: true });
    expect(await request('sessions.list')).toEqual([]);
    archived = false;
    expect((await request('sessions.list'))[0]).toMatchObject({ key: nativeKey, title: name, archived: false });
  });
  it('listing a native conversation never fetches its oversized tool transcript', async () => {
    await device();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/list') return { data: [{ id: threadId, cwd: project, updatedAt: 2 }] };
      if (method === 'thread/turns/list') {
        if (params.itemsView !== 'summary') {
          mock.instances.at(-1).emit('closed');
          throw new Error('Native tool transcript exceeds frame limit');
        }
        return { data: [{ id: 'last', items: [{ id: 'reply', type: 'agentMessage', text: 'Latest reply' }] }] };
      }
      return original(method, params);
    });
    expect((await request('sessions.list')).find((row: any) => row.key === `native:${threadId}`)?.preview).toBe('Latest reply');
    await expect(service.health()).resolves.toMatchObject({ backend: 'codex', modelReady: true });
  });
  it('paginates across projects, includes desktop sources and binds new chats to an opaque discovered project', async () => {
    await device(); const other = join(root, 'second'); mkdirSync(other);
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/list') return params.cursor ? { data: [{ id: randomUUID(), cwd: other, updatedAt: 1 }] } : { data: [{ id: threadId, cwd: project, updatedAt: 1 }], nextCursor: 'page-2' };
      if (method === 'thread/start') { settings = initialSettings(params.cwd); return response(params.cwd); }
      if (method === 'turn/start') return { turn: { id: 'new-turn' } }; return {};
    });
    const projects = await request('projects.list'); expect(projects).toHaveLength(2);
    const p = projects.find((p: any) => basename(p.path) === 'second');
    const created = await request('sessions.create', { projectId: p.id });
    await request('chat.send', { sessionKey: created.key, text: 'hello', idempotencyKey: 'project-send' });
    expect(mock.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ cwd: p.path }));
    expect(mock.request).toHaveBeenCalledWith('thread/list', expect.objectContaining({ sourceKinds: expect.arrayContaining(['appServer']), cursor: 'page-2' }));
    await expect(request('sessions.create', { projectId: '/etc' })).rejects.toThrow('unavailable');
  });
  it('waits for an authoritative native turn and returns the desktop response envelope', async () => {
    const desktop = await device(); key = (await request('sessions.create')).key;
    await request('models.list', { sessionKey: key });
    let accept!: (v: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    let resolved = false;
    const response = (desktop as any).handler.request('thread-follower-start-turn', { conversationId: threadId, turnStart: { request: { threadId, input: [{ type: 'text', text: 'desktop prompt' }], clientUserMessageId: 'from-desktop' } } }).then((v: any) => { resolved = true; return v; });
    await new Promise(r => setTimeout(r, 0)); expect(resolved).toBe(false);
    accept({ turn: { id: 'native-turn', status: 'inProgress', items: [] } });
    expect(await response).toEqual({ result: { turn: { id: 'native-turn', status: 'inProgress', items: [] } } });
  });
  it.each(['full', 'summary', undefined])('proves the desktop original input only from an authoritative full item window (%s)', async itemsView => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); await request('chat.history', { sessionKey: `native:${threadId}` });
    desktop.emit('snapshot', threadId, { fresh: true, state: { requests: [], turns: [{ id: 'active', status: 'inProgress', itemsView,
      items: [{ id: 'main', type: 'userMessage', content: [] }, { id: 'a', type: 'agentMessage', text: 'A' },
        { id: 'guide', type: 'userMessage', content: [] }, { id: 'b', type: 'agentMessage', text: 'B' }] }] } });
    const pair = updates.find(update => update.type === 'run_started' && update.inputMessageId);
    if (itemsView === 'full') expect(pair).toMatchObject({ turnId: 'active', inputMessageId: 'main' });
    else expect(pair).toBeUndefined();
    expect(updates.find(update => update.type === 'agent_message_chunk')).toMatchObject({ turnId: 'active',
      ...(itemsView === 'full' ? { inputMessageId: 'main' } : {}) });
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start' || method === 'thread/resume')).toBe(false);
  });

  it('restores desktop active questions and answers the exact original request', async () => {
    const desktop = await device();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); await request('chat.history', { sessionKey: `native:${threadId}` });
    desktop.emit('snapshot', threadId, { fresh: true, state: { turns: [], requests: [{ id: 9, method: 'item/tool/requestUserInput', params: { turnId: 'active', questions: [{ id: 'choice', question: 'Pick?', isOther: true, options: [{ label: 'A', description: 'First' }] }] } }], turnHistory: { kind: 'canonical', history: { entitiesByKey: { t: { turnId: 'active', status: 'inProgress', items: [] } }, islands: [{ entries: [{ key: 't', value: 't' }] }] } } } });
    const [question] = await request('questions.list', { sessionKey: `native:${threadId}` });
    expect(question.fields[0].allowCustom).toBe(true);
    await request('questions.respond', { sessionKey: `native:${threadId}`, questionId: question.id, answers: { choice: ['my own answer'] } });
    expect(desktop.request).toHaveBeenCalledWith('thread-follower-submit-user-input', { conversationId: threadId, requestId: 9, response: { answers: { choice: { answers: ['my own answer'] } } } });
    expect(mock.respond).not.toHaveBeenCalled();
  });
  it('uses the original desktop thread and never resumes a second writer after an uncertain submission', async () => {
    const desktop = await device();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list');
    desktop.request.mockImplementation(async (method: string) => {
      if (method === 'thread-owner-discovery') return {};
      throw new Error('connection interrupted');
    });
    await request('chat.send', { sessionKey: `native:${threadId}`, text: 'Continue', idempotencyKey: 'native-send' });
    await new Promise(r => setTimeout(r, 0));
    expect(desktop.request).toHaveBeenCalledWith('thread-follower-start-turn', expect.objectContaining({ conversationId: threadId }));
    expect(mock.request.mock.calls.filter(c => ['thread/resume', 'turn/start'].includes(c[0]))).toEqual([]);
    await request('chat.send', { sessionKey: `native:${threadId}`, text: 'Continue', idempotencyKey: 'native-send' });
    expect(desktop.request).toHaveBeenCalledTimes(2);
  });
  it.each(['unknown-speed', 'unknown-profile', 'writer-busy', 'unsupported-settings'])('rejects a released native %s preparation before accepting a cold send', async reason => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/list') return { data: [{ id: threadId, cwd: project, updatedAt: 1 }] };
      if (method === 'thread/resume' && reason === 'writer-busy') throw new Error('Conversation already has a native writer');
      const result = await original(method, params);
      if (method === 'thread/resume' && reason === 'unsupported-settings') delete result.approvalsReviewer;
      return result;
    });
    desktop.request.mockRejectedValue(new DesktopIpcError('no-owner', 'No owner'));
    if (reason === 'unknown-speed') mock.resumeSpeed.mockResolvedValue({ kind: 'unknown' });
    if (reason === 'unknown-profile') mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: null });
    await request('sessions.list'); key = `native:${threadId}`;
    await expect(request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'released-preflight' })).rejects.toThrow();
    expect(desktop.request).toHaveBeenCalledWith('thread-owner-discovery', { conversationId: threadId });
    expect(desktop.request.mock.calls.some(([method]) => method === 'thread-follower-start-turn')).toBe(false);
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'released-preflight' })).toEqual({ status: 'unknown' });
    expect((service as any).runs.has(key)).toBe(false);
    expect(updates.some(update => update.type === 'run_started')).toBe(false);
    expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(false);
  });
  it('preserves a live Desktop turn discovered while a cold send is being prepared', async () => {
    const desktop = await device();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    desktop.request.mockImplementation(async (method: string) => {
      if (method === 'thread-owner-discovery') {
        const snapshot = { fresh: true, state: { latestThreadSettings: settings,
          turns: [{ id: 'already-active', status: 'inProgress', items: [] }], requests: [] } };
        desktop.snapshots.set(threadId, snapshot); desktop.emit('snapshot', threadId, snapshot);
      }
      return {};
    });
    await request('sessions.list'); key = `native:${threadId}`;
    await expect(request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'discovery-became-active' })).rejects.toThrow('busy');
    expect((service as any).runs.get(key)).toMatchObject({ id: 'desktop:already-active', turnId: 'already-active', desktop: true });
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'discovery-became-active' })).toEqual({ status: 'unknown' });
    expect(desktop.request.mock.calls.some(([method]) => method === 'thread-follower-start-turn')).toBe(false);
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  });
  it.each(['unknown-speed', 'unknown-profile', 'writer-busy', 'unsupported-settings'])('settles an accepted prompt when its owner disappears and %s fails before dispatch', async reason => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    let blocked = true;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/list') return { data: [{ id: threadId, cwd: project, updatedAt: 1 }] };
      if (method === 'thread/resume' && blocked && reason === 'writer-busy') throw new Error('Conversation already has a native writer');
      const result = await original(method, params);
      if (method === 'thread/resume' && blocked && reason === 'unsupported-settings') delete result.approvalsReviewer;
      return result;
    });
    desktop.request.mockImplementation(async (method: string) => {
      if (method === 'thread-owner-discovery') return {};
      throw new DesktopIpcError('no-owner', 'No owner');
    });
    if (reason === 'unknown-speed') mock.resumeSpeed.mockResolvedValue({ kind: 'unknown' });
    if (reason === 'unknown-profile') mock.resumeSpeed.mockResolvedValue({ kind: 'native', serviceTier: null });
    await request('sessions.list'); key = `native:${threadId}`;
    const sent = await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'owner-race' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
    expect((service as any).runs.has(key)).toBe(false);
    expect(updates.filter(update => update.type === 'run_finished')).toEqual([
      expect.objectContaining({ runId: sent.runId, stopReason: 'error' }),
    ]);
    expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(false);
    expect(await request('chat.abort', { sessionKey: key, runId: sent.runId })).toEqual({ ok: true });
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'owner-race' })).toEqual({ status: 'recorded', runId: sent.runId });
    const desktopCalls = desktop.request.mock.calls.length;
    expect(await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'owner-race' })).toEqual(sent);
    expect(desktop.request).toHaveBeenCalledTimes(desktopCalls);
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);

    // Only a new explicit user send follows repaired ownership/settings; the
    // rejected prompt fingerprint never becomes an automatic replay.
    blocked = false; mock.resumeSpeed.mockResolvedValue({ kind: 'absent' });
    if (reason === 'unknown-profile') await request('models.permissions', { sessionKey: key, mode: 'workspace' });
    if (reason === 'unsupported-settings') await request('models.list', { sessionKey: key });
    await request('chat.send', { sessionKey: key, text: 'Try after repair', idempotencyKey: 'explicit-after-repair' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toEqual([
      ['turn/start', expect.objectContaining({ clientUserMessageId: 'explicit-after-repair' })],
    ]);
  });
  it.each(['uncertain', 'generic-handler-failure'])('retains unknown dispatch when an owner disappears through %s', async reason => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    desktop.request.mockImplementation(async (method: string) => {
      if (method === 'thread-owner-discovery') return {};
      throw reason === 'uncertain' ? new DesktopIpcError('uncertain', 'Acknowledgement lost') : new Error('Handler did not confirm');
    });
    await request('sessions.list'); key = `native:${threadId}`;
    const sent = await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'uncertain-owner-race' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((service as any).runs.get(key)).toMatchObject({ id: sent.runId, desktop: true });
    expect(updates.some(update => update.type === 'run_finished')).toBe(false);
    expect(mock.request.mock.calls.some(([method]) => ['thread/resume', 'turn/start'].includes(method))).toBe(false);
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'uncertain-owner-race' })).toEqual({ status: 'recorded', runId: sent.runId });
    await expect(request('chat.send', { sessionKey: key, text: 'Must not replay', idempotencyKey: 'uncertain-new-key' })).rejects.toThrow('busy');
    expect(desktop.request).toHaveBeenCalledTimes(2);
  });
  it('preserves uncertain native dispatch after a proven owner release and safe local preparation', async () => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/list') return Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] });
      if (method === 'turn/start') return Promise.reject(Object.assign(new Error('Native acknowledgement lost'), { outcome: 'uncertain' }));
      return original(method, params);
    });
    desktop.request.mockImplementation(async (method: string) => {
      if (method === 'thread-owner-discovery') return {};
      throw new DesktopIpcError('no-owner', 'No owner');
    });
    await request('sessions.list'); key = `native:${threadId}`;
    const sent = await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'native-uncertain-after-release' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((service as any).runs.get(key)).toMatchObject({ id: sent.runId, desktop: false });
    expect(updates.some(update => update.type === 'run_finished')).toBe(false);
    expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(true);
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
    expect(await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'native-uncertain-after-release' })).toEqual(sent);
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
  });
  it.each(['failed', 'completed', 'interrupted'])('reconciles a fast Desktop %s snapshot received before its start acknowledgement', async status => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`;
    let accept!: (value: unknown) => void;
    desktop.request.mockImplementation((method: string) => method === 'thread-owner-discovery'
      ? Promise.resolve({}) : new Promise(resolve => { accept = resolve; }));
    const sent = await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'fast-native-send' });
    const turn = { id: 'fast-turn', status, startedAt: 10, completedAt: 12,
      ...(status === 'failed' ? { error: { codexErrorInfo: 'unauthorized', message: 'private provider detail' } } : {}),
      items: status === 'completed' ? [{ id: 'reply', type: 'agentMessage', text: 'Done' }] : [] };
    const snapshot = { fresh: true, state: { turns: [turn], requests: [] } };
    desktop.snapshots.set(threadId, snapshot); desktop.emit('snapshot', threadId, snapshot);
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([]);
    accept({ result: { turn: { id: 'fast-turn' } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const finished = updates.filter(u => u.type === 'run_finished');
    expect(finished).toEqual([expect.objectContaining({ runId: sent.runId,
      stopReason: status === 'failed' ? 'error' : status === 'interrupted' ? 'cancelled' : 'end_turn' })]);
    if (status === 'failed') expect(finished[0].terminalMessage).toMatchObject({ id: 'codex-turn-error:fast-turn',
      text: 'Model authentication failed. Sign in again on your computer.' });
    if (status === 'completed') expect(finished[0].message).toMatchObject({ content: 'Done', timestampMs: 12000 });
    expect((service as any).runs.has(key)).toBe(false);
    desktop.emit('snapshot', threadId, snapshot);
    expect(updates.filter(u => u.type === 'run_finished')).toHaveLength(1);
    expect(desktop.request).toHaveBeenCalledTimes(2);
    expect(mock.request.mock.calls.filter(([method]) => ['thread/resume', 'turn/start'].includes(method))).toEqual([]);
    expect(JSON.stringify(finished)).not.toContain('private');
  });
  it.each(['stale', 'another-turn', 'incomplete'])('preserves an unknown Desktop outcome after start acknowledgement with %s evidence', async reason => {
    const desktop = await device();
    service.on('update', update => updates.push(update));
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`;
    let accept!: (value: unknown) => void;
    desktop.request.mockImplementation((method: string) => method === 'thread-owner-discovery'
      ? Promise.resolve({}) : new Promise(resolve => { accept = resolve; }));
    await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'unknown-native-send' });
    const snapshot = { fresh: reason !== 'stale', state: { requests: [], turns: [{
      id: reason === 'another-turn' ? 'old-turn' : 'current-turn',
      status: reason === 'incomplete' ? 'incomplete' : 'failed',
    }] } };
    desktop.snapshots.set(threadId, snapshot); desktop.emit('snapshot', threadId, snapshot);
    accept({ result: { turn: { id: 'current-turn' } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([]);
    expect((service as any).runs.get(key)).toMatchObject({ desktop: true, turnId: 'current-turn' });
    expect(desktop.request).toHaveBeenCalledTimes(2);
    expect(mock.request.mock.calls.filter(([method]) => ['thread/resume', 'turn/start'].includes(method))).toEqual([]);
  });
  it('keeps a released native thread locally owned for subsequent mobile and follower turns', async () => {
    const desktop = await device();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list' ? Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1 }] }) : original(method, params));
    await request('sessions.list'); key = `native:${threadId}`;
    desktop.request.mockRejectedValueOnce(new DesktopIpcError('no-owner', 'No owner'));
    await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'resume-once' });
    await new Promise(r => setTimeout(r, 0));
    expect(mock.request.mock.calls.filter(c => c[0] === 'thread/resume')).toHaveLength(1);
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await request('models.thinking', { sessionKey: key, level: 'ultra' });
    expect(mock.request).toHaveBeenCalledWith('thread/settings/update', { threadId, effort: 'ultra' });
    await request('chat.send', { sessionKey: key, text: 'Again', idempotencyKey: 'local-next', thinkingLevel: 'ultra' });
    await new Promise(r => setTimeout(r, 0));
    expect((desktop as any).handler.accepts('thread-owner-discovery', { conversationId: threadId })).toBe(true);
    expect(desktop.request).toHaveBeenCalledTimes(1);
    expect(mock.request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ model: 'native-model', effort: 'ultra' }));
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await (desktop as any).handler.request('thread-follower-start-turn', { conversationId: threadId, turnStart: { request: { threadId, input: [{ type: 'text', text: 'Follower' }], clientUserMessageId: 'follower-next' } } });
    expect(desktop.request).toHaveBeenCalledTimes(1);
    expect(mock.request.mock.calls.filter(c => c[0] === 'turn/start')).toHaveLength(3);
    expect((await request('sessions.list'))[0]).toMatchObject({ source: 'native', allowedActions: { rename: true, delete: false } });
  });
  it.each(['released', 'active', 'unknown'])('changes native settings only after proven released ownership: %s', async (state) => {
    const desktop = await device();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/list') return Promise.resolve({ data: [{ id: threadId, cwd: project, updatedAt: 1, model: 'native-model', modelProvider: 'custom' }] });
      if (method === 'thread/turns/list') return Promise.resolve({ data: [{ status: state === 'active' ? 'inProgress' : 'completed', items: [] }] });
      return original(method, params);
    });
    await request('sessions.list');
    desktop.request.mockRejectedValueOnce(new DesktopIpcError(state === 'unknown' ? 'uncertain' : 'no-owner', 'Not delivered'));
    const change = request('models.select', { sessionKey: `native:${threadId}`, scope: 'session', provider: 'custom', model: 'native-model' });
    if (state === 'released') {
      await change;
      expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId, excludeTurns: true }));
    } else {
      await expect(change).rejects.toThrow();
      expect(mock.request.mock.calls.filter(c => ['thread/resume', 'thread/settings/update'].includes(c[0]))).toEqual([]);
    }
  });
});

it('does not create a default chat on connect, catalog reads, deletion or restart', async () => {
  await request('sessions.delete', { sessionKey: key });
  await service.stop();
  service = new CodexService({ project, directory: join(root, 'state') });
  mock.request.mockClear();
  await service.health();
  expect(await request('sessions.list')).toEqual([]);
  expect((await request('models.list')).models).toHaveLength(1);
  expect(mock.request.mock.calls.some(c => c[0] === 'thread/start')).toBe(false);
  await expect(request('models.select', { model: 'native-model', scope: 'session' })).rejects.toThrow();
  expect(await request('sessions.list')).toEqual([]);
  const created = await request('sessions.create');
  expect(created).toMatchObject({ kind: 'direct', allowedActions: { delete: true } });
});

it('keeps a former first conversation and its history as an ordinary deletable chat', async () => {
  await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  await service.stop();
  service = new CodexService({ project, directory: join(root, 'state') });
  expect((await request('sessions.list'))[0]).toMatchObject({ key, sessionId: threadId, kind: 'direct', allowedActions: { delete: true } });
  expect((await request('chat.history', { sessionKey: key })).messages).toHaveLength(1);
  await request('sessions.delete', { sessionKey: key });
  expect(mock.request).toHaveBeenCalledWith('thread/archive', { threadId });
  expect(await request('sessions.list')).toEqual([]);
});


it('reads skills from the selected conversation project and rejects unknown scopes', async () => {
  const otherPath = join(root, 'other-project'); mkdirSync(otherPath); const other = realpathSync(otherPath);
  await service.stop();
  service = new CodexService({ project, directory: join(root, 'device-skills'), device: true });
  const nativeId = randomUUID();
  const original = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (method: string, params: any) => {
    if (method === 'thread/list') return { data: [{ id: nativeId, cwd: other, createdAt: 1, updatedAt: 1 }] };
    if (method === 'skills/list') return { data: [
      { cwd: other, skills: [{ name: 'project-only', enabled: true }] },
      { cwd: project, skills: [{ name: 'wrong-project', enabled: true }] },
    ] };
    return original(method, params);
  });
  await request('sessions.list');
  const report = await request('skills.list', { sessionKey: `native:${nativeId}` });
  expect(mock.request).toHaveBeenCalledWith('skills/list', { cwds: [other] });
  expect(report.skills.map((skill: any) => skill.name)).toEqual(['project-only']);
  expect(report.workspaceDir).toBe('other-project');
  await expect(request('skills.list', { sessionKey: 'unknown' })).rejects.toThrow('Session unavailable');
  await request('skills.list');
  expect(mock.request).toHaveBeenLastCalledWith('skills/list', { cwds: [project] });
});

describe('confirmed runtime settings and native recovery', () => {
  async function speedFixture(persist = true) {
    const native = await vi.importActual<typeof import('./resume-settings.js')>('./resume-settings.js');
    mock.resumeSpeed.mockImplementation(native.nativeResumeSpeed);
    await service.stop();
    const home = join(root, 'codex'); mkdirSync(join(home, 'sessions'), { recursive: true });
    const path = join(home, 'sessions', `rollout-qa-${threadId}.jsonl`);
    writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: project } }) + '\n');
    const env = { CODEX_HOME: home };
    service = new CodexService({ project, directory: join(root, 'state'), env });
    settings.modelProvider = 'openai';
    const original = mock.request.getMockImplementation()!;
    const event = (tier: string | null) => appendFileSync(path, JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: threadId,
      thread_settings: { cwd: project, model_provider_id: 'openai', service_tier: tier,
        approval_policy: settings.approvalPolicy, approvals_reviewer: settings.approvalsReviewer,
        active_permission_profile: settings.activePermissionProfile } } }) + '\n');
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/resume') settings.serviceTier = Object.hasOwn(params, 'serviceTier') ? params.serviceTier : 'default';
      const result = await original(method, params);
      if (method === 'model/list') result.data[0].serviceTiers = [{ id: 'priority', name: 'Fast' }];
      if (method === 'thread/read') Object.assign(result.thread, { path, modelProvider: 'openai' });
      if (method === 'thread/settings/update' && persist) event(settings.serviceTier);
      return result;
    });
    return { env, event, path };
  }
  it('retains Fast through permission changes, rename, archive/restore and a real cold-settings path', async () => {
    await speedFixture();
    await request('models.list', { sessionKey: key });
    await request('models.fast', { sessionKey: key, enabled: true });
    for (const mode of ['read-only', 'full-access']) {
      const value = await request('models.permissions', { sessionKey: key, mode });
      expect(value.fastMode.enabled).toBe(true); expect(value.permissions.mode).toBe(mode);
    }
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await request('sessions.rename', { sessionKey: key, title: 'Renamed' });
    await request('sessions.archive', { sessionKey: key, archived: true });
    await request('sessions.archive', { sessionKey: key, archived: false });
    const restored = await request('models.list', { sessionKey: key });
    expect(restored.fastMode.enabled).toBe(true); expect(restored.permissions.mode).toBe('full-access');
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId, serviceTier: 'priority' }));
    await request('chat.send', { sessionKey: key, text: 'continue', idempotencyKey: 'after-restore' });
    expect(mock.request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ threadId, serviceTier: 'priority' }));
  });
  it.each([false, true])('preserves explicitly selected Fast after Bridge restart (native settings event=%s)', async persist => {
    const fixture = await speedFixture(persist);
    await request('models.list', { sessionKey: key }); await request('models.fast', { sessionKey: key, enabled: true });
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state'), env: fixture.env });
    expect((await request('models.list', { sessionKey: key })).fastMode.enabled).toBe(true);
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ serviceTier: 'priority' }));
  });
  it('retains a confirmed Fast choice when recreating an unsent draft after restart', async () => {
    const fixture = await speedFixture(false);
    await request('models.list', { sessionKey: key }); await request('models.fast', { sessionKey: key, enabled: true });
    await service.stop(); settings.serviceTier = 'default';
    service = new CodexService({ project, directory: join(root, 'state'), env: fixture.env }); mock.request.mockClear();
    expect((await request('models.list', { sessionKey: key })).fastMode.enabled).toBe(true);
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume')).toBe(false);
    expect(mock.request).toHaveBeenCalledWith('thread/settings/update', { threadId, serviceTier: 'priority' });
  });
  it('honors a newer native Standard setting over a saved Bridge Fast preference', async () => {
    const fixture = await speedFixture();
    await request('models.list', { sessionKey: key }); await request('models.fast', { sessionKey: key, enabled: true });
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); fixture.event('default');
    service = new CodexService({ project, directory: join(root, 'state'), env: fixture.env });
    expect((await request('models.list', { sessionKey: key })).fastMode.enabled).toBe(false);
    expect(mock.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ serviceTier: 'default' }));
  });
  it('refuses to overwrite uncertain native settings with a cached speed preference', async () => {
    const fixture = await speedFixture(false);
    await request('models.list', { sessionKey: key }); await request('models.fast', { sessionKey: key, enabled: true });
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); rmSync(fixture.path);
    service = new CodexService({ project, directory: join(root, 'state'), env: fixture.env }); mock.request.mockClear();
    await expect(request('models.list', { sessionKey: key })).rejects.toThrow('speed setting cannot be verified');
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume')).toBe(false);
  });
  it.each([false, true])('does not silently clear unknown native speed settings without a cached preference (imported=%s)', async imported => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') });
    (service as any).records[0].native = imported;
    mock.resumeSpeed.mockResolvedValue({ kind: 'unknown' }); mock.request.mockClear();
    await expect(request('models.list', { sessionKey: key })).rejects.toThrow('speed setting cannot be verified');
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume')).toBe(false);
  });
  it('waits for effective settings before exposing Fast mode or accepting the next send', async () => {
    settings.modelProvider = 'openai';
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'model/list') { const result = await original(method, params); result.data[0].serviceTiers = [{ id: 'fast', name: 'Fast' }]; return result; }
      return original(method, params);
    });
    await request('models.list', { sessionKey: key });
    const native = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/settings/update' ? Promise.resolve({}) : native(method, params));
    let settled = false;
    const selected = request('models.fast', { sessionKey: key, enabled: true }).then(value => { settled = true; return value; });
    const sent = request('chat.send', { sessionKey: key, text: 'after settings', idempotencyKey: 'after-settings' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false); expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
    settings.serviceTier = 'fast'; notify('thread/settings/updated', { threadSettings: settings });
    expect((await selected).fastMode).toEqual({ enabled: true, available: true });
    await sent; expect(mock.request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ serviceTier: 'fast' }));
  });
  it('does not advertise Fast for a custom provider with a shared model catalog', async () => {
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method, params) => {
      const result = await original(method, params);
      if (method === 'model/list') result.data[0].serviceTiers = [{ id: 'fast', name: 'Fast' }];
      return result;
    });
    expect((await request('models.list', { sessionKey: key })).fastMode.available).toBe(false);
    await expect(request('models.fast', { sessionKey: key, enabled: true })).rejects.toThrow('provider');
  });
  it('keeps conservative creation permissions and applies full access only after explicit choice', async () => {
    const state = await request('models.list', { sessionKey: key });
    expect(state.permissions).toMatchObject({ mode: 'workspace', available: true, scope: 'session' });
    expect((await request('models.permissions', { sessionKey: key, mode: 'full-access' })).permissions.mode).toBe('full-access');
    expect(mock.request).toHaveBeenCalledWith('thread/settings/update', { threadId, approvalPolicy: 'never', approvalsReviewer: 'user', permissions: ':danger-full-access' });
    expect((await request('models.permissions', { sessionKey: key, mode: 'read-only' })).permissions.mode).toBe('read-only');
    await expect(request('models.permissions', { sessionKey: key, mode: 'custom' })).rejects.toThrow('supported');
  });
  it('keeps native restrictions visible and never reports a refused permission grant as success', async () => {
    await request('models.list', { sessionKey: key });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/settings/update'
      ? Promise.reject(Object.assign(new Error('Managed configuration rejected this operation'), { outcome: 'rejected' })) : original(method, params));
    await expect(request('models.permissions', { sessionKey: key, mode: 'full-access' })).rejects.toThrow('Managed');
    expect((await request('models.list', { sessionKey: key })).permissions.mode).toBe('workspace');
  });
  it('does not await a notification for an already confirmed identical value', async () => {
    await request('models.list', { sessionKey: key }); mock.request.mockClear();
    await request('models.permissions', { sessionKey: key, mode: 'workspace' });
    expect(mock.request.mock.calls.some(([method]) => method === 'thread/settings/update')).toBe(false);
  });
  it('confirms native mode presets and publishes their actual settings to Desktop followers', async () => {
    await request('models.list', { sessionKey: key });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/settings/update' && params.collaborationMode?.settings.developer_instructions === null) {
        const mode = params.collaborationMode;
        return original(method, { ...params, collaborationMode: { ...mode, settings: { ...mode.settings, developer_instructions: `Native ${mode.mode} preset` } } });
      }
      return original(method, params);
    });
    const broadcast = vi.spyOn((service as any).desktop, 'broadcast');
    for (const mode of ['plan', 'default']) {
      const collaborationMode = { mode, settings: { model: 'native-model', reasoning_effort: null, developer_instructions: null } };
      expect(await (service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId, threadSettings: { collaborationMode } })).toEqual({ ok: true, applied: true });
      await (service as any).publishDesktop(threadId);
      expect(broadcast.mock.calls.at(-1)?.[1]).toMatchObject({ change: { conversationState: { latestThreadSettings: {
        collaborationMode: { mode, settings: { model: 'native-model', reasoning_effort: null, developer_instructions: `Native ${mode} preset` } },
        approvalPolicy: 'on-request', serviceTier: null,
      } } } });
    }
  });
  it('accepts Desktop named permission profiles only after native effective confirmation', async () => {
    await request('models.list', { sessionKey: key });
    expect(await (service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
      threadSettings: { permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' } })).toMatchObject({ applied: true });
    expect((await request('models.list', { sessionKey: key })).permissions.mode).toBe('read-only');
    expect(mock.request).toHaveBeenCalledWith('thread/settings/update', expect.objectContaining({ threadId, permissions: ':read-only' }));
  });
  it('honors native Desktop conditional settings inside the serialized operation', async () => {
    await request('models.list', { sessionKey: key }); mock.request.mockClear();
    const update = (condition: object) => (service as any).desktopRequest('thread-follower-update-thread-settings', {
      conversationId: threadId, threadSettings: { effort: 'high' }, condition });
    expect(await update({ ifEffortEquals: 'low', ifModelEquals: 'native-model' })).toMatchObject({ applied: false });
    expect(await update({ ifEffortEquals: null, ifModelEquals: 'another-model' })).toMatchObject({ applied: false });
    expect(mock.request).not.toHaveBeenCalled();
    expect(await update({ ifEffortEquals: null, ifModelEquals: 'native-model' })).toMatchObject({ applied: true });
    expect((await request('models.list', { sessionKey: key })).thinkingLevel).toBe('high');
  });
  it.each([{}, [], { ifEffortEquals: 1 }, { ifEffortEquals: null, ifModelEquals: false }, { ifEffortEquals: null, futureCondition: true }])('refuses unsupported Desktop settings conditions before dispatch: %j', async condition => {
    await request('models.list', { sessionKey: key }); mock.request.mockClear();
    await expect((service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
      threadSettings: { effort: 'high' }, condition })).rejects.toThrow('Unsupported settings condition');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('does not apply a stale active-turn settings request to the next turn', async () => {
    await request('models.list', { sessionKey: key }); mock.request.mockClear();
    await expect((service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
      threadSettings: { permissions: ':danger-full-access' }, activeTurnId: 'old-turn' })).rejects.toThrow('Active task settings');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it.each([null, {}, '', ['workspace']])('refuses malformed Desktop named profiles before dispatch: %j', async permissions => {
    await request('models.list', { sessionKey: key }); mock.request.mockClear();
    await expect((service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId,
      threadSettings: { permissions } })).rejects.toThrow('Unsupported permissions');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('does not silently drop named permissions supplied by a Desktop start-turn', async () => {
    await request('models.list', { sessionKey: key }); mock.request.mockClear();
    await (service as any).desktopRequest('thread-follower-start-turn', { conversationId: threadId, turnStart: { request: {
      threadId, input: [{ type: 'text', text: 'Use the requested profile' }], permissions: ':read-only', clientUserMessageId: 'desktop-profile-turn',
    } } });
    expect(mock.request).toHaveBeenCalledWith('thread/settings/update', expect.objectContaining({ permissions: ':read-only' }));
    expect((service as any).effectiveSettings.get(key).sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
    const methods = mock.request.mock.calls.map(([method]) => method);
    expect(methods.indexOf('thread/settings/update')).toBeLessThan(methods.indexOf('turn/start'));
  });
  it('keeps a Desktop read-only override and its turn atomic against a queued phone Full access change', async () => {
    await request('models.list', { sessionKey: key });
    const original = mock.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let effectiveAtStart: string | undefined;
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/settings/update' && params.permissions === ':read-only') await gate;
      if (method === 'turn/start') effectiveAtStart = settings.activePermissionProfile.id;
      return original(method, params);
    });
    const desktop = (service as any).desktopRequest('thread-follower-start-turn', { conversationId: threadId, turnStart: { request: {
      threadId, input: [{ type: 'text', text: 'Use read-only for this turn' }], permissions: ':read-only', clientUserMessageId: 'desktop-atomic-profile',
    } } });
    await new Promise(resolve => setImmediate(resolve));
    const phone = request('models.permissions', { sessionKey: key, mode: 'full-access' }).catch(error => error);
    release(); await desktop;
    expect(effectiveAtStart).toBe(':read-only');
    expect(await phone).toBeInstanceOf(Error);
    expect(settings.activePermissionProfile.id).toBe(':read-only');
  });
  it('keeps newer native readback after a mismatched settings timeout without reporting the write as applied', async () => {
    await request('models.list', { sessionKey: key });
    vi.useFakeTimers();
    try {
      const row = (service as any).records[0];
      const attempt = (service as any).confirmedSettings(row, { effort: 'high' }, async () => {
        settings = { ...settings, effort: 'low', collaborationMode: { ...settings.collaborationMode, settings: { ...settings.collaborationMode.settings, reasoning_effort: 'low' } } };
        notify('thread/settings/updated', { threadSettings: settings });
      });
      const rejected = expect(attempt).rejects.toThrow('not confirmed');
      await vi.advanceTimersByTimeAsync(10000); await rejected;
      mock.request.mockClear();
      expect((await request('models.list', { sessionKey: key })).thinkingLevel).toBe('low');
      expect(mock.request.mock.calls.some(([method]) => method === 'thread/resume')).toBe(false);
      const broadcast = vi.spyOn((service as any).desktop, 'broadcast');
      await (service as any).publishDesktop(threadId);
      expect(broadcast.mock.calls.at(-1)?.[1]).toMatchObject({ change: { conversationState: { latestThreadSettings: { effort: 'low' } } } });
    } finally { vi.useRealTimers(); }
  });
  it('dispatches same-mode null instructions instead of treating cached custom instructions as the preset', async () => {
    settings.collaborationMode.settings.developer_instructions = 'Custom instructions';
    await request('models.list', { sessionKey: key });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/settings/update') return original(method, { ...params,
        collaborationMode: { ...params.collaborationMode, settings: { ...params.collaborationMode.settings, developer_instructions: 'Native default preset' } } });
      return original(method, params);
    });
    mock.request.mockClear();
    const collaborationMode = { ...settings.collaborationMode, settings: { ...settings.collaborationMode.settings, developer_instructions: null } };
    expect(await (service as any).desktopRequest('thread-follower-update-thread-settings', { conversationId: threadId, threadSettings: { collaborationMode } })).toMatchObject({ applied: true });
    expect(mock.request).toHaveBeenCalledWith('thread/settings/update', { threadId, collaborationMode });
    expect((service as any).effectiveSettings.get(key).collaborationMode.settings.developer_instructions).toBe('Native default preset');
  });
  it('retains an authoritative notification when its settings RPC acknowledgement is lost', async () => {
    await request('models.list', { sessionKey: key });
    const row = (service as any).records[0];
    await expect((service as any).confirmedSettings(row, { effort: 'high' }, async () => {
      settings = { ...settings, effort: 'high' };
      notify('thread/settings/updated', { threadSettings: settings });
      throw new DesktopIpcError('uncertain', 'Acknowledgement lost');
    })).rejects.toThrow('Acknowledgement lost');
    expect((service as any).effectiveSettings.get(key).effort).toBe('high');
  });
  it('invalidates the old settings when no authoritative notification follows an uncertain write', async () => {
    await request('models.list', { sessionKey: key });
    const row = (service as any).records[0];
    await expect((service as any).confirmedSettings(row, { effort: 'high' }, async () => {
      throw new DesktopIpcError('uncertain', 'Acknowledgement lost');
    })).rejects.toThrow('Acknowledgement lost');
    expect((service as any).effectiveSettings.has(key)).toBe(false);
  });
  it('keeps unknown task state across native loss and only finishes after a native terminal record', async () => {
    await start(); mock.instances.at(-1).emit('closed');
    expect(updates.some(u => u.type === 'run_finished')).toBe(false);
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/turns/list'
      ? Promise.resolve({ data: [{ id: 'turn-1', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: 'Finished natively' }] }] }) : original(method, params));
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    try { await service.health(); } finally { now.mockRestore(); }
    expect(mock.instances).toHaveLength(2);
    expect(updates.filter(u => u.type === 'run_finished')).toEqual([expect.objectContaining({ stopReason: 'end_turn' })]);
    expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
  });
  it('queries durable prompt receipts after a lost response without sending or resuming', async () => {
    const sent = await start();
    await service.stop(); service = new CodexService({ project, directory: join(root, 'state') }); mock.request.mockClear();
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'send-1' })).toEqual({ status: 'recorded', runId: sent.runId });
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'missing' })).toEqual({ status: 'unknown' });
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: '__proto__' })).toEqual({ status: 'unknown' });
    expect(mock.request).not.toHaveBeenCalled();
  });
});

describe('native session management', () => {
  it('archives and restores a native thread without changing its identity', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await request('sessions.archive', { sessionKey: key, archived: true });
    expect(mock.request).toHaveBeenCalledWith('thread/archive', { threadId });
    expect(await request('sessions.list')).toEqual([]);
    expect((await request('sessions.archived'))[0]).toMatchObject({ key, sessionId: threadId, archived: true, allowedActions: { archive: true } });
    await expect(request('chat.send', { sessionKey: key, text: 'wrong', idempotencyKey: 'archived' })).rejects.toThrow('Restore');
    await request('sessions.archive', { sessionKey: key, archived: false });
    expect(mock.request).toHaveBeenCalledWith('thread/unarchive', { threadId });
    expect((await request('sessions.list'))[0]).toMatchObject({ key, sessionId: threadId, archived: false });
  });
  it('retains metadata when native rename/archive fails', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => ['thread/name/set', 'thread/archive'].includes(method)
      ? Promise.reject(new Error('Native operation failed')) : original(method, params));
    await expect(request('sessions.rename', { sessionKey: key, title: 'New title' })).rejects.toThrow('Native');
    await expect(request('sessions.archive', { sessionKey: key, archived: true })).rejects.toThrow('Native');
    expect((await request('sessions.list'))[0]).toMatchObject({ title: 'hello', archived: false });
  });
  it('converges external native rename, archive and restore without changing receipts or settings', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    const before = JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0];
    let archived = false;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: params.archived === archived ? [{ id: threadId, cwd: project, name: 'Desktop title', updatedAt: 2 }] : [] })
      : original(method, params));
    expect((await request('sessions.list'))[0]).toMatchObject({ key, title: 'Desktop title', archived: false, sessionId: threadId });
    archived = true;
    // A normal active refresh must notice the external archive before Archived is opened.
    expect(await request('sessions.list')).toEqual([]);
    expect((await request('sessions.archived'))[0]).toMatchObject({ key, title: 'Desktop title', archived: true, sessionId: threadId });
    archived = false;
    expect((await request('sessions.list'))[0]).toMatchObject({ key, archived: false, sessionId: threadId });
    expect(await request('sessions.archived')).toEqual([]);
    const after = JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0];
    expect(after).toEqual({ ...before, title: 'Desktop title', archived: false });
    expect(mock.request.mock.calls.filter(([method]) => ['thread/name/set', 'thread/archive', 'thread/unarchive'].includes(method))).toEqual([]);
  });
  it('checks missing native archives with one shared two-page budget across projects', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const secondId = randomUUID(), thirdId = randomUUID();
    const secondCwd = join(root, 'second'), thirdCwd = join(root, 'third');
    mkdirSync(secondCwd); mkdirSync(thirdCwd);
    const records = (service as any).records;
    records.push({ ...records[0], id: 'second', threadId: secondId, cwd: secondCwd, keys: {} },
      { ...records[0], id: 'third', threadId: thirdId, cwd: thirdCwd, keys: {} });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method !== 'thread/list') return original(method, params);
      if (!params.archived) return Promise.resolve({ data: [] });
      return Promise.resolve(params.cursor ? { data: [{ id: secondId, cwd: secondCwd, name: 'Second archived' }], nextCursor: 'third-page' }
        : { data: [{ id: threadId, cwd: project, name: 'First archived' }], nextCursor: 'second-page' });
    });
    const rows = await request('sessions.list');
    expect(rows.map((row: any) => row.key)).toEqual(['third']);
    const checks = mock.request.mock.calls.filter(([method, params]) => method === 'thread/list' && params.archived);
    expect(checks).toHaveLength(2);
    expect(checks[0][1]).toMatchObject({ cwd: [project, secondCwd, thirdCwd], limit: 100 });
    expect(checks[1][1]).toMatchObject({ cwd: [project, secondCwd, thirdCwd], limit: 100, cursor: 'second-page' });
    expect(records.find((row: any) => row.id === 'third').archived).not.toBe(true);
  });
  it('discards a failed conditional archive check instead of applying an earlier partial page', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const records = (service as any).records;
    records.push({ ...records[0], id: 'second', threadId: randomUUID(), keys: {} });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method !== 'thread/list') return original(method, params);
      if (!params.archived) return Promise.resolve({ data: [] });
      return params.cursor ? Promise.reject(new Error('Archive page unavailable'))
        : Promise.resolve({ data: [{ id: threadId, cwd: project, name: 'Unconfirmed' }], nextCursor: 'fail' });
    });
    expect((await request('sessions.list')).map((row: any) => row.key)).toEqual([key, 'second']);
    expect(records[0]).toMatchObject({ title: 'hello' });
    expect(records[0].archived).not.toBe(true);
  });
  it('bounds negative archive evidence to 30 seconds and invalidates it for management and candidate changes', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const checks = () => mock.request.mock.calls.filter(([method, params]) => method === 'thread/list' && params.archived).length;
    try {
      await request('sessions.list'); expect(checks()).toBe(1);
      await request('sessions.list'); expect(checks()).toBe(1);
      clock.mockReturnValue(now + 30_001); await request('sessions.list'); expect(checks()).toBe(2);
      await request('sessions.rename', { sessionKey: key, title: 'Changed' });
      await request('sessions.list'); expect(checks()).toBe(3);
      const records = (service as any).records;
      records.push({ ...records[0], id: 'new-candidate', threadId: randomUUID(), keys: {} });
      await request('sessions.list'); expect(checks()).toBe(4);
      records[1].threadId = randomUUID();
      await request('sessions.list'); expect(checks()).toBe(5);
    } finally { clock.mockRestore(); }
  });
  it('continues a bounded archive lookup after the negative cache expires without starving older matches', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method !== 'thread/list') return original(method, params);
      if (!params.archived) return Promise.resolve({ data: [] });
      return Promise.resolve(params.cursor === 'older' ? { data: [{ id: threadId, cwd: project, name: 'Old archived thread' }] }
        : { data: [], nextCursor: params.cursor ? 'older' : 'next' });
    });
    try {
      expect((await request('sessions.list'))[0].key).toBe(key);
      expect(mock.request.mock.calls.filter(([method, params]) => method === 'thread/list' && params.archived)).toHaveLength(2);
      clock.mockReturnValue(now + 30_001);
      expect(await request('sessions.list')).toEqual([]);
      expect(mock.request).toHaveBeenCalledWith('thread/list', expect.objectContaining({ archived: true, cursor: 'older' }));
    } finally { clock.mockRestore(); }
  });
  it('does not scan archives for an unmaterialized draft, a running task or a native active member', async () => {
    await request('models.list', { sessionKey: key });
    await request('sessions.list');
    await start(); await request('sessions.list');
    notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, name: 'Active' }] }) : original(method, params));
    await request('sessions.list');
    expect(mock.request.mock.calls.filter(([method, params]) => method === 'thread/list' && params.archived)).toEqual([]);
  });
  it('does not apply an in-flight missing-archive result over a later native restore', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    let resolveArchive!: (value: any) => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    mock.request.mockImplementation((method, params) => {
      if (method !== 'thread/list') return original(method, params);
      if (params.archived) return new Promise(resolve => { resolveArchive = resolve; entered(); });
      return Promise.resolve({ data: [] });
    });
    const listing = request('sessions.list'); await waiting;
    await request('sessions.archive', { sessionKey: key, archived: false });
    resolveArchive({ data: [{ id: threadId, cwd: project, name: 'Old archive' }] });
    expect((await listing)[0]).toMatchObject({ key, title: 'hello', archived: false });
  });
  it.each([undefined, null, '', '   '])('does not replace a local label with absent native name %s or first-prompt text', async name => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await request('sessions.rename', { sessionKey: key, title: 'My label' });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, name, preview: 'First prompt', updatedAt: 2 }] }) : original(method, params));
    expect((await request('sessions.list'))[0].title).toBe('My label');
  });
  it('does not infer archive or removal from absence, or trust metadata from another project', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    expect((await request('sessions.list'))[0]).toMatchObject({ key, title: 'hello', archived: false });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: join(root, 'foreign'), name: 'Wrong project', updatedAt: 2 }] }) : original(method, params));
    expect(await request('sessions.archived')).toEqual([]);
    expect((await request('sessions.list'))[0]).toMatchObject({ key, title: 'hello', archived: false });
  });
  it('keeps an active run and native settings while refreshing only its title', async () => {
    const sent = await start();
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, name: 'New native title', model: 'Different model', updatedAt: 2 }] }) : original(method, params));
    expect((await request('sessions.list'))[0]).toMatchObject({ key, title: 'New native title', hasActiveRun: true, model: 'native-model' });
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'send-1' })).toEqual({ status: 'recorded', runId: sent.runId });
    expect((await request('models.list', { sessionKey: key })).permissions.mode).toBe('workspace');
  });
  it('waits for every native catalog page before reconciling metadata and discards failed scans', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    let fail = true;
    mock.request.mockImplementation((method, params) => {
      if (method !== 'thread/list') return original(method, params);
      if (!params.cursor) return Promise.resolve({ data: [{ id: threadId, cwd: project, name: 'Paged title', updatedAt: 2 }], nextCursor: 'page-2' });
      return fail ? Promise.reject(new Error('Page unavailable')) : Promise.resolve({ data: [] });
    });
    await expect(request('sessions.list')).rejects.toThrow('Page unavailable');
    expect(JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0].title).toBe('hello');
    fail = false;
    expect((await request('sessions.list'))[0].title).toBe('Paged title');
  });
  it.each(['before', 'during'] as const)('does not apply a catalog started %s a rename over its confirmed result', async timing => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    let finishList!: (value: any) => void, finishRename!: (value: any) => void;
    let listEntered!: () => void, renameEntered!: () => void;
    const listed = new Promise<void>(resolve => { listEntered = resolve; });
    const renamed = new Promise<void>(resolve => { renameEntered = resolve; });
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/list') return new Promise(resolve => { finishList = resolve; listEntered(); });
      if (method === 'thread/name/set') return new Promise(resolve => { finishRename = resolve; renameEntered(); });
      return original(method, params);
    });
    let listing: Promise<any>, renaming: Promise<any>;
    if (timing === 'before') { listing = request('sessions.list'); await listed; renaming = request('sessions.rename', { sessionKey: key, title: 'Confirmed title' }); await renamed; }
    else { renaming = request('sessions.rename', { sessionKey: key, title: 'Confirmed title' }); await renamed; listing = request('sessions.list'); await listed; }
    finishRename({}); await renaming;
    finishList({ data: [{ id: threadId, cwd: project, name: 'Old title', updatedAt: 2 }] });
    expect((await listing)[0]).toMatchObject({ key, title: 'Confirmed title' });
  });
  it('does not publish stale native metadata while a rename is still awaiting confirmation', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    let finishList!: (value: any) => void, finishRename!: (value: any) => void;
    let listEntered!: () => void, renameEntered!: () => void;
    const listed = new Promise<void>(resolve => { listEntered = resolve; });
    const renamed = new Promise<void>(resolve => { renameEntered = resolve; });
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/list') return new Promise(resolve => { finishList = resolve; listEntered(); });
      if (method === 'thread/name/set') return new Promise(resolve => { finishRename = resolve; renameEntered(); });
      return original(method, params);
    });
    const listing = request('sessions.list'); await listed;
    const renaming = request('sessions.rename', { sessionKey: key, title: 'Confirmed title' }); await renamed;
    finishList({ data: [{ id: threadId, cwd: project, name: 'Stale native title', updatedAt: 2 }] });
    expect((await listing)[0]).toMatchObject({ key, title: 'hello' });
    finishRename({}); await renaming;
    expect(JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0].title).toBe('Confirmed title');
  });
  it('ignores a delayed archived page after a newer active catalog has confirmed the same thread', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    let finishArchived!: (value: any) => void, archiveEntered!: () => void;
    const entered = new Promise<void>(resolve => { archiveEntered = resolve; });
    mock.request.mockImplementation((method, params) => {
      if (method !== 'thread/list') return original(method, params);
      if (params.archived) return new Promise(resolve => { finishArchived = resolve; archiveEntered(); });
      return Promise.resolve({ data: [{ id: threadId, cwd: project, name: 'Restored title', updatedAt: 2 }] });
    });
    const archived = request('sessions.archived'); await entered;
    expect((await request('sessions.list'))[0]).toMatchObject({ key, title: 'Restored title', archived: false });
    finishArchived({ data: [{ id: threadId, cwd: project, name: 'Archived old title', updatedAt: 1 }] });
    expect(await archived).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, 'state', 'sessions.json'), 'utf8')).sessions[0]).toMatchObject({ title: 'Restored title', archived: false });
  });
  it.each(['sessions.archive', 'sessions.reset', 'sessions.delete'].flatMap(method => [false, true].map(partial => ({ method, partial }))))(
    'does not resurrect a stale active row after $method (partial=$partial)', async ({ method, partial }) => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((operation, params) => operation === 'thread/list'
      ? Promise.resolve({ data: [{ id: threadId, cwd: project, name: 'hello', updatedAt: 1 }] }) : original(operation, params));
    await request('sessions.list');
    let finishList!: (value: any) => void, listEntered!: () => void;
    const entered = new Promise<void>(resolve => { listEntered = resolve; });
    mock.request.mockImplementation((operation, params) => operation === 'thread/list'
      ? new Promise(resolve => { finishList = resolve; listEntered(); }) : original(operation, params));
    const listing = request('sessions.list'); await entered;
    await request(method, { sessionKey: key, archived: true });
    finishList({ data: [{ id: threadId, cwd: project, name: 'Stale title', updatedAt: 2 }, ...(partial ? [{ id: 'malformed' }] : [])] });
    const rows = await listing;
    if (method === 'sessions.reset') expect(rows).toEqual([expect.objectContaining({ key, sessionId: undefined, title: 'hello' })]);
    else expect(rows).toEqual([]);
    if (method !== 'sessions.archive') await expect(request('chat.history', { sessionKey: `native:${threadId}` })).rejects.toThrow('Session unavailable');
  });
  it('converges a lost archive acknowledgement through a later native list without repeating the mutation', async () => {
    await start(); notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    const original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/archive') return Promise.reject(Object.assign(new Error('Acknowledgement lost'), { outcome: 'uncertain' }));
      if (method === 'thread/list') return Promise.resolve({ data: params.archived ? [{ id: threadId, cwd: project, name: 'Native title', updatedAt: 2 }] : [] });
      return original(method, params);
    });
    await expect(request('sessions.archive', { sessionKey: key, archived: true })).rejects.toThrow('Acknowledgement lost');
    expect((await request('sessions.archived'))[0]).toMatchObject({ key, archived: true, title: 'Native title' });
    expect(await request('sessions.list')).toEqual([]);
    expect(mock.request.mock.calls.filter(([method]) => method === 'thread/archive')).toHaveLength(1);
  });
});

it('uses only the exact native client ID for prompt reconciliation', () => {
  const messages = codexMessages([{ items: [
    { id: 'u', type: 'userMessage', clientId: 'exact-id', content: [{ type: 'text', text: 'hello' }] },
    { id: 'u2', type: 'userMessage', content: [{ type: 'text', text: 'hello' }] },
  ] }]);
  expect(messages[0].idempotencyKey).toBe('exact-id');
  expect(messages[1].idempotencyKey).toBeUndefined();
});

it('serves Codex assistant attachments with the native thread project and rejects cross-session reads', async () => {
  await start(); writeFileSync(join(project, 'report.txt'), 'Codex attachment');
  const original = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (method: string, params: any) => method === 'thread/items/list'
    ? { data: [{ turnId: 'turn-1', item: { id: 'reply', type: 'agentMessage', text: '[Report](report.txt)' } }] }
    : original(method, params));
  const history = await request('chat.history', { sessionKey: key });
  const artifactId = history.messages[0].attachments[0].artifactId;
  const file = await request('clawket.artifacts.open', { sessionKey: key, artifactId });
  expect(Buffer.from((await request('clawket.artifacts.read', { sessionKey: key, id: file.id, offset: 0 })).data, 'base64').toString()).toBe('Codex attachment');
  await expect(request('clawket.artifacts.read', { sessionKey: 'other', id: file.id, offset: 0 })).rejects.toThrow();
});


it('observes catalog-only desktop tasks without indexing, opening, publishing history or taking a writer', async () => {
  const desktop = (service as any).desktop;
  const record = (service as any).records.find((r: any) => r.id === key);
  record.threadId = threadId;
  const before = JSON.stringify((service as any).records);
  const nativeId = randomUUID(), nativeKey = `native:${nativeId}`;
  (service as any).native.set(nativeKey, { id: nativeId });
  mock.request.mockClear(); updates.length = 0;
  vi.spyOn((service as any).sessionActivity, 'query').mockImplementation((bindings: any) => Promise.resolve((service as any).sessionActivity.read(bindings)));
  expect(await request('sessions.activity', { keys: [key, nativeKey, 'missing'] })).toEqual([
    { key, state: 'unknown' }, { key: nativeKey, state: 'unknown' }, { key: 'missing', state: 'unknown' },
  ]);
  for (const id of [threadId, nativeId]) desktop.emit('snapshot', id, { fresh: true, source: 'owner', state: {
    latestModel: 'should-not-persist', turns: [{ id: 'live', status: 'inProgress', items: [{ type: 'agentMessage', text: 'private content' }] }], requests: [],
  } });
  expect(await request('sessions.activity', { keys: [key, nativeKey] })).toEqual([
    { key, state: 'running', attention: null }, { key: nativeKey, state: 'running', attention: null },
  ]);
  expect(updates).toHaveLength(2); expect(updates.every(update => update.type === 'session_activity_update')).toBe(true);
  expect(JSON.stringify(updates)).not.toContain('private content');
  expect(JSON.stringify((service as any).records)).toBe(before);
  expect((service as any).loaded.size).toBe(0); expect((service as any).runs.size).toBe(0);
  expect(mock.request).not.toHaveBeenCalled();
  await expect(request('sessions.activity', { keys: Array(33).fill(key) })).rejects.toThrow('Invalid session activity request');
});

it('reports package version and protects active work before fencing update admission', async () => {
  const subject = service;
  (subject as any).options.bridgeVersion = '3.1.11';
  expect(await subject.request({ type: 'req', id: 'version', method: 'health' })).toMatchObject({ backend: 'codex', bridgeVersion: '3.1.11' });
  (subject as any).runs.set('update-test', { run: {} });
  expect(subject.prepareForUpdate()).toBe(false);
  (subject as any).runs.delete('update-test');
  // The ordinary fixture may have a real idle native process; those remain restartable.
  expect(subject.prepareForUpdate()).toBe(true);
  await expect(subject.request({ type: 'req', id: 'after', method: 'sessions.list' })).rejects.toThrow('restarting');
  await expect((subject as any).desktopRequest('thread-owner-discovery', { conversationId: threadId })).rejects.toThrow('restarting');
});

it('becomes idle for update once a sent turn has finished', async () => {
  // 3.1.11–3.1.13 kept every settled start in the reply lookup and reported busy forever after one turn.
  let acknowledge!: (value: unknown) => void;
  const answer = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((method: string, params: any) => method === 'turn/start'
    ? new Promise(resolve => { acknowledge = resolve; }) : answer(method, params));
  await request('chat.send', { sessionKey: key, text: 'before update', idempotencyKey: 'update-idle' });
  (service as any).runs.clear();
  expect(service.prepareForUpdate()).toBe(false);
  acknowledge({ turn: { id: 'turn-1' } });
  await new Promise(resolve => setImmediate(resolve));
  expect((service as any).starts.size).toBe(1);
  expect(service.prepareForUpdate()).toBe(true);
});

it('stays busy until an acknowledged turn completes', async () => {
  await request('chat.send', { sessionKey: key, text: 'still running', idempotencyKey: 'update-running' });
  await new Promise(resolve => setImmediate(resolve));
  expect(service.prepareForUpdate()).toBe(false);
  notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', items: [] } });
  expect((service as any).runs.size).toBe(0);
  expect(service.prepareForUpdate()).toBe(true);
});


describe('Desktop owner acquisition following status', () => {
  it('forwards Desktop IPC metadata through the service diagnostic channel', () => {
    const diagnostic = { reason: 'connection_lost', operation: 'other', pendingCount: 1 }, observed = vi.fn();
    service.on('desktopDiagnostic', observed);
    (service as any).desktop.emit('diagnostic', diagnostic);
    expect(observed).toHaveBeenCalledExactlyOnceWith(diagnostic);
  });
  it('continues an imported Desktop thread through native host-scoped IPC without opening another writer', async () => {
    const nativeKey = `native:${threadId}`;
    Object.assign((service as any).records[0], { id: nativeKey, native: true, threadId, cwd: project, activity: 1000 });
    (service as any).save(); await service.stop();
    const { DesktopIpc } = await vi.importActual<typeof import('./desktop-ipc.js')>('./desktop-ipc.js');
    const path = process.platform === 'win32' ? String.raw`\\.\pipe\clawket-native-owner-${randomUUID()}` : join(root, 'native-owner.sock');
    const peers = new Set<Socket>(), frames: any[] = [];
    let remote!: Socket, starts = 0;
    const send = (value: object) => {
      const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      remote.write(Buffer.concat([header, body]));
    };
    const server = createServer(socket => {
      remote = socket; peers.add(socket); socket.on('close', () => peers.delete(socket));
      let buffer = Buffer.alloc(0);
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
          const size = buffer.readUInt32LE(), frame = JSON.parse(buffer.subarray(4, 4 + size).toString());
          buffer = buffer.subarray(4 + size); frames.push(frame);
          if (frame.method === 'initialize') send({ type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: 'bridge' } });
          if (frame.type !== 'request') continue;
          // The installed Desktop predicate requires hostId in discovery params;
          // thread-follower operations instead default their envelope host to local.
          if (frame.method === 'thread-owner-discovery') send({ type: 'response', method: frame.method, requestId: frame.requestId,
            ...(frame.params.hostId === 'local' && frame.params.conversationId === threadId
              ? { resultType: 'success', handledByClientId: 'desktop', result: { supportsUntrustedAppInput: true } }
              : { resultType: 'error', error: 'no-client-found' }) });
          if (frame.method === 'thread-follower-start-turn') send({ type: 'response', method: frame.method, requestId: frame.requestId,
            resultType: 'success', handledByClientId: 'desktop', result: { result: { turn: { id: `desktop-turn-${++starts}` } } } });
          if (frame.method === 'thread-follower-steer-turn') send({ type: 'response', method: frame.method, requestId: frame.requestId,
            resultType: 'success', handledByClientId: 'desktop', result: { result: { turnId: frame.params.expectedTurnId } } });
        }
      });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    const desktop = new DesktopIpc([path]);
    service = new CodexService({ project, directory: join(root, 'state'), device: true, desktop });
    key = nativeKey; mock.request.mockClear();
    try {
      await desktop.connect();
      const first = await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'native-first' });
      await vi.waitFor(() => expect(starts).toBe(1));
      expect((service as any).runs.get(key).turnId).toBe('desktop-turn-1');
      expect(frames.filter(frame => frame.method === 'thread-follower-start-turn')[0]).toMatchObject({ version: 2,
        params: { conversationId: threadId, turnStart: { request: { threadId, clientUserMessageId: 'native-first', input: [{ type: 'text', text: 'Continue', text_elements: [] }] }, context: { inheritThreadSettings: true } } } });
      await request('chat.steer', { sessionKey: key, runId: first.runId, text: '  Continue this turn\n' });
      expect(frames.find(frame => frame.method === 'thread-follower-steer-turn')).toMatchObject({
        params: { conversationId: threadId, expectedTurnId: 'desktop-turn-1', input: [{ type: 'text', text: '  Continue this turn\n', text_elements: [] }] },
      });
      expect(await request('chat.send', { sessionKey: key, text: 'Continue', idempotencyKey: 'native-first' })).toEqual(first);
      expect(starts).toBe(1);
      send({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'desktop',
        params: { hostId: 'local', conversationId: threadId, change: { type: 'snapshot', revision: 1,
          conversationState: { turns: [{ id: 'desktop-turn-1', status: 'completed', items: [] }], requests: [] } } } });
      await vi.waitFor(() => expect((service as any).runs.has(key)).toBe(false));
      await request('chat.send', { sessionKey: key, text: 'Continue again', idempotencyKey: 'native-second' });
      await vi.waitFor(() => expect(starts).toBe(2));
      expect((service as any).runs.get(key).turnId).toBe('desktop-turn-2');
      expect(mock.request.mock.calls.filter(([method]) => ['thread/resume', 'turn/start'].includes(method))).toEqual([]);
      expect(frames.filter(frame => frame.method === 'thread-owner-discovery').every(frame => frame.params.hostId === 'local')).toBe(true);
    } finally {
      await service.stop(); for (const peer of peers) peer.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('does not announce a cold stranger or a thread whose owner discovery remains uncertain', async () => {
    const desktop = (service as any).desktop, broadcast = vi.spyOn(desktop, 'broadcast');
    Object.assign((service as any).records[0], { threadId, activity: 1000 });
    desktop.emit('follow', randomUUID(), true, 'desktop-a'); desktop.emit('follow', threadId, true, 'desktop-a');
    vi.spyOn(desktop, 'request').mockRejectedValue(new DesktopIpcError('uncertain', 'Unknown owner'));
    await request('models.list', { sessionKey: key });
    expect((service as any).desktopFollowers.size).toBe(0); expect(broadcast).not.toHaveBeenCalled();
    expect(mock.request.mock.calls.some(([method]) => ['thread/start', 'thread/resume', 'thread/fork', 'turn/start'].includes(method))).toBe(false);
  });
  it('keeps a successful native acquisition when its subscription control cannot be sent', async () => {
    const broadcast = vi.spyOn((service as any).desktop, 'broadcast').mockImplementation(() => { throw new Error('IPC closed'); });
    await expect(request('models.list', { sessionKey: key })).resolves.toMatchObject({ currentModel: 'native-model' });
    await request('models.list', { sessionKey: key });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(mock.request.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(1);
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  });
  it('renews an early subscriber through actual IPC frames after a legal delayed resume, then publishes the active and terminal turn', async () => {
    await service.stop();
    const { DesktopIpc } = await vi.importActual<typeof import('./desktop-ipc.js')>('./desktop-ipc.js');
    const path = process.platform === 'win32' ? String.raw`\\.\pipe\clawket-owner-follow-${randomUUID()}` : join(root, 'owner-follow.sock');
    const peers = new Set<Socket>(), received: any[] = [];
    let remote!: Socket;
    const send = (value: object) => {
      const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      remote.write(Buffer.concat([header, body]));
    };
    const following = (source: string, following = true, id = threadId) => send({ type: 'broadcast', version: 1,
      method: 'thread-stream-following-changed', sourceClientId: source,
      params: { hostId: 'local', conversationId: id, following } });
    const server = createServer(socket => {
      remote = socket; peers.add(socket); socket.on('close', () => peers.delete(socket));
      let buffer = Buffer.alloc(0);
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
          const size = buffer.readUInt32LE(), frame = JSON.parse(buffer.subarray(4, 4 + size).toString());
          buffer = buffer.subarray(4 + size); received.push(frame);
          if (frame.method === 'initialize') send({ type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: 'bridge' } });
          if (frame.type === 'request' && frame.method === 'thread-owner-discovery') send({ type: 'response', method: frame.method,
            requestId: frame.requestId, resultType: 'error', error: 'no-client-found' });
          // The already-following Desktop responds to the new owner's status request.
          if (frame.method === 'thread-stream-following-status-requested') following('desktop-a');
        }
      });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    const desktop = new DesktopIpc([path]);
    service = new CodexService({ project, directory: join(root, 'state'), desktop });
    const record = (service as any).records[0]; Object.assign(record, { threadId, activity: 1000 }); (service as any).save();
    const original = mock.request.getMockImplementation()!;
    let resolveResume!: () => void, terminal = false;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/resume') return new Promise(resolve => { resolveResume = () => resolve(original(method, params)); });
      if (method === 'thread/turns/list') return Promise.resolve({ data: terminal
        ? [{ id: 'turn-1', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: 'Done' }] }]
        : [{ id: 'old-turn', status: 'completed', items: [] }] });
      return original(method, params);
    });
    const snapshots = () => received.filter(frame => frame.method === 'thread-stream-state-changed');
    try {
      await desktop.connect(); following('desktop-a'); following('desktop-a', true, 'unrelated');
      await vi.waitFor(() => expect((service as any).desktopFollowers.size).toBe(0));
      const picker = request('models.list', { sessionKey: key });
      await vi.waitFor(() => expect(resolveResume).toBeTypeOf('function'));
      expect(received.some(frame => frame.method === 'thread-stream-following-status-requested')).toBe(false);
      expect(snapshots()).toHaveLength(0);
      resolveResume(); await picker;
      await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
      expect(received.filter(frame => frame.method === 'thread-stream-following-status-requested')).toEqual([
        { type: 'broadcast', method: 'thread-stream-following-status-requested', version: 1, sourceClientId: 'bridge',
          params: { hostId: 'local', conversationId: threadId } },
      ]);
      expect((service as any).desktopFollowers.get(threadId)).toEqual(new Set(['desktop-a']));
      expect(snapshots()[0]).toMatchObject({ version: 11, params: { change: { conversationState: {
        source: 'appServer', originator: 'clawket', latestThreadSettings: settings,
      } } } });
      expect(mock.request.mock.calls.filter(([method]) => method === 'thread/resume')).toHaveLength(1);
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/settings/update'].includes(method))).toBe(false);
      await request('models.list', { sessionKey: key });
      expect(received.filter(frame => frame.method === 'thread-stream-following-status-requested')).toHaveLength(1);
      await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'owner-follow-send' });
      notify('turn/started', { turn: { id: 'turn-1' } });
      await vi.waitFor(() => expect(desktopTurns(snapshots().at(-1)?.params.change.conversationState).some(turn => turn.id === 'turn-1' && turn.status === 'inProgress')).toBe(true), { timeout: 2000 });
      terminal = true; notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      await vi.waitFor(() => expect(desktopTurns(snapshots().at(-1)?.params.change.conversationState).some(turn => turn.id === 'turn-1' && turn.status === 'completed')).toBe(true), { timeout: 2000 });
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
    } finally {
      await service.stop(); for (const peer of peers) peer.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it.each(['failed', 'closed', 'replaced', 'retired'])('does not announce a %s acquisition completion', async outcome => {
    Object.assign((service as any).records[0], { threadId, activity: 1000 });
    const desktop = (service as any).desktop, broadcast = vi.spyOn(desktop, 'broadcast');
    const original = mock.request.getMockImplementation()!;
    let resume!: () => void, rejectResume!: () => void;
    mock.request.mockImplementation((method, params) => method === 'thread/resume' ? new Promise((resolve, reject) => {
      resume = () => resolve(original(method, params)); rejectResume = () => reject(new Error('Resume failed'));
    }) : original(method, params));
    const picker = request('models.list', { sessionKey: key }); void picker.catch(() => {});
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    if (outcome === 'failed') rejectResume();
    else {
      if (outcome === 'closed' || outcome === 'replaced') mock.instances.at(-1).emit('closed');
      if (outcome === 'replaced') { (service as any).nextRecoveryAt = 0; await request('health'); }
      if (outcome === 'retired') (service as any).records = [];
      resume();
    }
    await picker.catch(() => {});
    expect(broadcast.mock.calls.filter(([method]) => method === 'thread-stream-following-status-requested')).toHaveLength(0);
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  });
  it('announces a newly started owner once and its distinct fork owner after successful native confirmation', async () => {
    const desktop = (service as any).desktop, broadcast = vi.spyOn(desktop, 'broadcast');
    await request('models.list', { sessionKey: key }); await request('models.list', { sessionKey: key });
    const sourceId = threadId, branchId = randomUUID(), original = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((method, params) => method === 'thread/fork'
      ? Promise.resolve({ ...response(), thread: { id: branchId, cwd: project } }) : original(method, params));
    await request('sessions.create', { fromSession: key, title: 'QA branch' });
    expect(broadcast.mock.calls.filter(([method]) => method === 'thread-stream-following-status-requested')).toEqual([
      ['thread-stream-following-status-requested', { hostId: 'local', conversationId: sourceId }],
      ['thread-stream-following-status-requested', { hostId: 'local', conversationId: branchId }],
    ]);
    expect(mock.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
  });
});

describe('Desktop follower membership for owned conversations', () => {
  async function settlePublications() {
    await Promise.all([...(service as any).publishing.values()].map((entry: any) => entry.promise ?? entry));
  }
  async function owned() {
    await request('models.list', { sessionKey: key });
    const desktop = (service as any).desktop, broadcast = vi.spyOn(desktop, 'broadcast');
    return { desktop, broadcast };
  }
  async function changeNativeSettings() {
    settings = { ...settings, effort: 'high', collaborationMode: { ...settings.collaborationMode,
      settings: { ...settings.collaborationMode.settings, reasoning_effort: 'high' } } };
    notify('thread/settings/updated', { threadSettings: settings });
    await vi.advanceTimersByTimeAsync(500); await settlePublications();
  }
  it.each(['unfollow', 'disconnect'])('continues native snapshots for the other subscribed client after one client %s', async action => {
    const { desktop, broadcast } = await owned(); vi.useFakeTimers();
    try {
      desktop.emit('follow', threadId, true, 'desktop-a'); await settlePublications();
      desktop.emit('follow', threadId, true, 'desktop-b'); await settlePublications();
      broadcast.mockClear(); mock.request.mockClear();
      if (action === 'unfollow') desktop.emit('follow', threadId, false, 'desktop-a');
      else desktop.emit('client-offline', 'desktop-a');
      await changeNativeSettings();
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(broadcast.mock.calls[0]).toEqual(['thread-stream-state-changed', expect.objectContaining({ conversationId: threadId,
        change: expect.objectContaining({ conversationState: expect.objectContaining({ latestThreadSettings: expect.objectContaining({ effort: 'high' }) }) }) })]);
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/resume', 'thread/settings/update'].includes(method))).toBe(false);
      broadcast.mockClear(); desktop.emit('follow', threadId, false, 'desktop-b'); await changeNativeSettings();
      expect(broadcast).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('retires the final disconnected client without ending the native task or dispatching another turn', async () => {
    const { desktop, broadcast } = await owned(); vi.useFakeTimers();
    try {
      desktop.emit('follow', threadId, true, 'desktop-a'); await settlePublications(); broadcast.mockClear(); mock.request.mockClear();
      desktop.emit('client-offline', 'desktop-a'); await changeNativeSettings();
      expect(broadcast).not.toHaveBeenCalled();
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'turn/interrupt', 'thread/resume'].includes(method))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('retains the explicit complete-history requester independently from another follower', async () => {
    const { desktop, broadcast } = await owned(); vi.useFakeTimers();
    try {
      desktop.emit('follow', threadId, true, 'desktop-a'); await settlePublications();
      await desktop.handler.request('thread-follower-load-complete-history', { conversationId: threadId }, 'desktop-b');
      desktop.emit('follow', threadId, false, 'desktop-a'); broadcast.mockClear(); mock.request.mockClear();
      await changeNativeSettings(); expect(broadcast).toHaveBeenCalledTimes(1);
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/resume', 'thread/settings/update'].includes(method))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('does not retire existing followers for malformed or unknown source identities', async () => {
    const { desktop, broadcast } = await owned(); vi.useFakeTimers();
    try {
      desktop.emit('follow', threadId, true, 'desktop-a'); await settlePublications(); broadcast.mockClear();
      desktop.emit('follow', threadId, false); desktop.emit('follow', threadId, false, '');
      desktop.emit('follow', threadId, false, 'unknown-client');
      await changeNativeSettings(); expect(broadcast).toHaveBeenCalledTimes(1);
      await expect(desktop.handler.request('thread-follower-load-complete-history', { conversationId: threadId, clientId: 'desktop-a' })).rejects.toThrow('Invalid Desktop follower');
    } finally { vi.useRealTimers(); }
  });
  it('retires all old memberships after the broker connection is lost', async () => {
    const { desktop, broadcast } = await owned(); vi.useFakeTimers();
    try {
      desktop.emit('follow', threadId, true, 'desktop-a'); await settlePublications(); broadcast.mockClear();
      desktop.emit('offline'); await changeNativeSettings(); expect(broadcast).not.toHaveBeenCalled();
      desktop.emit('follow', threadId, true, 'desktop-b'); await settlePublications(); broadcast.mockClear();
      await changeNativeSettings(); expect(broadcast).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('discards an in-flight history snapshot after its final follower leaves', async () => {
    const { desktop, broadcast } = await owned();
    const original = mock.request.getMockImplementation()!;
    let resume!: () => void;
    mock.request.mockImplementation((method, params) => method === 'thread/turns/list'
      ? new Promise(resolve => { resume = () => resolve(original(method, params)); }) : original(method, params));
    desktop.emit('follow', threadId, true, 'desktop-a');
    const slot = [...(service as any).publishing.values()][0] as any;
    const pending = slot.promise ?? slot;
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    desktop.emit('follow', threadId, false, 'desktop-a'); resume();
    await expect(pending).rejects.toThrow('Desktop subscription changed');
    expect(broadcast).not.toHaveBeenCalled();
    expect((service as any).desktopHistory.has(threadId)).toBe(false);
    expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });
  it('prepares a renewed client snapshot after retiring an in-flight old broker subscription', async () => {
    const { desktop, broadcast } = await owned();
    const original = mock.request.getMockImplementation()!;
    let resume!: () => void, first = true;
    mock.request.mockImplementation((method, params) => {
      if (method === 'thread/turns/list' && first) {
        first = false; return new Promise(resolve => { resume = () => resolve(original(method, params)); });
      }
      return original(method, params);
    });
    desktop.emit('follow', threadId, true, 'desktop-a');
    const slot = [...(service as any).publishing.values()][0] as any;
    const old = slot.promise ?? slot;
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    desktop.emit('offline');
    const next = desktop.handler.request('thread-follower-load-complete-history', { conversationId: threadId }, 'desktop-b');
    void next.catch(() => {});
    await Promise.resolve(); await Promise.resolve();
    resume(); await expect(old).rejects.toThrow('Desktop subscription changed');
    await expect(next).resolves.toMatchObject({ revision: 1 });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(mock.request.mock.calls.filter(([method]) => method === 'thread/turns/list')).toHaveLength(2);
    expect(mock.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });
  it('bounds each owned conversation to 128 subscribers and admits a new one only after retirement', async () => {
    const { desktop } = await owned();
    for (let i = 0; i < 128; i++) desktop.emit('follow', threadId, true, `desktop-${i}`);
    await settlePublications();
    await expect(desktop.handler.request('thread-follower-load-complete-history', { conversationId: threadId }, 'overflow')).rejects.toThrow('Too many Desktop followers');
    desktop.emit('client-offline', 'desktop-0');
    await expect(desktop.handler.request('thread-follower-load-complete-history', { conversationId: threadId }, 'replacement')).resolves.toMatchObject({ revision: expect.any(Number) });
  });
  it('retires native-thread memberships on reset and does not revive them for its next native identity', async () => {
    const { desktop, broadcast } = await owned();
    desktop.emit('follow', threadId, true, 'desktop-a'); await settlePublications();
    const oldThread = threadId;
    await request('sessions.reset', { sessionKey: key });
    threadId = randomUUID(); await request('models.list', { sessionKey: key });
    vi.useFakeTimers();
    try {
      broadcast.mockClear(); await changeNativeSettings(); expect(broadcast).not.toHaveBeenCalled();
      desktop.emit('follow', oldThread, true, 'desktop-b'); await settlePublications();
      expect(broadcast).not.toHaveBeenCalled();
      expect((service as any).desktopFollowers.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('Desktop history publication generations', () => {
  async function setup(active = true) {
    if (active) await start(); else await request('models.list', { sessionKey: key });
    const nativeTurns = [{ id: 'turn-1', status: active ? 'inProgress' : 'completed', items: [
      { type: 'userMessage', id: 'original-input', content: [{ type: 'text', text: 'hello' }] },
    ] }] as any[];
    const original = mock.request.getMockImplementation()!;
    let nextTurn = 'turn-1';
    const itemReads: Array<{ captured: any; release: () => void }> = [];
    let pause = 0;
    let entered: (() => void) | undefined;
    mock.request.mockImplementation((method, params) => {
      if (method === 'turn/start') return Promise.resolve({ turn: { id: nextTurn } });
      if (method === 'thread/turns/list') return Promise.resolve({ data: nativeTurns.map(turn => ({ ...turn, items: [...turn.items] })).reverse() });
      if (method === 'thread/items/list') {
        const captured = { data: nativeTurns.find(turn => turn.id === params.turnId).items.map((item: any) => ({ turnId: params.turnId, item })).reverse() };
        if (pause > 0) {
          pause -= 1;
          return new Promise(resolve => { itemReads.push({ captured, release: () => resolve(captured) }); entered?.(); });
        }
        return Promise.resolve(captured);
      }
      return original(method, params);
    });
    const desktop = (service as any).desktop, broadcast = vi.spyOn(desktop, 'broadcast');
    desktop.emit('follow', threadId, true, 'desktop-reader');
    await Promise.all([...(service as any).publishing.values()].map((slot: any) => slot.promise));
    broadcast.mockClear(); mock.request.mockClear();
    return {
      nativeTurns, desktop, broadcast, itemReads,
      nextTurn: (id: string) => { nextTurn = id; },
      pause: () => { pause += 1; return new Promise<void>(resolve => { entered = resolve; }); },
      full: () => desktop.handler.request('thread-follower-load-complete-history', { conversationId: threadId }, 'desktop-reader') as Promise<any>,
    };
  }
  function states(broadcast: any) {
    return broadcast.mock.calls.filter(([method]: any[]) => method === 'thread-stream-state-changed')
      .map(([, params]: any[]) => params.change.conversationState);
  }
  function historyReads() { return mock.request.mock.calls.filter(([method, params]) => method === 'thread/turns/list' && params.itemsView === 'notLoaded'); }
  it('cannot recache or broadcast an active turn after its terminal notification consumes the scheduled publication', async () => {
    const f = await setup(); vi.useFakeTimers();
    try {
      const entered = f.pause(), pending = f.full(); await entered;
      f.nativeTurns[0].status = 'completed';
      notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      await vi.advanceTimersByTimeAsync(500); f.itemReads[0].release();
      await expect(pending).resolves.toMatchObject({ revision: expect.any(Number) });
      expect(states(f.broadcast).map((state: any) => desktopTurns(state).map(turn => turn.status))).toEqual([['completed']]);
      expect((service as any).desktopHistory.get(threadId)).toMatchObject({ complete: true, thread: { turns: [{ status: 'completed' }] } });
      expect(historyReads()).toHaveLength(2);
      await f.full(); expect(historyReads()).toHaveLength(2);
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/resume'].includes(method))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('does not keep the completed predecessor active when the next explicit turn starts during the read', async () => {
    const f = await setup(); vi.useFakeTimers();
    try {
      const entered = f.pause(), pending = f.full(); await entered;
      f.nativeTurns[0].status = 'completed'; notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
      f.nextTurn('turn-2');
      await request('chat.send', { sessionKey: key, text: 'next explicit input', idempotencyKey: 'send-2' });
      f.nativeTurns.push({ id: 'turn-2', status: 'inProgress', items: [{ type: 'userMessage', id: 'next-input', content: [{ type: 'text', text: 'next explicit input' }] }] });
      notify('turn/started', { turn: { id: 'turn-2' } });
      await vi.advanceTimersByTimeAsync(500); f.itemReads[0].release(); await pending;
      expect(desktopTurns(states(f.broadcast).at(-1)).map(turn => [turn.id, turn.status])).toEqual([['turn-1', 'completed'], ['turn-2', 'inProgress']]);
      expect(mock.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
      expect(mock.request).not.toHaveBeenCalledWith('thread/resume', expect.anything());
    } finally { vi.useRealTimers(); }
  });
  it('publishes settings confirmed during history preparation instead of the earlier captured settings', async () => {
    const f = await setup(false); vi.useFakeTimers();
    try {
      const entered = f.pause(), pending = f.full(); await entered;
      settings = { ...settings, effort: 'high', collaborationMode: { ...settings.collaborationMode,
        settings: { ...settings.collaborationMode.settings, reasoning_effort: 'high' } } };
      notify('thread/settings/updated', { threadSettings: settings });
      await vi.advanceTimersByTimeAsync(500); f.itemReads[0].release(); await pending;
      expect(states(f.broadcast)).toEqual([expect.objectContaining({ latestThreadSettings: expect.objectContaining({ effort: 'high' }) })]);
      expect(historyReads()).toHaveLength(1);
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/resume', 'thread/settings/update'].includes(method))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('bounds re-preparation and preserves a new scheduled publication after both reads become obsolete', async () => {
    const f = await setup(); vi.useFakeTimers();
    try {
      const firstEntered = f.pause(), pending = f.full(); void pending.catch(() => {}); await firstEntered;
      notify('item/completed', { turnId: 'turn-1', item: { type: 'agentMessage', id: 'reply-a', text: 'first stage' } });
      await vi.advanceTimersByTimeAsync(500);
      const secondEntered = f.pause(); f.itemReads[0].release();
      await vi.advanceTimersByTimeAsync(0); expect(f.itemReads).toHaveLength(2); await secondEntered;
      notify('item/completed', { turnId: 'turn-1', item: { type: 'agentMessage', id: 'reply-b', text: 'second stage' } });
      await vi.advanceTimersByTimeAsync(500); f.itemReads[1].release();
      await expect(pending).rejects.toThrow('Conversation changed while its history was loading');
      expect(historyReads()).toHaveLength(2); expect(f.broadcast).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      await Promise.all([...(service as any).publishing.values()].map((slot: any) => slot.promise));
      expect(f.broadcast).toHaveBeenCalledTimes(1);
      expect((service as any).desktopHistory.get(threadId).complete).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it.each(['rpc', 'record-id', 'cwd'])('rejects a history result from a changed %s context before caching or publishing', async changed => {
    const f = await setup(false), entered = f.pause(), pending = f.full(); void pending.catch(() => {}); await entered;
    const r = (service as any).records[0];
    if (changed === 'rpc') (service as any).rpc = (service as any).createRpc();
    if (changed === 'record-id') r.id = randomUUID();
    if (changed === 'cwd') r.cwd = join(root, 'other-project');
    f.itemReads[0].release();
    await expect(pending).rejects.toThrow('Conversation ownership changed');
    expect(f.broadcast).not.toHaveBeenCalled();
    expect((service as any).desktopHistory.get(threadId)?.complete).not.toBe(true);
    expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/resume'].includes(method))).toBe(false);
  });
  it('does not restart history preparation for text deltas and overlays the latest active item', async () => {
    const f = await setup(), entered = f.pause(), pending = f.full(); await entered;
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'reply', delta: 'one' });
    notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'reply', delta: ' two' });
    f.itemReads[0].release(); await pending;
    expect(historyReads()).toHaveLength(1);
    expect(desktopTurns(states(f.broadcast).at(-1))[0].items).toContainEqual(expect.objectContaining({ id: 'reply', text: 'one two' }));
  });
  it('retires a completed cache for a late native item without reviving its run', async () => {
    const f = await setup(false); await f.full(); f.broadcast.mockClear(); mock.request.mockClear(); vi.useFakeTimers();
    try {
      const late = { type: 'commandExecution', id: 'late-tool', command: 'qa-command', cwd: project, status: 'completed', exitCode: 0 };
      f.nativeTurns[0].items.push(late);
      notify('item/completed', { turnId: 'turn-1', item: late });
      await vi.advanceTimersByTimeAsync(500);
      await Promise.all([...(service as any).publishing.values()].map((slot: any) => slot.promise));
      expect(desktopTurns(states(f.broadcast).at(-1))[0]).toMatchObject({ status: 'completed', items: expect.arrayContaining([late]) });
      expect((service as any).runs.size).toBe(0);
      expect(mock.request.mock.calls.some(([method]) => ['turn/start', 'thread/resume'].includes(method))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
