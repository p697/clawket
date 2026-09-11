import {
  createStreamTextPacer,
  fallbackSegmentEnds,
  HOLD_BACK_CHARS,
  MAX_BACKLOG_CHARS,
  type StreamTextPacerOptions,
} from './streamTextPacer';

const TICK_MS = 33;

type Harness = {
  pacer: ReturnType<typeof createStreamTextPacer>;
  feed: (text: string, isStreaming: boolean) => void;
  run: (durationMs: number) => string;
  outputs: string[];
};

function createHarness(options: StreamTextPacerOptions = {}): Harness {
  const pacer = createStreamTextPacer(options);
  let nowMs = 0;
  const outputs: string[] = [];
  return {
    pacer,
    feed: (text, isStreaming) => {
      pacer.setTarget(text, isStreaming);
    },
    run: (durationMs) => {
      let latest = outputs.length > 0 ? outputs[outputs.length - 1] : '';
      for (let elapsed = 0; elapsed < durationMs; elapsed += TICK_MS) {
        nowMs += TICK_MS;
        latest = pacer.tick(nowMs);
        outputs.push(latest);
      }
      return latest;
    },
    outputs,
  };
}

function streamChunks(harness: Harness, full: string, chunkChars: number, chunkMs: number): void {
  let arrived = 0;
  while (arrived < full.length) {
    arrived = Math.min(full.length, arrived + chunkChars);
    harness.feed(full.slice(0, arrived), true);
    harness.run(chunkMs);
  }
}

function expectMonotonicPrefixes(outputs: string[], full: string): void {
  let previousLength = 0;
  for (const output of outputs) {
    expect(full.startsWith(output)).toBe(true);
    expect(output.length).toBeGreaterThanOrEqual(previousLength);
    previousLength = output.length;
  }
}

function expectCleanWordCuts(outputs: string[], full: string): void {
  for (const output of outputs) {
    const cut = output.length;
    if (cut === 0 || cut === full.length) continue;
    const insideWord = /\w/.test(full[cut - 1]) && /\w/.test(full[cut]);
    expect(insideWord).toBe(false);
  }
}

describe('createStreamTextPacer', () => {
  describe('prefix advancement', () => {
    it('advances through streamed text as monotonic prefixes and reaches the full text', () => {
      const full =
        'The quick brown fox jumps over the lazy dog while the pacer keeps the flow smooth.';
      const harness = createHarness();

      streamChunks(harness, full, 7, 99);
      const streamingOutput = harness.outputs[harness.outputs.length - 1];
      expect(streamingOutput.length).toBeGreaterThan(0);
      expect(streamingOutput.length).toBeLessThan(full.length);

      harness.feed(full, false);
      const finalOutput = harness.run(3_000);

      expect(finalOutput).toBe(full);
      expect(harness.pacer.isSettled()).toBe(true);
      expectMonotonicPrefixes(harness.outputs, full);
    });

    it('never cuts inside a latin word', () => {
      const full =
        'Streaming answers should appear word by word without splitting individual words apart.';
      const harness = createHarness();

      streamChunks(harness, full, 9, 99);
      harness.feed(full, false);
      harness.run(3_000);

      expectCleanWordCuts(harness.outputs, full);
    });

    it('starts from initialText and never animates below it', () => {
      const seed = 'Hello world';
      const full = 'Hello world and some more streaming text arriving';
      const harness = createHarness({ initialText: seed });

      harness.feed(full, true);
      harness.run(2_000);
      harness.feed(full, false);
      harness.run(2_000);

      for (const output of harness.outputs) {
        expect(output.startsWith(seed)).toBe(true);
      }
      expect(harness.pacer.isSettled()).toBe(true);
    });
  });

  describe('non-prefix replacement', () => {
    it('shows history text instantly when set while settled and not streaming', () => {
      const pacer = createStreamTextPacer();
      expect(pacer.isSettled()).toBe(true);
      expect(pacer.tick(0)).toBe('');

      const history = 'A long historical message that must never animate on first render.';
      pacer.setTarget(history, false);

      expect(pacer.isSettled()).toBe(true);
      expect(pacer.tick(TICK_MS)).toBe(history);
    });

    it('jumps to the full new text when the shown text is not a prefix (regenerate)', () => {
      const first = 'Streaming the first answer with several words here';
      const harness = createHarness();

      harness.feed(first.slice(0, 30), true);
      const partial = harness.run(300);
      expect(partial.length).toBeGreaterThan(0);
      expect(partial.length).toBeLessThan(first.length);

      const replacement = 'A completely different regenerated reply';
      harness.feed(replacement, false);
      expect(harness.run(TICK_MS)).toBe(replacement);
      expect(harness.pacer.isSettled()).toBe(true);
    });

    it('jumps then keeps animating appends when replaced mid-stream', () => {
      const first = 'Streaming the first answer with several words here';
      const harness = createHarness();

      harness.feed(first.slice(0, 30), true);
      harness.run(300);

      const replacement = 'Second answer draft';
      harness.feed(replacement, true);
      expect(harness.run(TICK_MS)).toBe(replacement);
      expect(harness.pacer.isSettled()).toBe(false);

      const extended = `${replacement} continues with a longer streaming tail`;
      harness.feed(extended, true);
      const grown = harness.run(1_500);
      expect(grown.startsWith(replacement)).toBe(true);
      expect(grown.length).toBeGreaterThan(replacement.length);

      harness.feed(extended, false);
      expect(harness.run(2_000)).toBe(extended);
      expect(harness.pacer.isSettled()).toBe(true);
    });
  });

  describe('rate adaptation', () => {
    it('consumes faster when characters arrive faster', () => {
      const words = 'alpha beta gamma delta epsilon '.repeat(40);

      const fast = createHarness();
      streamChunks(fast, words.slice(0, 900), 30, 99);
      const fastShown = fast.outputs[fast.outputs.length - 1].length;

      const slow = createHarness();
      streamChunks(slow, words.slice(0, 150), 5, 99);
      const slowShown = slow.outputs[slow.outputs.length - 1].length;

      expect(fastShown).toBeGreaterThan(400);
      expect(slowShown).toBeLessThan(200);
      expect(fastShown).toBeGreaterThan(slowShown * 2);
    });

    it('uses the cold-start default rate before enough arrivals are observed', () => {
      const full = 'One two three four five six seven eight nine ten eleven twelve.';
      const harness = createHarness();

      harness.feed(full, true);
      const shown = harness.run(330);

      // ~330ms at the 80 chars/s default (+20% while behind) is ~26-32 chars;
      // it must neither stall at zero nor dump the whole text at once.
      expect(shown.length).toBeGreaterThan(10);
      expect(shown.length).toBeLessThan(45);
    });
  });

  describe('tail hold-back', () => {
    it('withholds the possibly incomplete tail while streaming', () => {
      const full = 'The quick brown fox jumps over the lazy dog';
      const harness = createHarness();

      harness.feed(full, true);
      const shown = harness.run(10_000);

      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThanOrEqual(full.length - HOLD_BACK_CHARS);
      expect(full.startsWith(shown)).toBe(true);
      expect(harness.pacer.isSettled()).toBe(false);

      harness.feed(full, false);
      expect(harness.run(2_000)).toBe(full);
      expect(harness.pacer.isSettled()).toBe(true);
    });
  });

  describe('catch-up after streaming ends', () => {
    it('drains the remaining buffer quickly but not instantly', () => {
      const full =
        'This response has around two hundred characters so the pacer has a real backlog to ' +
        'drain once streaming stops, which lets the test measure the catch-up duration well.';
      const harness = createHarness();

      harness.feed(full, true);
      harness.run(660);
      expect(harness.pacer.isSettled()).toBe(false);

      harness.feed(full, false);
      harness.run(66);
      expect(harness.pacer.isSettled()).toBe(false);

      let elapsedMs = 66;
      while (!harness.pacer.isSettled() && elapsedMs < 3_000) {
        harness.run(TICK_MS);
        elapsedMs += TICK_MS;
      }

      expect(harness.pacer.isSettled()).toBe(true);
      expect(elapsedMs).toBeLessThanOrEqual(1_000);
      expectMonotonicPrefixes(harness.outputs, full);
    });
  });

  describe('large backlog jumps', () => {
    it('snaps forward instead of crawling when the target jumps by kilobytes', () => {
      const intro = 'Recovering session output: ';
      const harness = createHarness();

      harness.feed(intro, true);
      harness.run(200);

      const recovered = intro + 'word '.repeat(1_200);
      harness.feed(recovered, true);
      const afterOneTick = harness.run(TICK_MS);

      expect(recovered.length - afterOneTick.length).toBeLessThanOrEqual(MAX_BACKLOG_CHARS);
      expect(afterOneTick.length).toBeGreaterThanOrEqual(recovered.length - 60);
      expect(recovered.startsWith(afterOneTick)).toBe(true);

      harness.feed(recovered, false);
      expect(harness.run(2_000)).toBe(recovered);
      expect(harness.pacer.isSettled()).toBe(true);
    });
  });

  describe('segmentation fallback without Intl.Segmenter', () => {
    it('advances CJK text character by character', () => {
      const cjk = '这是一段用来验证逐字符推进效果的比较长的中文测试文本内容展示';
      const harness = createHarness({ disableIntlSegmenter: true });

      harness.feed(cjk, true);
      harness.run(2_000);
      harness.feed(cjk, false);
      harness.run(2_000);

      expect(harness.outputs[harness.outputs.length - 1]).toBe(cjk);
      expectMonotonicPrefixes(harness.outputs, cjk);

      const distinctLengths = new Set(harness.outputs.map((output) => output.length));
      expect(distinctLengths.size).toBeGreaterThan(5);
      let previousLength = 0;
      for (const output of harness.outputs) {
        expect(output.length - previousLength).toBeLessThanOrEqual(12);
        previousLength = output.length;
      }
    });

    it('cuts latin text only at whitespace boundaries', () => {
      const full = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
      const harness = createHarness({ disableIntlSegmenter: true });

      streamChunks(harness, full, 8, 99);
      harness.feed(full, false);
      harness.run(3_000);

      expect(harness.outputs[harness.outputs.length - 1]).toBe(full);
      for (const output of harness.outputs) {
        const cut = output.length;
        if (cut === 0 || cut === full.length) continue;
        expect(full[cut - 1] === ' ' || full[cut] === ' ').toBe(true);
      }
    });

    it('produces whitespace-run and per-character segment ends', () => {
      expect(fallbackSegmentEnds('hi  there')).toEqual([2, 4, 9]);
      expect(fallbackSegmentEnds('你好 ok')).toEqual([1, 2, 3, 5]);
      expect(fallbackSegmentEnds('')).toEqual([]);
    });
  });

  describe('returned string caching', () => {
    // String identity is unobservable from JS (primitives compare by value),
    // so the cache is asserted through its effect: a tick that does not
    // advance must not allocate a new prefix via `String.prototype.slice`.
    it('does not re-slice when a tick advances nothing', () => {
      const full = 'The quick brown fox jumps over the lazy dog';
      const harness = createHarness();
      harness.feed(full, true);
      // Long run with no new arrivals: shown stalls at the hold-back limit.
      const stalled = harness.run(10_000);

      const sliceSpy = jest.spyOn(String.prototype, 'slice');
      const next = harness.run(TICK_MS * 3);
      expect(sliceSpy).not.toHaveBeenCalled();
      sliceSpy.mockRestore();
      expect(next).toBe(stalled);
    });

    it('does not re-slice on repeated ticks after settling', () => {
      const full = 'A settled message rendered from history.';
      const harness = createHarness();
      harness.feed(full, false);
      expect(harness.run(TICK_MS)).toBe(full);
      expect(harness.pacer.isSettled()).toBe(true);

      const sliceSpy = jest.spyOn(String.prototype, 'slice');
      const next = harness.run(TICK_MS * 3);
      expect(sliceSpy).not.toHaveBeenCalled();
      sliceSpy.mockRestore();
      expect(next).toBe(full);
    });

    it('drops the cached prefix when the target is replaced', () => {
      const first = 'Streaming the very first answer with several words';
      const harness = createHarness();
      harness.feed(first, true);
      harness.run(10_000);

      const replacement = 'Regenerated answer';
      harness.feed(replacement, false);
      expect(harness.run(TICK_MS)).toBe(replacement);
      expect(harness.pacer.isSettled()).toBe(true);
    });
  });

  describe('streaming flag transitions', () => {
    it('is not settled while streaming even when the shown text caught up', () => {
      const full = 'Short.';
      const pacer = createStreamTextPacer();

      pacer.setTarget(full, true);
      pacer.tick(TICK_MS);
      expect(pacer.isSettled()).toBe(false);

      pacer.setTarget(full, false);
      let nowMs = TICK_MS;
      while (!pacer.isSettled() && nowMs < 3_000) {
        nowMs += TICK_MS;
        pacer.tick(nowMs);
      }
      expect(pacer.isSettled()).toBe(true);
      expect(pacer.tick(nowMs + TICK_MS)).toBe(full);
    });
  });
});
