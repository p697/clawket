// Local workerd fixture only. No external provider, credentials, microphone or cloud bindings.
import worker from '../../apps/speech-worker/src/index';
export { SpeechAdmission } from '../../apps/speech-worker/src/admission';

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.maas.aliyuncs.com')) throw Error('Unexpected external request');
  if (url.hostname.startsWith('delayed.')) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Error('aborted')); }, { once: true });
    });
  }
  const pair = new WebSocketPair(); pair[1].accept();
  pair[1].addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const { header } = JSON.parse(event.data);
    const emit = (event: string, payload = {}) => pair[1].send(JSON.stringify({ header: { task_id: header.task_id, event }, payload }));
    if (header.action === 'run-task') emit('task-started');
    if (header.action === 'finish-task') {
      emit('result-generated', { output: { sentence: { sentence_id: 0, text: 'synthetic result', sentence_end: true } } });
      emit('task-finished');
    }
  });
  pair[1].addEventListener('close', () => { try { pair[1].close(); } catch { /* Already closed. */ } });
  return new Response(null, { status: 101, webSocket: pair[0] });
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Deterministic persisted-lease probes, using the real DO storage implementation.
    if (url.pathname === '/test/reserve') return Response.json(await env.ADMISSION.getByName(url.searchParams.get('device')!).reservePending('orphan'));
    if (url.pathname === '/test/activate') return Response.json(await env.ADMISSION.getByName(url.searchParams.get('device')!).activate('orphan'));
    if (url.pathname === '/test/release') { await env.ADMISSION.getByName(url.searchParams.get('device')!).release('orphan'); return new Response(null, { status: 204 }); }
    return worker.fetch(request, {
      ...env, ALIYUN_SPEECH_API_KEY: 'synthetic-test-key', SPEECH_ENABLED: 'true',
      ALIYUN_SPEECH_URL: `https://${url.searchParams.has('delay') ? 'delayed' : 'normal'}.maas.aliyuncs.com/api-ws/v1/inference`,
    }, ctx);
  },
};
