import { computeYScale, describeArc, easeOut } from './chart-utils';

describe('computeYScale', () => {
  it('returns empty for all-zero values', () => {
    const result = computeYScale([0, 0, 0], 200);
    expect(result.max).toBe(0);
    expect(result.ticks).toEqual([]);
  });

  it('returns empty for empty array', () => {
    const result = computeYScale([], 200);
    expect(result.max).toBe(0);
    expect(result.ticks).toEqual([]);
  });

  it('rounds max up to a nice number', () => {
    const result = computeYScale([73, 45, 12], 200);
    expect(result.max).toBe(100);
    expect(result.ticks).toHaveLength(5); // 0, 25, 50, 75, 100
    expect(result.ticks[0]).toBe(0);
    expect(result.ticks[result.ticks.length - 1]).toBe(100);
  });

  it('handles single value', () => {
    const result = computeYScale([500], 200);
    expect(result.max).toBe(500);
    expect(result.ticks).toHaveLength(5);
  });

  it('handles large values', () => {
    const result = computeYScale([1_500_000, 800_000], 200);
    expect(result.max).toBe(2_000_000);
  });

  it('handles small decimal values', () => {
    const result = computeYScale([0.3, 0.15, 0.08], 200);
    expect(result.max).toBeGreaterThanOrEqual(0.3);
    expect(result.ticks[0]).toBe(0);
  });

  it('ignores negative values (treats as zero)', () => {
    const result = computeYScale([-10, -5, 0], 200);
    expect(result.max).toBe(0);
    expect(result.ticks).toEqual([]);
  });

  it('produces monotonically increasing ticks', () => {
    const result = computeYScale([42, 18, 95], 300);
    for (let i = 1; i < result.ticks.length; i++) {
      expect(result.ticks[i]).toBeGreaterThan(result.ticks[i - 1]);
    }
  });
});

describe('describeArc', () => {
  it('returns empty string for zero sweep', () => {
    expect(describeArc(50, 50, 40, 0, 0)).toBe('');
  });

  it('returns empty string for negative sweep', () => {
    expect(describeArc(50, 50, 40, 90, 45)).toBe('');
  });

  it('produces valid SVG path for 90 degree arc', () => {
    const d = describeArc(50, 50, 40, 0, 90);
    expect(d).toMatch(/^M .+ A 40 40 0 0 1 .+$/);
  });

  it('uses large-arc flag for arcs > 180 degrees', () => {
    const d = describeArc(50, 50, 40, 0, 270);
    expect(d).toContain(' 1 1 '); // largeArc=1, sweep=1
  });

  it('uses small-arc flag for arcs <= 180 degrees', () => {
    const d = describeArc(50, 50, 40, 0, 180);
    expect(d).toContain(' 0 1 '); // largeArc=0, sweep=1
  });

  it('handles full circle (360 degrees)', () => {
    const d = describeArc(50, 50, 40, 0, 360);
    expect(d).toBeTruthy();
    expect(d).toContain('A 40 40');
    // Should use large-arc flag for near-360
    expect(d).toContain(' 1 1 ');
  });

  it('starts at 12 o\'clock (top) for 0 degrees', () => {
    const d = describeArc(50, 50, 40, 0, 90);
    // At 0 degrees (rotated -90 from standard), start should be at top: (50, 10)
    const match = d.match(/^M ([\d.]+) ([\d.]+)/);
    expect(match).toBeTruthy();
    const x = parseFloat(match![1]);
    const y = parseFloat(match![2]);
    expect(x).toBeCloseTo(50, 0);
    expect(y).toBeCloseTo(10, 0);
  });
});

describe('easeOut', () => {
  it('returns 0 at t=0', () => {
    expect(easeOut(0)).toBe(0);
  });

  it('returns 1 at t=1', () => {
    expect(easeOut(1)).toBe(1);
  });

  it('is monotonically increasing', () => {
    const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const values = steps.map(easeOut);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it('starts fast and slows down (ease-out characteristic)', () => {
    // First half should cover more than 50% of the distance
    const midValue = easeOut(0.5);
    expect(midValue).toBeGreaterThan(0.5);
  });

  it('returns values between 0 and 1 for inputs between 0 and 1', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOut(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
