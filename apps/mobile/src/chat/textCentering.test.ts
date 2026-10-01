import {
  ANDROID_CJK_LINE_RAISE_EM, IOS_SYSTEM_LINE_HEIGHT_EM, editorIncludeFontPadding, editorTextRaise, messageTextRaise,
} from './textCentering';

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

it('pads the Android editor only under a placeholder Roboto sets', () => {
  // Composer placeholders from the shipped locales.
  const roboto = ['Message', 'Type or hold to talk', 'Écrivez ou maintenez pour parler', 'Zum Sprechen länger gedrückt halten',
    'Konuşmak için biraz daha uzun basılı tutun', 'Nhấn giữ lâu hơn để nói', 'Сообщение', 'Утримуйте довше, щоб говорити', 'Слушаю…'];
  const otherFonts = ['输入消息', '輸入訊息', 'メッセージ', '메시지', 'ข้อความ', 'संदेश', 'رسالة'];
  onPlatform('android', () => {
    for (const placeholder of roboto) expect([placeholder, editorIncludeFontPadding(placeholder)]).toEqual([placeholder, true]);
    for (const placeholder of otherFonts) expect([placeholder, editorIncludeFontPadding(placeholder)]).toEqual([placeholder, false]);
    expect(editorIncludeFontPadding('')).toBe(false);
  });
  onPlatform('ios', () => {
    expect(editorIncludeFontPadding('Message')).toBe(false);
  });
});
