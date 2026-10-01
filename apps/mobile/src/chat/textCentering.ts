import { Platform } from 'react-native';
import { containsCjk } from './cjkText';

// Corrections for text the native renderers leave off-center in a custom line
// height. Device measures 2026-10-01, 17-point text on 24-point lines: Samsung
// SM-A566B on Android 16 (zh-Hans and en-US), an iPhone on iOS 27.

/**
 * Android takes a CJK line's metrics from its taller CJK font: React Native
 * `Text` through fallback line spacing (1.3–1.5 pt low, Latin lines within
 * 0.2 pt), and on Android 15+ an editor under a CJK locale for every line,
 * Latin included (1.0–1.7 pt low).
 */
export const ANDROID_CJK_LINE_RAISE_EM = 0.08;

/** `UIFont.systemFont(ofSize:).lineHeight` per point of size (SF Pro). */
export const IOS_SYSTEM_LINE_HEIGHT_EM = 1.193;

/** Lift for a message `Text`; React Native already centers iOS lines. */
export function messageTextRaise(text: string, fontSize: number): number {
  return Platform.OS === 'android' && containsCjk(text) ? fontSize * ANDROID_CJK_LINE_RAISE_EM : 0;
}

/**
 * Lift for a native editor's text, caret and placeholder, which move together.
 * iOS: React Native gives `TextInput` no baseline offset (its `Text` gets half
 * the line-height surplus), so UIKit draws every script that half low: 1.9 pt
 * at 17/24. Android: the placeholder's script stands in for a CJK locale and
 * decides alone, so a draft never moves while it switches scripts.
 */
export function editorTextRaise(placeholder: string, fontSize: number, lineHeight: number): number {
  if (Platform.OS === 'ios') return Math.max(0, (lineHeight - fontSize * IOS_SYSTEM_LINE_HEIGHT_EM) / 2);
  return containsCjk(placeholder) ? fontSize * ANDROID_CJK_LINE_RAISE_EM : 0;
}

// Latin (Vietnamese included), Greek and Cyrillic with their marks and
// punctuation: the scripts Android sets in Roboto.
const ROBOTO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x052f], // Basic Latin through Cyrillic Supplement
  [0x1e00, 0x1fff], // Latin Extended Additional, Greek Extended
  [0x2000, 0x206f], // General Punctuation
];

/**
 * Whether an Android editor pads its lines with the font's top and bottom.
 * Its placeholder, and the caret of an empty editor, get none of the
 * line-height span typed text gets: a bare Roboto line at the top of the
 * 24-point slot, 2 points high under a Latin locale. Padding lowers only those
 * lines, since the span pins a typed line to its own ascent and descent, and
 * it is static: the first keystroke and a cleared draft switch lines natively,
 * with no JS commit to wait for. Other scripts come from other fonts and keep
 * their layout.
 */
export function editorIncludeFontPadding(placeholder: string): boolean {
  if (Platform.OS !== 'android' || !placeholder) return false;
  for (const char of placeholder) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (!ROBOTO_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)) return false;
  }
  return true;
}
