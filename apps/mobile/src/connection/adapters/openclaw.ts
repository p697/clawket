import {
  AdapterError,
  type AgentDescriptor,
  type ConnectionRecord,
  type DiscoverResult,
  type HeartbeatSettings,
  type ManagementOperations,
  type PromptInput,
  type SessionDescriptor,
  type ToolPolicy,
} from '@clawket/agent-protocol';
import { searchDiscoverSkills } from '../../features/discover';
import { StorageService } from '../../services/storage';
import type { ConnectionState as LegacyConnectionState, GatewayConfig } from '../../types';
import {
  buildGatewayRuntimePatch,
  parseGatewayRuntimeSettings,
} from '../../utils/gateway-settings';
import {
  GatewayAdapterBase,
  inferOpenClawAgentId,
  inferOpenClawSessionKind,
  normalizeSessionUpdatedAt,
  sessionTitle,
  toAdapterError,
  type GatewayAdapterOptions,
  type GatewaySessionRecord,
} from './gateway-adapter';

export const OPENCLAW_BRIDGE_CAPABILITY = 'bridge.capabilities.v2';

export type OpenClawBridgeCapabilityMode = 'unknown' | 'v2' | 'legacy';

export type OpenClawAdapterOptions = GatewayAdapterOptions & {
  bridgeCapabilityMode?: OpenClawBridgeCapabilityMode;
  loadBridgeCapabilityMode?: () => Promise<Exclude<OpenClawBridgeCapabilityMode, 'unknown'> | null>;
  onBridgeCapabilityMode?: (mode: Exclude<OpenClawBridgeCapabilityMode, 'unknown'>) => void | Promise<void>;
};

export type OpenClawConnectMetaGateway = {
  setConnectRequestMeta?: (meta?: { capabilities: string[] }) => void;
  getConnectResponseCapabilities?: () => readonly string[] | undefined;
};

export class OpenClawAdapter extends GatewayAdapterBase {
  public readonly management: ManagementOperations;

  private bridgeCapabilityMode: OpenClawBridgeCapabilityMode;
  private readonly loadBridgeCapabilityMode?: OpenClawAdapterOptions['loadBridgeCapabilityMode'];
  private readonly onBridgeCapabilityMode?: OpenClawAdapterOptions['onBridgeCapabilityMode'];
  private bridgeCapabilityModeLoad: Promise<void> | null = null;
  private bridgeCapabilityModeLoaded: boolean;
  private compatibilityFallbackAttempted = false;
  private v2HandshakeStarted = false;

  constructor(record: ConnectionRecord, options: OpenClawAdapterOptions = {}) {
    super({
      record,
      gatewayConfig: toOpenClawGatewayConfig(record),
      backendCapabilities: 'openclaw',
      fallbackSessionKey: 'agent:main:main',
      options,
    });
    this.bridgeCapabilityMode = options.bridgeCapabilityMode ?? 'unknown';
    this.bridgeCapabilityModeLoaded = this.bridgeCapabilityMode !== 'unknown'
      || !options.loadBridgeCapabilityMode;
    this.loadBridgeCapabilityMode = options.loadBridgeCapabilityMode;
    this.onBridgeCapabilityMode = options.onBridgeCapabilityMode;
    this.management = this.createManagementOperations();
  }

  public get negotiatedBridgeCapabilityMode(): OpenClawBridgeCapabilityMode {
    return this.bridgeCapabilityMode;
  }

  public override async connect(): Promise<void> {
    await this.loadPersistedBridgeCapabilityMode();
    const extension = this.gateway as typeof this.gateway & OpenClawConnectMetaGateway;
    const canControlMeta = typeof extension.setConnectRequestMeta === 'function';

    if (this.bridgeCapabilityMode === 'legacy' || !canControlMeta) {
      extension.setConnectRequestMeta?.(undefined);
      await this.connectGateway();
      if (this.bridgeCapabilityMode === 'unknown') this.rememberBridgeCapabilityMode('legacy');
      return;
    }

    extension.setConnectRequestMeta?.({ capabilities: [OPENCLAW_BRIDGE_CAPABILITY] });
    try {
      await this.connectGateway();
      const capabilities = extension.getConnectResponseCapabilities?.();
      this.rememberBridgeCapabilityMode(
        capabilities?.includes(OPENCLAW_BRIDGE_CAPABILITY) ? 'v2' : 'legacy',
      );
    } catch (error) {
      if (
        this.bridgeCapabilityMode !== 'unknown'
        || this.compatibilityFallbackAttempted
        || !this.isV2FallbackEligible(error)
      ) {
        throw error;
      }
      this.compatibilityFallbackAttempted = true;
      extension.setConnectRequestMeta?.(undefined);
      this.restartGatewayForCompatibilityRetry();
      await this.connectGateway();
      this.rememberBridgeCapabilityMode('legacy');
    }
  }

  public async listAgents(): Promise<AgentDescriptor[]> {
    const result = await this.invoke(() => this.gateway.listAgents());
    const rawAgents = result.agents.length > 0
      ? result.agents
      : [{ id: result.defaultId || 'main', name: result.defaultId || 'main' }];
    const agents = await Promise.all(rawAgents.map(async (agent) => {
      const identity: { name?: string; avatar?: string; emoji?: string } = await this.invoke(
        () => this.gateway.fetchIdentity(agent.id),
      ).catch(() => ({}));
      const mainSessionKey = agent.id === result.defaultId && result.mainKey
        ? result.mainKey
        : `agent:${agent.id}:main`;
      return {
        connectionId: this.connection.id,
        agentId: agent.id,
        name: identity.name || agent.identity?.name || agent.name || agent.id,
        emoji: identity.emoji || agent.identity?.emoji,
        avatarUrl: identity.avatar || agent.identity?.avatarUrl || agent.identity?.avatar,
        isMain: agent.id === 'main' || agent.id === result.defaultId,
        mainSessionKey,
      } satisfies AgentDescriptor;
    }));
    const preferred = agents.find((agent) => agent.isMain) ?? agents[0];
    if (preferred) this.setFallbackSessionKey(preferred.mainSessionKey);
    return agents;
  }

  public async listSessions(agentId?: string): Promise<SessionDescriptor[]> {
    const sessions = await this.invoke(() => this.gateway.listSessions({ limit: 200 }));
    const normalized = sessions
      .map((session) => mapOpenClawSession(this.connection.id, session))
      .filter((session) => !agentId || session.agentId === agentId);
    return this.rememberSessions(normalized);
  }

  public async prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    this.beginPrompt(key, input.idempotencyKey);
    try {
      const payload = await this.invoke(() => this.gateway.request<{ runId?: string }>('chat.send', {
        sessionKey: key,
        message: input.text,
        thinking: input.thinkingLevel ?? 'off',
        deliver: false,
        idempotencyKey: input.idempotencyKey,
        ...(input.skillId ? { skillId: input.skillId } : {}),
        ...(input.attachments?.length
          ? { attachments: input.attachments.map((attachment) => ({ ...attachment })) }
          : {}),
      }));
      const runId = payload?.runId || input.idempotencyKey;
      this.confirmPrompt(key, input.idempotencyKey, runId);
      return { runId };
    } catch (error) {
      this.failPrompt(key, input.idempotencyKey);
      throw error;
    }
  }

  public async createSession(agentId: string, options?: { title?: string }): Promise<SessionDescriptor> {
    const payload = await this.invoke(() => this.gateway.request<{
      session?: GatewaySessionRecord;
      key?: string;
    }>('sessions.create', {
      agentId,
      ...(options?.title ? { title: options.title } : {}),
    }));
    const raw = payload?.session ?? (payload?.key
      ? { key: payload.key, title: options?.title }
      : null);
    if (!raw) throw new AdapterError('server', 'sessions.create did not return a session');
    const session = mapOpenClawSession(this.connection.id, raw, agentId);
    void this.refreshSessionsAfterMutation();
    return session;
  }

  public async patchSession(key: string, patch: { title?: string }): Promise<void> {
    if (patch.title === undefined) return;
    await this.invoke(() => this.gateway.patchSession(key, { label: patch.title || null }));
    void this.refreshSessionsAfterMutation();
  }

  public async resetSession(key: string): Promise<void> {
    await this.invoke(() => this.gateway.resetSession(key));
    void this.refreshSessionsAfterMutation();
  }

  public async deleteSession(key: string): Promise<void> {
    await this.invoke(() => this.gateway.deleteSession(key));
    void this.refreshSessionsAfterMutation();
  }

  protected override shouldSuppressConnectError(error: AdapterError): boolean {
    return this.bridgeCapabilityMode === 'unknown'
      && !this.compatibilityFallbackAttempted
      && this.isV2FallbackEligible(error);
  }

  protected override handleGatewayConnectionTransition(state: LegacyConnectionState): void {
    if (state === 'connecting') this.v2HandshakeStarted = false;
    if (state === 'challenging') this.v2HandshakeStarted = true;
  }

  protected override historyCacheAgentId(key: string): string {
    return inferOpenClawAgentId(key);
  }

  private async loadPersistedBridgeCapabilityMode(): Promise<void> {
    if (this.bridgeCapabilityModeLoaded) return;
    if (this.bridgeCapabilityModeLoad) return this.bridgeCapabilityModeLoad;
    this.bridgeCapabilityModeLoad = Promise.resolve(this.loadBridgeCapabilityMode?.())
      .then((mode) => {
        if (mode && this.bridgeCapabilityMode === 'unknown') this.bridgeCapabilityMode = mode;
      })
      .catch(() => {})
      .finally(() => {
        this.bridgeCapabilityModeLoaded = true;
        this.bridgeCapabilityModeLoad = null;
      });
    return this.bridgeCapabilityModeLoad;
  }

  private rememberBridgeCapabilityMode(mode: Exclude<OpenClawBridgeCapabilityMode, 'unknown'>): void {
    if (this.bridgeCapabilityMode === mode) return;
    this.bridgeCapabilityMode = mode;
    void Promise.resolve(this.onBridgeCapabilityMode?.(mode)).catch(() => {});
  }

  private isV2FallbackEligible(error: unknown): boolean {
    if (!this.v2HandshakeStarted) return false;
    const normalized = toAdapterError(error);
    if (normalized.code !== 'server') return false;
    const rawCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    const description = `${rawCode} ${normalized.message}`.toLowerCase();
    return /\bmeta\b/.test(description)
      && /(unknown|unrecognized|unexpected|additional|not allowed|not permitted|unsupported|closed schema|invalid (?:field|property))/.test(description);
  }

  private async refreshSessionsAfterMutation(): Promise<void> {
    try {
      await this.listSessions();
    } catch {
      // The mutation succeeded; a later foreground/list refresh will reconcile.
    }
  }

  private createManagementOperations(): ManagementOperations {
    return {
      models: {
        list: () => this.invoke(() => this.gateway.listModels()),
        getSelection: () => this.invoke(() => this.gateway.getModelSelectionState()),
        setSelection: (params) => this.invoke(() => this.gateway.setModelSelection(params)),
        listThinkingLevels: () => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'],
      },
      skills: {
        status: (agentId) => this.invoke(() => this.gateway.getSkillsStatus(agentId)),
        get: (key, params) => this.invoke(() => this.gateway.getSkillDetail(key, params)),
        update: (key, patch) => this.invoke(() => this.gateway.updateSkill(key, patch)),
        updateContent: (key, content, agentId) => this.invoke(() => (
          this.gateway.updateSkillContent(key, content, agentId)
        )),
        remove: (key, agentId) => this.invoke(() => this.gateway.deleteSkill(key, agentId)),
        discover: (query) => discoverSkills(query),
      },
      cron: {
        list: (params) => this.invoke(() => this.gateway.listCronJobs(params)),
        add: (job) => this.invoke(() => this.gateway.addCronJob(job)),
        update: (id, patch) => this.invoke(() => this.gateway.updateCronJob(id, patch)),
        remove: (id) => this.invoke(() => this.gateway.removeCronJob(id)),
        run: (id, mode) => this.invoke(() => this.gateway.runCronJob(id, mode)),
        runs: (params) => this.invoke(() => this.gateway.listCronRuns(params)),
        heartbeat: {
          get: () => this.readHeartbeatSettings(),
          set: (settings) => this.writeHeartbeatSettings(settings),
        },
      },
      agents: {
        list: () => this.invoke(() => this.gateway.listAgents()),
        create: (input) => this.invoke(() => this.gateway.createAgent(input)),
        update: (id, patch) => this.invoke(() => this.gateway.updateAgent(id, patch)),
        remove: (id, deleteFiles) => this.invoke(() => this.gateway.deleteAgent(id, deleteFiles)),
        files: {
          list: (agentId) => this.invoke(() => this.gateway.listAgentFiles(agentId)),
          get: (name, agentId) => this.invoke(() => this.gateway.getAgentFile(name, agentId)),
          set: (name, content, agentId) => this.invoke(() => (
            this.gateway.setAgentFile(name, content, agentId)
          )),
        },
      },
      usage: {
        sessions: (params) => this.invoke(() => this.gateway.fetchUsage(params)),
        cost: (params) => this.invoke(() => this.gateway.fetchCostSummary(params)),
      },
      config: {
        view: () => this.invoke(() => this.gateway.getConfig()),
        patch: (raw, baseHash) => this.invoke(() => this.gateway.patchConfig(raw, baseHash)),
        set: (raw, baseHash) => this.invoke(() => this.gateway.setConfig(raw, baseHash)),
        permissions: () => this.invoke(() => this.gateway.requestPermissions()),
        repair: () => this.invoke(() => this.gateway.requestDoctorFix()),
        doctor: () => this.invoke(() => this.gateway.requestDoctor()),
        backups: {
          list: () => this.invoke(() => StorageService.listGatewayConfigBackups()),
          create: () => this.createConfigBackup(),
          restore: (id) => this.restoreConfigBackup(id),
        },
      },
      tools: {
        catalog: (agentId) => this.invoke(() => this.gateway.fetchToolsCatalog(agentId)),
        save: (params) => this.saveToolPolicy(params),
      },
      channels: {
        status: (params) => this.invoke(() => this.gateway.getChannelsStatus(params)),
      },
      devices: {
        list: () => this.invoke(() => this.gateway.listDevices()),
        approve: (id) => this.invoke(() => this.gateway.approveDevicePair(id)),
        reject: (id) => this.invoke(() => this.gateway.rejectDevicePair(id)),
        remove: (id) => this.invoke(() => this.gateway.removeDevice(id)),
      },
      nodes: {
        list: () => this.invoke(() => this.gateway.listNodes()),
        rename: (id, name) => this.invoke(() => this.gateway.renameNode(id, name)),
        pairRequests: () => this.invoke(() => this.gateway.listNodePairRequests()),
        approve: (id) => this.invoke(() => this.gateway.approveNodePair(id)),
        reject: (id) => this.invoke(() => this.gateway.rejectNodePair(id)),
      },
      logs: {
        fetch: (params) => this.invoke(() => this.gateway.fetchLogs(params)),
      },
      approvals: {
        resolveExec: (id, decision) => this.invoke(() => (
          this.gateway.resolveExecApproval(id, decision)
        )),
      },
    };
  }

  private async readHeartbeatSettings(): Promise<HeartbeatSettings> {
    const view = await this.invoke(() => this.gateway.getConfig());
    const settings = parseGatewayRuntimeSettings(view.config);
    return {
      every: settings.heartbeatEvery,
      activeStart: settings.heartbeatActiveStart,
      activeEnd: settings.heartbeatActiveEnd,
      activeTimezone: settings.heartbeatActiveTimezone,
      session: settings.heartbeatSession,
      model: settings.heartbeatModel,
    };
  }

  private async writeHeartbeatSettings(settings: HeartbeatSettings): Promise<void> {
    const view = await this.invoke(() => this.gateway.getConfig());
    if (!view.hash) throw new AdapterError('server', 'Gateway config hash is missing');
    const current = parseGatewayRuntimeSettings(view.config);
    const patch = buildGatewayRuntimePatch({
      ...current,
      heartbeatEvery: settings.every,
      heartbeatActiveStart: settings.activeStart,
      heartbeatActiveEnd: settings.activeEnd,
      heartbeatActiveTimezone: settings.activeTimezone,
      heartbeatSession: settings.session,
      heartbeatModel: settings.model,
    });
    const result = await this.invoke(() => this.gateway.patchConfig(JSON.stringify(patch), view.hash!));
    if (!result.ok) throw new AdapterError('server', 'Gateway rejected heartbeat settings');
  }

  private async createConfigBackup(): Promise<{ id: string; createdAt: number }> {
    const view = await this.invoke(() => this.gateway.getConfig());
    if (!view.config) throw new AdapterError('server', 'Gateway config is unavailable');
    return this.invoke(() => StorageService.saveGatewayConfigBackup(view.config!));
  }

  private async restoreConfigBackup(id: string): Promise<void> {
    const backup = await this.invoke(() => StorageService.getGatewayConfigBackup(id));
    if (!backup) throw new AdapterError('server', 'Gateway config backup was not found');
    const view = await this.invoke(() => this.gateway.getConfig());
    if (!view.hash) throw new AdapterError('server', 'Gateway config hash is missing');
    const result = await this.invoke(() => (
      this.gateway.setConfig(JSON.stringify(backup.config), view.hash!)
    ));
    if (!result.ok) throw new AdapterError('server', 'Gateway rejected the config backup');
  }

  private async saveToolPolicy(params: ToolPolicy): Promise<void> {
    const view = await this.invoke(() => this.gateway.getConfig());
    if (!view.hash) throw new AdapterError('server', 'Gateway config hash is missing');
    const patch = {
      agents: {
        list: [{
          id: params.agentId,
          tools: {
            ...(params.profile ? { profile: params.profile } : {}),
            ...(params.allow ? { allow: params.allow } : {}),
            ...(params.alsoAllow ? { alsoAllow: params.alsoAllow } : {}),
            ...(params.deny ? { deny: params.deny } : {}),
          },
        }],
      },
    };
    const result = await this.invoke(() => this.gateway.patchConfig(JSON.stringify(patch), view.hash!));
    if (!result.ok) throw new AdapterError('server', 'Gateway rejected the tool policy');
  }
}

export function mapOpenClawSession(
  connectionId: string,
  session: GatewaySessionRecord,
  fallbackAgentId = 'main',
): SessionDescriptor {
  const agentId = inferOpenClawAgentId(session.key, fallbackAgentId);
  const kind = inferOpenClawSessionKind(session);
  const isMain = kind === 'main';
  const actions = session.allowedActions;
  return {
    connectionId,
    agentId,
    key: session.key,
    kind,
    title: sessionTitle(session),
    channel: session.channel,
    updatedAt: normalizeSessionUpdatedAt(session.updatedAt),
    preview: session.lastMessagePreview,
    model: session.model,
    hasActiveRun: session.hasActiveRun === true,
    attention: session.attention ?? null,
    parentSessionKey: session.parentSessionKey || session.spawnedBy,
    source: session.source,
    allowedActions: {
      rename: actions?.rename ?? true,
      reset: actions?.reset ?? true,
      delete: isMain ? false : (actions?.delete ?? true),
      pin: actions?.pin ?? true,
    },
  };
}

function toOpenClawGatewayConfig(record: ConnectionRecord): GatewayConfig {
  return {
    url: record.url,
    token: record.auth?.token,
    password: record.auth?.password,
    bootstrap: record.bootstrap,
    backendKind: 'openclaw',
    transportKind: record.transportKind as GatewayConfig['transportKind'],
    mode: record.transportKind as GatewayConfig['mode'],
    relay: record.relay,
    debugMode: record.debugMode,
  };
}

async function discoverSkills(query: string): Promise<DiscoverResult> {
  try {
    const items = await searchDiscoverSkills(query);
    return { items, nextCursor: null, hasMore: false };
  } catch (error) {
    throw toAdapterError(error);
  }
}
