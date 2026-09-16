import type { SessionUpdate } from '@clawket/agent-protocol';

export type RunActivity = Readonly<{
  connectionId: string;
  sessionKey: string;
  runId: string;
  phase: 'thinking' | 'replying' | 'tool';
}>;

/** Live presentation only; never persisted or used as transport health evidence. */
export function updateRunActivities(
  current: ReadonlyArray<RunActivity>,
  connectionId: string,
  update: SessionUpdate,
): ReadonlyArray<RunActivity> {
  if (update.type === 'history_reconciled' && update.history.hasActiveRun === false) {
    const next = current.filter((item) => item.connectionId !== connectionId || item.sessionKey !== update.sessionKey);
    return next.length === current.length ? current : next;
  }
  if (!('runId' in update) || !update.runId || !('sessionKey' in update) || !update.sessionKey) return current;
  const index = current.findIndex((item) => item.connectionId === connectionId
    && item.sessionKey === update.sessionKey && item.runId === update.runId);
  if (update.type === 'run_finished' || update.type === 'error') {
    return index < 0 ? current : current.filter((_, position) => position !== index);
  }
  const phase = update.type === 'run_started' || update.type === 'agent_thought_chunk' ? 'thinking'
    : update.type === 'agent_message_chunk' ? 'replying'
      : update.type === 'tool_call' || update.type === 'tool_call_update' ? 'tool' : null;
  if (!phase || current[index]?.phase === phase) return current;
  const item: RunActivity = { connectionId, sessionKey: update.sessionKey, runId: update.runId, phase };
  return index < 0 ? [...current, item] : current.map((existing, position) => position === index ? item : existing);
}
