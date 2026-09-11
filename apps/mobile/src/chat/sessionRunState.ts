export type SessionRunState = {
  runId: string;
  streamText: string | null;
  startedAt: number;
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
    streamText: prev?.runId === runId ? prev.streamText : null,
    startedAt: prev?.runId === runId ? prev.startedAt : startedAt,
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
): SessionRunState {
  const prev = map.get(sessionKey);
  const next: SessionRunState = {
    runId,
    streamText: prev?.runId === runId
      ? (shouldReplaceStreamText(prev.streamText, text) ? text : prev.streamText)
      : text,
    startedAt: prev?.runId === runId ? prev.startedAt : startedAt,
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
