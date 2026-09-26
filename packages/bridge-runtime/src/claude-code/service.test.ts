import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn(), roster: vi.fn(), list: vi.fn(), history: vi.fn(), info: vi.fn(), fork: vi.fn(), questions: vi.fn(), interrupt: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ listSessions: mocks.list, getSessionMessages: mocks.history, getSessionInfo: mocks.info, forkSession: mocks.fork }));
vi.mock('./saved-projects.js', () => ({ savedClaudeProjects: async () => [] }));
vi.mock('./owners.js', () => ({ ClaudeOwners: class { snapshot = mocks.roster; } }));
vi.mock('./session.js', () => ({ claudePromptContent: (input: { text: string }) => { if (!input.text.trim()) throw new Error('empty'); },
  ClaudeSession: class extends EventEmitter {
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
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'clawket-claude-service-'))); dirs.push(project);
  const options = { project, directory: join(project, 'state'), executable: '/unused/claude', device };
  const open = () => { const service = new ClaudeService(options); services.push(service); return service; };
  return { project, open, service: open() };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.questions.mockReturnValue([]); mocks.interrupt.mockResolvedValue(undefined); mocks.list.mockResolvedValue([]); mocks.history.mockResolvedValue([]);
  mocks.roster.mockResolvedValue({ known: true, owners: [] }); mocks.info.mockResolvedValue({}); mocks.send.mockReset();
});
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('Claude service durable send and ownership boundary', () => {
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
  it('never resumes an owned transcript while native ownership is unknown or still present', async () => {
    const { service, open } = fixture(); const row = await request(service, 'sessions.create') as { key: string };
    await request(service, 'chat.send', { sessionKey: row.key, text: 'first', idempotencyKey: 'first' });
    await service.stop(); const restarted = open(); mocks.roster.mockResolvedValue({ known: false, owners: [] });
    await expect(request(restarted, 'chat.send', { sessionKey: row.key, text: 'next', idempotencyKey: 'next' })).rejects.toThrow('still be open');
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
    const rows = await request(service, 'sessions.list') as { key: string }[];
    await expect(request(service, 'chat.send', { sessionKey: rows[0].key, text: 'write', idempotencyKey: 'bad' })).rejects.toThrow('read-only');
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

});
