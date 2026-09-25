import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, realpathSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import type { SessionDescriptor, SessionUpdate, SessionHistory, PromptInput, AgentQuestion } from '@clawket/agent-protocol';
import { resolvePiExecutable } from './executable.js';
import { nativePiDirectory, piPath } from './paths.js';
import { PiRpc } from './rpc.js';
import { piBranch, piMessages, piText, piUsage } from './history.js';

export interface PiRequest { type: 'req'; id: string; method: string; params?: Record<string, unknown> }
export interface PiOptions { project: string; directory: string; command?: string; agentDirectory?: string; nativeSessionDirectory?: string; args?: string[]; env?: NodeJS.ProcessEnv }
type RecordEntry = { id: string; file: string; title: string; created: number; activity?: number; model?: string; provider?: string; preview?: string; keys: Record<string, { hash: string; runId: string }> };
type Running = { rpc: PiRpc; run?: { id: string; text: string; started: number; inputText?: string; agentStarted?: boolean; stop?: 'cancelled' | 'error'; final?: any }; questions: Map<string, AgentQuestion> };

/** Owns private Pi sessions. Remote callers can select opaque IDs, never filesystem paths or arbitrary RPC commands. */
export class PiService extends EventEmitter {
  readonly conversation = this;
  private records: RecordEntry[] = [];
  private processes = new Map<string, Running>();
  private native = new Map<string, string>();
  private stopped = false;
  private queues = new Map<string, Promise<unknown>>();
  private lockPath: string;
  private readonly project: string;
  private readonly agentDirectory: string;
  constructor(private readonly options: PiOptions) {
    super();
    this.project = realpathSync(options.project);
    if (!lstatSync(this.project).isDirectory()) throw new Error('Pi project must be a directory');
    this.agentDirectory = piPath(options.agentDirectory ?? options.env?.PI_CODING_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), this.project);
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    this.lockPath = join(options.directory, 'owner.lock');
    try { writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch {
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new Error('This Pi project is already managed by another Bridge');
      unlinkSync(this.lockPath); writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
    }
    try {
      if (existsSync(this.indexPath)) {
        const stored = JSON.parse(readFileSync(this.indexPath, 'utf8'));
        if (stored.project !== this.project || !Array.isArray(stored.sessions) || stored.sessions.length > 1000) throw new Error('Invalid Pi session index');
        this.records = stored.sessions;
        for (const record of this.records) if (!record || typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/.test(record.id) || typeof record.file !== 'string' || typeof record.title !== 'string' || !Number.isFinite(record.created) || !record.keys || typeof record.keys !== 'object' || Array.isArray(record.keys) || basename(record.file) !== record.file || !record.file.endsWith('.jsonl')) throw new Error('Invalid Pi session index');
      }
      if (new Set(this.records.map(record => record.id)).size !== this.records.length) throw new Error('Duplicate Pi sessions');
      if (!this.records.length) this.create();
    } catch (error) { unlinkSync(this.lockPath); throw error; }
  }
  private get indexPath(): string { return join(this.options.directory, 'sessions.json'); }
  private save(): void {
    const temporary = this.indexPath + '.pending';
    writeFileSync(temporary, JSON.stringify({ project: this.project, sessions: this.records }), { mode: 0o600 });
    renameSync(temporary, this.indexPath);
  }
  private create(title = '', nativeKey?: string): RecordEntry {
    if (this.records.length >= 1000) throw new Error('Project session limit reached');
    const id = randomUUID(), file = `${id}.jsonl`, now = Date.now();
    let entries: any[] = [{ type: 'session', version: 3, id, timestamp: new Date(now).toISOString(), cwd: this.project }];
    if (nativeKey) {
      const source = this.native.get(nativeKey);
      if (!source) throw new Error('Native session is no longer available');
      entries = this.readEntries(source);
      entries[0] = { ...entries[0], id, timestamp: new Date(now).toISOString(), cwd: this.project, parentSession: source };
    }
    writeFileSync(join(this.options.directory, file), entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    const record: RecordEntry = { id, file, title: title.slice(0, 200), created: now, keys: {} };
    this.records.push(record); this.save(); return record;
  }
  private readEntries(path: string, maxBytes = 32 * 1024 * 1024): any[] {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Session is unavailable or too large');
    const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const entries = rows.flatMap((row, index) => { try { return [JSON.parse(row)]; } catch { if (index === rows.length - 1) return []; throw new Error('Invalid Pi session'); } });
    if (entries[0]?.type !== 'session' || entries[0]?.version !== 3 || entries[0]?.cwd !== this.project) throw new Error('Unsupported Pi session');
    return entries;
  }
  private record(key: unknown): RecordEntry {
    const record = this.records.find(r => r.id === key);
    if (!record) throw new Error('This session is read-only. Create a branch to continue.');
    return record;
  }
  private async process(record: RecordEntry): Promise<Running> {
    if (this.stopped) throw new Error('Pi Bridge stopped');
    let live = this.processes.get(record.id);
    if (live) return live;
    if (this.processes.size >= 8) {
      const idle = [...this.processes].find(([id, value]) => !this.queues.has(id) && !value.run && !value.questions.size);
      if (!idle) throw new Error('Eight Pi sessions are busy. Stop a task before opening another.');
      await idle[1].rpc.stop();
      if (this.processes.get(idle[0]) === idle[1]) this.processes.delete(idle[0]);
      if (this.stopped) throw new Error('Pi Bridge stopped');
      const opened = this.processes.get(record.id);
      if (opened) return opened;
      if (this.processes.size >= 8) throw new Error('Pi session capacity reached; retry when another session is idle');
    }
    const executable = resolvePiExecutable(this.options.command);
    const rpc = new PiRpc(executable.command, [...executable.prefix, '--mode', 'rpc', '--session', join(this.options.directory, record.file), ...(this.options.args ?? [])], this.project, { ...process.env, ...this.options.env, PI_CODING_AGENT_DIR: this.agentDirectory });
    live = { rpc, questions: new Map() };
    this.processes.set(record.id, live);
    rpc.on('event', event => this.event(record, live!, event));
    rpc.on('exit', () => { this.finish(record, live!, 'error'); if (this.processes.get(record.id) === live) this.processes.delete(record.id); });
    return live;
  }
  private serial<T>(record: RecordEntry, work: (live: Running) => Promise<T>): Promise<T> {
    const next = (this.queues.get(record.id) ?? Promise.resolve()).then(async () => {
      this.record(record.id);
      return work(await this.process(record));
    });
    const tail = next.catch(() => {}); this.queues.set(record.id, tail);
    void tail.then(() => { if (this.queues.get(record.id) === tail) this.queues.delete(record.id); });
    return next;
  }
  private update(update: SessionUpdate): void { this.emit('update', update); }
  private descriptor(record: RecordEntry): SessionDescriptor {
    return { connectionId: '', agentId: 'pi', key: record.id, kind: record.id === this.records[0].id ? 'main' : 'direct', title: record.title || basename(this.project), updatedAt: record.activity ?? record.created, lastActivityAt: record.activity ?? null, model: record.model, modelProvider: record.provider, preview: record.preview, hasActiveRun: !!this.processes.get(record.id)?.run, source: 'bridge', allowedActions: { rename: true, reset: true, delete: this.records.length > 1, pin: true } };
  }
  async health(): Promise<object> {
    const live = this.processes.get(this.records[0].id) ?? this.processes.values().next().value ?? await this.process(this.records[0]);
    const state = await live.rpc.request('get_state');
    const catalog = await live.rpc.request('get_available_models');
    const record = this.records.find(item => this.processes.get(item.id) === live);
    if (record) { record.model = state.model?.id; record.provider = state.model?.provider; }
    return { backend: 'pi', protocol: 1, modelReady: (catalog.models ?? []).some((m: any) => m.provider === state.model?.provider && m.id === state.model?.id), model: state.model?.id ?? '', vision: state.model?.input?.includes('image') === true, project: basename(this.project) };
  }
  async request(frame: PiRequest): Promise<unknown> {
    if (frame?.type !== 'req' || typeof frame.id !== 'string' || !frame.id || frame.id.length > 200) throw new Error('Invalid request');
    const p = frame.params ?? {};
    switch (frame.method) {
      case 'health': case 'connect': return this.health();
      case 'agents.list': return [{ connectionId: '', agentId: 'pi', name: `Pi · ${basename(this.project)}`, isMain: true, mainSessionKey: this.records[0].id }];
      case 'sessions.list': {
        const sessions = this.records.map(r => this.descriptor(r));
        this.native.clear();
        const dir = nativePiDirectory(this.project, this.agentDirectory, this.options.nativeSessionDirectory, { ...process.env, ...this.options.env });
        if (existsSync(dir)) for (const file of readdirSync(dir).filter(f => f.endsWith('.jsonl')).slice(-200)) {
          try {
            const path = join(dir, file), entries = this.readEntries(path), messages = piMessages(piBranch(entries));
            const key = `native-${createHash('sha256').update(file).digest('hex').slice(0, 24)}`;
            this.native.set(key, path);
            const last = messages.filter(m => ['user', 'assistant'].includes(m.role)).at(-1);
            const title = entries.filter(e => e.type === 'session_info').at(-1)?.name || messages.find(m => m.role === 'user')?.text.slice(0, 100) || basename(this.project);
            sessions.push({ connectionId: '', agentId: 'pi', key, kind: 'direct', title, updatedAt: last?.timestampMs ?? null, lastActivityAt: last?.timestampMs ?? null, preview: last?.text.slice(0, 160), hasActiveRun: false, source: 'native', allowedActions: { rename: false, reset: false, delete: false, pin: true } });
          } catch { /* An active/incompatible native transcript cannot take the Bridge offline. */ }
        }
        return sessions;
      }
      case 'sessions.create': {
        if (p.fromSession !== undefined && typeof p.fromSession !== 'string') throw new Error('Invalid source session');
        return this.descriptor(this.create(typeof p.title === 'string' ? p.title : '', p.fromSession as string | undefined));
      }
      case 'sessions.rename': return this.serial(this.record(p.sessionKey), async live => {
        const record = this.record(p.sessionKey);
        if (live.run) throw new Error('Wait for this task to finish');
        if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) throw new Error('Invalid session name');
        await live.rpc.request('set_session_name', { name: p.title }); record.title = p.title; this.save(); return { ok: true };
      });
      case 'sessions.reset': case 'sessions.delete': {
        const record = this.record(p.sessionKey);
        return this.serial(record, async live => {
        if (live?.run) throw new Error('Stop the task before changing this session');
        if (frame.method === 'sessions.delete' && this.records.length === 1) throw new Error('Keep at least one project session');
        if (live) { await live.rpc.stop(); this.processes.delete(record.id); }
        if (frame.method === 'sessions.reset') {
          // Rotate storage; never erase Pi native history or replay an accepted key.
          record.file = `${randomUUID()}.jsonl`; record.activity = undefined; record.preview = undefined; record.model = undefined; record.provider = undefined;
          writeFileSync(join(this.options.directory, record.file), JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: this.project }) + '\n', { mode: 0o600, flag: 'wx' });
        } else this.records = this.records.filter(r => r !== record);
        this.save(); return { ok: true };
        });
      }
      case 'chat.history': return this.history(p.sessionKey, p.cursor);
      case 'chat.send': return this.prompt(this.record(p.sessionKey), p as unknown as PromptInput);
      case 'chat.abort': {
        const record = this.record(p.sessionKey), live = this.processes.get(record.id);
        if (live?.run) { if (p.runId && p.runId !== live.run.id) throw new Error('Task changed'); live.run.stop = 'cancelled';
          for (const id of live.questions.keys()) { live.rpc.send({ type: 'extension_ui_response', id, cancelled: true }); this.update({ type: 'question_resolved', sessionKey: record.id, questionId: id }); }
          live.questions.clear(); await live.rpc.request('abort'); }
        return { ok: true };
      }
      case 'chat.steer': {
        const live = this.processes.get(this.record(p.sessionKey).id);
        if (!live?.run || live.run.id !== p.runId || typeof p.text !== 'string' || p.text.length > 128_000 || !p.text.trim()) throw new Error('Task is no longer running');
        await live.rpc.request('steer', { message: p.text }); return { ok: true };
      }
      case 'questions.list': return [...(this.processes.get(this.record(p.sessionKey).id)?.questions.values() ?? [])];
      case 'questions.respond': {
        const live = this.processes.get(this.record(p.sessionKey).id), question = live?.questions.get(String(p.questionId));
        if (!live || !question || (question.expiresAtMs && question.expiresAtMs <= Date.now())) throw new Error('This question is no longer pending');
        if (p.cancelled !== true) {
          if (question.kind === 'confirm' && typeof p.confirmed !== 'boolean') throw new Error('Choose a response');
          if (question.kind !== 'confirm' && (typeof p.value !== 'string' || p.value.length > 64_000 || (question.kind === 'select' && !question.options?.includes(p.value)))) throw new Error('Invalid response');
        }
        live.rpc.send({ type: 'extension_ui_response', id: question.id, cancelled: p.cancelled === true, value: p.value, confirmed: p.confirmed });
        live.questions.delete(question.id); this.update({ type: 'question_resolved', sessionKey: String(p.sessionKey), questionId: question.id }); return { ok: true };
      }
      case 'skills.list': {
        const live = await this.process(this.records[0]); const result = await live.rpc.request('get_commands');
        return { workspaceDir: basename(this.project), managedSkillsDir: '', skills: (result.commands ?? []).filter((c: any) => c.source === 'skill').slice(0, 500).map((c: any) => ({
          name: c.name.replace(/^skill:/, ''), description: c.description ?? '', invocation: `/${c.name} `, source: 'pi', bundled: false, filePath: '', baseDir: '', skillKey: c.name,
          always: false, disabled: false, blockedByAllowlist: false, eligible: true, deletable: false, requirements: {}, missing: {}, configChecks: [], install: [],
        })) };
      }
      case 'models.list': case 'models.select': return this.serial(this.record(p.sessionKey ?? this.records[0].id), async live => {
        if (frame.method === 'models.select') {
          if (p.scope !== 'session' || !p.sessionKey || typeof p.provider !== 'string' || typeof p.model !== 'string') throw new Error('Select a model for a session');
          if (live.run) throw new Error('Stop the task before changing its model');
          await live.rpc.request('set_model', { provider: p.provider, modelId: p.model });
        }
        const state = await live.rpc.request('get_state'), catalog = await live.rpc.request('get_available_models');
        const record = this.record(p.sessionKey ?? this.records[0].id); record.model = state.model?.id; record.provider = state.model?.provider; this.save();
        return { ok: true, scope: 'session', currentModel: state.model?.id ?? '', currentProvider: state.model?.provider ?? '', currentBaseUrl: '', models: (catalog.models ?? []).map((m: any) => ({ id: m.id, name: m.name, provider: m.provider, contextWindow: m.contextWindow, reasoning: m.reasoning, input: m.input, cost: m.cost })) };
      });
      default: throw new Error('Unsupported Pi operation');
    }
  }
  private async history(key: unknown, cursor: unknown): Promise<SessionHistory> {
    let entries: any[], live: Running | undefined, state: any;
    const native = this.native.get(String(key));
    if (native) entries = piBranch(this.readEntries(native));
    else {
      const record = this.record(key); live = await this.process(record);
      // Seed from our private transcript, then ask Pi only for newer/unflushed entries.
      // Replaying the whole RPC history would exceed a JSONL frame after a few image turns.
      const persisted = this.readEntries(join(this.options.directory, record.file), 128 * 1024 * 1024).filter(entry => entry.type !== 'session');
      const since = persisted.at(-1)?.id;
      const result = await live.rpc.request('get_entries', since ? { since } : {}); state = await live.rpc.request('get_state');
      const all = [...persisted, ...(result.entries ?? [])], byId = new Map(all.map((e: any) => [e.id, e]));
      const ordered: any[] = []; let current: any = byId.get(result.leafId); const seen = new Set();
      while (current && !seen.has(current.id)) { seen.add(current.id); ordered.push(current); current = byId.get(current.parentId); }
      entries = ordered.reverse();
    }
    const messages = piMessages(entries);
    const run = live?.run;
    // Extension commands may wait for UI without writing a Pi user entry.
    // Restore their current input so recovery cannot attach activity to an older turn.
    if (run && !run.agentStarted && run.inputText) messages.push({ id: `pi-pending-${run.id}`, role: 'user', text: run.inputText, timestampMs: run.started });
    const end = cursor === undefined ? messages.length : Number(cursor);
    if (!Number.isInteger(end) || end < 0 || end > messages.length) throw new Error('Invalid history cursor');
    let start = end, bytes = 0;
    while (start > Math.max(0, end - 40)) { const size = Buffer.byteLength(JSON.stringify(messages[start - 1])); if (bytes + size > 7 * 1024 * 1024) break; bytes += size; start--; }
    if (start === end && end > 0) throw new Error('This message exceeds the history transfer limit');
    return { key: String(key), messages: messages.slice(start, end), nextCursor: start ? String(start) : undefined, hasActiveRun: !!run, activeRun: run ? { runId: run.id, text: run.text, startedAtMs: run.started, sessionAbortable: true } : undefined, sessionId: state?.sessionId, thinkingLevel: state?.thinkingLevel };
  }
  private prompt(record: RecordEntry, input: PromptInput): Promise<{ runId: string }> {
    return this.serial(record, async live => {
      if (typeof input.text !== 'string' || input.text.length > 128_000 || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error('Invalid prompt');
      const images = input.attachments ?? [];
      if (!Array.isArray(images) || images.length > 8 || images.some(a => !a || typeof a.content !== 'string' || a.type !== 'image' || !/^image\/(png|jpeg|webp|gif)$/.test(a.mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.content))) throw new Error('Pi supports image attachments only');
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex'), previous = Object.hasOwn(record.keys, input.idempotencyKey) ? record.keys[input.idempotencyKey] : undefined;
      if (previous) { if (previous.hash !== hash) throw new Error('Prompt key already used for different content'); return { runId: previous.runId }; }
      if (live.run) throw new Error('This session is busy. Stop it or send guidance.');
      const state = await live.rpc.request('get_state');
      if (!state.model) throw new Error('No Pi model configured. Run pi on your computer and use /login or configure models.json.');
      if (!input.text.trim() && !images.length) throw new Error('Enter a message or attach an image');
      if (images.length && !state.model.input?.includes('image')) throw new Error('This model does not support images');
      if (input.thinkingLevel) await live.rpc.request('set_thinking_level', { level: input.thinkingLevel });
      if (Object.keys(record.keys).length >= 10000) throw new Error('Start a new session to continue');
      if (this.stopped) throw new Error('Pi Bridge stopped');
      const runId = randomUUID();
      Object.defineProperty(record.keys, input.idempotencyKey, { value: { hash, runId }, enumerable: true, configurable: true, writable: true }); record.activity = Date.now(); record.preview = input.text.slice(0, 160); if (!record.title && input.text.trim()) record.title = input.text.trim().slice(0, 80); record.model = state.model?.id; record.provider = state.model?.provider; this.save();
      live.run = { id: runId, text: '', inputText: input.text, started: Date.now() };
      this.update({ type: 'run_started', sessionKey: record.id, runId });
      // The durable acceptance is our acknowledgement. Pi extension commands may await user input before their RPC response.
      void live.rpc.request('prompt', { message: input.text, images: images.map(a => ({ type: 'image', mimeType: a.mimeType, data: a.content })) }).then(async () => {
        const current = await live.rpc.request('get_state');
        if (live.run?.id === runId && !live.run.agentStarted && !current.isStreaming && !current.isCompacting && !current.pendingMessageCount) this.finish(record, live, live.run.stop ?? 'end_turn');
      }).catch(() => { if (live.run?.id === runId) { this.update({ type: 'error', sessionKey: record.id, runId, code: 'server', message: 'Pi could not complete this request. Check model credentials and project trust on your computer.' }); this.finish(record, live, 'error'); } });
      return { runId };
    });
  }
  private event(record: RecordEntry, live: Running, event: any): void {
    const sessionKey = record.id;
    if (event.type === 'extension_ui_request') {
      if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
        const question: AgentQuestion = { id: event.id, kind: event.method, title: String(event.title ?? '').slice(0, 2000), message: typeof event.message === 'string' ? event.message : undefined, options: event.options, placeholder: typeof event.placeholder === 'string' ? event.placeholder : undefined, prefill: typeof event.prefill === 'string' ? event.prefill : undefined, expiresAtMs: typeof event.timeout === 'number' && Number.isFinite(event.timeout) ? Date.now() + event.timeout : null };
        if (typeof event.id !== 'string' || event.id.length > 200 || JSON.stringify(question).length > 128_000 || (question.kind === 'select' && (!Array.isArray(question.options) || question.options.length > 200 || question.options.some(option => typeof option !== 'string'))) || live.questions.size >= 16) { live.rpc.send({ type: 'extension_ui_response', id: event.id, cancelled: true }); return; }
        live.questions.set(question.id, question); this.update({ type: 'question_requested', sessionKey, question });
      } else if (event.method === 'notify') this.update({ type: 'system_event', sessionKey, kind: 'info', text: String(event.message ?? '').slice(0, 4000), timestampMs: Date.now() });
      return;
    }
    if (event.type === 'agent_start' && !live.run) { live.run = { id: randomUUID(), text: '', started: Date.now() }; this.update({ type: 'run_started', sessionKey, runId: live.run.id }); }
    const run = live.run; if (!run) return;
    const runId = run.id;
    if (event.type === 'agent_start') run.agentStarted = true;
    if (event.type === 'message_start' && event.message?.role === 'assistant') run.text = '';
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (delta?.type === 'text_delta') { run.text = (run.text + delta.delta).slice(-128_000); this.update({ type: 'agent_message_chunk', sessionKey, runId, text: delta.delta, textMode: 'delta' }); }
      if (delta?.type === 'thinking_delta') this.update({ type: 'agent_thought_chunk', sessionKey, runId, text: delta.delta });
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      run.final = event.message;
      if (event.message.stopReason === 'error') { run.stop = 'error'; this.update({ type: 'error', sessionKey, runId, code: 'server', message: 'Pi model request failed. Check the model credentials and provider on your computer.' }); }
      if (event.message.stopReason === 'aborted') run.stop = 'cancelled';
    }
    if (event.type === 'tool_execution_start') this.update({ type: 'tool_call', sessionKey, runId, toolCallId: event.toolCallId, title: event.toolName, kind: event.toolName, rawInput: JSON.stringify(event.args ?? {}).length <= 32_000 ? event.args : { preview: JSON.stringify(event.args).slice(0, 32_000) } });
    if (event.type === 'tool_execution_end') this.update({ type: 'tool_call_update', sessionKey, runId, toolCallId: event.toolCallId, status: event.isError ? 'error' : 'success', rawOutput: piText(event.result?.content).slice(0, 32_000) });
    if (event.type === 'auto_compaction_start' || event.type === 'auto_compaction_end') this.update({ type: 'compaction', sessionKey, phase: event.type.endsWith('start') ? 'start' : 'end' });
    if (event.type === 'agent_settled') this.finish(record, live, run.stop ?? 'end_turn');
  }
  private finish(record: RecordEntry, live: Running, stopReason: 'end_turn' | 'cancelled' | 'error'): void {
    const run = live.run; if (!run) return;
    live.run = undefined;
    for (const id of live.questions.keys()) this.update({ type: 'question_resolved', sessionKey: record.id, questionId: id });
    live.questions.clear(); record.activity = Date.now(); this.save();
    this.update({ type: 'run_finished', sessionKey: record.id, runId: run.id, stopReason, message: run.final ? { role: 'assistant', content: piText(run.final.content).slice(0, 128_000), model: run.final.model, provider: run.final.provider } : undefined, usage: piUsage(run.final?.usage) });
    this.update({ type: 'session_info_update', session: this.descriptor(record) });
  }
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.all([...this.processes.values()].map(live => live.rpc.stop())); this.processes.clear();
    if (existsSync(this.lockPath)) unlinkSync(this.lockPath);
  }
}
