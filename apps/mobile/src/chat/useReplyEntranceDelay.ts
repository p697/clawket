import { useEffect, useRef, useState } from 'react';
import type { UiMessage } from '../types/chat';

export const REPLY_ENTRANCE_DELAY_MS = 1000;

/** Stagger presentation only: sending and stream consumption continue immediately. */
export function useReplyEntranceDelay(
  messages: ReadonlyArray<UiMessage>,
  scope: string | null | undefined,
  submittedAt: number | null | undefined,
  reduceMotion: boolean,
): { messages: ReadonlyArray<UiMessage>; holding: boolean } {
  const [, refresh] = useState(0);
  const memory = useRef({ scope, submittedAt, messages, baseline: new Set<string>(), until: 0 });
  const previous = memory.current;
  if (previous.scope !== scope) {
    memory.current = { scope, submittedAt, messages, baseline: new Set(), until: 0 };
  } else if (submittedAt != null && submittedAt !== previous.submittedAt) {
    memory.current = {
      scope, submittedAt, messages,
      baseline: new Set(previous.messages.map((message) => message.id)),
      until: submittedAt + REPLY_ENTRANCE_DELAY_MS,
    };
  } else {
    previous.messages = messages;
  }
  const until = memory.current.until;
  const holding = !reduceMotion && Date.now() < until;
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => refresh((revision) => revision + 1), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [holding, until]);
  return {
    holding,
    messages: holding ? messages.filter((message) => message.role === 'user' || memory.current.baseline.has(message.id)) : messages,
  };
}
