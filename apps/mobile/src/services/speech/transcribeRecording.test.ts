import { transcribeRecording } from './transcribeRecording';
import { connectSpeech } from './speechStream';
import { createRecording, SEGMENT_BYTES, recordings } from './__tests__/recording-store.fixture';
import type { SpeechRecording } from './speechRecordings';
jest.mock('./speechRecordings', () => require('./__tests__/recording-store.fixture'));
jest.mock('./speechStream', () => ({ connectSpeech: jest.fn() }));
function connection(text: string) {
  let resolve!: (value: string) => void, reject!: (error: Error) => void;
  const result = new Promise<string>((yes, no) => { resolve = yes; reject = no; }); void result.catch(() => {});
  return { ready: Promise.resolve(), result, audio: jest.fn(), finish: jest.fn(() => resolve(text)), cancel: jest.fn(() => reject(Error('speech_cancelled'))), writable: () => true };
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); recordings.clear(); });
afterEach(() => jest.useRealTimers());
it('resumes after a failed segment without repeating completed segments', async () => {
  const record = createRecording('scope', ''); record.append(new Uint8Array(SEGMENT_BYTES + 6400));
  record.checkpoint(0, 'saved first'); const next = connection('second'); (connectSpeech as jest.Mock).mockResolvedValue(next);
  const result = transcribeRecording(record as unknown as SpeechRecording, new AbortController().signal, () => {});
  await jest.advanceTimersByTimeAsync(100);
  expect(await result).toBe('saved first second'); expect(connectSpeech).toHaveBeenCalledTimes(1);
  expect(next.audio).toHaveBeenCalledTimes(1); expect(record.result(1)).toBe('second');
});
it('waits for network backpressure instead of dropping audio or allocating more buffers', async () => {
  const record = createRecording('scope', ''); record.append(new Uint8Array(6400));
  const next = connection('ok'); let writable = false; next.writable = () => writable; (connectSpeech as jest.Mock).mockResolvedValue(next);
  const result = transcribeRecording(record as unknown as SpeechRecording, new AbortController().signal, () => {});
  await jest.advanceTimersByTimeAsync(300); expect(next.audio).not.toHaveBeenCalled(); expect(record.bytes).toBe(6400);
  writable = true; await jest.advanceTimersByTimeAsync(100); expect(await result).toBe('ok');
});
it('transcribes a ten-minute recording with six bounded tasks and resumes all checkpoints without network', async () => {
  const record = createRecording('scope', ''); record.append(new Uint8Array(600 * 32000));
  (connectSpeech as jest.Mock).mockImplementation(() => Promise.resolve(connection('segment')));
  const result = transcribeRecording(record as unknown as SpeechRecording, new AbortController().signal, () => {});
  await jest.advanceTimersByTimeAsync(125000);
  expect(await result).toBe(Array(6).fill('segment').join(' ')); expect(connectSpeech).toHaveBeenCalledTimes(6);
  await expect(transcribeRecording(record as unknown as SpeechRecording, new AbortController().signal, () => {})).resolves.toBe(Array(6).fill('segment').join(' '));
  expect(connectSpeech).toHaveBeenCalledTimes(6);
});
it('aborting a replay preserves audio and closes the socket', async () => {
  const record = createRecording('scope', ''); record.append(new Uint8Array(6400));
  const next = connection('ok'); next.writable = () => false; (connectSpeech as jest.Mock).mockResolvedValue(next);
  const abort = new AbortController();
  const result = transcribeRecording(record as unknown as SpeechRecording, abort.signal, () => {}); void result.catch(() => {});
  await jest.advanceTimersByTimeAsync(10); abort.abort(); await jest.advanceTimersByTimeAsync(60);
  await expect(result).rejects.toThrow('speech_cancelled'); expect(next.cancel).toHaveBeenCalled(); expect(record.bytes).toBe(6400);
});
