/** Points of downward travel before a drag on the composer means "put the keyboard away". */
export const COMPOSER_KEYBOARD_DISMISS_DRAG_THRESHOLD = 10;

export type ComposerKeyboardDismissGesture = Readonly<{
  dx: number;
  dy: number;
  inputFocused: boolean;
  /** The draft is taller than the compact cap, so a drag inside it must scroll the text instead. */
  inputScrollable: boolean;
  numberActiveTouches: number;
}>;

/**
 * Capture only a deliberate, mostly vertical, one-finger downward drag that
 * starts on the composer while its input owns the keyboard. Taps, text
 * selection drags and horizontal swipes keep their native behavior.
 */
export function shouldCaptureComposerKeyboardDismiss({
  dx,
  dy,
  inputFocused,
  inputScrollable,
  numberActiveTouches,
}: ComposerKeyboardDismissGesture): boolean {
  return inputFocused
    && !inputScrollable
    && numberActiveTouches === 1
    && dy > COMPOSER_KEYBOARD_DISMISS_DRAG_THRESHOLD
    && dy > Math.abs(dx);
}
