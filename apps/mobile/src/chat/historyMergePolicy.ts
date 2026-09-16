import { UiMessage } from '../types/chat';
import { finalReplyTail } from './liveRunThread';

const ASSISTANT_MATCH_GRACE_MS = 5_000;
const SAME_TURN_REPLACEMENT_GRACE_MS = 60_000;
const USER_MATCH_GRACE_MS = 60_000;

/** Carry local row identity across exact echoes; wire IDs still drive reconciliation/actions. */
export function preserveMessagePresentation(previous: UiMessage[], next: UiMessage[]): UiMessage[] {
  const byId = new Map(previous.filter((message) => message.renderKey).map((message) => [message.id, message]));
  const bySend = new Map<string, UiMessage | null>();
  for (const message of byId.values()) {
    if (!message.idempotencyKey) continue;
    const key = `${message.role}:${message.idempotencyKey}`;
    bySend.set(key, bySend.has(key) ? null : message);
  }
  const nextSendCounts = new Map<string, number>();
  for (const message of next) {
    if (!message.idempotencyKey) continue;
    const key = `${message.role}:${message.idempotencyKey}`;
    nextSendCounts.set(key, (nextSendCounts.get(key) ?? 0) + 1);
  }
  return next.map((message) => {
    const sendKey = `${message.role}:${message.idempotencyKey}`;
    const local = byId.get(message.id) ?? (message.idempotencyKey && nextSendCounts.get(sendKey) === 1
      ? bySend.get(sendKey) : null);
    if (!local || local.role !== message.role) return message;
    return {
      ...message,
      renderKey: local.renderKey,
      // A local user's geometry (including its time break and photo preview)
      // must not change just because the backend echoed the same submission.
      ...(message.role === 'user' ? {
        timestampMs: local.timestampMs ?? message.timestampMs,
        imageUris: local.imageUris ?? message.imageUris,
        imageMetas: local.imageMetas ?? message.imageMetas,
      } : {}),
    };
  });
}

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

function isOptimisticTerminalAssistant(message: UiMessage | null): message is UiMessage {
  if (!message) return false;
  return message.id.startsWith('final_') || message.id.startsWith('abort_');
}

function replaceMessageAt(messages: UiMessage[], index: number, value: UiMessage): UiMessage[] {
  const next = [...messages];
  next[index] = value;
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

  if (a.id === b.id) return true;
  if (a.idempotencyKey && b.idempotencyKey) return false;
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

/** Cached optimistic IDs must not reappear when paging across a server boundary. */
export function prependOlderCachedMessages(current: UiMessage[], older: UiMessage[]): UiMessage[] {
  const ids = new Set(current.map((message) => message.id));
  const historyIds = new Set(current.map(message => message.historyMessageId).filter(Boolean));
  const matched = new Set<string>();
  const prependable = older.filter((message) => {
    if (ids.has(message.id)) return false;
    if (message.historyMessageId && historyIds.has(message.historyMessageId)) return false;
    ids.add(message.id);
    const optimisticUser = message.role === 'user' && /^usr_\d/.test(message.id);
    const optimisticAssistant = message.role === 'assistant' && /^(final_|abort_|stream_segment_)/.test(message.id);
    if (!optimisticUser && !optimisticAssistant) return true;
    const serverMatch = current.find((candidate) => {
      if (candidate.role !== message.role || /^(usr_\d|final_|abort_|stream_segment_)/.test(candidate.id) || matched.has(candidate.id)) return false;
      if (areMessagesLinkedByIdempotency(message, candidate)) return true;
      if (message.imageUris?.length || message.fileAttachments?.length
        || candidate.imageUris?.length || candidate.fileAttachments?.length) return false;
      if (optimisticUser) return areLikelySameUserMessage(message, candidate);
      return message.text.trim().length > 0 && message.text === candidate.text
        && Boolean(message.timestampMs && candidate.timestampMs)
        && Math.abs(message.timestampMs! - candidate.timestampMs!) <= SAME_TURN_REPLACEMENT_GRACE_MS;
    });
    if (!serverMatch) return true;
    matched.add(serverMatch.id);
    return false;
  });
  return prependable.length ? [...prependable, ...current] : current;
}

function hasMissingUserMatchMetadata(message: UiMessage): boolean {
  return !message.idempotencyKey || !message.timestampMs;
}

function findTailUserFallbackMatch(
  optimisticUser: UiMessage,
  messages: UiMessage[],
  knownOlderIds: Set<string>,
): UiMessage | null {
  const normalizedOptimisticText = normalizeUserText(optimisticUser.text);
  if (!normalizedOptimisticText) return null;
  if (optimisticUser.imageUris?.length || optimisticUser.fileAttachments?.length) return null;

  for (let index = messages.length - 1; index >= 0; index--) {
    const candidate = messages[index];
    if (candidate.role !== 'user' || knownOlderIds.has(candidate.id)) continue;
    if (candidate.idempotencyKey && optimisticUser.idempotencyKey && candidate.idempotencyKey !== optimisticUser.idempotencyKey) continue;
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
    const knownOlderIds = new Set(previousMessages.filter(message => message.role === 'user' && message.id !== previousLastUser.id).map(message => message.id));
    const hasMatchingUser = nextMessages.some((message) => (
      message.role === 'user' && !knownOlderIds.has(message.id) && areLikelySameUserMessage(message, previousLastUser)
    ));
    const fallbackMatch = hasMatchingUser
      ? null
      : findTailUserFallbackMatch(previousLastUser, nextMessages, knownOlderIds);
    if (!hasMatchingUser && !fallbackMatch) {
      mergedMessages = [...nextMessages, previousLastUser];
    }
  }

  mergedMessages = preserveCompletedRunPresentation(previousMessages, mergedMessages);
  const previousLastAssistant = findLastAssistant(previousMessages);
  if (previousLastAssistant?.presentationRunId) return mergedMessages;
  if (!isOptimisticTerminalAssistant(previousLastAssistant)) {
    return mergedMessages;
  }

  const nextLastAssistant = findLastAssistant(mergedMessages);
  if (!nextLastAssistant) {
    return [...mergedMessages, previousLastAssistant];
  }

  const lastUserIndex = findLastUserIndex(mergedMessages);
  const nextCurrentTurnAssistant = findLastAssistantAfterIndex(mergedMessages, lastUserIndex);
  const turnAssistants = mergedMessages.slice(lastUserIndex + 1).filter(message => message.role === 'assistant');
  if (turnAssistants.length > 1) {
    if (turnAssistants.some(message => normalizeAssistantText(message.text) === normalizeAssistantText(previousLastAssistant.text))) return mergedMessages;
    const tail = finalReplyTail(previousLastAssistant.text, turnAssistants.map(message => ({
      id: message.id, text: message.text, timestampMs: message.timestampMs ?? 0,
    })));
    if (tail !== previousLastAssistant.text) {
      return tail.trim() ? [...mergedMessages, { ...previousLastAssistant, text: tail }] : mergedMessages;
    }
    // Several transcript entries are real boundaries, not partial snapshots
    // of one bubble. Never replace them on timestamp proximity alone.
    return mergedMessages;
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
      return replaceMessageAt(mergedMessages, nextCurrentTurnAssistant.index, {
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


/** Preserve a completed live turn's text/tool boundaries, updating matching server rows in place. */
export function preserveCompletedRunPresentation(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  if (!previous.some(message => message.presentationRunId)) return incoming;
  let next = incoming;
  const boundaries = [-1, ...previous.flatMap((message, index) => message.role === 'user' ? [index] : []), previous.length];
  for (let turn = 0; turn < boundaries.length - 1; turn++) {
    const start = boundaries[turn];
    const local = previous.slice(start + 1, boundaries[turn + 1]).filter(message => message.presentationRunId);
    if (!local.length) continue;
    const user = previous[start];
    const anchor = user ? next.findIndex(message => message.role === 'user' && (
      message.id === user.id || areMessagesLinkedByIdempotency(message, user)
      || Boolean(user.renderKey && message.renderKey === user.renderKey)
    )) : -1;
    if (user && anchor < 0) continue;
    if (!user && next.some(message => message.role === 'user')) continue;
    const nextEnd = next.findIndex((message, index) => index > anchor && message.role === 'user');
    const boundary = nextEnd < 0 ? next.length : nextEnd;
    const remote = next.slice(anchor + 1, boundary);
    const consumed = new Set<number>();
    const texts = local.filter(message => message.role === 'assistant');
    const combined = normalizeAssistantText(texts.map(message => message.text).join(' '));
    const aggregateIndex = texts.length > 1 ? remote.findIndex(message => message.role === 'assistant'
      && normalizeAssistantText(message.text) === combined) : -1;
    if (aggregateIndex >= 0) consumed.add(aggregateIndex);
    const rows = local.map(message => {
      const index = remote.findIndex((candidate, i) => !consumed.has(i) && candidate.role === message.role && (
        candidate.id === message.id
        || (message.role === 'assistant' && normalizeAssistantText(candidate.text) === normalizeAssistantText(message.text))
        || (message.role === 'tool' && candidate.toolName === message.toolName
          && candidate.id.replace(/^tool(?:call|result)_/, '') === message.id.replace(/^tool(?:call|result)_/, ''))
      ));
      if (index < 0) {
        const aggregate = message === texts.at(-1) && aggregateIndex >= 0 ? remote[aggregateIndex] : undefined;
        return aggregate ? { ...message, usage: aggregate.usage ?? message.usage, modelLabel: aggregate.modelLabel ?? message.modelLabel,
          imageUris: aggregate.imageUris ?? message.imageUris, fileAttachments: aggregate.fileAttachments ?? message.fileAttachments } : message;
      }
      consumed.add(index);
      return { ...message, ...remote[index], renderKey: message.renderKey ?? message.id,
        presentationRunId: message.presentationRunId, timestampMs: message.timestampMs, streaming: false };
    });
    // Keep newly discovered server content; absence from an early history page
    // is not evidence that an already displayed live segment should disappear.
    rows.push(...remote.filter((_, index) => !consumed.has(index)));
    next = [...next.slice(0, anchor + 1), ...rows, ...next.slice(boundary)];
  }
  return next;
}
