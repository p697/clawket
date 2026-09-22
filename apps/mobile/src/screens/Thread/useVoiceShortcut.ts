import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** A widget tap is the recording action; wait for foreground navigation and restored draft. */
export function useVoiceShortcut({ requested, scope, ready, start, consume }: {
  requested: boolean; scope: string; ready: boolean; start: () => void; consume: () => void;
}) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const request = useRef<{ scope: string; consumed: boolean } | null>(null);
  const callbacks = useRef({ start, consume });
  callbacks.current = { start, consume };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!requested) { request.current = null; return; }
    const pending = request.current ??= { scope, consumed: false };
    if (pending.consumed) return;
    if (pending.scope !== scope) {
      pending.consumed = true;
      callbacks.current.consume();
      return;
    }
    if (!ready || !foreground) return;
    // Match native picker handoff: let the opening navigation transition settle.
    const timer = setTimeout(() => {
      if (AppState.currentState !== 'active') return;
      pending.consumed = true;
      callbacks.current.consume();
      callbacks.current.start();
    }, 350);
    return () => clearTimeout(timer);
  }, [requested, scope, ready, foreground]);
}
