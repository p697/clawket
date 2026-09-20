import { describe, expect, it } from 'vitest';
import { verifyRequest } from './auth';
const hex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('hex');
describe('device proof', () => {
  it('accepts possession proof and rejects modified, stale and cross-host replay', async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    const key = hex(await crypto.subtle.exportKey('raw', pair.publicKey));
    const time = String(Date.now()), nonce = 'ab'.repeat(16);
    const signature = hex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(`clawket-speech-v1|speech.example|${time}|${nonce}`)));
    const headers = { 'x-speech-key': key, 'x-speech-time': time, 'x-speech-nonce': nonce, 'x-speech-signature': signature };
    expect(await verifyRequest(new Request('https://speech.example/v1/speech', { headers }))).toMatchObject({ nonce });
    expect(await verifyRequest(new Request('https://other.example/v1/speech', { headers }))).toBeNull();
    expect(await verifyRequest(new Request('https://speech.example/v1/speech', { headers }), Number(time) + 60001)).toBeNull();
    expect(await verifyRequest(new Request('https://speech.example/v1/speech', { headers: { ...headers, 'x-speech-signature': '00'.repeat(64) } }))).toBeNull();
  });
  it('rejects unsigned and malformed requests', async () => {
    expect(await verifyRequest(new Request('https://speech.example/v1/speech'))).toBeNull();
  });
});
