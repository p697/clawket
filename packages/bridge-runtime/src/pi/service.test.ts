import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PiService } from './service.js';

const { children } = vi.hoisted(() => ({ children: [] as any[] }));
vi.mock('./rpc.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { PiRpc: class extends EventEmitter {
    sent: any[] = []; streaming = false; holdPrompt = false; leafId: string | null = null;
    constructor() { super(); children.push(this); }
    async request(type: string, params: any = {}) {
      this.sent.push({ type, ...params });
      if (type === 'get_state') return { model: { id: 'test', provider: 'fixture', input: ['text'] }, isStreaming: this.streaming };
      if (type === 'get_entries') return { entries: [], leafId: this.leafId };
      if (type === 'prompt' && this.holdPrompt) return new Promise(() => {});
      if (type === 'prompt') { this.streaming = true; this.emit('event', { type: 'agent_start' }); }
      if (type === 'abort') { this.streaming = false; this.emit('event', { type: 'agent_settled' }); }
      return {};
    }
    send(frame: any) { this.sent.push(frame); }
    async stop() { this.emit('exit'); }
  } };
});
let root: string | undefined; let service: PiService | undefined;
afterEach(async () => { await service?.stop(); if (root) rmSync(root, { recursive: true, force: true }); children.length = 0; });
function setup() {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'clawket-pi-unit-')));
  service = new PiService({ project: root, directory: join(root, 'bridge'), agentDirectory: join(root, 'agent') }); return service;
}
const request = (method: string, params: any = {}) => service!.request({ type: 'req', id: 'test', method, params }) as Promise<any>;
it('identifies the landing conversation as main so free clients can chat immediately', async () => {
  setup();
  const [agent] = await request('agents.list');
  const [landing] = await request('sessions.list');
  expect(landing).toMatchObject({ key: agent.mainSessionKey, kind: 'main' });
  const created = await request('sessions.create', { title: 'Another task' });
  expect(created.kind).toBe('direct');
  expect((await request('sessions.list')).filter((session: any) => session.kind === 'main')).toHaveLength(1);
});
it('persists acceptance, serializes concurrent sends, and never replays duplicate inputs after restart', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  const p = { sessionKey: key, text: 'hello', idempotencyKey: '__proto__' };
  const [one, two] = await Promise.all([request('chat.send', p), request('chat.send', p)]);
  expect(one).toEqual(two); expect(children[0].sent.filter((r: any) => r.type === 'prompt')).toHaveLength(1);
  await expect(request('chat.send', { ...p, text: 'different' })).rejects.toThrow('different content');
  await expect(request('chat.send', { ...p, idempotencyKey: 'other' })).rejects.toThrow('busy');
  await service!.stop(); service = new PiService({ project: root!, directory: join(root!, 'bridge'), agentDirectory: join(root!, 'agent') });
  expect(await request('chat.send', p)).toEqual(one); expect(children[1].sent.filter((r: any) => r.type === 'prompt')).toHaveLength(0);
});
it('clears reset transcript previews and stale model metadata without discarding deduplication keys', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  const input = { sessionKey: key, text: 'old preview', idempotencyKey: 'before-reset' };
  const accepted = await request('chat.send', input);
  children[0].streaming = false; children[0].emit('event', { type: 'agent_settled' });
  await request('sessions.reset', { sessionKey: key });
  expect((await request('sessions.list'))[0]).toMatchObject({ preview: undefined, model: undefined, modelProvider: undefined, lastActivityAt: null });
  expect(await request('chat.send', input)).toEqual(accepted);
});
it('retains a run across agent_end and compaction until agent_settled', async () => {
  setup(); const events: any[] = []; service!.on('update', e => events.push(e));
  const key = (await request('sessions.list'))[0].key; const run = await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'one' });
  children[0].emit('event', { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' \n' } });
  children[0].streaming = false;
  children[0].emit('event', { type: 'agent_end' }); children[0].emit('event', { type: 'auto_compaction_start' });
  expect((await request('chat.history', { sessionKey: key })).activeRun).toMatchObject({ runId: run.runId, text: ' \n' });
  expect(events.filter(e => e.type === 'run_finished')).toHaveLength(0);
  children[0].emit('event', { type: 'agent_settled' }); children[0].emit('event', { type: 'agent_settled' });
  expect(events.filter(e => e.type === 'run_finished')).toHaveLength(1);
});
it('keeps extension questions scoped, validates choices, and rejects stale or duplicate answers', async () => {
  setup(); const key = (await request('sessions.list'))[0].key; await request('chat.send', { sessionKey: key, text: 'hello', idempotencyKey: 'one' });
  children[0].emit('event', { type: 'extension_ui_request', id: 'q', method: 'select', title: 'Pick', options: ['One', 'Two'] });
  expect(await request('questions.list', { sessionKey: key })).toHaveLength(1);
  await expect(request('questions.respond', { sessionKey: key, questionId: 'q', value: 'forged' })).rejects.toThrow('Invalid response');
  await expect(request('questions.respond', { sessionKey: 'other', questionId: 'q', value: 'One' })).rejects.toThrow();
  await request('questions.respond', { sessionKey: key, questionId: 'q', value: 'Two' });
  expect(children[0].sent.at(-1)).toMatchObject({ type: 'extension_ui_response', value: 'Two' });
  await expect(request('questions.respond', { sessionKey: key, questionId: 'q', value: 'One' })).rejects.toThrow('no longer pending');
});
it('rejects arbitrary paths, unsupported RPC operations, malformed prompts, and model changes while busy', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  for (const method of ['switch_session', 'bash', 'get_entries', 'sessions.open']) await expect(request(method, { sessionPath: '/private' })).rejects.toThrow('Unsupported');
  await expect(request('sessions.create', { fromSession: '/tmp/private' })).rejects.toThrow('no longer available');
  await expect(request('chat.send', { sessionKey: key, text: 'x', idempotencyKey: 'x', attachments: [{}] })).rejects.toThrow('image attachments');
  await request('chat.send', { sessionKey: key, text: 'x', idempotencyKey: 'x' });
  await expect(request('models.select', { sessionKey: key, scope: 'session', provider: 'fixture', model: 'two' })).rejects.toThrow('Stop the task');
  await expect(request('chat.abort', { sessionKey: key, runId: 'other' })).rejects.toThrow('Task changed');
  await request('chat.abort', { sessionKey: key }); expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(false);
});
it('prevents multiple owners and keeps private/native data separate', async () => {
  setup(); expect(() => new PiService({ project: root!, directory: join(root!, 'bridge') })).toThrow('already managed');
  const stored = JSON.parse(readFileSync(join(root!, 'bridge', 'sessions.json'), 'utf8'));
  expect(stored.sessions[0]).not.toHaveProperty('messages'); expect(stored.project).toBe(root);
});

it('validates corrupted local indexes on startup', async () => {
  setup(); await service!.stop();
  const path = join(root!, 'bridge', 'sessions.json'); const index = JSON.parse(readFileSync(path, 'utf8'));
  index.sessions[0].keys = null; writeFileSync(path, JSON.stringify(index));
  expect(() => new PiService({ project: root!, directory: join(root!, 'bridge') })).toThrow('Invalid Pi session index');
});
it('rejects expired answers, cancels oversized dialogs and serializes reset before a subsequent send', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('chat.history', { sessionKey: key });
  children[0].emit('event', { type: 'extension_ui_request', id: 'expired', method: 'input', timeout: -1 });
  await expect(request('questions.respond', { sessionKey: key, questionId: 'expired', value: 'late' })).rejects.toThrow('no longer pending');
  children[0].emit('event', { type: 'extension_ui_request', id: 'large', method: 'editor', prefill: 'x'.repeat(129000) });
  expect(children[0].sent.at(-1)).toMatchObject({ id: 'large', cancelled: true });
  const [reset, sent] = await Promise.all([request('sessions.reset', { sessionKey: key }), request('chat.send', { sessionKey: key, text: 'after reset', idempotencyKey: 'after' })]);
  expect(reset).toEqual({ ok: true }); expect(sent.runId).toBeTruthy(); expect(children).toHaveLength(2);
});

it('reads large persisted history locally and asks RPC only for the unflushed tail', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('health'); children[0].leafId = 'large';
  const stored = JSON.parse(readFileSync(join(root!, 'bridge', 'sessions.json'), 'utf8'));
  appendFileSync(join(root!, 'bridge', stored.sessions[0].file), JSON.stringify({ id: 'large', parentId: null, type: 'message', message: { role: 'user', content: 'x'.repeat(17 * 1024 * 1024) } }) + '\n');
  const history = await request('chat.history', { sessionKey: key });
  expect(children[0].sent).toContainEqual({ type: 'get_entries', since: 'large' });
  expect(history.messages[0].text).toHaveLength(128000);
});

it('keeps reconnect health available when all eight non-landing sessions are running', async () => {
  setup();
  for (let index = 0; index < 8; index++) {
    const session = await request('sessions.create');
    await request('chat.send', { sessionKey: session.key, text: 'busy', idempotencyKey: `busy-${index}` });
  }
  expect(await request('health')).toMatchObject({ backend: 'pi' });
  expect(children).toHaveLength(8);
  const ninth = await request('sessions.create');
  await expect(request('chat.send', { sessionKey: ninth.key, text: 'busy', idempotencyKey: 'nine' })).rejects.toThrow('Eight Pi sessions are busy');
});

it('restores a pending extension input after older history without persisting or duplicating native turns', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('chat.history', { sessionKey: key }); children[0].holdPrompt = true;
  const file = join(root!, 'bridge', `${key}.jsonl`);
  appendFileSync(file, JSON.stringify({ type: 'message', id: 'old', parentId: null, message: { role: 'assistant', content: 'Previous completed task', timestamp: 1 } }) + '\n');
  children[0].leafId = 'old';
  const before = readFileSync(file, 'utf8');
  await request('chat.send', { sessionKey: key, text: '/question', idempotencyKey: 'extension' });
  const history = await request('chat.history', { sessionKey: key });
  expect(history.messages.map((m: any) => m.text)).toEqual(['Previous completed task', '/question']);
  expect(history.messages.at(-1)).toMatchObject({ role: 'user', timestampMs: history.activeRun.startedAtMs });
  expect(readFileSync(file, 'utf8')).toBe(before);
  children[0].emit('event', { type: 'agent_start' });
  expect((await request('chat.history', { sessionKey: key })).messages).toHaveLength(1);
  children[0].emit('event', { type: 'agent_settled' });
  expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(false);
});
