import type {
  AdapterErrorCode,
  Capabilities,
  ConnectionState as AdapterConnectionState,
  CronJob,
  CronOperations,
  CronRunLogEntry,
} from '@clawket/agent-protocol';
import type { ConnectionState as LegacyConnectionState } from '../../types';
import type { UiMessage } from '../../types/chat';
import { formatThreadTimestamp, localDayNumber, THREAD_TIME_GAP_MS } from './timestamps';

export type ThreadContentState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'reconnecting' }>
  | Readonly<{ kind: 'offline' }>
  | Readonly<{ kind: 'locked' }>
  | Readonly<{
    kind: 'error';
    code: AdapterErrorCode;
    message: string;
    actionLabel?: string;
  }>;

export type ThreadErrorInput = Readonly<{
  code: AdapterErrorCode;
  message: string;
  actionLabel?: string;
}>;

export type ThreadConnectionState = AdapterConnectionState | LegacyConnectionState;

export type ThreadRunStatus =
  | 'streaming'
  | 'tool_calling'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export type ThreadRunCard = Readonly<{
  id: string;
  kind: 'subagent' | 'cron';
  sessionKey?: string;
  jobId?: string;
  agentId?: string;
  title: string;
  status: ThreadRunStatus;
  statusLabel: string;
  timeLabel: string;
  updatedAt: number;
  canOpenLogs?: boolean;
  summary?: string;
}>;

export type ThreadRunSeed = Omit<ThreadRunCard, 'statusLabel' | 'timeLabel' | 'canOpenLogs'>;

export type ThreadTimelineItem =
  | Readonly<{ type: 'tools'; key: string; messages: ReadonlyArray<UiMessage>; timestampMs?: number }>
  | Readonly<{
      type: 'message';
      key: string;
      timestampMs?: number;
      message: UiMessage;
    }>
  | Readonly<{
      type: 'run';
      key: string;
      timestampMs: number;
      run: ThreadRunCard;
    }>
  | Readonly<{
      type: 'date';
      key: string;
      timestampMs: number;
      label: string;
    }>;

function validTimestamp(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
}

function messageTimestamp(message: UiMessage): number | undefined {
  return validTimestamp(message.timestampMs)
    ?? validTimestamp(message.toolFinishedAt)
    ?? validTimestamp(message.toolStartedAt);
}

export function formatThreadLocalTime(timestampMs: number, locale?: string): string {
  const timestamp = validTimestamp(timestampMs);
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(locale || undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function agentIdFromSessionKey(sessionKey: string | null | undefined): string | undefined {
  const match = sessionKey?.match(/^agent:([^:]+):/);
  return match?.[1];
}

function cronJobBelongsToAgent(
  job: CronJob,
  currentAgentId: string,
  isMainAgent: boolean,
): boolean {
  const jobAgentId = job.agentId?.trim();
  if (jobAgentId) return jobAgentId === currentAgentId;
  const sessionAgentId = agentIdFromSessionKey(job.sessionKey);
  if (sessionAgentId) return sessionAgentId === currentAgentId;
  return isMainAgent;
}

function cronRunSessionBelongsToAgent(
  sessionKey: string | undefined,
  currentSessionKey: string,
  currentAgentId: string,
): boolean {
  if (!sessionKey) return true;
  if (sessionKey === currentSessionKey) return true;
  const sessionAgentId = agentIdFromSessionKey(sessionKey);
  return sessionAgentId === undefined || sessionAgentId === currentAgentId;
}

export function buildCronRunSeeds(params: Readonly<{
  entries: ReadonlyArray<CronRunLogEntry>;
  jobs: ReadonlyArray<CronJob>;
  currentSessionKey: string;
  currentAgentId: string;
  isMainAgent: boolean;
  fallbackTitle: string;
}>): ThreadRunSeed[] {
  const jobs = params.jobs.filter((job) => (
    cronJobBelongsToAgent(job, params.currentAgentId, params.isMainAgent)
  ));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const seenJobIds = new Set<string>();
  const seeds: ThreadRunSeed[] = [];
  for (const entry of [...params.entries].sort((left, right) => right.ts - left.ts)) {
    const job = jobsById.get(entry.jobId);
    if (!job || seenJobIds.has(entry.jobId)) continue;
    const updatedAt = validTimestamp(entry.runAtMs) ?? validTimestamp(entry.ts);
    if (updatedAt === undefined) continue;
    const sessionKey = entry.sessionKey?.trim() || job.sessionKey?.trim() || undefined;
    if (!cronRunSessionBelongsToAgent(
      sessionKey,
      params.currentSessionKey,
      params.currentAgentId,
    )) continue;
    const rawTitle = entry.jobName?.trim() || job.name.trim() || params.fallbackTitle;
    const title = rawTitle.replace(/^(?:\[Cron\]|Cron)\s*:?\s*/i, '').trim()
      || params.fallbackTitle;
    const status: ThreadRunStatus = entry.status === 'error'
      ? 'failed'
      : entry.status === 'skipped'
        ? 'skipped'
        : entry.status === 'ok'
          ? 'succeeded'
          : 'completed';
    seeds.push({
      id: `${entry.jobId}:${updatedAt}`,
      kind: 'cron',
      ...(sessionKey ? { sessionKey } : {}),
      jobId: entry.jobId,
      agentId: params.currentAgentId,
      title,
      status,
      summary: entry.error?.trim() || entry.summary?.trim() || undefined,
      updatedAt,
    });
    seenJobIds.add(entry.jobId);
  }
  return seeds;
}

const THREAD_CRON_PAGE_LIMIT = 100;
const THREAD_CRON_MAX_JOB_PAGES = 30;

export async function loadThreadCronRunSeeds(params: Readonly<{
  operations: CronOperations;
  currentSessionKey: string;
  currentAgentId: string;
  isMainAgent: boolean;
  fallbackTitle: string;
}>): Promise<ThreadRunSeed[]> {
  if (!params.operations.list || !params.operations.runs) return [];
  const [firstJobs, runPage] = await Promise.all([
    params.operations.list({
      includeDisabled: true,
      limit: THREAD_CRON_PAGE_LIMIT,
      offset: 0,
      sortBy: 'updatedAtMs',
      sortDir: 'desc',
    }),
    params.operations.runs({
      scope: 'all',
      limit: THREAD_CRON_PAGE_LIMIT,
      offset: 0,
      sortDir: 'desc',
    }),
  ]);
  const jobs = [...firstJobs.jobs];
  let page = firstJobs;
  for (let index = 1; index < THREAD_CRON_MAX_JOB_PAGES; index += 1) {
    if (!page.hasMore || page.nextOffset === null || page.nextOffset <= page.offset) break;
    page = await params.operations.list({
      includeDisabled: true,
      limit: THREAD_CRON_PAGE_LIMIT,
      offset: page.nextOffset,
      sortBy: 'updatedAtMs',
      sortDir: 'desc',
    });
    jobs.push(...page.jobs);
  }
  return buildCronRunSeeds({
    entries: runPage.entries,
    jobs,
    currentSessionKey: params.currentSessionKey,
    currentAgentId: params.currentAgentId,
    isMainAgent: params.isMainAgent,
    fallbackTitle: params.fallbackTitle,
  });
}

export function buildThreadTimelineItems(params: Readonly<{
  messages: ReadonlyArray<UiMessage>;
  runs: ReadonlyArray<ThreadRunCard>;
  locale?: string;
  nowMs?: number;
  yesterdayLabel?: string;
}>): ThreadTimelineItem[] {
  const messageItems = params.messages.map((message) => ({
    timestampMs: messageTimestamp(message),
    item: {
      type: 'message' as const,
      key: `message:${message.renderKey ?? message.id}`,
      timestampMs: messageTimestamp(message),
      message,
    },
  }));
  const runItems = params.runs
    .map((run, order) => ({
      order,
      timestampMs: validTimestamp(run.updatedAt),
      item: {
        type: 'run' as const,
        key: `run:${run.kind}:${run.id}`,
        timestampMs: validTimestamp(run.updatedAt) ?? 0,
        run,
      },
    }))
    .sort((left, right) => {
      if (left.timestampMs !== undefined && right.timestampMs !== undefined) {
        return right.timestampMs - left.timestampMs || left.order - right.order;
      }
      if (left.timestampMs !== undefined) return -1;
      if (right.timestampMs !== undefined) return 1;
      return left.order - right.order;
    });

  const merged: Array<(typeof messageItems)[number] | (typeof runItems)[number]> = [];
  let runIndex = 0;
  for (const message of messageItems) {
    if (message.timestampMs !== undefined) {
      while (
        runIndex < runItems.length
        && runItems[runIndex]!.timestampMs !== undefined
        && runItems[runIndex]!.timestampMs! > message.timestampMs
      ) {
        merged.push(runItems[runIndex]!);
        runIndex += 1;
      }
    }
    merged.push(message);
  }
  merged.push(...runItems.slice(runIndex));

  const timeline: ThreadTimelineItem[] = [];
  let previousTimestamp: number | undefined;
  // Walk oldest-first to compare adjacent timed rows, never elapsed time since
  // the last separator. Preserve source order and ignore untimed/system rows.
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const current = merged[index]!;
    const timestamp = current.item.type === 'message' && current.item.message.role === 'system'
      ? undefined : current.timestampMs;
    if (timestamp !== undefined) {
      if (previousTimestamp === undefined
        || localDayNumber(timestamp) !== localDayNumber(previousTimestamp)
        || timestamp - previousTimestamp >= THREAD_TIME_GAP_MS) {
        timeline.push({
          type: 'date',
          // Server echoes can correct optimistic time without remounting rows.
          key: `date:${current.item.key}`,
          timestampMs: timestamp,
          label: formatThreadTimestamp(timestamp, params.locale, params.nowMs, params.yesterdayLabel),
        });
      }
      previousTimestamp = timestamp;
    }
    timeline.push(current.item);
  }
  timeline.reverse();
  return timeline;
}

export type DeriveThreadContentStateInput = Readonly<{
  locked?: boolean;
  paused?: boolean;
  recovering?: boolean;
  switching?: boolean;
  targetSessionReady?: boolean;
  historyLoaded: boolean;
  hasMessages: boolean;
  connectionState: ThreadConnectionState;
  error?: ThreadErrorInput | null;
}>;

export function deriveThreadContentState({
  locked = false,
  paused = false,
  recovering = false,
  switching = false,
  targetSessionReady = true,
  historyLoaded,
  hasMessages,
  connectionState,
  error,
}: DeriveThreadContentStateInput): ThreadContentState {
  if (locked) return { kind: 'locked' };
  if (paused) return { kind: 'offline' };
  if (recovering) return { kind: 'reconnecting' };
  if (error) return { kind: 'error', ...error };

  const offline = connectionState === 'offline'
    || connectionState === 'error'
    || connectionState === 'closed'
    || connectionState === 'reconnecting';
  if (offline) return { kind: 'offline' };
  // Keep scoped cached messages visible while reconnecting or refreshing history.
  if (hasMessages && !switching && targetSessionReady) return { kind: 'ready' };

  if (
    switching
    || !targetSessionReady
    || !historyLoaded
    || connectionState !== 'ready'
  ) {
    return { kind: 'loading' };
  }
  return hasMessages ? { kind: 'ready' } : { kind: 'empty' };
}

export function resolveContextRemainingPercent(
  contextUsed?: number,
  contextWindow?: number,
): number | null {
  if (
    typeof contextUsed !== 'number'
    || !Number.isFinite(contextUsed)
    || typeof contextWindow !== 'number'
    || !Number.isFinite(contextWindow)
    || contextWindow <= 0
  ) {
    return null;
  }
  const remaining = 1 - (Math.max(0, contextUsed) / contextWindow);
  return Math.round(Math.min(1, Math.max(0, remaining)) * 100);
}

export function resolveThreadHeaderName(
  agentName: string,
  sessionTitle: string | null | undefined,
  isMainSession: boolean,
): string {
  const normalizedTitle = sessionTitle?.trim();
  if (!normalizedTitle || isMainSession || normalizedTitle === agentName.trim()) {
    return agentName;
  }
  return `${agentName} · ${normalizedTitle}`;
}

export type ThreadHeaderSubtitleInput = Readonly<{
  capabilities: Capabilities;
  state: ThreadContentState;
  isRunning: boolean;
  activityLabel?: string | null;
  model?: string | null;
  contextUsed?: number;
  contextWindow?: number;
  offlineLabel: string;
  thinkingLabel: string;
  formatModelContext: (model: string, remainingPercent: number) => string;
}>;

export function resolveThreadHeaderSubtitle({
  capabilities,
  state,
  isRunning,
  activityLabel,
  model,
  contextUsed,
  contextWindow,
  offlineLabel,
  thinkingLabel,
  formatModelContext,
}: ThreadHeaderSubtitleInput): string {
  if (state.kind === 'offline') return offlineLabel;
  if (isRunning) return activityLabel?.trim() || thinkingLabel;
  if (!capabilities.models) return '';

  const normalizedModel = model?.trim() ?? '';
  const remainingPercent = resolveContextRemainingPercent(contextUsed, contextWindow);
  return remainingPercent === null
    ? ''
    : formatModelContext(normalizedModel, remainingPercent);
}

export const THREAD_ERROR_COPY: Readonly<Record<AdapterErrorCode, Readonly<{
  messageKey: string;
  actionKey?: string;
}>>> = {
  bridge_offline: {
    messageKey: 'Bridge is not running on your computer',
    actionKey: 'Help',
  },
  pairing_required: {
    messageKey: 'Pairing required',
    actionKey: 'Pair again',
  },
  gateway_offline: {
    messageKey: 'Agent is not responding',
    actionKey: 'Retry',
  },
  pairing_expired: {
    messageKey: 'Pairing expired, pair again',
    actionKey: 'Pair again',
  },
  unauthorized: {
    messageKey: 'Sign-in expired',
    actionKey: 'Sign in',
  },
  network: {
    messageKey: 'No network',
    actionKey: 'Retry',
  },
  timeout: {
    messageKey: 'Connection timed out',
    actionKey: 'Retry',
  },
  rate_limited: {
    messageKey: 'Too many requests, try again later',
  },
  frame_too_large: {
    messageKey: 'Message too large to send',
  },
  unsupported: {
    messageKey: 'Not supported by this backend',
  },
  server: {
    messageKey: 'Server error',
    actionKey: 'Retry',
  },
};

export function isThreadErrorCode(value: unknown): value is AdapterErrorCode {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(THREAD_ERROR_COPY, value);
}

export function resolveThreadErrorCode(error: unknown): AdapterErrorCode {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'network';
  const code = (error as { code?: unknown }).code;
  return isThreadErrorCode(code) ? code : 'network';
}

export function resolveThreadErrorDetail(error: unknown): string | undefined {
  if (typeof error === 'string') return error.trim() || undefined;
  if (error instanceof Error) return error.message.trim() || undefined;
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() || undefined : undefined;
}

/** Input is newest-first. The oldest call anchors a group while new calls arrive. */
export function groupThreadTools(items: ThreadTimelineItem[], expanded: ReadonlySet<string>): ThreadTimelineItem[] {
  const result: ThreadTimelineItem[] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.type !== 'message' || item.message.role !== 'tool' || item.message.approval || item.message.toolPresentation?.length || item.message.imageUris?.length || item.message.toolStatus === 'error') {
      result.push(item); index += 1; continue;
    }
    const calls: Extract<ThreadTimelineItem, { type: 'message' }>[] = [];
    while (index < items.length) {
      const next = items[index]!;
      if (next.type !== 'message' || next.message.role !== 'tool' || next.message.approval || next.message.toolPresentation?.length || next.message.imageUris?.length || next.message.toolStatus === 'error') break;
      calls.push(next); index += 1;
    }
    if (calls.length < 2) { result.push(...calls); continue; }
    const key = `tools:${calls[calls.length - 1]!.message.id}`;
    // Inverted list: children follow the summary visually, newest first in data.
    if (expanded.has(key)) result.push(...calls);
    result.push({ type: 'tools', key, timestampMs: item.timestampMs, messages: calls.map((call) => call.message) });
  }
  return result;
}

/**
 * Vertical rhythm of a timeline row: the gap it owns toward the older row
 * above it. `stack` keeps one voice's rows together (consecutive tool calls,
 * an activity stack and the reply it produced, repeated bubbles from one
 * speaker), `turn` separates the user's voice from the Agent's, and
 * `section` sets a time label apart from everything before it. The row after
 * a time label owns nothing: the label carries its own gap below.
 */
export type ThreadRowGap = 'none' | 'stack' | 'turn' | 'section';

export type ThreadTimelineRow = ThreadTimelineItem & Readonly<{ gapAbove: ThreadRowGap }>;

type ThreadVoice = 'user' | 'agent' | 'system' | 'date';

function timelineVoice(item: ThreadTimelineItem): ThreadVoice {
  if (item.type === 'date') return 'date';
  if (item.type !== 'message' || item.message.approval) return 'agent';
  if (item.message.role === 'user') return 'user';
  if (item.message.role === 'system') return 'system';
  return 'agent';
}

/** Assigns every row its gap from the visually preceding (older, next in data) row. */
export function withThreadRhythm(items: ReadonlyArray<ThreadTimelineItem>): ThreadTimelineRow[] {
  return items.map((item, index) => {
    const older = items[index + 1];
    let gapAbove: ThreadRowGap;
    if (!older || older.type === 'date') gapAbove = 'none';
    else if (item.type === 'date') gapAbove = 'section';
    else gapAbove = timelineVoice(item) === timelineVoice(older) ? 'stack' : 'turn';
    return { ...item, gapAbove };
  });
}
