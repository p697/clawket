export function getChatKeyboardBottomPadding({
  platform,
  keyboardHeight,
  bottomInset,
  androidKeyboardGap,
}: {
  platform: string;
  keyboardHeight: number;
  bottomInset: number;
  androidKeyboardGap: number;
}): number {
  'worklet';
  if (platform === 'android') {
    return Math.max(0, keyboardHeight - bottomInset + androidKeyboardGap);
  }
  return Math.max(0, keyboardHeight);
}
