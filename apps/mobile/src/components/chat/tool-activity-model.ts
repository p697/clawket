import { isIncomingParticipant } from '../../chat/messageAttribution';
import type { UiMessage } from '../../types/chat';
import { isQuestionTool, resolveToolDetail, toolCategory, unwrapToolCall, type ToolCategory } from '../../utils/tool-display';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Summary categories; the rarer tool kinds read as generic tool use. */
export type ToolActivityKind = 'command' | 'read' | 'edit' | 'search' | 'web' | 'question' | 'other';

export type ToolActivitySummary = Readonly<{
  steps: number;
  /** Most frequent kind first; ties keep the order the Agent used them in. */
  kinds: ReadonlyArray<Readonly<{ kind: ToolActivityKind; count: number }>>;
  /** Wall-clock span of the calls, when the timings are known. */
  durationMs?: number;
}>;

function activityKind(category: ToolCategory): ToolActivityKind {
  return category === 'command' || category === 'read' || category === 'edit' || category === 'search' || category === 'web'
    ? category
    : 'other';
}

function validTime(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * A finished step's own time. OpenClaw reports a duration; the Agent
 * backends' live events carry only the start and finish this phone saw.
 */
export function stepDurationMs(message: UiMessage): number | undefined {
  const duration = message.toolDurationMs;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) return duration;
  const started = validTime(message.toolStartedAt);
  const finished = validTime(message.toolFinishedAt);
  return started !== undefined && finished !== undefined && finished >= started ? finished - started : undefined;
}

/** The tool a message actually ran, with OpenClaw's generic `tool_call` wrapper opened. */
export function effectiveTool(message: UiMessage): { name: string; args?: string } {
  return unwrapToolCall(message.toolName?.trim() ?? '', message.toolArgs);
}

function parseArgs(raw: string | undefined): unknown {
  if (!raw?.trim()) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/**
 * Files a read or edit call touched, so repeated calls on one file count once.
 * Codex file changes carry every path in `changes`; other tools name one path.
 */
export function toolCallFiles(message: UiMessage): string[] {
  const tool = effectiveTool(message);
  const name = tool.name;
  const args = parseArgs(tool.args);
  if (args && typeof args === 'object' && Array.isArray((args as { changes?: unknown }).changes)) {
    const paths = ((args as { changes: unknown[] }).changes)
      .map((change) => (change && typeof change === 'object' ? (change as { path?: unknown }).path : undefined))
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0);
    if (paths.length > 0) return paths;
  }
  const detail = resolveToolDetail(name, tool.args);
  return detail ? [detail] : [];
}

/**
 * The wall-clock span from the first call's start to the last call's finish.
 * Missing timings fall back to the sum of the known durations, and an
 * unknown or sub-second span stays absent rather than reading "0 s".
 */
export function toolActivityDuration(messages: ReadonlyArray<UiMessage>): number | undefined {
  let start: number | undefined;
  let end: number | undefined;
  let summed = 0;
  let allTimed = messages.length > 0;
  for (const message of messages) {
    const started = validTime(message.toolStartedAt);
    const duration = typeof message.toolDurationMs === 'number' && Number.isFinite(message.toolDurationMs) && message.toolDurationMs >= 0
      ? message.toolDurationMs : undefined;
    const finished = validTime(message.toolFinishedAt) ?? (started !== undefined && duration !== undefined ? started + duration : undefined);
    if (started !== undefined) start = start === undefined ? started : Math.min(start, started);
    if (finished !== undefined) end = end === undefined ? finished : Math.max(end, finished);
    if (duration === undefined) allTimed = false;
    else summed += duration;
  }
  const span = start !== undefined && end !== undefined && end >= start ? end - start : allTimed ? summed : undefined;
  return span !== undefined && span >= 1000 ? span : undefined;
}

/** Counts what a run of tool calls did. Input may be in any order; kinds tie-break oldest-first. */
export function summarizeToolActivity(messages: ReadonlyArray<UiMessage>): ToolActivitySummary {
  const ordered = [...messages].sort((left, right) => (
    (validTime(left.toolStartedAt) ?? validTime(left.timestampMs) ?? 0) - (validTime(right.toolStartedAt) ?? validTime(right.timestampMs) ?? 0)
  ));
  const counts = new Map<ToolActivityKind, { count: number; files: Set<string>; order: number }>();
  ordered.forEach((message, index) => {
    const name = effectiveTool(message).name;
    const kind = isQuestionTool(name) ? 'question' : activityKind(toolCategory(name));
    const entry = counts.get(kind) ?? { count: 0, files: new Set<string>(), order: index };
    entry.count += 1;
    if (kind === 'read' || kind === 'edit') toolCallFiles(message).forEach((file) => entry.files.add(file));
    counts.set(kind, entry);
  });
  const kinds = [...counts.entries()]
    .map(([kind, entry]) => ({ kind, count: entry.files.size > 0 ? entry.files.size : entry.count, order: entry.order }))
    .sort((left, right) => right.count - left.count || left.order - right.order)
    .map(({ kind, count }) => ({ kind, count }));
  return { steps: messages.length, kinds, durationMs: toolActivityDuration(messages) };
}

const KIND_COPY: Record<ToolActivityKind, readonly [one: string, many: string]> = {
  command: ['Ran a command', 'Ran {{count}} commands'],
  read: ['Read a file', 'Read {{count}} files'],
  edit: ['Edited a file', 'Edited {{count}} files'],
  search: ['Searched once', 'Searched {{count}} times'],
  web: ['Opened a page', 'Opened {{count}} pages'],
  question: ['Asked you a question', 'Asked you {{count}} questions'],
  other: ['Used a tool', 'Used {{count}} tools'],
};

function kindPhrase(kind: ToolActivityKind, count: number, t: Translate): string {
  const [one, many] = KIND_COPY[kind];
  return count === 1 ? t(one, { ns: 'chat' }) : t(many, { ns: 'chat', count });
}

/** "38 s", "2 min 40 s", "1 h 5 min": the activity pill's compact elapsed time. */
export function formatActivityDuration(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t('{{count}} s', { ns: 'chat', count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('{{minutes}} min {{seconds}} s', { ns: 'chat', minutes, seconds: seconds % 60 });
  return t('{{hours}} h {{minutes}} min', { ns: 'chat', hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/**
 * One line for a finished run of tool calls, verb first as a person would say
 * it: "Ran 6 commands, read a file · 38 s". Two kinds at most; a busier run
 * reads as its total step count instead.
 */
export function formatToolActivitySummary(summary: ToolActivitySummary, t: Translate): string {
  const phrase = summary.kinds.length === 0 ? kindPhrase('other', summary.steps, t)
    : summary.kinds.length === 1 ? kindPhrase(summary.kinds[0]!.kind, summary.kinds[0]!.count, t)
      : summary.kinds.length === 2
        ? t('{{first}}, {{second}}', {
          ns: 'chat',
          first: kindPhrase(summary.kinds[0]!.kind, summary.kinds[0]!.count, t),
          second: lowerFirst(kindPhrase(summary.kinds[1]!.kind, summary.kinds[1]!.count, t)),
        })
        : kindPhrase('other', summary.steps, t);
  return summary.durationMs !== undefined ? `${phrase} · ${formatActivityDuration(summary.durationMs, t)}` : phrase;
}

/**
 * A finished turn's receipt (tool process design C, owner decision
 * 2026-10-02): what changed first — edited files lead whenever the turn
 * edited any — then the step count when other kinds of steps ran too, then
 * the time: "Edited a file · 6 steps · 2 min 40 s".
 */
export function formatTurnReceipt(steps: ReadonlyArray<UiMessage>, t: Translate): string {
  const summary = summarizeToolActivity(steps);
  const lead = summary.kinds.find((entry) => entry.kind === 'edit') ?? summary.kinds[0]
    ?? { kind: 'other' as const, count: summary.steps };
  const parts = [kindPhrase(lead.kind, lead.count, t)];
  if (summary.steps > lead.count) {
    parts.push(summary.steps === 1 ? t('1 step', { ns: 'chat' }) : t('{{count}} steps', { ns: 'chat', count: summary.steps }));
  }
  if (summary.durationMs !== undefined) parts.push(formatActivityDuration(summary.durationMs, t));
  return parts.join(' · ');
}

/**
 * One line that says why a step failed: the first output line that names an
 * error, else the last line, clipped. Nothing when the step left no output.
 */
const REASON_LIMIT = 80;

export function failureReason(detail: string | undefined): string | undefined {
  // Progress meters redraw with carriage returns: each redraw is its own line.
  const lines = (detail ?? '').split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const named = [...lines].reverse().find((line) => (
    /error|failed|failure|denied|not found|no such|cannot|can't|could not|couldn't|unable|refused|timed out|permission|错误|失败/i.test(line)
  ));
  const line = (named ?? lines[lines.length - 1]!).replace(/\s+/g, ' ');
  return line.length > REASON_LIMIT ? `${line.slice(0, REASON_LIMIT - 1)}…` : line;
}

/** Joined phrases continue a sentence; scripts without case are unchanged. */
function lowerFirst(value: string): string {
  const first = value.charAt(0);
  return first.toLocaleLowerCase() === first ? value : `${first.toLocaleLowerCase()}${value.slice(1)}`;
}

/** A localized template split around one inline value, so the value can take its own style. */
export type TemplateParts = Readonly<{ before: string; value: string; after: string }>;

export function splitTemplate(template: (placeholder: string) => string, value: string): TemplateParts {
  const placeholder = '\u0000';
  const rendered = template(placeholder);
  const index = rendered.indexOf(placeholder);
  if (index < 0) return { before: rendered, value: '', after: '' };
  return { before: rendered.slice(0, index), value, after: rendered.slice(index + placeholder.length) };
}

const LIVE_COPY: Partial<Record<ToolActivityKind, string>> = {
  command: 'Running {{detail}}',
  read: 'Reading {{detail}}',
  edit: 'Editing {{detail}}',
  search: 'Searching {{detail}}',
  web: 'Opening {{detail}}',
};

/** Longest inline detail inside a pill; the rest ellipsizes with the pill. */
const PILL_DETAIL_LIMIT = 48;

function clip(value: string): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > PILL_DETAIL_LIMIT ? `${single.slice(0, PILL_DETAIL_LIMIT - 1)}…` : single;
}

/** The step a live pill names: its verb, and the command, path or query it acts on (null when unknown). */
export function describeLiveStep(message: UiMessage, t: Translate): TemplateParts | null {
  const { name, args } = effectiveTool(message);
  const detail = resolveToolDetail(name, args);
  const template = LIVE_COPY[activityKind(toolCategory(name))];
  if (!template || !detail) return null;
  return splitTemplate((placeholder) => t(template, { ns: 'chat', detail: placeholder }), clip(detail));
}

/** A failed step's pill: what failed, with its command or path styled as code when known. */
export function describeFailedStep(message: UiMessage, fallbackName: string, t: Translate): TemplateParts & { code: boolean } {
  const { name, args } = effectiveTool(message);
  const detail = resolveToolDetail(name, args);
  const parts = splitTemplate((placeholder) => t('{{detail}} failed', { ns: 'chat', detail: placeholder }), clip(detail ?? fallbackName));
  return { ...parts, code: Boolean(detail) };
}

function renderKeyOf(message: UiMessage): string {
  return message.renderKey ?? message.id;
}

/** A prompt the Agent received; a queued or sending draft has not started a turn yet. */
function isOwnPrompt(message: UiMessage): boolean {
  return message.role === 'user' && !isIncomingParticipant(message) && message.delivery === undefined;
}

/**
 * Every tool call in the turn around `anchorKey` (a message render key),
 * oldest first: the calls between the user's prompt before it and the next
 * prompt after it. Approvals are not steps. `messages` is newest-first, as the
 * controller keeps them. An unknown anchor yields nothing.
 */
export function collectTurnToolSteps(messages: ReadonlyArray<UiMessage>, anchorKey: string): UiMessage[] {
  const anchor = messages.findIndex((message) => renderKeyOf(message) === anchorKey);
  if (anchor < 0) return [];
  let newest = anchor;
  while (newest > 0 && !isOwnPrompt(messages[newest - 1]!)) newest -= 1;
  let oldest = anchor;
  while (oldest < messages.length - 1 && !isOwnPrompt(messages[oldest + 1]!)) oldest += 1;
  const steps: UiMessage[] = [];
  for (let index = oldest; index >= newest; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'tool' && !message.approval) steps.push(message);
  }
  return steps;
}
