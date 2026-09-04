export function getChatKeyboardBottomPadding({
  platform,
  keyboardHeight,
  bottomInset,
  tabBarHeight,
  androidKeyboardGap,
}: {
  platform: string;
  keyboardHeight: number;
  bottomInset: number;
  tabBarHeight: number;
  androidKeyboardGap: number;
}): number {
  'worklet';
  if (platform === 'android') {
    return Math.max(0, keyboardHeight - bottomInset - tabBarHeight + androidKeyboardGap);
  }
  return Math.max(0, keyboardHeight - tabBarHeight);
}
