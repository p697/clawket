import {
  getGatewayBackendDescriptor,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type SessionDescriptor,
  type SessionKind,
} from '@clawket/agent-protocol';
import {
  StorageService,
  type DashboardCacheEntry,
} from '../../services/storage';
import {
  summarizeSessionSignals,
  type SessionWatermarks,
} from './unread-watermarks';

export type RosterAgentSubtitle = Readonly<{
  kind: 'backend';
  label: string;
}>;

const ROSTER_CACHE_VERSION = 1;
const ROSTER_SCOPE_PREFIX = 'connection-registry:roster-cache:v1:';
const SESSION_KINDS = new Set<SessionKind>([
  'main',
  'channel',
  'direct',
  'group',
  'subagent',
  'cron',
  'other',
]);
const ATTENTION_KINDS = new Set<NonNullable<SessionDescriptor['attention']>>([
  'approval',
  'error',
  'cron_failed',
]);

type PersistedRoster = {
  version: typeof ROSTER_CACHE_VERSION;
  connectionId: string;
  deleted?: true;
  agents: AgentDescriptor[];
  sessions: SessionDescriptor[];
};

export type RosterCacheSnapshot = Readonly<{
  connectionId: string;
  savedAt: number;
  connectionStateAtSave: string;
  agents: ReadonlyArray<AgentDescriptor>;
  sessions: ReadonlyArray<SessionDescriptor>;
}>;

export type RosterSnapshotInput = Readonly<{
  connection: ConnectionDescriptor;
  agents: ReadonlyArray<AgentDescriptor>;
  sessions: ReadonlyArray<SessionDescriptor>;
  source: 'live' | 'cache';
  syncedAt: number;
  watermarks?: SessionWatermarks;
}>;

export type RosterAgentSummary = Readonly<{
  agent: AgentDescriptor;
  sessions: ReadonlyArray<SessionDescriptor>;
  subtitle?: RosterAgentSubtitle;
  preview?: string;
  updatedAt: number | null;
  lastActivityAt: number | null;
  unreadCount: number;
  hasUnread: boolean;
  attentionCount: number;
  attention: SessionDescriptor['attention'];
}>;

export type RosterConnectionGroup = Readonly<{
  connection: ConnectionDescriptor;
  source: 'live' | 'cache';
  syncedAt: number;
  agents: ReadonlyArray<RosterAgentSummary>;
  unreadCount: number;
  attentionCount: number;
  lastActivityAt: number | null;
}>;

export interface RosterCacheStorage {
  getDashboardCache<T>(scopeKey: string): Promise<DashboardCacheEntry<T> | null>;
  setDashboardCache<T>(scopeKey: string, entry: DashboardCacheEntry<T>): Promise<void>;
}

export interface RosterCacheOptions {
  storage?: RosterCacheStorage;
  now?: () => number;
}

function rosterScope(connectionId: string): string {
  return `${ROSTER_SCOPE_PREFIX}${encodeURIComponent(connectionId)}`;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeAgent(value: unknown, connectionId: string): AgentDescriptor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const agentId = readString(record.agentId);
  const name = readString(record.name);
  const mainSessionKey = readString(record.mainSessionKey);
  if (record.connectionId !== connectionId || !agentId || !name || !mainSessionKey || typeof record.isMain !== 'boolean') {
    return null;
  }
  const emoji = readString(record.emoji);
  const avatarUrl = readString(record.avatarUrl);
  return {
    connectionId,
    agentId,
    name,
    ...(emoji ? { emoji } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    isMain: record.isMain,
    mainSessionKey,
  };
}

function normalizeSession(value: unknown, connectionId: string): SessionDescriptor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const agentId = readString(record.agentId);
  const key = readString(record.key);
  const title = readString(record.title);
  const updatedAt = record.updatedAt === null
    ? null
    : typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : undefined;
  const actions = record.allowedActions;
  if (
    record.connectionId !== connectionId
    || !agentId
    || !key
    || !title
    || !SESSION_KINDS.has(record.kind as SessionKind)
    || updatedAt === undefined
    || typeof record.hasActiveRun !== 'boolean'
    || !actions
    || typeof actions !== 'object'
    || Array.isArray(actions)
  ) {
    return null;
  }
  const allowedActions = actions as Record<string, unknown>;
  if (
    typeof allowedActions.rename !== 'boolean'
    || typeof allowedActions.reset !== 'boolean'
    || typeof allowedActions.delete !== 'boolean'
    || typeof allowedActions.pin !== 'boolean'
  ) {
    return null;
  }
  const attention = record.attention === null || record.attention === undefined
    ? null
    : ATTENTION_KINDS.has(record.attention as NonNullable<SessionDescriptor['attention']>)
      ? record.attention as NonNullable<SessionDescriptor['attention']>
      : undefined;
  if (attention === undefined) return null;
  const channel = readString(record.channel);
  const preview = readString(record.preview);
  const model = readString(record.model);
  const parentSessionKey = readString(record.parentSessionKey);
  const source = record.source === 'bridge' || record.source === 'native'
    ? record.source
    : undefined;
  return {
    connectionId,
    agentId,
    key,
    kind: record.kind as SessionKind,
    title,
    ...(channel ? { channel } : {}),
    updatedAt,
    ...(preview ? { preview } : {}),
    ...(model ? { model } : {}),
    hasActiveRun: record.hasActiveRun,
    attention,
    ...(parentSessionKey ? { parentSessionKey } : {}),
    ...(source ? { source } : {}),
    allowedActions: {
      rename: allowedActions.rename,
      reset: allowedActions.reset,
      delete: allowedActions.delete,
      pin: allowedActions.pin,
    },
  };
}

function normalizePersistedRoster(value: unknown, connectionId: string): PersistedRoster | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PersistedRoster>;
  if (
    record.version !== ROSTER_CACHE_VERSION
    || record.connectionId !== connectionId
    || record.deleted === true
    || !Array.isArray(record.agents)
    || !Array.isArray(record.sessions)
  ) {
    return null;
  }
  const agents = record.agents.map((agent) => normalizeAgent(agent, connectionId));
  const sessions = record.sessions.map((session) => normalizeSession(session, connectionId));
  if (agents.some((agent) => agent === null) || sessions.some((session) => session === null)) {
    return null;
  }
  const agentIds = new Set((agents as AgentDescriptor[]).map((agent) => agent.agentId));
  const sessionKeys = new Set((sessions as SessionDescriptor[]).map((session) => session.key));
  if (agentIds.size !== agents.length || sessionKeys.size !== sessions.length) return null;
  return {
    version: ROSTER_CACHE_VERSION,
    connectionId,
    agents: agents as AgentDescriptor[],
    sessions: sessions as SessionDescriptor[],
  };
}

function activityValue(value: number | null): number {
  return value ?? Number.NEGATIVE_INFINITY;
}

function compareAgentSummaries(a: RosterAgentSummary, b: RosterAgentSummary): number {
  return Number(b.attentionCount > 0) - Number(a.attentionCount > 0)
    || Number(b.hasUnread) - Number(a.hasUnread)
    || activityValue(b.lastActivityAt) - activityValue(a.lastActivityAt)
    || a.agent.name.localeCompare(b.agent.name)
    || a.agent.agentId.localeCompare(b.agent.agentId);
}

function compareConnectionGroups(a: RosterConnectionGroup, b: RosterConnectionGroup): number {
  return Number(b.attentionCount > 0) - Number(a.attentionCount > 0)
    || Number(b.unreadCount > 0) - Number(a.unreadCount > 0)
    || activityValue(b.lastActivityAt) - activityValue(a.lastActivityAt)
    || a.connection.createdAt - b.connection.createdAt
    || a.connection.id.localeCompare(b.connection.id);
}

function resolveRosterAgentSubtitle(
  connection: ConnectionDescriptor,
): RosterAgentSubtitle | undefined {
  if (connection.backendKind !== 'youmind') return undefined;
  return Object.freeze({
    kind: 'backend',
    label: getGatewayBackendDescriptor(connection.backendKind).label,
  });
}

function buildAgentSummary(
  agent: AgentDescriptor,
  sessions: ReadonlyArray<SessionDescriptor>,
  watermarks: SessionWatermarks,
  liveSignalsEnabled: boolean,
  subtitle: RosterAgentSubtitle | undefined,
): RosterAgentSummary {
  const agentSessions = sessions.filter((session) => (
    session.connectionId === agent.connectionId && session.agentId === agent.agentId
  ));
  const signals = summarizeSessionSignals(agentSessions, watermarks, {
    unreadEnabled: liveSignalsEnabled,
  });
  const recentSession = [...agentSessions].sort(
    (a, b) => activityValue(b.updatedAt) - activityValue(a.updatedAt) || a.key.localeCompare(b.key),
  )[0];
  const mainSession = agentSessions.find((session) => session.key === agent.mainSessionKey) ?? recentSession;
  return Object.freeze({
    agent,
    sessions: Object.freeze(agentSessions),
    ...(subtitle ? { subtitle } : {}),
    ...(mainSession?.preview ? { preview: mainSession.preview } : {}),
    updatedAt: mainSession?.updatedAt ?? null,
    lastActivityAt: signals.lastActivityAt,
    unreadCount: signals.unreadCount,
    hasUnread: signals.unreadCount > 0,
    attentionCount: liveSignalsEnabled ? signals.attentionCount : 0,
    attention: liveSignalsEnabled ? signals.attention : null,
  });
}

export function aggregateRoster(
  inputs: ReadonlyArray<RosterSnapshotInput>,
  activeConnectionId: string | null,
): ReadonlyArray<RosterConnectionGroup> {
  const groups = inputs.map((input): RosterConnectionGroup => {
    const liveSignalsEnabled = input.source === 'live'
      && input.connection.id === activeConnectionId;
    const subtitle = resolveRosterAgentSubtitle(input.connection);
    const watermarks = input.watermarks ?? {};
    const agents = input.agents
      .filter((agent) => agent.connectionId === input.connection.id)
      .map((agent) => buildAgentSummary(
        agent,
        input.sessions,
        watermarks,
        liveSignalsEnabled,
        subtitle,
      ))
      .sort(compareAgentSummaries);
    const unreadCount = agents.reduce((total, agent) => total + agent.unreadCount, 0);
    const attentionCount = agents.reduce((total, agent) => total + agent.attentionCount, 0);
    const lastActivityAt = agents.reduce<number | null>(
      (latest, agent) => latest === null || activityValue(agent.lastActivityAt) > latest
        ? agent.lastActivityAt
        : latest,
      null,
    );
    return Object.freeze({
      connection: input.connection,
      source: input.source,
      syncedAt: input.syncedAt,
      agents: Object.freeze(agents),
      unreadCount,
      attentionCount,
      lastActivityAt,
    });
  });
  return Object.freeze(groups.sort(compareConnectionGroups));
}

export function flattenRoster(
  groups: ReadonlyArray<RosterConnectionGroup>,
): ReadonlyArray<RosterAgentSummary> {
  return Object.freeze(groups.flatMap((group) => group.agents));
}

export class RosterCache {
  private readonly storage: RosterCacheStorage;
  private readonly now: () => number;
  private operation: Promise<void> = Promise.resolve();

  constructor(options: RosterCacheOptions = {}) {
    this.storage = options.storage ?? StorageService;
    this.now = options.now ?? Date.now;
  }

  async set(
    connectionId: string,
    agents: ReadonlyArray<AgentDescriptor>,
    sessions: ReadonlyArray<SessionDescriptor>,
    connectionStateAtSave = 'ready',
  ): Promise<RosterCacheSnapshot> {
    return this.enqueue(async () => {
      const normalizedConnectionId = connectionId.trim();
      if (!normalizedConnectionId) throw new Error('Connection id is required.');
      const payload = normalizePersistedRoster({
        version: ROSTER_CACHE_VERSION,
        connectionId: normalizedConnectionId,
        agents,
        sessions,
      }, normalizedConnectionId);
      if (!payload) throw new Error('Roster cache contains invalid or cross-connection descriptors.');
      const scope = rosterScope(normalizedConnectionId);
      const savedAt = this.now();
      await this.storage.setDashboardCache(scope, {
        version: 2,
        cacheKey: scope,
        savedAt,
        source: 'network',
        connectionStateAtSave,
        data: payload,
      });
      return Object.freeze({
        connectionId: normalizedConnectionId,
        savedAt,
        connectionStateAtSave,
        agents: Object.freeze(payload.agents),
        sessions: Object.freeze(payload.sessions),
      });
    });
  }

  async get(connectionId: string): Promise<RosterCacheSnapshot | null> {
    return this.enqueue(async () => {
      const normalizedConnectionId = connectionId.trim();
      if (!normalizedConnectionId) return null;
      const entry = await this.storage.getDashboardCache<PersistedRoster>(rosterScope(normalizedConnectionId));
      const payload = normalizePersistedRoster(entry?.data, normalizedConnectionId);
      if (!entry || !payload) return null;
      return Object.freeze({
        connectionId: normalizedConnectionId,
        savedAt: entry.savedAt,
        connectionStateAtSave: entry.connectionStateAtSave,
        agents: Object.freeze(payload.agents),
        sessions: Object.freeze(payload.sessions),
      });
    });
  }

  async getMany(connectionIds: ReadonlyArray<string>): Promise<ReadonlyArray<RosterCacheSnapshot>> {
    const snapshots = await Promise.all(connectionIds.map((connectionId) => this.get(connectionId)));
    return Object.freeze(snapshots.filter((snapshot): snapshot is RosterCacheSnapshot => snapshot !== null));
  }

  async remove(connectionId: string): Promise<void> {
    await this.enqueue(async () => {
      const normalizedConnectionId = connectionId.trim();
      if (!normalizedConnectionId) return;
      const scope = rosterScope(normalizedConnectionId);
      await this.storage.setDashboardCache(scope, {
        version: 2,
        cacheKey: scope,
        savedAt: this.now(),
        source: 'network',
        connectionStateAtSave: 'deleted',
        data: {
          version: ROSTER_CACHE_VERSION,
          connectionId: normalizedConnectionId,
          deleted: true,
          agents: [],
          sessions: [],
        },
      });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operation.then(operation, operation);
    this.operation = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export const rosterCache = new RosterCache();
