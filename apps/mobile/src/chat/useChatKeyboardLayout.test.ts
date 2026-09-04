import { getChatKeyboardBottomPadding } from './chatKeyboardLayout';

describe('getChatKeyboardBottomPadding', () => {
  it('does not reserve the JS tab bar when the iOS keyboard is closed', () => {
    expect(getChatKeyboardBottomPadding({
      platform: 'ios',
      keyboardHeight: 0,
      bottomInset: 34,
      tabBarHeight: 83,
      androidKeyboardGap: 8,
    })).toBe(0);
  });

  it('subtracts the tab bar once from the iOS keyboard overlap', () => {
    expect(getChatKeyboardBottomPadding({
      platform: 'ios',
      keyboardHeight: 336,
      bottomInset: 34,
      tabBarHeight: 83,
      androidKeyboardGap: 8,
    })).toBe(253);
  });

  it('preserves the Android safe-area deduction and keyboard gap', () => {
    expect(getChatKeyboardBottomPadding({
      platform: 'android',
      keyboardHeight: 320,
      bottomInset: 24,
      tabBarHeight: 88,
      androidKeyboardGap: 8,
    })).toBe(216);
  });
});
