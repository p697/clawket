import { AdapterError, type SessionActivity } from '@clawket/agent-protocol';

/** Activity is ephemeral evidence; malformed replies must never light a running ring. */
export function validateSessionActivity(value: unknown, keys: readonly string[]): SessionActivity[] {
  if (keys.length > 32 || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string' || !key || key.length > 200)
    || !Array.isArray(value) || value.length !== keys.length) throw new AdapterError('server', 'Invalid session activity response');
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item.key !== 'string' || !keys.includes(item.key) || seen.has(item.key)
      || !['running', 'idle', 'waiting', 'unknown'].includes(item.state)
      || (item.attention !== undefined && item.attention !== null && !['input', 'approval'].includes(item.attention))) {
      throw new AdapterError('server', 'Invalid session activity response');
    }
    seen.add(item.key);
  }
  return value.map(({ key, state, attention }) => ({ key, state, ...(attention === undefined ? {} : { attention }) }));
}

/** Drop malformed push evidence before it reaches presentation listeners. */
export function sessionActivityUpdate(update: import('@clawket/agent-protocol').SessionUpdate) {
  if (update.type !== 'session_activity_update') return update;
  try {
    const activity = validateSessionActivity([update.activity], [update.activity?.key])[0];
    return { type: 'session_activity_update' as const, activity };
  } catch { return undefined; }
}
