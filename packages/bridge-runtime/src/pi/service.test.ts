import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, realpathSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PiService } from './service.js';
import { nativePiDirectory } from './paths.js';

const { children } = vi.hoisted(() => ({ children: [] as any[] }));
vi.mock('./rpc.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { PiRpc: class extends EventEmitter {
    sent: any[] = []; streaming = false; holdPrompt = false; leafId: string | null = null;
    entries: any[] = []; sessionId = 'native-session'; acknowledgeFirst = true;
    constructor() { super(); children.push(this); }
    async request(type: string, params: any = {}, options: any = {}) {
      this.sent.push({ type, ...params });
      if (type === 'get_state') return { model: { id: 'test', provider: 'fixture', input: ['text'] }, isStreaming: this.streaming, sessionId: this.sessionId };
      if (type === 'get_entries') return { entries: params.since ? this.entries.slice(this.entries.findIndex(e => e.id === params.since) + 1) : this.entries, leafId: this.leafId };
      if (type === 'prompt' && this.holdPrompt) return new Promise(() => {});
      if (type === 'prompt') { this.streaming = true; if (this.acknowledgeFirst) options.onSuccess?.(); this.emit('event', { type: 'agent_start' }); if (!this.acknowledgeFirst) options.onSuccess?.(); }
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
it('sync preserves a temporarily unreadable native row, updates other rows, and removes only a confirmed missing file', async () => {
  setup();
  const dir = nativePiDirectory(root!, join(root!, 'agent')); mkdirSync(dir, { recursive: true });
  const transcript = (name: string) => JSON.stringify({ type: 'session', version: 3, cwd: root }) + '\n'
    + JSON.stringify({ type: 'session_info', name }) + '\n';
  writeFileSync(join(dir, 'a.jsonl'), transcript('A'));
  writeFileSync(join(dir, 'b.jsonl'), transcript('B'));
  const first = await request('sessions.sync'), base = { epoch: first.epoch, revision: first.revision };
  const a = first.sessions.find((row: any) => row.title === 'A');
  expect(await request('health')).toMatchObject({ sessionCatalogSync: 1 });
  writeFileSync(join(dir, 'a.jsonl'), 'broken\nalso broken\n');
  writeFileSync(join(dir, 'b.jsonl'), transcript('B changed'));
  const changed = await request('sessions.sync', { base });
  const current = changed.kind === 'full' ? changed.sessions : changed.upserts;
  expect(current.some((row: any) => row.title === 'B changed')).toBe(true);
  expect(changed.removedKeys ?? []).not.toContain(a.key);
  const all = await request('sessions.sync');
  expect(all.sessions).toContainEqual(a);
  expect((await request('sessions.list')).some((row: any) => row.key === a.key)).toBe(false);
  unlinkSync(join(dir, 'a.jsonl'));
  const deleted = await request('sessions.sync');
  expect(deleted.sessions.some((row: any) => row.key === a.key)).toBe(false);
});
it('sync does not advance its revision when native directory enumeration fails', async () => {
  setup(); const dir = nativePiDirectory(root!, join(root!, 'agent')); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.jsonl'), JSON.stringify({ type: 'session', version: 3, cwd: root }) + '\n');
  const first = await request('sessions.sync'), base = { epoch: first.epoch, revision: first.revision };
  renameSync(dir, dir + '-saved'); writeFileSync(dir, 'not a directory');
  await expect(request('sessions.sync', { base })).rejects.toThrow('Conversation catalog could not be refreshed completely');
  expect(await request('sessions.sync', { page: { ...base, offset: 0 } })).toEqual(first);
  unlinkSync(dir); renameSync(dir + '-saved', dir);
  expect(await request('sessions.sync', { base })).toEqual({ kind: 'unchanged', ...base });
});
it('sync retains a known native row that slides outside the 200-file read window', async () => {
  setup(); const dir = nativePiDirectory(root!, join(root!, 'agent')); mkdirSync(dir, { recursive: true });
  const content = JSON.stringify({ type: 'session', version: 3, cwd: root }) + '\n';
  writeFileSync(join(dir, '000-known.jsonl'), content);
  const first = await request('sessions.sync'), native = first.sessions.find((row: any) => row.source === 'native');
  for (let index = 0; index < 200; index++) writeFileSync(join(dir, `z-${String(index).padStart(3, '0')}.jsonl`), content);
  let second = await request('sessions.sync');
  const rows = [...second.sessions];
  while (second.nextOffset !== null) {
    second = await request('sessions.sync', { page: { epoch: second.epoch, revision: second.revision, offset: second.nextOffset } });
    rows.push(...second.sessions);
  }
  expect(rows).toContainEqual(native);
  expect(rows.filter((row: any) => row.source === 'native')).toHaveLength(201);
  expect((await request('sessions.list')).filter((row: any) => row.source === 'native')).toHaveLength(200);
});
it('does not record or dispatch a prompt when an extension starts work during the checkpoint', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('health'); const child = children[0];
  const nativeRequest = child.request.bind(child);
  let started = false;
  vi.spyOn(child, 'request').mockImplementation(async (type: any, params: any, options: any) => {
    if (type === 'get_entries' && !started) {
      started = true; child.streaming = true; child.emit('event', { type: 'agent_start' });
    }
    return nativeRequest(type, params, options);
  });
  const input = { sessionKey: key, text: 'new input', idempotencyKey: 'raced-extension' };
  await expect(request('chat.send', input)).rejects.toThrow('busy');
  expect(await request('chat.promptStatus', input)).toEqual({ status: 'unknown' });
  expect(child.sent.some((row: any) => row.type === 'prompt')).toBe(false);
  expect((await request('chat.history', { sessionKey: key })).hasActiveRun).toBe(true);
});
it('ignores malformed legacy receipt metadata when projecting owned history', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await service!.stop(); children.length = 0;
  const indexPath = join(root!, 'bridge', 'sessions.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.sessions[0].keys = { badNull: null, badString: 'bad', badNumber: 1,
    forgedIdentity: { nativeEntryId: 'user', nativeFile: `${key}.jsonl` } };
  writeFileSync(indexPath, JSON.stringify(index));
  appendFileSync(join(root!, 'bridge', `${key}.jsonl`), JSON.stringify({ type: 'message', id: 'user', parentId: null, message: { role: 'user', content: 'existing history' } }) + '\n');
  service = new PiService({ project: root!, directory: join(root!, 'bridge'), agentDirectory: join(root!, 'agent') });
  await request('health'); children[0].leafId = 'user';
  const history = await request('chat.history', { sessionKey: key });
  expect(history.messages).toHaveLength(1);
  expect(history.messages[0]).not.toHaveProperty('idempotencyKey');
  expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'badNull' })).toEqual({ status: 'unknown' });
});
it('does not restart a stopped Pi process when an identity checkpoint resolves late', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('chat.send', { sessionKey: key, text: 'pending native receipt', idempotencyKey: 'late' });
  const child = children[0], nativeRequest = child.request.bind(child);
  let resolve!: (result: any) => void;
  vi.spyOn(child, 'request').mockImplementation((type: any, params: any, options: any) => type === 'get_entries'
    ? new Promise(done => { resolve = done; }) : nativeRequest(type, params, options));
  child.emit('event', { type: 'message_end', message: { role: 'user', content: 'native' } });
  await service!.stop();
  const reads = child.sent.filter((row: any) => row.type === 'get_state').length;
  resolve({ entries: [{ type: 'message', id: 'native', parentId: null, message: { role: 'user' } }], leafId: 'native' });
  await Promise.resolve(); await Promise.resolve();
  expect(child.sent.filter((row: any) => row.type === 'get_state')).toHaveLength(reads);
});
it('persists exact native user IDs for owned prompts, including identical text, without copying transcript content', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  const file = join(root!, 'bridge', `${key}.jsonl`);
  for (let index = 1; index <= 2; index++) {
    await request('chat.send', { sessionKey: key, text: 'identical input', idempotencyKey: `send-${index}` });
    const child = children[0];
    const entry = { type: 'message', id: `native-${index}`, parentId: child.leafId, message: { role: 'user', content: 'extension-transformed input', timestamp: 1 } };
    child.entries.push(entry); child.leafId = entry.id;
    appendFileSync(file, JSON.stringify(entry) + '\n');
    child.emit('event', { type: 'message_end', message: entry.message });
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages.at(-1)).toMatchObject({ id: entry.id, idempotencyKey: `send-${index}` });
    child.streaming = false; child.emit('event', { type: 'agent_settled' });
  }
  const before = readFileSync(file, 'utf8');
  const index = JSON.parse(readFileSync(join(root!, 'bridge', 'sessions.json'), 'utf8'));
  expect(index.sessions[0].keys['send-1']).toMatchObject({ nativeEntryId: 'native-1', nativeFile: `${key}.jsonl` });
  expect(index.sessions[0].keys['send-1']).not.toHaveProperty('text');
  await service!.stop(); children.length = 0;
  service = new PiService({ project: root!, directory: join(root!, 'bridge'), agentDirectory: join(root!, 'agent') });
  await request('health'); children[0].leafId = 'native-2';
  const recovered = await request('chat.history', { sessionKey: key });
  expect(recovered.messages.map((m: any) => m.idempotencyKey)).toEqual(['send-1', 'send-2']);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(children[0].sent.some((row: any) => row.type === 'prompt')).toBe(false);
});
it.each(['preflight-order', 'multiple-users', 'session-changed', 'different-branch'])(
  'keeps ambiguous Pi native identity unconfirmed: %s', async mode => {
    setup(); const key = (await request('sessions.list'))[0].key;
    await request('health'); const child = children[0];
    if (mode === 'preflight-order') child.acknowledgeFirst = false;
    await request('chat.send', { sessionKey: key, text: 'same text', idempotencyKey: 'uncertain' });
    const entry = { type: 'message', id: 'native-user', parentId: mode === 'different-branch' ? 'unknown-parent' : null, message: { role: 'user', content: 'same text', timestamp: 1 } };
    child.entries.push(entry); child.leafId = entry.id;
    if (mode === 'multiple-users') { child.entries.push({ ...entry, id: 'other-user', parentId: entry.id }); child.leafId = 'other-user'; }
    if (mode === 'session-changed') child.sessionId = 'another-session';
    child.emit('event', { type: 'message_end', message: entry.message });
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages.every((m: any) => m.idempotencyKey === undefined)).toBe(true);
    expect(await request('chat.promptStatus', { sessionKey: key, idempotencyKey: 'uncertain' })).toMatchObject({ status: 'recorded' });
  },
);
it('answers scoped persisted receipt queries after restart without creating a Pi process or replaying input', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  const input = { sessionKey: key, text: 'receipt', idempotencyKey: '__proto__' };
  expect(await request('chat.promptStatus', input)).toEqual({ status: 'unknown' });
  expect(children).toHaveLength(0);
  const sent = await request('chat.send', input);
  await service!.stop(); children.length = 0;
  service = new PiService({ project: root!, directory: join(root!, 'bridge'), agentDirectory: join(root!, 'agent') });
  expect(await request('chat.promptStatus', input)).toEqual({ status: 'recorded', runId: sent.runId });
  expect(await request('chat.promptStatus', { ...input, sessionKey: 'other' })).toEqual({ status: 'unknown' });
  expect(await request('chat.promptStatus', { ...input, idempotencyKey: 'constructor' })).toEqual({ status: 'unknown' });
  await expect(request('chat.promptStatus', { ...input, idempotencyKey: '' })).rejects.toThrow('Invalid');
  expect(children).toHaveLength(0);
});
it('does not report a receipt or dispatch when acceptance persistence fails', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  const input = { sessionKey: key, text: 'receipt', idempotencyKey: 'save-failed' };
  const save = vi.spyOn(service as any, 'save').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
  await expect(request('chat.send', input)).rejects.toThrow('storage unavailable');
  expect(await request('chat.promptStatus', input)).toEqual({ status: 'unknown' });
  expect(children[0].sent.some((row: any) => row.type === 'prompt')).toBe(false);
  save.mockRestore();
  const sent = await request('chat.send', input);
  expect(await request('chat.promptStatus', input)).toEqual({ status: 'recorded', runId: sent.runId });
});
it('identifies the landing conversation as main so free clients can chat immediately', async () => {
  setup();
  const [agent] = await request('agents.list');
  const [landing] = await request('sessions.list');
  expect(landing).toMatchObject({ key: agent.mainSessionKey, kind: 'main' });
  const created = await request('sessions.create', { title: 'Another task' });
  expect(created.kind).toBe('direct');
  expect((await request('sessions.list')).filter((session: any) => session.kind === 'main')).toHaveLength(1);
});
it('updates a conversation preview from the accepted user turn to the completed assistant reply', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('chat.send', { sessionKey: key, text: '## Question', idempotencyKey: 'preview' });
  expect((await request('sessions.list'))[0].preview).toBe('Question');
  children[0].emit('event', { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '**Answer**' }] } });
  children[0].emit('event', { type: 'agent_settled' });
  expect((await request('sessions.list'))[0].preview).toBe('Answer');
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
  expect((await request('sessions.list')).find((row: any) => row.key === key).attention).toBe('input');
  await expect(request('questions.respond', { sessionKey: key, questionId: 'q', value: 'forged' })).rejects.toThrow('Invalid response');
  await expect(request('questions.respond', { sessionKey: 'other', questionId: 'q', value: 'One' })).rejects.toThrow();
  await request('questions.respond', { sessionKey: key, questionId: 'q', value: 'Two' });
  expect(children[0].sent.at(-1)).toMatchObject({ type: 'extension_ui_response', value: 'Two' });
  expect((await request('sessions.list')).find((row: any) => row.key === key).attention).toBeNull();
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

it('projects assistant-delivered files from the Pi project and serves authenticated session-scoped chunks', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  writeFileSync(join(root!, 'report.txt'), 'Pi attachment');
  await request('chat.history', { sessionKey: key });
  children[0].entries = [{ id: 'reply', parentId: null, message: { role: 'assistant', content: '[Report](report.txt)' } }]; children[0].leafId = 'reply';
  const history = await request('chat.history', { sessionKey: key });
  const artifactId = history.messages[0].attachments[0].artifactId;
  expect(await request('health')).toMatchObject({ artifacts: true });
  const file = await request('clawket.artifacts.open', { sessionKey: key, artifactId });
  expect(Buffer.from((await request('clawket.artifacts.read', { sessionKey: key, id: file.id, offset: 0 })).data, 'base64').toString()).toBe('Pi attachment');
  await expect(request('clawket.artifacts.read', { sessionKey: 'other', id: file.id, offset: 0 })).rejects.toThrow();
  await request('sessions.reset', { sessionKey: key });
  await expect(request('clawket.artifacts.read', { sessionKey: key, id: file.id, offset: 0 })).rejects.toThrow();
});

it('preserves legacy Pi inline images until the history reader opts into artifact references', async () => {
  setup(); const key = (await request('sessions.list'))[0].key;
  await request('chat.history', { sessionKey: key });
  const data = Buffer.from('native image bytes').toString('base64');
  children[0].entries = [{ id: 'image', parentId: null, message: { role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', data }] } }]; children[0].leafId = 'image';
  const legacy = await request('chat.history', { sessionKey: key });
  expect(legacy.messages[0].attachments).toEqual([{ type: 'image', mimeType: 'image/png', content: data }]);
  const current = await request('chat.history', { sessionKey: key, artifacts: true });
  expect(current.messages[0].attachments[0].content).toBeUndefined();
  expect(current.messages[0].attachments[0].artifactId).toMatch(/^image_/);
});

it('reports package version and protects active work before fencing update admission', async () => {
  const subject = setup();
  (subject as any).options.bridgeVersion = '3.1.11';
  expect(await subject.request({ type: 'req', id: 'version', method: 'health' })).toMatchObject({ backend: 'pi', bridgeVersion: '3.1.11' });
  (subject as any).processes.set('update-test', { run: {} });
  expect(subject.prepareForUpdate()).toBe(false);
  (subject as any).processes.delete('update-test');
  // The ordinary fixture may have a real idle native process; those remain restartable.
  expect(subject.prepareForUpdate()).toBe(true);
  await expect(subject.request({ type: 'req', id: 'after', method: 'sessions.list' })).rejects.toThrow('restarting');
});

it('answers phone-started update only through the injected control', async () => {
  const subject = setup();
  const call = (method: string, params?: Record<string, unknown>) => subject.request({ type: 'req', id: method, method, ...(params ? { params } : {}) } as any);
  expect(await call('health')).not.toHaveProperty('remoteUpdate');
  await expect(call('bridge.update.status')).rejects.toThrow('unavailable');
  const status = { id: '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59', state: 'checking' as const, startedAt: 1 }, start = vi.fn(async () => ({ accepted: true, status }));
  (subject as any).options.remoteUpdate = { available: () => true, start, status: () => status };
  expect(await call('health')).toMatchObject({ remoteUpdate: 1 });
  expect(await call('bridge.update.start', { version: '0.0.1' })).toEqual({ accepted: true, status });
  expect(await call('bridge.update.status')).toEqual({ status });
  expect(start).toHaveBeenCalledExactlyOnceWith();
});
