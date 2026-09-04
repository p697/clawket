import { UiMessage } from '../types/chat';
import { isSilentReplyPrefixText, isSilentReplyText } from '../utils/chat-message';

export type StreamSegment = {
  id: string;
  text: string;
  timestampMs: number;
};

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
  const maxTransientCount = Math.max(params.streamSegments.length, params.toolMessages.length);
  for (let index = 0; index < maxTransientCount; index++) {
    const streamSegment = params.streamSegments[index];
    if (streamSegment?.text.trim() && !shouldHideSilentStreamText(streamSegment.text)) {
      transient.push({
        id: streamSegment.id,
        role: 'assistant',
        text: streamSegment.text,
        timestampMs: streamSegment.timestampMs,
        streaming: true,
      });
    }

    const toolMessage = params.toolMessages[index];
    if (toolMessage && !seen.has(toolMessage.id)) {
      transient.push(toolMessage);
    }
  }

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
  if (hasLiveStream && !hasTerminalMessage && !shouldHideSilentStreamText(params.liveStreamText)) {
    transient.push({
      id: 'streaming',
      role: 'assistant',
      text: params.liveStreamText ?? '',
      streaming: true,
      timestampMs: params.liveStreamStartedAt ?? undefined,
    });
  }

  return [...dedupedHistory, ...transient].reverse();
}
