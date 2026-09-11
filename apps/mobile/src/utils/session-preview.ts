import type { UiMessage } from '../types/chat';

export type SessionPreviewSnapshot = Readonly<{
  scope: string;
  messages: readonly UiMessage[];
}>;

/** Descriptors are authoritative; fallback keys cover history before roster hydration. */
export function isMainConversation(input: {
  sessionKey: string;
  mainSessionKey?: string | null;
  kind?: string;
}): boolean {
  if (input.kind && input.kind !== 'unknown' && input.kind !== 'global') {
    return input.kind === 'main';
  }
  return input.sessionKey === input.mainSessionKey || input.sessionKey === 'main'
    || /^agent:[^:]+:main$/.test(input.sessionKey);
}

function isBody(message: UiMessage): boolean {
  return (message.role === 'user' || message.role === 'assistant')
    && !message.toolName && !message.approval
    && Boolean(message.text.trim() || message.imageUris?.length || message.fileAttachments?.length);
}

/** Input is newest-first. Freeze the reading window, not streaming updates or approvals. */
export function projectSessionPreview(
  scope: string,
  messages: readonly UiMessage[],
  previous: SessionPreviewSnapshot | null,
  hasMoreHistory: boolean,
): { snapshot: SessionPreviewSnapshot; messages: UiMessage[]; hasHiddenHistory: boolean } {
  const bodies = messages.filter(isBody);
  const selected = previous?.scope === scope && previous.messages.length > 0 ? previous.messages : bodies.slice(0, 2);
  const refreshed = selected.map((saved) => bodies.find((message) => message.id === saved.id
    || (saved.idempotencyKey && message.idempotencyKey === saved.idempotencyKey)) ?? saved);
  const ids = new Set(refreshed.map((message) => message.id));
  const approvals = messages.filter((message) => message.approval?.status === 'pending');
  return {
    snapshot: { scope, messages: refreshed },
    messages: [...approvals, ...refreshed],
    hasHiddenHistory: hasMoreHistory || messages.some((message) => !ids.has(message.id) && !message.approval),
  };
}
