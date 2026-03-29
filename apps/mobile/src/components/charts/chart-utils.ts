export function computeYScale(
  values: number[],
  height: number,
): { max: number; ticks: number[] } {
  const dataMax = values.reduce((m, v) => Math.max(m, v), 0);
  if (dataMax <= 0) return { max: 0, ticks: [] };

  // Round up to a nice number for the Y axis max
  const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
  const normalized = dataMax / magnitude;
  let niceMax: number;
  if (normalized <= 1) niceMax = magnitude;
  else if (normalized <= 2) niceMax = 2 * magnitude;
  else if (normalized <= 5) niceMax = 5 * magnitude;
  else niceMax = 10 * magnitude;

  // Generate 4 evenly spaced ticks (including 0 and max)
  const tickCount = 4;
  const step = niceMax / tickCount;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(step * i);
  }

  return { max: niceMax, ticks };
}

export function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return '';
  // Clamp near-full-circle to avoid SVG rendering glitch
  const effectiveSweep = Math.min(sweep, 359.999);

  const startRad = ((startAngle - 90) * Math.PI) / 180;
  const endRad = ((startAngle + effectiveSweep - 90) * Math.PI) / 180;

  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);

  const largeArc = effectiveSweep > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
