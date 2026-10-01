import { containsCjk, isCjkCodePoint } from './cjkText';

it('recognizes Han, Kana, Hangul and full-width punctuation, not Latin or emoji', () => {
  expect(containsCjk('在吗？')).toBe(true);
  expect(containsCjk('OK，那按照你建议的来改吧')).toBe(true);
  expect(containsCjk('こんにちは')).toBe(true);
  expect(containsCjk('カタカナ')).toBe(true);
  expect(containsCjk('안녕하세요')).toBe(true);
  expect(containsCjk('ok！')).toBe(true);
  expect(containsCjk('𠀀')).toBe(true);
  expect(containsCjk('Reply with one word: ok')).toBe(false);
  expect(containsCjk('Ça va? Привет 😀')).toBe(false);
  expect(containsCjk('')).toBe(false);
  expect(isCjkCodePoint(0x4e00)).toBe(true);
  expect(isCjkCodePoint(0x9fff)).toBe(true);
  expect(isCjkCodePoint(0xa000)).toBe(false);
});
