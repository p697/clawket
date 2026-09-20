import { SpeechPcm } from './speechPcm';
test('resamples 48kHz mono into exact 16kHz signed little-endian PCM', () => {
  const source = new Float32Array(48000).fill(0.5);
  const pcm = new SpeechPcm().convert(source.buffer, 48000, 1);
  expect(pcm.byteLength).toBe(32000);
  expect(new DataView(pcm.buffer).getInt16(0, true)).toBe(16384);
});
test('preserves fractional resampling state across hardware chunks', () => {
  const source = new Float32Array(44100).fill(-1),
    converter = new SpeechPcm();
  let count = 0;
  for (let i = 0; i < source.length; i += 1024)
    count += converter.convert(source.slice(i, i + 1024).buffer, 44100, 1).length;
  expect(count).toBe(32000);
});
test('downmixes stereo and rejects malformed buffers', () => {
  const pcm = new SpeechPcm().convert(new Float32Array([1, -1, 1, -1]).buffer, 16000, 2);
  expect([...pcm]).toEqual([0, 0, 0, 0]);
  expect(() => new SpeechPcm().convert(new ArrayBuffer(3), 16000, 1)).toThrow();
});
