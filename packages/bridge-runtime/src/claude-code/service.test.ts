import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ starts: vi.fn(), send: vi.fn(), close: vi.fn(), roster: vi.fn(), list: vi.fn(), history: vi.fn(), info: vi.fn(), fork: vi.fn(), questions: vi.fn(), interrupt: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ listSessions: mocks.list, getSessionMessages: mocks.history, getSessionInfo: mocks.info, forkSession: mocks.fork }));
vi.mock('./saved-projects.js', () => ({ savedClaudeProjects: async () => [] }));
vi.mock('./owners.js', () => ({ ClaudeOwners: class { snapshot = mocks.roster; } }));
vi.mock('./session.js', () => ({ claudePromptContent: (input: { text: string }) => { if (!input.text.trim()) throw new Error('empty'); },
  ClaudeSession: class extends EventEmitter {
    constructor(options: unknown) { super(); mocks.starts(options, this); }
    activeRun: { runId: string } | undefined;
    interactions = { questions: mocks.questions, approvals: () => [] };
    currentModel = 'sonnet';
    interrupt = mocks.interrupt;
    start = async () => {};
    models = async () => [{ value: 'sonnet', displayName: 'Sonnet' }];
    close = async () => { mocks.close(); this.activeRun = undefined; };
    send(runId: string, input: unknown) { mocks.send(runId, input); this.activeRun = { runId }; }
  },
}));
import { ClaudeService } from './service.js';
const services: ClaudeService[] = [], dirs: string[] = [];
const request = (service: ClaudeService, method: string, params?: Record<string, unknown>) => service.request({ type: 'req', id: randomUUID(), method, params });
function fixture(device = false) {
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'clawket-claude-service-'))); dirs.push(project);
  const options = { project, directory: join(project, 'state'), executable: '/unused/claude', ownershipDirectory: join(project, 'writers'), device };
  const open = () => { const service = new ClaudeService(options); services.push(service); return service; };
  return { project, open, service: open() };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.questions.mockReturnValue([]); mocks.interrupt.mockResolvedValue(undefined); mocks.list.mockResolvedValue([]); mocks.history.mockResolvedValue([]);
  mocks.roster.mockResolvedValue({ known: true, owners: [] }); mocks.info.mockResolvedValue({}); mocks.send.mockReset();
});
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('Claude service durable send and ownership boundary', () => {
  it('a rename acknowledgement prevents a new sync from reusing a pre-rename multi-row scan', async () => {
    const { service } = fixture();
    const first = await request(service, 'sessions.create', { title: 'Before rename' }) as any;
    const second = await request(service, 'sessions.create', { title: 'Second' }) as any;
    const original = (service as any).descriptor.bind(service);
    let reached!: () => void, release!: () => void, blocked = false;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(service as any, 'descriptor').mockImplementation(async (...args: any[]) => {
      const value = await original(...args);
      if (args[0].key === second.key && !blocked) { blocked = true; reached(); await barrier; }
      return value;
    });
    const older = request(service, 'sessions.sync') as Promise<any>; await entered;
    await request(service, 'sessions.rename', { sessionKey: first.key, title: 'Confirmed name' });
    const newer = await request(service, 'sessions.sync') as any;
    release();
    const retried = await older;
    for (const response of [newer, retried]) expect(response.sessions.find((row: any) => row.key === first.key).title).toBe('Confirmed name');
  });
  it('negotiates catalog sync without replacing legacy list, and retains the baseline after incomplete native reads', async () => {
    const { service, project } = fixture();
    await request(service, 'sessions.create', { title: 'Owned' });
    const info = { sessionId: randomUUID(), cwd: project, summary: 'Native', lastModified: 1 };
    mocks.list.mockResolvedValue([info]);
    const first = await request(service, 'sessions.sync') as any;
    const base = { epoch: first.epoch, revision: first.revision };
    expect(first).toMatchObject({ kind: 'full', total: 2, nextOffset: null });
    expect(await request(service, 'sessions.list')).toEqual(first.sessions);
    expect(await service.health()).toMatchObject({ sessionCatalogSync: 1 });
    mocks.list.mockRejectedValue(new Error('private native path'));
    await expect(request(service, 'sessions.sync', { base })).rejects.toThrow('Conversation catalog could not be refreshed completely');
    expect(await request(service, 'sessions.sync', { page: { ...base, offset: 0 } })).toEqual(first);
    expect(await request(service, 'sessions.list')).toHaveLength(1);
    const nativeKey = first.sessions.find((session: any) => session.source === 'native').key;
    mocks.list.mockResolvedValue([{ sessionId: info.sessionId, cwd: project }]);
    await expect(request(service, 'sessions.sync', { base })).rejects.toThrow('Conversation catalog could not be refreshed completely');
    expect(await request(service, 'chat.history', { sessionKey: nativeKey })).toMatchObject({ messages: [] });
    mocks.list.mockResolvedValue([info]);
    expect(await request(service, 'sessions.sync', { base })).toEqual({ kind: 'unchanged', ...base });
    mocks.list.mockResolvedValue([]);
    expect(await request(service, 'sessions.sync')).toMatchObject({ kind: 'full', total: 1 });
    await expect(request(service, 'chat.history', { sessionKey: nativeKey })).rejects.toThrow('Unknown');
  });
  it('rejects truncated Claude discovery for sync while preserving legacy partial listing', async () => {
    const { service, project } = fixture();
    const rows = Array.from({ length: 100 }, () => ({ sessionId: randomUUID(), cwd: project, summary: 'Native', lastModified: 1 }));
    mocks.list.mockResolvedValue(rows);
    await expect(request(service, 'sessions.sync')).rejects.toThrow('Conversation catalog could not be refreshed completely');
    expect(await request(service, 'sessions.list')).toHaveLength(100);
  });
  it('looks up durable receipts after restart without native discovery, owner takeover or replay', async () => {
    const { service, open } = fixture();
    const row = await request(service, 'sessions.create') as { key: string };
    const input = { sessionKey: row.key, text: 'receipt', idempotencyKey: '__proto__' };
    expect(await request(service, 'chat.promptStatus', input)).toEqual({ status: 'unknown' });
    expect(mocks.starts).not.toHaveBeenCalled();
    const sent = await request(service, 'chat.send', input) as { runId: string };
    await service.stop();
    const restarted = open(); vi.clearAllMocks();
    expect(await request(restarted, 'chat.promptStatus', input)).toEqual({ status: 'recorded', runId: sent.runId });
    expect(await request(restarted, 'chat.promptStatus', { ...input, sessionKey: 'other' })).toEqual({ status: 'unknown' });
    expect(await request(restarted, 'chat.promptStatus', { ...input, idempotencyKey: 'constructor' })).toEqual({ status: 'unknown' });
    await expect(request(restarted, 'chat.promptStatus', { ...input, idempotencyKey: '' })).rejects.toThrow('Invalid');
    expect(mocks.starts).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.roster).not.toHaveBeenCalled();
  });
  it('shows the accepted user message, then the completed assistant reply without persisting transcript text', async () => {
    const { service } = fixture();
    const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: '## Question', idempotencyKey: 'preview' });
    expect((await request(service, 'sessions.list') as any[])[0].preview).toBe('Question');
    const session = mocks.starts.mock.calls.at(-1)![1] as EventEmitter;
    session.emit('settled', { text: '**Latest reply**', timestampMs: 1234 });
    expect((await request(service, 'sessions.list') as any[])[0]).toMatchObject({ preview: 'Latest reply', lastActivityAt: 1234 });
  });
  it('clears the ephemeral preview when a Bridge-owned conversation is reset', async () => {
    const { service } = fixture();
    const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: 'Before reset', idempotencyKey: 'reset-preview' });
    const session = mocks.starts.mock.calls.at(-1)![1] as EventEmitter & { activeRun?: unknown };
    session.activeRun = undefined;
    session.emit('settled', { text: 'Old reply', timestampMs: Date.now() });
    await request(service, 'sessions.reset', { sessionKey: row.key });
    expect((await request(service, 'sessions.list') as any[])[0].preview).toBeUndefined();
  });
  it('restores an owned conversation preview from native history after Bridge restart', async () => {
    const { service, open } = fixture();
    const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: 'Old question', idempotencyKey: 'restart-preview' });
    await service.stop();
    mocks.history.mockResolvedValue([{ uuid: 'reply', type: 'assistant', timestamp: '2026-09-27T10:01:00.000Z',
      message: { content: [{ type: 'text', text: 'Recovered answer' }] } }]);
    const restarted = open();
    expect((await request(restarted, 'sessions.list') as any[])[0])
      .toMatchObject({ preview: 'Recovered answer', lastActivityAt: Date.parse('2026-09-27T10:01:00.000Z') });
    await request(restarted, 'sessions.list');
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });
  it('does not create an empty conversation when connecting or reading model choices', async () => {
    const { service } = fixture(); await service.health(); await request(service, 'models.list');
    expect(await request(service, 'sessions.list')).toEqual([]);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it('persists acceptance before sending and retries the same input without another model call, including restart', async () => {
    const { service, open } = fixture();
    const row = await request(service, 'sessions.create') as { key: string };
    const input = { sessionKey: row.key, text: 'remember', idempotencyKey: 'message-once' };
    const first = await request(service, 'chat.send', input);
    expect(await request(service, 'chat.send', input)).toEqual(first);
    await expect(request(service, 'chat.send', { ...input, text: 'changed' })).rejects.toThrow('different content');
    await service.stop(); const restarted = open();
    expect(await request(restarted, 'chat.send', input)).toEqual(first);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('keeps uncertain acceptance after a native send error instead of silently executing twice', async () => {
    const { service } = fixture(); const row = await request(service, 'sessions.create') as { key: string };
    const input = { sessionKey: row.key, text: 'work', idempotencyKey: 'uncertain' };
    mocks.send.mockImplementationOnce(() => { throw new Error('native ended'); });
    await expect(request(service, 'chat.send', input)).rejects.toThrow('native ended');
    await expect(request(service, 'chat.send', input)).resolves.toHaveProperty('runId');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('publishes native question attention and clears it after resolution', async () => {
    const { service } = fixture();
    const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: 'Ask me', idempotencyKey: 'ask' });
    const session = mocks.starts.mock.calls.at(-1)![1] as EventEmitter;
    const updates = vi.fn(); service.on('update', updates);
    session.emit('update', { type: 'question_requested', sessionKey: row.key, question: { id: 'q', kind: 'input', title: 'Answer' } });
    expect((await request(service, 'sessions.list') as any[])[0].attention).toBe('input');
    expect(updates).toHaveBeenCalledWith({ type: 'session_info_update', session: { key: row.key, attention: 'input' } });
    session.emit('update', { type: 'question_resolved', sessionKey: row.key, questionId: 'q' });
    expect((await request(service, 'sessions.list') as any[])[0].attention).toBeNull();
  });

  it('names owned conversations from their first accepted prompt while retaining explicit titles', async () => {
    const { service, open } = fixture();
    const first = await request(service, 'sessions.create') as { key: string };
    const named = await request(service, 'sessions.create', { title: 'My chosen title' }) as { key: string };
    await request(service, 'chat.send', { sessionKey: first.key, text: '  Diagnose the staging build  ', idempotencyKey: 'first-title' });
    await request(service, 'chat.send', { sessionKey: named.key, text: 'Do not replace my title', idempotencyKey: 'named-title' });
    await service.stop();
    const rows = await request(open(), 'sessions.list') as Array<{ key: string; title: string }>;
    expect(rows.find(row => row.key === first.key)?.title).toBe('Diagnose the staging build');
    expect(rows.find(row => row.key === named.key)?.title).toBe('My chosen title');
  });
  it('never resumes an owned transcript while native ownership is unknown or still present', async () => {
    const { service, open } = fixture(); const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: 'first', idempotencyKey: 'first' });
    await service.stop(); const restarted = open(); mocks.roster.mockResolvedValue({ known: false, owners: [] });
    await expect(request(restarted, 'chat.send', { sessionKey: row.key, text: 'next', idempotencyKey: 'next' })).rejects.toThrow('Could not verify');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('creates in the explicitly selected discovered project and rejects arbitrary project IDs', async () => {
    const { service } = fixture(true);
    const other = fixture().project;
    mocks.list.mockResolvedValue([{ sessionId: randomUUID(), cwd: other, summary: 'Other project', lastModified: 1 }]);
    const projects = await request(service, 'projects.list') as Array<{ id: string; path: string }>;
    const selected = projects.find(project => project.path === other)!;
    expect(selected).toBeDefined();
    const row = await request(service, 'sessions.create', { projectId: selected.id }) as { project: { path: string } };
    expect(row.project.path).toBe(other);
    await expect(request(service, 'sessions.create', { projectId: '/arbitrary/client/path' })).rejects.toThrow('Unknown Claude project');
  });

  it('imports native history read-only and forks only the discovered source in its original project', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID(), forkId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native work', lastModified: 1 }]); mocks.fork.mockResolvedValue({ sessionId: forkId });
    mocks.roster.mockResolvedValue({ known: true, owners: [{ sessionId: nativeId, status: 'idle' }] });
    const rows = await request(service, 'sessions.list') as { key: string }[];
    await expect(request(service, 'chat.send', { sessionKey: rows[0].key, text: 'write', idempotencyKey: 'bad' })).rejects.toThrow('unavailable for continuation');
    await expect(request(service, 'sessions.create', { fromSession: 'arbitrary-id' })).rejects.toThrow('Unknown');
    const fork = await request(service, 'sessions.create', { fromSession: rows[0].key }) as { source: string; project: { path: string } };
    expect(fork).toMatchObject({ source: 'bridge', project: { path: project } });
    expect(mocks.fork).toHaveBeenCalledWith(nativeId, { dir: project, title: 'Native work' });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('stops a question through native interruption and keeps consent pending until native settlement', async () => {
    const { service } = fixture(); const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: 'Ask me', idempotencyKey: 'question' });
    mocks.questions.mockReturnValue([{ id: 'pending' }]);
    await expect(request(service, 'questions.respond', { sessionKey: row.key, questionId: 'stale', cancelled: true })).rejects.toThrow('no longer pending');
    expect(mocks.interrupt).not.toHaveBeenCalled();
    await request(service, 'questions.respond', { sessionKey: row.key, questionId: 'pending', cancelled: true });
    expect(mocks.interrupt).toHaveBeenCalledWith(mocks.send.mock.calls[0][0]);
    expect(await request(service, 'questions.list', { sessionKey: row.key })).toEqual([{ id: 'pending' }]);
  });

  it('continues a released native session with the same key, native id and cwd, without forking; restart retries do not duplicate', async () => {
    const { project, service, open } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string; canContinue: boolean }>;
    expect(row.canContinue).toBe(true);
    const input = { sessionKey: row.key, text: 'continue original', idempotencyKey: 'native-once' };
    const sent = await request(service, 'chat.send', input);
    expect(mocks.starts).toHaveBeenLastCalledWith(expect.objectContaining({ key: row.key, cwd: project, resume: nativeId }), expect.anything());
    expect(mocks.fork).not.toHaveBeenCalled();
    expect(await request(service, 'sessions.list')).toEqual([expect.objectContaining({ key: row.key, source: 'native', allowedActions: { rename: false, reset: false, delete: false, pin: true } })]);
    for (const method of ['sessions.rename', 'sessions.reset', 'sessions.delete']) {
      await expect(request(service, method, { sessionKey: row.key, title: 'change' })).rejects.toThrow('Native');
    }
    await service.stop(); const restarted = open();
    expect(await request(restarted, 'chat.send', input)).toEqual(sent);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await request(restarted, 'chat.send', { ...input, idempotencyKey: 'native-two' });
    expect(mocks.starts.mock.calls.at(-1)?.[0].resume).toBe(nativeId);
  });
  it('prefers a newer native reply over the last phone preview without rereading an unchanged transcript', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native title', lastModified: 1 }]);
    mocks.history.mockResolvedValue([{ uuid: 'first', type: 'user', timestamp: '2026-09-27T08:00:00.000Z', message: { content: 'Original' } }]);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string; preview: string }>;
    expect(row.preview).toBe('Original');
    await request(service, 'chat.send', { sessionKey: row.key, text: 'Phone turn', idempotencyKey: 'native-preview' });
    expect((await request(service, 'sessions.list') as any[])[0].preview).toBe('Phone turn');
    const session = mocks.starts.mock.calls.at(-1)![1] as EventEmitter & { activeRun?: unknown };
    session.activeRun = undefined;
    session.emit('settled', { text: 'Phone reply', timestampMs: Date.now() });
    const desktopTime = Date.now() + 60_000;
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native title', lastModified: 2 }]);
    mocks.history.mockResolvedValue([{ uuid: 'later', type: 'assistant', timestamp: new Date(desktopTime).toISOString(), message: { content: 'Desktop reply' } }]);
    expect((await request(service, 'sessions.list') as any[])[0].preview).toBe('Desktop reply');
    await request(service, 'sessions.list');
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });

  it.each(['busy', 'idle', 'waiting', 'unknown'])('keeps %s native owners read-only with a precise reason', async status => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    mocks.roster.mockResolvedValue({ known: true, owners: [{ sessionId: nativeId, status }] });
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    expect(row).toMatchObject({ canContinue: false, continuationBlockedReason: 'in_use' });
    await expect(request(service, 'chat.send', { sessionKey: row.key, text: 'no', idempotencyKey: 'blocked' })).rejects.toThrow();
    expect(mocks.starts).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rechecks native ownership immediately before resume even when discovery said available', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    mocks.roster.mockResolvedValueOnce({ known: true, owners: [] }).mockResolvedValue({ known: true, owners: [{ sessionId: nativeId, status: 'idle' }] });
    await expect(request(service, 'chat.send', { sessionKey: row.key, text: 'no', idempotencyKey: 'raced' })).rejects.toThrow('still open');
    expect(mocks.starts).not.toHaveBeenCalled();
    mocks.roster.mockResolvedValue({ known: true, owners: [] });
    await request(service, 'chat.send', { sessionKey: row.key, text: 'yes', idempotencyKey: 'raced' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('unknown owners fail closed and a history refresh publishes newly released input state', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    mocks.roster.mockResolvedValue({ known: false, owners: [] });
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    expect(row).toMatchObject({ canContinue: false, continuationBlockedReason: 'ownership_unknown' });
    const update = vi.fn(); service.on('update', update);
    mocks.roster.mockResolvedValue({ known: true, owners: [] });
    await request(service, 'chat.history', { sessionKey: row.key });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ type: 'session_info_update', session: expect.objectContaining({ key: row.key, canContinue: true }) }));
  });

  it('excludes a second Bridge writer even when native roster has not registered the first process yet', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    const second = new ClaudeService({ project, directory: join(project, 'second'), ownershipDirectory: join(project, 'writers'), executable: '/unused/claude' }); services.push(second);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    await request(service, 'chat.send', { sessionKey: row.key, text: 'one', idempotencyKey: 'one' });
    await expect(request(second, 'chat.send', { sessionKey: row.key, text: 'two', idempotencyKey: 'two' })).rejects.toThrow('another Clawket Bridge');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await service.stop();
    await request(second, 'chat.send', { sessionKey: row.key, text: 'two', idempotencyKey: 'two' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('releases the imported native process after settlement and resumes on the next turn', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    await request(service, 'chat.send', { sessionKey: row.key, text: 'one', idempotencyKey: 'one' });
    const running = mocks.starts.mock.calls.at(-1)![1]; running.activeRun = undefined; running.emit('settled');
    await request(service, 'chat.send', { sessionKey: row.key, text: 'two', idempotencyKey: 'two' });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.starts).toHaveBeenCalledTimes(2);
    expect(mocks.starts.mock.calls.at(-1)![0].resume).toBe(nativeId);
  });

  it('does not resume native conversations merely to display the model catalog', async () => {
    const { project, service } = fixture(); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 10 }]);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    await request(service, 'models.list', { sessionKey: row.key });
    expect(mocks.starts.mock.calls.at(-1)![0]).toMatchObject({ key: 'model-catalog' });
    expect(mocks.starts.mock.calls.at(-1)![0].resume).toBeUndefined();
    await request(service, 'chat.send', { sessionKey: row.key, text: 'first', idempotencyKey: 'first' });
    await request(service, 'models.list', { sessionKey: row.key });
    expect(mocks.starts.mock.calls.at(-1)![0].resume).toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('keeps missing project histories visible but unavailable for original continuation', async () => {
    const { project, service } = fixture(true); const nativeId = randomUUID();
    mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: join(project, 'missing'), summary: 'Native', lastModified: 10 }]);
    const [row] = await request(service, 'sessions.list') as Array<{ key: string }>;
    expect(row).toMatchObject({ canContinue: false, continuationBlockedReason: 'project_unavailable' });
    await expect(request(service, 'chat.send', { sessionKey: row.key, text: 'no', idempotencyKey: 'no' })).rejects.toThrow();
    expect(mocks.starts).not.toHaveBeenCalled();
  });

});

it('serves assistant-delivered native Claude attachments inside their actual project without resuming a writer', async () => {
  const { service, project } = fixture();
  writeFileSync(join(project, 'report.txt'), 'Claude attachment');
  mocks.list.mockResolvedValue([{ sessionId: randomUUID(), cwd: project, summary: 'Native', lastModified: 1 }]);
  mocks.history.mockResolvedValue([{ uuid: 'reply', type: 'assistant', message: { content: '[Report](report.txt)' } }]);
  const rows = await request(service, 'sessions.list') as any[];
  const key = rows.find(row => row.source === 'native').key;
  const history = await request(service, 'chat.history', { sessionKey: key }) as any;
  const artifactId = history.messages[0].attachments[0].artifactId;
  const file = await request(service, 'clawket.artifacts.open', { sessionKey: key, artifactId }) as any;
  expect(Buffer.from((await request(service, 'clawket.artifacts.read', { sessionKey: key, id: file.id, offset: 0 }) as any).data, 'base64').toString()).toBe('Claude attachment');
  expect(mocks.starts).not.toHaveBeenCalled();
  await expect(request(service, 'clawket.artifacts.read', { sessionKey: 'other', id: file.id, offset: 0 })).rejects.toThrow();
});


it('projects native busy/idle/waiting/unknown without changing ownership or starting an SDK session', async () => {
  const { service, project } = fixture();
  const nativeId = randomUUID(); mocks.list.mockResolvedValue([{ sessionId: nativeId, cwd: project, summary: 'Native', lastModified: 1 }]);
  const rows = await request(service, 'sessions.list') as any[];
  const key = rows[0].key; mocks.history.mockClear();
  for (const [status, state] of [['busy', 'running'], ['idle', 'idle'], ['waiting', 'waiting'], ['unknown', 'unknown']]) {
    mocks.roster.mockResolvedValue({ known: true, owners: [{ sessionId: nativeId, status }] });
    expect(await request(service, 'sessions.activity', { keys: [key] })).toEqual([{ key, state }]);
    const listed = await request(service, 'sessions.list') as any[];
    expect(listed[0].hasActiveRun).toBe(status === 'busy');
    expect(listed[0].canContinue).toBe(false); // An idle owner still owns the native thread.
  }
  mocks.roster.mockResolvedValue({ known: false, owners: [] });
  expect(await request(service, 'sessions.activity', { keys: [key, 'missing'] })).toEqual([{ key, state: 'unknown' }, { key: 'missing', state: 'unknown' }]);
  expect(mocks.starts).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  await expect(request(service, 'sessions.activity', { keys: ['same', 'same'] })).rejects.toThrow('Invalid session activity request');
});

it('reports package version and protects active work before fencing update admission', async () => {
  const { service: subject } = fixture();
  (subject as any).options.bridgeVersion = '3.1.11';
  expect(await subject.request({ type: 'req', id: 'version', method: 'health' })).toMatchObject({ backend: 'claude-code', bridgeVersion: '3.1.11' });
  (subject as any).sessions.set('update-test', { activeRun: {} });
  expect(subject.prepareForUpdate()).toBe(false);
  (subject as any).sessions.delete('update-test');
  // The ordinary fixture may have a real idle native process; those remain restartable.
  expect(subject.prepareForUpdate()).toBe(true);
  await expect(subject.request({ type: 'req', id: 'after', method: 'sessions.list' })).rejects.toThrow('restarting');
});
