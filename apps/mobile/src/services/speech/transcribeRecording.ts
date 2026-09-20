import { connectSpeech, type SpeechConnection } from './speechStream';
import { PCM_BYTES_PER_SECOND, SEGMENT_BYTES, type SpeechRecording } from './speechRecordings';
import { SpeechError } from './speechErrors';

/** One bounded provider task per segment, checkpointed before moving on. No chat sends here. */
export async function transcribeRecording(recording: SpeechRecording, signal: AbortSignal, onConnection: (connection: SpeechConnection) => void, recordingActive = () => false) {
  const texts: string[] = [];
  const check = () => { if (signal.aborted) throw new SpeechError('speech_cancelled'); };
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  for (let offset = 0, index = 0; offset < recording.bytes || recordingActive(); offset += SEGMENT_BYTES, index++) {
    check();
    const previous = recording.result(index);
    if (previous !== null) { texts.push(previous); continue; }
    let connection: SpeechConnection | undefined;
    const cancel = () => connection?.cancel();
    signal.addEventListener('abort', cancel);
    try {
      connection = await connectSpeech();
      onConnection(connection); check();
      await connection.ready; check();
      const end = offset + SEGMENT_BYTES;
      for (let cursor = offset; cursor < end;) {
        if (cursor >= recording.bytes) {
          if (!recordingActive()) break;
          check();
          await Promise.race([pause(50), connection.result.then(() => { throw new SpeechError('speech_protocol'); })]);
          continue;
        }
        check();
        // Backpressure pauses the reader, never discards the local source audio.
        const waitStarted = Date.now();
        while (connection.writable && !connection.writable()) {
          check();
          if (Date.now() - waitStarted > 10000) throw new SpeechError('speech_audio_timeout');
          await Promise.race([pause(50), connection.result.then(() => { throw new SpeechError('speech_protocol'); })]);
        }
        const count = Math.min(6400, end - cursor, recording.bytes - cursor);
        connection.audio(recording.read(cursor, count)); cursor += count;
        // Limit replay to 5x realtime; avoids flooding the provider/native send queue.
        await Promise.race([pause(count / PCM_BYTES_PER_SECOND * 1000 / (connection.replayRate?.() ?? 5)), connection.result.then(() => { throw new SpeechError('speech_protocol'); })]);
      }
      check(); connection.finish();
      const text = await connection.result; check();
      if (text.trim()) recording.checkpoint(index, text);
      texts.push(text);
    } finally { signal.removeEventListener('abort', cancel); connection?.cancel(); }
  }
  const text = texts.filter(Boolean).join(' ');
  if (!text.trim()) throw new SpeechError('speech_no_speech');
  return text;
}
