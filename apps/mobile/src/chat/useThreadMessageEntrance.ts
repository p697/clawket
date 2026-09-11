import { useMemo, useRef } from 'react';
import type { UiMessage } from '../types/chat';
import { getTailEntranceMessageIds } from './threadMessageEntrance';

type EntranceMemory = {
  scope: string | null | undefined;
  messages: ReadonlyArray<UiMessage>;
  armed: ReadonlySet<string>;
};

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Ids of rows that should play their entrance. Ids stay armed for the life of
 * the conversation view so a re-render never replays a row, and a scope
 * change (another session) starts from a quiet, fully settled list.
 */
export function useThreadMessageEntrance(
  messages: ReadonlyArray<UiMessage>,
  scope: string | null | undefined,
): ReadonlySet<string> {
  const memoryRef = useRef<EntranceMemory>({ scope, messages, armed: NO_IDS });
  return useMemo(() => {
    const memory = memoryRef.current;
    if (memory.scope !== scope) {
      memoryRef.current = { scope, messages, armed: NO_IDS };
      return NO_IDS;
    }
    if (memory.messages === messages) return memory.armed;
    const ids = getTailEntranceMessageIds(memory.messages, messages);
    let armed = memory.armed;
    if (ids.length > 0) {
      const present = new Set(messages.map((message) => message.id));
      const next = new Set<string>();
      for (const id of memory.armed) if (present.has(id)) next.add(id);
      for (const id of ids) next.add(id);
      armed = next;
    }
    memoryRef.current = { scope, messages, armed };
    return armed;
  }, [messages, scope]);
}
