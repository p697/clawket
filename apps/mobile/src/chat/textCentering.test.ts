import { ANDROID_CJK_LINE_RAISE_EM, IOS_SYSTEM_LINE_HEIGHT_EM, editorTextRaise, messageTextRaise } from './textCentering';

function onPlatform(platform: 'ios' | 'android', run: () => void) {
  const { Platform } = require('react-native');
  const previous = Platform.OS;
  Platform.OS = platform;
  try { run(); } finally { Platform.OS = previous; }
}

it('raises only Android message lines that contain CJK', () => {
  expect(ANDROID_CJK_LINE_RAISE_EM).toBe(0.08);
  onPlatform('android', () => {
    expect(messageTextRaise('在吗？', 17)).toBeCloseTo(1.36);
    expect(messageTextRaise('OK，那按照你建议的来改吧', 22)).toBeCloseTo(1.76);
    expect(messageTextRaise('Reply with one word: ok', 17)).toBe(0);
  });
  onPlatform('ios', () => {
    expect(messageTextRaise('在吗？', 17)).toBe(0);
    expect(messageTextRaise('Reply with one word: ok', 17)).toBe(0);
  });
});

it('gives the iOS editor the missing half of its line-height surplus, whatever the script', () => {
  expect(IOS_SYSTEM_LINE_HEIGHT_EM).toBe(1.193);
  onPlatform('ios', () => {
    expect(editorTextRaise('输入消息', 17, 24)).toBeCloseTo(1.86, 2);
    expect(editorTextRaise('Message', 17, 24)).toBeCloseTo(1.86, 2);
    expect(editorTextRaise('Message', 34, 48)).toBeCloseTo(3.72, 2);
    expect(editorTextRaise('Message', 17, 17)).toBe(0);
  });
});

it('lets the Android placeholder’s script decide the editor lift', () => {
  onPlatform('android', () => {
    expect(editorTextRaise('输入消息', 17, 24)).toBeCloseTo(1.36);
    expect(editorTextRaise('メッセージ', 17, 24)).toBeCloseTo(1.36);
    expect(editorTextRaise('Message', 17, 24)).toBe(0);
    expect(editorTextRaise('', 17, 24)).toBe(0);
  });
});
