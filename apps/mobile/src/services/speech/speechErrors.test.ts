import { decodeSpeechError } from './speechErrors';

it('subtracts time already spent recording from a delayed retry notice', () => {
  jest.useFakeTimers();
  try {
    const error = decodeSpeechError({ code: 'speech_busy', retryAfterMs: 122110 });
    jest.advanceTimersByTime(100000);
    expect(error.remainingRetryMs).toBe(22110);
    jest.advanceTimersByTime(30000);
    expect(error.remainingRetryMs).toBe(0);
    expect(error.retryAfterMs).toBe(122110);
  } finally { jest.useRealTimers(); }
});
