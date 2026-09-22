import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usageTimeZone } from '../../services/usage-time-zone';
import { formatIsoDate } from './usage-model';

const currentDate = () => new Date();

/** Refresh a mounted page across midnight, travel, or a return from the background. */
export function useUsageCalendar(now: () => Date = currentDate): { key: string; revision: number } {
  const nowRef = useRef(now);
  nowRef.current = now;
  const readKey = () => {
    const date = nowRef.current();
    return `${formatIsoDate(date)}:${JSON.stringify(usageTimeZone(date))}`;
  };
  const [calendar, setCalendar] = useState(() => ({ key: readKey(), revision: 0 }));
  useEffect(() => {
    const update = (foreground = false) => {
      const key = readKey();
      setCalendar((previous) => key === previous.key && !foreground
        ? previous : { key, revision: previous.revision + 1 });
    };
    const timer = setInterval(() => update(), 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') update(true); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  return calendar;
}
