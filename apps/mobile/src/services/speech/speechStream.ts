import nacl from 'tweetnacl';
import { bytesToHex, ensureIdentity, generateId, hexToBytes } from '../gateway-auth';

export const speechServiceUrl = process.env.EXPO_PUBLIC_SPEECH_URL?.trim() || '';
export type SpeechConnection = {
  ready: Promise<void>;
  result: Promise<string>;
  audio(bytes: Uint8Array): void;
  finish(): void;
  cancel(): void;
};
export async function connectSpeech(): Promise<SpeechConnection> {
  const url = new URL(speechServiceUrl);
  if (url.protocol !== 'wss:' || url.pathname !== '/v1/speech' || url.username || url.password || url.search) throw Error('speech_unavailable');
  const identity = await ensureIdentity();
  const timestamp = String(Date.now()), nonce = generateId();
  const payload = `clawket-speech-v1|${url.host}|${timestamp}|${nonce}`;
  const signature = bytesToHex(nacl.sign.detached(new TextEncoder().encode(payload), hexToBytes(identity.secretKeyHex)));
  // React Native supports handshake headers; the DOM ambient constructor omits its third argument.
  const NativeSocket = WebSocket as typeof WebSocket & {
    new(url: string, protocols: string[] | undefined, options: { headers: Record<string, string> }): WebSocket;
  };
  return openSpeechSocket(new NativeSocket(url.toString(), undefined, {
    headers: { 'x-speech-key': identity.publicKeyHex, 'x-speech-time': timestamp,
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
  let done = false, initialized = false, finishing = false;
  let timer = setTimeout(() => fail('speech_timeout'), 15000);
  const fail = (code: string) => {
    if (done) return;
    done = true; clearTimeout(timer);
    rejectReady(Error(code)); rejectResult(Error(code));
    socket.close();
  };
  socket.onmessage = ({ data }) => {
    if (done) return;
    try {
      if (typeof data !== 'string' || data.length > 32768) throw Error();
      const event = JSON.parse(data);
      if (event.type === 'ready') {
        if (initialized || event.maxSeconds !== 120) throw Error();
        initialized = true; clearTimeout(timer);
        timer = setTimeout(() => fail('speech_timeout'), 145000);
        resolveReady();
      } else if (event.type === 'result') {
        if (!finishing || typeof event.text !== 'string' || event.text.length > 16000) throw Error();
        done = true; clearTimeout(timer); resolveResult(event.text.trim()); socket.close();
      } else if (event.type === 'error') {
        fail('speech_failed');
      } else if (event.type !== 'transcript') throw Error();
    } catch { fail('speech_protocol'); }
  };
  socket.onerror = () => fail('speech_disconnected');
  socket.onclose = () => fail('speech_disconnected');
  return {
    ready, result,
    audio(bytes) {
      if (done || !initialized || finishing || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256000) {
        fail('speech_disconnected'); throw Error('speech_disconnected');
      }
      // Bound every frame independently of the native audio callback's chunk size.
      for (let offset = 0; offset < bytes.length; offset += 6400) {
        socket.send(bytes.slice(offset, offset + 6400).buffer);
      }
    },
    finish() {
      if (done || finishing) return;
      if (!initialized || socket.readyState !== WebSocket.OPEN) { fail('speech_disconnected'); return; }
      finishing = true; clearTimeout(timer);
      timer = setTimeout(() => fail('speech_timeout'), 16000);
      socket.send(JSON.stringify({ type: 'finish' }));
    },
    cancel() {
      if (done) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel' }));
      fail('speech_cancelled');
    },
  };
}
