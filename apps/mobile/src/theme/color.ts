/**
 * Small color arithmetic for semantic tokens. Theme colors are `#RRGGBB` or
 * `rgba()` strings; these helpers derive translucent or blended variants
 * without introducing literal colors at call sites.
 */

export type RgbColor = {
  r: number;
  g: number;
  b: number;
  /** 0–1; `1` for opaque hex input. */
  a: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseHexColor(value: string): RgbColor | null {
  const normalized = value.replace('#', '').trim();
  const raw = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  if (!/^[\da-fA-F]{6}$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
    a: 1,
  };
}

function parseRgbColor(value: string): RgbColor | null {
  const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!match) return null;
  return {
    r: clamp(Number.parseFloat(match[1]), 0, 255),
    g: clamp(Number.parseFloat(match[2]), 0, 255),
    b: clamp(Number.parseFloat(match[3]), 0, 255),
    a: match[4] === undefined ? 1 : clamp(Number.parseFloat(match[4]), 0, 1),
  };
}

/** Parses a theme color string; `null` for anything that is not hex or rgb(a). */
export function parseColor(value: string): RgbColor | null {
  return parseHexColor(value) ?? parseRgbColor(value);
}

/** The same hue at a new opacity; unknown formats pass through unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${clamp(alpha, 0, 1)})`;
}

/**
 * Composites a (possibly translucent) tint onto an opaque backing so a later
 * material opacity starts from a stable, predictable surface.
 */
export function blendOntoBacking(tint: string, backing: string): string {
  const front = parseColor(tint);
  const back = parseColor(backing);
  if (!front || !back) return backing;
  const alpha = front.a;
  const blend = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return `rgb(${blend(front.r, back.r)},${blend(front.g, back.g)},${blend(front.b, back.b)})`;
}
