import { UpdateAdmission } from '../update-admission.js';
import { DeliveredArtifacts } from '../delivered-artifacts.js';
import { sessionActivityKeys } from '../session-activity.js';
import { CodexSessionActivity } from './session-activity.js';
import { SessionCatalogSync } from '../session-catalog.js';
import { readPromptIdentity, recordedPromptStatus } from '../prompt-status.js';
import { InteractionAttention } from '../interaction-attention.js';
import { lastVisiblePreview, sessionPreview } from '../session-preview.js';
import { isDeepStrictEqual } from 'node:util';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, realpathSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { SessionDescriptor, SessionUpdate, SessionHistory, PromptInput, AgentQuestion, ApprovalRequest } from '@clawket/agent-protocol';
import { nativeSettings, matchesNativeSettings, permissionMode, permissionSelectionPatch, type NativeSettings } from './settings.js';
import { fastServiceTier, isFastServiceTier, hasServiceTier } from './speed.js';
import { CodexProfile } from './profile.js';
import { CodexRpc } from './rpc.js';
import { codexMessages, codexGeneratedImage, codexTool, codexTurnFailure } from './history.js';
import { loadDesktopHistory } from './desktop-history.js';
import { nativeResumeSpeed } from './resume-settings.js';
import { desktopTurns, desktopState } from './desktop-state.js';
import { canonicalProject, projectDescriptor, savedCodexProjects } from './projects.js';
import { DesktopIpc, DesktopIpcError, type DesktopSnapshot } from './desktop-ipc.js';

export interface CodexRequest { type: 'req'; id: string; method: string; params?: Record<string, unknown> }
export interface CodexOptions { bridgeVersion?: string; project: string; directory: string; command?: string; env?: NodeJS.ProcessEnv; device?: boolean; desktop?: DesktopIpc }
type Entry = { permissionsUnconfirmed?: true; archived?: boolean; cwd?: string; native?: boolean; id: string; threadId?: string; title: string; created: number; activity?: number; model?: string; provider?: string; effort?: string; serviceTier?: string | null; speedPreference?: { serviceTier: string | null; provider: string }; preview?: string; keys: Record<string, { hash: string; runId: string }> };
type Run = { desktop?: boolean; id: string; turnId?: string; text: string; started: number; itemId?: string; final?: string; items: Map<string, any> };
type Consent = { desktop?: boolean; wireId: string | number; entry: Entry; turnId: string; approval: Extract<ApprovalRequest, { kind: 'exec' }>; permissions?: object };
type QuestionGroup = { desktop?: boolean; wireId: string | number; entry: Entry; turnId: string; pending: Map<string, { question: AgentQuestion; nativeId: string }>; answers: Record<string, { answers: string[] }> };
type MetadataBaseline = Map<Entry, { threadId: string; revision: number; pending: boolean }>;
const ID = /^[a-f0-9-]{36}$/;
const PERMISSIONS = { approvalPolicy: 'on-request', approvalsReviewer: 'user', permissions: ':workspace' };
// Native catalog/index metadata may lack a model; the wire field is optional string.
const modelName = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

/** Device pairing discovers local projects; native writes retain the authoritative owner. */
export class CodexService extends EventEmitter {
  readonly conversation = this;
  private readonly catalogSync = new SessionCatalogSync(() => this.listSessions(true));
  private readonly project: string;
  private readonly lockPath: string;
  private rpc: CodexRpc;
  private sessionActivity?: CodexSessionActivity;
  private profile!: CodexProfile;
  private records: Entry[] = [];
  private metadataState = new WeakMap<Entry, { revision: number; pending: boolean }>();
  private missingActiveRecords = new Set<Entry>();
  private archiveVerification?: Promise<void>;
  private missingArchiveProbe?: { signature: string; expiresAt: number; nextCursor?: string };
  private native = new Map<string, any>();
  private archivedNative = new Map<string, any>();
  private nativePreviews = new Map<string, { version: string; preview?: string; lastActivityAt: number | null; checkedAt: number; failed?: boolean }>();
  private loaded = new Set<string>();
  private effectiveSettings = new Map<string, NativeSettings>();
  private settingsWaiters = new Map<string, { patch: Record<string, unknown>; resolve: (s: NativeSettings) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private desktopHistory = new Map<string, { thread: any; cursor: string | null; complete: boolean }>();
  private historyMetadata = new Map<string, { turns: Map<string, any>; cursor?: string; complete: boolean }>();
  private recovery?: Promise<void>;
  private nextRecoveryAt = 0;
  private recoveryFailures = 0;
  private runs = new Map<string, Run>();
  private starts = new Map<string, Promise<any>>();
  private queues = new Map<string, Promise<unknown>>();
  private approvals = new Map<string, Consent>();
  private questions = new Map<string, QuestionGroup>();
  private items = new Map<string, any>();
  private stopped = false;
  private readonly updateAdmission = new UpdateAdmission();
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
      {
        this.desktop = options.desktop ?? new DesktopIpc();
        this.desktop.on('follow', (id: string, following: boolean) => { if (following && this.records.some(r => r.threadId === id && this.loaded.has(r.id))) { this.desktopFollowers.add(id); void this.publishDesktop(id).catch(() => {}); } else this.desktopFollowers.delete(id); });
        this.desktop.handler = { accepts: (method, p) => this.acceptDesktop(method, p), request: (method, p) => this.desktopRequest(method, p) };
        this.desktop.on('unsupported', (id: string) => { const r = this.records.find(row => row.threadId === id); if (r && !this.desktop?.isObservationOnly?.(id)) this.update({ type: 'error', sessionKey: r.id, code: 'unsupported', message: 'This Codex Desktop version cannot be followed safely. Continue on your computer.' }); });
        this.sessionActivity = new CodexSessionActivity(this.desktop, activity => {
          if (!this.loaded.has(activity.key)) this.emit('update', { type: 'session_activity_update', activity });
        });
        this.desktop.on('snapshot', (id: string, snapshot: DesktopSnapshot) => {
          if (!this.desktop?.isObservationOnly?.(id)) this.desktopSnapshot(id, snapshot);
        });
        void this.desktop.connect().catch(() => {});
      }
      this.rpc = this.createRpc();
      this.profile = this.createProfile();
    } catch (error) { unlinkSync(this.lockPath); throw error; }
  }
  private createProfile(): CodexProfile {
    const rpc = this.rpc;
    const current = () => !this.stopped && !this.disconnected && this.rpc === rpc;
    return new CodexProfile({
      request: async (method, params) => {
        if (!current()) throw new Error('Reconnect and refresh before continuing');
        const result = await rpc.request(method, params);
        if (!current()) throw new Error('Reconnect and refresh before continuing');
        return result;
      },
      projects: async () => {
        if (!current()) throw new Error('Reconnect and refresh before continuing');
        if (this.options.device) await this.discover();
        if (!current()) throw new Error('Reconnect and refresh before continuing');
        return [...this.projects.values()];
      },
      models: () => this.refreshModels(),
      current,
    });
  }
  private createRpc(): CodexRpc {
    const rpc = new CodexRpc(this.options.command ?? 'codex', this.project, this.options.env);
    rpc.on('notification', frame => { if (this.rpc === rpc) this.notification(frame.method, frame.params ?? {}); });
    rpc.on('request', frame => { if (this.rpc === rpc) { try { this.interaction(frame); } catch { rpc.refuse(frame.id); } } });
    rpc.on('diagnostic', diagnostic => { if (this.rpc === rpc) this.emit('diagnostic', diagnostic); });
    rpc.on('gap', () => {
      if (this.rpc !== rpc || this.stopped) return;
      this.desktopHistory.clear();
      for (const r of this.records) if (this.runs.has(r.id)) this.update({ type: 'error', sessionKey: r.id,
        code: 'frame_too_large', message: 'A large Codex response could not be loaded. Your task was not stopped; refresh its history.' });
    });
    rpc.on('closed', () => {
      if (this.rpc !== rpc || this.stopped) return;
      this.disconnected = true; this.loaded.clear(); this.effectiveSettings.clear(); this.desktopHistory.clear();
      this.nextRecoveryAt = Date.now() + 1000;
      for (const waiter of this.settingsWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Codex settings could not be confirmed; reconnect before sending.')); }
      this.settingsWaiters.clear();
      for (const record of this.records) if (this.runs.has(record.id)) this.update({ type: 'error', sessionKey: record.id,
        runId: this.runs.get(record.id)!.id, code: 'gateway_offline', message: 'Codex disconnected. The task outcome is unknown; reconnecting without resending your message.' });
    });
    return rpc;
  }
  private async recover(): Promise<void> {
    if (!this.disconnected) return;
    if (this.recovery) return this.recovery;
    if (Date.now() < this.nextRecoveryAt) throw new Error('Codex is reconnecting; try again shortly.');
    this.recovery = (async () => {
      await this.rpc.stop();
      if (this.stopped) throw new Error('Codex Bridge stopped');
      this.rpc = this.createRpc();
      await this.rpc.request('account/read', { refreshToken: false });
      if (this.stopped) throw new Error('Codex Bridge stopped');
      this.disconnected = false; this.recoveryFailures = 0;
      this.profile.clear(); this.profile = this.createProfile();
      // Read-only reconciliation: never resume/replay a task merely because our child restarted.
      for (const r of this.records) {
        const run = this.runs.get(r.id); if (!run || run.desktop || !run.turnId || !r.threadId) continue;
        try {
          const result = await this.rpc.request('thread/turns/list', { threadId: r.threadId, limit: 3, itemsView: 'summary', sortDirection: 'desc' });
          const turn = result.data?.find((t: any) => t.id === run.turnId);
          if (turn && ['completed', 'interrupted', 'failed'].includes(turn.status)) {
            run.final = (turn.items ?? []).filter((i: any) => i.type === 'agentMessage').map((i: any) => i.text ?? '').join('\n\n');
            this.finish(r, turn.status === 'interrupted' ? 'cancelled' : turn.status === 'failed' ? 'error' : 'end_turn', turn);
          }
        } catch { /* Retain unknown task state until native evidence is available. */ }
      }
    })().catch(error => {
      this.disconnected = true;
      this.nextRecoveryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(++this.recoveryFailures, 5));
      throw error;
    }).finally(() => { this.recovery = undefined; });
    return this.recovery;
  }
  private rememberSettings(r: Entry, settings: NativeSettings): void {
    if (settings.cwd !== (r.cwd ?? this.project)) return;
    this.effectiveSettings.set(r.id, settings);
    r.model = settings.model; r.provider = settings.modelProvider; r.effort = settings.effort ?? undefined; r.serviceTier = settings.serviceTier;
    this.save();
    const waiter = this.settingsWaiters.get(r.id);
    if (waiter && matchesNativeSettings(settings, waiter.patch)) { clearTimeout(waiter.timer); this.settingsWaiters.delete(r.id); waiter.resolve(settings); }
  }
  private async confirmedSettings(r: Entry, patch: Record<string, unknown>, dispatch: () => Promise<unknown>): Promise<void> {
    if (this.settingsWaiters.has(r.id)) throw new Error('A settings change is already pending');
    const previous = this.effectiveSettings.get(r.id);
    const invalidateUnconfirmed = () => {
      // A native notification received during this operation is authoritative,
      // even when it differs from the requested value or the RPC ACK is lost.
      // Keep that readback available without claiming the write succeeded.
      if (this.effectiveSettings.get(r.id) === previous) this.effectiveSettings.delete(r.id);
    };
    let rejectWait: (error: Error) => void = () => {};
    const confirmation = new Promise<NativeSettings>((resolve, reject) => {
      rejectWait = reject;
      const timer = setTimeout(() => { this.settingsWaiters.delete(r.id); invalidateUnconfirmed();
        reject(new Error('Codex has not confirmed these settings. Refresh before sending a message.')); }, 10000);
      this.settingsWaiters.set(r.id, { patch, resolve, reject, timer });
    });
    void confirmation.catch(() => {});
    try {
      await dispatch();
      const effective = await confirmation;
      if (!matchesNativeSettings(effective, patch)) {
        throw new Error('Codex applied different settings. Your computer or organization may restrict this option; refresh to see the effective settings.');
      }
    } catch (error) {
      const waiter = this.settingsWaiters.get(r.id);
      if (waiter) { clearTimeout(waiter.timer); this.settingsWaiters.delete(r.id); rejectWait(error as Error); }
      if ((error as { outcome?: string })?.outcome === 'uncertain') invalidateUnconfirmed();
      throw error;
    }
  }
  private acceptDesktop(method: string, p: any): boolean {
    const r = this.records.find(row => row.threadId === p.conversationId);
    return !!r && this.loaded.has(r.id) && this.runs.get(r.id)?.desktop !== true && (!p.hostId || p.hostId === 'local') && [
      'thread-owner-discovery', 'thread-follower-load-complete-history', 'thread-follower-update-thread-settings', 'thread-follower-start-turn', 'thread-follower-steer-turn', 'thread-follower-interrupt-turn',
      'thread-follower-command-approval-decision', 'thread-follower-file-approval-decision', 'thread-follower-permissions-request-approval-response', 'thread-follower-submit-user-input',
    ].includes(method);
  }
  private desktopRequest(method: string, p: any): Promise<any> {
    return this.updateAdmission.request(() => this.desktopRequestNow(method, p));
  }
  private async desktopRequestNow(method: string, p: any): Promise<any> {
    const r = this.records.find(row => row.threadId === p.conversationId)!;
    const call = (method: string, params: object) => this.request({ type: 'req', id: randomUUID(), method, params: { sessionKey: r.id, ...params } });
    if (method === 'thread-owner-discovery') return { supportsUntrustedAppInput: false };
    if (method === 'thread-follower-load-complete-history') { this.desktopFollowers.add(r.threadId!); return { revision: await this.publishDesktop(r.threadId!, true) }; }
    if (method === 'thread-follower-update-thread-settings') {
      const settings = p.threadSettings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)
        || Object.keys(settings).some(k => !['model', 'effort', 'collaborationMode', 'serviceTier', 'approvalPolicy', 'approvalsReviewer', 'sandboxPolicy', 'permissions'].includes(k))) throw new Error('Unsupported settings');
      if (Object.hasOwn(settings, 'serviceTier') && !hasServiceTier(settings)) throw new Error('Invalid speed setting');
      if (Object.hasOwn(settings, 'permissions') && (typeof settings.permissions !== 'string' || !settings.permissions.trim()
        || settings.permissions.length > 200 || Object.hasOwn(settings, 'sandboxPolicy'))) throw new Error('Unsupported permissions');
      if (p.activeTurnId != null) throw new Error('Active task settings must be changed on the owning computer');
      const condition = p.condition;
      if (condition != null && (typeof condition !== 'object' || Array.isArray(condition)
        || Object.keys(condition).some(k => !['ifEffortEquals', 'ifModelEquals'].includes(k))
        || !Object.hasOwn(condition, 'ifEffortEquals')
        || (condition.ifEffortEquals !== null && typeof condition.ifEffortEquals !== 'string')
        || (condition.ifModelEquals != null && typeof condition.ifModelEquals !== 'string'))) throw new Error('Unsupported settings condition');
      return this.serial(r, async () => {
        if (this.runs.has(r.id)) throw new Error('Task still running');
        if (condition != null) {
          const effective = this.effectiveSettings.get(r.id);
          if (!effective || effective.effort !== condition.ifEffortEquals
            || (condition.ifModelEquals != null && effective.model !== condition.ifModelEquals)) return { ok: true, applied: false };
        }
        await this.nativeSettings(r, settings); return { ok: true, applied: true };
      });
    }
    if (method === 'thread-follower-start-turn') {
      const request = p.turnStart?.request;
      if (!request || request.threadId !== r.threadId || !Array.isArray(request.input) || request.input.some((i: any) => i.type !== 'text') || (request.cwd && request.cwd !== (r.cwd ?? this.project))) throw new Error('Unsupported desktop turn');
      const overrides = Object.fromEntries(['model', 'effort', 'serviceTier', 'collaborationMode', 'approvalPolicy', 'approvalsReviewer', 'sandboxPolicy', 'permissions'].filter(k => Object.hasOwn(request, k)).map(k => [k, request[k]]));
      if (Object.hasOwn(overrides, 'permissions') && (typeof overrides.permissions !== 'string' || !overrides.permissions.trim()
        || overrides.permissions.length > 200 || Object.hasOwn(overrides, 'sandboxPolicy'))) throw new Error('Unsupported permissions');
      const text = request.input.map((i: any) => i.text ?? '').join('\n');
      const result = await this.prompt(r, { text, idempotencyKey: request.clientUserMessageId || randomUUID() }, overrides);
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
    this.publishTimers.set(id, setTimeout(() => { this.publishTimers.delete(id); void this.publishDesktop(id).catch(() => {}); }, 500));
  }
  private publishing = new Map<string, Promise<number>>();
  private publishDesktop(threadId: string, complete = false): Promise<number> {
    const existing = this.publishing.get(threadId); if (existing) return complete ? existing.then(() => this.publishDesktop(threadId, true)) : existing;
    const work = (async () => {
      const r = this.records.find(row => row.threadId === threadId);
      if (!r || !this.loaded.has(r.id) || this.runs.get(r.id)?.desktop) throw new Error('Conversation is not owned here');
      const settings = this.effectiveSettings.get(r.id);
      if (!settings) throw new Error('Native effective settings unavailable; refresh the conversation');
      let history = this.desktopHistory.get(threadId);
      if (!history || (complete && !history.complete)) {
        history = await loadDesktopHistory(this.rpc, threadId, r.cwd ?? this.project, complete);
        this.desktopHistory.set(threadId, history);
      }
      const thread = { ...history.thread, turns: [...history.thread.turns] };
      const active = this.runs.get(r.id);
      if (active?.turnId) {
        const index = thread.turns.findIndex((turn: any) => turn.id === active.turnId);
        const old = index < 0 ? undefined : thread.turns[index];
        const items = new Map((old?.items ?? []).map((item: any) => [item.id, item]));
        let liveBytes = 0;
        for (const [id, item] of [...active.items].slice(-128)) {
          const size = Buffer.byteLength(JSON.stringify(item));
          if (size <= 256000 && liveBytes + size <= 1024 * 1024) { items.set(id, item); liveBytes += size; }
        }
        const turn = { ...old, id: active.turnId, status: 'inProgress', startedAt: active.started / 1000, itemsView: 'summary', items: [...items.values()] };
        if (index < 0) thread.turns.push(turn); else thread.turns[index] = turn;
      }
      const pendingIds = new Set([...this.approvals.values()].filter(c => c.entry === r).map(c => `${r.id}:${typeof c.wireId}:${c.wireId}`));
      for (const [id, group] of this.questions) if (group.entry === r) pendingIds.add(id);
      const requests = [...pendingIds].flatMap(id => this.rawRequests.has(id) ? [this.rawRequests.get(id)] : []);
      for (const id of this.rawRequests.keys()) if (id.startsWith(r.id + ':') && !pendingIds.has(id)) this.rawRequests.delete(id);
      const state = desktopState(thread, requests, settings, history.cursor);
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
  private metadataBaseline(): MetadataBaseline {
    return new Map(this.records.filter(r => r.threadId).map(r => [r, {
      threadId: r.threadId!, revision: this.metadataState.get(r)?.revision ?? 0,
      pending: this.metadataState.get(r)?.pending ?? false,
    }]));
  }
  private async changeMetadata<T>(r: Entry, operation: () => Promise<T>): Promise<T> {
    this.metadataState.set(r, { revision: (this.metadataState.get(r)?.revision ?? 0) + 1, pending: true });
    try { return await operation(); }
    finally { this.metadataState.set(r, { revision: (this.metadataState.get(r)?.revision ?? 0) + 1, pending: false }); }
  }
  private reconcileMetadata(found: Map<string, any>, archived: boolean, baseline: MetadataBaseline): void {
    const changed: Array<{ record: Entry; title: string; archived: boolean | undefined }> = [];
    for (const [r, before] of baseline) {
      const state = this.metadataState.get(r);
      if (before.pending || state?.pending || before.revision !== (state?.revision ?? 0)
        || r.threadId !== before.threadId || !this.records.includes(r)) {
        // A delayed pre-mutation page cannot reintroduce a deleted/reset native
        // row or compete with the newer locally confirmed management result.
        found.delete(`native:${before.threadId}`); continue;
      }
      const native = found.get(`native:${before.threadId}`);
      // Positive membership in an explicitly filtered native catalog establishes
      // archive state. Absence, a partial page or another project proves nothing.
      if (!native || native.id !== before.threadId || native.cwd !== (r.cwd ?? this.project)) continue;
      const title = typeof native.name === 'string' && native.name.trim() ? native.name.trim().slice(0, 200) : r.title;
      this.metadataState.set(r, { revision: before.revision + 1, pending: false });
      if (r.title === title && (r.archived === true) === archived) continue;
      changed.push({ record: r, title: r.title, archived: r.archived });
      r.title = title; r.archived = archived;
    }
    if (!changed.length) return;
    try { this.save(); }
    catch (error) {
      for (const previous of changed) { previous.record.title = previous.title; previous.record.archived = previous.archived; }
      throw error;
    }
    for (const { record } of changed) {
      if (record.threadId) this.desktopHistory.delete(record.threadId);
      this.update({ type: 'session_info_update', session: this.descriptor(record) });
    }
  }
  private verifyMissingArchives(): Promise<void> {
    if (this.archiveVerification) return this.archiveVerification;
    const baseline = new Map([...this.metadataBaseline()].filter(([r, before]) => !before.pending
      && !r.archived && !!r.activity && !this.runs.has(r.id) && this.missingActiveRecords.has(r) && !this.native.has(`native:${before.threadId}`)));
    if (!baseline.size) { this.missingArchiveProbe = undefined; return Promise.resolve(); }
    const signature = createHash('sha256').update(JSON.stringify([...baseline].map(([r, b]) => [b.threadId, r.cwd ?? this.project, b.revision]).sort())).digest('hex');
    if (this.missingArchiveProbe?.signature === signature && this.missingArchiveProbe.expiresAt > Date.now()) return Promise.resolve();
    const initialCursor = this.missingArchiveProbe?.signature === signature ? this.missingArchiveProbe.nextCursor : undefined;
    const work = (async () => {
      const cwds = [...new Set([...baseline.keys()].map(r => r.cwd ?? this.project))];
      const wanted = new Set([...baseline.values()].map(b => b.threadId));
      const found = new Map<string, any>(), cursors = new Set<string>(initialCursor ? [initialCursor] : []); let cursor = initialCursor;
      try {
        // One shared two-page budget across all missing projects, not per cwd.
        // ThreadList has no ID filter; only positive archived membership counts.
        for (let page = 0; page < 2; page += 1) {
          const result = await this.rpc.request('thread/list', { archived: true, cwd: cwds.length === 1 ? cwds[0] : cwds,
            limit: 100, modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'], sortKey: 'updated_at', useStateDbOnly: true,
            ...(cursor ? { cursor } : {}) });
          if (!Array.isArray(result.data)) throw new Error('Invalid archived conversation catalog');
          for (const thread of result.data) if (wanted.has(thread.id) && cwds.includes(thread.cwd)) found.set(`native:${thread.id}`, thread);
          cursor = result.nextCursor ?? undefined;
          if (!cursor || found.size === wanted.size) break;
          if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Invalid archive cursor');
          cursors.add(cursor);
        }
      } catch {
        // An unavailable/incomplete check keeps the existing metadata unknown;
        // it must neither hide a conversation nor make the active catalog fail.
        this.missingArchiveProbe = { signature, expiresAt: Date.now() + 30_000, nextCursor: initialCursor }; return;
      }
      this.reconcileMetadata(found, true, baseline);
      this.missingArchiveProbe = { signature, expiresAt: Date.now() + 30_000, nextCursor: cursor };
    })();
    this.archiveVerification = work;
    void work.finally(() => { if (this.archiveVerification === work) this.archiveVerification = undefined; }).catch(() => {});
    return work;
  }
  private discovery?: Promise<{ complete: boolean; entries: Map<string, any> }>;
  private discover(): Promise<{ complete: boolean; entries: Map<string, any> }> {
    if (this.discovery) return this.discovery;
    this.discovery = (async () => {
      const baseline = this.metadataBaseline();
      const found = new Map<string, any>();
      let complete = true;
      const cursors = new Set<string>(); let cursor: string | undefined;
      if (this.options.device) for (const project of savedCodexProjects(this.options.env)) this.projects.set(project.id, project);
      do {
        const result = await this.rpc.request('thread/list', { ...(this.options.device ? {} : { cwd: this.project }), archived: false, limit: 100, modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'], sortKey: 'updated_at', useStateDbOnly: true, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result.data)) throw new Error('Invalid Codex conversation catalog');
        for (const t of result.data) {
          if (!t || typeof t.cwd !== 'string' || typeof t.id !== 'string' || !ID.test(t.id)) { complete = false; continue; }
          if (this.options.device || t.cwd === this.project) {
            if (found.has(`native:${t.id}`)) complete = false;
            this.rememberProject(t.cwd); found.set(`native:${t.id}`, t);
          }
        }
        if (found.size > 10000) throw new Error('Codex catalog exceeds 10,000 conversations; use a project-scoped connection');
        cursor = result.nextCursor || undefined;
        if (cursor) { if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Invalid Codex catalog cursor'); cursors.add(cursor); }
      } while (cursor);
      if (complete) {
        this.reconcileMetadata(found, false, baseline);
        // Missing membership is useful only from an uninvalidated complete read.
        // It triggers a bounded positive check, never an archive inference.
        this.missingActiveRecords = new Set([...baseline].filter(([r, before]) => !before.pending
          && !this.metadataState.get(r)?.pending && before.revision === (this.metadataState.get(r)?.revision ?? 0)
          && r.threadId === before.threadId && this.records.includes(r) && !found.has(`native:${before.threadId}`)).map(([r]) => r));
        this.native = found;
      } else {
        this.missingActiveRecords.clear();
        for (const [r, before] of baseline) {
          const state = this.metadataState.get(r);
          if (before.pending || state?.pending || before.revision !== (state?.revision ?? 0)
            || r.threadId !== before.threadId || !this.records.includes(r)) found.delete(`native:${before.threadId}`);
          // An explicit reset/delete remains authoritative even if a later scan
          // is incomplete; retained lookups must not undo that known mutation.
          if (r.threadId !== before.threadId || !this.records.includes(r)) this.native.delete(`native:${before.threadId}`);
        }
        for (const [key, entry] of found) {
          if (this.native.has(key) || this.native.size < 10_000) this.native.set(key, entry);
          else found.delete(key);
        }
      }
      return { complete, entries: found };
    })().finally(() => { this.discovery = undefined; });
    return this.discovery;
  }
  private async refreshNativePreviews(): Promise<void> {
    // Roster freshness needs the newest conversations, not a full-history scan of a large device catalog.
    const recent = [...this.native.entries()].sort((a, b) => (b[1].recencyAt ?? b[1].updatedAt ?? 0) - (a[1].recencyAt ?? a[1].updatedAt ?? 0)).slice(0, 12);
    for (let index = 0; index < recent.length; index += 3) await Promise.all(recent.slice(index, index + 3).map(async ([key, thread]) => {
      const version = `${thread.updatedAt ?? ''}:${thread.recencyAt ?? ''}`;
      const cached = this.nativePreviews.get(key);
      if (cached?.version === version && (!cached.failed || Date.now() - cached.checkedAt < 30_000)) return;
      try {
        // A preview needs only visible messages. Full turns can contain tens of MiB
        // of tool output and trip the stdio frame limit, taking health down with it.
        const page = await this.rpc.request('thread/turns/list', { threadId: thread.id, limit: 3, itemsView: 'summary', sortDirection: 'desc' });
        const turns = Array.isArray(page.data) ? [...page.data].reverse().map((turn: any) => ({ ...turn,
          items: Array.isArray(turn.items) ? turn.items.filter((item: any) => item.type !== 'plan') : [] })) : [];
        const messages = turns.flatMap((turn: any) => codexMessages([turn])
          .filter(message => message.role === 'user' || message.role === 'assistant')
          .map(message => message.role === 'assistant' && typeof turn.completedAt === 'number'
            ? { ...message, timestampMs: turn.completedAt * 1000 } : message));
        // Native plans are protocol items, not an assistant chat reply.
        const visible = lastVisiblePreview(messages);
        this.nativePreviews.set(key, { version, preview: visible?.preview, lastActivityAt: visible?.lastActivityAt ?? null, checkedAt: Date.now() });
      } catch {
        // Retry transient native errors after a short pause, without polling a broken thread on every roster refresh.
        this.nativePreviews.set(key, { version, preview: undefined, lastActivityAt: null, checkedAt: Date.now(), failed: true });
      }
    }));
    for (const key of this.nativePreviews.keys()) if (!this.native.has(key)) this.nativePreviews.delete(key);
  }
  private async desktopTurn(r: Entry, params: object): Promise<any> {
    this.desktop!.follow(r.threadId!);
    const run = this.runs.get(r.id)!; run.desktop = true;
    try {
      const result = await this.desktop!.request('thread-follower-start-turn', { conversationId: r.threadId, turnStart: { request: params, context: { inheritThreadSettings: true } } });
      if (!result?.result?.turn?.id) throw new DesktopIpcError('uncertain', 'Desktop did not confirm a native turn identity');
      return result.result;
    } catch (error) {
      await this.assertReleasedNative(r, error, true);
      run.desktop = false;
      await this.thread(r, true);
      if (!this.effectiveSettings.has(r.id)) throw new DesktopIpcError('rejected', 'This Codex version cannot confirm safe conversation settings. Update Codex before continuing.');
      return this.rpc.request('turn/start', params);
    }
  }
  private async assertReleasedNative(r: Entry, error: unknown, allowAtomicResume = false): Promise<void> {
    const snapshot = this.desktop!.snapshots.get(r.threadId!);
    // CLI-only hosts have no Desktop broker. For our own IDs only, audited
    // native versions atomically acquire a cross-process writer lock in
    // thread/resume itself. A broker connect failure is not no-owner evidence;
    // it permits attempting that native acquisition, never guessing ownership.
    const atomicResume = allowAtomicResume && !r.native && error instanceof DesktopIpcError && error.reason === 'broker-unavailable';
    if (!(error instanceof DesktopIpcError) || (error.outcome !== 'no-owner' && !atomicResume) || (snapshot?.fresh ? desktopTurns(snapshot.state) : []).some((t: any) => ['inProgress', 'running', 'active'].includes(t.status))) throw error;
    const metadata = await this.rpc.request('thread/read', { threadId: r.threadId, includeTurns: false });
    if (metadata.thread?.cwd !== (r.cwd ?? this.project)) throw new Error('Conversation belongs to another project');
    if (atomicResume && !['0.153.3', '0.158.0-alpha.2.1'].includes(this.rpc.nativeVersion ?? '')) throw error;
    const latest = await this.rpc.request('thread/turns/list', { threadId: r.threadId, limit: 1, itemsView: 'summary', sortDirection: 'desc' });
    if (!Array.isArray(latest.data) || latest.data.some((t: any) => !['completed', 'interrupted', 'failed'].includes(t?.status))) throw new DesktopIpcError('uncertain', 'A native task may still be running. Continue it on your computer.');
  }
  private async assertArchivable(r: Entry): Promise<void> {
    if (this.runs.has(r.id)) throw new Error('Wait for this task to finish before archiving');
    if (!r.threadId) throw new Error('Conversation has no native identity');
    if (!this.loaded.has(r.id)) {
      try {
        await this.desktop!.request('thread-owner-discovery', { conversationId: r.threadId });
        const snapshot = this.desktop!.snapshots.get(r.threadId);
        if (!snapshot?.fresh || desktopTurns(snapshot.state).some((t: any) => !['completed', 'interrupted', 'failed'].includes(t.status))) {
          throw new DesktopIpcError('rejected', 'Check this conversation on your computer before archiving; its owner may have active work.');
        }
      } catch (error) { await this.assertReleasedNative(r, error); }
    }
    const metadata = await this.rpc.request('thread/read', { threadId: r.threadId, includeTurns: false });
    if (metadata.thread?.cwd !== (r.cwd ?? this.project) || metadata.thread?.status?.type === 'active') throw new Error('Conversation is unavailable or has active work');
  }
  private async nativeSettings(r: Entry, settings: Record<string, unknown>): Promise<void> {
    const effective = this.effectiveSettings.get(r.id);
    // Cached explicit instructions cannot prove a null request has selected the
    // native preset. Accept preset normalization only after native dispatch.
    if (effective && matchesNativeSettings(effective, settings, false)) return;
    if (!this.loaded.has(r.id)) {
      try {
        this.desktop!.follow(r.threadId!);
        await this.confirmedSettings(r, settings, async () => {
          const result = await this.desktop!.request('thread-follower-update-thread-settings', { conversationId: r.threadId, threadSettings: settings });
          if (result?.applied === false) throw new DesktopIpcError('rejected', 'The native owner did not apply the settings. Refresh and try again.');
        });
        return;
      } catch (error) {
        await this.assertReleasedNative(r, error, true);
        await this.thread(r, true, typeof settings.permissions === 'string' ? settings : undefined);
      }
    }
    const current = this.effectiveSettings.get(r.id);
    if (current && matchesNativeSettings(current, settings, false)) return;
    await this.confirmedSettings(r, settings, () => this.rpc.request('thread/settings/update', { threadId: r.threadId, ...settings }));
    this.scheduleDesktop(r);
  }
  private projectDesktopItems(r: Entry, run: Run, items: any[]): void {
    const messages: string[] = [];
    const publishText = () => {
      const text = messages.join('\n\n').slice(-128000);
      if (text !== run.text) { run.text = text; this.update({ type: 'agent_message_chunk', sessionKey: r.id, runId: run.id, text, textMode: 'snapshot' }); }
    };
    for (const item of items) {
      if (typeof item.id !== 'string') continue;
      const old = run.items.get(item.id); run.items.set(item.id, item); this.items.set(item.id, item);
      if (['agentMessage', 'assistantMessage'].includes(item.type)) {
        messages.push(String(item.text ?? item.message ?? ''));
        continue;
      }
      const tool = codexTool(item); if (!tool) continue;
      if (!old) {
        // Mobile commits the current text at a new tool boundary. Replaying
        // a caught-up snapshot must publish only the preceding words first.
        publishText();
        this.update({ type: 'tool_call', sessionKey: r.id, runId: run.id, toolCallId: item.id, title: tool.name, rawInput: tool.input });
      }
      if (tool.status !== 'running' && tool.status !== 'unknown' && old?.status !== item.status) this.update({ type: 'tool_call_update', sessionKey: r.id, runId: run.id, toolCallId: item.id, status: tool.status, rawOutput: tool.output });
    }
    publishText();
  }
  private desktopSnapshot(threadId: string, snapshot: DesktopSnapshot): void {
    const r = this.records.find(e => e.threadId === threadId);
    // Once our App Server owns this thread, its notifications are the only
    // effective-state authority. Delayed Desktop echoes cannot replace it.
    if (this.stopped || !r || !snapshot.fresh || this.loaded.has(r.id)) return;
    const settings = nativeSettings(snapshot.state.latestThreadSettings);
    if (settings) this.rememberSettings(r, settings);
    r.model = snapshot.state.latestModel ?? r.model; r.effort = snapshot.state.latestReasoningEffort ?? r.effort; r.provider = snapshot.state.modelProvider ?? r.provider;
    if (hasServiceTier(snapshot.state.latestThreadSettings)) r.serviceTier = snapshot.state.latestThreadSettings.serviceTier;
    const turns = desktopTurns(snapshot.state);
    const active = turns.filter((t: any) => ['inProgress', 'running', 'active'].includes(t.status));
    // Parallel active turns require an explicit native target; never guess one.
    if (active.length > 1) { this.update({ type: 'error', sessionKey: r.id, code: 'unsupported', message: 'This conversation has parallel active tasks. Choose the task in Codex Desktop.' }); return; }
    const turn = active[0];
    const terminalFor = (turnId: string) => turns.find((t: any) => (t.turnId ?? t.id) === turnId && ['completed', 'interrupted', 'failed'].includes(t.status));
    const finishDesktopTurn = (run: Run, terminal: any) => {
      if (Array.isArray(terminal.items) && terminal.items.length) this.projectDesktopItems(r, run, terminal.items);
      run.final = run.text;
      this.finish(r, terminal.status === 'interrupted' ? 'cancelled' : terminal.status === 'failed' ? 'error' : 'end_turn', terminal);
    };
    let run = this.runs.get(r.id);
    if (run && !run.desktop) return; // An idle desktop echo cannot take a local writer.
    if (turn) {
      const turnId = turn.turnId ?? turn.id;
      if (typeof turnId !== 'string' || !turnId) return;
      if (run?.turnId && run.turnId !== turnId) {
        const terminal = terminalFor(run.turnId);
        if (!terminal) {
          this.update({ type: 'error', sessionKey: r.id, code: 'unsupported', message: 'The previous task outcome is unconfirmed. Check this conversation in Codex Desktop.' });
          return;
        }
        finishDesktopTurn(run, terminal);
        run = undefined;
      }
      if (!run) { run = { id: `desktop:${turnId}`, desktop: true, turnId, text: '', started: Date.now(), items: new Map() }; this.runs.set(r.id, run); this.update({ type: 'run_started', sessionKey: r.id, runId: run.id }); }
      run.turnId = turnId;
      this.projectDesktopItems(r, run, Array.isArray(turn.items) ? turn.items : []);
    } else if (run?.turnId) {
      const terminal = terminalFor(run.turnId);
      if (terminal) finishDesktopTurn(run, terminal);
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
    const native = this.native.get(String(key)) ?? this.archivedNative.get(String(key));
    if (!record && native && this.options.device) {
      record = { id: String(key), archived: this.archivedNative.has(String(key)), threadId: native.id, native: true, cwd: native.cwd, title: native.name || native.preview?.slice(0, 80) || '', created: native.createdAt * 1000 || Date.now(), activity: native.updatedAt * 1000 || Date.now(), model: modelName(native.model), provider: native.modelProvider, keys: {} };
      if (this.records.length >= 1000) throw new Error('Conversation index limit reached');
      this.records.push(record); this.save(); this.desktop?.follow(native.id);
    }
    if (!record) throw new Error('This session is read-only. Create a branch to continue.');
    return record;
  }
  private serial<T>(record: Entry, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(record.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.disconnected && !this.stopped) await this.recover();
      if (this.stopped || this.disconnected) throw new Error('Codex Bridge is unavailable. Restart it on your computer.');
      this.record(record.id); return fn();
    });
    this.queues.set(record.id, next);
    void next.finally(() => { if (this.queues.get(record.id) === next) this.queues.delete(record.id); }).catch(() => {});
    return next;
  }
  private readonly artifacts = new DeliveredArtifacts();
  private readonly attention = new InteractionAttention();
  private update(update: SessionUpdate): void {
    if (update.type === 'run_finished') { const key = update.sessionKey; update = this.artifacts.final(update, [this.records.find(row => row.id === key)?.cwd ?? this.native.get(key)?.cwd ?? this.project]); }
    const patch = this.attention.accept(update);
    this.emit('update', update);
    if (patch) this.emit('update', patch);
  }
  private descriptor(r: Entry): SessionDescriptor {
    return { connectionId: '', agentId: 'codex', key: r.id, kind: 'direct', title: r.title || basename(r.cwd ?? this.project), updatedAt: r.activity ?? r.created, lastActivityAt: r.activity ?? null, preview: r.preview, model: modelName(r.model), modelProvider: r.provider, sessionId: r.threadId, hasActiveRun: this.runs.has(r.id), attention: this.attention.get(r.id), project: this.options.device ? this.projectDetails(r.cwd ?? this.project) : undefined, canContinue: r.native ? !!this.options.device : undefined, source: r.native ? 'native' : 'bridge', archived: r.archived === true, allowedActions: { rename: true, reset: !r.native, delete: !r.native, pin: true, archive: !!r.threadId } };
  }
  private async thread(r: Entry, released = false, permissionSelection?: Record<string, unknown>): Promise<void> {
    if (r.permissionsUnconfirmed && !permissionSelection) throw new Error('Codex did not restore the conversation permissions. Select and confirm permissions before sending.');
    if (this.loaded.has(r.id)) return;
    const resume = !!r.threadId && !!r.activity;
    const requestedEffort = resume ? undefined : r.effort;
    const requestedSpeed = resume ? undefined : r.speedPreference;
    // Every persisted ID can acquire another owner after a Bridge restart, including our own creations.
    if (resume && !released) {
      try { await this.desktop!.request('thread-owner-discovery', { conversationId: r.threadId });
        throw new DesktopIpcError('rejected', 'This conversation is owned by Codex Desktop. Refresh it before changing settings.');
      } catch (error) { await this.assertReleasedNative(r, error, true); }
    }
    if (this.runs.get(r.id)?.desktop) throw new Error('This task is controlled by Codex Desktop');
    let speed: Record<string, unknown> = {};
    let restoredPermissions: { resume: Record<string, unknown>; expected: Record<string, unknown> } | undefined;
    if (resume) {
      const metadata = await this.rpc.request('thread/read', { threadId: r.threadId, includeTurns: false });
      if (metadata.thread?.id !== r.threadId || metadata.thread?.cwd !== (r.cwd ?? this.project)) throw new Error('Conversation belongs to another project');
      const persisted = await nativeResumeSpeed(metadata.thread, this.options.env);
      if (persisted.kind === 'unknown') throw new Error('The previous speed setting cannot be verified safely. Open this conversation on your computer before continuing.');
      if (persisted.kind === 'native') {
        speed = { serviceTier: persisted.serviceTier };
        if (!permissionSelection && (!persisted.permissions || (persisted.permissions.anonymous
          && !['0.153.3', '0.158.0-alpha.2.1'].includes(this.rpc.nativeVersion ?? '')))) {
          r.permissionsUnconfirmed = true; this.save();
          throw new Error('The previous conversation permissions cannot be verified safely. Select and confirm permissions before sending.');
        }
        restoredPermissions = persisted.permissions;
      }
      else if (!r.native && r.speedPreference && r.speedPreference.provider === metadata.thread.modelProvider) {
        speed = { serviceTier: r.speedPreference.serviceTier };
      }
    }
    if (permissionSelection) restoredPermissions = { resume: permissionSelection, expected: permissionSelection };
    // Audited cold resume drops service tier and anonymous permission profiles.
    // Restore fresh native evidence, never an old Bridge permission preference.
    const expectedPermissions = restoredPermissions?.expected ?? (!resume ? PERMISSIONS : undefined);
    const requiredConfirmation = r.permissionsUnconfirmed === true;
    if (expectedPermissions) { r.permissionsUnconfirmed = true; this.save(); }
    const result = await this.rpc.request(resume ? 'thread/resume' : 'thread/start', {
      cwd: r.cwd ?? this.project, ...(resume ? { threadId: r.threadId, excludeTurns: true } : { ...PERMISSIONS, ...(r.model ? { model: r.model } : {}) }),
      ...speed,
      ...restoredPermissions?.resume,
    });
    if (!ID.test(result.thread?.id) || result.thread.cwd !== (r.cwd ?? this.project)) throw new Error('Codex returned a different project');
    r.threadId = result.thread.id; r.model = result.model ?? result.thread.model; r.provider = result.modelProvider ?? result.thread.modelProvider;
    r.effort = result.reasoningEffort ?? undefined;
    if (hasServiceTier(result)) r.serviceTier = result.serviceTier;
    this.loaded.add(r.id); this.save();
    // 0.153.3 cold resume initializes normal collaboration mode in native core. Newer native
    // responses expose it explicitly; unknown shapes cannot publish an invented Desktop state.
    const effective = nativeSettings(result, true, !resume || this.rpc.nativeVersion === '0.153.3');
    if (effective) this.rememberSettings(r, effective);
    if (expectedPermissions && (!effective || !matchesNativeSettings(effective, expectedPermissions))) {
      r.permissionsUnconfirmed = true; this.save();
      throw new Error('Codex did not restore the conversation permissions. Select and confirm permissions before sending.');
    }
    if (expectedPermissions && !requiredConfirmation) { delete r.permissionsUnconfirmed; this.save(); }
    if (effective && requestedEffort && requestedEffort !== effective.effort) await this.nativeSettings(r, { effort: requestedEffort });
    if (effective && requestedSpeed?.provider === effective.modelProvider && requestedSpeed.serviceTier !== effective.serviceTier) {
      await this.nativeSettings(r, { serviceTier: requestedSpeed.serviceTier });
    }
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
  private async listSessions(strict = false): Promise<SessionDescriptor[]> {
    const discovered = await this.discover();
    if (strict && !discovered.complete) throw new Error('Codex conversation catalog could not be refreshed completely');
    await this.verifyMissingArchives();
    await this.refreshNativePreviews();
    return [...this.records.filter(r => !r.archived).map(r => {
      const native = r.threadId ? this.nativePreviews.get(`native:${r.threadId}`) : undefined;
      return native && !this.runs.has(r.id) && (r.preview === undefined || (r.native && !Object.keys(r.keys).length) || (native.lastActivityAt ?? 0) > (r.activity ?? 0))
        ? { ...this.descriptor(r), preview: native.preview, lastActivityAt: native.lastActivityAt,
          updatedAt: Math.max(r.activity ?? r.created, native.lastActivityAt ?? 0) } : this.descriptor(r);
    }), ...[...discovered.entries].filter(([, t]) => !this.records.some(r => r.threadId === t.id)).map(([key, t]): SessionDescriptor => {
      const visible = this.nativePreviews.get(key);
      return { connectionId: '', agentId: 'codex', key, kind: 'direct', title: t.name || t.preview?.slice(0, 80) || basename(t.cwd), updatedAt: t.updatedAt * 1000, lastActivityAt: visible?.lastActivityAt ?? (t.recencyAt ?? t.updatedAt) * 1000, preview: visible?.preview, model: modelName(t.model), modelProvider: t.modelProvider, hasActiveRun: t.status?.type === 'active', project: this.options.device ? this.projectDetails(t.cwd) : undefined, canContinue: this.options.device === true, source: 'native', sessionId: t.id, allowedActions: { rename: this.options.device === true, reset: false, delete: false, pin: true, archive: this.options.device === true } };
    })];
  }
  async health(): Promise<object> {
    if (this.stopped) throw new Error('Codex process is unavailable. Restart the Bridge.');
    await this.recover();
    const catalog = this.catalog.length ? this.catalog : await this.refreshModels();
    const account = await this.rpc.request('account/read', { refreshToken: false });
    return { backend: 'codex', ...(this.options.bridgeVersion ? { bridgeVersion: this.options.bridgeVersion } : {}), sessionActivity: 1, profileVersion: 1, sessionCatalogSync: 1, sessionCatalogPageIndex: 1, artifacts: true, modelReady: account.requiresOpenaiAuth !== true || !!account.account, model: catalog.find(m => m.isDefault)?.model ?? '', vision: true, project: basename(this.project), projects: !!this.options.device, fastMode: true, sessionPermissions: true, sessionArchive: true, promptStatus: true, desktopConnected: this.desktop?.ready === true };
  }
  async request(frame: CodexRequest): Promise<unknown> {
    return this.updateAdmission.request(() => this.requestNow(frame));
  }
  private async requestNow(frame: CodexRequest): Promise<unknown> {
    const result = await this.dispatch(frame);
    if (['sessions.create', 'sessions.rename', 'sessions.reset', 'sessions.delete', 'sessions.archive'].includes(frame.method)) this.catalogSync.invalidate();
    return result;
  }
  private async dispatch(frame: CodexRequest): Promise<unknown> {
    if (frame.type !== 'req' || typeof frame.id !== 'string' || frame.id.length > 200 || !frame.id || typeof frame.method !== 'string' || (frame.params !== undefined && (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)))) throw new Error('Invalid Codex request');
    const p = frame.params ?? {};
    switch (frame.method) {
      case 'health': return this.health();
      case 'profile.projects': await this.recover(); return this.profile.projects();
      case 'profile.defaults': await this.recover(); return this.profile.defaults();
      case 'profile.defaults.set': await this.recover(); return this.profile.setDefaults(p);
      case 'profile.usage': await this.recover(); return this.profile.usage();
      case 'profile.skills': {
        if (p.forceReload !== undefined && typeof p.forceReload !== 'boolean') throw new Error('Invalid skill refresh');
        await this.recover(); return this.profile.skills(p.projectId, p.forceReload === true);
      }
      case 'profile.skills.set': await this.recover(); return this.profile.setSkillEnabled(p.id, p.enabled);
      case 'profile.instructions': await this.recover(); return this.profile.instructions(p.projectId);
      case 'profile.document': await this.recover(); return this.profile.document(p.id);
      case 'profile.document.set': await this.recover(); return this.profile.saveDocument(p);
      case 'profile.mcp': await this.recover(); return this.profile.mcp();
      case 'profile.plugins': await this.recover(); return this.profile.plugins(p.projectId);
      case 'agents.list': return [{ connectionId: '', agentId: 'codex', name: this.options.device ? 'Codex' : `Codex · ${basename(this.project)}`, isMain: true, mainSessionKey: '', entryMode: 'sessions' }];
      case 'projects.list': {
        if (!this.options.device) throw new Error('Project browsing is unavailable');
        await this.discover(); return [...this.projects.values()];
      }
      case 'sessions.activity': {
        const keys = sessionActivityKeys(p.keys);
        return this.sessionActivity!.query(keys.map(key => {
          const record = this.records.find(row => row.id === key && !row.archived);
          const native = this.native.get(key);
          const attention = record ? this.attention.get(record.id) : null;
          if (record && !record.threadId) return { key, local: { key, state: 'idle' as const } };
          if (record && this.loaded.has(record.id)) return { key, local: { key,
            state: this.disconnected ? 'unknown' as const : attention === 'input' || attention === 'approval' ? 'waiting' as const
              : this.runs.has(record.id) ? 'running' as const : 'idle' as const,
            attention: attention === 'input' || attention === 'approval' ? attention : null } };
          return { key, threadId: record?.threadId ?? native?.id };
        }));
      }
      case 'sessions.list': return this.listSessions();
      case 'sessions.sync': return this.catalogSync.reply(p);
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
        const r = this.create(p.title as string, cwd); r.threadId = result.thread.id; r.model = result.model; r.provider = result.modelProvider; r.effort = result.reasoningEffort; if (hasServiceTier(result)) r.serviceTier = result.serviceTier; r.activity = Date.now(); this.loaded.add(r.id); this.save(); const effective = nativeSettings(result, true, this.rpc.nativeVersion === '0.153.3'); if (effective) this.rememberSettings(r, effective); return this.descriptor(r);
      }
      case 'sessions.rename': return this.serial(this.record(p.sessionKey), async () => {
        const r = this.record(p.sessionKey); if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) throw new Error('Invalid title');
        const title = p.title.trim();
        return this.changeMetadata(r, async () => {
          if (r.threadId && (r.activity || this.loaded.has(r.id))) await this.rpc.request('thread/name/set', { threadId: r.threadId, name: title });
          r.title = title; this.save(); if (r.threadId) this.desktopHistory.delete(r.threadId); this.scheduleDesktop(r);
          this.update({ type: 'session_info_update', session: this.descriptor(r) }); return { ok: true };
        });
      });
      case 'sessions.archived': {
        const baseline = this.metadataBaseline();
        const found = new Map<string, any>(); let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const result = await this.rpc.request('thread/list', { ...(this.options.device ? {} : { cwd: this.project }), archived: true,
            limit: 100, modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'], sortKey: 'updated_at', useStateDbOnly: true, ...(cursor ? { cursor } : {}) });
          if (!Array.isArray(result.data)) throw new Error('Invalid archived conversation list');
          for (const thread of result.data) if (ID.test(thread.id) && typeof thread.cwd === 'string' && (this.options.device || thread.cwd === this.project)) found.set(`native:${thread.id}`, thread);
          if (found.size > 10000) throw new Error('Too many archived conversations; use a project-scoped connection');
          cursor = result.nextCursor ?? undefined;
          if (cursor) { if (typeof cursor !== 'string' || seen.has(cursor)) throw new Error('Invalid archive cursor'); seen.add(cursor); }
        } while (cursor);
        this.reconcileMetadata(found, true, baseline);
        this.archivedNative = found;
        return [...this.records.filter(r => r.archived).map(r => this.descriptor(r)),
          ...[...found.entries()].filter(([, t]) => !this.records.some(r => r.threadId === t.id)).map(([key, t]) => ({
            connectionId: '', agentId: 'codex', key, sessionId: t.id, kind: 'direct', source: 'native', archived: true,
            title: t.name || t.preview?.slice(0, 80) || basename(t.cwd), updatedAt: t.updatedAt * 1000,
            project: this.options.device ? this.projectDetails(t.cwd) : undefined, canContinue: false,
            allowedActions: { rename: this.options.device === true, reset: false, delete: false, pin: false, archive: this.options.device === true },
          }))];
      }
      case 'sessions.archive': return this.serial(this.record(p.sessionKey), async () => {
        const r = this.record(p.sessionKey);
        if (typeof p.archived !== 'boolean' || !r.threadId) throw new Error('Choose an existing conversation to archive or restore');
        const archived = p.archived;
        if (this.runs.has(r.id)) throw new Error('Wait for this task to finish before archiving');
        return this.changeMetadata(r, async () => {
          if (archived) await this.assertArchivable(r);
          await this.rpc.request(archived ? 'thread/archive' : 'thread/unarchive', { threadId: r.threadId });
          r.archived = archived; this.loaded.delete(r.id); this.effectiveSettings.delete(r.id);
          this.desktopHistory.delete(r.threadId!); this.save();
          this.desktop?.broadcast(archived ? 'thread-archived' : 'thread-unarchived', { hostId: 'local', conversationId: r.threadId });
          this.update({ type: 'session_info_update', session: this.descriptor(r) }); return { ok: true };
        });
      });
      case 'sessions.reset': case 'sessions.delete': return this.serial(this.record(p.sessionKey), async () => {
        const r = this.record(p.sessionKey); if (r.native) throw new Error('Native conversation metadata is read-only'); if (this.runs.has(r.id)) throw new Error('Stop the task and wait for it to finish first');
        return this.changeMetadata(r, async () => {
          if (r.threadId && (r.activity || this.loaded.has(r.id))) { await this.assertArchivable(r); await this.rpc.request('thread/archive', { threadId: r.threadId }); }
          if (frame.method === 'sessions.delete') { this.records = this.records.filter(row => row !== r); }
          else { r.threadId = undefined; r.model = undefined; r.provider = undefined; r.preview = undefined; r.activity = undefined; r.effort = undefined; r.serviceTier = undefined; r.speedPreference = undefined; }
          this.loaded.delete(r.id); this.effectiveSettings.delete(r.id); delete r.permissionsUnconfirmed; this.save(); return { ok: true };
        });
      });
      case 'clawket.artifacts.open': return this.artifacts.resolve(p.sessionKey, p.artifactId, cursor => this.history(String(p.sessionKey), cursor));
      case 'clawket.artifacts.read': return this.artifacts.read(p.sessionKey, p.id, p.offset);
      case 'chat.history': return this.history(p.sessionKey, p.cursor);
      case 'chat.promptStatus': {
        const r = this.records.find(record => record.id === p.sessionKey);
        if (!r && !this.native.has(String(p.sessionKey)) && !this.archivedNative.has(String(p.sessionKey))) throw new Error('Session unavailable; refresh the conversation list');
        const identity = readPromptIdentity(p.idempotencyKey);
        return recordedPromptStatus(r && Object.hasOwn(r.keys, identity) ? r.keys[identity] : undefined);
      }
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
      case 'models.select': case 'models.thinking': case 'models.fast': case 'models.permissions': return this.sessionModels(frame, p);
      case 'skills.list': {
        const entry = p.sessionKey === undefined ? undefined
          : this.records.find(r => r.id === p.sessionKey) ?? this.native.get(String(p.sessionKey));
        if (p.sessionKey !== undefined && !entry) throw new Error('Session unavailable; refresh the conversation list');
        const cwd = canonicalProject(entry?.cwd ?? this.project);
        const result = await this.rpc.request('skills/list', { cwds: [cwd] });
        return { workspaceDir: basename(cwd), managedSkillsDir: '', skills: (result.data ?? []).filter((d: any) => d.cwd === cwd).flatMap((d: any) => d.skills ?? []).filter((s: any) => s.enabled !== false).slice(0, 500).map((s: any) => ({ name: s.name, description: s.description ?? '', invocation: `$${s.name} `, source: 'codex', bundled: false, filePath: '', baseDir: '', skillKey: s.name, always: false, disabled: false, blockedByAllowlist: false, eligible: true, deletable: false, requirements: {}, missing: {}, configChecks: [], install: [] })) };
      }
      default: throw new Error('Unsupported Codex operation');
    }
  }
  private sessionModels(frame: CodexRequest, p: Record<string, any>): Promise<unknown> {
    return this.serial(this.record(p.sessionKey), async () => {
      const r = this.record(p.sessionKey);
      if (this.loaded.has(r.id) && !this.effectiveSettings.has(r.id)) {
        const response = await this.rpc.request('thread/resume', { threadId: r.threadId, excludeTurns: true });
        // Only the guarded cold-resume path proves 0.153's default mode. Do not
        // invent it for an unrelated uncertain write on an already-live thread.
        const recovered = nativeSettings(response, true, r.permissionsUnconfirmed === true && this.rpc.nativeVersion === '0.153.3');
        if (recovered) this.rememberSettings(r, recovered);
      }
      if (!r.threadId || !r.activity) {
        if (!r.permissionsUnconfirmed || frame.method === 'models.permissions') {
          await this.thread(r, false, frame.method === 'models.permissions' ? permissionSelectionPatch(p.mode, r.cwd ?? this.project) : undefined);
        }
      }
      else if (!this.loaded.has(r.id)) {
        this.desktop?.follow(r.threadId);
        const snapshot = this.desktop?.snapshots.get(r.threadId);
        if (snapshot?.fresh) this.desktopSnapshot(r.threadId, snapshot);
        else this.effectiveSettings.delete(r.id);
        if (frame.method === 'models.list' && !this.effectiveSettings.has(r.id) && !r.permissionsUnconfirmed) {
          try {
            await this.desktop!.request('thread-owner-discovery', { conversationId: r.threadId });
            const current = this.desktop?.snapshots.get(r.threadId);
            if (current?.fresh) this.desktopSnapshot(r.threadId, current);
          } catch (error) {
            // Preparing the picker may load a released thread, but never guesses
            // that a missing broker or an unanswered owner has released it.
            if (error instanceof DesktopIpcError && (error.outcome === 'no-owner' || error.reason === 'broker-unavailable')) {
              await this.assertReleasedNative(r, error, true);
              await this.thread(r, true);
            }
          }
        }
      }
      const catalog = await this.refreshModels();
      if (frame.method !== 'models.list') {
        if (this.runs.has(r.id)) throw new Error('Wait for this task to finish before changing its settings');
        const selected = catalog.find(m => m.model === r.model);
        let patch: Record<string, unknown>;
        if (frame.method === 'models.select') {
          if (p.scope !== 'session' || p.provider !== r.provider || typeof p.model !== 'string' || !catalog.some(m => m.model === p.model)) throw new Error('Choose an available model for this session');
          patch = { model: p.model, effort: catalog.find(m => m.model === p.model)?.defaultReasoningEffort };
        } else if (frame.method === 'models.thinking') {
          if (typeof p.level !== 'string' || !selected?.supportedReasoningEfforts?.some((e: any) => e.reasoningEffort === p.level)) throw new Error('This model does not support that reasoning level');
          patch = { effort: p.level };
        } else if (frame.method === 'models.permissions') {
          patch = permissionSelectionPatch(p.mode, r.cwd ?? this.project);
        } else {
          if (typeof p.enabled !== 'boolean') throw new Error('Choose whether Fast mode is enabled');
          const tier = r.provider === 'openai' ? fastServiceTier(selected) : undefined;
          if (r.provider !== 'openai') throw new Error('This provider does not advertise a supported Fast mode');
          if (p.enabled && !tier) throw new Error('This model does not offer Fast mode');
          patch = { serviceTier: p.enabled ? tier! : null };
        }
        await this.nativeSettings(r, patch);
        if (frame.method === 'models.permissions') { delete r.permissionsUnconfirmed; this.save(); }
        if (frame.method === 'models.fast') {
          const effective = this.effectiveSettings.get(r.id)!;
          r.speedPreference = { serviceTier: effective.serviceTier, provider: effective.modelProvider }; this.save();
        }
      }
      return this.modelSelection(catalog, r);
    });
  }
  private modelSelection(catalog: any[], r?: Entry) {
    const models = catalog.map(m => ({ id: m.model, name: m.displayName, provider: r?.provider ?? 'openai', input: m.inputModalities ?? ['text', 'image'], reasoning: m.supportedReasoningEfforts?.length > 0, reasoningLevels: m.supportedReasoningEfforts?.map((e: any) => e.reasoningEffort) }));
    if (r?.model && !models.some(m => m.id === r.model)) models.unshift({ id: r.model, name: r.model, provider: r.provider ?? '', input: ['text'], reasoning: false, reasoningLevels: [] });
    // Native catalogs do not identify which custom endpoint honors service tiers.
    // Preserve its effective value, but never advertise acceleration from a
    // shared OpenAI model catalog for an arbitrary third-party provider.
    const fastTier = r?.provider === 'openai' ? fastServiceTier(catalog.find(m => m.model === r.model)) : undefined;
    const effective = r ? this.effectiveSettings.get(r.id) : undefined;
    const fastMode = r ? { enabled: !effective ? null : isFastServiceTier(effective.serviceTier) || (!!fastTier && effective.serviceTier === fastTier), available: !!fastTier && !!effective } : undefined;
    const canSelectPermissions = !!effective || r?.permissionsUnconfirmed === true;
    const permissions = r ? { mode: permissionMode(effective), available: canSelectPermissions, availableModes: canSelectPermissions ? ['workspace', 'read-only', 'full-access'] : [], scope: 'session', requiresConfirmation: r.permissionsUnconfirmed === true } : undefined;
    return { ok: true, scope: 'session', permissions, fastMode, thinkingLevel: effective?.effort ?? undefined, currentModel: r?.model ?? '', currentProvider: r?.provider ?? '', currentBaseUrl: '', models,
      ...(r?.permissionsUnconfirmed ? { note: 'Codex did not restore the conversation permissions. Select and confirm permissions before sending.' } : {}) };
  }
  private async historyTurnMetadata(threadId: string, wanted: string[], head: boolean): Promise<Map<string, any>> {
    let cached = this.historyMetadata.get(threadId);
    if (head || !cached) {
      cached = { turns: new Map(), complete: false };
      if (this.historyMetadata.size >= 8) this.historyMetadata.delete(this.historyMetadata.keys().next().value!);
      this.historyMetadata.set(threadId, cached);
    }
    // Item pages may contain old turns. Walk metadata only, retaining cursors so
    // scrolling does not repeatedly parse recent transcripts or lose old dates.
    const cursors = new Set<string>();
    for (let page = 0; page < 20 && !cached.complete && wanted.some(id => !cached!.turns.has(id)); page++) {
      const result = await this.rpc.request('thread/turns/list', { threadId, limit: 100, itemsView: 'notLoaded', sortDirection: 'desc', ...(cached.cursor ? { cursor: cached.cursor } : {}) });
      if (!Array.isArray(result.data)) throw new Error('Invalid native turn metadata');
      for (const turn of result.data) if (typeof turn.id === 'string') {
        cached.turns.set(turn.id, { id: turn.id, status: turn.status, error: turn.error, startedAt: turn.startedAt, completedAt: turn.completedAt });
        if (cached.turns.size > 1000) cached.turns.delete(cached.turns.keys().next().value!);
      }
      const next = result.nextCursor;
      if (next && (typeof next !== 'string' || next === cached.cursor || cursors.has(next))) throw new Error('Invalid native turn metadata cursor');
      if (next) cursors.add(next);
      cached.cursor = next || undefined; cached.complete = !next;
    }
    return cached.turns;
  }
  private async history(key: unknown, cursor: unknown): Promise<SessionHistory> {
    const artifactEpoch = this.artifacts.epoch;
    const owned = this.options.device && this.native.has(String(key)) ? this.record(key) : this.records.find(r => r.id === key), native = this.native.get(String(key));
    if (!owned && !native) throw new Error('Session unavailable; refresh the conversation list');
    if (owned && (!owned.threadId || !owned.activity)) return { key: owned.id, messages: [], hasActiveRun: false };
    const threadId = owned?.threadId ?? native.id;
    if (owned && !this.loaded.has(owned.id)) { this.desktop?.follow(threadId); const snapshot = this.desktop?.snapshots.get(threadId); if (snapshot?.fresh) this.desktopSnapshot(threadId, snapshot); }
    let page: { kind?: 'items'; native?: string; end?: number } = {};
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 4096) throw new Error('Invalid history cursor');
      try { page = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new Error('Invalid history cursor'); }
      if (!page || typeof page !== 'object' || (page.kind !== undefined && page.kind !== 'items') || (page.native !== undefined && typeof page.native !== 'string') || (page.end !== undefined && (!Number.isSafeInteger(page.end) || page.end < 0))) throw new Error('Invalid history cursor');
    }
    const metadata = await this.rpc.request('thread/read', { threadId, includeTurns: false });
    if (metadata.thread?.cwd !== (owned?.cwd ?? native?.cwd ?? this.project)) throw new Error('Session belongs to another project');
    const legacyCursor = cursor !== undefined && page.kind !== 'items';
    let result: any, turns: any[];
    if (legacyCursor) {
      // Cursors issued before item pagination remain readable across Bridge upgrades.
      result = await this.rpc.request('thread/turns/list', { threadId, limit: 10, itemsView: 'full', sortDirection: 'desc', ...(page.native ? { cursor: page.native } : {}) });
      turns = [...(result.data ?? [])].reverse();
    } else {
      let limit = 32;
      for (;;) {
        try { result = await this.rpc.request('thread/items/list', { threadId, limit, sortDirection: 'desc', ...(page.native ? { cursor: page.native } : {}) }); break; }
        catch (error) { if ((error as { code?: string }).code !== 'frame_too_large' || limit === 1) throw error; limit = Math.max(1, Math.floor(limit / 2)); }
      }
      if (!Array.isArray(result.data)) throw new Error('Invalid native item history');
      const metadataByTurn = await this.historyTurnMetadata(threadId, [...new Set<string>(result.data.map((row: any) => row.turnId))], cursor === undefined);
      const grouped = new Map<string, any>();
      for (const row of [...result.data].reverse()) {
        if (typeof row.turnId !== 'string' || !row.item || typeof row.item.id !== 'string') throw new Error('Invalid native history item');
        if (!grouped.has(row.turnId)) grouped.set(row.turnId, { ...(metadataByTurn.get(row.turnId) as object ?? {}), id: row.turnId, items: [] });
        grouped.get(row.turnId).items.push(row.item);
      }
      turns = [...grouped.values()];
    }
    const active = owned ? this.runs.get(owned.id) : undefined;
    const liveTurn = active?.turnId && turns.find(t => t.id === active.turnId);
    if (liveTurn && active && page.native === undefined) {
      const combined = new Map((liveTurn.items ?? []).map((item: any) => [item.id, item]));
      for (const [id, item] of active.items) combined.set(id, item);
      liveTurn.items = [...combined.values()];
    }
    const messages = this.artifacts.project(String(key), codexMessages(turns), [metadata.thread.cwd], artifactEpoch, cursor);
    const end = page.end ?? messages.length;
    if (end > messages.length) throw new Error('History changed; refresh this conversation');
    let start = end, bytes = 0;
    while (start > Math.max(0, end - 40)) { const size = Buffer.byteLength(JSON.stringify(messages[start - 1])); if (bytes + size > 7 * 1024 * 1024) break; bytes += size; start--; }
    if (start === end && end) throw new Error('This message exceeds the history transfer limit');
    const identity = legacyCursor ? {} : { kind: 'items' };
    const next = start ? { ...identity, native: page.native, end: start } : result.nextCursor ? { ...identity, native: result.nextCursor } : undefined;
    const run = owned ? this.runs.get(owned.id) : undefined;
    return { key: String(key), messages: messages.slice(start, end), nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : undefined, sessionId: threadId, thinkingLevel: owned?.effort, hasActiveRun: !!run, activeRun: run ? { runId: run.id, text: run.text, startedAtMs: run.started, sessionAbortable: !!run.turnId } : undefined };
  }
  private prompt(r: Entry, input: PromptInput, desktopOverrides?: Record<string, unknown>): Promise<{ runId: string }> {
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
      // Native is immutable provenance, not current ownership. A successful,
      // authorized resume makes this App Server the owner until it exits.
      if (r.archived) throw new Error('Restore this conversation before sending a message');
      if (r.permissionsUnconfirmed) throw new Error('Codex did not restore the conversation permissions. Select and confirm permissions before sending.');
      let desktopOwned = !!r.threadId && !!r.activity && !this.loaded.has(r.id);
      if (desktopOwned) {
        try { await this.desktop!.connect(); }
        catch (error) {
          // A send need not be preceded by opening the model picker. Use the
          // same pre-dispatch ownership proof and native lock as cold settings.
          await this.assertReleasedNative(r, error, true);
          await this.thread(r, true);
          desktopOwned = false;
        }
      } else await this.thread(r);
      if (!desktopOwned && !this.effectiveSettings.has(r.id)) throw new Error('This Codex version cannot confirm safe conversation settings. Update Codex and reconnect before sending.');
      // A Desktop permission/model override and its turn dispatch form one
      // serialized operation. Another client cannot change settings between
      // native confirmation and the turn that requested those settings.
      if (desktopOverrides && Object.keys(desktopOverrides).length) await this.nativeSettings(r, desktopOverrides);
      const model = this.catalog.find(m => m.model === r.model);
      if (images.length && model && !model.inputModalities?.includes('image')) throw new Error('This model does not support images');
      if (!desktopOwned && input.thinkingLevel && !model?.supportedReasoningEfforts?.some((e: any) => e.reasoningEffort === input.thinkingLevel)) throw new Error('This model does not support that reasoning level');
      if (Object.keys(r.keys).length >= 10000) throw new Error('Start a new conversation to continue');
      const runId = randomUUID();
      const previousMetadata = { preview: r.preview, activity: r.activity, title: r.title, effort: r.effort };
      Object.defineProperty(r.keys, input.idempotencyKey, { value: { hash, runId }, enumerable: true, configurable: true });
      r.preview = sessionPreview(input.text, !!input.attachments?.length); r.activity = Date.now(); if (!r.title) r.title = input.text.trim().slice(0, 80); r.effort = input.thinkingLevel ?? r.effort;
      try { this.save(); } catch (error) { delete r.keys[input.idempotencyKey]; Object.assign(r, previousMetadata); throw error; }
      this.runs.set(r.id, { id: runId, text: '', started: Date.now(), items: new Map() }); this.update({ type: 'run_started', sessionKey: r.id, runId });
      const params = { threadId: r.threadId, input: [{ type: 'text', text: input.text }, ...images.map(a => ({ type: 'image', url: `data:${a.mimeType};base64,${a.content}` }))], ...(desktopOwned ? {} : { model: r.model, effort: r.effort, ...(r.serviceTier !== undefined ? { serviceTier: r.serviceTier } : {}) }), clientUserMessageId: input.idempotencyKey };
      const accepted = desktopOwned ? this.desktopTurn(r, params) : this.rpc.request('turn/start', params);
      if (this.starts.size >= 256) this.starts.delete(this.starts.keys().next().value!);
      this.starts.set(runId, accepted);
      void accepted.then(result => {
        const run = this.runs.get(r.id); if (run?.id !== runId) return;
        run.turnId = result.turn?.id;
        // A fast Desktop failure can reach the follower before the start ACK.
        // Reconcile only that confirmed turn; never dispatch or infer a new one.
        const snapshot = run.desktop && r.threadId ? this.desktop?.snapshots.get(r.threadId) : undefined;
        const terminal = run.turnId && snapshot?.fresh && desktopTurns(snapshot.state).find((turn: any) =>
          (turn.turnId ?? turn.id) === run.turnId && ['completed', 'interrupted', 'failed'].includes(turn.status));
        if (terminal) {
          run.final = (terminal.items ?? []).filter((item: any) => item.type === 'agentMessage').map((item: any) => item.text ?? '').join('\n\n');
          this.finish(r, terminal.status === 'interrupted' ? 'cancelled' : terminal.status === 'failed' ? 'error' : 'end_turn', terminal);
        }
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
    if (method === 'thread/settings/updated' && this.loaded.has(r.id)) {
      const settings = nativeSettings(p.threadSettings);
      if (settings) this.rememberSettings(r, settings);
      this.scheduleDesktop(r); return;
    }
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
    if (method === 'turn/completed' && p.turn?.id === run.turnId && ['completed', 'interrupted', 'failed'].includes(p.turn.status)) {
      this.finish(r, p.turn.status === 'interrupted' ? 'cancelled' : p.turn.status === 'failed' ? 'error' : 'end_turn', p.turn);
    }
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
  private finish(r: Entry, stopReason: 'end_turn' | 'cancelled' | 'error', nativeTurn?: any): void {
    const run = this.runs.get(r.id); if (!run) return;
    this.runs.delete(r.id);
    if (r.threadId) this.desktopHistory.delete(r.threadId);
    for (const [id, c] of this.approvals) if (c.entry === r) { this.approvals.delete(id); this.update({ type: 'approval_resolved', approvalId: id, decision: 'expired' }); }
    for (const [id, group] of this.questions) if (group.entry === r) { this.questions.delete(id); for (const q of group.pending.keys()) this.update({ type: 'question_resolved', sessionKey: r.id, questionId: q }); }
    const reply = sessionPreview(run.final);
    if (reply) { r.preview = reply; r.activity = Date.now(); }
    this.save(); this.scheduleDesktop(r);
    const generated = [...run.items.values()].flatMap(item => codexGeneratedImage(item)?.attachments ?? []);
    const terminalMessage = stopReason === 'error' ? codexTurnFailure({ id: run.turnId ?? `run:${run.id}`, status: 'failed', ...nativeTurn }) : undefined;
    this.update({ type: 'run_finished', sessionKey: r.id, runId: run.id, stopReason, ...(terminalMessage ? { terminalMessage,
      message: { role: 'assistant', content: terminalMessage.text } } : run.final || generated.length ? { message: { role: 'assistant', content: run.final ?? '', ...(generated.length ? { attachments: generated } : {}), model: r.model, provider: r.provider } } : {}) });
    this.update({ type: 'session_info_update', session: this.descriptor(r) });
  }
  prepareForUpdate(): boolean { return this.updateAdmission.prepare(() => this.runs.size > 0 || this.starts.size > 0); }

  async stop(): Promise<void> {
    if (this.stopped) return; this.stopped = true; this.artifacts.clear();
    for (const timer of this.publishTimers.values()) clearTimeout(timer); this.publishTimers.clear();
    for (const waiter of this.settingsWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Codex Bridge stopped')); }
    this.settingsWaiters.clear(); this.sessionActivity?.stop(); this.desktop?.stop();
    this.profile.clear(); await this.rpc.stop(); this.artifacts.clear();
    if (existsSync(this.lockPath)) unlinkSync(this.lockPath);
  }
}
