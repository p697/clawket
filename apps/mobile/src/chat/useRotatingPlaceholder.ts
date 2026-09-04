import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * i18n keys for the rotating "agent is working" placeholder messages.
 * Each key maps to a fun, personality-rich line in all 6 locales.
 */
const AGENT_WORKING_KEYS = [
  'agent_working_1',
  'agent_working_2',
  'agent_working_3',
  'agent_working_4',
  'agent_working_5',
  'agent_working_6',
  'agent_working_7',
  'agent_working_8',
  'agent_working_9',
  'agent_working_10',
  'agent_working_11',
  'agent_working_12',
  'agent_working_13',
  'agent_working_14',
  'agent_working_15',
  'agent_working_16',
  'agent_working_17',
  'agent_working_18',
  'agent_working_19',
  'agent_working_20',
] as const;

const ROTATE_INTERVAL_MS = 3000;

function pickRandomIndex(exclude: number, length: number): number {
  if (length <= 1) return 0;
  let next: number;
  do {
    next = Math.floor(Math.random() * length);
  } while (next === exclude);
  return next;
}

/**
 * Returns a rotating translated placeholder string while `active` is true.
 * Picks a random message on activation and rotates every few seconds.
 */
export function useRotatingPlaceholder(active: boolean): string {
  const { t } = useTranslation('chat');
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * AGENT_WORKING_KEYS.length),
  );
  const indexRef = useRef(index);
  indexRef.current = index;

  const rotate = useCallback(() => {
    setIndex((prev) => pickRandomIndex(prev, AGENT_WORKING_KEYS.length));
  }, []);

  // Pick a fresh random message each time we become active
  useEffect(() => {
    if (!active) return;
    rotate();
  }, [active, rotate]);

  // Rotate on interval while active
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(rotate, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, rotate]);

  return t(AGENT_WORKING_KEYS[index]);
}
