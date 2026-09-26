import { useEffect, useRef, useState } from 'react';

/** Covers the native tail fade of the last streamed words (about 250 ms on iOS). */
export const STREAM_SETTLE_HOLD_MS = 320;

/**
 * Keeps a reply in streaming presentation for a moment after its paced text
 * caught up. Ending the stream and publishing the final words in one commit
 * snaps the running fade, shows the last words without one and, on iOS,
 * re-measures before they are drawn. Held, the final words still fade in and
 * the mode switch later lands in a commit where the text itself is unchanged.
 * A different identity (a recycled row, another message) never inherits the
 * hold, and history rows that were never active start settled.
 */
export function useStreamingSettleHold(
  active: boolean,
  identity: string,
  holdMs = STREAM_SETTLE_HOLD_MS,
): boolean {
  const [, refresh] = useState(0);
  const memory = useRef({ identity, active, until: 0 });
  const previous = memory.current;
  if (previous.identity !== identity) {
    memory.current = { identity, active, until: 0 };
  } else if (previous.active !== active) {
    memory.current = { identity, active, until: active ? 0 : Date.now() + holdMs };
  }
  const until = memory.current.until;
  const holding = !active && Date.now() < until;
  useEffect(() => {
    if (!holding) return undefined;
    const timer = setTimeout(() => refresh((revision) => revision + 1), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [holding, until]);
  return active || holding;
}
