import { CONTROL_PREFIX, PENDING_CHALLENGE_TTL_MS, RELAY_FRAME_MAX_BYTES } from './types';

export function relayFrameByteLength(message: string | ArrayBuffer): number {
  if (typeof message !== 'string') return message.byteLength;

  // Count UTF-8 bytes without allocating a second multi-megabyte buffer.
  let bytes = 0;
  for (let index = 0; index < message.length; index += 1) {
    const codeUnit = message.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff
      && index + 1 < message.length
      && message.charCodeAt(index + 1) >= 0xdc00
      && message.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      // BMP code points and unpaired surrogates (encoded as U+FFFD) use 3 bytes.
      bytes += 3;
    }
  }
  return bytes;
}

export function isRelayFrameTooLarge(message: string | ArrayBuffer): boolean {
  return relayFrameByteLength(message) > RELAY_FRAME_MAX_BYTES;
}

export function normalizeMessage(message: string | ArrayBuffer): string | null {
  if (typeof message === 'string') return message;
  if (message instanceof ArrayBuffer) {
    return new TextDecoder().decode(message);
  }
  return null;
}

export function isPendingChallengeExpired(queuedAt: number, now: number): boolean {
  return now - queuedAt > PENDING_CHALLENGE_TTL_MS;
}

export function isAwaitingChallengeExpired(queuedAt: number, now: number, ttlMs: number): boolean {
  return now - queuedAt > ttlMs;
}

export function isClientStaleForHandshake(
  lastActivityAt: number,
  awaitingQueuedAt: number,
  now: number,
  ttlMs: number,
): boolean {
  if (!isAwaitingChallengeExpired(awaitingQueuedAt, now, ttlMs)) return false;
  return now - lastActivityAt > ttlMs;
}

export function isClientIdleExpired(lastActivityAt: number, now: number, timeoutMs: number): boolean {
  return now - lastActivityAt > timeoutMs;
}

export function shouldEmitClientControlAfterSocketEvent(wasCurrentClientMapping: boolean): boolean {
  return wasCurrentClientMapping;
}

export function resolveAwaitingChallengeClientId(input: {
  awaitingChallenge: Array<{ clientId: string; queuedAt: number }>;
  openClientIds: string[];
  preferredClientId?: string | null;
  activeClientId?: string | null;
  now?: number;
}): string | null {
  void input.now;
  const openClientIds = new Set(input.openClientIds);
  let candidateClientId: string | null = null;
  let candidateQueuedAt = Number.POSITIVE_INFINITY;

  for (const entry of input.awaitingChallenge) {
    if (!openClientIds.has(entry.clientId)) continue;
    if (entry.queuedAt < candidateQueuedAt) {
      candidateClientId = entry.clientId;
      candidateQueuedAt = entry.queuedAt;
    }
  }
  if (candidateClientId) return candidateClientId;

  const preferredClientId = input.preferredClientId ?? input.activeClientId ?? null;
  if (preferredClientId && openClientIds.has(preferredClientId)) {
    return preferredClientId;
  }

  for (const clientId of input.openClientIds) {
    return clientId;
  }

  return null;
}

export function isConnectChallengeFrame(data: string): boolean {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; event?: unknown };
    return parsed?.type === 'event' && parsed?.event === 'connect.challenge';
  } catch {
    return false;
  }
}

export function isConnectStartReqFrame(data: string): boolean {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; method?: unknown };
    return parsed?.type === 'req' && (parsed?.method === 'connect.start' || parsed?.method === 'connect');
  } catch {
    return false;
  }
}

export function parseConnectReqId(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; method?: unknown; id?: unknown };
    if (parsed?.type !== 'req') return null;
    if (parsed?.method !== 'connect' && parsed?.method !== 'connect.start') return null;
    return typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : null;
  } catch {
    return null;
  }
}

export function parseResponseId(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; id?: unknown };
    if (parsed?.type !== 'res') return null;
    return typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : null;
  } catch {
    return null;
  }
}

export function parseRequestFrame(data: string): { id: string; method: string } | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; id?: unknown; method?: unknown };
    if (parsed?.type !== 'req') return null;
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
    if (typeof parsed.method !== 'string' || !parsed.method.trim()) return null;
    return { id: parsed.id, method: parsed.method };
  } catch {
    return null;
  }
}
