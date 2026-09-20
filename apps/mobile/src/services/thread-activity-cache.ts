import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CronRunLogEntry } from '@clawket/agent-protocol';
import type { ThreadRunSeed, ThreadRunStatus } from '../screens/Thread/model';

/**
 * Scoped timeline snapshots: scheduled results and separately stored child-run records.
 *
 * Messages come from the chat cache and paint the first frame; scheduled results
 * used to arrive only after the network round trip and jump into the middle of that
 * frame. Keeping the last successful snapshot beside the message cache lets both
 * hydrate together, and the network refresh only re-renders when something changed.
 * Records are connection/Agent/session scoped and bounded to one thread page.
 */
const THREAD_ACTIVITY_PREFIX = 'clawket.threadActivity.v1.';
const THREAD_ACTIVITY_VERSION = 1;
const MAX_CACHED_RUNS = 100;

export type ThreadActivityScope = Readonly<{
  connectionId: string;
  agentId: string;
  sessionKey: string;
}>;

type StoredThreadActivity = Readonly<{
  version: typeof THREAD_ACTIVITY_VERSION;
  savedAt: number;
  runs: ReadonlyArray<ThreadRunSeed>;
}>;

const RUN_STATUSES: ReadonlySet<ThreadRunStatus> = new Set<ThreadRunStatus>([
  'streaming',
  'tool_calling',
  'completed',
  'succeeded',
  'failed',
  'skipped',
]);

type ActivityKind = 'cron' | 'subagent';

function makeScopeKey(scope: ThreadActivityScope, kind: ActivityKind = 'cron'): string {
  return `${THREAD_ACTIVITY_PREFIX}${scope.connectionId}::${scope.agentId}::${scope.sessionKey}${kind === 'subagent' ? '::subagents' : ''}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeCronRun(value: unknown): CronRunLogEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.jobId !== 'string' || !isValidTimestamp(value.ts) || value.action !== 'finished') return undefined;
  return value as unknown as CronRunLogEntry;
}

function normalizeRun(value: unknown, kind: ActivityKind): ThreadRunSeed | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id);
  const title = optionalString(value.title);
  const status = value.status;
  if (!id || !title || value.kind !== kind) return null;
  if (typeof status !== 'string' || !RUN_STATUSES.has(status as ThreadRunStatus)) return null;
  if (!isValidTimestamp(value.updatedAt)) return null;
  const sessionKey = optionalString(value.sessionKey);
  if (kind === 'subagent' && (!sessionKey || !['completed', 'failed'].includes(status))) return null;
  const jobId = optionalString(value.jobId);
  const agentId = optionalString(value.agentId);
  const summary = optionalString(value.summary)?.slice(0, kind === 'subagent' ? 16_000 : undefined);
  const cronRun = normalizeCronRun(value.cronRun);
  return {
    id,
    kind,
    title,
    status: status as ThreadRunStatus,
    updatedAt: value.updatedAt,
    ...(sessionKey ? { sessionKey } : {}),
    ...(jobId ? { jobId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(summary ? { summary } : {}),
    ...(cronRun ? { cronRun } : {}),
  };
}

/**
 * Validates a stored snapshot. Returns `null` for a missing or unusable record and
 * silently drops individual entries that no longer match the run shape, so a
 * corrupted store can never paint a broken card or throw during hydration.
 */
export function normalizeThreadActivityRuns(value: unknown, kind: ActivityKind = 'cron'): ThreadRunSeed[] | null {
  if (!isRecord(value) || value.version !== THREAD_ACTIVITY_VERSION || !Array.isArray(value.runs)) return null;
  const runs: ThreadRunSeed[] = [];
  const seen = new Set<string>();
  for (const entry of value.runs) {
    const run = normalizeRun(entry, kind);
    if (!run || seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push(run);
    if (runs.length >= MAX_CACHED_RUNS) break;
  }
  return runs;
}

export const ThreadActivityCacheService = {
  async read(scope: ThreadActivityScope, kind: ActivityKind = 'cron'): Promise<ThreadRunSeed[] | null> {
    try {
      const raw = await AsyncStorage.getItem(makeScopeKey(scope, kind));
      if (!raw) return null;
      return normalizeThreadActivityRuns(JSON.parse(raw), kind);
    } catch {
      return null;
    }
  },

  /** Replaces the snapshot; an empty result removes the record instead of storing `[]`. */
  async write(scope: ThreadActivityScope, runs: ReadonlyArray<ThreadRunSeed>, kind: ActivityKind = 'cron'): Promise<void> {
    const key = makeScopeKey(scope, kind);
    if (runs.length === 0) {
      await AsyncStorage.removeItem(key);
      return;
    }
    const record: StoredThreadActivity = {
      version: THREAD_ACTIVITY_VERSION,
      savedAt: Date.now(),
      runs: runs.slice(0, MAX_CACHED_RUNS),
    };
    await AsyncStorage.setItem(key, JSON.stringify(record));
  },

  async clearConnection(connectionId: string): Promise<void> {
    const connectionPrefix = `${THREAD_ACTIVITY_PREFIX}${connectionId}::`;
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(connectionPrefix));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  },

  /** Clears every snapshot; paired with clearing the conversation cache. */
  async clearAll(): Promise<void> {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(THREAD_ACTIVITY_PREFIX));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  },
};
