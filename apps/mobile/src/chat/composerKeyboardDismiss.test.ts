import { COMPOSER_KEYBOARD_DISMISS_DRAG_THRESHOLD, shouldCaptureComposerKeyboardDismiss } from './composerKeyboardDismiss';

const gesture = { dx: 0, dy: 24, inputFocused: true, inputScrollable: false, numberActiveTouches: 1 };

describe('shouldCaptureComposerKeyboardDismiss', () => {
  it('captures a deliberate one-finger downward drag from the focused composer', () => {
    expect(shouldCaptureComposerKeyboardDismiss(gesture)).toBe(true);
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, dx: -12 })).toBe(true);
  });

  it('ignores drags below the threshold, upward drags and mostly horizontal swipes', () => {
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, dy: COMPOSER_KEYBOARD_DISMISS_DRAG_THRESHOLD })).toBe(false);
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, dy: -24 })).toBe(false);
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, dx: 30 })).toBe(false);
  });

  it('leaves the gesture alone when the keyboard is down, the draft scrolls or two fingers touch', () => {
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, inputFocused: false })).toBe(false);
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, inputScrollable: true })).toBe(false);
    expect(shouldCaptureComposerKeyboardDismiss({ ...gesture, numberActiveTouches: 2 })).toBe(false);
  });
});
