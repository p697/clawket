import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AgentAdapter } from '@clawket/agent-protocol';
import type { UiMessage } from '../types/chat';

// Failed acknowledgements are not proof that a backend rejected the message.
// Keep the original bubble across navigation, but never enqueue an automatic retry.
const empty: readonly UiMessage[] = Object.freeze([]);
const noReceipts: ReadonlyMap<string, string> = new Map();
const scopes = new Map<string, readonly UiMessage[]>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function rememberUncertainSend(scope: string | null, message: UiMessage): void {
  if (!scope) return;
  const previous = scopes.get(scope) ?? empty;
  scopes.set(scope, [...previous.filter((item) => item.id !== message.id), { ...message, sendUncertain: true }]);
  listeners.forEach((listener) => listener());
}

/** Bounded, read-only reconciliation. Receipt metadata never authorizes a resend. */
export async function reconcilePromptReceipts(
  adapter: AgentAdapter,
  scope: string,
  sessionKey: string,
  messages: readonly UiMessage[],
  isCurrent: () => boolean,
): Promise<ReadonlyMap<string, string>> {
  if (!adapter.capabilities.promptStatus || !adapter.getPromptStatus) return noReceipts;
  const receipts = new Map<string, string>();
  for (const message of messages.filter(item => item.sendUncertain && item.idempotencyKey && !item.bridgeRecordedRunId).slice(-5)) {
    if (!isCurrent()) return noReceipts;
    try {
      const result = await adapter.getPromptStatus(sessionKey, message.idempotencyKey!);
      if (!isCurrent()) return noReceipts;
      if (result.status === 'recorded' && typeof result.runId === 'string' && result.runId.length > 0 && result.runId.length <= 200) receipts.set(message.idempotencyKey!, result.runId);
    } catch { /* An unavailable lookup supplies no delivery evidence. */ }
  }
  if (!isCurrent() || !receipts.size) return noReceipts;
  const current = scopes.get(scope);
  if (current) {
    scopes.set(scope, current.map(message => message.idempotencyKey && receipts.has(message.idempotencyKey)
      ? { ...message, bridgeRecordedRunId: receipts.get(message.idempotencyKey), sendUncertain: true } : message));
    listeners.forEach(listener => listener());
  }
  // Cold-start callers merge only this identity metadata into their existing
  // history state. No second transcript cache is created.
  return receipts;
}

export function clearUncertainSends(connectionId: string): void {
  for (const scope of scopes.keys()) {
    if (scope.startsWith(`${connectionId}\u0000`)) scopes.delete(scope);
  }
  listeners.forEach((listener) => listener());
}

export function hasBackendEcho(history: readonly UiMessage[], message: UiMessage): boolean {
  return history.some((candidate) => candidate.role === 'user'
    && !candidate.sendUncertain
    && candidate.id !== message.id && Boolean(message.idempotencyKey)
    && candidate.idempotencyKey === message.idempotencyKey);
}

export function useUncertainSends(scope: string | null, history: readonly UiMessage[] = empty): readonly UiMessage[] {
  const messages = useSyncExternalStore(subscribe, () => scope ? scopes.get(scope) ?? empty : empty);
  const cached = useMemo(() => {
    if (!scope) return empty;
    const remembered = new Set(messages.flatMap(message => message.idempotencyKey ? [message.idempotencyKey] : []));
    // The existing chat cache already retains uncertainty and original send IDs.
    // Use those loaded rows as bounded query candidates, without copying their
    // text into another persistent store or inventing a new request identity.
    // Bound the newest 20 before excluding held rows, so holding them never admits older ones.
    return history.filter(message => message.role === 'user' && message.sendUncertain
      && typeof message.idempotencyKey === 'string' && message.idempotencyKey.length > 0
      && message.idempotencyKey.length <= 200)
      .slice(-20).filter(message => !remembered.has(message.idempotencyKey!) && !hasBackendEcho(history, message));
  }, [scope, history, messages]);
  const recoverable = useMemo(() => (cached.length ? [...messages, ...cached] : messages), [cached, messages]);
  useEffect(() => {
    // The first history read after a cold start replaces every restored cache
    // row. Hold the unconfirmed ones here, as for a failure in this run, so they
    // stay visible (and cached) until the computer echoes their exact identity.
    if (!scope || !cached.length) return;
    const previous = scopes.get(scope) ?? empty;
    const known = new Set(previous.flatMap(message => message.idempotencyKey ? [message.idempotencyKey] : []));
    const additions = cached.filter(message => message.idempotencyKey && !known.has(message.idempotencyKey));
    if (!additions.length) return;
    scopes.set(scope, [...previous, ...additions.map(message => ({ ...message, sendUncertain: true as const }))]);
    listeners.forEach((listener) => listener());
  }, [scope, cached]);
  useEffect(() => {
    if (!scope || !messages.length) return;
    const remaining = messages.filter((message) => !hasBackendEcho(history, message));
    if (remaining.length === messages.length) return;
    if (remaining.length) scopes.set(scope, remaining);
    else scopes.delete(scope);
    listeners.forEach((listener) => listener());
  }, [scope, history, messages]);
  return recoverable;
}

/** Backend echoes replace local uncertainty only with matching identity, never guessed text. */
export function recoverUncertainSends(history: readonly UiMessage[], uncertain: readonly UiMessage[]): UiMessage[] {
  const result = history.filter(message => !message.sendUncertain || !hasBackendEcho(history, message));
  for (const message of uncertain) {
    const isLocalCopy = (candidate: UiMessage) => candidate.id === message.id
      || (candidate.sendUncertain && Boolean(message.idempotencyKey)
        && candidate.idempotencyKey === message.idempotencyKey);
    const confirmed = hasBackendEcho(history, message);
    if (confirmed) {
      for (let index = result.length - 1; index >= 0; index -= 1) {
        if (isLocalCopy(result[index])) result.splice(index, 1);
      }
      continue;
    }
    const index = result.findIndex(isLocalCopy);
    if (index >= 0) result[index] = { ...result[index], id: message.id, bridgeRecordedRunId: message.bridgeRecordedRunId, sendUncertain: true };
    else {
      const insertion = result.findIndex((candidate) => (candidate.timestampMs ?? 0) > (message.timestampMs ?? 0));
      result.splice(insertion < 0 ? result.length : insertion, 0, { ...message, sendUncertain: true });
    }
  }
  return result;
}
