import { canMatchMessageAuthors } from './messageAttribution';
import { UiMessage } from '../types/chat';
import { finalReplyTail } from './streamText';
import { isNewUserTurn } from './turnIdentity';

const ASSISTANT_MATCH_GRACE_MS = 5_000;
const SAME_TURN_REPLACEMENT_GRACE_MS = 60_000;
const USER_MATCH_GRACE_MS = 60_000;

/** Only exact, unambiguous native echoes can correct the phone's send clock. */
function userEchoTimestamp(previous: UiMessage[], next: UiMessage[]) {
  const keys = (message: UiMessage): string[] => message.role === 'user' ? [
    ...(message.idempotencyKey ? [`send:${message.idempotencyKey}`] : []),
    ...(message.historyMessageId ? [`history:${message.historyMessageId}`] : []),
  ] : [];
  const counts = (messages: UiMessage[]) => {
    const result = new Map<string, number>();
    for (const message of messages) for (const key of keys(message)) {
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const before = counts(previous);
  const after = counts(next);
  return (local: UiMessage, echo: UiMessage): number | undefined => {
    const timestamp = echo.timestampMs;
    const echoKeys = keys(echo);
    const confirmed = typeof timestamp === 'number' && timestamp > 0
      && Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
      && keys(local).some(key => echoKeys.includes(key) && before.get(key) === 1 && after.get(key) === 1);
    return confirmed ? timestamp : local.timestampMs ?? timestamp;
  };
}

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

/**
 * Execution approval cards exist only on this phone: history never carries
 * them, so a reload would drop a card the user just answered and its record
 * with it. Each card absent from `next` keeps its place beside the row it
 * followed — the phone's arrival clock cannot be ordered against a native
 * history's turn-start stamps. Both lists are newest-first.
 */
export function preserveApprovalRows(previous: UiMessage[], next: UiMessage[]): UiMessage[] {
  const present = new Set(next.map(message => message.id));
  const missing: number[] = [];
  previous.forEach((message, index) => {
    if (message.approval && message.approval.kind !== 'pair' && !present.has(message.id)) missing.push(index);
  });
  if (missing.length === 0) return next;
  const result = [...next];
  const same = (left: UiMessage, right: UiMessage) => left.id === right.id
    || (left.renderKey !== undefined && left.renderKey === right.renderKey);
  // Oldest first, so a card's older neighbour (possibly an earlier card) is already placed.
  for (const index of missing.reverse()) {
    const card = previous[index]!;
    let placed = false;
    for (let older = index + 1; older < previous.length && !placed; older += 1) {
      const at = result.findIndex(message => same(message, previous[older]!));
      if (at >= 0) {
        result.splice(at, 0, card);
        placed = true;
      }
    }
    for (let newer = index - 1; newer >= 0 && !placed; newer -= 1) {
      const at = result.findIndex(message => same(message, previous[newer]!));
      if (at >= 0) {
        result.splice(at + 1, 0, card);
        placed = true;
      }
    }
    if (!placed) result.unshift(card);
  }
  return result;
}

function toolCallKey(message: UiMessage): string | undefined {
  return message.role === 'tool' ? /^tool(?:call|result)_(.+)$/.exec(message.id)?.[1] ?? message.id : undefined;
}

function hasStepTiming(message: UiMessage): boolean {
  return typeof message.toolDurationMs === 'number'
    || (typeof message.toolStartedAt === 'number' && typeof message.toolFinishedAt === 'number');
}

/**
 * OpenClaw and current Codex history say how long each step took; Claude Code,
 * Pi and older Codex runtimes do not, so a reload would erase the times this
 * phone measured while it watched the steps run. A history row without timing
 * of its own keeps a finished live row's, matched by exact tool call ID or the
 * snapshot's alias for it, and all three fields come from that one clock.
 */
export function preserveToolTiming(previous: UiMessage[], next: UiMessage[], aliases?: Readonly<Record<string, string>>): UiMessage[] {
  const measured = new Map<string, UiMessage>();
  for (const message of previous) {
    const key = toolCallKey(message);
    if (key && hasStepTiming(message)) measured.set(aliases?.[key] ?? key, message);
  }
  if (measured.size === 0) return next;
  let changed = false;
  const merged = next.map(message => {
    if (message.toolStatusReported && (message.toolStatus === 'running' || message.toolStatus === 'unknown')) return message;
    const key = toolCallKey(message);
    const live = key && !hasStepTiming(message) ? measured.get(key) : undefined;
    if (!live) return message;
    changed = true;
    return { ...message, toolStartedAt: live.toolStartedAt, toolFinishedAt: live.toolFinishedAt, toolDurationMs: live.toolDurationMs };
  });
  return changed ? merged : next;
}

/** Carry local row identity across exact echoes; wire IDs still drive reconciliation/actions. */
export function preserveMessagePresentation(previous: UiMessage[], next: UiMessage[]): UiMessage[] {
  const timestampForEcho = userEchoTimestamp(previous, next);
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
      // Keep photo geometry and row identity, but an exact native echo owns the
      // clock: retaining a faster phone clock can put a question after its reply.
      ...(message.role === 'user' ? {
        timestampMs: timestampForEcho(local, message),
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

/**
 * Codex persists steering input before its RPC acknowledgement and stamps it
 * with the original turn's clock. Reconcile against the dispatch lineage,
 * never the acknowledgement clock or the current conversation tail.
 */
export function reconcileAcceptedSteeringMessage(
  dispatchedMessages: UiMessage[],
  currentMessages: UiMessage[],
  accepted: UiMessage,
): UiMessage[] {
  const identities = (message: UiMessage) => [message.id, message.historyMessageId, message.renderKey]
    .filter((id): id is string => Boolean(id));
  const same = (left: UiMessage, right: UiMessage) => left.role === right.role
    && identities(left).some(id => identities(right).includes(id));
  if (currentMessages.some(message => same(message, accepted))) return currentMessages;
  const positions = new Map<string, number>();
  currentMessages.forEach((message, index) => {
    for (const id of identities(message)) {
      const key = `${message.role}:${id}`;
      if (!positions.has(key)) positions.set(key, index);
    }
  });
  const findAnchor = (messages: UiMessage[]) => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      const matching = identities(message).map(id => positions.get(`${message.role}:${id}`)).filter((at): at is number => at !== undefined);
      if (matching.length) return Math.min(...matching);
    }
    return -1;
  };
  const anchor = findAnchor(dispatchedMessages);
  // A replaced history window supplies no evidence of the old insertion point.
  // The caller reads canonical history instead of placing old input in a new turn.
  if (anchor < 0 && (dispatchedMessages.length > 0 || currentMessages.length > 0)) return currentMessages;
  const previousUserIds = new Set(dispatchedMessages.filter(message => message.role === 'user').flatMap(identities));
  // A streaming assistant row can keep its identity while native persistence
  // places the steering user before it. Only user lineage bounds echo search;
  // the full dispatch lineage still owns insertion when the echo is absent.
  const userAnchor = findAnchor(dispatchedMessages.filter(message => message.role === 'user'));
  const suffix = currentMessages.slice(userAnchor + 1);
  // Native client IDs belong to ordinary sends. Steering has no send key; a
  // queued next turn with the same text must not absorb its acknowledgement.
  const nextSend = suffix.findIndex(message => message.role === 'user' && Boolean(message.idempotencyKey));
  const candidates = (nextSend < 0 ? suffix : suffix.slice(0, nextSend)).filter(message => message.role === 'user'
    // Direct adapter recovery carries the native ID without a history alias.
    && (Boolean(message.historyMessageId) || (Boolean(message.id) && !message.sentLocally && !/^usr_\d/.test(message.id)))
    && !message.idempotencyKey && !message.delivery
    && !identities(message).some(id => previousUserIds.has(id))
    && !message.imageUris?.length && !message.fileAttachments?.length
    && canMatchMessageAuthors(message, accepted)
    && normalizeUserText(message.text) === normalizeUserText(accepted.text));
  if (candidates.length > 0) return currentMessages;
  return [...currentMessages.slice(0, anchor + 1), accepted, ...currentMessages.slice(anchor + 1)];
}

function areMessagesLinkedByIdempotency(a: UiMessage, b: UiMessage): boolean {
  return !!a.idempotencyKey && !!b.idempotencyKey && a.idempotencyKey === b.idempotencyKey;
}

function areLikelySameUserMessage(a: UiMessage, b: UiMessage): boolean {
  if (areMessagesLinkedByIdempotency(a, b)) {
    return true;
  }

  if (a.id === b.id) return true;
  if ((/^usr_\d+_steer_/.test(a.id) && b.idempotencyKey)
    || (/^usr_\d+_steer_/.test(b.id) && a.idempotencyKey)) return false;
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
    if (/^usr_\d+_steer_/.test(optimisticUser.id) && candidate.idempotencyKey) continue;
    if (candidate.idempotencyKey && optimisticUser.idempotencyKey && candidate.idempotencyKey !== optimisticUser.idempotencyKey) continue;
    if (!canMatchMessageAuthors(candidate, optimisticUser)) continue;
    const steering = /^usr_\d+_steer_/.test(optimisticUser.renderKey ?? optimisticUser.id);
    const knownHistoryIdentity = optimisticUser.historyMessageId
      && [candidate.id, candidate.historyMessageId].includes(optimisticUser.historyMessageId);
    if (steering && !knownHistoryIdentity) {
      const localClock = optimisticUser.timestampMs;
      const nativeClock = candidate.timestampMs;
      const validClock = (value: number | undefined): value is number => typeof value === 'number'
        && value > 0 && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
      // Steering has no send key. Its absence cannot override two clocks
      // that already rule out this older, otherwise identical native guide.
      if (validClock(localClock) && validClock(nativeClock)
        && Math.abs(localClock - nativeClock) > USER_MATCH_GRACE_MS) continue;
    }
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
  const timestampForEcho = userEchoTimestamp(previousMessages, nextMessages);
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
      // Native extension commands need not be persisted as user turns. Keep a
      // retained local command before its newer visible result notices, without
      // reordering canonical assistant/tool turns or guessing missing clocks.
      let insertAt = nextMessages.length;
      while (insertAt > 0 && previousLastUser.timestampMs) {
        const tail = nextMessages[insertAt - 1];
        if (tail.role !== 'system' || !tail.historyMessageId || !tail.timestampMs
          || tail.timestampMs < previousLastUser.timestampMs) break;
        insertAt--;
      }
      mergedMessages = [...nextMessages.slice(0, insertAt), previousLastUser, ...nextMessages.slice(insertAt)];
    } else if (previousLastUser.renderKey) {
      // Older backends may omit the send key. Carry the same confirmed match
      // used above into presentation, so a second refresh cannot lose it.
      mergedMessages = nextMessages.map(message => message === echo ? {
        ...message,
        renderKey: previousLastUser.renderKey,
        ...(previousLastUser.sentLocally ? { sentLocally: true as const } : {}),
        idempotencyKey: message.idempotencyKey ?? previousLastUser.idempotencyKey,
        // Decide from the original echo before a legacy fallback inherits our
        // send key; presentation's second pass must retain this decided clock.
        timestampMs: timestampForEcho(previousLastUser, message),
        imageUris: previousLastUser.imageUris ?? message.imageUris,
        imageMetas: previousLastUser.imageMetas ?? message.imageMetas,
      } : message);
    }
  }

  mergedMessages = preserveCompletedRunPresentation(previousMessages, mergedMessages);
  const previousLastAssistant = findLastAssistantAfterIndex(previousMessages, findLastUserIndex(previousMessages))?.message ?? null;
  if (previousLastAssistant?.presentationRunId) return mergedMessages;
  if (!isOptimisticTerminalAssistant(previousLastAssistant)) {
    return mergedMessages;
  }

  const lastUser = findLastUserIndex(mergedMessages);
  if (previousLastAssistant.historyMessageId && mergedMessages.some((message, index) => (
    index < lastUser && message.role === 'assistant'
    && message.historyMessageId === previousLastAssistant.historyMessageId
  ))) return mergedMessages;

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
        artifactAttachments: nextCurrentTurnAssistant.message.artifactAttachments ?? previousLastAssistant.artifactAttachments,
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


/** Reconcile an interrupted rollup only from complete same-turn split history. */
function splitConfirmedInterruptedGuideTail(message: UiMessage, remote: UiMessage[], turnId: string | undefined, retained: UiMessage[]): UiMessage[] {
  if (!turnId || message.turnId !== turnId || message.role !== 'assistant'
    || !message.id.startsWith('abort_') || message.streaming || message.usage
    || message.artifactAttachments?.length || message.imageUris?.length || message.fileAttachments?.length
    || remote.some(row => row.id === message.id || Boolean(message.historyMessageId && row.historyMessageId === message.historyMessageId))) return [message];
  const clock = (row: UiMessage) => typeof row.timestampMs === 'number' && row.timestampMs > 0
    && Number.isFinite(row.timestampMs) && Number.isFinite(new Date(row.timestampMs).getTime());
  const canonicalAssistant = (row: UiMessage) => row.role === 'assistant' && row.turnId === turnId
    && !row.presentationRunId && !row.streaming && row.text.trim().length > 0 && clock(row);
  const canonicalGuide = (row: UiMessage) => row.role === 'user' && row.turnId === turnId
    // Confirmed native echoes retain sentLocally as presentation metadata.
    && !row.idempotencyKey && !row.delivery && !/^usr_\d/.test(row.id)
    && !row.imageUris?.length && !row.fileAttachments?.length && clock(row);
  const matches: UiMessage[][] = [];
  for (let start = 0; start < remote.length; start++) {
    if (!canonicalAssistant(remote[start]!) || !message.text.trimStart().startsWith(remote[start]!.text.trim())) continue;
    const parts: UiMessage[] = [];
    let remaining = message.text.trimStart(), crossedGuide = false;
    for (let index = start; index < remote.length; index++) {
      const row = remote[index]!;
      if (canonicalGuide(row) && parts.length > 0 && remaining.trim()) { crossedGuide = true; continue; }
      if (!canonicalAssistant(row)) break;
      const prefix = row.text.trim();
      if (!remaining.startsWith(prefix)) break;
      parts.push(row);
      remaining = remaining.slice(prefix.length);
      if (!remaining.trim()) break;
      // Exact separate paragraphs only; do not split a joined word or changed prose.
      if (!/^\s/.test(remaining)) break;
      remaining = remaining.trimStart();
    }
    if (!remaining.trim() && crossedGuide && parts.length > 1) matches.push(parts);
  }
  // Missing/partial/ambiguous canonical rows never authorize removal or a cut.
  if (matches.length !== 1) return [message];
  const confirmed = matches[0]!;
  // An exact, unchanged prefix may already own independent cells. Leave those
  // cells in place and expand only the remaining suffix of this rollup.
  const identities = (row: UiMessage) => [row.id, row.historyMessageId].filter(Boolean);
  let prefixCount = 0, lastOwner = -1;
  for (let index = 0; index < confirmed.length; index++) {
    const part = confirmed[index]!;
    const owners = retained.map((row, position) => ({ row, position })).filter(({ row }) => row !== message
      && identities(part).some(id => identities(row).includes(id)));
    if (!owners.length) continue;
    if (index !== prefixCount || owners.length !== 1) return [message];
    const { row, position } = owners[0]!;
    if (position <= lastOwner || position >= retained.indexOf(message) || row.role !== 'assistant'
      || row.turnId !== turnId || row.presentationRunId !== message.presentationRunId
      || row.streaming || !clock(row) || row.text.trim() !== part.text.trim()) return [message];
    prefixCount++; lastOwner = position;
  }
  const parts = confirmed.slice(prefixCount);
  if (!parts.length) return [];
  const occupied = new Set([...remote.filter(row => !parts.includes(row)), ...retained.filter(row => row !== message)]
    .map(row => row.renderKey ?? row.id));
  const tailKey = message.renderKey ?? message.id;
  // Preserve a known canonical A key. Reuse the rollup's old cell only when
  // no other retained row owns it; otherwise use A's canonical identity.
  const tailKeyTaken = occupied.has(tailKey) || parts.slice(1).some(row => (row.renderKey ?? row.id) === tailKey);
  const firstKey = parts[0]!.renderKey ?? (tailKeyTaken ? parts[0]!.id : tailKey);
  const keys = parts.map((row, index) => index === 0 ? firstKey : row.renderKey ?? row.id);
  if (new Set(keys).size !== keys.length || keys.some(key => occupied.has(key))) return [message];
  return parts.map((row, index) => ({ ...row, streaming: false,
    presentationRunId: message.presentationRunId, renderKey: keys[index],
  }));
}

/** Preserve a completed live turn's text/tool boundaries, updating matching server rows in place. */
export function preserveCompletedRunPresentation(previous: UiMessage[], incoming: UiMessage[], options: { live?: boolean } = {}): UiMessage[] {
  if (!previous.some(message => message.presentationRunId)) return incoming;
  let next = incoming;
  const boundaries = [-1];
  let original: UiMessage | undefined;
  previous.forEach((message, index) => {
    if (message.role !== 'user') return;
    if (!original || isNewUserTurn(message, original)) { boundaries.push(index); original = message; }
  });
  boundaries.push(previous.length);
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
    const nextEnd = next.findIndex((message, index) => index > anchor && (user
      ? isNewUserTurn(message, user) || Boolean(user.turnId && message.turnId && message.turnId !== user.turnId)
      : message.role === 'user'));
    const boundary = nextEnd < 0 ? next.length : nextEnd;
    const remote = next.slice(anchor + 1, boundary);
    // Repair old cumulative live bubbles only when this turn's transcript
    // confirms the isolated text. Repeated prose in real history stays intact.
    const confirmedTexts = new Set(remote.filter(message => message.role === 'assistant')
      .map(message => normalizeAssistantText(message.text)));
    const precedingTexts: Array<{ text: string }> = [];
    const local = localRows.flatMap(message => splitConfirmedInterruptedGuideTail(message, remote, user?.turnId, localRows)).map(message => {
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
      // Repeated prose must not steal a later row's known native identity.
      const exact = remote.findIndex((candidate, i) => !consumed.has(i) && candidate.role === message.role
        && [candidate.id, candidate.historyMessageId].filter(Boolean).some(id => [message.id, message.historyMessageId].includes(id)));
      const index = exact >= 0 ? exact : remote.findIndex((candidate, i) => !consumed.has(i) && candidate.role === message.role && (
        (message.role === 'assistant' && (normalizeAssistantText(candidate.text) === normalizeAssistantText(message.text)
          || ((options.live || message.streaming) && candidate.text.trim().length > 0 && message.text.startsWith(candidate.text))))
        || (message.role === 'tool' && candidate.toolName === message.toolName
          && candidate.id.replace(/^tool(?:call|result)_/, '') === message.id.replace(/^tool(?:call|result)_/, ''))
      ));
      if (index < 0) {
        const aggregate = message === texts.at(-1) && aggregateIndex >= 0 ? remote[aggregateIndex] : undefined;
        if (aggregate) canonicalPositions[localIndex] = aggregateIndex;
        return aggregate ? { ...message, usage: aggregate.usage ?? message.usage, modelLabel: aggregate.modelLabel ?? message.modelLabel,
          artifactAttachments: aggregate.artifactAttachments ?? message.artifactAttachments, imageUris: aggregate.imageUris ?? message.imageUris, fileAttachments: aggregate.fileAttachments ?? message.fileAttachments } : message;
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
