import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { createStreamTextPacer, type StreamTextPacer } from './streamTextPacer';

export const SMOOTHED_STREAM_TEXT_TICK_MS = 33;

// Every published update makes the native markdown view re-parse the full
// text (O(N) per update), so publishing at 30Hz multiplies into heavy UI work
// on long texts. Interval publishes are therefore decimated by target length
// while the pacer still ticks every interval, keeping pacing state accurate:
// short texts publish every tick, medium every 2nd, longer every 3rd.
export const EMIT_EVERY_TICK_MAX_CHARS = 2_000;
export const EMIT_EVERY_SECOND_TICK_MAX_CHARS = 6_000;

function emitStrideForLength(targetLength: number): number {
  if (targetLength < EMIT_EVERY_TICK_MAX_CHARS) return 1;
  if (targetLength <= EMIT_EVERY_SECOND_TICK_MAX_CHARS) return 2;
  return 3;
}

/**
 * Smooths chunky streaming message text into a steady, word-aligned
 * typewriter flow driven by a single 33ms interval.
 *
 * Fast path: when the message is not streaming and no catch-up animation is
 * in flight, the hook returns `targetText` directly and owns no pacer and no
 * timers, so history messages render with zero overhead. Rows recycled onto
 * a different message (non-prefix target) snap instantly via the pacer's
 * setTarget semantics plus a render-time prefix guard.
 */
export function useSmoothedStreamText(targetText: string, isStreaming: boolean): string {
  const pacerRef = useRef<StreamTextPacer | null>(null);
  const [animatedText, setAnimatedText] = useState('');
  // True while an interval-driven animation is in flight: streaming, or the
  // post-stream catch-up drain.
  const [animating, setAnimating] = useState(false);
  const lastOutputRef = useRef(targetText);
  const tickCountRef = useRef(0);
  const targetLengthRef = useRef(targetText.length);
  targetLengthRef.current = targetText.length;
  // With the system reduce-motion preference on, the typewriter reveal is
  // skipped entirely: chunks render as they arrive and no timers run (the
  // native tail fade honors the same preference on its side).
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!reducedMotion) return;
    pacerRef.current = null;
    setAnimating(false);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    let pacer = pacerRef.current;
    if (pacer === null) {
      if (!isStreaming) return;
      // Seed with the text already on screen so a stream resuming on the
      // same message does not replay it from the beginning.
      pacer = createStreamTextPacer({ initialText: lastOutputRef.current });
      pacerRef.current = pacer;
      tickCountRef.current = 0;
    }
    pacer.setTarget(targetText, isStreaming);
    const next = pacer.tick(Date.now());
    setAnimatedText((previous) => (previous === next ? previous : next));
    if (pacer.isSettled()) {
      pacerRef.current = null;
      setAnimating(false);
    } else {
      setAnimating(true);
    }
  }, [reducedMotion, targetText, isStreaming]);

  const active = !reducedMotion && (isStreaming || animating);

  useEffect(() => {
    if (!active) return;
    const intervalId = setInterval(() => {
      const pacer = pacerRef.current;
      if (pacer === null) return;
      const next = pacer.tick(Date.now());
      const settled = pacer.isSettled();
      tickCountRef.current += 1;
      // Settling always publishes so the final text lands immediately.
      if (settled || tickCountRef.current % emitStrideForLength(targetLengthRef.current) === 0) {
        setAnimatedText((previous) => (previous === next ? previous : next));
      }
      if (settled) {
        pacerRef.current = null;
        setAnimating(false);
      }
    }, SMOOTHED_STREAM_TEXT_TICK_MS);
    return () => clearInterval(intervalId);
  }, [active]);

  // The prefix guard prevents one frame of stale text when FlashList recycles
  // this row onto another message before the effects above have caught up.
  const output =
    active && pacerRef.current !== null && targetText.startsWith(animatedText)
      ? animatedText
      : targetText;
  lastOutputRef.current = output;
  return output;
}
