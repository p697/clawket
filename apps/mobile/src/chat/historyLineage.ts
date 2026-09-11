import { CachedMessage, CachedSessionSnapshot } from '../services/chat-cache';
import { UiMessage } from '../types/chat';
import {
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  shouldHideMessage,
} from '../utils/chat-message';

function buildMessageDedupKey(message: UiMessage): string {
  return JSON.stringify([
    message.id,
    message.role,
    message.timestampMs ?? null,
    message.text,
    message.toolName ?? null,
  ]);
}

export function cachedMessageToUiMessage(message: CachedMessage): UiMessage {
  return {
    ...message,
    streaming: false,
  };
}

export function buildCachedLineageMessages(
  snapshots: CachedSessionSnapshot[],
  options?: { excludeSessionId?: string },
): UiMessage[] {
  const excludeSessionId = options?.excludeSessionId?.trim();
  return snapshots
    .filter((snapshot) => !excludeSessionId || snapshot.meta.sessionId !== excludeSessionId)
    .flatMap((snapshot) => snapshot.messages.map(cachedMessageToUiMessage))
    .filter((message) => !isAssistantSilentReplyMessage(message))
    .filter((message) => !isAssistantDeliveryMirrorMessage(message))
    .filter((message) => !shouldHideMessage(message));
}

export function mergeHistoryWithCachedLineage(params: {
  cachedSnapshots: CachedSessionSnapshot[];
  currentMessages: UiMessage[];
  currentSessionId?: string;
}): UiMessage[] {
  const archivedMessages = buildCachedLineageMessages(params.cachedSnapshots, {
    excludeSessionId: params.currentSessionId,
  });
  const combined = [...archivedMessages, ...params.currentMessages];
  const lastIndexByKey = new Map<string, number>();

  for (let index = 0; index < combined.length; index++) {
    lastIndexByKey.set(buildMessageDedupKey(combined[index]), index);
  }

  return combined.filter((message, index) => lastIndexByKey.get(buildMessageDedupKey(message)) === index);
}
