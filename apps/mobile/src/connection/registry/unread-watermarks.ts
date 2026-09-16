import { HUMAN_SESSION_KINDS, sessionActivityAt, type SessionDescriptor } from '@clawket/agent-protocol';

import {
  StorageService,
  type DashboardCacheEntry,
} from '../../services/storage';

const WATERMARKS_VERSION = 1;
const WATERMARK_SCOPE_PREFIX = 'connection-registry:unread-watermarks:v1:';

const ATTENTION_PRIORITY: Record<NonNullable<SessionDescriptor['attention']>, number> = {
  approval: 3,
  cron_failed: 2,
  error: 1,
};

type PersistedWatermarks = {
  version: typeof WATERMARKS_VERSION;
  connectionId: string;
  values: Record<string, number>;
};

export type SessionWatermarks = Readonly<Record<string, number>>;

export type SessionSignalSummary = Readonly<{
  unreadCount: number;
  unreadSessionKeys: ReadonlyArray<string>;
  attentionCount: number;
  attentionSessionKeys: ReadonlyArray<string>;
  attention: SessionDescriptor['attention'];
  lastActivityAt: number | null;
}>;

export interface WatermarkCacheStorage {
  getDashboardCache<T>(scopeKey: string): Promise<DashboardCacheEntry<T> | null>;
  setDashboardCache<T>(scopeKey: string, entry: DashboardCacheEntry<T>): Promise<void>;
}

export interface UnreadWatermarksOptions {
  storage?: WatermarkCacheStorage;
  now?: () => number;
}

function watermarkScope(connectionId: string): string {
  return `${WATERMARK_SCOPE_PREFIX}${encodeURIComponent(connectionId)}`;
}

function normalizeWatermarks(value: unknown, connectionId: string): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const persisted = value as Partial<PersistedWatermarks>;
  if (
    persisted.version !== WATERMARKS_VERSION
    || persisted.connectionId !== connectionId
    || !persisted.values
    || typeof persisted.values !== 'object'
    || Array.isArray(persisted.values)
  ) {
    return null;
  }
  const values: Record<string, number> = {};
  for (const [sessionKey, timestamp] of Object.entries(persisted.values)) {
    if (!sessionKey || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
      return null;
    }
    values[sessionKey] = timestamp;
  }
  return values;
}

function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Unread watermark must be a non-negative finite timestamp.');
  }
  return value;
}

export type WatermarkSession = Pick<SessionDescriptor, 'connectionId' | 'key' | 'updatedAt' | 'lastActivityAt'>;

export function isSessionUnread(
  session: SessionDescriptor,
  watermarks: SessionWatermarks,
  enabled = true,
): boolean {
  if (!enabled || !HUMAN_SESSION_KINDS.has(session.kind)) return false;
  const activityAt = sessionActivityAt(session);
  if (activityAt === null) return false;
  return activityAt > (watermarks[session.key] ?? 0);
}

export function summarizeSessionSignals(
  sessions: ReadonlyArray<SessionDescriptor>,
  watermarks: SessionWatermarks,
  options: { unreadEnabled?: boolean } = {},
): SessionSignalSummary {
  const uniqueSessions = new Map<string, SessionDescriptor>();
  for (const session of sessions) uniqueSessions.set(session.key, session);

  const unreadSessionKeys: string[] = [];
  const attentionSessionKeys: string[] = [];
  let attention: SessionDescriptor['attention'] = null;
  let lastActivityAt: number | null = null;

  for (const session of uniqueSessions.values()) {
    if (isSessionUnread(session, watermarks, options.unreadEnabled ?? true)) {
      unreadSessionKeys.push(session.key);
    }
    if (session.attention) {
      attentionSessionKeys.push(session.key);
      if (!attention || ATTENTION_PRIORITY[session.attention] > ATTENTION_PRIORITY[attention]) {
        attention = session.attention;
      }
    }
    // Only sessions a person takes part in count as activity; sub-agent and
    // cron runs are background work and stay out of roster recency.
    const activityAt = HUMAN_SESSION_KINDS.has(session.kind) ? sessionActivityAt(session) : null;
    if (activityAt !== null && (lastActivityAt === null || activityAt > lastActivityAt)) {
      lastActivityAt = activityAt;
    }
  }

  return Object.freeze({
    unreadCount: unreadSessionKeys.length,
    unreadSessionKeys: Object.freeze(unreadSessionKeys),
    attentionCount: attentionSessionKeys.length,
    attentionSessionKeys: Object.freeze(attentionSessionKeys),
    attention,
    lastActivityAt,
  });
}

export class UnreadWatermarks {
  private readonly storage: WatermarkCacheStorage;
  private readonly now: () => number;
  private operation: Promise<void> = Promise.resolve();

  constructor(options: UnreadWatermarksOptions = {}) {
    this.storage = options.storage ?? StorageService;
    this.now = options.now ?? Date.now;
  }

  async get(connectionId: string): Promise<SessionWatermarks> {
    return this.enqueue(async () => Object.freeze(await this.read(connectionId)));
  }

  async markRead(
    connectionId: string,
    sessionKey: string,
    throughUpdatedAt = this.now(),
  ): Promise<SessionWatermarks> {
    const normalizedConnectionId = connectionId.trim();
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedConnectionId || !normalizedSessionKey) {
      throw new Error('Connection id and session key are required.');
    }
    const timestamp = normalizeTimestamp(throughUpdatedAt);
    return this.enqueue(async () => {
      const values = await this.read(normalizedConnectionId);
      values[normalizedSessionKey] = Math.max(values[normalizedSessionKey] ?? 0, timestamp);
      await this.write(normalizedConnectionId, values);
      return Object.freeze({ ...values });
    });
  }

  async markSessionRead(
    session: WatermarkSession,
    throughActivityAt = sessionActivityAt(session) ?? this.now(),
  ): Promise<SessionWatermarks> {
    return this.markRead(session.connectionId, session.key, throughActivityAt);
  }

  async markPromptSucceeded(
    session: WatermarkSession,
    acceptedAt = this.now(),
  ): Promise<SessionWatermarks> {
    return this.markRead(
      session.connectionId,
      session.key,
      Math.max(sessionActivityAt(session) ?? 0, acceptedAt),
    );
  }

  async markOpened(
    session: WatermarkSession,
    openedAt = this.now(),
  ): Promise<SessionWatermarks> {
    return this.markRead(
      session.connectionId,
      session.key,
      Math.max(sessionActivityAt(session) ?? 0, openedAt),
    );
  }

  async markManyRead(
    connectionId: string,
    sessions: ReadonlyArray<WatermarkSession>,
  ): Promise<SessionWatermarks> {
    const normalizedConnectionId = connectionId.trim();
    if (!normalizedConnectionId) throw new Error('Connection id is required.');
    return this.enqueue(async () => {
      const values = await this.read(normalizedConnectionId);
      for (const session of sessions) {
        if (session.connectionId !== normalizedConnectionId || !session.key.trim()) continue;
        const timestamp = sessionActivityAt(session);
        if (timestamp === null) continue;
        values[session.key] = Math.max(values[session.key] ?? 0, timestamp);
      }
      await this.write(normalizedConnectionId, values);
      return Object.freeze({ ...values });
    });
  }

  async clearConnection(connectionId: string): Promise<void> {
    const normalizedConnectionId = connectionId.trim();
    if (!normalizedConnectionId) return;
    await this.enqueue(async () => {
      await this.write(normalizedConnectionId, {});
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operation.then(operation, operation);
    this.operation = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async read(connectionId: string): Promise<Record<string, number>> {
    const entry = await this.storage.getDashboardCache<PersistedWatermarks>(watermarkScope(connectionId));
    return normalizeWatermarks(entry?.data, connectionId) ?? {};
  }

  private async write(connectionId: string, values: Record<string, number>): Promise<void> {
    const scope = watermarkScope(connectionId);
    const savedAt = this.now();
    await this.storage.setDashboardCache(scope, {
      version: 2,
      cacheKey: scope,
      savedAt,
      source: 'network',
      connectionStateAtSave: 'local-watermark',
      data: {
        version: WATERMARKS_VERSION,
        connectionId,
        values,
      },
    });
  }
}

export const unreadWatermarks = new UnreadWatermarks();
