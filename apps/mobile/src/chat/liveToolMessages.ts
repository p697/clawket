import type { UiMessage } from '../types/chat';

/** Compare only exact wire call IDs in this run, including history's result alias. */
export function sameLiveToolCall(a: UiMessage, b: UiMessage): boolean {
  if (a.id === b.id) return true;
  if (a.role !== 'tool' || b.role !== 'tool') return false;
  const first = /^tool(?:call|result)_(.+)$/.exec(a.id)?.[1];
  const second = /^tool(?:call|result)_(.+)$/.exec(b.id)?.[1];
  return !!first && first === second;
}

export function withToolMessage(previous: UiMessage[], message: UiMessage): UiMessage[] {
  const index = previous.findIndex(candidate => sameLiveToolCall(candidate, message));
  if (index < 0) return [...previous, message];
  const next = [...previous];
  next[index] = { ...previous[index], ...message, id: previous[index].id };
  return next;
}
