import { connectAdmittedSpeech } from './speechAdmissionConnection';
import { connectSpeech } from './speechStream';
import { SpeechError } from './speechErrors';

jest.mock('./speechStream', () => ({ connectSpeech: jest.fn() }));
function connection(error?: SpeechError) {
  const ready = error ? Promise.reject(error) : Promise.resolve();
  const result = error ? Promise.reject(error) : new Promise<string>(() => {});
  void ready.catch(() => {}); void result.catch(() => {});
  return { ready, result, cancel: jest.fn(), audio: jest.fn(), finish: jest.fn() };
}
beforeEach(() => { jest.useFakeTimers(); jest.resetAllMocks(); });
afterEach(() => jest.useRealTimers());

it('waits through temporary occupancy, using fresh connections and never sending audio', async () => {
  const first = connection(new SpeechError('speech_busy', '', 123000)), second = connection();
  (connectSpeech as jest.Mock).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const result = connectAdmittedSpeech(new AbortController().signal, () => {});
  await jest.advanceTimersByTimeAsync(499);
  expect(connectSpeech).toHaveBeenCalledTimes(1); expect(first.cancel).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toBe(second); expect(first.audio).not.toHaveBeenCalled(); expect(second.audio).not.toHaveBeenCalled();
});

it('bounds persistent busy polling and retains the final diagnostic ID', async () => {
  const error = new SpeechError('speech_busy', 'diagnostic', 123000);
  (connectSpeech as jest.Mock).mockImplementation(async () => connection(error));
  const result = connectAdmittedSpeech(new AbortController().signal, () => {}); void result.catch(() => {});
  await jest.advanceTimersByTimeAsync(30000);
  await expect(result).rejects.toBe(error); expect(connectSpeech).toHaveBeenCalledTimes(9);
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['speech_disconnected', 'speech_device_limit', 'speech_provider_busy', 'speech_auth'] as const)('never retries %s', async code => {
  const first = connection(new SpeechError(code)); (connectSpeech as jest.Mock).mockResolvedValue(first);
  await expect(connectAdmittedSpeech(new AbortController().signal, () => {})).rejects.toMatchObject({ code });
  expect(connectSpeech).toHaveBeenCalledTimes(1);
});

it('cancels occupancy waiting immediately without creating a replacement socket', async () => {
  (connectSpeech as jest.Mock).mockResolvedValue(connection(new SpeechError('speech_busy', '', 123000)));
  const abort = new AbortController();
  const result = connectAdmittedSpeech(abort.signal, () => {}); void result.catch(() => {});
  await jest.advanceTimersByTimeAsync(50); abort.abort();
  await expect(result).rejects.toMatchObject({ code: 'speech_cancelled' });
  await jest.advanceTimersByTimeAsync(30000);
  expect(connectSpeech).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('closes a late socket after navigation without exposing it to the next attempt', async () => {
  let resolve!: (value: ReturnType<typeof connection>) => void;
  (connectSpeech as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  const abort = new AbortController(), onConnection = jest.fn(), late = connection();
  const result = connectAdmittedSpeech(abort.signal, onConnection);
  abort.abort(); resolve(late);
  await expect(result).rejects.toMatchObject({ code: 'speech_cancelled' });
  expect(late.cancel).toHaveBeenCalled(); expect(onConnection).not.toHaveBeenCalled();
});

it('does not reconnect after readiness when a final response is lost', async () => {
  const live = connection(); (connectSpeech as jest.Mock).mockResolvedValue(live);
  expect(await connectAdmittedSpeech(new AbortController().signal, () => {})).toBe(live);
  await jest.advanceTimersByTimeAsync(30000);
  expect(connectSpeech).toHaveBeenCalledTimes(1);
});
