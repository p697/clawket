import { isIncomingParticipant, messageParticipantKey } from '../../chat/messageAttribution';
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
import { toolCategory, unwrapToolCall } from '../../utils/tool-display';
import { resolveCronRunSessionKey } from '../../connection/adapters/cron-run-content';
import { isSystemOwnedCronJob } from '../AgentSettings/cron-model';
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
  /** Missing/deleted children open their retained result instead of a dead session. */
  sessionAvailable?: boolean;
  jobId?: string;
  agentId?: string;
  title: string;
  status: ThreadRunStatus;
  statusLabel: string;
  timeLabel: string;
  updatedAt: number;
  canOpenLogs?: boolean;
  summary?: string;
  /** The run record behind a Cron card; the execution record sheet reads it. */
  cronRun?: CronRunLogEntry;
  /** The job may be run again from the conversation (system-owned jobs may not, as in the editor). */
  runnable?: boolean;
}>;

export type ThreadRunSeed = Omit<ThreadRunCard, 'statusLabel' | 'timeLabel' | 'canOpenLogs'>;

function runSeedSignature(run: ThreadRunSeed): string {
  return [
    run.id,
    run.kind,
    run.status,
    run.title,
    run.summary ?? '',
    run.updatedAt,
    run.sessionKey ?? '',
    run.jobId ?? '',
    run.agentId ?? '',
    run.runnable ? '1' : '0',
  ].join('\u0001');
}

/**
 * Whether two activity snapshots would render the same cards. A refreshed result
 * that matches the visible one keeps its state identity so the timeline does not
 * rebuild or re-persist for nothing.
 */
export function areThreadRunSeedsEqual(
  left: ReadonlyArray<ThreadRunSeed>,
  right: ReadonlyArray<ThreadRunSeed>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (runSeedSignature(left[index]!) !== runSeedSignature(right[index]!)) return false;
  }
  return true;
}

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
      /** Adjacent scheduled results as one message (A+ chat design); runs are newest-first. */
      type: 'cron';
      key: string;
      timestampMs: number;
      runs: ReadonlyArray<ThreadRunCard>;
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
    // OpenClaw names the hidden per-run session; the transcript lives on the stable job key.
    const sessionKey = resolveCronRunSessionKey(entry.sessionKey) || job.sessionKey?.trim() || undefined;
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
      cronRun: entry,
      runnable: !isSystemOwnedCronJob(job),
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
    // A scheduled result carries its own time inside the digest, so it only
    // starts a new day; the results of one day stay adjacent and merge.
    const scheduled = current.item.type === 'run' && current.item.run.kind === 'cron';
    if (timestamp !== undefined) {
      if (previousTimestamp === undefined
        || localDayNumber(timestamp) !== localDayNumber(previousTimestamp)
        || (!scheduled && timestamp - previousTimestamp >= THREAD_TIME_GAP_MS)) {
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
  /**
   * Local timeline snapshots (scheduled activity beside the message cache) are
   * still being read. The first frame waits for them so cached rows land together.
   */
  hydrating?: boolean;
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
  hydrating = false,
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
  if (hydrating) return { kind: 'loading' };
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

/** Home-relative like a shell prompt, so the header shows the project rather than `/Users/<name>`. */
export function displayProjectPath(path: string): string {
  return path.trim()
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~');
}

/**
 * Title for a copy of a conversation, such as `Fix login (copy)`, kept within every Bridge's
 * title limit by dropping whole characters from the source title. Undefined leaves the Bridge default.
 */
export function copiedSessionTitle(
  title: string | null | undefined,
  format: (title: string) => string,
  maxLength = 200,
): string | undefined {
  const characters = Array.from(title?.trim() ?? '');
  if (characters.length === 0) return undefined;
  let copied = format(characters.join(''));
  while (copied.length > maxLength && characters.length > 1) {
    characters.pop();
    copied = format(`${characters.join('').trimEnd()}…`);
  }
  return copied.length <= maxLength ? copied : undefined;
}

export type ThreadHeaderSubtitleInput = Readonly<{
  state: ThreadContentState;
  isRunning: boolean;
  activityLabel?: string | null;
  offlineLabel: string;
  thinkingLabel: string;
  onlineLabel: string;
}>;

/**
 * The header's line under the Agent's name when no status sentence applies
 * (A+ chat design, owner decision 2026-09-30): "Online" while the Agent can
 * answer. Its model, context left and project live in the model sheet.
 */
export function resolveThreadHeaderSubtitle({
  state,
  isRunning,
  activityLabel,
  offlineLabel,
  thinkingLabel,
  onlineLabel,
}: ThreadHeaderSubtitleInput): string {
  if (state.kind === 'offline') return offlineLabel;
  if (isRunning) return activityLabel?.trim() || thinkingLabel;
  return state.kind === 'ready' || state.kind === 'empty' ? onlineLabel : '';
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function isOwnPrompt(message: UiMessage): boolean {
  return message.role === 'user' && !isIncomingParticipant(message);
}

/** A tool call of the current turn is still running. `messages` is newest-first. */
export function isToolRunningInTurn(messages: ReadonlyArray<UiMessage>): boolean {
  for (const message of messages) {
    if (isOwnPrompt(message)) return false;
    if (message.role === 'tool' && message.toolStatus === 'running' && !message.approval) return true;
  }
  return false;
}

/**
 * The sentence under the Agent's name while it works (A+ chat design, owner
 * decision 2026-09-30): what the running step of this turn does, "Typing…"
 * once the reply streams, else the controller's activity or "Thinking…".
 * Only the current turn counts, so an orphaned call from an earlier turn
 * never speaks for this one. `messages` is newest-first.
 */
export function resolveThreadWorkingStatus({
  messages,
  activityLabel,
  thinkingLabel,
  t,
}: Readonly<{
  messages: ReadonlyArray<UiMessage>;
  activityLabel?: string | null;
  thinkingLabel: string;
  t: Translate;
}>): string {
  let typing = false;
  for (const message of messages) {
    if (isOwnPrompt(message)) break;
    if (message.role === 'tool' && message.toolStatus === 'running' && !message.approval) {
      switch (toolCategory(unwrapToolCall(message.toolName?.trim() ?? '', message.toolArgs).name)) {
        case 'command': return t('Running a command…', { ns: 'chat' });
        case 'read': return t('Reading files…', { ns: 'chat' });
        case 'edit': return t('Editing files…', { ns: 'chat' });
        case 'search': return t('Searching…', { ns: 'chat' });
        case 'web': return t('Browsing the web…', { ns: 'chat' });
        default: return t('Using tools…', { ns: 'chat' });
      }
    }
    if (message.role === 'assistant' && message.streaming === true && message.text.trim()) typing = true;
  }
  if (typing) return t('Typing…', { ns: 'chat' });
  return activityLabel?.trim() || thinkingLabel;
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

/** A tool row that joins its neighbours in one activity pill. */
function isGroupableTool(item: ThreadTimelineItem): item is Extract<ThreadTimelineItem, { type: 'message' }> {
  return item.type === 'message' && item.message.role === 'tool' && !item.message.approval
    && !item.message.toolPresentation?.length && !item.message.imageUris?.length && item.message.toolStatus !== 'error';
}

/**
 * Folds tool activity into pills (A+ chat design, owner decision 2026-09-30):
 * every run of adjacent calls becomes one `tools` row, a failed call or one
 * carrying media stands alone as its own pill, and approvals stay messages.
 * Input is newest-first. The oldest call anchors a group while new calls arrive.
 */
export function groupThreadTools(items: ReadonlyArray<ThreadTimelineItem>): ThreadTimelineItem[] {
  const result: ThreadTimelineItem[] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.type !== 'message' || item.message.role !== 'tool' || item.message.approval) {
      result.push(item); index += 1; continue;
    }
    const calls: Extract<ThreadTimelineItem, { type: 'message' }>[] = [item];
    index += 1;
    if (isGroupableTool(item)) {
      while (index < items.length) {
        const next = items[index]!;
        if (!isGroupableTool(next)) break;
        calls.push(next); index += 1;
      }
    }
    // Keyed like message rows: history can replace a live call's id
    // (`toolcall_` → `toolresult_`, Hermes aliases) while its render identity,
    // and with it the pill, stays put.
    const oldest = calls[calls.length - 1]!.message;
    result.push({
      type: 'tools',
      key: `tools:${oldest.renderKey ?? oldest.id}`,
      timestampMs: item.timestampMs,
      messages: calls.map((call) => call.message),
    });
  }
  return result;
}

/**
 * Merges adjacent scheduled results into one digest message (A+ chat design,
 * owner decision 2026-09-30); a lone result is a digest of one. The oldest
 * run anchors the key so a newer result joins without remounting it.
 * Sub-agent runs keep their own cards. Input is newest-first.
 */
export function groupThreadRuns(items: ReadonlyArray<ThreadTimelineItem>): ThreadTimelineItem[] {
  const result: ThreadTimelineItem[] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.type !== 'run' || item.run.kind !== 'cron') {
      result.push(item); index += 1; continue;
    }
    const runs: ThreadRunCard[] = [];
    while (index < items.length) {
      const next = items[index]!;
      if (next.type !== 'run' || next.run.kind !== 'cron') break;
      runs.push(next.run); index += 1;
    }
    result.push({ type: 'cron', key: `cron:${runs[runs.length - 1]!.id}`, timestampMs: item.timestampMs, runs });
  }
  return result;
}

/**
 * Vertical rhythm of a timeline row: the gap it owns toward the older row
 * above it. `joined` keeps consecutive bubbles from one speaker together as
 * one Telegram-style group; `stack` keeps other rows of one voice close (an
 * activity pill and the reply it produced); `turn` separates the user's voice
 * from the Agent's and sets service pills apart; `section` sets a time label
 * apart from everything before it. The row after a time label owns nothing:
 * the label carries its own gap below.
 */
export type ThreadRowGap = 'none' | 'joined' | 'stack' | 'turn' | 'section';

export type ThreadTimelineRow = ThreadTimelineItem & Readonly<{
  gapAbove: ThreadRowGap;
  /** The older row is a bubble from the same speaker: the bubble joins it. */
  joinsOlder: boolean;
  /** The newer row is a bubble from the same speaker: the tail waits for it. */
  joinsNewer: boolean;
}>;

type ThreadVoice = string;

function timelineVoice(item: ThreadTimelineItem): ThreadVoice {
  if (item.type === 'date') return 'date';
  if (item.type !== 'message' || item.message.approval) return 'agent';
  if (isIncomingParticipant(item.message) && item.message.attribution) {
    const attribution = item.message.attribution;
    return attribution.sender?.id ? `participant:${messageParticipantKey(attribution)}` : `unknown:${item.message.id}`;
  }
  if (item.message.role === 'user') return 'user';
  if (item.message.role === 'system') return 'system';
  return 'agent';
}

/**
 * A row that draws a message bubble, so neighbours from its speaker can join it.
 * A reply with no words yet is the live pill: the bubble above keeps its tail
 * while the pill comes and goes around tool steps.
 */
function isBubbleRow(item: ThreadTimelineItem | undefined): boolean {
  return item?.type === 'message' && !item.message.approval
    && (item.message.role === 'user' || item.message.role === 'assistant')
    && !(item.message.streaming === true && !item.message.text.trim());
}

function joins(item: ThreadTimelineItem, neighbour: ThreadTimelineItem | undefined): boolean {
  return isBubbleRow(item) && isBubbleRow(neighbour) && timelineVoice(item) === timelineVoice(neighbour!);
}

/** Assigns every row its gap from the visually preceding (older, next in data) row and its bubble joins. */
export function withThreadRhythm(items: ReadonlyArray<ThreadTimelineItem>): ThreadTimelineRow[] {
  return items.map((item, index) => {
    const older = items[index + 1];
    const newer = index > 0 ? items[index - 1] : undefined;
    const joinsOlder = joins(item, older);
    let gapAbove: ThreadRowGap;
    if (!older || older.type === 'date') gapAbove = 'none';
    else if (item.type === 'date') gapAbove = 'section';
    else if (joinsOlder) gapAbove = 'joined';
    else gapAbove = timelineVoice(item) === timelineVoice(older) ? 'stack' : 'turn';
    return { ...item, gapAbove, joinsOlder, joinsNewer: joins(item, newer) };
  });
}

function hasSameFields(left: object, right: object): boolean {
  if (left === right) return true;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => (
    Object.prototype.hasOwnProperty.call(rightRecord, key) && Object.is(leftRecord[key], rightRecord[key])
  ));
}

function hasSameMessages(left: ReadonlyArray<UiMessage>, right: ReadonlyArray<UiMessage>): boolean {
  return left === right
    || (left.length === right.length && left.every((message, index) => hasSameFields(message, right[index]!)));
}

function reuseThreadRow(previous: ThreadTimelineRow, next: ThreadTimelineRow): ThreadTimelineRow {
  if (previous === next) return previous;
  if (previous.type !== next.type || previous.gapAbove !== next.gapAbove || previous.timestampMs !== next.timestampMs
    || previous.joinsOlder !== next.joinsOlder || previous.joinsNewer !== next.joinsNewer) return next;
  switch (next.type) {
    case 'message':
      return previous.type === 'message' && hasSameFields(previous.message, next.message) ? previous : next;
    case 'tools':
      return previous.type === 'tools' && hasSameMessages(previous.messages, next.messages) ? previous : next;
    case 'run':
      return previous.type === 'run' && previous.run === next.run ? previous : next;
    case 'cron':
      return previous.type === 'cron' && previous.runs.length === next.runs.length
        && previous.runs.every((run, index) => run === next.runs[index]) ? previous : next;
    case 'date':
      return previous.type === 'date' && previous.label === next.label ? previous : next;
  }
}

/**
 * Keeps the previous render's row objects wherever a row would render the same
 * thing. Streaming rebuilds the whole timeline for every chunk; without this,
 * each chunk hands the list a fresh object for every row and re-renders every
 * visible cell instead of only the reply that grew. Returns `previous` itself
 * when no row changed.
 */
export function stabilizeThreadRows(
  previous: ReadonlyArray<ThreadTimelineRow>,
  next: ReadonlyArray<ThreadTimelineRow>,
): ReadonlyArray<ThreadTimelineRow> {
  if (previous === next) return previous;
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  let changed = previous.length !== next.length;
  const rows = next.map((row, index) => {
    const known = previousByKey.get(row.key);
    const stable = known ? reuseThreadRow(known, row) : row;
    if (stable !== previous[index]) changed = true;
    return stable;
  });
  return changed ? rows : previous;
}
