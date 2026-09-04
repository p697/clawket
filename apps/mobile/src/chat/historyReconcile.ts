export type ReconcileAssistantOptions = {
  appendIfMissing?: boolean;
  minTimestampMs?: number;
};

export function shouldAppendReconciledAssistant(
  latestAssistantTimestampMs: number,
  options?: ReconcileAssistantOptions,
): boolean {
  if (!options?.appendIfMissing) return false;
  if (!options.minTimestampMs || options.minTimestampMs <= 0) return true;
  if (latestAssistantTimestampMs <= 0) return true;
  return latestAssistantTimestampMs + 1000 >= options.minTimestampMs;
}
