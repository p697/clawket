import { setTimeout as delay } from 'node:timers/promises';
import { isRecord, readString } from './internal.js';

/** A disconnected event stream is not evidence that its run has stopped. */
export async function waitForHermesTerminalRun(input: {
  apiBaseUrl: string;
  headers: Record<string, string>;
  runId: string;
  signal: AbortSignal;
  onStatus?: (value: Record<string, unknown>) => void;
}): Promise<Record<string, unknown> | null> {
  let retryMs = 1000;
  while (!input.signal.aborted) {
    try {
      const response = await fetch(`${input.apiBaseUrl}/v1/runs/${encodeURIComponent(input.runId)}`, {
        headers: input.headers,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(5000)]),
      });
      if (response.ok) {
        const value: unknown = await response.json();
        if (!input.signal.aborted && isRecord(value) && readString(value.run_id) === input.runId) {
          input.onStatus?.(value);
          if (['completed', 'failed', 'cancelled', 'interrupted'].includes(readString(value.status))) return value;
        }
      }
    } catch {
      // Retain ownership through transient API failure; cancellation owns this loop.
    }
    if (input.signal.aborted) break;
    try { await delay(retryMs, undefined, { signal: input.signal }); } catch { break; }
    retryMs = Math.min(retryMs * 2, 30_000);
  }
  return null;
}
