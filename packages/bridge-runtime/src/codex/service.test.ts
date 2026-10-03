import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { DesktopIpcError } from './desktop-ipc.js';
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
const notify = (method: string, params: object) => mock.instances.at(-1).emit('notification', { method, params: { threadId, ...params } });
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
    expect(mock.request).toHaveBeenCalledWith('turn/steer', { threadId, expectedTurnId: 'turn-1', input: [{ type: 'text', text: 'do less' }] });
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
    if (status === 'completed') expect(finished[0].message.content).toBe('Done');
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
