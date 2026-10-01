import { Platform } from 'react-native';
import { containsCjk } from './cjkText';

// Lifts for text the native renderers leave off-center in a custom line
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
