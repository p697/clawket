import { UiMessage } from '../../../types/chat';

const ASSISTANT_MATCH_GRACE_MS = 5_000;
const SAME_TURN_REPLACEMENT_GRACE_MS = 60_000;
const USER_MATCH_GRACE_MS = 60_000;

function findLastAssistant(messages: UiMessage[]): UiMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'assistant' && message.text.trim().length > 0) {
      return message;
    }
  }
  return null;
}

function findLastOptimisticUser(messages: UiMessage[]): UiMessage | null {
  const lastUserIndex = findLastUserIndex(messages);
  if (lastUserIndex < 0) return null;

  const message = messages[lastUserIndex];
  if (message.role !== 'user' || !message.id.startsWith('usr_')) {
    return null;
  }

  return message;
}

function findLastUserIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function findLastAssistantAfterIndex(messages: UiMessage[], minIndex: number): { index: number; message: UiMessage } | null {
  for (let index = messages.length - 1; index > minIndex; index--) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.text.trim().length > 0) {
      return { index, message };
    }
  }
  return null;
}

function countAssistantsAfterIndex(messages: UiMessage[], minIndex: number): number {
  let count = 0;
  for (let index = minIndex + 1; index < messages.length; index++) {
    if (messages[index]?.role === 'assistant' && messages[index].text.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

function isOptimisticTerminalAssistant(message: UiMessage | null): message is UiMessage {
  if (!message) return false;
  return message.id.startsWith('final_') || message.id.startsWith('abort_');
}

function replaceMessageAt(messages: UiMessage[], index: number, value: UiMessage): UiMessage[] {
  const next = [...messages];
  next[index] = value;
  return next;
}

function replaceAssistantMessagesInCurrentTurn(
  messages: UiMessage[],
  minIndex: number,
  replacement: UiMessage,
): UiMessage[] {
  const next: UiMessage[] = [];
  let inserted = false;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const isCurrentTurnAssistant = index > minIndex && message.role === 'assistant';
    if (!isCurrentTurnAssistant) {
      next.push(message);
      continue;
    }
    if (!inserted) {
      next.push(replacement);
      inserted = true;
    }
  }

  if (!inserted) {
    next.push(replacement);
  }

  return next;
}

function normalizeAssistantText(text: string): string {
  return text
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUserText(text: string): string {
  return text
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function areMessagesLinkedByIdempotency(a: UiMessage, b: UiMessage): boolean {
  return !!a.idempotencyKey && !!b.idempotencyKey && a.idempotencyKey === b.idempotencyKey;
}

function areLikelySameUserMessage(a: UiMessage, b: UiMessage): boolean {
  if (areMessagesLinkedByIdempotency(a, b)) {
    return true;
  }

  const timestampA = a.timestampMs ?? 0;
  const timestampB = b.timestampMs ?? 0;
  const closeInTime = timestampA > 0 && timestampB > 0 && Math.abs(timestampA - timestampB) <= USER_MATCH_GRACE_MS;
  if (!closeInTime) return false;

  const normalizedA = normalizeUserText(a.text);
  const normalizedB = normalizeUserText(b.text);
  if (normalizedA && normalizedB && normalizedA === normalizedB) {
    return true;
  }

  // Do not treat image-bearing messages as identical based only on timing.
  // Consecutive image sends can occur within the same minute and must remain distinct.
  return false;
}

function hasMissingUserMatchMetadata(message: UiMessage): boolean {
  return !message.idempotencyKey || !message.timestampMs;
}

function findTailUserFallbackMatch(
  optimisticUser: UiMessage,
  messages: UiMessage[],
): UiMessage | null {
  const normalizedOptimisticText = normalizeUserText(optimisticUser.text);
  if (!normalizedOptimisticText) return null;
  if (optimisticUser.imageUris?.length) return null;

  for (let index = messages.length - 1; index >= 0; index--) {
    const candidate = messages[index];
    if (candidate.role !== 'user') continue;
    if (normalizeUserText(candidate.text) !== normalizedOptimisticText) continue;
    if (!hasMissingUserMatchMetadata(candidate)) continue;
    return candidate;
  }

  return null;
}

function areLikelySameAssistantMessage(a: UiMessage, b: UiMessage): boolean {
  const normalizedA = normalizeAssistantText(a.text);
  const normalizedB = normalizeAssistantText(b.text);
  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;

  const timestampA = a.timestampMs ?? 0;
  const timestampB = b.timestampMs ?? 0;
  const closeInTime = timestampA > 0 && timestampB > 0 && Math.abs(timestampA - timestampB) <= ASSISTANT_MATCH_GRACE_MS;
  if (!closeInTime) return false;

  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    const shorter = Math.min(normalizedA.length, normalizedB.length);
    return shorter >= 12;
  }

  return false;
}

export function preserveOptimisticAssistantMessage(
  previousMessages: UiMessage[],
  nextMessages: UiMessage[],
): UiMessage[] {
  const previousLastUser = findLastOptimisticUser(previousMessages);
  let mergedMessages = nextMessages;
  if (previousLastUser) {
    const hasMatchingUser = nextMessages.some((message) => (
      message.role === 'user' && areLikelySameUserMessage(message, previousLastUser)
    ));
    const fallbackMatch = hasMatchingUser
      ? null
      : findTailUserFallbackMatch(previousLastUser, nextMessages);
    if (!hasMatchingUser && !fallbackMatch) {
      mergedMessages = [...nextMessages, previousLastUser];
    }
  }

  const previousLastAssistant = findLastAssistant(previousMessages);
  if (!isOptimisticTerminalAssistant(previousLastAssistant)) {
    return mergedMessages;
  }

  const nextLastAssistant = findLastAssistant(mergedMessages);
  if (!nextLastAssistant) {
    return [...mergedMessages, previousLastAssistant];
  }

  const lastUserIndex = findLastUserIndex(mergedMessages);
  const nextCurrentTurnAssistant = findLastAssistantAfterIndex(mergedMessages, lastUserIndex);
  const currentTurnAssistantCount = countAssistantsAfterIndex(mergedMessages, lastUserIndex);

  if (nextCurrentTurnAssistant && currentTurnAssistantCount > 1) {
    const previousTimestamp = previousLastAssistant.timestampMs ?? 0;
    const currentTurnTimestamp = nextCurrentTurnAssistant.message.timestampMs ?? 0;
    const canReplaceAllCurrentTurnAssistants = (
      previousTimestamp > 0
      && currentTurnTimestamp > 0
      && previousTimestamp >= currentTurnTimestamp
      && previousTimestamp - currentTurnTimestamp <= SAME_TURN_REPLACEMENT_GRACE_MS
    );

    if (canReplaceAllCurrentTurnAssistants) {
      return replaceAssistantMessagesInCurrentTurn(mergedMessages, lastUserIndex, {
        id: previousLastAssistant.id,
        role: 'assistant',
        text: previousLastAssistant.text,
        timestampMs: previousLastAssistant.timestampMs ?? nextCurrentTurnAssistant.message.timestampMs,
        modelLabel: previousLastAssistant.modelLabel ?? nextCurrentTurnAssistant.message.modelLabel,
        usage: previousLastAssistant.usage ?? nextCurrentTurnAssistant.message.usage,
        imageUris: previousLastAssistant.imageUris ?? nextCurrentTurnAssistant.message.imageUris,
        imageMetas: previousLastAssistant.imageMetas ?? nextCurrentTurnAssistant.message.imageMetas,
      });
    }
  }

  if (areLikelySameAssistantMessage(nextLastAssistant, previousLastAssistant)) {
    const nextAssistantIndex = mergedMessages.lastIndexOf(nextLastAssistant);
    if (nextAssistantIndex < 0) return mergedMessages;
    return replaceMessageAt(mergedMessages, nextAssistantIndex, {
      ...nextLastAssistant,
      id: previousLastAssistant.id,
      timestampMs: nextLastAssistant.timestampMs ?? previousLastAssistant.timestampMs,
      modelLabel: nextLastAssistant.modelLabel ?? previousLastAssistant.modelLabel,
      usage: nextLastAssistant.usage ?? previousLastAssistant.usage,
    });
  }

  if (nextCurrentTurnAssistant) {
    const previousTimestamp = previousLastAssistant.timestampMs ?? 0;
    const currentTurnTimestamp = nextCurrentTurnAssistant.message.timestampMs ?? 0;
    const canReplaceCurrentTurnAssistant = (
      previousTimestamp > 0
      && currentTurnTimestamp > 0
      && previousTimestamp >= currentTurnTimestamp
      && previousTimestamp - currentTurnTimestamp <= SAME_TURN_REPLACEMENT_GRACE_MS
    );

    if (canReplaceCurrentTurnAssistant) {
      return replaceAssistantMessagesInCurrentTurn(mergedMessages, lastUserIndex, {
        id: previousLastAssistant.id,
        role: 'assistant',
        text: previousLastAssistant.text,
        timestampMs: previousLastAssistant.timestampMs ?? nextCurrentTurnAssistant.message.timestampMs,
        modelLabel: previousLastAssistant.modelLabel ?? nextCurrentTurnAssistant.message.modelLabel,
        usage: previousLastAssistant.usage ?? nextCurrentTurnAssistant.message.usage,
        imageUris: previousLastAssistant.imageUris ?? nextCurrentTurnAssistant.message.imageUris,
        imageMetas: previousLastAssistant.imageMetas ?? nextCurrentTurnAssistant.message.imageMetas,
      });
    }
  }

  const previousTimestamp = previousLastAssistant.timestampMs ?? 0;
  const nextTimestamp = nextLastAssistant.timestampMs ?? 0;
  if (nextTimestamp > 0 && previousTimestamp > 0 && nextTimestamp + ASSISTANT_MATCH_GRACE_MS >= previousTimestamp) {
    return mergedMessages;
  }

  return [...mergedMessages, previousLastAssistant];
}
