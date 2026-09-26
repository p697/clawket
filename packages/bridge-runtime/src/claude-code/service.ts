import { ClaudeFault } from './errors.js';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { forkSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ModelSelectionState, PromptInput, SessionDescriptor, SessionHistory, SessionUpdate } from '@clawket/agent-protocol';
import { ClaudeCatalog } from './catalog.js';
import { claudeHistoryPage } from './history-page.js';
import { ClaudeOwners } from './owners.js';
import { ClaudeSession, claudePromptContent } from './session.js';
import { ClaudeStore, type ClaudeRecord } from './store.js';
import { claudeModels } from './models.js';

export interface ClaudeRequest { type: 'req'; id: string; method: string; params?: Record<string, unknown> }
export interface ClaudeOptions { project: string; directory: string; executable: string; device?: boolean }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function string(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ClaudeFault(`Invalid ${label}`);
  return value;
}

/** Authenticated transport callers use this allowlist; client paths never choose native files. */
export class ClaudeService extends EventEmitter {
  readonly conversation = this;
  private readonly project: string;
  private readonly store: ClaudeStore;
  private readonly catalog: ClaudeCatalog;
  private readonly owners: ClaudeOwners;
  private sessions = new Map<string, ClaudeSession>();
  private probes = new Set<ClaudeSession>();
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: ClaudeOptions) {
    super();
    this.project = realpathSync(options.project);
    if (!statSync(this.project).isDirectory()) throw new ClaudeFault('Claude project must be a directory');
    const scope = { project: this.project, device: options.device === true };
    this.store = new ClaudeStore(options.directory, scope);
    this.catalog = new ClaudeCatalog(scope);
    this.owners = new ClaudeOwners(options.executable);
  }

  private update(update: SessionUpdate): void { this.emit('update', update); }
  private record(key: unknown): ClaudeRecord {
    const row = this.store.records.find(record => record.key === key);
    if (!row) throw new ClaudeFault('This native conversation is read-only. Continue it on your computer.');
    return row;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(() => {
      if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
      return work();
    });
    this.queue = next;
    return next;
  }
  private async descriptor(record: ClaudeRecord): Promise<SessionDescriptor> {
    return { connectionId: '', agentId: 'claude-code', key: record.key, kind: 'direct',
      title: record.title || basename(record.cwd), updatedAt: record.lastActivityAt ?? record.createdAt,
      lastActivityAt: record.lastActivityAt ?? null, model: record.model,
      project: await this.catalog.addProject(record.cwd), source: 'bridge',
      hasActiveRun: !!this.sessions.get(record.key)?.activeRun,
      allowedActions: { rename: true, reset: true, delete: true, pin: true } };
  }

  async health(): Promise<object> {
    if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
    // Viewing projects/history remains useful when model authentication needs attention.
    return { backend: 'claude-code', projects: true, vision: true,
      capabilities: { steer: false, thinkingLevels: false, skills: false, sessionBranch: true } };
  }

  async request(frame: ClaudeRequest): Promise<unknown> {
    if (this.stopped || !frame || frame.type !== 'req' || typeof frame.id !== 'string'
      || frame.id.length > 200 || !frame.id || typeof frame.method !== 'string'
      || frame.params !== undefined && (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params))) {
      throw new ClaudeFault('Invalid Claude request');
    }
    const p = frame.params ?? {};
    switch (frame.method) {
      case 'health': return this.health();
      case 'agents.list': return [{ connectionId: '', agentId: 'claude-code', name: 'Claude Code', isMain: true, entryMode: 'sessions', mainSessionKey: '' }];
      case 'projects.list': await this.discover(); return this.catalog.listProjects();
      case 'sessions.list': {
        const native = await this.discover();
        const owned = [];
        for (const record of this.store.records) owned.push(await this.descriptor(record));
        return [...owned, ...native];
      }
      case 'sessions.create': return this.serial(async () => {
        if (this.store.records.length >= 500) throw new ClaudeFault('Claude conversation limit reached');
        await this.discover();
        const source = p.fromSession !== undefined ? this.catalog.native(string(p.fromSession, 'source session')) : undefined;
        if (source && p.projectId !== undefined) throw new ClaudeFault('A Claude branch keeps its original project');
        const project = source ? await this.catalog.addProject(source.cwd) : p.projectId !== undefined ? this.catalog.project(string(p.projectId, 'project')) : await this.catalog.addProject(this.project);
        if (!project.available) throw new ClaudeFault('The selected Claude project no longer exists');
        const row: ClaudeRecord = { key: randomUUID(), cwd: project.path,
          title: p.title === undefined ? '' : string(p.title, 'title'), createdAt: Date.now(), fingerprints: {} };
        if (source) {
          const fork = await forkSession(source.sessionId, { dir: source.cwd, title: row.title || source.title });
          row.nativeId = fork.sessionId; row.materialized = true; row.title ||= source.title.slice(0, 300);
        }
        this.store.records.push(row);
        try { this.store.save(); } catch (error) { this.store.records.pop(); throw error; }
        const descriptor = await this.descriptor(row);
        this.update({ type: 'session_info_update', session: descriptor });
        return descriptor;
      });
      case 'sessions.rename': return this.serial(async () => {
        const record = this.record(p.sessionKey), title = string(p.title, 'title');
        const before = record.title; record.title = title;
        try { this.store.save(); } catch (error) { record.title = before; throw error; }
        const descriptor = await this.descriptor(record); this.update({ type: 'session_info_update', session: descriptor });
        return { ok: true };
      });
      case 'sessions.reset': case 'sessions.delete': return this.serial(async () => {
        const record = this.record(p.sessionKey);
        if (this.sessions.get(record.key)?.activeRun) throw new ClaudeFault('Stop the Claude task before changing this conversation');
        await this.sessions.get(record.key)?.close(); this.sessions.delete(record.key);
        const before = JSON.stringify(this.store.records);
        if (frame.method === 'sessions.delete') this.store.records = this.store.records.filter(row => row !== record);
        else {
          // Native transcripts are retained. Retried accepted sends cannot repopulate a reset conversation.
          delete record.nativeId; delete record.materialized; delete record.lastActivityAt;
        }
        try { this.store.save(); } catch (error) { this.store.records = JSON.parse(before); throw error; }
        return { ok: true };
      });
      case 'chat.history': return this.history(string(p.sessionKey, 'session'), p.cursor);
      case 'chat.send': return this.serial(() => this.send(this.record(p.sessionKey), p));
      case 'chat.abort': {
        const record = this.record(p.sessionKey), session = this.sessions.get(record.key);
        if (!session?.activeRun) throw new ClaudeFault('Claude run is no longer active');
        await session.interrupt(p.runId === undefined ? session.activeRun.runId : string(p.runId, 'run'));
        return { ok: true, completed: !session.activeRun };
      }
      case 'questions.list': return this.sessions.get(this.record(p.sessionKey).key)?.interactions.questions() ?? [];
      case 'questions.respond': {
        const session = this.sessions.get(this.record(p.sessionKey).key);
        if (!session) throw new ClaudeFault('Claude question is no longer available');
        const id = string(p.questionId, 'question');
        if (p.cancelled === true) {
          if (!session.activeRun || !session.interactions.questions().some(question => question.id === id)) throw new ClaudeFault('Claude question is no longer pending');
          await session.interrupt(session.activeRun.runId);
        } else session.interactions.answer(id, { answers: p.answers as Record<string, string[]> });
        return { ok: true };
      }
      case 'approvals.list': {
        if (p.sessionKey !== undefined) return this.sessions.get(this.record(p.sessionKey).key)?.interactions.approvals() ?? [];
        return [...this.sessions.values()].flatMap(session => session.interactions.approvals());
      }
      case 'approvals.resolve': {
        const id = string(p.id, 'approval');
        const session = [...this.sessions.values()].find(item => item.interactions.approvals().some(approval => approval.id === id));
        if (!session) throw new ClaudeFault('Claude approval is no longer available');
        session.interactions.approve(id, string(p.decision, 'decision'));
        return { ok: true };
      }
      case 'models.list': case 'models.select': return this.serial(async () => {
        if (p.sessionKey === undefined || p.sessionKey === null) {
          if (frame.method !== 'models.list') throw new ClaudeFault('Choose a conversation before changing its Claude model');
          const probe = new ClaudeSession({ key: 'model-catalog', cwd: this.project, executable: this.options.executable });
          this.probes.add(probe);
          try {
            const models = await probe.models();
            return { currentModel: '', currentProvider: 'anthropic', currentBaseUrl: '',
              models: claudeModels(models) };
          } finally { await probe.close(); this.probes.delete(probe); }
        }
        const record = this.record(p.sessionKey);
        const session = await this.session(record);
        if (frame.method === 'models.select') {
          if (p.scope !== 'session') throw new ClaudeFault('Claude model changes are session scoped');
          const model = string(p.model, 'model');
          await session.setModel(model); record.model = model; this.store.save();
        }
        const catalog = await session.models();
        const current = record.model ?? session.currentModel;
        const selected = catalog.find(model => model.value === current || model.resolvedModel === current);
        const selection: ModelSelectionState = { currentModel: selected?.value ?? current ?? '', currentProvider: 'anthropic', currentBaseUrl: '',
          models: claudeModels(catalog) };
        return frame.method === 'models.select' ? { ...selection, ok: true, scope: 'session' } : selection;
      });
      default: throw new ClaudeFault('Unsupported Claude method');
    }
  }

  private async discover(): Promise<SessionDescriptor[]> {
    try {
      const result = await this.catalog.discover();
      if (result.truncated) this.update({ type: 'error', code: 'unsupported', message: 'Claude history discovery reached its safety limit. Some older conversations are not shown.' });
      const ownedKeys = new Set(this.store.records.flatMap(record => record.nativeId ? [`native:${hash(record.nativeId).slice(0, 32)}`] : []));
      return result.sessions.filter(session => !ownedKeys.has(session.key));
    }
    catch {
      this.update({ type: 'error', code: 'server', message: 'Claude native history could not be refreshed. Existing Clawket chats remain available.' });
      await this.catalog.addProject(this.project);
      return [];
    }
  }

  private async session(record: ClaudeRecord): Promise<ClaudeSession> {
    const existing = this.sessions.get(record.key);
    if (existing) return existing;
    if (this.sessions.size >= 2) {
      const idle = [...this.sessions].find(([, session]) => !session.activeRun);
      if (!idle) throw new ClaudeFault('Two Claude tasks are already running. Wait for one to finish.');
      await idle[1].close(); this.sessions.delete(idle[0]);
    }
    if (!(await this.catalog.addProject(record.cwd)).available) throw new ClaudeFault('The Claude project no longer exists');
    if (record.materialized) {
      const roster = await this.owners.snapshot();
      if (!roster.known || roster.owners.some(owner => owner.sessionId === record.nativeId)) {
        throw new ClaudeFault('This conversation may still be open in Claude. Close its original session before continuing.');
      }
      const info = await getSessionInfo(record.nativeId!, { dir: record.cwd });
      if (!info) throw new ClaudeFault('Claude could not find this conversation. An uncertain message will not be resent.');
    } else {
      record.nativeId = randomUUID();
      this.store.save();
    }
    if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
    const session = new ClaudeSession({ key: record.key, cwd: record.cwd, executable: this.options.executable,
      model: record.model, ...(record.materialized ? { resume: record.nativeId } : { sessionId: record.nativeId }) });
    session.on('update', (update: SessionUpdate) => this.update(update));
    session.on('closed', () => { if (this.sessions.get(record.key) === session) this.sessions.delete(record.key); });
    session.on('identity', () => {
      if (!record.model && session.currentModel) {
        record.model = session.currentModel;
        try { this.store.save(); }
        catch { this.update({ type: 'error', sessionKey: record.key, code: 'server', message: 'Claude model metadata could not be saved.' }); }
        void this.descriptor(record).then(descriptor => this.update({ type: 'session_info_update', session: descriptor })).catch(() => {});
      }
    });
    session.on('settled', () => {
      record.lastActivityAt = Date.now();
      try { this.store.save(); }
      catch { this.update({ type: 'error', sessionKey: record.key, code: 'server', message: 'Claude session metadata could not be saved. Check local storage.' }); }
    });
    this.sessions.set(record.key, session);
    try { await session.start(); }
    catch (error) { this.sessions.delete(record.key); await session.close(); throw error; }
    return session;
  }

  private async send(record: ClaudeRecord, raw: Record<string, unknown>): Promise<{ runId: string }> {
    const idempotencyKey = string(raw.idempotencyKey, 'message identity', 200);
    if (typeof raw.text !== 'string' || raw.text.length > 200_000
      || raw.attachments !== undefined && !Array.isArray(raw.attachments)
      || raw.thinkingLevel !== undefined || raw.skillId !== undefined) throw new ClaudeFault('Unsupported Claude prompt');
    const input = { text: raw.text, attachments: raw.attachments, idempotencyKey } as PromptInput;
    claudePromptContent(input);
    const key = hash(idempotencyKey), fingerprint = hash(JSON.stringify({ text: input.text, attachments: input.attachments ?? [] }));
    const accepted = record.fingerprints[key];
    if (accepted) {
      if (accepted.hash !== fingerprint) throw new ClaudeFault('This message identity was already used for different content');
      return { runId: accepted.runId };
    }
    if (Object.keys(record.fingerprints).length >= 1_000) throw new ClaudeFault('This conversation reached its message limit. Create a new chat.');
    const session = await this.session(record);
    if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
    if (session.activeRun) throw new ClaudeFault('Claude is still working on this conversation');
    const runId = randomUUID();
    const previous = { activity: record.lastActivityAt, materialized: record.materialized };
    record.fingerprints[key] = { hash: fingerprint, runId, clientKey: idempotencyKey };
    record.lastActivityAt = Date.now(); record.materialized = true;
    try { this.store.save(); }
    catch (error) {
      delete record.fingerprints[key]; record.lastActivityAt = previous.activity; record.materialized = previous.materialized;
      throw error;
    }
    // A failure after durable acceptance remains uncertain. Never remove this fingerprint and retry silently.
    session.send(runId, input);
    return { runId };
  }

  private async history(key: string, cursor: unknown): Promise<SessionHistory> {
    const record = this.store.records.find(row => row.key === key);
    if (!record) return this.catalog.history(key, cursor);
    const page = record.materialized ? await claudeHistoryPage(record.nativeId!, record.cwd, cursor) : { messages: [] };
    const activeRun = this.sessions.get(key)?.activeRun;
    const rendered = page.messages;
    for (const message of rendered) {
      const accepted = Object.values(record.fingerprints).find(item => item.runId === message.id);
      if (message.role === 'user' && accepted) message.idempotencyKey = accepted.clientKey;
    }
    return { key, messages: rendered, hasActiveRun: !!activeRun,
      ...(activeRun ? { activeRun } : {}), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const probe of this.probes) await probe.close();
    for (const session of this.sessions.values()) await session.close();
    await this.queue.catch(() => {});
    this.sessions.clear(); this.store.close();
  }
}
