/**
 * utils.ts — Utility functions for relay.
 * Ported verbatim from apps/relay-worker/src/relay/utils.ts.
 */

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}
