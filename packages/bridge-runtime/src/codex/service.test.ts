import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const mock = vi.hoisted(() => ({ instances: [] as any[], request: vi.fn(), respond: vi.fn(), refuse: vi.fn() }));
vi.mock('./rpc.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { CodexRpc: class extends EventEmitter {
    constructor() { super(); mock.instances.push(this); }
    request = mock.request; respond = mock.respond; refuse = mock.refuse;
    async stop() { this.emit('closed'); }
  } };
});
import { CodexService } from './service.js';
import { codexMessages } from './history.js';
let root: string, project: string, service: CodexService, key: string, threadId: string;
let updates: any[];
const request = (method: string, params: Record<string, unknown> = {}) => service.request({ type: 'req', id: randomUUID(), method, params }) as Promise<any>;
const notify = (method: string, params: object) => mock.instances.at(-1).emit('notification', { method, params: { threadId, ...params } });
async function start() {
  const result = await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'send-1' });
  await Promise.resolve(); notify('turn/started', { turn: { id: 'turn-1' } }); return result;
}
beforeEach(async () => {
  mock.request.mockReset(); mock.respond.mockReset(); mock.refuse.mockReset(); mock.instances.length = 0;
  root = mkdtempSync(join(tmpdir(), 'clawket-codex-test-')); project = join(root, 'project'); mkdirSync(project); project = realpathSync(project); threadId = randomUUID();
  mock.request.mockImplementation(async (method: string) => {
    if (method === 'model/list') return { data: [{ model: 'native-model', displayName: 'Native model', isDefault: true, inputModalities: ['text', 'image'], supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] }] };
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: threadId, cwd: project }, model: 'native-model', modelProvider: 'custom' };
    if (method === 'thread/list') return { data: [] };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    if (method === 'thread/turns/list') return { data: [{ id: 'turn-1', items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hello' }] }] }] };
    if (method === 'thread/read') return { thread: { id: threadId, cwd: project, turns: [{ id: 'turn-1', items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hello' }] }] }] } };
    return {};
  });
  service = new CodexService({ project, directory: join(root, 'state') }); updates = []; service.on('update', u => updates.push(u));
  key = (await request('sessions.create')).key;
});
afterEach(async () => { await service.stop(); rmSync(root, { recursive: true, force: true }); });
describe('Codex owned sessions', () => {
  it('uses ordinary conversations and scopes native discovery', async () => {
    expect((await request('agents.list'))[0]).toMatchObject({ mainSessionKey: '', entryMode: 'sessions' });
    expect((await request('sessions.list'))[0]).toMatchObject({ key, kind: 'direct', source: 'bridge', allowedActions: { delete: true } });
    expect(mock.request).toHaveBeenCalledWith('thread/list', expect.objectContaining({ cwd: project }));
    await expect(request('chat.send', { sessionKey: '../foreign', text: 'x' })).rejects.toThrow('read-only');
    await expect(request('thread/start', { cwd: '/' })).rejects.toThrow('Unsupported');
  });
  it('does not enable unsafe approvals and persists before turn submission', async () => {
    mock.request.mockImplementationOnce(async () => ({ thread: { id: threadId, cwd: project }, model: 'native-model', modelProvider: 'custom' }));
    await start();
    expect(mock.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ cwd: project, approvalPolicy: 'on-request', sandbox: 'workspace-write', approvalsReviewer: 'user' }));
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
    await expect(request('approvals.resolve', { id: a.id, decision: 'allow-always' })).rejects.toThrow();
    await request('approvals.resolve', { id: a.id, decision: 'allow-once' });
    expect(mock.respond).toHaveBeenCalledWith(51, { decision: 'accept' });
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
    expect(mock.request).toHaveBeenCalledWith('thread/turns/list', expect.objectContaining({ itemsView: 'full', limit: 10 }));
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

it.each([false, true])('retains the selected reasoning level across restart (materialized=%s)', async materialized => {
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
  expect((await request('models.list', { sessionKey: key })).thinkingLevel).toBe('ultra');
  await request('chat.send', { sessionKey: key, text: 'continue', idempotencyKey: 'send-after-restart' });
  expect(mock.request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ effort: 'ultra' }));
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
    const desktop = Object.assign(new EventEmitter(), { ready: true, snapshots: new Map(), connect: vi.fn(async () => {}), follow: vi.fn(), stop: vi.fn(), broadcast: vi.fn(), request: vi.fn(async () => ({ result: { turn: { id: 'desktop-turn' } } })) });
    await service.stop(); service = new CodexService({ project, directory: join(root, 'device'), device: true, env: { CODEX_HOME: root }, desktop: desktop as any });
    return desktop;
  }
  it('paginates across projects, includes desktop sources and binds new chats to an opaque discovered project', async () => {
    await device(); const other = join(root, 'second'); mkdirSync(other);
    mock.request.mockImplementation(async (method, params) => {
      if (method === 'thread/list') return params.cursor ? { data: [{ id: randomUUID(), cwd: other, updatedAt: 1 }] } : { data: [{ id: threadId, cwd: project, updatedAt: 1 }], nextCursor: 'page-2' };
      if (method === 'thread/start') return { thread: { id: randomUUID(), cwd: params.cwd } };
      if (method === 'turn/start') return { turn: { id: 'new-turn' } }; return {};
    });
    const projects = await request('projects.list'); expect(projects).toHaveLength(2);
    const p = projects.find((p: any) => p.path.endsWith('/second'));
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
    desktop.request.mockRejectedValueOnce(new Error('connection interrupted'));
    await request('chat.send', { sessionKey: `native:${threadId}`, text: 'Continue', idempotencyKey: 'native-send' });
    await new Promise(r => setTimeout(r, 0));
    expect(desktop.request).toHaveBeenCalledWith('thread-follower-start-turn', expect.objectContaining({ conversationId: threadId }));
    expect(mock.request.mock.calls.filter(c => ['thread/resume', 'turn/start'].includes(c[0]))).toEqual([]);
    await request('chat.send', { sessionKey: `native:${threadId}`, text: 'Continue', idempotencyKey: 'native-send' });
    expect(desktop.request).toHaveBeenCalledTimes(1);
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
