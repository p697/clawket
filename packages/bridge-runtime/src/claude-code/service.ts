import { DeliveredArtifacts } from '../delivered-artifacts.js';
import { SessionCatalogSync } from '../session-catalog.js';
import { InteractionAttention } from '../interaction-attention.js';
import { readPromptIdentity, recordedPromptStatus } from '../prompt-status.js';
import { sessionPreview } from '../session-preview.js';
import { ClaudeFault } from './errors.js';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { ClaudeOwnerLock } from './owner-lock.js';
import { forkSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ModelSelectionState, PromptInput, SessionDescriptor, SessionHistory, SessionUpdate } from '@clawket/agent-protocol';
import { ClaudeCatalog } from './catalog.js';
import { claudeHistoryPage } from './history-page.js';
import { ClaudeOwners, type ClaudeOwnerSnapshot } from './owners.js';
import { ClaudeSession, claudePromptContent } from './session.js';
import { ClaudeStore, type ClaudeRecord } from './store.js';
import { claudeModels } from './models.js';

export interface ClaudeRequest { type: 'req'; id: string; method: string; params?: Record<string, unknown> }
export interface ClaudeOptions { project: string; directory: string; executable: string; device?: boolean; ownershipDirectory?: string }
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
  private locks = new Map<string, ClaudeOwnerLock>();
  private probes = new Set<ClaudeSession>();
  private previews = new Map<string, { preview: string; lastActivityAt: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: ClaudeOptions) {
    super();
    // Match fs.promises.realpath in the catalog: Windows short paths must expand
    // identically before storing the authorization scope and per-session cwd.
    this.project = realpathSync.native(options.project);
    if (!statSync(this.project).isDirectory()) throw new ClaudeFault('Claude project must be a directory');
    const scope = { project: this.project, device: options.device === true };
    this.store = new ClaudeStore(options.directory, scope);
    this.catalog = new ClaudeCatalog(scope);
    this.owners = new ClaudeOwners(options.executable);
  }

  private readonly artifacts = new DeliveredArtifacts();
  private readonly attention = new InteractionAttention();
  private update(update: SessionUpdate): void {
    if (update.type === 'run_finished') { const key = update.sessionKey; update = this.artifacts.final(update, [this.store.records.find(row => row.key === key)?.cwd ?? this.project]); }
    const patch = this.attention.accept(update);
    this.emit('update', update);
    if (patch) this.emit('update', patch);
  }
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
  private async descriptor(record: ClaudeRecord, roster?: ClaudeOwnerSnapshot): Promise<SessionDescriptor> {
    const project = await this.catalog.addProject(record.cwd);
    const continuation = record.imported ? this.continuation(record.nativeId!, project.available, roster ?? await this.owners.snapshot(), record.key) : {};
    const livePreview = this.previews.get(record.key);
    const nativePreview = record.nativeId ? this.catalog.cachedPreview(record.nativeId) : undefined;
    const visible = nativePreview && (!livePreview || nativePreview.lastActivityAt > livePreview.lastActivityAt)
      ? nativePreview : livePreview ?? nativePreview;
    return { connectionId: '', agentId: 'claude-code', key: record.key, kind: 'direct',
      title: record.title || basename(record.cwd), updatedAt: Math.max(record.lastActivityAt ?? record.createdAt, visible?.lastActivityAt ?? 0),
      lastActivityAt: visible?.lastActivityAt ?? record.lastActivityAt ?? null, preview: visible?.preview, model: record.model,
      project, source: record.imported ? 'native' : 'bridge', ...continuation,
      hasActiveRun: !!this.sessions.get(record.key)?.activeRun, attention: this.attention.get(record.key),
      allowedActions: { rename: !record.imported, reset: !record.imported, delete: !record.imported, pin: true } };
  }

  private readonly catalogSync = new SessionCatalogSync(() => this.listSessions(true));
  private async listSessions(strict = false): Promise<SessionDescriptor[]> {
    const roster = await this.owners.snapshot();
    const native = await this.discover(roster, strict);
    const recentOwned = [...this.store.records].filter(record => record.materialized && !!record.nativeId && !this.catalog.hasNativeEntry(record.nativeId))
      .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)).slice(0, 8);
    for (let index = 0; index < recentOwned.length; index += 2) await Promise.all(recentOwned.slice(index, index + 2).map(record =>
      this.catalog.loadPreview(record.nativeId!, record.cwd, record.lastActivityAt ?? record.createdAt)));
    const owned = [];
    for (const record of this.store.records) owned.push(await this.descriptor(record, roster));
    return [...owned, ...native];
  }
  async health(): Promise<object> {
    if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
    // Viewing projects/history remains useful when model authentication needs attention.
    return { backend: 'claude-code', sessionCatalogSync: 1, artifacts: true, promptStatus: true, projects: true, vision: true,
      capabilities: { steer: false, thinkingLevels: false, skills: false, sessionBranch: true } };
  }

  async request(frame: ClaudeRequest): Promise<unknown> {
    const result = await this.dispatch(frame);
    if (['sessions.create', 'sessions.rename', 'sessions.reset', 'sessions.delete'].includes(frame.method)) this.catalogSync.invalidate();
    if (['sessions.reset', 'sessions.delete'].includes(frame.method) && typeof frame.params?.sessionKey === 'string') this.artifacts.forget(frame.params.sessionKey);
    return result;
  }
  private async dispatch(frame: ClaudeRequest): Promise<unknown> {
    if (this.stopped || !frame || frame.type !== 'req' || typeof frame.id !== 'string'
      || frame.id.length > 200 || !frame.id || typeof frame.method !== 'string'
      || frame.params !== undefined && (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params))) {
      throw new ClaudeFault('Invalid Claude request');
    }
    const p = frame.params ?? {};
    switch (frame.method) {
      case 'health': return this.health();
      case 'chat.promptStatus': {
        const identity = hash(readPromptIdentity(p.idempotencyKey));
        const record = this.store.records.find(row => row.key === p.sessionKey);
        return recordedPromptStatus(record && Object.hasOwn(record.fingerprints, identity) ? record.fingerprints[identity] : undefined);
      }
      case 'agents.list': return [{ connectionId: '', agentId: 'claude-code', name: 'Claude Code', isMain: true, entryMode: 'sessions', mainSessionKey: '' }];
      case 'projects.list': await this.discover({ known: false, owners: [] }); return this.catalog.listProjects();
      case 'sessions.list': return this.listSessions();
      case 'sessions.sync': return this.catalogSync.reply(p);
      case 'sessions.create': return this.serial(async () => {
        if (this.store.records.length >= 500) throw new ClaudeFault('Claude conversation limit reached');
        await this.discover();
        const prior = this.store.records.find(row => row.imported && row.key === p.fromSession);
        const source = prior ? { sessionId: prior.nativeId!, cwd: prior.cwd, title: prior.title }
          : p.fromSession !== undefined ? this.catalog.native(string(p.fromSession, 'source session')) : undefined;
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
        if (record.imported) throw new ClaudeFault('Native conversation titles are managed in Claude');
        const before = record.title; record.title = title;
        try { this.store.save(); } catch (error) { record.title = before; throw error; }
        const descriptor = await this.descriptor(record); this.update({ type: 'session_info_update', session: descriptor });
        return { ok: true };
      });
      case 'sessions.reset': case 'sessions.delete': return this.serial(async () => {
        const record = this.record(p.sessionKey);
        if (record.imported) throw new ClaudeFault('Native conversations cannot be reset or deleted here');
        if (this.sessions.get(record.key)?.activeRun) throw new ClaudeFault('Stop the Claude task before changing this conversation');
        const live = this.sessions.get(record.key);
        if (live) await this.releaseSession(record.key, live);
        const before = JSON.stringify(this.store.records);
        if (frame.method === 'sessions.delete') this.store.records = this.store.records.filter(row => row !== record);
        else {
          // Native transcripts are retained. Retried accepted sends cannot repopulate a reset conversation.
          delete record.nativeId; delete record.materialized; delete record.lastActivityAt;
        }
        try { this.store.save(); } catch (error) { this.store.records = JSON.parse(before); throw error; }
        this.previews.delete(record.key);
        return { ok: true };
      });
      case 'clawket.artifacts.open': return this.artifacts.resolve(p.sessionKey, p.artifactId, cursor => this.history(String(p.sessionKey), cursor));
      case 'clawket.artifacts.read': return this.artifacts.read(p.sessionKey, p.id, p.offset);
      case 'chat.history': return this.history(string(p.sessionKey, 'session'), p.cursor);
      case 'chat.send': return this.serial(async () => this.send(await this.continuationRecord(p.sessionKey), p));
      case 'chat.abort': {
        const record = this.record(p.sessionKey), session = this.sessions.get(record.key);
        if (!session?.activeRun) throw new ClaudeFault('Claude run is no longer active');
        await session.interrupt(p.runId === undefined ? session.activeRun.runId : string(p.runId, 'run'));
        return { ok: true, completed: !session.activeRun };
      }
      case 'questions.list': return this.sessions.get(string(p.sessionKey, 'session'))?.interactions.questions() ?? [];
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
        if (p.sessionKey !== undefined) return this.sessions.get(string(p.sessionKey, 'session'))?.interactions.approvals() ?? [];
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
        if (p.sessionKey === undefined || p.sessionKey === null || (frame.method === 'models.list' && !this.store.records.some(row => row.key === p.sessionKey && !row.imported))) {
          if (frame.method !== 'models.list') throw new ClaudeFault('Choose a conversation before changing its Claude model');
          const probe = new ClaudeSession({ key: 'model-catalog', cwd: this.project, executable: this.options.executable });
          this.probes.add(probe);
          try {
            const models = await probe.models();
            const current = this.store.records.find(row => row.key === p.sessionKey)?.model ?? '';
            const selected = models.find(model => model.value === current || model.resolvedModel === current);
            return { currentModel: selected?.value ?? current, currentProvider: 'anthropic', currentBaseUrl: '',
              models: claudeModels(models) };
          } finally { await probe.close(); this.probes.delete(probe); }
        }
        const record = await this.continuationRecord(p.sessionKey);
        const session = await this.session(record);
        try {
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
        } finally { if (record.imported && !session.activeRun) await this.releaseSession(record.key, session); }
      });
      default: throw new ClaudeFault('Unsupported Claude method');
    }
  }

  private continuation(nativeId: string, available: boolean, roster: ClaudeOwnerSnapshot, key: string): Pick<SessionDescriptor, 'canContinue' | 'continuationBlockedReason'> {
    if (!available) return { canContinue: false, continuationBlockedReason: 'project_unavailable' };
    if (this.sessions.has(key)) return { canContinue: true };
    if (!roster.known) return { canContinue: false, continuationBlockedReason: 'ownership_unknown' };
    if (roster.owners.some(owner => owner.sessionId === nativeId)) return { canContinue: false, continuationBlockedReason: 'in_use' };
    return { canContinue: true };
  }

  private async publishBlocked(record: ClaudeRecord, reason: NonNullable<SessionDescriptor['continuationBlockedReason']>): Promise<void> {
    if (record.imported) this.update({ type: 'session_info_update', session: { ...await this.descriptor(record), canContinue: false, continuationBlockedReason: reason } });
  }

  private async continuationRecord(key: unknown): Promise<ClaudeRecord> {
    const existing = this.store.records.find(row => row.key === key);
    if (existing) return existing;
    const id = string(key, 'session');
    const descriptor = (await this.discover()).find(row => row.key === id);
    if (!descriptor) throw new ClaudeFault('Unknown Claude session');
    this.update({ type: 'session_info_update', session: descriptor });
    if (!descriptor.canContinue) throw new ClaudeFault('This conversation is unavailable for continuation. Check its status or continue in a new session.');
    if (this.store.records.length >= 500) throw new ClaudeFault('Claude conversation limit reached');
    const native = this.catalog.native(id);
    const record: ClaudeRecord = { key: id, nativeId: native.sessionId, imported: true, materialized: true,
      cwd: native.cwd, title: native.title.slice(0, 300), createdAt: Date.now(), lastActivityAt: descriptor.updatedAt ?? undefined, fingerprints: {} };
    this.store.records.push(record);
    try { this.store.save(); } catch (error) { this.store.records.pop(); throw error; }
    return record;
  }

  private async releaseSession(key: string, session: ClaudeSession): Promise<void> {
    if (this.sessions.get(key) !== session) return;
    await session.close();
    this.sessions.delete(key);
    this.locks.get(key)?.close(); this.locks.delete(key);
  }

  private async discover(roster?: ClaudeOwnerSnapshot, strict = false): Promise<SessionDescriptor[]> {
    try {
      const result = await this.catalog.discover();
      if (strict && !result.complete) throw new ClaudeFault('Claude conversation catalog could not be refreshed completely');
      if (result.truncated) this.update({ type: 'error', code: 'unsupported', message: 'Claude history discovery reached its safety limit. Some older conversations are not shown.' });
      const ownedKeys = new Set(this.store.records.flatMap(record => record.nativeId ? [`native:${hash(record.nativeId).slice(0, 32)}`] : []));
      const snapshot = roster ?? await this.owners.snapshot();
      return result.sessions.filter(session => !ownedKeys.has(session.key)).map(session => ({ ...session,
        ...this.continuation(this.catalog.native(session.key).sessionId, session.project?.available === true, snapshot, session.key),
      }));
    }
    catch {
      if (strict) throw new ClaudeFault('Claude conversation catalog could not be refreshed completely');
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
      await this.releaseSession(idle[0], idle[1]);
    }
    if (!(await this.catalog.addProject(record.cwd)).available) {
      await this.publishBlocked(record, 'project_unavailable');
      throw new ClaudeFault('The Claude project no longer exists');
    }
    if (!record.materialized) {
      record.nativeId = randomUUID();
      this.store.save();
    }
    // Shared across device/project pairings and Preview/Production, before checking native owners.
    let lock: ClaudeOwnerLock;
    try {
      lock = new ClaudeOwnerLock(join(this.options.ownershipDirectory ?? join(homedir(), '.clawket', 'claude-code', 'session-owners'), hash(record.nativeId!)));
    } catch {
      await this.publishBlocked(record, 'in_use');
      throw new ClaudeFault('This conversation is in use by another Clawket Bridge.');
    }
    this.locks.set(record.key, lock);
    try {
      if (record.materialized) {
        const roster = await this.owners.snapshot();
        const state = this.continuation(record.nativeId!, true, roster, record.key);
        if (!state.canContinue) {
          await this.publishBlocked(record, state.continuationBlockedReason!);
          throw new ClaudeFault(roster.known
            ? 'This conversation is still open in Claude. Close that conversation on your computer, then try again.'
            : 'Could not verify whether this conversation is open in Claude. Try again when its status is available.');
        }
        const info = await getSessionInfo(record.nativeId!, { dir: record.cwd });
        if (!info) throw new ClaudeFault('Claude could not find this conversation. An uncertain message will not be resent.');
      }
      if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
      const session = new ClaudeSession({ key: record.key, cwd: record.cwd, executable: this.options.executable,
        model: record.model, ...(record.materialized ? { resume: record.nativeId } : { sessionId: record.nativeId }) });
      session.on('update', (update: SessionUpdate) => this.update(update));
      session.on('closed', () => { void this.serial(() => this.releaseSession(record.key, session)).catch(() => {}); });
      session.on('identity', () => {
        if (!record.model && session.currentModel) {
          record.model = session.currentModel;
          try { this.store.save(); }
          catch { this.update({ type: 'error', sessionKey: record.key, code: 'server', message: 'Claude model metadata could not be saved.' }); }
          void this.descriptor(record).then(descriptor => this.update({ type: 'session_info_update', session: descriptor })).catch(() => {});
        }
      });
      session.on('settled', (result?: { text?: string; timestampMs?: number }) => {
        const preview = sessionPreview(result?.text);
        if (preview) {
          record.lastActivityAt = result?.timestampMs ?? Date.now();
          this.previews.set(record.key, { preview, lastActivityAt: record.lastActivityAt });
        }
        try { this.store.save(); }
        catch { this.update({ type: 'error', sessionKey: record.key, code: 'server', message: 'Claude session metadata could not be saved. Check local storage.' }); }
        void this.descriptor(record).then(descriptor => this.update({ type: 'session_info_update', session: descriptor })).catch(() => {});
        // Imported conversations relinquish the native writer between turns so the computer can resume later.
        if (record.imported) void this.serial(() => this.releaseSession(record.key, session)).catch(() => {});
      });
      this.sessions.set(record.key, session);
      try { await session.start(); }
      catch (error) { this.sessions.delete(record.key); await session.close(); throw error; }
      return session;
    } catch (error) { lock.close(); this.locks.delete(record.key); throw error; }
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
    try {
      if (this.stopped) throw new ClaudeFault('Claude Bridge is stopped');
      if (session.activeRun) throw new ClaudeFault('Claude is still working on this conversation');
      const runId = randomUUID();
      const previous = { activity: record.lastActivityAt, materialized: record.materialized, title: record.title };
      record.fingerprints[key] = { hash: fingerprint, runId, clientKey: idempotencyKey };
      record.lastActivityAt = Date.now(); record.materialized = true;
      if (!record.title && !record.imported) record.title = input.text.trim().slice(0, 80);
      try { this.store.save(); }
      catch (error) {
        delete record.fingerprints[key]; record.lastActivityAt = previous.activity; record.materialized = previous.materialized; record.title = previous.title;
        throw error;
      }
      const preview = sessionPreview(input.text, !!input.attachments?.some(item => item.type === 'image'));
      if (preview) this.previews.set(record.key, { preview, lastActivityAt: record.lastActivityAt });
      void this.descriptor(record).then(descriptor => this.update({ type: 'session_info_update', session: descriptor })).catch(() => {});
      // A failure after durable acceptance remains uncertain. Never remove this fingerprint and retry silently.
      session.send(runId, input);
      return { runId };
    } finally { if (record.imported && !session.activeRun) await this.releaseSession(record.key, session); }
  }

  private async history(key: string, cursor: unknown): Promise<SessionHistory> {
    const artifactEpoch = this.artifacts.epoch;
    const record = this.store.records.find(row => row.key === key);
    if (!record) {
      const descriptors = await this.discover();
      const descriptor = descriptors.find(row => row.key === key);
      if (descriptor) this.update({ type: 'session_info_update', session: descriptor });
      const page = await this.catalog.history(key, cursor);
      return { ...page, messages: this.artifacts.project(key, page.messages, [this.catalog.native(key).cwd], artifactEpoch, cursor) };
    }
    if (record.imported) this.update({ type: 'session_info_update', session: await this.descriptor(record) });
    const page = record.materialized ? await claudeHistoryPage(record.nativeId!, record.cwd, cursor) : { messages: [] };
    const activeRun = this.sessions.get(key)?.activeRun;
    const rendered = this.artifacts.project(key, page.messages, [record.cwd], artifactEpoch, cursor);
    for (const message of rendered) {
      const accepted = Object.values(record.fingerprints).find(item => item.runId === message.id);
      if (message.role === 'user' && accepted) message.idempotencyKey = accepted.clientKey;
    }
    return { key, messages: rendered, hasActiveRun: !!activeRun,
      ...(activeRun ? { activeRun } : {}), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true; this.artifacts.clear();
    for (const probe of this.probes) await probe.close();
    for (const session of this.sessions.values()) await session.close();
    await this.queue.catch(() => {});
    this.sessions.clear();
    for (const lock of this.locks.values()) lock.close();
    this.locks.clear(); this.store.close(); this.artifacts.clear();
  }
}
