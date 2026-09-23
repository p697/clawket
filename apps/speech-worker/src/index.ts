import { verifyRequest } from './auth';
import { serveSession } from './session';
import { logSpeech } from './diagnostics';
export { SpeechAdmission } from './admission';

type Secrets = { ALIYUN_SPEECH_API_KEY?: string };
export default {
  async fetch(request: Request, env: Env & Secrets, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ service: 'clawket-speech', enabled: env.SPEECH_ENABLED === 'true', protocol: 2 });
    if (url.pathname !== '/v1/speech' || request.method !== 'GET') return new Response(null, { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
    const requestId = crypto.randomUUID();
    const started = Date.now();
    // RN does not expose HTTP bodies on a failed WebSocket handshake. V2 negotiates
    // a bounded error frame; v1 retains the original HTTP status contract.
    const reject = (code: string, status: number, retryAfterMs = 0) => {
      logSpeech(requestId, 'admission', code, { status, retryAfterMs });
      if (request.headers.get('x-speech-protocol') === '2') {
        const pair = new WebSocketPair();
        pair[1].accept();
        pair[1].send(JSON.stringify({ type: 'error', code, requestId, retryAfterMs }));
        pair[1].close(1000, 'speech_rejected');
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      return Response.json({ code, requestId, retryAfterMs }, { status, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } });
    };
    if (env.SPEECH_ENABLED !== 'true' || !env.ALIYUN_SPEECH_API_KEY) return reject('speech_unavailable', 503);
    const identity = await verifyRequest(request);
    if (!identity) return reject('speech_auth', 401);
    const device = env.ADMISSION.getByName(`device:${identity.device}`);
    let reserved = false;
    let released: Promise<void> | undefined;
    const release = () => {
      if (!reserved) return Promise.resolve();
      if (!released) {
        released = device.release(identity.nonce).catch(() => { logSpeech(requestId, 'release', 'speech_admission_failed'); });
        ctx.waitUntil(released);
      }
      return released;
    };
    let stage = 'admission';
    let upstreamStatus = 0;
    try {
      const admission = await device.reserveDetailed(identity.nonce, 60, 3600000, true);
      if (!admission.allowed) {
        const code = admission.reason === 'busy' ? 'speech_busy' : admission.reason === 'replay' ? 'speech_auth'
          : admission.reason === 'storage' ? 'speech_admission_failed' : 'speech_device_limit';
        return reject(code, 429, admission.retryAfterMs);
      }
      reserved = true;
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      const ipHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)));
      const ipKey = [...ipHash].map((x) => x.toString(16).padStart(2, '0')).join('');
      const ipAdmission = await env.ADMISSION.getByName(`ip:${ipKey}`).reserveDetailed(identity.nonce, 120, 3600000);
      if (!ipAdmission.allowed) { await release(); return reject(ipAdmission.reason === 'storage' ? 'speech_admission_failed' : 'speech_ip_limit', 429, ipAdmission.retryAfterMs); }
      const budget = await env.ADMISSION.getByName('provider-daily-budget').reserveDetailed(crypto.randomUUID(), 200, 86400000);
      if (!budget.allowed) { await release(); return reject(budget.reason === 'storage' ? 'speech_admission_failed' : 'speech_daily_limit', 429, budget.retryAfterMs); }
      const providerUrl = new URL(env.ALIYUN_SPEECH_URL);
      if (providerUrl.protocol !== 'https:' || !providerUrl.hostname.endsWith('.maas.aliyuncs.com') || providerUrl.pathname !== '/api-ws/v1/inference') return await release().then(() => reject('speech_config', 503));
      stage = 'provider_upgrade';
      const upgrade = new AbortController();
      const upgradeDeadline = setTimeout(() => upgrade.abort(), 10000);
      let response: Response;
      try {
        response = await fetch(providerUrl, {
          headers: { Upgrade: 'websocket', Authorization: `Bearer ${env.ALIYUN_SPEECH_API_KEY}` },
          signal: upgrade.signal, redirect: 'manual',
        });
      } finally {
        // Aborting fetch after a successful upgrade also closes its WebSocket.
        // The handshake deadline must not become a live recording deadline.
        clearTimeout(upgradeDeadline);
      }
      upstreamStatus = response.status;
      const provider = response.webSocket;
      if (!provider || response.status !== 101) {
        await release();
        const code = response.status === 429 ? 'speech_provider_busy' : [401, 403].includes(response.status) ? 'speech_provider_auth' : 'speech_provider_upgrade';
        logSpeech(requestId, stage, code, { upstreamStatus });
        return reject(code, 502);
      }
      stage = 'session';
      const pair = new WebSocketPair();
      pair[1].binaryType = 'arraybuffer';
      pair[1].accept(); provider.accept();
      logSpeech(requestId, stage, 'speech_connected', { elapsedMs: Date.now() - started });
      serveSession(pair[1], provider, requestId, release, (promise) => ctx.waitUntil(promise), request.headers.get('x-speech-protocol') === '2');
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch {
      logSpeech(requestId, stage, 'speech_admission_failed', { upstreamStatus });
      await release();
      return reject(stage === 'provider_upgrade' ? 'speech_provider_unreachable' : 'speech_admission_failed', 502);
    }
  },
} satisfies ExportedHandler<Env & Secrets>;
