import {
  EMPTY_VOICE_WAVEFORM_PATH, VOICE_WAVEFORM_ENTRANCE_SECONDS, VOICE_WAVEFORM_HEIGHT, VOICE_WAVEFORM_REST_OPACITY,
  advanceVoiceWaveform, createVoiceWaveformSimulation, drawStillVoiceWaveform, drawVoiceWaveform,
  measureVoiceWaveformBar, resolveStillVoiceWaveformOpacity, resolveVoiceWaveformLayout,
  resolveVoiceWaveformVignette, type VoiceWaveformSimulation,
} from './voiceWaveformModel';

const PHONE_ROW = 354;
const BAR_WIDTH = 2.5;

function run(simulation: VoiceWaveformSimulation, seconds: number, level: number, options: { cancelling?: boolean; frame?: number } = {}) {
  const frame = options.frame ?? 1 / 120;
  for (let index = 0, frames = Math.round(seconds / frame); index < frames; index += 1) {
    advanceVoiceWaveform(simulation, level, options.cancelling ?? false, frame);
  }
}

function subpaths(path: string): number {
  return path === EMPTY_VOICE_WAVEFORM_PATH ? 0 : path.split('M').length - 1;
}

describe('voiceWaveformModel', () => {
  describe('layout', () => {
    it('centres an odd row of at most 51 bars inside nine tenths of the width', () => {
      const layout = resolveVoiceWaveformLayout(PHONE_ROW);
      expect(layout.count).toBe(51);
      expect(layout.half).toBe(25);
      expect(layout.left + layout.half * 6).toBeCloseTo(PHONE_ROW / 2);

      const narrow = resolveVoiceWaveformLayout(200);
      expect(narrow.count % 2).toBe(1);
      expect(narrow.count).toBeLessThan(51);
      const drawn = narrow.count * 6 - 3.5;
      expect(drawn).toBeLessThanOrEqual(200 * 0.9);
      expect(narrow.left + narrow.half * 6).toBeCloseTo(100);
    });

    it.each([0, -12, Number.NaN, Number.POSITIVE_INFINITY, 2])('draws nothing for an unusable width (%p)', (width) => {
      const layout = resolveVoiceWaveformLayout(width);
      expect(layout.count).toBe(0);
      const simulation = createVoiceWaveformSimulation();
      run(simulation, 1, 1);
      expect(drawVoiceWaveform(simulation, layout)).toMatchObject({ rest: EMPTY_VOICE_WAVEFORM_PATH, lit: EMPTY_VOICE_WAVEFORM_PATH });
      expect(drawStillVoiceWaveform(layout)).toBe(EMPTY_VOICE_WAVEFORM_PATH);
    });
  });

  describe('motion', () => {
    const layout = resolveVoiceWaveformLayout(PHONE_ROW);
    const bar = (simulation: VoiceWaveformSimulation, distance: number) => (
      measureVoiceWaveformBar(simulation, layout, layout.half + distance)
    );

    it('unfolds the resting dots from the centre outward', () => {
      const simulation = createVoiceWaveformSimulation();
      run(simulation, 0.05, 0);
      expect(bar(simulation, 0).dot).toBeGreaterThan(0);
      expect(bar(simulation, layout.half).dot).toBe(0);
      run(simulation, 1, 0);
      for (let index = 0; index < layout.count; index += 1) {
        expect(measureVoiceWaveformBar(simulation, layout, index).dot).toBeCloseTo(BAR_WIDTH);
      }
    });

    it('rests as dots with only a short listening pulse while the room is quiet', () => {
      const simulation = createVoiceWaveformSimulation();
      let tallest = 0;
      let lit = 0;
      for (let step = 0; step < 60; step += 1) {
        run(simulation, 0.05, 0);
        for (let index = 0; index < layout.count; index += 1) {
          const measured = measureVoiceWaveformBar(simulation, layout, index);
          tallest = Math.max(tallest, measured.height);
          lit = Math.max(lit, measured.lit);
        }
      }
      // The pulse is visible but stays a small, half-lit swell.
      expect(tallest).toBeGreaterThan(BAR_WIDTH + 0.5);
      expect(tallest).toBeLessThan(BAR_WIDTH + 0.08 * (VOICE_WAVEFORM_HEIGHT - BAR_WIDTH));
      expect(lit).toBeGreaterThan(0.5);
      expect(lit).toBeLessThanOrEqual(BAR_WIDTH * 0.6 + 1e-9);
    });

    it('sends each syllable from the centre outward and lets it fade', () => {
      const simulation = createVoiceWaveformSimulation();
      run(simulation, 1, 0);
      const distances = [0, 5, 10, 15, 20];
      const threshold = BAR_WIDTH + 1.5;
      const firstRise = new Map<number, number>();
      for (let frame = 0; frame < 120; frame += 1) {
        run(simulation, 1 / 120, 0.9);
        for (const distance of distances) {
          if (!firstRise.has(distance) && bar(simulation, distance).height > threshold) firstRise.set(distance, simulation.time);
        }
      }
      expect(distances.every((distance) => firstRise.has(distance))).toBe(true);
      const rises = distances.map((distance) => firstRise.get(distance)!);
      for (let index = 1; index < rises.length; index += 1) expect(rises[index]).toBeGreaterThan(rises[index - 1]);
      // About 30 ms per bar: the twentieth bar hears the syllable roughly 0.6 s after the centre.
      expect(rises[4] - rises[0]).toBeGreaterThan(0.45);
      expect(rises[4] - rises[0]).toBeLessThan(0.75);
      // The centre stands tallest; the envelope keeps the outer bars lower.
      expect(bar(simulation, 0).height).toBeGreaterThan(bar(simulation, 20).height);
      expect(bar(simulation, 0).lit).toBeCloseTo(BAR_WIDTH);

      run(simulation, 2, 0);
      for (let index = 0; index < layout.count; index += 1) {
        expect(measureVoiceWaveformBar(simulation, layout, index).height).toBeLessThan(BAR_WIDTH + 0.08 * (VOICE_WAVEFORM_HEIGHT - BAR_WIDTH));
      }
    });

    it('flattens and dims the row while slide-to-cancel is armed', () => {
      const speaking = createVoiceWaveformSimulation();
      const cancelling = createVoiceWaveformSimulation();
      run(speaking, 1.5, 0.9);
      run(cancelling, 1.5, 0.9, { cancelling: true });
      expect(bar(cancelling, 0).height).toBeLessThan(bar(speaking, 0).height * 0.7);
      const open = drawVoiceWaveform(speaking, layout);
      const armed = drawVoiceWaveform(cancelling, layout);
      expect(open.litOpacity).toBeCloseTo(1);
      expect(open.restOpacity).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY);
      expect(armed.litOpacity).toBeCloseTo(0.5, 2);
      expect(armed.restOpacity).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY / 2, 2);

      // Releasing the cancel gesture restores the row.
      run(cancelling, 1, 0.9);
      expect(drawVoiceWaveform(cancelling, layout).litOpacity).toBeCloseTo(1, 2);
    });

    it('simulates in fixed steps regardless of the display refresh rate', () => {
      const sixty = createVoiceWaveformSimulation();
      const oneTwenty = createVoiceWaveformSimulation();
      run(sixty, 0.5, 0.2, { frame: 1 / 60 });
      run(sixty, 0.5, 0.8, { frame: 1 / 60 });
      run(oneTwenty, 0.5, 0.2);
      run(oneTwenty, 0.5, 0.8);
      expect(sixty.time).toBeCloseTo(oneTwenty.time, 6);
      expect(sixty.position).toBeCloseTo(oneTwenty.position, 6);
      expect(sixty.history).toEqual(oneTwenty.history);
    });

    it('ignores corrupted levels and frame times', () => {
      const clean = createVoiceWaveformSimulation();
      const noisy = createVoiceWaveformSimulation();
      run(clean, 0.5, 1);
      run(noisy, 0.5, 7);
      expect(noisy.position).toBeCloseTo(clean.position, 9);

      const silent = createVoiceWaveformSimulation();
      advanceVoiceWaveform(silent, Number.NaN, false, 1 / 60);
      advanceVoiceWaveform(silent, -3, false, 1 / 60);
      expect(silent.position).toBe(0);

      const stalled = createVoiceWaveformSimulation();
      advanceVoiceWaveform(stalled, 0.5, false, Number.NaN);
      advanceVoiceWaveform(stalled, 0.5, false, -1);
      expect(stalled.time).toBe(0);
      // A long stall folds into at most 100 ms of simulation.
      advanceVoiceWaveform(stalled, 0.5, false, 10);
      expect(stalled.time).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(stalled.time).toBeGreaterThan(0.09);
    });
  });

  describe('drawing', () => {
    it('writes one resting dot per bar and lit capsules only where the voice is', () => {
      const layout = resolveVoiceWaveformLayout(PHONE_ROW);
      const simulation = createVoiceWaveformSimulation();
      run(simulation, 1, 0);
      const quiet = drawVoiceWaveform(simulation, layout);
      expect(subpaths(quiet.rest)).toBe(layout.count);
      expect(subpaths(quiet.lit)).toBeLessThan(layout.count / 2);

      run(simulation, 1, 0.9);
      const speaking = drawVoiceWaveform(simulation, layout);
      expect(subpaths(speaking.lit)).toBeGreaterThan(layout.count / 2);
      for (const path of [quiet.rest, quiet.lit, speaking.rest, speaking.lit]) {
        expect(path).not.toMatch(/NaN|Infinity|undefined/);
        expect(path.startsWith('M')).toBe(true);
      }
      // Capsules never leave the row.
      const values = speaking.lit.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.max(...values)).toBeLessThanOrEqual(PHONE_ROW);
    });

    it('hands the dots to the still row once the entrance has finished', () => {
      const layout = resolveVoiceWaveformLayout(PHONE_ROW);
      const simulation = createVoiceWaveformSimulation();
      run(simulation, VOICE_WAVEFORM_ENTRANCE_SECONDS / 2, 0);
      expect(drawVoiceWaveform(simulation, layout).rest).not.toBe(drawStillVoiceWaveform(layout));
      run(simulation, VOICE_WAVEFORM_ENTRANCE_SECONDS, 0);
      // Byte-identical, so switching sources never commits a new path.
      expect(drawVoiceWaveform(simulation, layout).rest).toBe(drawStillVoiceWaveform(layout));
      const litOnly = drawVoiceWaveform(simulation, layout, false);
      expect(litOnly.rest).toBe(EMPTY_VOICE_WAVEFORM_PATH);
      expect(litOnly.lit).toBe(drawVoiceWaveform(simulation, layout).lit);
    });

    it('keeps the reduced-motion row still and lets only its opacity follow the voice', () => {
      const layout = resolveVoiceWaveformLayout(PHONE_ROW);
      expect(subpaths(drawStillVoiceWaveform(layout))).toBe(layout.count);
      expect(resolveStillVoiceWaveformOpacity(0, false)).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY);
      expect(resolveStillVoiceWaveformOpacity(1, false)).toBeCloseTo(0.8);
      expect(resolveStillVoiceWaveformOpacity(Number.NaN, false)).toBeCloseTo(VOICE_WAVEFORM_REST_OPACITY);
      expect(resolveStillVoiceWaveformOpacity(1, true)).toBeCloseTo(0.4);
    });

    it('dissolves both ends symmetrically with an opaque middle', () => {
      const layout = resolveVoiceWaveformLayout(PHONE_ROW);
      const vignette = resolveVoiceWaveformVignette(layout);
      const { stops } = vignette;
      expect(vignette.x1).toBeLessThan(layout.left);
      expect(vignette.x2).toBeGreaterThan(layout.left + (layout.count - 1) * 6);
      expect((vignette.x1 + vignette.x2) / 2).toBeCloseTo(PHONE_ROW / 2);
      for (let index = 0; index < stops.length; index += 1) {
        const mirror = stops[stops.length - 1 - index];
        expect(stops[index].offset + mirror.offset).toBeCloseTo(1);
        expect(stops[index].opacity).toBeCloseTo(mirror.opacity);
        if (index > 0) expect(stops[index].offset).toBeGreaterThanOrEqual(stops[index - 1].offset);
      }
      expect(stops[0].opacity).toBeLessThan(0.1);
      expect(stops[stops.length / 2 - 1].opacity).toBeCloseTo(1);
    });
  });
});
