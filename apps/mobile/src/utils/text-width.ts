/**
 * Approximate advance widths of system-font semibold text, in em. Measured from SF Pro Text and
 * PingFang SC on 2026-10-06; Roboto runs a little narrower, so Android estimates err long. React
 * Native cannot measure text before layout, so these widths only choose what to shorten; the
 * native ellipsis still guards the line.
 */
const EM = Object.freeze({
  space: 0.27,
  narrow: 0.32,
  mid: 0.41,
  wide: 0.9,
  upper: 0.69,
  digit: 0.64,
  body: 0.6,
  full: 1,
  emoji: 1.1,
  ellipsis: 0.9,
});

const ELLIPSIS = '…';
const NARROW = new Set('ijlI|!.,:;\'`·');
const MID = new Set('frt()[]{}-"/\\');
const WIDE = new Set('mwMW@%');
const FULL_WIDTH = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}⺀-⿟　-〿！-｠￠-￦]/u;
const PICTOGRAPHIC = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
// A user-perceived character: a base with its marks and variation or skin-tone modifiers,
// joined emoji sequences, or a flag. Hermes has no Intl.Segmenter, so every platform uses this.
const CLUSTER = /\p{Regional_Indicator}{2}|\P{M}(?:[\p{M}︎️]|\p{Emoji_Modifier})*(?:‍\P{M}(?:[\p{M}︎️]|\p{Emoji_Modifier})*)*|\p{M}+/gu;
// Spaces and separators left in front of the ellipsis read as a broken word.
const TRAILING_BREAK = /[\s·•\-–—_,.;:/|]+$/u;

export function splitGraphemes(text: string): string[] {
  return text.match(CLUSTER) ?? [];
}

function clusterEm(cluster: string): number {
  if (PICTOGRAPHIC.test(cluster)) return EM.emoji;
  if (FULL_WIDTH.test(cluster)) return EM.full;
  const base = cluster[0] ?? '';
  if (/\s/u.test(base)) return EM.space;
  if (NARROW.has(base)) return EM.narrow;
  if (MID.has(base)) return EM.mid;
  if (WIDE.has(base)) return EM.wide;
  if (base === ELLIPSIS || base === '—') return EM.ellipsis;
  if (base >= 'A' && base <= 'Z') return EM.upper;
  if (base >= '0' && base <= '9') return EM.digit;
  return EM.body;
}

/** Estimated width of `text` at `fontSize`, in the same units. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const cluster of splitGraphemes(text)) em += clusterEm(cluster);
  return em * fontSize;
}

/**
 * `text` shortened at a character boundary so that it and a trailing `…` fit `maxWidth` by
 * estimate. At least one character stays, so the text never disappears; an unusable width
 * leaves the text to the native ellipsis.
 */
export function truncateToEstimatedWidth(text: string, maxWidth: number, fontSize: number): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0 || !Number.isFinite(fontSize) || fontSize <= 0) return text;
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const clusters = splitGraphemes(text);
  const budget = maxWidth - EM.ellipsis * fontSize;
  let width = 0;
  let kept = 0;
  for (const cluster of clusters) {
    width += clusterEm(cluster) * fontSize;
    if (width > budget) break;
    kept += 1;
  }
  const head = clusters.slice(0, Math.max(1, kept)).join('').replace(TRAILING_BREAK, '');
  return `${head || clusters[0]}${ELLIPSIS}`;
}
