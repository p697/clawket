/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` timing function for JS-driven motion,
 * matching the curves the UI-thread animations take from `Motion`.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const coefficient = (a: number, b: number) => [3 * a, 3 * (b - a) - 3 * a, 1 - 3 * b + 3 * a] as const;
  const [cx, bx, ax] = coefficient(x1, x2);
  const [cy, by, ay] = coefficient(y1, y2);
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (progress: number) => {
    if (!(progress > 0)) return 0;
    if (progress >= 1) return 1;
    // Newton steps from a linear guess, then bisection if the slope flattens.
    let t = progress;
    for (let index = 0; index < 8; index += 1) {
      const error = sampleX(t) - progress;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = progress;
    for (let index = 0; index < 30; index += 1) {
      const x = sampleX(t);
      if (Math.abs(x - progress) < 1e-6) break;
      if (x < progress) low = t; else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}
