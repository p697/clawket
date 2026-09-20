import { logSpeech } from './diagnostics';
import { finishTask, MAX_AUDIO_BYTES, MAX_SECONDS, runTask, Transcript } from './provider';

/** One bounded, memory-only stream. Every terminal path closes both peers. */
export function serveSession(client: WebSocket, provider: WebSocket, taskId: string, release: () => void | Promise<void>, waitUntil: (promise: Promise<unknown>) => void = (promise) => { void promise; }, acknowledgeAudio = false) {
  let closed = false, ready = false, finishing = false, bytes = 0;
  const transcript = new Transcript();
  let timer: ReturnType<typeof setTimeout>;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  const send = (value: unknown) => { if (!closed) client.send(JSON.stringify(value)); };
  const close = (code?: string, result?: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer); clearTimeout(durationTimer);
    try { provider.close(1000, 'speech_complete'); } catch { /* Already closed. */ }
    logSpeech(taskId, 'session', code ?? 'speech_complete', { bytes });
    // Release the device lease before acknowledging completion: the next recording
    // may start as soon as the client sees result/error.
    waitUntil(Promise.resolve().then(release).catch(() => {
      logSpeech(taskId, 'release', 'speech_admission_failed');
    }).then(() => {
      try {
        if (code) client.send(JSON.stringify({ type: 'error', code, requestId: taskId }));
        else if (result !== undefined) client.send(JSON.stringify({ type: 'result', text: result, requestId: taskId }));
        client.close(1000, 'speech_complete');
      } catch { /* Peer already disconnected. */ }
    }));
  };
  const deadline = (ms: number, code = 'speech_audio_timeout') => { clearTimeout(timer); timer = setTimeout(() => close(code), ms); };
  provider.addEventListener('message', (event) => {
    if (closed) return;
    try {
      if (typeof event.data !== 'string') throw Error('speech_protocol');
      const type = transcript.accept(event.data, taskId);
      if (type === 'started') {
        if (ready) throw Error('speech_protocol');
        ready = true; deadline(15000);
        durationTimer = setTimeout(() => close('speech_too_long'), 135000);
        send({ type: 'ready', maxSeconds: MAX_SECONDS, requestId: taskId, ...(acknowledgeAudio ? { flowControl: 'ack.v1' } : {}) });
      } else if (type === 'text') {
        send({ type: 'transcript', text: transcript.text });
      } else if (type === 'finished') {
        if (!finishing) throw Error('speech_protocol');
        close(undefined, transcript.text);
      }
    } catch (error) { const code = error instanceof Error ? error.message : ''; close(/^speech_(provider_(failed|busy|auth|quota)|protocol|too_long)$/.test(code) ? code : 'speech_provider_failed'); }
  });
  client.addEventListener('message', (event) => {
    if (closed) return;
    try {
      if (typeof event.data === 'string') {
        if (event.data.length > 128) throw Error('speech_protocol');
        const control = JSON.parse(event.data);
        if (control.type === 'cancel') { close(); return; }
        if (control.type !== 'finish' || !ready || finishing) throw Error('speech_protocol');
        finishing = true;
        deadline(15000, 'speech_finish_timeout');
        provider.send(JSON.stringify(finishTask(taskId)));
      } else {
        const chunk = event.data;
        if (!ready || finishing || !(chunk instanceof ArrayBuffer) || !chunk.byteLength ||
          chunk.byteLength % 2 || chunk.byteLength > 32000 || bytes + chunk.byteLength > MAX_AUDIO_BYTES) throw Error('speech_audio_limit');
        bytes += chunk.byteLength;
        deadline(15000);
        provider.send(chunk);
        if (acknowledgeAudio) send({ type: 'ack', bytes });
      }
    } catch (error) { close(error instanceof Error && error.message === 'speech_audio_limit' ? 'speech_audio_limit' : 'speech_protocol'); }
  });
  client.addEventListener('close', () => close());
  client.addEventListener('error', () => close());
  provider.addEventListener('close', () => close('speech_disconnected'));
  provider.addEventListener('error', () => close('speech_disconnected'));
  deadline(12000, 'speech_provider_start_timeout');
  try { provider.send(JSON.stringify(runTask(taskId))); } catch (error) { const code = error instanceof Error ? error.message : ''; close(/^speech_(provider_(failed|busy|auth|quota)|protocol|too_long)$/.test(code) ? code : 'speech_provider_failed'); }
  return { close };
}
