export function shouldAdoptPendingOptimisticRunId(params: {
  sessionKey: string;
  eventRunId: string;
  currentRunId: string | null;
  pendingRunIds: Map<string, string>;
}): boolean {
  const { sessionKey, eventRunId, currentRunId, pendingRunIds } = params;
  if (!currentRunId) return false;
  const pendingRunId = pendingRunIds.get(sessionKey);
  if (!pendingRunId) return false;
  if (pendingRunId !== currentRunId) return false;
  return pendingRunId !== eventRunId;
}
