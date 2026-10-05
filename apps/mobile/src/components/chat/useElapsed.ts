import { useEffect, useState } from 'react';

const ELAPSED_TICK_MS = 1000;

/** Milliseconds since `startMs`, refreshed once a second while there is a start. */
export function useElapsed(startMs: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startMs === undefined) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [startMs]);
  return startMs === undefined ? undefined : Math.max(0, now - startMs);
}
