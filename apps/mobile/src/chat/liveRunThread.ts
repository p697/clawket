import { UiMessage } from '../types/chat';
import { isSilentReplyPrefixText, isSilentReplyText } from '../utils/chat-message';

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
      if (!seen.has(toolMessage.id)) transient.push(toolMessage);
    }
  };
  params.streamSegments.forEach((segment, index) => {
    appendToolsUntil(segment.afterToolCount ?? index);
    if (segment.text.trim() && !shouldHideSilentStreamText(segment.text)) {
      transient.push({
        id: segment.id,
        ...(segment.renderKey ? { renderKey: segment.renderKey } : {}),
        role: 'assistant', text: segment.text,
        timestampMs: segment.timestampMs, streaming: true,
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

  return [...dedupedHistory, ...transient].reverse();
}


/** A final payload may contain only the tail, or repeat all earlier text. */
export function finalReplyTail(finalText: string, segments: ReadonlyArray<StreamSegment>, currentTail?: string): string {
  if (currentTail && finalText === currentTail) return finalText;
  let tail = finalText;
  for (const segment of segments) {
    const prefix = segment.text.trim();
    if (!prefix) continue;
    const trimmed = tail.trimStart();
    // Only remove an exact ordered prefix, never a substring or a fuzzy match.
    if (!trimmed.startsWith(prefix)) return finalText;
    tail = trimmed.slice(prefix.length).trimStart();
  }
  return tail;
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
