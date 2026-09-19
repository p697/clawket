import { verifyRequest } from './auth';
import { serveSession } from './session';
export { SpeechAdmission } from './admission';

type Secrets = { ALIYUN_SPEECH_API_KEY?: string };
export default {
  async fetch(request: Request, env: Env & Secrets, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ service: 'clawket-speech', enabled: env.SPEECH_ENABLED === 'true' });
    if (url.pathname !== '/v1/speech' || request.method !== 'GET') return new Response(null, { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
    if (env.SPEECH_ENABLED !== 'true' || !env.ALIYUN_SPEECH_API_KEY) return new Response(null, { status: 503 });
    const identity = await verifyRequest(request);
    if (!identity) return new Response(null, { status: 401 });
    // Device proof is not a subscription. Paid access must be verified here before admission.
    const device = env.ADMISSION.getByName(`device:${identity.device}`);
    if (!await device.reserve(identity.nonce, 60, 3600000, true)) return new Response(null, { status: 429 });
    const release = () => { ctx.waitUntil(device.release(identity.nonce)); };
    let stage = 'admission';
    let upstreamStatus: number | undefined;
    try {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      const ipHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)));
      const ipKey = [...ipHash].map((x) => x.toString(16).padStart(2, '0')).join('');
      const allowed = await env.ADMISSION.getByName(`ip:${ipKey}`).reserve(identity.nonce, 120, 3600000);
      // 200 full 120-second reservations/day bounds all provider work, including cancellation.
      const budget = allowed && await env.ADMISSION.getByName('provider-daily-budget').reserve(crypto.randomUUID(), 200, 86400000);
      if (!budget) { release(); return new Response(null, { status: 429 }); }
      const providerUrl = new URL(env.ALIYUN_SPEECH_URL);
      if (providerUrl.protocol !== 'https:' || !providerUrl.hostname.endsWith('.maas.aliyuncs.com') || providerUrl.pathname !== '/api-ws/v1/inference') throw Error('speech_config');
      stage = 'provider_upgrade';
      const response = await fetch(providerUrl, {
        headers: { Upgrade: 'websocket', Authorization: `Bearer ${env.ALIYUN_SPEECH_API_KEY}` },
        signal: AbortSignal.timeout(10000), redirect: 'manual',
      });
      upstreamStatus = response.status;
      const provider = response.webSocket;
      if (!provider || response.status !== 101) throw Error('speech_provider_failed');
      stage = 'session';
      const pair = new WebSocketPair();
      // Workers defaults to Blob with current compatibility dates; preserve PCM frame order.
      pair[1].binaryType = 'arraybuffer';
      pair[1].accept(); provider.accept();
      serveSession(pair[1], provider, crypto.randomUUID(), release);
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch {
      console.warn(JSON.stringify({ event: 'speech_admission_failed', stage, upstreamStatus }));
      release(); return new Response(null, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env & Secrets>;
