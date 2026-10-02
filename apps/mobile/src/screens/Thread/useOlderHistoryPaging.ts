import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  scope: string;
  loading: boolean;
  blocked: boolean;
  failed: boolean;
  load?: () => void | Promise<unknown>;
  retry?: () => void | Promise<unknown>;
  onReadEarlier: () => void;
};

/** One visible request per conversation, including a pull made during a head refresh. */
export function useOlderHistoryPaging(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const active = useRef<{ scope: string } | null>(null);
  const queued = useRef<{ scope: string; manual: boolean } | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [pulledScope, setPulledScope] = useState<string | null>(null);
  const [failedScope, setFailedScope] = useState<string | null>(null);

  const request = useCallback((manual: boolean, pulled = false) => {
    const current = latest.current;
    if (active.current?.scope === current.scope || current.loading) {
      if (pulled) setPulledScope(current.scope);
      return;
    }
    if ((current.failed || failedScope === current.scope) && !manual) return;
    const load = manual && current.failed ? current.retry : current.load;
    if (!load) return;
    if (pulled) setPulledScope(current.scope);
    current.onReadEarlier();
    if (current.blocked) {
      queued.current = { scope: current.scope, manual: manual || Boolean(queued.current?.manual) };
      setPendingScope(current.scope);
      return;
    }
    queued.current = null;
    const token = { scope: current.scope };
    active.current = token;
    setPendingScope(current.scope);
    setFailedScope(null);
    const finish = () => {
      if (active.current !== token) return;
      active.current = null;
      if (latest.current.scope === current.scope) {
        setPendingScope(null);
        setPulledScope(null);
      }
    };
    const fail = () => {
      if (active.current === token && latest.current.scope === current.scope) setFailedScope(current.scope);
    };
    try {
      const result = load();
      if (result) void result.catch(fail).finally(finish);
      else finish();
    } catch {
      fail();
      finish();
    }
  }, [failedScope]);

  useEffect(() => {
    const intent = queued.current;
    if (intent?.scope !== options.scope) return;
    const load = intent.manual && options.failed ? options.retry : options.load;
    if (!load || (options.failed && !intent.manual)) {
      queued.current = null;
      setPendingScope(null);
      setPulledScope(null);
    } else if (!options.blocked && !options.loading) request(intent.manual);
  }, [options.blocked, options.failed, options.load, options.loading, options.retry, options.scope, request]);
  useEffect(() => {
    // FlashList can reach its top in the mount/layout phase. Preserve a request
    // already started for this scope before our passive setup/cleanup runs.
    setPendingScope(scope => scope === options.scope ? scope : null);
    setPulledScope(scope => scope === options.scope ? scope : null);
    setFailedScope(scope => scope === options.scope ? scope : null);
    return () => {
      if (active.current?.scope === options.scope) active.current = null;
      if (queued.current?.scope === options.scope) queued.current = null;
    };
  }, [options.scope]);

  useEffect(() => {
    if (!options.loading && pendingScope !== options.scope) setPulledScope(null);
  }, [options.loading, options.scope, pendingScope]);

  const automatic = useCallback(() => request(false), [request]);
  const manual = useCallback(() => request(true), [request]);
  const pull = useCallback(() => request(true, true), [request]);
  return {
    automatic,
    manual,
    pull,
    pulling: pulledScope === options.scope && (options.loading || pendingScope === options.scope),
    loading: options.loading || pendingScope === options.scope,
    failed: options.failed || failedScope === options.scope,
  };
}
