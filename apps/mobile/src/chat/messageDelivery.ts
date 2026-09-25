import { isIncomingParticipant } from './messageAttribution';
import type { UiMessage } from '../types/chat';

/**
 * Delivery state from local acceptance through backend acknowledgement:
 * a clock while queued/in flight, pause when held, one check once the backend
 * accepted it, two checks once the Agent has visibly picked it up.
 */
export type UserMessageStatus = 'queued' | 'held' | 'sending' | 'sent' | 'delivered' | 'uncertain';

export type ResolveUserMessageStatusInput = Readonly<{
  /** Newest-first, as the Thread renders it. */
  messages: ReadonlyArray<UiMessage>;
  index: number;
  /** Optimistic ids whose prompt the backend has not acknowledged yet. */
  unconfirmedIds?: ReadonlySet<string> | null;
  /** True once the backend reported the run that answers the newest user turn. */
  runAcknowledged?: boolean;
}>;

function isVisibleAgentActivity(message: UiMessage): boolean {
  if (message.role === 'tool') return true;
  if (message.role === 'assistant') return message.text.trim().length > 0;
  return false;
}

function isSettledUserMessage(message: UiMessage): boolean {
  return message.role === 'user' && !message.delivery;
}

/**
 * Local and acknowledged messages use the same fixed-size status slot.
 */
export function resolveUserMessageStatus({
  messages,
  index,
  unconfirmedIds,
  runAcknowledged = false,
}: ResolveUserMessageStatusInput): UserMessageStatus | null {
  const message = messages[index];
  if (!message || message.role !== 'user' || isIncomingParticipant(message)) return null;
  if (message.delivery) return message.delivery;
  if (message.sendUncertain) return 'uncertain';
  if (unconfirmedIds?.has(message.id)) return 'sending';
  // Anything the Agent produced after this turn proves it was received.
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const newer = messages[cursor]!;
    if (isSettledUserMessage(newer)) break;
    if (isVisibleAgentActivity(newer)) return 'delivered';
  }
  // The newest turn is also delivered once the backend reported its run,
  // even before the first token or tool call arrives.
  const newestUserIndex = messages.findIndex(isSettledUserMessage);
  if (runAcknowledged && newestUserIndex === index) return 'delivered';
  return 'sent';
}

/** Status for every user message, keyed by id. */
export function resolveUserMessageStatuses(
  input: Omit<ResolveUserMessageStatusInput, 'index'>,
): ReadonlyMap<string, UserMessageStatus> {
  const statuses = new Map<string, UserMessageStatus>();
  input.messages.forEach((message, index) => {
    const status = resolveUserMessageStatus({ ...input, index });
    if (status) statuses.set(message.id, status);
  });
  return statuses;
}
