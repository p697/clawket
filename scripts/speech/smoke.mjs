import { readFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import WebSocket from 'ws';

// Uses synthetic PCM supplied by the caller, never the computer's microphone.
const [endpoint, pcmPath] = process.argv.slice(2);
if (!endpoint || !pcmPath) throw Error('Usage: node scripts/speech/smoke.mjs <wss endpoint> <16kHz mono int16 PCM>');
const url = new URL(endpoint);
if (!['wss:', 'ws:'].includes(url.protocol)) throw Error('Invalid speech endpoint');
const audio = readFileSync(pcmPath);
if (!audio.length || audio.length % 2 || audio.length > 32000 * 15) throw Error('Expected nonempty PCM under 15 seconds');
const pair = generateKeyPairSync('ed25519');
const key = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
const timestamp = String(Date.now()), nonce = randomBytes(16).toString('hex');
const signature = sign(null, Buffer.from(`clawket-speech-v1|${url.host}|${timestamp}|${nonce}`), pair.privateKey).toString('hex');
const socket = new WebSocket(url, { headers: { 'x-speech-key': key, 'x-speech-time': timestamp, 'x-speech-nonce': nonce, 'x-speech-signature': signature } });
let timer, complete = false, ready = false;
const deadline = setTimeout(() => fail('Speech smoke timed out'), 30000);
function fail(message) {
  clearTimeout(deadline); clearInterval(timer); socket.terminate();
  console.error(message); process.exitCode = 1;
}
socket.on('unexpected-response', (_request, response) => fail(`Speech admission failed: HTTP ${response.statusCode}`));
socket.on('error', () => fail('Speech socket failed'));
socket.on('message', (raw) => {
  const event = JSON.parse(raw.toString());
  if (event.type === 'ready') {
    if (ready || event.maxSeconds !== 120) return fail('Invalid speech readiness');
    ready = true; let offset = 0;
    timer = setInterval(() => {
      if (offset < audio.length) { socket.send(audio.subarray(offset, offset + 3200)); offset += 3200; }
      else { clearInterval(timer); socket.send(JSON.stringify({ type: 'finish' })); }
    }, 100);
  } else if (event.type === 'error') fail(`Speech failed: ${event.code}`);
  else if (event.type === 'result') {
    if (!ready || typeof event.text !== 'string' || !event.text.trim()) return fail('Missing speech result');
    complete = true; clearTimeout(deadline); clearInterval(timer); socket.close();
    console.log(JSON.stringify({ ready, completed: true, audioSeconds: audio.length / 32000, transcript: event.text }));
  }
});
socket.on('close', () => { if (!complete && !process.exitCode) fail('Speech closed without a final result'); });
