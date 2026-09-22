import type { GatewayHistoryPayload } from './gateway-adapter';

const PREFIX = 'clawket:openclaw-offset:';
/** Native offsets are scoped to a physical transcript, never sent as delta cursors. */
export function openClawHistoryRequest(key: string, options?: { limit?: number; cursor?: string }): Record<string, unknown> {
  const base = { sessionKey: key, limit: options?.limit ?? 50 };
  const cursor = options?.cursor;
  if (!cursor) return base;
  if (!cursor.startsWith(PREFIX)) return { ...base, cursor };
  let page: { key?: unknown; sessionId?: unknown; offset?: unknown };
  try { page = JSON.parse(cursor.slice(PREFIX.length)); } catch { throw new Error('Invalid history cursor'); }
  if (!page || page.key !== key || typeof page.sessionId !== 'string' || !page.sessionId
    || !Number.isSafeInteger(page.offset) || Number(page.offset) <= 0) throw new Error('Invalid history cursor');
  return { ...base, sessionId: page.sessionId, offset: page.offset };
}

export function openClawHistoryCursor(key: string, payload: GatewayHistoryPayload | undefined): string | undefined {
  if (payload?.hasMore === true) {
    if (!Number.isSafeInteger(payload.nextOffset) || Number(payload.nextOffset) <= 0
      || typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) throw new Error('Invalid history pagination');
    return PREFIX + JSON.stringify({ key, sessionId: payload.sessionId, offset: payload.nextOffset });
  }
  return typeof payload?.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : undefined;
}
