import { decodeSpeechError, SpeechError } from './speechErrors';
import nacl from 'tweetnacl';
import { bytesToHex, ensureIdentity, generateId, hexToBytes } from '../gateway-auth';

export const speechServiceUrl = process.env.EXPO_PUBLIC_SPEECH_URL?.trim() || '';
export type SpeechConnection = {
  ready: Promise<void>;
  result: Promise<string>;
  audio(bytes: Uint8Array): void;
  writable?: () => boolean;
  replayRate?: () => number;
  finish(): void;
  cancel(): void;
};
export async function connectSpeech(): Promise<SpeechConnection> {
  const url = new URL(speechServiceUrl);
  if (url.protocol !== 'wss:' || url.pathname !== '/v1/speech' || url.username || url.password || url.search) throw Error('speech_unavailable');
  let identityTimeout: ReturnType<typeof setTimeout> | undefined;
  const identity = await Promise.race([ensureIdentity(), new Promise<never>((_, reject) => {
    identityTimeout = setTimeout(() => reject(new SpeechError('speech_auth')), 5000);
  })]).finally(() => clearTimeout(identityTimeout));
  const timestamp = String(Date.now()), nonce = generateId();
  const payload = `clawket-speech-v1|${url.host}|${timestamp}|${nonce}`;
  const signature = bytesToHex(nacl.sign.detached(new TextEncoder().encode(payload), hexToBytes(identity.secretKeyHex)));
  // React Native supports handshake headers; the DOM ambient constructor omits its third argument.
  const NativeSocket = WebSocket as typeof WebSocket & {
    new(url: string, protocols: string[] | undefined, options: { headers: Record<string, string> }): WebSocket;
  };
  return openSpeechSocket(new NativeSocket(url.toString(), undefined, {
    headers: { 'x-speech-protocol': '2', 'x-speech-key': identity.publicKeyHex, 'x-speech-time': timestamp,
      'x-speech-nonce': nonce, 'x-speech-signature': signature },
  }));
}

/** No automatic retries: a lost final response must never replay a user's prompt. */
export function openSpeechSocket(socket: WebSocket): SpeechConnection {
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let resolveResult!: (text: string) => void, rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const result = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  void ready.catch(() => {}); void result.catch(() => {});
  let done = false, initialized = false, finishing = false, acknowledgedFlow = false;
  let sentBytes = 0, acknowledgedBytes = 0;
  let requestId = '';
  let timer = setTimeout(() => fail(new SpeechError('speech_connect_timeout')), 20000);
  const fail = (value: string | SpeechError) => {
    const error = value instanceof SpeechError ? value : decodeSpeechError({ code: value, requestId });
    if (done) return;
    done = true; clearTimeout(timer);
    rejectReady(error); rejectResult(error);
    try { socket.close(); } catch { /* Already closed. */ }
  };
  socket.onmessage = ({ data }) => {
    if (done) return;
    try {
      if (typeof data !== 'string' || data.length > 32768) throw Error();
      const event = JSON.parse(data);
      if (typeof event.requestId === 'string' && /^[a-f0-9-]{36}$/.test(event.requestId)) requestId = event.requestId;
      if (event.type === 'ready') {
        if (initialized || event.maxSeconds !== 120) throw Error();
        initialized = true; acknowledgedFlow = event.flowControl === 'ack.v1'; clearTimeout(timer);
        timer = setTimeout(() => fail('speech_timeout'), 145000);
        resolveReady();
      } else if (event.type === 'ack') {
        if (!acknowledgedFlow || !Number.isInteger(event.bytes) || event.bytes < acknowledgedBytes || event.bytes > sentBytes) throw Error();
        acknowledgedBytes = event.bytes;
      } else if (event.type === 'result') {
        if (!finishing || typeof event.text !== 'string' || event.text.length > 16000) throw Error();
        done = true; clearTimeout(timer); resolveResult(event.text.trim()); socket.close();
      } else if (event.type === 'error') {
        fail(decodeSpeechError(event));
      } else if (event.type !== 'transcript') throw Error();
    } catch { fail('speech_protocol'); }
  };
  socket.onerror = () => fail('speech_disconnected');
  socket.onclose = () => fail('speech_disconnected');
  return {
    ready, result,
    writable: () => !done && socket.readyState === WebSocket.OPEN &&
      (acknowledgedFlow ? sentBytes - acknowledgedBytes < 64000 : !Number.isFinite(socket.bufferedAmount) || socket.bufferedAmount < 64000),
    replayRate: () => acknowledgedFlow || Number.isFinite(socket.bufferedAmount) ? 5 : 1,
    audio(bytes) {
      if (done || !initialized || finishing || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256000) {
        fail('speech_disconnected'); throw Error('speech_disconnected');
      }
      // Bound every frame independently of the native audio callback's chunk size.
      for (let offset = 0; offset < bytes.length; offset += 6400) {
        const chunk = bytes.slice(offset, offset + 6400);
        sentBytes += chunk.length;
        try { socket.send(chunk.buffer); } catch { fail('speech_disconnected'); throw new SpeechError('speech_disconnected', requestId); }
      }
    },
    finish() {
      if (done || finishing) return;
      if (!initialized || socket.readyState !== WebSocket.OPEN) { fail('speech_disconnected'); return; }
      finishing = true; clearTimeout(timer);
      timer = setTimeout(() => fail('speech_timeout'), 16000);
      try { socket.send(JSON.stringify({ type: 'finish' })); } catch { fail('speech_disconnected'); }
    },
    cancel() {
      if (done) return;
      try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel' })); } catch { /* Already closed. */ }
      fail('speech_cancelled');
    },
  };
}
