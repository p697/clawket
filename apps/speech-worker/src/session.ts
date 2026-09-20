import { finishTask, MAX_AUDIO_BYTES, MAX_SECONDS, runTask, Transcript } from './provider';

/** One bounded, memory-only stream. Every terminal path closes both peers. */
export function serveSession(client: WebSocket, provider: WebSocket, taskId: string, release: () => void) {
  let closed = false, ready = false, finishing = false, bytes = 0;
  const transcript = new Transcript();
  let timer: ReturnType<typeof setTimeout>;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  const send = (value: unknown) => { if (!closed) client.send(JSON.stringify(value)); };
  const close = (code?: string) => {
    if (closed) return;
    if (code) { try { send({ type: 'error', code }); } catch { /* Peer closed. */ } }
    closed = true;
    clearTimeout(timer); clearTimeout(durationTimer);
    try { client.close(1000, 'speech_complete'); } catch { /* Already closed. */ }
    try { provider.close(1000, 'speech_complete'); } catch { /* Already closed. */ }
    release();
  };
  const deadline = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => close('speech_timeout'), ms); };
  provider.addEventListener('message', (event) => {
    if (closed) return;
    try {
      if (typeof event.data !== 'string') throw Error('speech_protocol');
      const type = transcript.accept(event.data, taskId);
      if (type === 'started') {
        if (ready) throw Error('speech_protocol');
        ready = true; deadline(15000);
        durationTimer = setTimeout(() => close('speech_too_long'), 135000);
        send({ type: 'ready', maxSeconds: MAX_SECONDS });
      } else if (type === 'text') {
        send({ type: 'transcript', text: transcript.text });
      } else if (type === 'finished') {
        if (!finishing) throw Error('speech_protocol');
        send({ type: 'result', text: transcript.text }); close();
      }
    } catch { close('speech_provider_failed'); }
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
        deadline(15000);
        provider.send(JSON.stringify(finishTask(taskId)));
      } else {
        const chunk = event.data;
        if (!ready || finishing || !(chunk instanceof ArrayBuffer) || !chunk.byteLength ||
          chunk.byteLength % 2 || chunk.byteLength > 32000 || bytes + chunk.byteLength > MAX_AUDIO_BYTES) throw Error('speech_audio_limit');
        bytes += chunk.byteLength;
        deadline(15000);
        provider.send(chunk);
      }
    } catch { close('speech_protocol'); }
  });
  client.addEventListener('close', () => close());
  client.addEventListener('error', () => close());
  provider.addEventListener('close', () => close('speech_disconnected'));
  provider.addEventListener('error', () => close('speech_disconnected'));
  deadline(12000);
  try { provider.send(JSON.stringify(runTask(taskId))); } catch { close('speech_provider_failed'); }
  return { close };
}
