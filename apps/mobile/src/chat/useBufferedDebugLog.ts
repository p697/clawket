import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_LOG_LIMIT = 30;

export function useBufferedDebugLog(enabled: boolean, limit = DEFAULT_LOG_LIMIT) {
  const [logs, setLogs] = useState<string[]>([]);
  const enabledRef = useRef(enabled);
  const queueRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushQueue = useCallback(() => {
    flushTimerRef.current = null;
    if (!enabledRef.current) {
      queueRef.current = [];
      return;
    }

    const queued = queueRef.current.splice(0, queueRef.current.length);
    if (queued.length === 0) return;

    setLogs((prev) => [...prev, ...queued].slice(-limit));
  }, [limit]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) return;

    queueRef.current = [];
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setLogs([]);
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const appendDebugLog = useCallback((message: string) => {
    if (!enabledRef.current) return;

    queueRef.current.push(`${new Date().toLocaleTimeString()} ${message}`);
    if (flushTimerRef.current) return;

    flushTimerRef.current = setTimeout(() => {
      flushQueue();
    }, 0);
  }, [flushQueue]);

  return {
    appendDebugLog,
    logs,
  };
}
