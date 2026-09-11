/**
 * Smooths chunky streaming-text arrivals (socket frames of arbitrary size) into a
 * steady, word-aligned typewriter flow, following the llm-ui `throttleBasic`
 * idea: estimate the arrival rate over a sliding window, consume characters
 * at that rate while keeping a small undisplayed buffer, and only cut the
 * visible prefix at word boundaries.
 *
 * The pacer is fully deterministic: all timing comes from the `nowMs`
 * argument of `tick`, so callers own the clock (a real interval in the app,
 * fake timers in tests).
 */

export type StreamTextPacer = {
  /**
   * Replace the target text. When the currently shown text is no longer a
   * prefix of the new target (regenerate / recovery replacement), the pacer
   * snaps straight to the full new text instead of animating.
   */
  setTarget: (text: string, isStreaming: boolean) => void;
  /** Advance the clock to `nowMs` and return the prefix that should render. */
  tick: (nowMs: number) => string;
  /** True once streaming ended and the shown text fully caught up. */
  isSettled: () => boolean;
};

export type StreamTextPacerOptions = {
  /** Text already rendered when the pacer takes over; never re-animated. */
  initialText?: string;
  /** Test hook: force the non-`Intl.Segmenter` fallback segmentation. */
  disableIntlSegmenter?: boolean;
};

// Sliding-window length for the arrival-rate estimate.
const RATE_WINDOW_MS = 2_000;
// Consumption rate used until enough arrivals have been observed.
const DEFAULT_CHARS_PER_SECOND = 80;
const MIN_CHARS_PER_SECOND = 20;
const MAX_CHARS_PER_SECOND = 400;
// Undisplayed-buffer size the pacer tries to maintain while streaming.
const TARGET_BUFFER_CHARS = 10;
// Rate correction applied when the buffer drifts off its target size.
const RATE_ADJUST_FRACTION = 0.2;
// Tail characters withheld while streaming (last word may still change).
export const HOLD_BACK_CHARS = 10;
// Rate multiplier used to drain the remaining buffer once streaming ends.
const CATCH_UP_RATE_MULTIPLIER = 3;
// Backlogs beyond this snap forward instead of animating (recovery jumps).
export const MAX_BACKLOG_CHARS = 600;
// Real time between ticks is capped so a backgrounded app cannot dump a huge
// burst of text on the first tick after resume.
const MAX_TICK_DELTA_MS = 250;
// Minimum span for the rate estimate so a couple of early samples cannot
// spike it far above the true arrival rate.
const MIN_RATE_SPAN_MS = 300;
// Buffer sizes within targetBufferChars +/- this deadband leave the rate
// untouched, avoiding oscillation around the setpoint.
const BUFFER_DEADBAND_CHARS = 2;
// Unbroken runs longer than this (URLs, base64 blobs) get forced cut points
// so display keeps advancing and tail re-segmentation stays bounded.
const FORCE_BREAK_CHARS = 200;

type SegmentEnds = (region: string) => number[];

function createIntlSegmentEnds(): SegmentEnds | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    return null;
  }
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return (region: string): number[] => {
      const ends: number[] = [];
      for (const part of segmenter.segment(region)) {
        ends.push(part.index + part.segment.length);
      }
      return ends;
    };
  } catch {
    return null;
  }
}

// Scripts written without inter-word spaces; the fallback advances through
// them one character at a time instead of waiting for whitespace.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x2eff], // CJK Radicals Supplement
  [0x3000, 0x303f], // CJK Symbols and Punctuation
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0x3130, 0x318f], // Hangul Compatibility Jamo
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xac00, 0xd7af], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
  [0x20000, 0x2ffff], // CJK Extensions B..F
];

function isCjkCodePoint(codePoint: number): boolean {
  for (const [start, end] of CJK_RANGES) {
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
}

function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

export function fallbackSegmentEnds(region: string): number[] {
  const ends: number[] = [];
  let index = 0;
  while (index < region.length) {
    const codePoint = region.codePointAt(index) ?? 0;
    const codePointLength = codePoint > 0xffff ? 2 : 1;
    if (isCjkCodePoint(codePoint)) {
      index += codePointLength;
    } else if (isWhitespaceChar(region[index])) {
      index += 1;
      while (index < region.length && isWhitespaceChar(region[index])) {
        index += 1;
      }
    } else {
      index += codePointLength;
      while (index < region.length) {
        const next = region.codePointAt(index) ?? 0;
        if (isCjkCodePoint(next) || isWhitespaceChar(region[index])) break;
        index += next > 0xffff ? 2 : 1;
      }
    }
    ends.push(index);
  }
  return ends;
}

type ArrivalSample = {
  atMs: number;
  chars: number;
};

export function createStreamTextPacer(options: StreamTextPacerOptions = {}): StreamTextPacer {
  const { initialText = '', disableIntlSegmenter = false } = options;

  const segmentEnds: SegmentEnds = disableIntlSegmenter
    ? fallbackSegmentEnds
    : (createIntlSegmentEnds() ?? fallbackSegmentEnds);

  let target = initialText;
  let shownLength = initialText.length;
  let streaming = false;
  // Word-boundary cut points (absolute indices into `target`), computed
  // incrementally: `finalizedUpTo` marks how far segmentation is final, so
  // each setTarget only segments the new/unstable tail, never the full text.
  let boundaries: number[] = [];
  let boundaryCursor = 0;
  let finalizedUpTo = initialText.length;
  // Fractional characters accrued but not yet consumed (carries across ticks
  // so slow rates still make progress at word granularity).
  let budget = 0;
  let lastTickMs: number | null = null;
  let pendingArrivalChars = 0;
  let samples: ArrivalSample[] = [];
  // Cache of the last returned prefix. Ticks that do not advance return the
  // same string value, so consumer equality checks hit the engine's identity
  // fast path instead of comparing the full text, and no slice is allocated.
  // Valid because `setTarget` either preserves the first `shownLength` chars
  // or goes through `hardReset`, which re-seeds the cache.
  let shownText = initialText;

  function shownPrefix(): string {
    if (shownText.length !== shownLength) {
      shownText = target.slice(0, shownLength);
    }
    return shownText;
  }

  function isSettled(): boolean {
    return !streaming && shownLength >= target.length;
  }

  function hardReset(text: string): void {
    target = text;
    shownLength = text.length;
    shownText = text;
    boundaries = [];
    boundaryCursor = 0;
    finalizedUpTo = text.length;
    budget = 0;
    pendingArrivalChars = 0;
    samples = [];
  }

  function rollbackBoundariesTo(position: number): void {
    let keep = boundaries.length;
    while (keep > 0 && boundaries[keep - 1] > position) {
      keep -= 1;
    }
    boundaries.length = keep;
    if (boundaryCursor > keep) boundaryCursor = keep;
    finalizedUpTo = position;
  }

  function pushBoundaryWithForcedBreaks(end: number, lastFinal: number): number {
    let cursor = lastFinal;
    while (end - cursor > FORCE_BREAK_CHARS) {
      cursor += FORCE_BREAK_CHARS;
      boundaries.push(cursor);
    }
    boundaries.push(end);
    return end;
  }

  function extendBoundaries(): void {
    const stableLimit = streaming ? target.length - HOLD_BACK_CHARS : target.length;
    let lastFinal = finalizedUpTo;
    if (stableLimit > lastFinal) {
      const regionStart = lastFinal;
      for (const relativeEnd of segmentEnds(target.slice(regionStart))) {
        const end = regionStart + relativeEnd;
        // The final segment can still grow while streaming; never finalize it.
        if (end > stableLimit || (streaming && end >= target.length)) break;
        lastFinal = pushBoundaryWithForcedBreaks(end, lastFinal);
      }
      if (streaming) {
        // Keep making progress through unbroken runs (URLs, base64 blobs)
        // whose next natural boundary is still far beyond the stable zone.
        while (stableLimit - lastFinal >= FORCE_BREAK_CHARS) {
          lastFinal += FORCE_BREAK_CHARS;
          boundaries.push(lastFinal);
        }
      }
    }
    finalizedUpTo = lastFinal;
  }

  function setTarget(text: string, isStreaming: boolean): void {
    const wasSettled = isSettled();
    const previousTarget = target;
    const wasStreaming = streaming;
    streaming = isStreaming;

    if (text === previousTarget) {
      if (wasStreaming && !isStreaming) {
        extendBoundaries();
      }
      return;
    }

    if (wasSettled && !isStreaming) {
      // Non-streaming replacement on a settled pacer (history render, edit):
      // show it instantly, never animate.
      hardReset(text);
      return;
    }

    if (!text.startsWith(previousTarget.slice(0, shownLength))) {
      // Shown text is not a prefix of the new target (regenerate / recovery
      // replacement): jump straight to the new full text.
      hardReset(text);
      return;
    }

    if (
      finalizedUpTo > shownLength &&
      !text.startsWith(previousTarget.slice(0, finalizedUpTo))
    ) {
      // The unshown-but-segmented tail was rewritten; its boundaries no
      // longer describe the new target.
      rollbackBoundariesTo(shownLength);
    }

    pendingArrivalChars += Math.max(0, text.length - previousTarget.length);
    target = text;
    extendBoundaries();
  }

  function advanceToBoundary(limit: number): number {
    let advanced = shownLength;
    while (boundaryCursor < boundaries.length && boundaries[boundaryCursor] <= limit) {
      advanced = boundaries[boundaryCursor];
      boundaryCursor += 1;
    }
    return advanced > shownLength ? advanced : shownLength;
  }

  function estimateRate(nowMs: number): number {
    if (samples.length < 2) {
      return DEFAULT_CHARS_PER_SECOND;
    }
    let windowChars = 0;
    for (const sample of samples) {
      windowChars += sample.chars;
    }
    const spanMs = Math.max(nowMs - samples[0].atMs, MIN_RATE_SPAN_MS);
    const raw = (windowChars * 1000) / spanMs;
    return Math.min(Math.max(raw, MIN_CHARS_PER_SECOND), MAX_CHARS_PER_SECOND);
  }

  function tick(nowMs: number): string {
    if (pendingArrivalChars > 0) {
      samples.push({ atMs: nowMs, chars: pendingArrivalChars });
      pendingArrivalChars = 0;
    }
    while (samples.length > 0 && samples[0].atMs < nowMs - RATE_WINDOW_MS) {
      samples.shift();
    }

    const deltaMs =
      lastTickMs === null ? 0 : Math.min(Math.max(nowMs - lastTickMs, 0), MAX_TICK_DELTA_MS);
    lastTickMs = nowMs;

    if (shownLength >= target.length) {
      budget = 0;
      return shownPrefix();
    }

    const availableEnd = streaming ? finalizedUpTo : target.length;

    if (target.length - shownLength > MAX_BACKLOG_CHARS) {
      // Recovery-style jump: snap forward and keep only a normal buffer
      // animating; the stale burst would also poison the rate estimate.
      shownLength = advanceToBoundary(Math.max(shownLength, availableEnd - TARGET_BUFFER_CHARS));
      budget = 0;
      samples = [];
    }

    if (shownLength >= availableEnd) {
      budget = 0;
      return shownPrefix();
    }

    let rate = estimateRate(nowMs);
    if (!streaming) {
      rate *= CATCH_UP_RATE_MULTIPLIER;
    } else {
      const backlog = availableEnd - shownLength;
      if (backlog > TARGET_BUFFER_CHARS + BUFFER_DEADBAND_CHARS) {
        rate *= 1 + RATE_ADJUST_FRACTION;
      } else if (backlog < TARGET_BUFFER_CHARS - BUFFER_DEADBAND_CHARS) {
        rate *= 1 - RATE_ADJUST_FRACTION;
      }
    }

    budget += (rate * deltaMs) / 1000;
    const limit = Math.min(shownLength + Math.floor(budget), availableEnd);
    const next = advanceToBoundary(limit);
    if (next > shownLength) {
      budget -= next - shownLength;
      shownLength = next;
    }
    if (shownLength >= availableEnd) {
      budget = 0;
    }
    return shownPrefix();
  }

  return { setTarget, tick, isSettled };
}
