import { useEffect, useRef, useState } from 'react';

export function useProfileRead<T>(load: () => Promise<T>, enabled: boolean, refresh: number) {
  const [state, setState] = useState<{ scope?: () => Promise<T>; value?: T; pending: boolean; failed: boolean }>({ pending: true, failed: false });
  const epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    setState(previous => ({ scope: load, value: previous.scope === load ? previous.value : undefined, pending: enabled, failed: false }));
    if (enabled) void load().then(value => { if (epoch.current === generation) setState({ scope: load, value, pending: false, failed: false }); })
      .catch(() => { if (epoch.current === generation) setState(previous => ({ ...previous, pending: false, failed: true })); });
    return () => { epoch.current++; };
  }, [load, enabled, refresh]);
  return { ...state, value: state.scope === load ? state.value : undefined, replace: (value: T) => { epoch.current++; setState({ scope: load, value, pending: false, failed: false }); } };
}

