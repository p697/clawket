import { validTurnIdentity } from './turnIdentity';
import type { StreamSegment } from './liveRunThread';
import type { UiMessage } from '../types/chat';

export type SessionRunState = {
  runId: string;
  turnId?: string;
  inputMessageId?: string;
  inputMessageKey?: string;
  streamText: string | null;
  startedAt: number;
  streamTimestampMs?: number;
  /** Scoped in-memory Codex rows; streamText retains the cumulative wire snapshot. */
  presentation?: { owner: object; segments: StreamSegment[]; tools: UiMessage[] };
};

function shouldReplaceStreamText(previous: string | null, next: string): boolean {
  if (!previous) return true;
  return next.length >= previous.length;
}

export function markSessionRunStarted(
  map: Map<string, SessionRunState>,
  sessionKey: string,
  runId: string,
  startedAt = Date.now(),
): SessionRunState {
  const prev = map.get(sessionKey);
  const next: SessionRunState = {
    runId,
    ...(prev?.runId === runId ? { turnId: prev.turnId, inputMessageId: prev.inputMessageId, inputMessageKey: prev.inputMessageKey, presentation: prev.presentation } : {}),
    streamText: prev?.runId === runId ? prev.streamText : null,
    startedAt: prev?.runId === runId ? prev.startedAt : startedAt,
    streamTimestampMs: prev?.runId === runId ? prev.streamTimestampMs : undefined,
  };
  map.set(sessionKey, next);
  return next;
}

export function markSessionRunDelta(
  map: Map<string, SessionRunState>,
  sessionKey: string,
  runId: string,
  text: string,
  startedAt = Date.now(),
  authoritative = false,
  streamTimestampMs?: number,
): SessionRunState {
  const prev = map.get(sessionKey);
  const next: SessionRunState = {
    runId,
    ...(prev?.runId === runId ? { turnId: prev.turnId, inputMessageId: prev.inputMessageId, inputMessageKey: prev.inputMessageKey, presentation: prev.presentation } : {}),
    streamText: prev?.runId === runId
      ? (authoritative || shouldReplaceStreamText(prev.streamText, text) ? text : prev.streamText)
      : text,
    startedAt: prev?.runId === runId ? prev.startedAt : startedAt,
    streamTimestampMs: streamTimestampMs ?? (prev?.runId === runId ? prev.streamTimestampMs : undefined),
  };
  map.set(sessionKey, next);
  return next;
}

export function clearSessionRunState(
  map: Map<string, SessionRunState>,
  sessionKey: string,
  runId?: string,
): boolean {
  const prev = map.get(sessionKey);
  if (!prev) return false;
  if (runId && prev.runId !== runId) return false;
  map.delete(sessionKey);
  return true;
}

/** Metadata may arrive after start acknowledgement; it cannot reset presentation. */
export function rememberSessionRunIdentity(map: Map<string, SessionRunState>, key: string, runId: string,
  turnId: unknown, inputMessageId: unknown, inputMessageKey?: unknown): boolean {
  const state = map.get(key);
  const turn = validTurnIdentity(turnId), input = validTurnIdentity(inputMessageId);
  if (!state || state.runId !== runId || !turn || !input || (state.turnId && state.turnId !== turn)
    || (state.inputMessageId && state.inputMessageId !== input)) return false;
  const clientKey = validTurnIdentity(inputMessageKey);
  if (state.inputMessageKey && clientKey && state.inputMessageKey !== clientKey) return false;
  if (state.turnId === turn && state.inputMessageId === input && (!clientKey || state.inputMessageKey === clientKey)) return false;
  state.turnId = turn; state.inputMessageId = input;
  if (clientKey) state.inputMessageKey = clientKey;
  return true;
}
