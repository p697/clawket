import { preserveCompletedRunPresentation } from './historyMergePolicy';
import { finalReplyTail } from './streamText';
import { UiMessage } from '../types/chat';
import { isSilentReplyPrefixText, isSilentReplyText } from '../utils/chat-message';

export { finalReplyTail } from './streamText';

export type StreamSegment = {
  id: string;
  renderKey?: string;
  text: string;
  timestampMs: number;
  /** Number of tool rows already present when this text segment ended. */
  afterToolCount?: number;
};

/** Remains stable when an optimistic run ID is replaced by the server's ID. */
export function liveReplyRenderKey(startedAt: number | null, runId: string, segment: number): string {
  return `reply:${startedAt ?? runId}:${segment}`;
}

/** Recover known text/tool boundaries from the current turn, never earlier turns. */
export function recoverLiveRunPresentation(text: string, history: UiMessage[]): {
  segments: StreamSegment[]; tools: UiMessage[]; tail: string;
} {
  const start = history.findLastIndex(message => message.role === 'user');
  const segments: StreamSegment[] = [];
  const tools: UiMessage[] = [];
  let tail = text;
  for (const message of history.slice(start + 1)) {
    if (message.role === 'tool') {
      tools.push(message);
    } else if (message.role === 'assistant' && message.text.trim()) {
      const prefix = message.text.trim();
      if (!tail.trimStart().startsWith(prefix)) break;
      tail = tail.trimStart().slice(prefix.length).trimStart();
      segments.push({ id: message.id, renderKey: message.renderKey ?? message.id,
        text: message.text, timestampMs: message.timestampMs ?? Date.now(), afterToolCount: tools.length });
    }
  }
  // A transcript can contain the still-growing assistant message. Only tools
  // prove a committed boundary; keep the last message in the live tail.
  while (segments.at(-1)?.afterToolCount === tools.length) segments.pop();
  return { segments, tools, tail: finalReplyTail(text, segments) };
}

function finiteTimestamp(message: UiMessage): number | undefined {
  return typeof message.timestampMs === 'number' && Number.isFinite(message.timestampMs)
    ? message.timestampMs
    : undefined;
}

/** Stable merge for two newest-first streams without reordering untimed live rows. */
export function mergeNewestFirstMessages(
  first: ReadonlyArray<UiMessage>,
  second: ReadonlyArray<UiMessage>,
): UiMessage[] {
  const merged: UiMessage[] = [];
  let firstIndex = 0;
  let secondIndex = 0;
  while (firstIndex < first.length && secondIndex < second.length) {
    const firstMessage = first[firstIndex]!;
    const secondMessage = second[secondIndex]!;
    const firstTimestamp = finiteTimestamp(firstMessage);
    const secondTimestamp = finiteTimestamp(secondMessage);
    if (
      firstTimestamp === undefined
      || (secondTimestamp !== undefined && firstTimestamp >= secondTimestamp)
    ) {
      merged.push(firstMessage);
      firstIndex += 1;
    } else {
      merged.push(secondMessage);
      secondIndex += 1;
    }
  }
  merged.push(...first.slice(firstIndex), ...second.slice(secondIndex));
  return merged;
}

const MIN_LIVE_STREAM_VISIBLE_CHARS = 12;
const MIN_LIVE_STREAM_VISIBLE_DELAY_MS = 250;

function shouldHideSilentStreamText(text: string | null | undefined): boolean {
  return isSilentReplyText(text ?? undefined) || isSilentReplyPrefixText(text ?? undefined);
}

function isTerminalAssistantMessage(message: UiMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  return message.id.startsWith('final_') || message.id.startsWith('abort_');
}

function shouldShowLiveStreamBubble(params: {
  liveStreamText: string | null;
  liveStreamStartedAt: number | null;
  nowMs: number;
}): boolean {
  const trimmed = params.liveStreamText?.trim() ?? '';
  if (!trimmed) return false;
  if (trimmed.length >= MIN_LIVE_STREAM_VISIBLE_CHARS) return true;
  if (!params.liveStreamStartedAt || params.liveStreamStartedAt <= 0) return true;
  return params.nowMs - params.liveStreamStartedAt >= MIN_LIVE_STREAM_VISIBLE_DELAY_MS;
}

export function buildLiveRunListData(params: {
  historyMessages: UiMessage[];
  streamSegments: StreamSegment[];
  toolMessages: UiMessage[];
  liveStreamText: string | null;
  liveStreamStartedAt: number | null;
  activeRunId: string | null;
  nowMs?: number;
  includePlaceholder?: boolean;
}): UiMessage[] {
  const seen = new Set<string>();
  const dedupedHistory: UiMessage[] = [];
  const nowMs = params.nowMs ?? Date.now();

  for (let index = params.historyMessages.length - 1; index >= 0; index--) {
    const message = params.historyMessages[index];
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    dedupedHistory.unshift(message);
  }

  const transient: UiMessage[] = [];
  let toolIndex = 0;
  const appendToolsUntil = (count: number) => {
    while (toolIndex < count && toolIndex < params.toolMessages.length) {
      const toolMessage = params.toolMessages[toolIndex++];
      if (params.activeRunId || !seen.has(toolMessage.id)) transient.push(toolMessage);
    }
  };
  params.streamSegments.forEach((segment, index) => {
    appendToolsUntil(segment.afterToolCount ?? index);
    if (segment.text.trim() && !shouldHideSilentStreamText(segment.text)) {
      transient.push({
        id: segment.id,
        ...(segment.renderKey ? { renderKey: segment.renderKey } : {}),
        role: 'assistant', text: segment.text,
        timestampMs: segment.timestampMs, streaming: false,
      });
    }
  });
  appendToolsUntil(params.toolMessages.length);

  const latestHistoryMessage = dedupedHistory[dedupedHistory.length - 1];
  const hasTerminalMessage = (
    (!!params.activeRunId && dedupedHistory.some((message) => (
      message.id === `final_${params.activeRunId}` || message.id === `abort_${params.activeRunId}`
    )))
    || isTerminalAssistantMessage(latestHistoryMessage)
  );
  const hasLiveStream = shouldShowLiveStreamBubble({
    liveStreamText: params.liveStreamText,
    liveStreamStartedAt: params.liveStreamStartedAt,
    nowMs,
  });
  const showPlaceholder = params.includePlaceholder && Boolean(params.activeRunId);
  if ((hasLiveStream || showPlaceholder) && !hasTerminalMessage && !shouldHideSilentStreamText(params.liveStreamText)) {
    transient.push({
      id: 'streaming',
      ...(params.includePlaceholder && params.activeRunId ? {
        renderKey: liveReplyRenderKey(params.liveStreamStartedAt, params.activeRunId, params.streamSegments.length),
      } : {}),
      role: 'assistant',
      text: hasLiveStream ? params.liveStreamText ?? '' : '',
      streaming: true,
      timestampMs: params.liveStreamStartedAt ?? undefined,
    });
  }

  if (params.activeRunId && transient.length > 0 && !hasTerminalMessage) {
    // History can catch up during tool execution. Reconcile within this user
    // turn instead of displaying both the transcript and its live projection.
    const user = dedupedHistory.findLast(message => message.role === 'user');
    return preserveCompletedRunPresentation([
      ...(user ? [user] : []),
      ...transient.map(message => ({ ...message, presentationRunId: params.activeRunId! })),
    ], dedupedHistory, { live: true }).reverse();
  }
  return [...dedupedHistory, ...transient.filter(message => !seen.has(message.id))].reverse();
}


/** Commit the same live rows in one state transition; don't rebuild a flat answer. */
export function finishLiveRunPresentation(params: {
  segments: StreamSegment[]; tools: UiMessage[]; tail: string;
  runId: string; startedAt: number | null; finalMessage?: UiMessage; cancelled?: boolean;
}): UiMessage[] {
  const rows = buildLiveRunListData({
    historyMessages: [], streamSegments: params.segments, toolMessages: params.tools,
    liveStreamText: null, liveStreamStartedAt: params.startedAt, activeRunId: null,
  }).reverse().map(message => ({ ...message, streaming: false, presentationRunId: params.runId,
    ...(message.role === 'tool' && message.toolStatus === 'running' ? { toolStatus: 'unknown' as const } : {}),
  }));
  if (params.tail.trim()) rows.push({
    ...params.finalMessage,
    id: params.finalMessage?.id ?? `${params.cancelled ? 'abort' : 'final'}_${params.runId}`,
    renderKey: liveReplyRenderKey(params.startedAt, params.runId, params.segments.length),
    role: 'assistant', text: params.tail, streaming: false, presentationRunId: params.runId,
    timestampMs: params.finalMessage?.timestampMs ?? Date.now(),
  });
  return rows;
}
