import { useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { triggerLightImpact } from '../services/haptics';

type Options = { phase: string; enabled: boolean; start(): void; stop(send: boolean): void; cancel(): void; focus?(): void };
type Press = { source: 'mic' | 'input'; y: number; held: boolean; ended: boolean; cancelled: boolean; active: boolean; started: number; begun: boolean };
/**
 * The mic starts capture on touch-down; release decides between a tap (keep dictating) and a hold
 * (send on release). The input area starts only once a hold is recognised, so typing never opens
 * the microphone. A hold owns its capture until a real release or cancellation.
 */
export function useVoiceGesture(options: Options) {
  const latest = useRef(options); latest.current = options;
  const press = useRef<Press | null>(null);
  const [holding, setHolding] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cleanup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = () => {
    const attempt = press.current;
    if (!attempt || attempt.ended) return;
    attempt.ended = true; attempt.cancelled = true;
    if (attempt.held || attempt.begun) latest.current.cancel();
    setHolding(false); setCancelling(false); setPressing(false);
  };
  useEffect(() => () => { clearTimeout(cleanup.current); clearTimeout(hintTimer.current); }, []);
  const handlers = (source: Press['source']) => ({
    delayLongPress: 200,
    pressRetentionOffset: { top: 600, bottom: 200, left: 200, right: 200 },
    onPressIn(event: GestureResponderEvent) {
      if (!latest.current.enabled || (press.current && !press.current.ended)) return;
      clearTimeout(cleanup.current);
      clearTimeout(hintTimer.current); setTooShort(false);
      const attempt: Press = { source, y: event.nativeEvent.pageY, held: false, ended: false, cancelled: false,
        active: latest.current.phase !== 'idle', started: Date.now(), begun: false };
      press.current = attempt;
      // The mic has no other meaning, so its touch-down is the recording start.
      if (source === 'mic' && !attempt.active) { attempt.begun = true; setPressing(true); latest.current.start(); }
    },
    onLongPress() {
      const attempt = press.current;
      if (!attempt || attempt.source !== source || attempt.active || attempt.ended || !latest.current.enabled) return;
      attempt.held = true; setHolding(true);
      if (!attempt.begun) { attempt.begun = true; attempt.started = Date.now(); latest.current.start(); }
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
      clearTimeout(cleanup.current); setPressing(false);
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
      // Touch-down already started dictation; a tap leaves it listening.
      if (attempt?.begun) return;
      // A tap on the active control sends; finalization ignores repeat taps.
      if (attempt?.active || (!attempt && latest.current.phase !== 'idle')) {
        if (latest.current.phase === 'listening') latest.current.stop(true);
      } else latest.current.start(); // Accessibility activation arrives without a touch-down.
    },
  });
  return { holding, pressing, cancelling, tooShort, handlers: handlers('mic'), inputHandlers: handlers('input') };
}
