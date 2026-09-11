import { getChatKeyboardBottomPadding } from './chatKeyboardLayout';

describe('getChatKeyboardBottomPadding', () => {
  it('does not add padding when the iOS keyboard is closed', () => {
    expect(getChatKeyboardBottomPadding({
      platform: 'ios',
      keyboardHeight: 0,
      bottomInset: 34,
      androidKeyboardGap: 8,
    })).toBe(0);
  });

  it('uses the full iOS keyboard overlap in the root stack', () => {
    expect(getChatKeyboardBottomPadding({
      platform: 'ios',
      keyboardHeight: 336,
      bottomInset: 34,
      androidKeyboardGap: 8,
    })).toBe(336);
  });

  it('preserves the Android safe-area deduction and keyboard gap', () => {
    expect(getChatKeyboardBottomPadding({
      platform: 'android',
      keyboardHeight: 320,
      bottomInset: 24,
      androidKeyboardGap: 8,
    })).toBe(304);
  });
});
