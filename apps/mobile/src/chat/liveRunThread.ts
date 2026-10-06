import { preserveCompletedRunPresentation } from './historyMergePolicy';
import { finalReplyTail } from './streamText';
import { UiMessage } from '../types/chat';
import { isSilentReplyPrefixText, isSilentReplyText } from '../utils/chat-message';
import { isNewUserTurn, originalRunUserIndex } from './turnIdentity';
import { sameLiveToolCall } from './liveToolMessages';

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
export function recoverLiveRunPresentation(text: string, history: UiMessage[], turnId?: string, inputMessageId?: string, inputMessageKey?: string): {
  segments: StreamSegment[]; tools: UiMessage[]; tail: string; tailTimestampMs?: number;
} {
  const original = originalRunUserIndex(history, turnId, inputMessageId, inputMessageKey);
  if (turnId && inputMessageId && original < 0) return { segments: [], tools: [], tail: text };
  const start = original >= 0 ? original : history.findLastIndex(message => message.role === 'user');
  const originalUser = original >= 0 ? { ...history[start]!, turnId } : undefined;
  const segments: StreamSegment[] = [];
  const tools: UiMessage[] = [];
  let tail = text;
  let committedSegments = 0;
  const paragraphClocks: Array<number | undefined> = [];
  for (const message of history.slice(start + 1)) {
    if (original >= 0 && (isNewUserTurn(message, originalUser!) || (message.turnId && message.turnId !== turnId))) break;
    if (message.role === 'tool') {
      committedSegments = segments.length;
      tools.push(message);
    } else if (original >= 0 && message.role === 'user') {
      committedSegments = segments.length;
    } else if (message.role === 'assistant' && message.text.trim()) {
      const prefix = message.text.trim();
      if (!tail.trimStart().startsWith(prefix)) break;
      // A positively anchored native item is itself a paragraph boundary,
      // even when the assistant did no tool work between commentary items.
      if (turnId && original >= 0 && message.turnId === turnId && segments.length > 0) {
        committedSegments = segments.length;
      }
      tail = tail.trimStart().slice(prefix.length).trimStart();
      const clock = finiteTimestamp(message);
      paragraphClocks.push(clock !== undefined && clock > 0 ? clock : undefined);
      segments.push({ id: message.id, renderKey: message.renderKey ?? message.id,
        text: message.text, timestampMs: message.timestampMs ?? Date.now(), afterToolCount: tools.length });
    }
  }
  // The growing paragraph stays in the tail. Tools and proven same-turn
  // guides commit earlier paragraphs without flattening their interleaving.
  const tailTimestampMs = paragraphClocks[committedSegments];
  segments.splice(committedSegments);
  return { segments, tools, tail: finalReplyTail(text, segments), tailTimestampMs };
}

function finiteTimestamp(message: UiMessage): number | undefined {
  return typeof message.timestampMs === 'number' && Number.isFinite(message.timestampMs)
    ? message.timestampMs
    : undefined;
}

/** Refine an exact canonical prefix without losing any live-only boundary. */
export function extendRecoveredLiveRun(
  recovered: ReturnType<typeof recoverLiveRunPresentation>,
  previous: StreamSegment[],
  tools: UiMessage[],
): { segments: StreamSegment[]; tools: UiMessage[]; retainedCount: number } | undefined {
  if (recovered.segments.length <= previous.length) return undefined;
  const toolPositions = tools.map(tool => recovered.tools.findIndex(candidate => sameLiveToolCall(tool, candidate)));
  if (toolPositions.some((position, index) => position < 0 || (index > 0 && position <= toolPositions[index - 1]!))) return undefined;
  const segments: StreamSegment[] = [];
  let cursor = 0;
  for (const old of previous) {
    const start = cursor;
    let remaining = old.text.trim();
    while (remaining && cursor < recovered.segments.length) {
      const part = recovered.segments[cursor]!;
      if (!remaining.startsWith(part.text.trim())) return undefined;
      remaining = remaining.slice(part.text.trim().length).trimStart();
      cursor++;
    }
    if (remaining || cursor === start) return undefined;
    const parts = recovered.segments.slice(start, cursor);
    segments.push(...parts.map((part, index) => parts.length === 1
      ? { ...old, afterToolCount: part.afterToolCount }
      : { ...part, ...(index === 0 ? { renderKey: old.renderKey ?? old.id } : {}) }));
  }
  segments.push(...recovered.segments.slice(cursor));
  return { segments, retainedCount: cursor,
    tools: recovered.tools.map(tool => tools.find(candidate => sameLiveToolCall(tool, candidate)) ?? tool) };
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
  liveMessageTimestampMs?: number | null;
  activeTurnId?: string;
  inputMessageId?: string;
  inputMessageKey?: string;
  nowMs?: number;
  includePlaceholder?: boolean;
}): UiMessage[] {
  if (params.activeRunId && params.activeTurnId && params.inputMessageId
    && !params.streamSegments.length && !params.toolMessages.length && params.liveStreamText) {
    const recovered = recoverLiveRunPresentation(params.liveStreamText, params.historyMessages,
      params.activeTurnId, params.inputMessageId, params.inputMessageKey);
    if (recovered.segments.length) return buildLiveRunListData({ ...params,
      streamSegments: recovered.segments, toolMessages: recovered.tools, liveStreamText: recovered.tail,
      liveMessageTimestampMs: recovered.tailTimestampMs ?? params.liveMessageTimestampMs });
  }
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
        ...(params.activeTurnId ? { turnId: params.activeTurnId } : {}),
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
      ...(params.activeTurnId ? { turnId: params.activeTurnId } : {}),
      ...(params.includePlaceholder && params.activeRunId ? {
        renderKey: liveReplyRenderKey(params.liveStreamStartedAt, params.activeRunId, params.streamSegments.length),
      } : {}),
      role: 'assistant',
      text: hasLiveStream ? params.liveStreamText ?? '' : '',
      streaming: true,
      timestampMs: params.liveMessageTimestampMs ?? params.liveStreamStartedAt ?? undefined,
    });
  }

  if (params.activeRunId && transient.length > 0 && !hasTerminalMessage) {
    // History can catch up during tool execution. Reconcile within this user
    // turn instead of displaying both the transcript and its live projection.
    const original = originalRunUserIndex(dedupedHistory, params.activeTurnId, params.inputMessageId, params.inputMessageKey);
    if (params.activeTurnId && params.inputMessageId && original < 0) {
      // A partial page can begin with a guide. Never treat that row as the
      // original input; retain only independently identified unseen live rows.
      return [...dedupedHistory, ...transient.filter(message => !seen.has(message.id))].reverse();
    }
    const user = original >= 0 ? { ...dedupedHistory[original]!, turnId: params.activeTurnId } : dedupedHistory.findLast(message => message.role === 'user');
    return preserveCompletedRunPresentation([
      ...(user ? [user] : []),
      ...transient.map(message => ({ ...message, ...(params.activeTurnId ? { turnId: params.activeTurnId } : {}), presentationRunId: params.activeRunId! })),
    ], dedupedHistory, { live: true }).reverse();
  }
  return [...dedupedHistory, ...transient.filter(message => !seen.has(message.id))].reverse();
}


/** Commit the same live rows in one state transition; don't rebuild a flat answer. */
export function finishLiveRunPresentation(params: {
  segments: StreamSegment[]; tools: UiMessage[]; tail: string;
  runId: string; startedAt: number | null; turnId?: string; finalMessage?: UiMessage; cancelled?: boolean;
}): UiMessage[] {
  const rows = buildLiveRunListData({
    historyMessages: [], streamSegments: params.segments, toolMessages: params.tools,
    liveStreamText: null, liveStreamStartedAt: params.startedAt, activeRunId: null,
  }).reverse().map(message => ({ ...message, streaming: false, presentationRunId: params.runId, ...(params.turnId ? { turnId: params.turnId } : {}),
    ...(message.role === 'tool' && message.toolStatus === 'running' ? { toolStatus: 'unknown' as const } : {}),
  }));
  if (params.tail.trim() || params.finalMessage?.artifactAttachments?.length || params.finalMessage?.imageUris?.length || params.finalMessage?.fileAttachments?.length) rows.push({
    ...params.finalMessage,
    id: params.finalMessage?.id ?? `${params.cancelled ? 'abort' : 'final'}_${params.runId}`,
    renderKey: liveReplyRenderKey(params.startedAt, params.runId, params.segments.length),
    role: 'assistant', text: params.tail, streaming: false, presentationRunId: params.runId, ...(params.turnId ? { turnId: params.turnId } : {}),
    timestampMs: params.finalMessage?.timestampMs ?? Date.now(),
  });
  return rows;
}
