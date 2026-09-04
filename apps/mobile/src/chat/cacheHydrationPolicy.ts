export function shouldPreserveOptimisticAssistant(params: {
  pendingHydrationSessionKey: string | null;
  targetSessionKey: string;
}): boolean {
  // Preserve optimistic final/abort assistant bubbles for normal live refreshes.
  // The only time preservation must be disabled is during the first server
  // history load that follows a cache restore for the same session, because the
  // cache may contain stale optimistic final_* messages from another agent or an
  // old run. Once hydration is complete (pendingHydrationSessionKey === null),
  // preservation is intentionally re-enabled so the current run's final bubble
  // is not briefly dropped during subsequent refreshes.
  return params.pendingHydrationSessionKey !== params.targetSessionKey;
}
