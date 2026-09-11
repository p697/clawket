import { createSpeechLevelState, processSpeechLevel, toDecibels, type SpeechLevelState } from './speechLevel';

function feed(state: SpeechLevelState, samples: readonly number[]): { state: SpeechLevelState; levels: number[] } {
  const levels: number[] = [];
  let next = state;
  for (const sample of samples) {
    const result = processSpeechLevel(next, sample);
    next = result.state;
    levels.push(result.level);
  }
  return { state: next, levels };
}

/** Native emitted scale for a linear RMS: `min(rms × 5.5, 1)`. */
const emitted = (rms: number) => Math.min(rms * 5.5, 1);
const ROOM = emitted(0.001);
const SOFT_SPEECH = emitted(0.012);
const SPEECH = emitted(0.05);
const LOUD = emitted(0.15);

describe('speechLevel', () => {
  it('converts the emitted scale to decibels with a finite silence floor', () => {
    expect(toDecibels(1)).toBe(0);
    expect(toDecibels(0.1)).toBeCloseTo(-20);
    expect(Number.isFinite(toDecibels(0))).toBe(true);
    expect(toDecibels(0)).toBeLessThan(toDecibels(ROOM));
  });

  it('keeps a quiet room near zero and ignores small noise wobble', () => {
    const { levels } = feed(createSpeechLevelState(), Array.from({ length: 40 }, (_, index) => (
      index % 2 === 0 ? ROOM : ROOM * 1.2
    )));
    expect(Math.max(...levels)).toBeLessThan(0.05);
  });

  it('lets ordinary speech fill most of the meter after a linear signal would barely move', () => {
    const settled = feed(createSpeechLevelState(), Array(20).fill(ROOM)).state;
    const { levels } = feed(settled, Array(4).fill(SPEECH));
    // The native linear value for the same speech is only ~0.28.
    expect(SPEECH).toBeLessThan(0.3);
    expect(levels[0]).toBeGreaterThan(0.6);
    expect(Math.max(...levels)).toBeGreaterThan(0.9);
  });

  it('adapts to soft speakers so syllables still read as pulses', () => {
    const settled = feed(createSpeechLevelState(), Array(20).fill(ROOM)).state;
    const { state, levels } = feed(settled, Array(4).fill(SOFT_SPEECH));
    expect(Math.max(...levels)).toBeGreaterThan(0.85);
    // A pause between syllables releases the envelope quickly but not instantly.
    const pause = feed(state, [ROOM, ROOM, ROOM]).levels;
    expect(pause[0]).toBeLessThan(levels[levels.length - 1]);
    expect(pause[0]).toBeGreaterThan(0.4);
    expect(pause[2]).toBeLessThan(pause[0]);
  });

  it('raises the peak instantly for loud speech and decays it over a few seconds', () => {
    const settled = feed(createSpeechLevelState(), Array(20).fill(ROOM)).state;
    const loud = feed(settled, [LOUD, LOUD]);
    // The peak jumps at once, bounded by the widest range the meter spans.
    expect(loud.state.peakDb).toBeCloseTo(Math.min(toDecibels(LOUD), (loud.state.floorDb ?? 0) + 45));
    expect(loud.state.peakDb).toBeGreaterThan(settled.peakDb + 10);
    const moderate = feed(loud.state, Array(2).fill(SPEECH)).levels;
    // Right after a loud burst, ordinary speech reads lower than the burst.
    expect(moderate[1]).toBeLessThan(0.85);
    const later = feed(loud.state, [...Array(60).fill(ROOM), SPEECH, SPEECH]).levels;
    // Three seconds later the peak has decayed and the same speech fills the meter again.
    expect(later[later.length - 1]).toBeGreaterThan(moderate[1]);
  });

  it('caps the noise floor so a loud room cannot swallow speech', () => {
    const noisy = emitted(0.04);
    const { state } = feed(createSpeechLevelState(), Array(40).fill(noisy));
    expect(state.floorDb).toBeLessThanOrEqual(-24);
    const { levels } = feed(state, [LOUD, LOUD]);
    expect(levels[1]).toBeGreaterThan(0.5);
  });

  it('starts cleanly when the first sample is already speech', () => {
    const { state, levels } = feed(createSpeechLevelState(), [SPEECH, SPEECH]);
    expect(levels[1]).toBeGreaterThan(0.7);
    const quiet = feed(state, Array(6).fill(ROOM));
    expect(quiet.state.floorDb).toBeCloseTo(toDecibels(ROOM));
    // About 300 ms of silence releases the meter.
    expect(quiet.levels[5]).toBeLessThan(0.2);
  });

  it('never leaves the 0–1 range for malformed or extreme samples', () => {
    const { levels } = feed(createSpeechLevelState(), [Number.NaN, -1, 5, 0, 1, Number.POSITIVE_INFINITY, 0]);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});
