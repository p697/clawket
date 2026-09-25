import { canMatchMessageAuthors } from './messageAttribution';
import { UiMessage } from '../types/chat';
import { finalReplyTail } from './streamText';

const ASSISTANT_MATCH_GRACE_MS = 5_000;
const SAME_TURN_REPLACEMENT_GRACE_MS = 60_000;
const USER_MATCH_GRACE_MS = 60_000;

/** Retire a stale live/source copy only when the snapshot confirms its replacement. */
export function retireAliasedTools(previous: UiMessage[], next: UiMessage[], aliases?: Readonly<Record<string, string>>): UiMessage[] {
  if (!aliases) return previous;
  return previous.filter(message => {
    if (message.role !== 'tool') return true;
    const sourceId = message.id.replace(/^tool(?:call|result)_/, '');
    const target = aliases[sourceId];
    return !target || !next.some(candidate => candidate.role === 'tool' && candidate.toolName === message.toolName
      && candidate.id.replace(/^tool(?:call|result)_/, '') === target);
  });
}

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
      ...(local.sentLocally ? { sentLocally: true as const } : {}),
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

/** Preserve only renderer identity from cache; canonical history owns content and membership. */
export function preserveHydratedMessageKeys(previous: UiMessage[], next: UiMessage[]): UiMessage[] {
  const identity = (message: UiMessage) => `${message.role}:${message.historyMessageId ?? message.id}`;
  const candidates = new Map<string, UiMessage | null>();
  const previousKeyCounts = new Map<string, number>();
  for (const message of previous) {
    const key = identity(message);
    candidates.set(key, candidates.has(key) ? null : message);
    const renderKey = message.renderKey ?? message.id;
    previousKeyCounts.set(renderKey, (previousKeyCounts.get(renderKey) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const message of next) counts.set(identity(message), (counts.get(identity(message)) ?? 0) + 1);
  const occupiedKeys = new Set(next.map(message => message.renderKey ?? message.id));
  return next.map(message => {
    const key = identity(message);
    const old = candidates.get(key);
    if (!old || counts.get(key) !== 1) return message;
    const restored = old.sentLocally ? { ...message, sentLocally: true as const } : message;
    if (message.renderKey) return restored;
    const renderKey = old.renderKey ?? old.id;
    if (renderKey === message.id || previousKeyCounts.get(renderKey) !== 1 || occupiedKeys.has(renderKey)) return restored;
    occupiedKeys.add(renderKey);
    // Same wire identity, not a text-similarity guess: never retain a stale
    // optimistic row or conflate repeated paragraphs from different turns.
    return { ...restored, renderKey };
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
  // A server echo replaces the wire ID, but the locally submitted turn is
  // still ours. A later/older history page must not erase its user anchor.
  if (message.role !== 'user' || !(message.renderKey ?? message.id).startsWith('usr_')) {
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
  if (!canMatchMessageAuthors(a, b)) return false;
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
    if (candidate.role !== 'user' || knownOlderIds.has(candidate.historyMessageId ?? candidate.id) || knownOlderIds.has(candidate.id)) continue;
    if (candidate.idempotencyKey && optimisticUser.idempotencyKey && candidate.idempotencyKey !== optimisticUser.idempotencyKey) continue;
    if (!canMatchMessageAuthors(candidate, optimisticUser)) continue;
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
    const knownOlderIds = new Set(previousMessages.filter(message => message.role === 'user' && message.id !== previousLastUser.id)
      .flatMap(message => [message.id, message.historyMessageId ?? message.id]));
    const matchingUser = nextMessages.find((message) => (
      message.role === 'user' && !knownOlderIds.has(message.id)
      && !knownOlderIds.has(message.historyMessageId ?? message.id) && areLikelySameUserMessage(message, previousLastUser)
    ));
    const fallbackMatch = matchingUser
      ? null
      : findTailUserFallbackMatch(previousLastUser, nextMessages, knownOlderIds);
    const echo = matchingUser ?? fallbackMatch;
    if (!echo) {
      mergedMessages = [...nextMessages, previousLastUser];
    } else if (previousLastUser.renderKey) {
      // Older backends may omit the send key. Carry the same confirmed match
      // used above into presentation, so a second refresh cannot lose it.
      mergedMessages = nextMessages.map(message => message === echo ? {
        ...message,
        renderKey: previousLastUser.renderKey,
        ...(previousLastUser.sentLocally ? { sentLocally: true as const } : {}),
        idempotencyKey: message.idempotencyKey ?? previousLastUser.idempotencyKey,
        timestampMs: previousLastUser.timestampMs ?? message.timestampMs,
        imageUris: previousLastUser.imageUris ?? message.imageUris,
        imageMetas: previousLastUser.imageMetas ?? message.imageMetas,
      } : message);
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
export function preserveCompletedRunPresentation(previous: UiMessage[], incoming: UiMessage[], options: { live?: boolean } = {}): UiMessage[] {
  if (!previous.some(message => message.presentationRunId)) return incoming;
  let next = incoming;
  const boundaries = [-1, ...previous.flatMap((message, index) => message.role === 'user' ? [index] : []), previous.length];
  for (let turn = 0; turn < boundaries.length - 1; turn++) {
    const start = boundaries[turn];
    const localRows = previous.slice(start + 1, boundaries[turn + 1]).filter(message => message.presentationRunId);
    if (!localRows.length) continue;
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
    // Repair old cumulative live bubbles only when this turn's transcript
    // confirms the isolated text. Repeated prose in real history stays intact.
    const confirmedTexts = new Set(remote.filter(message => message.role === 'assistant')
      .map(message => normalizeAssistantText(message.text)));
    const precedingTexts: Array<{ text: string }> = [];
    const local = localRows.map(message => {
      if (message.role !== 'assistant') return message;
      const tail = finalReplyTail(message.text, precedingTexts);
      const repaired = !confirmedTexts.has(normalizeAssistantText(message.text))
        && tail !== message.text && tail.trim() && confirmedTexts.has(normalizeAssistantText(tail))
        ? { ...message, text: tail } : message;
      precedingTexts.push(repaired);
      return repaired;
    });
    const consumed = new Set<number>();
    const texts = local.filter(message => message.role === 'assistant');
    const combined = normalizeAssistantText(texts.map(message => message.text).join(' '));
    const concatenated = normalizeAssistantText(texts.map(message => message.text).join(''));
    const aggregateIndex = texts.length > 1 ? remote.findIndex(message => message.role === 'assistant'
      && [combined, concatenated].includes(normalizeAssistantText(message.text))) : -1;
    if (aggregateIndex >= 0) consumed.add(aggregateIndex);
    const canonicalPositions: Array<number | undefined> = new Array(local.length).fill(undefined);
    const rows = local.map((message, localIndex) => {
      const index = remote.findIndex((candidate, i) => !consumed.has(i) && candidate.role === message.role && (
        candidate.id === message.id
        || (message.role === 'assistant' && (normalizeAssistantText(candidate.text) === normalizeAssistantText(message.text)
          || ((options.live || message.streaming) && candidate.text.trim().length > 0 && message.text.startsWith(candidate.text))))
        || (message.role === 'tool' && candidate.toolName === message.toolName
          && candidate.id.replace(/^tool(?:call|result)_/, '') === message.id.replace(/^tool(?:call|result)_/, ''))
      ));
      if (index < 0) {
        const aggregate = message === texts.at(-1) && aggregateIndex >= 0 ? remote[aggregateIndex] : undefined;
        if (aggregate) canonicalPositions[localIndex] = aggregateIndex;
        return aggregate ? { ...message, usage: aggregate.usage ?? message.usage, modelLabel: aggregate.modelLabel ?? message.modelLabel,
          imageUris: aggregate.imageUris ?? message.imageUris, fileAttachments: aggregate.fileAttachments ?? message.fileAttachments } : message;
      }
      consumed.add(index);
      canonicalPositions[localIndex] = index;
      return { ...message, ...remote[index], renderKey: message.renderKey ?? message.id,
        ...(options.live ? { id: message.id, historyMessageId: remote[index].historyMessageId ?? remote[index].id } : {}),
        ...((options.live || message.streaming) && message.role === 'assistant' ? { text: message.text } : {}),
        presentationRunId: message.presentationRunId, timestampMs: message.timestampMs, streaming: message.streaming };
    });
    // Keep newly discovered server content; absence from an early history page
    // is not evidence that an already displayed live segment should disappear.
    // A newly discovered pre-tool paragraph belongs before its confirmed next
    // row, not after the final answer. Preserve existing live row identities
    // and order while using the transcript's anchors for previously unseen rows.
    remote.forEach((message, index) => {
      if (consumed.has(index)) return;
      const before = canonicalPositions.findIndex(position => position !== undefined && position > index);
      const position = before < 0 ? rows.length : before;
      rows.splice(position, 0, message);
      canonicalPositions.splice(position, 0, index);
    });
    next = [...next.slice(0, anchor + 1), ...rows, ...next.slice(boundary)];
  }
  return next;
}
