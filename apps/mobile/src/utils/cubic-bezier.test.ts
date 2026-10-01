import { cubicBezier } from './cubic-bezier';

describe('cubicBezier', () => {
  it('pins the ends and follows the CSS curves', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect([0, 0.25, 0.5, 1].map(linear).map((value) => Number(value.toFixed(4)))).toEqual([0, 0.25, 0.5, 1]);
    // CSS `ease` (0.25, 0.1, 0.25, 1) at x = 0.5 is about 0.8024.
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
    const drift = cubicBezier(0.2, 0.01, 0.28, 0.91);
    expect(drift(-1)).toBe(0);
    expect(drift(2)).toBe(1);
    expect(drift(Number.NaN)).toBe(0);
    // Monotonic between the ends.
    const samples = Array.from({ length: 21 }, (_value, index) => drift(index / 20));
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1]!)).toBe(true);
  });
});
