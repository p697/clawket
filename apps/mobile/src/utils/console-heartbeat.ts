import type { HeartbeatStatus } from '@clawket/agent-protocol';

/** Statuses the Gateway emits only after the heartbeat turn actually ran. */
const COMPLETED_HEARTBEAT_STATUSES: ReadonlySet<string> = new Set(['sent', 'ok-empty', 'ok-token']);

/**
 * Normalize the Gateway `last-heartbeat` payload. Gateways have reported the
 * timestamp as `lastHeartbeatAt`, `ts` or `timestamp`; anything else is "none".
 * A `skipped` (busy, no route, alerts off) or `failed` event also refreshes
 * the Gateway timestamp without a completed turn, so it does not count as
 * activity; payloads without a status keep the legacy behavior.
 */
export function parseLastHeartbeat(raw: unknown): HeartbeatStatus {
  if (!raw || typeof raw !== 'object') return { lastHeartbeatAt: null };
  const record = raw as Record<string, unknown>;
  if (typeof record.status === 'string' && !COMPLETED_HEARTBEAT_STATUSES.has(record.status)) {
    return { lastHeartbeatAt: null };
  }
  for (const key of ['lastHeartbeatAt', 'ts', 'timestamp']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return { lastHeartbeatAt: value };
    }
  }
  return { lastHeartbeatAt: null };
}

export function heartbeatMinutesAgo(lastHeartbeatAt: number | null | undefined, now: number): number | null {
  if (typeof lastHeartbeatAt !== 'number' || !Number.isFinite(lastHeartbeatAt) || lastHeartbeatAt <= 0) return null;
  return Math.max(0, Math.floor((now - lastHeartbeatAt) / 60_000));
}

export function formatConsoleHeartbeatAge(minutesAgo: number, language: string): {
  key: 'just now' | '{{count}}m ago' | '{{count}}h ago' | '{{count}}d ago';
  count?: number;
  compactText?: string;
} {
  if (minutesAgo < 1) {
    return { key: 'just now' };
  }

  const normalizedLanguage = language.toLowerCase();
  const isSpanish = normalizedLanguage === 'es' || normalizedLanguage.startsWith('es-');
  const isGerman = normalizedLanguage === 'de' || normalizedLanguage.startsWith('de-');
  const useCompactText = isSpanish || isGerman;

  if (minutesAgo < 60) {
    return useCompactText
      ? { key: '{{count}}m ago', count: minutesAgo, compactText: `${minutesAgo} m` }
      : { key: '{{count}}m ago', count: minutesAgo };
  }

  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) {
    return useCompactText
      ? { key: '{{count}}h ago', count: hours, compactText: `${hours} h` }
      : { key: '{{count}}h ago', count: hours };
  }

  const days = Math.floor(hours / 24);
  return useCompactText
    ? { key: '{{count}}d ago', count: days, compactText: `${days} d` }
    : { key: '{{count}}d ago', count: days };
}
