import type { AgentAdapter, ConnectionState, SessionUpdate } from './adapter';
import { resolveCapabilities, type Capabilities } from './capabilities';
import type {
  AgentDescriptor,
  ChatMessage,
  ConnectionDescriptor,
  PromptInput,
  SessionDescriptor,
  SessionHistory,
} from './descriptors';
import { AdapterError } from './errors';
import type {
  AgentCreate,
  AgentPatch,
  ConfigView,
  CronJobPatch,
  CronPayload,
  ManagementOperations,
} from './management';

export interface MockTimelineEntry {
  atMs: number;
  update: SessionUpdate;
}

export interface MockAdapterFixture {
  connection: ConnectionDescriptor;
  capabilities?: Partial<Capabilities>;
  agents?: readonly AgentDescriptor[];
  sessions?: readonly SessionDescriptor[];
  histories?: Readonly<Record<string, SessionHistory>>;
  timeline?: readonly MockTimelineEntry[];
  management?: ManagementOperations;
  initialState?: ConnectionState;
  probeResult?: boolean;
}

export interface MockAgentAdapter extends AgentAdapter {
  /** Emit all not-yet-emitted fixture updates at or before `untilMs`. */
  replayTimeline(untilMs?: number): void;
  /** Rewind fixture playback without changing connection or session state. */
  resetTimeline(): void;
}

type MockListenerMap = {
  update: (update: SessionUpdate) => void;
  state: (state: ConnectionState, reason?: string) => void;
  sessions: (sessions: SessionDescriptor[]) => void;
};

function cloneAgent(agent: AgentDescriptor): AgentDescriptor {
  return { ...agent };
}

function cloneSession(session: SessionDescriptor): SessionDescriptor {
  return { ...session, allowedActions: { ...session.allowedActions } };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return { ...message, ...(message.attribution ? { attribution: { ...message.attribution,
    ...(message.attribution.sender ? { sender: { ...message.attribution.sender } } : {}) } } : {}) };
}

function cloneHistory(history: SessionHistory): SessionHistory {
  return { ...history, messages: history.messages.map(cloneMessage),
    ...(history.activeRun ? { activeRun: { ...history.activeRun } } : {}),
  };
}

function emptyConfig(): ConfigView {
  return { config: null, hash: null };
}

function createManagement(
  capabilities: Capabilities,
  provided: ManagementOperations | undefined,
  getAgents: () => AgentDescriptor[],
): ManagementOperations | undefined {
  const models: NonNullable<ManagementOperations['models']> = {
    ...(capabilities.models
      ? {
          list: provided?.models?.list ?? (async () => []),
          getSelection: provided?.models?.getSelection ?? (async () => ({
            currentModel: '',
            currentProvider: '',
            currentBaseUrl: '',
            models: [],
          })),
          setSelection: provided?.models?.setSelection ?? (async () => ({
            ok: true,
            scope: 'global' as const,
            currentModel: '',
            currentProvider: '',
            currentBaseUrl: '',
            models: [],
          })),
        }
      : {}),
    ...(capabilities.thinkingLevels
      ? { listThinkingLevels: provided?.models?.listThinkingLevels ?? (() => []) }
      : {}),
    ...(capabilities.models && capabilities.modelManage
      ? {
          getCatalog: provided?.models?.getCatalog ?? (async () => ({
            defaults: { primary: '', fallbacks: [], thinkingDefault: '' },
            allowlist: null,
            providers: [],
          })),
          saveCatalog: provided?.models?.saveCatalog ?? (async () => undefined),
          addModel: provided?.models?.addModel ?? (async () => undefined),
          inspectDeletion: provided?.models?.inspectDeletion ?? (async () => ({
            canDelete: false,
            blocks: [],
            cleanupCount: 0,
          })),
          deleteModel: provided?.models?.deleteModel ?? (async () => undefined),
          setCost: provided?.models?.setCost ?? (async () => undefined),
        }
      : {}),
  };

  const skills: NonNullable<ManagementOperations['skills']> = {
    ...(capabilities.skills
      ? {
          status: provided?.skills?.status ?? (async () => ({ workspaceDir: '', managedSkillsDir: '', skills: [] })),
          get: provided?.skills?.get ?? (async (key: string) => ({
            skillKey: key,
            name: key,
            path: '',
            content: '',
            linkedFiles: null,
            editable: false,
          })),
          update: provided?.skills?.update ?? (async (key: string) => ({ ok: true, skillKey: key, config: null })),
          updateContent: provided?.skills?.updateContent ?? (async (key: string) => ({
            ok: true,
            skillKey: key,
            path: '',
          })),
          remove: provided?.skills?.remove ?? (async (key: string) => ({ ok: true, skillKey: key })),
        }
      : {}),
    ...(capabilities.skillDiscover
      ? { discover: provided?.skills?.discover ?? (async () => ({ items: [], nextCursor: null, hasMore: false })) }
      : {}),
  };

  const cron: NonNullable<ManagementOperations['cron']> = {
    ...(capabilities.cron
      ? {
          list: provided?.cron?.list ?? (async () => ({
            jobs: [],
            total: 0,
            offset: 0,
            limit: 0,
            hasMore: false,
            nextOffset: null,
          })),
          update: provided?.cron?.update ?? (async (id, patch) => ({
            id,
            name: patch.name ?? '',
            enabled: patch.enabled ?? false,
            createdAtMs: 0,
            updatedAtMs: patch.updatedAtMs ?? 0,
            schedule: patch.schedule ?? { kind: 'every', everyMs: 0 },
            sessionTarget: patch.sessionTarget ?? 'main',
            wakeMode: patch.wakeMode ?? 'now',
            payload: mockCronPayload(patch.payload),
            state: {},
          })),
          remove: provided?.cron?.remove ?? (async () => ({ ok: true })),
          run: provided?.cron?.run ?? (async () => undefined),
          runs: provided?.cron?.runs ?? (async () => ({
            entries: [],
            total: 0,
            offset: 0,
            limit: 0,
            hasMore: false,
            nextOffset: null,
          })),
        }
      : {}),
    ...(capabilities.cronCreate
      ? {
          add: provided?.cron?.add ?? (async (job) => ({
            ...job,
            id: 'mock-cron',
            createdAtMs: 0,
            updatedAtMs: 0,
            state: {},
          })),
        }
      : {}),
    ...(capabilities.heartbeat
      ? {
          heartbeat: provided?.cron?.heartbeat ?? {
            get: async () => ({
              every: '',
              activeStart: '',
              activeEnd: '',
              activeTimezone: '',
              session: '',
              model: '',
            }),
            set: async () => undefined,
          },
        }
      : {}),
  };

  const files: NonNullable<NonNullable<ManagementOperations['agents']>['files']> = {
    ...(capabilities.files
      ? {
          list: provided?.agents?.files?.list ?? (async () => []),
          get: provided?.agents?.files?.get ?? (async (name: string) => ({ name, path: name, missing: true })),
        }
      : {}),
    ...(capabilities.fileEdit
      ? { set: provided?.agents?.files?.set ?? (async () => ({ ok: true })) }
      : {}),
  };

  const agents: NonNullable<ManagementOperations['agents']> = {
    ...(capabilities.agents
      ? {
          list: provided?.agents?.list ?? (async () => ({
            defaultId: 'main',
            mainKey: 'main',
            agents: getAgents().map((agent) => ({
              id: agent.agentId,
              name: agent.name,
              identity: { name: agent.name, emoji: agent.emoji, avatarUrl: agent.avatarUrl },
            })),
          })),
        }
      : {}),
    ...(capabilities.agentCreate
      ? {
          create: provided?.agents?.create ?? (async (input: AgentCreate) => ({
            ok: true,
            agentId: input.name,
            name: input.name,
            workspace: `~/.openclaw/workspace-${input.name}`,
          })),
        }
      : {}),
    ...(capabilities.agentEdit
      ? {
          update: provided?.agents?.update ?? (async (id: string, _patch: AgentPatch) => ({ ok: true, agentId: id })),
          remove: provided?.agents?.remove ?? (async (id: string) => ({ ok: true, agentId: id })),
        }
      : {}),
    ...(Object.keys(files).length > 0 ? { files } : {}),
  };

  const usage: NonNullable<ManagementOperations['usage']> = {
    ...(capabilities.usage
      ? { sessions: provided?.usage?.sessions ?? (async () => ({})) }
      : {}),
    ...(capabilities.cost
      ? { cost: provided?.usage?.cost ?? (async () => ({})) }
      : {}),
  };

  const config: NonNullable<ManagementOperations['config']> = {
    ...(capabilities.configManage
      ? {
          view: provided?.config?.view ?? (async () => emptyConfig()),
          patch: provided?.config?.patch ?? (async () => ({ ok: true })),
          set: provided?.config?.set ?? (async () => ({ ok: true })),
        }
      : {}),
    ...(capabilities.permissions
      ? {
          permissions: provided?.config?.permissions ?? (async () => ({
              configPath: '',
              approvalsPath: '',
              web: {
                status: 'disabled',
                summary: '',
                reasons: [],
                searchEnabled: false,
                searchProvider: 'auto',
                searchConfigured: false,
                fetchEnabled: false,
                firecrawlConfigured: false,
              },
              exec: {
                status: 'disabled',
                summary: '',
                reasons: [],
                currentAgentId: 'main',
                currentAgentName: 'main',
                toolProfile: 'unset',
                execToolAvailable: false,
                hostApprovalsApply: false,
                implicitSandboxFallback: false,
                configuredHost: 'sandbox',
                effectiveHost: 'sandbox',
                sandboxMode: 'off',
                configSecurity: 'deny',
                configAsk: 'on-miss',
                approvalsExists: false,
                approvalsSecurity: 'deny',
                approvalsAsk: 'on-miss',
                effectiveSecurity: 'deny',
                effectiveAsk: 'on-miss',
                allowlistCount: 0,
                toolPolicyDenied: false,
                safeBins: [],
                safeBinTrustedDirs: [],
                trustedDirWarnings: [],
              },
              codeExecution: {
                status: 'disabled',
                summary: '',
                reasons: [],
                inheritsFromExec: true,
              },
            })),
        }
      : {}),
    ...(capabilities.diagnostics
      ? {
          repair: provided?.config?.repair ?? (async () => ({ ok: true, summary: '' })),
          doctor: provided?.config?.doctor ?? (async () => ({ ok: true, checks: [], summary: '' })),
        }
      : {}),
    ...(capabilities.backups
      ? {
          backups: provided?.config?.backups ?? {
              list: async () => [],
              create: async () => ({ id: 'mock-backup', createdAt: 0 }),
              restore: async () => undefined,
          remove: async () => undefined,
            },
        }
      : {}),
  };

  const devices: NonNullable<ManagementOperations['devices']> = {
    ...(capabilities.devices
      ? {
          list: provided?.devices?.list ?? (async () => ({ pending: [], paired: [] })),
          remove: provided?.devices?.remove ?? (async () => undefined),
        }
      : {}),
    ...(capabilities.pairRequests
      ? {
          approve: provided?.devices?.approve ?? (async () => undefined),
          reject: provided?.devices?.reject ?? (async () => undefined),
        }
      : {}),
  };

  const nodes: NonNullable<ManagementOperations['nodes']> = {
    ...(capabilities.nodes
      ? {
          list: provided?.nodes?.list ?? (async () => ({ ts: 0, nodes: [] })),
          rename: provided?.nodes?.rename ?? (async (nodeId: string, displayName: string) => ({
            nodeId,
            displayName,
          })),
        }
      : {}),
    ...(capabilities.pairRequests
      ? {
          pairRequests: provided?.nodes?.pairRequests ?? (async () => ({ pending: [], nodes: [] })),
          approve: provided?.nodes?.approve ?? (async () => undefined),
          reject: provided?.nodes?.reject ?? (async () => undefined),
        }
      : {}),
  };

  const management: ManagementOperations = {
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(Object.keys(skills).length > 0 ? { skills } : {}),
    ...(Object.keys(cron).length > 0 ? { cron } : {}),
    ...(Object.keys(agents).length > 0 ? { agents } : {}),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(capabilities.tools
      ? {
          tools: provided?.tools ?? {
            catalog: async () => ({ agentId: 'main', profiles: [], groups: [] }),
            save: async () => undefined,
          },
        }
      : {}),
    ...(capabilities.channels
      ? {
          channels: {
            status: provided?.channels?.status ?? (async () => ({
              ts: 0,
              channelOrder: [],
              channelLabels: {},
              channelDetailLabels: {},
              channelSystemImages: {},
              channelMeta: [],
              channels: {},
              channelAccounts: {},
              channelDefaultAccountId: {},
            })),
            ...(capabilities.channelManage
              ? {
                  getRouting: provided?.channels?.getRouting ?? (async () => ({ dmScope: 'main' as const })),
                  setRouting: provided?.channels?.setRouting ?? (async () => undefined),
                  setAccountEnabled: provided?.channels?.setAccountEnabled ?? (async () => undefined),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.keys(devices).length > 0 ? { devices } : {}),
    ...(Object.keys(nodes).length > 0 ? { nodes } : {}),
    ...(capabilities.logs
      ? {
          logs: provided?.logs ?? {
            fetch: async () => ({
              file: '',
              cursor: 0,
              size: 0,
              lines: [],
              truncated: false,
              reset: false,
            }),
          },
        }
      : {}),
    ...(capabilities.execApproval
      ? {
          approvals: provided?.approvals ?? {
            resolveExec: async () => undefined,
          },
        }
      : {}),
  };

  return Object.keys(management).length === 0 ? undefined : management;
}

/** Create a deterministic adapter whose data and event stream come from a fixture. */
export function createMockAdapter(fixture: MockAdapterFixture): MockAgentAdapter {
  const capabilities = resolveCapabilities(fixture.connection.backendKind, fixture.capabilities);
  const agents = (fixture.agents ?? []).map(cloneAgent);
  let sessions = (fixture.sessions ?? []).map(cloneSession);
  const histories = new Map(
    Object.entries(fixture.histories ?? {}).map(([key, history]) => [key, cloneHistory(history)]),
  );
  const timeline = [...(fixture.timeline ?? [])].sort((left, right) => left.atMs - right.atMs);
  const listeners: { [K in keyof MockListenerMap]: Set<MockListenerMap[K]> } = {
    update: new Set(),
    state: new Set(),
    sessions: new Set(),
  };
  let state = fixture.initialState ?? 'idle';
  let timelineIndex = 0;
  let sessionSequence = sessions.length;

  const emitState = (next: ConnectionState, reason?: string): void => {
    state = next;
    listeners.state.forEach((listener) => listener(next, reason));
  };
  const emitSessions = (): void => {
    const snapshot = sessions.map(cloneSession);
    listeners.sessions.forEach((listener) => listener(snapshot));
  };
  const emitUpdate = (update: SessionUpdate): void => {
    listeners.update.forEach((listener) => listener(update));
  };
  const addListener = <K extends keyof MockListenerMap>(
    event: K,
    listener: MockListenerMap[K],
  ): (() => void) => {
    listeners[event].add(listener);
    return () => listeners[event].delete(listener);
  };

  const management = createManagement(capabilities, fixture.management, () => agents.map(cloneAgent));

  const adapter: MockAgentAdapter = {
    connection: { ...fixture.connection },
    capabilities,
    get state() {
      return state;
    },
    async connect() {
      emitState('connecting');
      emitState('handshaking');
      emitState('ready');
    },
    disconnect() {
      emitState('idle', 'disconnected');
    },
    async probe() {
      return fixture.probeResult ?? state === 'ready';
    },
    async listAgents() {
      return agents.map(cloneAgent);
    },
    async listSessions(agentId?: string) {
      const selected = agentId === undefined
        ? sessions
        : sessions.filter((session) => session.agentId === agentId);
      return selected.map(cloneSession);
    },
    async loadSession(key: string, options?: { limit?: number; cursor?: string }) {
      const source = histories.get(key) ?? { key, messages: [], hasActiveRun: false };
      const parsedCursor = Number.parseInt(options?.cursor ?? '0', 10);
      const offset = Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
      const limit = Math.max(0, options?.limit ?? source.messages.length);
      const end = Math.min(source.messages.length, offset + limit);
      return {
        key: source.key,
        messages: source.messages.slice(offset, end).map(cloneMessage),
        ...(end < source.messages.length ? { nextCursor: String(end) } : {}),
        hasActiveRun: source.hasActiveRun,
        ...(source.activeRun ? { activeRun: { ...source.activeRun } } : {}),
      };
    },
    async prompt(key: string, input: PromptInput) {
      const runId = `mock:${input.idempotencyKey}`;
      emitUpdate({ type: 'run_started', sessionKey: key, runId });
      return { runId };
    },
    async cancel(key: string, runId?: string) {
      emitUpdate({
        type: 'run_finished',
        sessionKey: key,
        runId: runId ?? 'mock:cancelled',
        stopReason: 'cancelled',
      });
    },
    ...(capabilities.sessionCreate
      ? {
          async createSession(agentId: string, options?: { title?: string }) {
            sessionSequence += 1;
            const session: SessionDescriptor = {
              connectionId: fixture.connection.id,
              agentId,
              key: `mock:${agentId}:${sessionSequence}`,
              kind: 'other',
              title: options?.title ?? `Session ${sessionSequence}`,
              updatedAt: null,
              hasActiveRun: false,
              allowedActions: { rename: true, reset: true, delete: true, pin: true },
            };
            sessions = [...sessions, session];
            emitSessions();
            return cloneSession(session);
          },
        }
      : {}),
    ...(capabilities.sessionRename
      ? {
          async patchSession(key: string, patch: { title?: string }) {
            const index = sessions.findIndex((session) => session.key === key);
            if (index < 0) throw new AdapterError('unsupported', `Unknown mock session: ${key}`);
            const current = sessions[index];
            sessions = sessions.map((session, sessionIndex) => (
              sessionIndex === index
                ? { ...current, ...(patch.title === undefined ? {} : { title: patch.title }) }
                : session
            ));
            emitSessions();
          },
        }
      : {}),
    ...(capabilities.sessionReset
      ? {
          async resetSession(key: string) {
            const session = sessions.find((candidate) => candidate.key === key);
            if (!session) throw new AdapterError('unsupported', `Unknown mock session: ${key}`);
            histories.set(key, { key, messages: [], hasActiveRun: false });
            emitUpdate({ type: 'system_event', sessionKey: key, kind: 'info', text: 'Session reset', timestampMs: 0 });
          },
        }
      : {}),
    ...(capabilities.sessionDelete
      ? {
          async deleteSession(key: string) {
            const next = sessions.filter((session) => session.key !== key);
            if (next.length === sessions.length) {
              throw new AdapterError('unsupported', `Unknown mock session: ${key}`);
            }
            sessions = next;
            histories.delete(key);
            emitSessions();
          },
        }
      : {}),
    ...(management ? { management } : {}),
    on: addListener as AgentAdapter['on'],
    replayTimeline(untilMs = Number.POSITIVE_INFINITY) {
      while (timelineIndex < timeline.length && timeline[timelineIndex].atMs <= untilMs) {
        emitUpdate(timeline[timelineIndex].update);
        timelineIndex += 1;
      }
    },
    resetTimeline() {
      timelineIndex = 0;
    },
  };

  return adapter;
}

/** A patch's `model: null` clears the override; a stored job never carries `null`. */
function mockCronPayload(payload: CronJobPatch['payload']): CronPayload {
  if (!payload) return { kind: 'systemEvent', text: '' };
  if (payload.kind === 'systemEvent') return payload;
  const { model, ...rest } = payload;
  return model ? { ...rest, model } : rest;
}
