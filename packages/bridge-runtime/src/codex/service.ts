import { isDeepStrictEqual } from 'node:util';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, realpathSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { SessionDescriptor, SessionUpdate, SessionHistory, PromptInput, AgentQuestion, ApprovalRequest } from '@clawket/agent-protocol';
import { CodexRpc } from './rpc.js';
import { codexMessages, codexTool } from './history.js';
import { desktopTurns, desktopState } from './desktop-state.js';
import { canonicalProject, projectDescriptor, savedCodexProjects } from './projects.js';
import { DesktopIpc, DesktopIpcError, type DesktopSnapshot } from './desktop-ipc.js';

export interface CodexRequest { type: 'req'; id: string; method: string; params?: Record<string, unknown> }
export interface CodexOptions { project: string; directory: string; command?: string; env?: NodeJS.ProcessEnv; device?: boolean; desktop?: DesktopIpc }
type Entry = { cwd?: string; native?: boolean; id: string; threadId?: string; title: string; created: number; activity?: number; model?: string; provider?: string; effort?: string; preview?: string; keys: Record<string, { hash: string; runId: string }> };
type Run = { desktop?: boolean; id: string; turnId?: string; text: string; started: number; itemId?: string; final?: string; items: Map<string, any> };
type Consent = { desktop?: boolean; wireId: string | number; entry: Entry; turnId: string; approval: Extract<ApprovalRequest, { kind: 'exec' }>; permissions?: object };
type QuestionGroup = { desktop?: boolean; wireId: string | number; entry: Entry; turnId: string; pending: Map<string, { question: AgentQuestion; nativeId: string }>; answers: Record<string, { answers: string[] }> };
const ID = /^[a-f0-9-]{36}$/;
const PERMISSIONS = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' };

/** Device pairing discovers local projects; native writes retain the authoritative owner. */
export class CodexService extends EventEmitter {
  readonly conversation = this;
  private readonly project: string;
  private readonly lockPath: string;
  private rpc: CodexRpc;
  private records: Entry[] = [];
  private native = new Map<string, any>();
  private loaded = new Set<string>();
  private runs = new Map<string, Run>();
  private starts = new Map<string, Promise<any>>();
  private queues = new Map<string, Promise<unknown>>();
  private approvals = new Map<string, Consent>();
  private questions = new Map<string, QuestionGroup>();
  private items = new Map<string, any>();
  private stopped = false;
  private disconnected = false;
  private catalog: any[] = [];
  private projects = new Map<string, ReturnType<typeof projectDescriptor>>();
  private desktop?: DesktopIpc;
  private desktopFollowers = new Set<string>();
  private publishTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private publishedRevision = new Map<string, number>();
  private rawRequests = new Map<string, any>();
  constructor(private readonly options: CodexOptions) {
    super();
    this.project = realpathSync(options.project);
    this.rememberProject(this.project);
    if (!lstatSync(this.project).isDirectory()) throw new Error('Codex project must be a directory');
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    this.lockPath = join(options.directory, 'owner.lock');
    try { writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch {
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid Codex owner lock');
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new Error('This Codex project is already managed by another Bridge');
      unlinkSync(this.lockPath); writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
    }
    try {
      if (existsSync(this.indexPath)) {
        if (lstatSync(this.indexPath).size > 8 * 1024 * 1024) throw new Error('Codex index too large');
        const stored = JSON.parse(readFileSync(this.indexPath, 'utf8'));
        if (stored.project !== this.project || !Array.isArray(stored.sessions) || stored.sessions.length > 1000) throw new Error('Invalid Codex session index');
        this.records = stored.sessions;
        for (const r of this.records) if (!r || !(ID.test(r.id) || (options.device && r.native && /^native:[a-f0-9-]{36}$/.test(r.id))) || (r.threadId && !ID.test(r.threadId)) || typeof r.title !== 'string' || !Number.isFinite(r.created) || !r.keys || typeof r.keys !== 'object' || Array.isArray(r.keys)) throw new Error('Invalid Codex session index');
      }
      if (new Set(this.records.map(r => r.id)).size !== this.records.length) throw new Error('Duplicate Codex sessions');
      for (const r of this.records) { if (r.cwd && !options.device && r.cwd !== this.project) throw new Error('Project authorization mismatch'); this.rememberProject(r.cwd ?? this.project); }
      if (options.device) {
        this.desktop = options.desktop ?? new DesktopIpc();
        this.desktop.on('follow', (id: string, following: boolean) => { if (following && this.records.some(r => r.threadId === id && this.loaded.has(r.id))) { this.desktopFollowers.add(id); void this.publishDesktop(id).catch(() => {}); } else this.desktopFollowers.delete(id); });
        this.desktop.handler = { accepts: (method, p) => this.acceptDesktop(method, p), request: (method, p) => this.desktopRequest(method, p) };
        this.desktop.on('unsupported', (id: string) => { const r = this.records.find(row => row.threadId === id); if (r) this.update({ type: 'error', sessionKey: r.id, code: 'unsupported', message: 'This Codex Desktop version cannot be followed safely. Continue on your computer.' }); });
        this.desktop.on('snapshot', (id: string, snapshot: DesktopSnapshot) => this.desktopSnapshot(id, snapshot));
        void this.desktop.connect().catch(() => {});
      }
      this.rpc = new CodexRpc(options.command ?? 'codex', this.project, options.env);
      this.rpc.on('notification', frame => this.notification(frame.method, frame.params ?? {}));
      this.rpc.on('request', frame => { try { this.interaction(frame); } catch { this.rpc.refuse(frame.id); } });
      this.rpc.on('closed', () => {
        this.disconnected = true;
        for (const record of this.records) if (this.runs.has(record.id)) this.finish(record, 'error');
      });
    } catch (error) { unlinkSync(this.lockPath); throw error; }
  }
  private acceptDesktop(method: string, p: any): boolean {
    const r = this.records.find(row => row.threadId === p.conversationId);
    return !!r && this.loaded.has(r.id) && this.runs.get(r.id)?.desktop !== true && (!p.hostId || p.hostId === 'local') && [
      'thread-owner-discovery', 'thread-follower-load-complete-history', 'thread-follower-update-thread-settings', 'thread-follower-start-turn', 'thread-follower-steer-turn', 'thread-follower-interrupt-turn',
      'thread-follower-command-approval-decision', 'thread-follower-file-approval-decision', 'thread-follower-permissions-request-approval-response', 'thread-follower-submit-user-input',
    ].includes(method);
  }
  private async desktopRequest(method: string, p: any): Promise<any> {
    const r = this.records.find(row => row.threadId === p.conversationId)!;
    const call = (method: string, params: object) => this.request({ type: 'req', id: randomUUID(), method, params: { sessionKey: r.id, ...params } });
    if (method === 'thread-owner-discovery') return { supportsUntrustedAppInput: false };
    if (method === 'thread-follower-load-complete-history') { this.desktopFollowers.add(r.threadId!); return { revision: await this.publishDesktop(r.threadId!) }; }
    if (method === 'thread-follower-update-thread-settings') {
      const settings = p.threadSettings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !['model', 'effort', 'collaborationMode'].includes(k)) || this.runs.has(r.id)) throw new Error('Unsupported settings or task still running');
      const result = await this.rpc.request('thread/settings/update', { threadId: r.threadId, ...settings });
      if (typeof settings.model === 'string') r.model = settings.model;
      if (typeof settings.effort === 'string') r.effort = settings.effort;
      this.save(); this.scheduleDesktop(r); return { ok: true, ...result };
    }
    if (method === 'thread-follower-start-turn') {
      const request = p.turnStart?.request;
      if (!request || request.threadId !== r.threadId || !Array.isArray(request.input) || request.input.some((i: any) => i.type !== 'text') || (request.cwd && request.cwd !== (r.cwd ?? this.project))) throw new Error('Unsupported desktop turn');
      const text = request.input.map((i: any) => i.text ?? '').join('\n');
      const result = await this.prompt(r, { text, idempotencyKey: request.clientUserMessageId || randomUUID() });
      const accepted = this.starts.get(result.runId);
      if (!accepted) throw new Error('Check the conversation before retrying this request');
      return { result: await accepted };
    }
    const run = this.runs.get(r.id);
    if (method === 'thread-follower-interrupt-turn' || method === 'thread-follower-steer-turn') {
      if (!run?.turnId || p.expectedTurnId !== run.turnId) throw new Error('The task has changed');
      if (method === 'thread-follower-interrupt-turn') { await call('chat.abort', { runId: run.id }); return { interruptedTurnId: run.turnId, ok: true }; }
      if (!Array.isArray(p.input) || p.input.some((i: any) => i.type !== 'text')) throw new Error('Unsupported guidance');
      return { result: await call('chat.steer', { runId: run.id, text: p.input.map((i: any) => i.text).join('\n') }) };
    }
    if (method === 'thread-follower-submit-user-input') {
      const group = [...this.questions.values()].find(g => g.entry === r && !g.desktop && g.wireId === p.requestId);
      if (!group) throw new Error('Question has already resolved');
      const answers = Object.fromEntries(Object.entries(p.response?.answers ?? {}).map(([id, value]: [string, any]) => [id, value?.answers]));
      return call('questions.respond', { questionId: group.pending.keys().next().value, answers });
    }
    const consent = [...this.approvals.values()].find(c => c.entry === r && !c.desktop && c.wireId === p.requestId);
    if (method === 'thread-follower-permissions-request-approval-response') {
      if (!consent?.permissions || p.response?.scope !== 'turn') throw new Error('Only the requested one-time permissions are supported');
      const granted = p.response.permissions;
      const denied = granted && typeof granted === 'object' && !Array.isArray(granted) && Object.keys(granted).length === 0;
      if (!denied && !isDeepStrictEqual(granted, consent.permissions)) throw new Error('Permission grants do not match this request');
      return call('approvals.resolve', { id: consent.approval.id, decision: denied ? 'deny' : 'allow-once' });
    }
    if (!consent || consent.permissions || !['accept', 'decline'].includes(p.decision)) throw new Error('Unsupported approval response');
    return call('approvals.resolve', { id: consent.approval.id, decision: p.decision === 'accept' ? 'allow-once' : 'deny' });
  }
  private scheduleDesktop(r: Entry): void {
    if (!r.threadId || !this.desktopFollowers.has(r.threadId) || this.publishTimers.has(r.threadId)) return;
    const id = r.threadId;
    this.publishTimers.set(id, setTimeout(() => { this.publishTimers.delete(id); void this.publishDesktop(id).catch(() => {}); }, 150));
  }
  private publishing = new Map<string, Promise<number>>();
  private publishDesktop(threadId: string): Promise<number> {
    const existing = this.publishing.get(threadId); if (existing) return existing;
    const work = (async () => {
      const r = this.records.find(row => row.threadId === threadId);
      if (!r || !this.loaded.has(r.id) || this.runs.get(r.id)?.desktop) throw new Error('Conversation is not owned here');
      const response = await this.rpc.request('thread/read', { threadId, includeTurns: true });
      if (response.thread?.cwd !== (r.cwd ?? this.project) || !Array.isArray(response.thread.turns)) throw new Error('Invalid native history');
      const pendingIds = new Set([...this.approvals.values()].filter(c => c.entry === r).map(c => `${r.id}:${typeof c.wireId}:${c.wireId}`));
      for (const [id, group] of this.questions) if (group.entry === r) pendingIds.add(id);
      const requests = [...pendingIds].flatMap(id => this.rawRequests.has(id) ? [this.rawRequests.get(id)] : []);
      for (const id of this.rawRequests.keys()) if (id.startsWith(r.id + ':') && !pendingIds.has(id)) this.rawRequests.delete(id);
      const state = desktopState(response.thread, requests, r.model, r.effort);
      const revision = (this.publishedRevision.get(threadId) ?? 0) + 1;
      if (this.stopped || !this.loaded.has(r.id) || this.runs.get(r.id)?.desktop) throw new Error('Conversation ownership changed');
      this.desktop!.broadcast('thread-stream-state-changed', { hostId: 'local', conversationId: threadId, change: { type: 'snapshot', revision, conversationState: state } });
      this.publishedRevision.set(threadId, revision); return revision;
    })().finally(() => this.publishing.delete(threadId));
    this.publishing.set(threadId, work); return work;
  }
  private projectDetails(path: string) {
    const descriptor = projectDescriptor(path);
    return { ...descriptor, name: this.projects.get(descriptor.id)?.name ?? descriptor.name };
  }
  private rememberProject(path: string): void {
    const project = projectDescriptor(canonicalProject(path));
    const saved = this.projects.get(project.id); this.projects.set(project.id, { ...project, name: saved?.name ?? project.name });
  }
  private discovery?: Promise<void>;
  private discover(): Promise<void> {
    if (this.discovery) return this.discovery;
    this.discovery = (async () => {
      const found = new Map<string, any>();
      const cursors = new Set<string>(); let cursor: string | undefined;
      if (this.options.device) for (const project of savedCodexProjects(this.options.env)) this.projects.set(project.id, project);
      do {
        const result = await this.rpc.request('thread/list', { ...(this.options.device ? {} : { cwd: this.project }), limit: 100, modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'], sortKey: 'updated_at', useStateDbOnly: true, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result.data)) throw new Error('Invalid Codex conversation catalog');
        for (const t of result.data) if (typeof t.cwd === 'string' && ID.test(t.id) && (this.options.device || t.cwd === this.project)) {
          this.rememberProject(t.cwd); found.set(`native:${t.id}`, t);
        }
        if (found.size > 10000) throw new Error('Codex catalog exceeds 10,000 conversations; use a project-scoped connection');
        cursor = result.nextCursor || undefined;
        if (cursor) { if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Invalid Codex catalog cursor'); cursors.add(cursor); }
      } while (cursor);
      this.native = found;
    })().finally(() => { this.discovery = undefined; });
    return this.discovery;
  }
  private async desktopTurn(r: Entry, params: object): Promise<any> {
    this.desktop!.follow(r.threadId!);
    const run = this.runs.get(r.id)!; run.desktop = true;
    try {
      const result = await this.desktop!.request('thread-follower-start-turn', { conversationId: r.threadId, turnStart: { request: params, context: { inheritThreadSettings: true } } });
      if (!result?.result?.turn?.id) throw new DesktopIpcError('uncertain', 'Desktop did not confirm a native turn identity');
      return result.result;
    } catch (error) {
      // Only the bus's explicit no-owner result proves this request was not delivered.
      // A cached active desktop snapshot still forbids opening another writer.
      const snapshot = this.desktop!.snapshots.get(r.threadId!);
      if (!(error instanceof DesktopIpcError) || error.outcome !== 'no-owner' || (snapshot ? desktopTurns(snapshot.state) : []).some((t: any) => ['inProgress', 'running', 'active'].includes(t.status))) throw error;
      const latest = await this.rpc.request('thread/turns/list', { threadId: r.threadId, limit: 1, itemsView: 'full', sortDirection: 'desc' });
      if (!Array.isArray(latest.data) || latest.data.some((t: any) => ['inProgress', 'running', 'active'].includes(t.status))) throw new DesktopIpcError('uncertain', 'A native task may still be running. Continue it on your computer.');
      run.desktop = false;
      await this.thread(r);
      return this.rpc.request('turn/start', params);
    }
  }
  private desktopSnapshot(threadId: string, snapshot: DesktopSnapshot): void {
    const r = this.records.find(e => e.native && e.threadId === threadId);
    if (!r || !snapshot.fresh) return;
    r.model = snapshot.state.latestModel ?? r.model; r.effort = snapshot.state.latestReasoningEffort ?? r.effort; r.provider = snapshot.state.modelProvider ?? r.provider;
    const turns = desktopTurns(snapshot.state);
    const active = turns.filter((t: any) => ['inProgress', 'running', 'active'].includes(t.status));
    // Parallel active turns require an explicit native target; never guess one.
    if (active.length > 1) { this.update({ type: 'error', sessionKey: r.id, code: 'unsupported', message: 'This conversation has parallel active tasks. Choose the task in Codex Desktop.' }); return; }
    const turn = active[0];
    let run = this.runs.get(r.id);
    if (run && !run.desktop) return; // An idle desktop echo cannot take a local writer.
    if (turn) {
      const turnId = turn.turnId ?? turn.id;
      if (typeof turnId !== 'string' || !turnId) return;
      if (!run) { run = { id: `desktop:${turnId}`, desktop: true, turnId, text: '', started: Date.now(), items: new Map() }; this.runs.set(r.id, run); this.update({ type: 'run_started', sessionKey: r.id, runId: run.id }); }
      run.turnId = turnId;
      const items = Array.isArray(turn.items) ? turn.items : [];
      const text = items.filter((i: any) => ['agentMessage', 'assistantMessage'].includes(i.type)).map((i: any) => i.text ?? i.message ?? '').join('\n\n').slice(-128000);
      if (text !== run.text) { run.text = text; this.update({ type: 'agent_message_chunk', sessionKey: r.id, runId: run.id, text, textMode: 'snapshot' }); }
      for (const item of items) {
        if (typeof item.id !== 'string') continue;
        const old = run.items.get(item.id); run.items.set(item.id, item); this.items.set(item.id, item);
        const tool = codexTool(item); if (!tool) continue;
        if (!old) this.update({ type: 'tool_call', sessionKey: r.id, runId: run.id, toolCallId: item.id, title: tool.name, rawInput: tool.input });
        if (tool.status !== 'running' && tool.status !== 'unknown' && old?.status !== item.status) this.update({ type: 'tool_call_update', sessionKey: r.id, runId: run.id, toolCallId: item.id, status: tool.status, rawOutput: tool.output });
      }
    } else if (run?.turnId) {
      const terminal = turns.find((t: any) => (t.turnId ?? t.id) === run!.turnId && ['completed', 'interrupted', 'failed'].includes(t.status));
      if (terminal) { run.final = (terminal.items ?? []).filter((i: any) => i.type === 'agentMessage').map((i: any) => i.text ?? '').join('\n\n'); this.finish(r, terminal.status === 'interrupted' ? 'cancelled' : terminal.status === 'failed' ? 'error' : 'end_turn'); }
    }
    const pending = snapshot.state.requests.filter((q: any) => q.completed !== true);
    for (const [id, consent] of this.approvals) if (consent.desktop && consent.entry === r && !pending.some((q: any) => q.id === consent.wireId)) { this.approvals.delete(id); this.update({ type: 'approval_resolved', approvalId: id, decision: 'expired' }); }
    for (const [id, group] of this.questions) if (group.desktop && group.entry === r && !pending.some((q: any) => q.id === group.wireId)) { this.questions.delete(id); for (const key of group.pending.keys()) this.update({ type: 'question_resolved', sessionKey: r.id, questionId: key }); }
    for (const request of pending) {
      if ([...this.approvals.values()].some(c => c.desktop && c.entry === r && c.wireId === request.id) || this.questions.has(`${r.id}:${typeof request.id}:${request.id}`)) continue;
      try { this.interaction({ ...request, params: { ...request.params, threadId, turnId: request.params?.turnId ?? turn?.turnId ?? turn?.id } }, true); }
      catch { this.update({ type: 'error', sessionKey: r.id, code: 'unsupported', message: 'Answer this request in Codex Desktop; its format is not supported on mobile.' }); }
    }
    this.update({ type: 'session_info_update', session: this.descriptor(r) });
  }
  private get indexPath(): string { return join(this.options.directory, 'sessions.json'); }
  private save(): void {
    const data = JSON.stringify({ project: this.project, sessions: this.records });
    if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new Error('Codex session index limit reached');
    writeFileSync(this.indexPath + '.pending', data, { mode: 0o600 }); renameSync(this.indexPath + '.pending', this.indexPath);
  }
  private create(title = '', cwd = this.project): Entry {
    if (this.records.length >= 1000) throw new Error('Project session limit reached');
    const record: Entry = { cwd, id: randomUUID(), title: title.slice(0, 200), created: Date.now(), keys: {} };
    this.records.push(record); this.save(); return record;
  }
  private record(key: unknown): Entry {
    let record = this.records.find(r => r.id === key);
    const native = this.native.get(String(key));
    if (!record && native && this.options.device) {
      record = { id: String(key), threadId: native.id, native: true, cwd: native.cwd, title: native.name || native.preview?.slice(0, 80) || '', created: native.createdAt * 1000 || Date.now(), activity: native.updatedAt * 1000 || Date.now(), model: native.model, provider: native.modelProvider, keys: {} };
      if (this.records.length >= 1000) throw new Error('Conversation index limit reached');
      this.records.push(record); this.save(); this.desktop?.follow(native.id);
    }
    if (!record) throw new Error('This session is read-only. Create a branch to continue.');
    return record;
  }
  private serial<T>(record: Entry, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(record.id) ?? Promise.resolve()).catch(() => {}).then(() => {
      if (this.stopped || this.disconnected) throw new Error('Codex Bridge is unavailable. Restart it on your computer.');
      this.record(record.id); return fn();
    });
    this.queues.set(record.id, next);
    void next.finally(() => { if (this.queues.get(record.id) === next) this.queues.delete(record.id); }).catch(() => {});
    return next;
  }
  private update(update: SessionUpdate): void { this.emit('update', update); }
  private descriptor(r: Entry): SessionDescriptor {
    return { connectionId: '', agentId: 'codex', key: r.id, kind: 'direct', title: r.title || basename(r.cwd ?? this.project), updatedAt: r.activity ?? r.created, lastActivityAt: r.activity ?? null, preview: r.preview, model: r.model, modelProvider: r.provider, sessionId: r.threadId, hasActiveRun: this.runs.has(r.id), project: this.options.device ? this.projectDetails(r.cwd ?? this.project) : undefined, canContinue: r.native ? !!this.options.device : undefined, source: r.native ? 'native' : 'bridge', allowedActions: { rename: !r.native, reset: !r.native, delete: !r.native, pin: true } };
  }
  private async thread(r: Entry): Promise<void> {
    if (this.loaded.has(r.id)) return;
    // Codex does not persist an empty thread's rollout across App Server restarts.
    // Only recreate sessions that have never submitted a turn; uncertain submissions must retain their identity.
    const resume = !!r.threadId && !!r.activity;
    if (r.native && this.runs.get(r.id)?.desktop) throw new Error('This task is controlled by Codex Desktop');
    const result = await this.rpc.request(resume ? 'thread/resume' : 'thread/start', { ...PERMISSIONS, cwd: r.cwd ?? this.project, ...(resume ? { threadId: r.threadId, excludeTurns: true } : {}), ...(r.model ? { model: r.model } : {}) });
    if (!ID.test(result.thread?.id) || result.thread.cwd !== (r.cwd ?? this.project)) throw new Error('Codex returned a different project');
    r.threadId = result.thread.id; r.model = result.model ?? result.thread.model; r.provider = result.modelProvider ?? result.thread.modelProvider; r.effort ??= result.reasoningEffort ?? result.thread.reasoningEffort;
    this.loaded.add(r.id); this.save();
  }
  private async refreshModels(): Promise<any[]> {
    const models = new Map<string, any>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.rpc.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data) || result.data.some((m: any) => !m || typeof m.model !== 'string' || !m.model.trim())) throw new Error('Invalid Codex model catalog');
      for (const model of result.data) if (!model.hidden) models.set(model.model, model);
      if (models.size > 2000) throw new Error('Codex model catalog is too large');
      if (result.nextCursor == null) {
        this.catalog = [...models.values()];
        return this.catalog;
      }
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || cursors.has(result.nextCursor)) throw new Error('Invalid Codex model catalog cursor');
      cursor = result.nextCursor;
      cursors.add(result.nextCursor);
    }
    throw new Error('Codex model catalog pagination did not finish');
  }
  async health(): Promise<object> {
    if (this.stopped || this.disconnected) throw new Error('Codex process is unavailable. Restart the Bridge.');
    const catalog = await this.refreshModels();
    const account = await this.rpc.request('account/read', { refreshToken: false });
    return { backend: 'codex', modelReady: account.requiresOpenaiAuth !== true || !!account.account, model: catalog.find(m => m.isDefault)?.model ?? '', vision: true, project: basename(this.project), projects: !!this.options.device, desktopConnected: this.desktop?.ready === true };
  }
  async request(frame: CodexRequest): Promise<unknown> {
    if (frame.type !== 'req' || typeof frame.id !== 'string' || frame.id.length > 200 || !frame.id || typeof frame.method !== 'string' || (frame.params !== undefined && (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)))) throw new Error('Invalid Codex request');
    const p = frame.params ?? {};
    switch (frame.method) {
      case 'health': return this.health();
      case 'agents.list': return [{ connectionId: '', agentId: 'codex', name: this.options.device ? 'Codex' : `Codex · ${basename(this.project)}`, isMain: true, mainSessionKey: '', entryMode: 'sessions' }];
      case 'projects.list': {
        if (!this.options.device) throw new Error('Project browsing is unavailable');
        await this.discover(); return [...this.projects.values()];
      }
      case 'sessions.list': {
        await this.discover();
        return [...this.records.map(r => this.descriptor(r)), ...[...this.native.entries()].filter(([, t]) => !this.records.some(r => r.threadId === t.id)).map(([key, t]) => ({ connectionId: '', agentId: 'codex', key, kind: 'direct', title: t.name || t.preview?.slice(0, 80) || basename(t.cwd), updatedAt: t.updatedAt * 1000, lastActivityAt: (t.recencyAt ?? t.updatedAt) * 1000, preview: t.preview?.slice(0, 160), model: t.model, modelProvider: t.modelProvider, hasActiveRun: t.status?.type === 'active', project: this.options.device ? this.projectDetails(t.cwd) : undefined, canContinue: this.options.device === true, source: 'native', allowedActions: { rename: false, reset: false, delete: false, pin: true } }))];
      }
      case 'sessions.create': {
        if (p.title !== undefined && typeof p.title !== 'string') throw new Error('Invalid title');
        if (!p.fromSession) {
          const project = p.projectId === undefined ? projectDescriptor(this.project) : this.projects.get(String(p.projectId));
          if (!project?.available) throw new Error('Project is unavailable; refresh the project list');
          return this.descriptor(this.create(p.title as string, canonicalProject(project.path)));
        }
        const owned = this.records.find(r => r.id === p.fromSession);
        if (owned && this.runs.has(owned.id)) throw new Error('Wait for this task to finish before branching');
        if (owned && !owned.native) await this.serial(owned, () => this.thread(owned));
        const native = this.native.get(String(p.fromSession));
        const threadId = owned?.threadId ?? native?.id;
        if (!threadId || native?.status?.type === 'active') throw new Error('Source conversation is unavailable or still running');
        const cwd = owned?.cwd ?? native?.cwd ?? this.project;
        const result = await this.rpc.request('thread/fork', { ...PERMISSIONS, threadId, cwd, excludeTurns: true });
        if (!ID.test(result.thread?.id) || result.thread.cwd !== cwd) throw new Error('Invalid Codex branch');
        const r = this.create(p.title as string, cwd); r.threadId = result.thread.id; r.model = result.model; r.provider = result.modelProvider; r.effort = result.reasoningEffort; r.activity = Date.now(); this.loaded.add(r.id); this.save(); return this.descriptor(r);
      }
      case 'sessions.rename': return this.serial(this.record(p.sessionKey), async () => {
        const r = this.record(p.sessionKey); if (r.native) throw new Error('Native conversation metadata is read-only'); if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) throw new Error('Invalid title');
        if (r.threadId && (r.activity || this.loaded.has(r.id))) await this.rpc.request('thread/name/set', { threadId: r.threadId, name: p.title.trim() });
        r.title = p.title.trim(); this.save(); return { ok: true };
      });
      case 'sessions.reset': case 'sessions.delete': return this.serial(this.record(p.sessionKey), async () => {
        const r = this.record(p.sessionKey); if (r.native) throw new Error('Native conversation metadata is read-only'); if (this.runs.has(r.id)) throw new Error('Stop the task and wait for it to finish first');
        if (r.threadId && (r.activity || this.loaded.has(r.id))) await this.rpc.request('thread/archive', { threadId: r.threadId });
        if (frame.method === 'sessions.delete') { this.records = this.records.filter(row => row !== r); }
        else { r.threadId = undefined; r.model = undefined; r.provider = undefined; r.preview = undefined; r.activity = undefined; r.effort = undefined; }
        this.loaded.delete(r.id); this.save(); return { ok: true };
      });
      case 'chat.history': return this.history(p.sessionKey, p.cursor);
      case 'chat.send': return this.prompt(this.record(p.sessionKey), p as unknown as PromptInput);
      case 'chat.abort': {
        const r = this.record(p.sessionKey), run = this.runs.get(r.id);
        if (!run) return { ok: true };
        if ((p.runId && p.runId !== run.id) || !run.turnId) throw new Error('Task changed or is still starting');
        await (run.desktop ? this.desktop!.request('thread-follower-interrupt-turn', { conversationId: r.threadId, mode: 'user-stop', expectedTurnId: run.turnId }) : this.rpc.request('turn/interrupt', { threadId: r.threadId, turnId: run.turnId })); return { ok: true };
      }
      case 'chat.steer': {
        const r = this.record(p.sessionKey), run = this.runs.get(r.id);
        if (!run?.turnId || run.id !== p.runId || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 128000) throw new Error('Task is no longer running');
        await (run.desktop ? this.desktop!.request('thread-follower-steer-turn', { conversationId: r.threadId, expectedTurnId: run.turnId, input: [{ type: 'text', text: p.text }] }) : this.rpc.request('turn/steer', { threadId: r.threadId, expectedTurnId: run.turnId, input: [{ type: 'text', text: p.text }] })); return { ok: true };
      }
      case 'approvals.list': this.record(p.sessionKey); return [...this.approvals.values()].filter(a => a.entry.id === p.sessionKey).map(a => ({ sessionKey: a.entry.id, approval: a.approval }));
      case 'approvals.resolve': {
        const consent = this.approvals.get(String(p.id));
        if (!consent || this.runs.get(consent.entry.id)?.turnId !== consent.turnId) throw new Error('Approval is no longer pending');
        if (!['allow-once', 'deny'].includes(String(p.decision))) throw new Error('Only one-time approval is supported');
        const response = consent.permissions ? { permissions: p.decision === 'allow-once' ? consent.permissions : {}, scope: 'turn' } : { decision: p.decision === 'allow-once' ? 'accept' : 'decline' };
        if (consent.desktop) {
          const method = consent.permissions ? 'thread-follower-permissions-request-approval-response' : consent.approval.category === 'file' ? 'thread-follower-file-approval-decision' : 'thread-follower-command-approval-decision';
          await this.desktop!.request(method, { conversationId: consent.entry.threadId, requestId: consent.wireId, ...(consent.permissions ? { response } : response) });
        } else this.rpc.respond(consent.wireId, response);
        this.approvals.delete(String(p.id)); this.scheduleDesktop(consent.entry); this.update({ type: 'approval_resolved', approvalId: String(p.id), decision: String(p.decision) }); return { ok: true };
      }
      case 'questions.list': this.record(p.sessionKey); return [...this.questions.values()].filter(g => g.entry.id === p.sessionKey).flatMap(g => [...g.pending.values()].map(q => q.question));
      case 'questions.respond': {
        this.record(p.sessionKey);
        const group = [...this.questions.values()].find(g => g.entry.id === p.sessionKey && g.pending.has(String(p.questionId)));
        if (!group || this.runs.get(group.entry.id)?.turnId !== group.turnId) throw new Error('Question is no longer pending');
        const row = group.pending.get(String(p.questionId))!;
        if (p.cancelled === true && row.question.kind === 'form') {
          await this.request({ type: 'req', id: frame.id + '-cancel', method: 'chat.abort', params: { sessionKey: p.sessionKey } });
          return { ok: true }; // Wait for native resolution; no empty answer masquerades as cancellation.
        }
        if (row.question.kind === 'form') {
          if (!p.answers || typeof p.answers !== 'object' || Array.isArray(p.answers)) throw new Error('Answer every question');
          const answers = p.answers as Record<string, unknown>;
          const fields = row.question.fields!;
          if (Object.keys(answers).length !== fields.length) throw new Error('Answer every question');
          const validated: Record<string, { answers: string[] }> = Object.create(null);
          for (const field of fields) {
            const values = answers[field.id];
            if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' || !values[0].trim() || values[0].length > 64000 || (!field.allowCustom && !field.options.some(o => o.label === values[0]))) throw new Error('Invalid answer');
            validated[field.id] = { answers: values };
          }
          group.answers = validated;
        } else {
          if (p.cancelled !== true && (typeof p.value !== 'string' || p.value.length > 64000)) throw new Error('Invalid answer');
          group.answers[row.nativeId] = { answers: p.cancelled === true ? [] : [p.value as string] };
        }
        if (group.pending.size === 1) {
          if (group.desktop) await this.desktop!.request('thread-follower-submit-user-input', { conversationId: group.entry.threadId, requestId: group.wireId, response: { answers: group.answers } });
          else this.rpc.respond(group.wireId, { answers: group.answers });
          this.questions.delete(`${group.entry.id}:${typeof group.wireId}:${group.wireId}`);
        }
        group.pending.delete(String(p.questionId)); this.scheduleDesktop(group.entry); this.update({ type: 'question_resolved', sessionKey: group.entry.id, questionId: String(p.questionId) }); return { ok: true };
      }
      case 'models.list': {
        if (p.sessionKey) return this.sessionModels(frame, p);
        const catalog = await this.refreshModels();
        return this.modelSelection(catalog);
      }
      case 'models.select': case 'models.thinking': return this.sessionModels(frame, p);
      case 'skills.list': {
        const result = await this.rpc.request('skills/list', { cwds: [this.project] });
        return { workspaceDir: basename(this.project), managedSkillsDir: '', skills: (result.data ?? []).filter((d: any) => d.cwd === this.project).flatMap((d: any) => d.skills ?? []).filter((s: any) => s.enabled !== false).slice(0, 500).map((s: any) => ({ name: s.name, description: s.description ?? '', invocation: `$${s.name} `, source: 'codex', bundled: false, filePath: '', baseDir: '', skillKey: s.name, always: false, disabled: false, blockedByAllowlist: false, eligible: true, deletable: false, requirements: {}, missing: {}, configChecks: [], install: [] })) };
      }
      default: throw new Error('Unsupported Codex operation');
    }
  }
  private sessionModels(frame: CodexRequest, p: Record<string, any>): Promise<unknown> {
    return this.serial(this.record(p.sessionKey), async () => {
        const r = this.record(p.sessionKey); if (!r.native) await this.thread(r);
        const catalog = await this.refreshModels();
        if (frame.method === 'models.select') {
          if (p.scope !== 'session' || !p.sessionKey || p.provider !== r.provider || typeof p.model !== 'string' || !catalog.some(m => m.model === p.model)) throw new Error('Choose an available model for this session');
          if (this.runs.has(r.id)) throw new Error('Stop the task before changing its model');
          if (r.native) await this.desktop!.request('thread-follower-update-thread-settings', { conversationId: r.threadId, threadSettings: { model: p.model, effort: catalog.find(m => m.model === p.model)?.defaultReasoningEffort } });
          r.model = p.model; r.effort = catalog.find(m => m.model === p.model)?.defaultReasoningEffort; this.save();
        }
        const selected = catalog.find(m => m.model === r.model);
        if (frame.method === 'models.thinking') {
          if (!p.sessionKey || typeof p.level !== 'string' || !selected?.supportedReasoningEfforts?.some((e: any) => e.reasoningEffort === p.level)) throw new Error('This model does not support that reasoning level');
          if (this.runs.has(r.id)) throw new Error('Wait for this task to finish before changing reasoning');
          if (r.native) await this.desktop!.request('thread-follower-update-thread-settings', { conversationId: r.threadId, threadSettings: { effort: p.level } });
          r.effort = p.level; this.save();
        }
        if (!r.effort && selected?.defaultReasoningEffort) { r.effort = selected.defaultReasoningEffort; this.save(); }
        return this.modelSelection(catalog, r);
      });
  }
  private modelSelection(catalog: any[], r?: Entry) {
    const models = catalog.map(m => ({ id: m.model, name: m.displayName, provider: r?.provider ?? 'openai', input: m.inputModalities ?? ['text', 'image'], reasoning: m.supportedReasoningEfforts?.length > 0, reasoningLevels: m.supportedReasoningEfforts?.map((e: any) => e.reasoningEffort) }));
    if (r?.model && !models.some(m => m.id === r.model)) models.unshift({ id: r.model, name: r.model, provider: r.provider ?? '', input: ['text'], reasoning: false, reasoningLevels: [] });
    return { ok: true, scope: 'session', thinkingLevel: r?.effort, currentModel: r?.model ?? '', currentProvider: r?.provider ?? '', currentBaseUrl: '', models };
  }
  private async history(key: unknown, cursor: unknown): Promise<SessionHistory> {
    const owned = this.options.device && this.native.has(String(key)) ? this.record(key) : this.records.find(r => r.id === key), native = this.native.get(String(key));
    if (!owned && !native) throw new Error('Session unavailable; refresh the conversation list');
    if (owned && (!owned.threadId || !owned.activity)) return { key: owned.id, messages: [], hasActiveRun: false };
    const threadId = owned?.threadId ?? native.id;
    if (owned?.native) { this.desktop?.follow(threadId); const snapshot = this.desktop?.snapshots.get(threadId); if (snapshot?.fresh) this.desktopSnapshot(threadId, snapshot); }
    let page: { native?: string; end?: number } = {};
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 4096) throw new Error('Invalid history cursor');
      try { page = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new Error('Invalid history cursor'); }
      if (!page || typeof page !== 'object' || (page.native !== undefined && typeof page.native !== 'string') || (page.end !== undefined && (!Number.isSafeInteger(page.end) || page.end < 0))) throw new Error('Invalid history cursor');
    }
    const metadata = await this.rpc.request('thread/read', { threadId, includeTurns: false });
    if (metadata.thread?.cwd !== (owned?.cwd ?? native?.cwd ?? this.project)) throw new Error('Session belongs to another project');
    // Both supported versions expose native pagination, including the new paginated-history contract.
    const result = await this.rpc.request('thread/turns/list', { threadId, limit: 10, itemsView: 'full', sortDirection: 'desc', ...(page.native ? { cursor: page.native } : {}) });
    const active = owned ? this.runs.get(owned.id) : undefined;
    const turns = [...(result.data ?? [])].reverse();
    const liveTurn = active?.turnId && turns.find(t => t.id === active.turnId);
    if (liveTurn && active) {
      const combined = new Map((liveTurn.items ?? []).map((item: any) => [item.id, item]));
      for (const [id, item] of active.items) combined.set(id, item);
      liveTurn.items = [...combined.values()];
    }
    const messages = codexMessages(turns);
    const end = page.end ?? messages.length;
    if (end > messages.length) throw new Error('History changed; refresh this conversation');
    let start = end, bytes = 0;
    while (start > Math.max(0, end - 40)) { const size = Buffer.byteLength(JSON.stringify(messages[start - 1])); if (bytes + size > 7 * 1024 * 1024) break; bytes += size; start--; }
    if (start === end && end) throw new Error('This message exceeds the history transfer limit');
    const next = start ? { native: page.native, end: start } : result.nextCursor ? { native: result.nextCursor } : undefined;
    const run = owned ? this.runs.get(owned.id) : undefined;
    return { key: String(key), messages: messages.slice(start, end), nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : undefined, sessionId: threadId, thinkingLevel: owned?.effort, hasActiveRun: !!run, activeRun: run ? { runId: run.id, text: run.text, startedAtMs: run.started, sessionAbortable: !!run.turnId } : undefined };
  }
  private prompt(r: Entry, input: PromptInput): Promise<{ runId: string }> {
    return this.serial(r, async () => {
      if (typeof input.text !== 'string' || input.text.length > 128000 || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error('Invalid prompt');
      const images = input.attachments ?? [];
      if (!Array.isArray(images) || images.length > 6 || images.some(a => !a || a.type !== 'image' || !/^image\/(png|jpeg|webp|gif)$/.test(a.mimeType) || typeof a.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.content))) throw new Error('Codex supports image attachments only');
      if (!input.text.trim() && !images.length) throw new Error('Enter a message or attach an image');
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const previous = Object.hasOwn(r.keys, input.idempotencyKey) ? r.keys[input.idempotencyKey] : undefined;
      if (previous) { if (previous.hash !== hash) throw new Error('Prompt key already used for different content'); return { runId: previous.runId }; }
      if (this.runs.has(r.id)) throw new Error('This session is busy. Stop it or send guidance.');
      if (!projectDescriptor(r.cwd ?? this.project).available) throw new Error('The working directory no longer exists');
      if (!r.native) await this.thread(r);
      else await this.desktop!.connect();
      const model = this.catalog.find(m => m.model === r.model);
      if (images.length && model && !model.inputModalities?.includes('image')) throw new Error('This model does not support images');
      if (!r.native && input.thinkingLevel && !model?.supportedReasoningEfforts?.some((e: any) => e.reasoningEffort === input.thinkingLevel)) throw new Error('This model does not support that reasoning level');
      if (Object.keys(r.keys).length >= 10000) throw new Error('Start a new conversation to continue');
      const runId = randomUUID();
      Object.defineProperty(r.keys, input.idempotencyKey, { value: { hash, runId }, enumerable: true, configurable: true });
      r.preview = input.text.slice(0, 160); r.activity = Date.now(); if (!r.title) r.title = input.text.trim().slice(0, 80); r.effort = input.thinkingLevel ?? r.effort; this.save();
      this.runs.set(r.id, { id: runId, text: '', started: Date.now(), items: new Map() }); this.update({ type: 'run_started', sessionKey: r.id, runId });
      const params = { threadId: r.threadId, input: [{ type: 'text', text: input.text }, ...images.map(a => ({ type: 'image', url: `data:${a.mimeType};base64,${a.content}` }))], ...(r.native ? {} : { model: r.model, effort: r.effort }), clientUserMessageId: input.idempotencyKey };
      const accepted = r.native ? this.desktopTurn(r, params) : this.rpc.request('turn/start', params);
      if (this.starts.size >= 256) this.starts.delete(this.starts.keys().next().value!);
      this.starts.set(runId, accepted);
      void accepted.then(result => {
        const run = this.runs.get(r.id); if (run?.id === runId) run.turnId = result.turn?.id;
      }).catch(error => {
        const current = this.runs.get(r.id);
        if (current?.id !== runId) return;
        // Notifications may already prove the turn started before its RPC acknowledgement was lost.
        if (current.turnId) return;
        if (error?.outcome === 'rejected') this.finish(r, 'error');
        else this.update({ type: 'error', sessionKey: r.id, runId, code: 'timeout', message: 'Codex has not confirmed this request. Check the conversation before sending it again.' });
      });
      return { runId };
    });
  }
  private notification(method: string, p: any): void {
    const r = this.records.find(row => row.threadId === p.threadId); if (!r) return;
    if (method === 'serverRequest/resolved') {
      for (const [id, consent] of this.approvals) if (consent.entry === r && consent.wireId === p.requestId) {
        this.approvals.delete(id); this.update({ type: 'approval_resolved', approvalId: id, decision: 'expired' });
      }
      const group = this.questions.get(`${r.id}:${typeof p.requestId}:${p.requestId}`);
      if (group?.entry === r) {
        this.questions.delete(`${r.id}:${typeof p.requestId}:${p.requestId}`);
        for (const id of group.pending.keys()) this.update({ type: 'question_resolved', sessionKey: r.id, questionId: id });
      }
      this.scheduleDesktop(r); return;
    }
    const run = this.runs.get(r.id); if (!run || run.desktop) return;
    this.scheduleDesktop(r);
    if (method === 'turn/started') { if (!run.turnId) run.turnId = p.turn?.id; return; }
    if (p.turnId && run.turnId && p.turnId !== run.turnId) return;
    const base = { sessionKey: r.id, runId: run.id };
    if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      if (run.itemId !== p.itemId) { run.itemId = p.itemId; if (run.text) run.text += '\n\n'; }
      const item = run.items.get(p.itemId) ?? { id: p.itemId, type: 'agentMessage', text: '' };
      item.text = (item.text + p.delta).slice(-128000); run.items.set(p.itemId, item);
      run.text = (run.text + p.delta).slice(-128000); this.update({ type: 'agent_message_chunk', ...base, text: run.text, textMode: 'snapshot' });
    }
    if (method === 'item/reasoning/summaryTextDelta' && typeof p.delta === 'string') this.update({ type: 'agent_thought_chunk', ...base, text: p.delta });
    if (method === 'item/started' || method === 'item/completed') {
      const item = p.item; if (!item || typeof item.id !== 'string') return;
      if (this.items.size >= 512) this.items.delete(this.items.keys().next().value!);
      this.items.set(item.id, item);
      if (run.items.size >= 512 && !run.items.has(item.id)) run.items.delete(run.items.keys().next().value!);
      run.items.set(item.id, item);
      if (item.type === 'agentMessage' && method === 'item/completed') run.final = String(item.text ?? '').slice(-128000);
      const tool = codexTool(item);
      if (tool && method === 'item/started') this.update({ type: 'tool_call', ...base, toolCallId: item.id, title: tool.name, kind: tool.name, rawInput: tool.input });
      if (tool && method === 'item/completed') this.update({ type: 'tool_call_update', ...base, toolCallId: item.id, status: tool.status === 'error' ? 'error' : 'success', rawOutput: tool.output });
    }
    if (method === 'turn/completed' && p.turn?.id === run.turnId) this.finish(r, p.turn.status === 'interrupted' ? 'cancelled' : p.turn.status === 'failed' ? 'error' : 'end_turn');
  }
  private interaction(frame: any, desktop = false): void {
    const p = frame.params ?? {}, r = this.records.find(row => row.threadId === p.threadId), run = r && this.runs.get(r.id);
    if (!r || !run?.turnId || p.turnId !== run.turnId || this.approvals.size + this.questions.size >= 32) { if (!desktop) this.rpc.refuse(frame.id); return; }
    const remember = () => { if (!desktop) { if (this.rawRequests.size >= 64) this.rawRequests.delete(this.rawRequests.keys().next().value!); this.rawRequests.set(`${r.id}:${typeof frame.id}:${frame.id}`, frame); this.scheduleDesktop(r); } };
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(frame.method)) {
      const id = randomUUID(), item = this.items.get(p.itemId);
      const category = frame.method.includes('fileChange') ? 'file' : frame.method.includes('permissions') ? 'permissions' : p.networkApprovalContext ? 'network' : 'command';
      const command = category === 'file' ? JSON.stringify(item?.changes ?? { grantRoot: p.grantRoot }) : category === 'permissions' ? JSON.stringify(p.permissions) : p.command ?? JSON.stringify(p.networkApprovalContext ?? {});
      const approval: Consent['approval'] = { kind: 'exec', id, category, command, reason: p.reason, cwd: p.cwd ?? r.cwd ?? this.project, decisions: ['allow-once', 'deny'], expiresAtMs: null };
      if (typeof command !== 'string' || !command.trim() || command === '{}' || command.length > 128000) { if (!desktop) this.rpc.refuse(frame.id); return; }
      remember(); this.approvals.set(id, { desktop, wireId: frame.id, entry: r, turnId: run.turnId, approval, permissions: category === 'permissions' ? p.permissions : undefined });
      this.update({ type: 'approval_requested', sessionKey: r.id, approval }); return;
    }
    if (['item/tool/requestUserInput', 'tool/requestUserInput'].includes(frame.method) && Array.isArray(p.questions) && p.questions.length > 0 && p.questions.length <= 10 && !p.questions.some((q: any) => q.isSecret)) {
      if (this.questions.has(`${r.id}:${typeof frame.id}:${frame.id}`)) return;
      const fields = p.questions.map((q: any) => {
        if (!q || typeof q.id !== 'string' || !q.id || ['__proto__', 'constructor', 'prototype'].includes(q.id) || typeof q.question !== 'string' || (q.options != null && (!Array.isArray(q.options) || q.options.length > 20 || q.options.some((o: any) => typeof o.label !== 'string' || !o.label)))) throw new Error('Unsupported question format');
        return { id: q.id, title: q.question.slice(0, 2000), header: q.header, options: (q.options ?? []).map((o: any) => ({ label: o.label, description: o.description })), allowCustom: q.isOther === true || !q.options?.length };
      });
      if (new Set(fields.map((f: any) => f.id)).size !== fields.length) { if (!desktop) this.rpc.refuse(frame.id); return; }
      const id = randomUUID();
      const question: AgentQuestion = { id, kind: 'form', title: fields[0].title, fields, expiresAtMs: null };
      remember(); this.questions.set(`${r.id}:${typeof frame.id}:${frame.id}`, { desktop, wireId: frame.id, entry: r, turnId: run.turnId, pending: new Map([[id, { question, nativeId: fields[0].id }]]), answers: Object.create(null) });
      this.update({ type: 'question_requested', sessionKey: r.id, question }); return;
    }
    if (!desktop) this.rpc.refuse(frame.id);
    else throw new Error('Unsupported native request');
  }
  private finish(r: Entry, stopReason: 'end_turn' | 'cancelled' | 'error'): void {
    const run = this.runs.get(r.id); if (!run) return;
    this.runs.delete(r.id);
    for (const [id, c] of this.approvals) if (c.entry === r) { this.approvals.delete(id); this.update({ type: 'approval_resolved', approvalId: id, decision: 'expired' }); }
    for (const [id, group] of this.questions) if (group.entry === r) { this.questions.delete(id); for (const q of group.pending.keys()) this.update({ type: 'question_resolved', sessionKey: r.id, questionId: q }); }
    r.activity = Date.now(); this.save(); this.scheduleDesktop(r);
    this.update({ type: 'run_finished', sessionKey: r.id, runId: run.id, stopReason, ...(stopReason === 'error' ? { message: { role: 'assistant', content: 'Codex could not confirm completion. Check model access and project trust on your computer before retrying.' } } : run.final ? { message: { role: 'assistant', content: run.final, model: r.model, provider: r.provider } } : {}) });
    this.update({ type: 'session_info_update', session: this.descriptor(r) });
  }
  async stop(): Promise<void> {
    if (this.stopped) return; this.stopped = true;
    for (const timer of this.publishTimers.values()) clearTimeout(timer); this.publishTimers.clear();
    this.desktop?.stop();
    await this.rpc.stop();
    if (existsSync(this.lockPath)) unlinkSync(this.lockPath);
  }
}
