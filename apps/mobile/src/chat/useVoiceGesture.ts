import { useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { triggerLightImpact } from '../services/haptics';

type Options = { phase: string; enabled: boolean; start(): void; stop(send: boolean): void; cancel(): void; focus?(): void };
type Press = { source: 'mic' | 'input'; y: number; held: boolean; ended: boolean; cancelled: boolean; active: boolean; started: number };
/** Tap commits on release. A hold owns its capture until a real release or cancellation. */
export function useVoiceGesture(options: Options) {
  const latest = useRef(options); latest.current = options;
  const press = useRef<Press | null>(null);
  const [holding, setHolding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cleanup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = () => {
    const attempt = press.current;
    if (!attempt || attempt.ended) return;
    attempt.ended = true; attempt.cancelled = true;
    if (attempt.held) latest.current.cancel();
    setHolding(false); setCancelling(false);
  };
  useEffect(() => () => { clearTimeout(cleanup.current); clearTimeout(hintTimer.current); }, []);
  const handlers = (source: Press['source']) => ({
    delayLongPress: 200,
    pressRetentionOffset: { top: 600, bottom: 200, left: 200, right: 200 },
    onPressIn(event: GestureResponderEvent) {
      if (!latest.current.enabled || (press.current && !press.current.ended)) return;
      clearTimeout(cleanup.current);
      clearTimeout(hintTimer.current); setTooShort(false);
      press.current = { source, y: event.nativeEvent.pageY, held: false, ended: false, cancelled: false,
        active: latest.current.phase !== 'idle', started: Date.now() };
    },
    onLongPress() {
      const attempt = press.current;
      if (!attempt || attempt.source !== source || attempt.active || attempt.ended || !latest.current.enabled) return;
      attempt.held = true; attempt.started = Date.now();
      setHolding(true); triggerLightImpact(); latest.current.start();
    },
    onTouchMove(event: GestureResponderEvent) {
      const attempt = press.current;
      if (!attempt?.held || attempt.source !== source || attempt.ended) return;
      const distance = attempt.y - event.nativeEvent.pageY;
      const cancel = attempt.cancelled ? distance > 60 : distance >= 80;
      if (attempt.cancelled !== cancel) { attempt.cancelled = cancel; setCancelling(cancel); triggerLightImpact(); }
    },
    onTouchEnd() {
      const attempt = press.current;
      if (!attempt || attempt.source !== source || attempt.ended) return;
      // onPress is authoritative for taps; onTouchEnd may be delivered before or after it.
      if (!attempt.held) return;
      attempt.ended = true;
      if (latest.current.phase !== 'transcribing') {
        const short = Date.now() - attempt.started < 400;
        if (attempt.cancelled || short || latest.current.phase !== 'listening') latest.current.cancel();
        else latest.current.stop(true);
        if (short && !attempt.cancelled) {
          setTooShort(true);
          hintTimer.current = setTimeout(() => setTooShort(false), 1400);
        }
      }
      setHolding(false); setCancelling(false);
    },
    onTouchCancel: abort,
    onPressOut() {
      clearTimeout(cleanup.current);
      const attempt = press.current;
      cleanup.current = setTimeout(() => {
        if (press.current !== attempt) return;
        if (!attempt?.ended) abort();
        press.current = null;
      }, 0);
    },
    onPress() {
      const attempt = press.current;
      if (attempt && attempt.source !== source) return;
      if (attempt?.held || attempt?.ended || attempt?.cancelled || !latest.current.enabled) return;
      if (attempt) attempt.ended = true;
      if (source === 'input') { if (latest.current.phase === 'idle') latest.current.focus?.(); return; }
      // Ignore repeat taps during setup/finalization instead of cancelling permission or native start.
      if (attempt?.active || (!attempt && latest.current.phase !== 'idle')) {
        if (latest.current.phase === 'listening') latest.current.stop(true);
      } else latest.current.start();
    },
  });
  return { holding, cancelling, tooShort, handlers: handlers('mic'), inputHandlers: handlers('input') };
}
