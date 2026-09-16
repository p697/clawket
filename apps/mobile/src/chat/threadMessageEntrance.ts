import type { UiMessage } from '../types/chat';

/** More new tail rows than this is a reconciliation, not a conversation beat. */
export const MAX_TAIL_ENTRANCE_COUNT = 3;

function entranceSignature(message: UiMessage): string {
  const text = message.text?.trim() ?? '';
  const attachments = (message.imageUris?.length ?? 0) + (message.fileAttachments?.length ?? 0);
  const tool = message.role === 'tool' ? message.toolName ?? '' : '';
  return `${message.role}|${tool}|${text}|${attachments}`;
}

/**
 * Ids that appeared at the newest end of the timeline since the previous
 * render and should enter with motion. Both lists are newest-first.
 *
 * - An empty previous list is an initial load: nothing animates.
 * - Rows inserted above the previous newest row are history paging.
 * - A row whose content matches a row that vanished in the same update is an
 *   id swap (optimistic → server, streaming → final) and must not replay.
 * - A streaming reply that settles under a new id keeps its place even when
 *   the final text differs from the last streamed chunk; an empty placeholder
 *   replaced by a whole reply is a new arrival and does enter.
 * - More than `maxCount` new tail rows is a bulk reconciliation.
 */
export function getTailEntranceMessageIds(
  previous: ReadonlyArray<UiMessage>,
  next: ReadonlyArray<UiMessage>,
  maxCount = MAX_TAIL_ENTRANCE_COUNT,
): string[] {
  if (previous.length === 0 || next.length === 0) return [];
  const previousIds = new Set(previous.map((message) => message.renderKey ?? message.id));
  const nextIds = new Set(next.map((message) => message.renderKey ?? message.id));
  const tailNew: UiMessage[] = [];
  for (const message of next) {
    if (previousIds.has(message.renderKey ?? message.id)) break;
    tailNew.push(message);
  }
  if (tailNew.length === 0 || tailNew.length > maxCount) return [];

  const removedSignatures = new Map<string, number>();
  let removedStreamingReplies = 0;
  for (const message of previous) {
    if (nextIds.has(message.renderKey ?? message.id)) continue;
    if (message.role === 'assistant' && message.streaming && message.text.trim().length > 0) removedStreamingReplies += 1;
    const signature = entranceSignature(message);
    removedSignatures.set(signature, (removedSignatures.get(signature) ?? 0) + 1);
  }

  const ids: string[] = [];
  for (const message of tailNew) {
    const signature = entranceSignature(message);
    const available = removedSignatures.get(signature) ?? 0;
    if (available > 0) {
      removedSignatures.set(signature, available - 1);
      continue;
    }
    if (message.role === 'assistant' && !message.streaming && removedStreamingReplies > 0) {
      removedStreamingReplies -= 1;
      continue;
    }
    ids.push(message.renderKey ?? message.id);
  }
  return ids;
}
