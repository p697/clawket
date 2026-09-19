export type SpeechIdentity = { device: string; nonce: string };
const hex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (byte) => parseInt(byte, 16));
export async function verifyRequest(request: Request, now = Date.now()): Promise<SpeechIdentity | null> {
  const publicKey = request.headers.get('x-speech-key') ?? '';
  const nonce = request.headers.get('x-speech-nonce') ?? '';
  const timestamp = request.headers.get('x-speech-time') ?? '';
  const signature = request.headers.get('x-speech-signature') ?? '';
  if (!/^[a-f0-9]{64}$/.test(publicKey) || !/^[a-f0-9]{32}$/.test(nonce) ||
      !/^[a-f0-9]{128}$/.test(signature) || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60000) return null;
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKey), 'Ed25519', false, ['verify']);
    const payload = new TextEncoder().encode(`clawket-speech-v1|${new URL(request.url).host}|${timestamp}|${nonce}`);
    if (!await crypto.subtle.verify('Ed25519', key, hex(signature), payload)) return null;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', hex(publicKey)));
    return { device: [...hash].map((x) => x.toString(16).padStart(2, '0')).join(''), nonce };
  } catch { return null; }
}
