import { connectSpeech, type SpeechConnection } from './speechStream';
import { SpeechError } from './speechErrors';

/** Only explicit pre-audio occupancy rejections are safe to retry automatically. */
export async function connectAdmittedSpeech(signal: AbortSignal, onConnection: (connection: SpeechConnection) => void): Promise<SpeechConnection> {
  const deadline = Date.now() + 30000;
  for (let retry = 0; ; retry++) {
    if (signal.aborted) throw new SpeechError('speech_cancelled');
    let connection: SpeechConnection | undefined;
    const cancel = () => connection?.cancel();
    signal.addEventListener('abort', cancel);
    try {
      connection = await connectSpeech(signal);
      if (signal.aborted) throw new SpeechError('speech_cancelled');
      onConnection(connection);
      await connection.ready;
      if (signal.aborted) throw new SpeechError('speech_cancelled');
      return connection;
    } catch (error) {
      connection?.cancel();
      if (signal.aborted) throw new SpeechError('speech_cancelled');
      if (!(error instanceof SpeechError) || error.code !== 'speech_busy' || retry >= 8 || Date.now() >= deadline) throw error;
      // Poll conservatively: a server retryAfter is the lease ceiling, not the
      // expected cleanup time. Busy rejections consume no provider quota/audio.
      const delay = Math.min(500 * 2 ** retry, 5000, error.remainingRetryMs || 500, deadline - Date.now());
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new SpeechError('speech_cancelled')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    } finally { signal.removeEventListener('abort', cancel); }
  }
}
