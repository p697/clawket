import { useCallback, useMemo, useRef } from 'react';
import { MAX_TAIL_ENTRANCE_COUNT } from './threadMessageEntrance';

type RunEntranceMemory = {
  scope: string | null | undefined;
  keys: ReadonlyArray<string>;
  /** Whether the timeline was on screen when `keys` was recorded. */
  visible: boolean;
  armed: ReadonlySet<string>;
  played: Set<string>;
};

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * Timeline keys of scheduled / sub-agent cards that should enter with motion.
 *
 * Cards hydrate with the message cache and refresh from the network; neither
 * should move rows that were already settled. A card animates only when it
 * appears while the timeline is already visible, and a burst larger than the
 * message entrance budget is a reconciliation that lands still. Played keys are
 * latched for the conversation so cell recycling never replays a card.
 */
export function useThreadRunEntrance(
  keys: ReadonlyArray<string>,
  scope: string | null | undefined,
  visible: boolean,
): { entranceKeys: ReadonlySet<string>; claimEntrance: (key: string) => boolean } {
  const memoryRef = useRef<RunEntranceMemory>({ scope, keys, visible, armed: NO_KEYS, played: new Set() });
  const entranceKeys = useMemo(() => {
    const memory = memoryRef.current;
    if (memory.scope !== scope) {
      memoryRef.current = { scope, keys, visible, armed: NO_KEYS, played: new Set() };
      return NO_KEYS;
    }
    if (memory.keys === keys && memory.visible === visible) return memory.armed;
    let armed = memory.armed;
    if (memory.visible && visible) {
      const previous = new Set(memory.keys);
      const fresh = keys.filter((key) => !previous.has(key));
      if (fresh.length > 0 && fresh.length <= MAX_TAIL_ENTRANCE_COUNT) {
        const present = new Set(keys);
        const next = new Set<string>();
        for (const key of memory.armed) if (present.has(key)) next.add(key);
        for (const key of fresh) next.add(key);
        armed = next;
      }
    }
    memoryRef.current = { scope, keys, visible, armed, played: memory.played };
    return armed;
  }, [keys, scope, visible]);
  const claimEntrance = useCallback((key: string) => {
    const memory = memoryRef.current;
    if (memory.scope !== scope || !memory.armed.has(key) || memory.played.has(key)) return false;
    memory.played.add(key);
    return true;
  }, [scope]);
  return { entranceKeys, claimEntrance };
}
