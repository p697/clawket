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
    let clientPair: InstanceType<typeof WebSocketPair> | undefined;
    // RN does not expose HTTP bodies on a failed WebSocket handshake. V2 negotiates
    // a bounded error frame; v1 retains the original HTTP status contract.
    const reject = (code: string, status: number, retryAfterMs = 0) => {
      logSpeech(requestId, 'admission', code, { status, retryAfterMs });
      if (request.headers.get('x-speech-protocol') === '2') {
        const pair = clientPair ?? new WebSocketPair();
        if (!clientPair) pair[1].accept();
        try {
          pair[1].send(JSON.stringify({ type: 'error', code, requestId, retryAfterMs }));
          pair[1].close(1000, 'speech_rejected');
        } catch { /* Caller disconnected during setup. */ }
        return clientPair ? new Response(null, { status }) : new Response(null, { status: 101, webSocket: pair[0] });
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
        released = (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await device.release(identity.nonce);
              logSpeech(requestId, 'release', 'speech_released');
              return;
            } catch {
              if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
            }
          }
          logSpeech(requestId, 'release', 'speech_admission_failed');
        })();
        ctx.waitUntil(released);
      }
      return released;
    };
    const setupAbort = new AbortController();
    const disconnected = () => setupAbort.abort();
    request.signal.addEventListener('abort', disconnected, { once: true });
    if (request.signal.aborted) disconnected();
    const setupDeadline = setTimeout(disconnected, 20000);
    const checkSetup = () => { if (setupAbort.signal.aborted) throw Error('speech_cancelled'); };
    // V2 already represents admission failures as WS frames. Accept its transport
    // now, so cancel/close is observable while DO admission or provider setup waits.
    const cancelPending = () => setupAbort.abort();
    if (request.headers.get('x-speech-protocol') === '2') {
      clientPair = new WebSocketPair();
      clientPair[1].binaryType = 'arraybuffer'; clientPair[1].accept();
      clientPair[1].addEventListener('close', cancelPending);
      clientPair[1].addEventListener('error', cancelPending);
      // No PCM/control except cancellation is valid before ready.
      clientPair[1].addEventListener('message', cancelPending);
    }
    let provider: WebSocket | null | undefined;
    let stage = 'admission';
    let upstreamStatus = 0;
    const setup = async () => {
      try {
        checkSetup();
        const admission = await device.reservePending(identity.nonce);
        if (!admission.allowed) {
          const code = admission.reason === 'busy' ? 'speech_busy' : admission.reason === 'replay' ? 'speech_auth'
            : admission.reason === 'storage' ? 'speech_admission_failed' : 'speech_device_limit';
          return reject(code, 429, admission.retryAfterMs);
        }
        reserved = true;
        logSpeech(requestId, 'admission', 'speech_reserved');
        checkSetup();
        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        const ipHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)));
        const ipKey = [...ipHash].map((x) => x.toString(16).padStart(2, '0')).join('');
        checkSetup();
        const ipAdmission = await env.ADMISSION.getByName(`ip:${ipKey}`).reserveDetailed(identity.nonce, 120, 3600000);
        if (!ipAdmission.allowed) { await release(); return reject(ipAdmission.reason === 'storage' ? 'speech_admission_failed' : 'speech_ip_limit', 429, ipAdmission.retryAfterMs); }
        checkSetup();
        const budget = await env.ADMISSION.getByName('provider-daily-budget').reserveDetailed(crypto.randomUUID(), 200, 86400000);
        if (!budget.allowed) { await release(); return reject(budget.reason === 'storage' ? 'speech_admission_failed' : 'speech_daily_limit', 429, budget.retryAfterMs); }
        checkSetup();
        const providerUrl = new URL(env.ALIYUN_SPEECH_URL);
        if (providerUrl.protocol !== 'https:' || !providerUrl.hostname.endsWith('.maas.aliyuncs.com') || providerUrl.pathname !== '/api-ws/v1/inference') return await release().then(() => reject('speech_config', 503));
        stage = 'provider_upgrade';
        const upgrade = new AbortController();
        const cancelUpgrade = () => upgrade.abort();
        setupAbort.signal.addEventListener('abort', cancelUpgrade, { once: true });
        const upgradeDeadline = setTimeout(cancelUpgrade, 10000);
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
          setupAbort.signal.removeEventListener('abort', cancelUpgrade);
        }
        upstreamStatus = response.status;
        provider = response.webSocket;
        if (provider && response.status === 101) provider.accept();
        checkSetup();
        if (!provider || response.status !== 101) {
          await release();
          const code = response.status === 429 ? 'speech_provider_busy' : [401, 403].includes(response.status) ? 'speech_provider_auth' : 'speech_provider_upgrade';
          logSpeech(requestId, stage, code, { upstreamStatus });
          return reject(code, 502);
        }
        if (!await device.activate(identity.nonce)) throw Error('speech_admission_failed');
        checkSetup();
        stage = 'session';
        const pair = clientPair ?? new WebSocketPair();
        if (!clientPair) { pair[1].binaryType = 'arraybuffer'; pair[1].accept(); }
        logSpeech(requestId, stage, 'speech_connected', { elapsedMs: Date.now() - started });
        serveSession(pair[1], provider, requestId, release, (promise) => ctx.waitUntil(promise), request.headers.get('x-speech-protocol') === '2');
        return clientPair ? new Response(null, { status: 204 }) : new Response(null, { status: 101, webSocket: pair[0] });
      } catch {
        try { provider?.close(1000, 'speech_setup_failed'); } catch { /* Already disconnected. */ }
        logSpeech(requestId, stage, setupAbort.signal.aborted ? 'speech_cancelled' : 'speech_admission_failed', { upstreamStatus });
        await release();
        if (request.signal.aborted) return new Response(null, { status: 499 });
        return reject(stage === 'provider_upgrade' ? 'speech_provider_unreachable' : 'speech_admission_failed', 502);
      } finally {
        clearTimeout(setupDeadline);
        request.signal.removeEventListener('abort', disconnected);
        for (const event of ['close', 'error', 'message']) clientPair?.[1].removeEventListener(event, cancelPending);
      }
    };
    // Register BEFORE reservation: a caller can disappear while the DO commits it.
    // The bounded setup continues through cancellation cleanup, not only normal errors.
    const pending = setup();
    ctx.waitUntil(pending.then(() => {}, () => {}));
    return clientPair ? new Response(null, { status: 101, webSocket: clientPair[0] }) : pending;
  },
} satisfies ExportedHandler<Env & Secrets>;
