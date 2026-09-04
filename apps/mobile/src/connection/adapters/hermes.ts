import {
  AdapterError,
  resolveCapabilities,
  type AgentDescriptor,
  type ConnectionRecord,
  type CronJob,
  type CronJobCreate,
  type CronJobPatch,
  type CronListParams,
  type CronListResult,
  type CronRunLogEntry,
  type CronRunsParams,
  type CronRunsResult,
  type CronSchedule,
  type DiscoverResult,
  type ManagementOperations,
  type PromptInput,
  type SessionDescriptor,
  type SessionUpdate,
} from '@clawket/agent-protocol';
import { searchDiscoverSkills } from '../../features/discover';
import type { GatewayEvents } from '../../services/gateway-shared';
import type { ConnectionState as LegacyConnectionState, GatewayConfig } from '../../types';
import type {
  HermesCronJob,
  HermesCronJobUpsert,
  HermesCronOutputEntry,
} from '../../types/hermes-cron';
import {
  GatewayAdapterBase,
  normalizeSessionUpdatedAt,
  sessionTitle,
  toAdapterError,
  type GatewayAdapterOptions,
  type GatewaySessionRecord,
} from './gateway-adapter';
import {
  extractGatewayMessageText,
  type GatewayAdapterEvent,
} from './gateway-session-update';

export const HERMES_MULTI_SESSION_CAPABILITY = 'hermes.multi-session.v2';

export class HermesAdapter extends GatewayAdapterBase {
  public readonly management: ManagementOperations;

  private healthObserved = false;
  private bridgeName: string | undefined;
  private readonly commandRuns = new Map<string, { sessionKey: string; command: string }>();

  constructor(record: ConnectionRecord, options: GatewayAdapterOptions = {}) {
    super({
      record,
      gatewayConfig: toHermesGatewayConfig(record),
      backendCapabilities: 'hermes',
      fallbackSessionKey: 'main',
      options,
    });
    this.management = this.createManagementOperations();
  }

  public override disconnect(): void {
    this.healthObserved = false;
    this.commandRuns.clear();
    super.disconnect();
  }

  public override async probe(timeoutMs?: number): Promise<boolean> {
    const healthy = await super.probe(timeoutMs);
    if (healthy && this.healthObserved) this.confirmHealthReady();
    return healthy && this.healthObserved;
  }

  public async listAgents(): Promise<AgentDescriptor[]> {
    return [this.hermesAgent()];
  }

  public async listSessions(): Promise<SessionDescriptor[]> {
    if (!this.capabilities.sessions) {
      return this.rememberSessions([legacyHermesMainSession(this.connection.id)]);
    }
    const payload = await this.invoke(() => this.gateway.request<{
      sessions?: GatewaySessionRecord[];
    }>('sessions.list', { limit: 200 }));
    const sessions = (Array.isArray(payload?.sessions) ? payload.sessions : [])
      .map((session) => mapHermesSession(this.connection.id, session));
    return this.rememberSessions(sessions);
  }

  public async prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    if (input.attachments?.some((attachment) => attachment.type !== 'image')) {
      throw new AdapterError('unsupported', 'Hermes supports image attachments only');
    }
    const command = isHermesCommand(input.text)
      ? { sessionKey: key, command: input.text }
      : null;
    this.beginPrompt(key, input.idempotencyKey);
    if (command) this.commandRuns.set(input.idempotencyKey, command);
    try {
      const payload = await this.invoke(() => this.gateway.request<{ runId?: string }>('chat.send', {
        sessionKey: key,
        message: input.text,
        idempotencyKey: input.idempotencyKey,
        ...(input.skillId ? { skillId: input.skillId } : {}),
        ...(input.attachments?.length
          ? { attachments: input.attachments.map((attachment) => ({ ...attachment })) }
          : {}),
      }));
      const runId = payload?.runId || input.idempotencyKey;
      if (command && runId !== input.idempotencyKey && this.commandRuns.has(input.idempotencyKey)) {
        this.commandRuns.delete(input.idempotencyKey);
        this.commandRuns.set(runId, command);
      }
      this.confirmPrompt(key, input.idempotencyKey, runId);
      return { runId };
    } catch (error) {
      if (command) this.commandRuns.delete(input.idempotencyKey);
      this.failPrompt(key, input.idempotencyKey);
      throw error;
    }
  }

  public async createSession(_agentId: string, options?: { title?: string }): Promise<SessionDescriptor> {
    this.assertMultiSession(HERMES_MULTI_SESSION_CAPABILITY);
    const payload = await this.invoke(() => this.gateway.request<{
      session?: GatewaySessionRecord;
    }>('sessions.create', {
      ...(options?.title ? { title: options.title } : {}),
    }));
    if (!payload?.session) {
      throw new AdapterError('server', 'sessions.create did not return a session');
    }
    const session = mapHermesSession(this.connection.id, payload.session);
    void this.refreshSessionsAfterMutation();
    return session;
  }

  public async patchSession(key: string, patch: { title?: string }): Promise<void> {
    this.assertMultiSession(HERMES_MULTI_SESSION_CAPABILITY);
    if (patch.title === undefined) return;
    await this.invoke(() => this.gateway.request('sessions.patch', { key, title: patch.title }));
    void this.refreshSessionsAfterMutation();
  }

  public async resetSession(key: string): Promise<void> {
    this.assertMultiSession(HERMES_MULTI_SESSION_CAPABILITY);
    await this.invoke(() => this.gateway.request('sessions.reset', { key }));
    void this.refreshSessionsAfterMutation();
  }

  public async deleteSession(key: string): Promise<void> {
    this.assertMultiSession(HERMES_MULTI_SESSION_CAPABILITY);
    await this.invoke(() => this.gateway.request('sessions.delete', { key }));
    void this.refreshSessionsAfterMutation();
  }

  protected override requiresHealthEvidence(): boolean {
    return true;
  }

  protected override handleGatewayHealth(payload: GatewayEvents['health']): void {
    const capabilities = Array.isArray(payload.capabilities)
      ? payload.capabilities.filter((value): value is string => typeof value === 'string')
      : [];
    const supportsMultiSession = capabilities.includes(HERMES_MULTI_SESSION_CAPABILITY);
    this.currentCapabilities = resolveCapabilities('hermes', supportsMultiSession
      ? undefined
      : {
          sessions: false,
          sessionCreate: false,
          sessionRename: false,
          sessionReset: false,
          sessionDelete: false,
        });
    if (supportsMultiSession) {
      delete this.connection.bridgeOutdated;
    } else {
      this.connection.bridgeOutdated = true;
    }
    this.bridgeName = readString(payload.displayName) || readString(payload.name) || this.bridgeName;
    this.healthObserved = true;

    const status = readString(payload.status).toLowerCase();
    if ((status && status !== 'ok' && status !== 'healthy') || payload.hermesApiReachable === false) {
      this.healthObserved = false;
      this.failAdapterConnection(new AdapterError('gateway_offline', 'Hermes did not respond to the Bridge health probe'));
      return;
    }
    this.confirmHealthReady();
  }

  protected override handleGatewayConnectionTransition(state: LegacyConnectionState): void {
    if (state === 'connecting' || state === 'reconnecting' || state === 'closed') {
      this.healthObserved = false;
    }
  }

  protected override historyCacheAgentId(): string {
    return 'hermes';
  }

  protected override transformGatewayUpdates(
    event: GatewayAdapterEvent,
    updates: SessionUpdate[],
  ): SessionUpdate[] {
    if (event.type === 'chatAborted' || event.type === 'chatError') {
      this.takeCommand(event.payload.runId, event.payload.sessionKey);
      return updates;
    }
    if (event.type !== 'chatFinal') return updates;
    const command = this.takeCommand(event.payload.runId, event.payload.sessionKey);
    if (!command) return updates;
    const text = extractGatewayMessageText(event.payload.message?.content);
    return [
      {
        type: 'system_event',
        sessionKey: command.sessionKey,
        kind: 'command_ack',
        text,
        timestampMs: Date.now(),
      },
      ...updates.map((update) => update.type === 'run_finished'
        ? { ...update, message: undefined }
        : update),
    ];
  }

  private takeCommand(
    runId: string,
    sessionKey?: string,
  ): { sessionKey: string; command: string } | null {
    const exact = this.commandRuns.get(runId);
    if (exact) {
      this.commandRuns.delete(runId);
      return exact;
    }
    const candidates = [...this.commandRuns.entries()].filter(([, command]) => (
      !sessionKey || command.sessionKey === sessionKey
    ));
    if (candidates.length !== 1) return null;
    const [provisionalRunId, command] = candidates[0];
    this.commandRuns.delete(provisionalRunId);
    return command;
  }

  private hermesAgent(): AgentDescriptor {
    return {
      connectionId: this.connection.id,
      agentId: 'hermes',
      name: this.bridgeName || this.connection.label || 'Hermes',
      emoji: '\u{1FABD}',
      isMain: true,
      mainSessionKey: 'main',
    };
  }

  private assertMultiSession(capability: string): void {
    if (!this.capabilities.sessions) {
      throw new AdapterError('unsupported', `${capability} is required for Hermes session mutations`);
    }
  }

  private async refreshSessionsAfterMutation(): Promise<void> {
    try {
      await this.listSessions();
    } catch {
      // The mutation succeeded; a later list refresh will reconcile.
    }
  }

  private createManagementOperations(): ManagementOperations {
    return {
      models: {
        list: () => this.invoke(() => this.gateway.listModels()),
        getSelection: () => this.invoke(() => this.gateway.getModelSelectionState()),
        setSelection: (params) => this.invoke(() => this.gateway.setModelSelection({
          ...params,
          scope: 'global',
          sessionKey: null,
        })),
        listThinkingLevels: () => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
      skills: {
        status: () => this.invoke(() => this.gateway.getSkillsStatus('main')),
        get: (key, params) => this.invoke(() => this.gateway.getSkillDetail(key, {
          ...params,
          agentId: 'main',
        })),
        update: (key, patch) => this.invoke(() => this.gateway.updateSkill(key, patch)),
        updateContent: (key, content) => this.invoke(() => (
          this.gateway.updateSkillContent(key, content, 'main')
        )),
        remove: (key) => this.invoke(() => this.gateway.deleteSkill(key, 'main')),
        discover: (query) => discoverSkills(query),
      },
      cron: {
        list: (params) => this.listCron(params),
        add: (job) => this.addCron(job),
        update: (id, patch) => this.updateCron(id, patch),
        remove: async (id) => ({ ok: await this.invoke(() => this.gateway.removeHermesCronJob(id)) }),
        run: (id) => this.invoke(() => this.gateway.runHermesCronJob(id)),
        runs: (params) => this.listCronRuns(params),
      },
      agents: {
        list: async () => ({
          defaultId: 'hermes',
          mainKey: 'main',
          agents: [{
            id: 'hermes',
            name: this.bridgeName || this.connection.label || 'Hermes',
            identity: { name: this.bridgeName || this.connection.label || 'Hermes', emoji: '\u{1FABD}' },
          }],
        }),
        files: {
          list: () => this.invoke(() => this.gateway.listAgentFiles('main')),
          get: (name) => this.invoke(() => this.gateway.getAgentFile(name, 'main')),
          set: (name, content) => this.invoke(() => (
            this.gateway.setAgentFile(name, content, 'main')
          )),
        },
      },
      usage: {
        sessions: (params) => this.invoke(() => this.gateway.fetchUsage(params)),
        cost: (params) => this.invoke(() => this.gateway.fetchCostSummary(params)),
      },
    };
  }

  private async listCron(params: CronListParams = {}): Promise<CronListResult> {
    const rawJobs = await this.invoke(() => this.gateway.listHermesCronJobs({
      includeDisabled: params.includeDisabled ?? params.enabled !== 'enabled',
    }));
    let jobs = rawJobs.map(mapHermesCronJob);
    if (params.enabled === 'enabled') jobs = jobs.filter((job) => job.enabled);
    if (params.enabled === 'disabled') jobs = jobs.filter((job) => !job.enabled);
    const query = params.query?.trim().toLowerCase();
    if (query) {
      jobs = jobs.filter((job) => `${job.name}\n${job.description ?? ''}`.toLowerCase().includes(query));
    }
    const sortBy = params.sortBy ?? 'nextRunAtMs';
    const direction = params.sortDir === 'desc' ? -1 : 1;
    jobs.sort((left, right) => {
      if (sortBy === 'name') return direction * left.name.localeCompare(right.name);
      const leftValue = sortBy === 'updatedAtMs' ? left.updatedAtMs : (left.state.nextRunAtMs ?? Number.MAX_SAFE_INTEGER);
      const rightValue = sortBy === 'updatedAtMs' ? right.updatedAtMs : (right.state.nextRunAtMs ?? Number.MAX_SAFE_INTEGER);
      return direction * (leftValue - rightValue);
    });
    const total = jobs.length;
    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.max(1, params.limit ?? 100);
    const page = jobs.slice(offset, offset + limit);
    const hasMore = offset + page.length < total;
    return { jobs: page, total, offset, limit, hasMore, nextOffset: hasMore ? offset + page.length : null };
  }

  private async addCron(job: CronJobCreate): Promise<CronJob> {
    const created = await this.invoke(() => this.gateway.createHermesCronJob(toHermesCronUpsert(job)));
    if (!created) throw new AdapterError('server', 'Hermes did not return the created scheduled task');
    return mapHermesCronJob(created);
  }

  private async updateCron(id: string, patch: CronJobPatch): Promise<CronJob> {
    const current = await this.invoke(() => this.gateway.getHermesCronJob(id));
    if (!current) throw new AdapterError('server', `Hermes scheduled task was not found: ${id}`);
    if (patch.enabled === false && current.enabled) {
      await this.invoke(() => this.gateway.pauseHermesCronJob(id));
    } else if (patch.enabled === true && !current.enabled) {
      await this.invoke(() => this.gateway.resumeHermesCronJob(id));
    }
    const nativePatch: Partial<HermesCronJobUpsert> = {};
    const extendedPatch = patch as CronJobPatch & { skills?: string[] };
    if (patch.name !== undefined) nativePatch.name = patch.name;
    if (patch.schedule !== undefined) nativePatch.schedule = serializeHermesSchedule(patch.schedule);
    if (patch.payload !== undefined) nativePatch.prompt = cronPrompt(patch.payload);
    if (patch.delivery !== undefined) nativePatch.deliver = patch.delivery.mode;
    if (extendedPatch.skills !== undefined) nativePatch.skills = extendedPatch.skills;
    const updated = Object.keys(nativePatch).length > 0
      ? await this.invoke(() => this.gateway.updateHermesCronJob(id, nativePatch))
      : await this.invoke(() => this.gateway.getHermesCronJob(id));
    if (!updated) throw new AdapterError('server', `Hermes scheduled task was not found: ${id}`);
    return mapHermesCronJob(updated);
  }

  private async listCronRuns(params: CronRunsParams): Promise<CronRunsResult> {
    const outputs = await this.invoke(() => this.gateway.listHermesCronOutputs({
      ...(params.scope === 'job' && params.id ? { jobId: params.id } : {}),
      limit: Math.max(1, (params.offset ?? 0) + (params.limit ?? 100)),
    }));
    const sorted = outputs
      .map(mapHermesCronRun)
      .sort((left, right) => params.sortDir === 'asc' ? left.ts - right.ts : right.ts - left.ts);
    const total = sorted.length;
    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.max(1, params.limit ?? 100);
    const entries = sorted.slice(offset, offset + limit);
    const hasMore = offset + entries.length < total;
    return { entries, total, offset, limit, hasMore, nextOffset: hasMore ? offset + entries.length : null };
  }
}

export function mapHermesSession(
  connectionId: string,
  session: GatewaySessionRecord,
): SessionDescriptor {
  const source = session.source ?? 'bridge';
  const nativeReadOnly = source === 'native';
  const isMain = session.key === 'main';
  const actions = session.allowedActions;
  return {
    connectionId,
    agentId: 'hermes',
    key: session.key,
    kind: isMain
      ? 'main'
      : session.key.includes(':cron:')
        ? 'cron'
        : session.kind === 'group'
          ? 'group'
          : session.kind === 'direct'
            ? 'direct'
            : 'other',
    title: sessionTitle(session),
    channel: session.channel,
    updatedAt: normalizeSessionUpdatedAt(session.updatedAt),
    preview: session.lastMessagePreview,
    model: session.model,
    hasActiveRun: session.hasActiveRun === true,
    attention: session.attention ?? null,
    parentSessionKey: session.parentSessionKey || session.spawnedBy,
    source,
    allowedActions: nativeReadOnly
      ? { rename: false, reset: false, delete: false, pin: false }
      : {
          rename: actions?.rename ?? true,
          reset: actions?.reset ?? true,
          delete: isMain ? false : (actions?.delete ?? true),
          pin: actions?.pin ?? true,
        },
  };
}

export function legacyHermesMainSession(connectionId: string): SessionDescriptor {
  return {
    connectionId,
    agentId: 'hermes',
    key: 'main',
    kind: 'main',
    title: 'Main',
    updatedAt: null,
    hasActiveRun: false,
    source: 'bridge',
    allowedActions: { rename: false, reset: false, delete: false, pin: false },
  };
}

export function mapHermesCronJob(job: HermesCronJob): CronJob {
  const createdAtMs = parseIso(job.created_at) ?? 0;
  const updatedAtMs = Math.max(
    createdAtMs,
    parseIso(job.last_run_at) ?? 0,
    parseIso(job.paused_at) ?? 0,
  );
  const lastStatus = normalizeCronStatus(job.last_status);
  return {
    id: job.id,
    name: job.name,
    description: job.schedule_display || undefined,
    enabled: job.enabled,
    createdAtMs,
    updatedAtMs,
    schedule: parseHermesSchedule(job),
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: job.prompt },
    delivery: { mode: job.deliver === 'none' ? 'none' : 'announce' },
    state: {
      nextRunAtMs: parseIso(job.next_run_at),
      lastRunAtMs: parseIso(job.last_run_at),
      lastRunStatus: lastStatus,
      lastStatus,
      lastError: job.last_error || undefined,
      lastDeliveryError: job.last_delivery_error || undefined,
    },
  };
}

function toHermesGatewayConfig(record: ConnectionRecord): GatewayConfig {
  return {
    url: record.url,
    token: record.auth?.token,
    password: record.auth?.password,
    backendKind: 'hermes',
    transportKind: record.transportKind as GatewayConfig['transportKind'],
    mode: 'hermes',
    relay: record.relay,
    hermes: record.hermes ?? { bridgeUrl: record.url, displayName: record.label },
    debugMode: record.debugMode,
  };
}

function toHermesCronUpsert(job: CronJobCreate): HermesCronJobUpsert {
  const prompt = cronPrompt(job.payload).trim();
  const skills = (job as CronJobCreate & { skills?: string[] }).skills
    ?.map((skill) => skill.trim())
    .filter(Boolean) ?? [];
  if (!job.name.trim()) throw new AdapterError('server', 'Hermes scheduled task name is required');
  if (!prompt && skills.length === 0) {
    throw new AdapterError('server', 'Hermes scheduled tasks require a prompt or at least one skill');
  }
  return {
    name: job.name,
    schedule: serializeHermesSchedule(job.schedule),
    prompt,
    ...(skills.length > 0 ? { skills } : {}),
    deliver: job.delivery?.mode ?? 'none',
  };
}

function cronPrompt(payload: CronJobCreate['payload']): string {
  return payload.kind === 'agentTurn' ? payload.message : payload.text;
}

function serializeHermesSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'at') return schedule.at;
  if (schedule.kind === 'cron') return schedule.expr;
  const minutes = Math.max(1, Math.round(schedule.everyMs / 60_000));
  return `every ${minutes}m`;
}

function parseHermesSchedule(job: HermesCronJob): CronSchedule {
  const kind = job.schedule.kind?.toLowerCase();
  if (kind === 'at' && job.schedule.run_at) return { kind: 'at', at: job.schedule.run_at };
  if ((kind === 'interval' || kind === 'every') && typeof job.schedule.minutes === 'number') {
    return { kind: 'every', everyMs: job.schedule.minutes * 60_000 };
  }
  if (job.schedule.expr) return { kind: 'cron', expr: job.schedule.expr };
  if (job.next_run_at && job.repeat.times === 1) return { kind: 'at', at: job.next_run_at };
  return { kind: 'cron', expr: job.schedule_display || '* * * * *' };
}

function mapHermesCronRun(output: HermesCronOutputEntry): CronRunLogEntry {
  return {
    ts: output.createdAt,
    jobId: output.jobId,
    jobName: output.jobName,
    action: 'finished',
    status: output.status === 'unknown' ? undefined : output.status,
    summary: output.preview,
  };
}

function normalizeCronStatus(value: string | null): CronJob['state']['lastRunStatus'] {
  if (value === 'ok' || value === 'error' || value === 'skipped') return value;
  return undefined;
}

function parseIso(value: string | null): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isHermesCommand(text: string): boolean {
  return /^\/(?:model|thinking|reasoning|fast)(?:\s|$)/i.test(text.trim());
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function discoverSkills(query: string): Promise<DiscoverResult> {
  try {
    const items = await searchDiscoverSkills(query);
    return { items, nextCursor: null, hasMore: false };
  } catch (error) {
    throw toAdapterError(error);
  }
}
