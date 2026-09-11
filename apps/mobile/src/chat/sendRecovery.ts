import { useEffect, useSyncExternalStore } from 'react';
import type { UiMessage } from '../types/chat';

// Failed acknowledgements are not proof that a backend rejected the message.
// Keep the original bubble across navigation, but never enqueue an automatic retry.
const empty: readonly UiMessage[] = Object.freeze([]);
const scopes = new Map<string, readonly UiMessage[]>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function rememberUncertainSend(scope: string | null, message: UiMessage): void {
  if (!scope) return;
  const previous = scopes.get(scope) ?? empty;
  scopes.set(scope, [...previous.filter((item) => item.id !== message.id), { ...message, sendUncertain: true }]);
  listeners.forEach((listener) => listener());
}

export function clearUncertainSends(connectionId: string): void {
  for (const scope of scopes.keys()) {
    if (scope.startsWith(`${connectionId}\u0000`)) scopes.delete(scope);
  }
  listeners.forEach((listener) => listener());
}

function hasBackendEcho(history: readonly UiMessage[], message: UiMessage): boolean {
  return history.some((candidate) => candidate.role === 'user'
    && candidate.id !== message.id && Boolean(message.idempotencyKey)
    && candidate.idempotencyKey === message.idempotencyKey);
}

export function useUncertainSends(scope: string | null, history: readonly UiMessage[] = empty): readonly UiMessage[] {
  const messages = useSyncExternalStore(subscribe, () => scope ? scopes.get(scope) ?? empty : empty);
  useEffect(() => {
    if (!scope || !messages.length) return;
    const remaining = messages.filter((message) => !hasBackendEcho(history, message));
    if (remaining.length === messages.length) return;
    if (remaining.length) scopes.set(scope, remaining);
    else scopes.delete(scope);
    listeners.forEach((listener) => listener());
  }, [scope, history, messages]);
  return messages;
}

/** Backend echoes replace local uncertainty only with matching identity, never guessed text. */
export function recoverUncertainSends(history: readonly UiMessage[], uncertain: readonly UiMessage[]): UiMessage[] {
  const result = [...history];
  for (const message of uncertain) {
    const confirmed = hasBackendEcho(history, message);
    if (confirmed) {
      const local = result.findIndex((candidate) => candidate.id === message.id);
      if (local >= 0) result.splice(local, 1);
      continue;
    }
    const index = result.findIndex((candidate) => candidate.id === message.id);
    if (index >= 0) result[index] = { ...result[index], sendUncertain: true };
    else {
      const insertion = result.findIndex((candidate) => (candidate.timestampMs ?? 0) > (message.timestampMs ?? 0));
      result.splice(insertion < 0 ? result.length : insertion, 0, { ...message, sendUncertain: true });
    }
  }
  return result;
}
