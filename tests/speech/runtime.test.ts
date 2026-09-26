import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import WebSocket from 'ws';
import { getFreePort, WranglerDevProcess } from '../integration/harness';

let runner: WranglerDevProcess, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawket-speech-test-'));
  const configPath = join(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({ name: 'speech-lifecycle-test',
    main: resolve('tests/speech/runtime.fixture.ts'), compatibility_date: '2026-09-17',
    compatibility_flags: ['nodejs_compat', 'enable_request_signal'],
    durable_objects: { bindings: [{ name: 'ADMISSION', class_name: 'SpeechAdmission' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['SpeechAdmission'] }],
  }));
  runner = await WranglerDevProcess.start({ cwd: process.cwd(), configPath, port: await getFreePort() });
});
afterAll(async () => { await runner?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
const identity = () => {
  const pair = generateKeyPairSync('ed25519');
  return { pair, key: pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex') };
};
function connect(owner: ReturnType<typeof identity>, query = '', protocol = '2') {
  const url = new URL(runner.baseUrl.replace('http:', 'ws:') + '/v1/speech' + query);
  const timestamp = String(Date.now()), nonce = randomUUID().replaceAll('-', '');
  const socket = new WebSocket(url, { headers: {
    'x-speech-key': owner.key, 'x-speech-time': timestamp, 'x-speech-nonce': nonce,
    'x-speech-signature': sign(null, Buffer.from(`clawket-speech-v1|${url.host}|${timestamp}|${nonce}`), owner.pair.privateKey).toString('hex'),
    ...(protocol === '2' ? { 'x-speech-protocol': '2' } : {}),
  } });
  const queue: Record<string, unknown>[] = [];
  let listener: (() => void) | undefined;
  socket.on('message', raw => { queue.push(JSON.parse(raw.toString())); listener?.(); });
  socket.on('error', () => {});
  const next = () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { listener = undefined; reject(Error('No speech event')); }, 8000);
    listener = () => { if (queue.length) { clearTimeout(timer); listener = undefined; resolve(queue.shift()!); } };
    listener();
  });
  return { socket, next };
}
async function roundtrip(owner: ReturnType<typeof identity>, protocol = '2') {
  const peer = connect(owner, '', protocol);
  try {
    expect(await peer.next()).toMatchObject({ type: 'ready' });
    peer.socket.send(Buffer.alloc(6400)); peer.socket.send(JSON.stringify({ type: 'finish' }));
    for (let i = 0; i < 4; i++) {
      const event = await peer.next();
      if (event.type === 'result') { expect(event.text).toBe('synthetic result'); return; }
      expect(['ack', 'transcript']).toContain(event.type);
      if (protocol === '1') expect(event.type).not.toBe('ack');
    }
    throw Error('Missing result');
  } finally { peer.socket.terminate(); }
}

it('cleans a real client disconnect during provider upgrade and permits the next recording promptly', async () => {
  const owner = identity(), pending = connect(owner, '?delay=1');
  await new Promise(resolve => setTimeout(resolve, 500));
  pending.socket.terminate();
  await new Promise(resolve => setTimeout(resolve, 700));
  await roundtrip(owner);
});

it('supports consecutive v1/v2 recordings without stale occupancy or protocol changes', async () => {
  const owner = identity();
  await roundtrip(owner, '1'); await roundtrip(owner); await roundtrip(owner);
});

it('never displaces an active recording and preserves v1 HTTP rejection', async () => {
  const owner = identity(), active = connect(owner);
  try {
    expect(await active.next()).toMatchObject({ type: 'ready', maxSeconds: 120 });
    const second = connect(owner);
    try {
      const event = await second.next();
      expect(event).toMatchObject({ type: 'error', code: 'speech_busy' });
      expect(event.retryAfterMs).toBeGreaterThan(140000);
    } finally { second.socket.terminate(); }
    const legacy = connect(owner, '', '1');
    const status = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Missing legacy HTTP rejection')), 5000);
      legacy.socket.on('unexpected-response', (_request, response) => {
        response.resume(); clearTimeout(timeout); resolve(response.statusCode!); legacy.socket.terminate();
      });
    });
    expect(status).toBe(429);
  } finally { active.socket.terminate(); }
});

it('expires an orphaned setup in real DO storage and fences its delayed activation', async () => {
  const owner = identity(), device = `device:${createHash('sha256').update(Buffer.from(owner.key, 'hex')).digest('hex')}`;
  // Inject a crashed setup into the real DO, then recover through signed requests.
  const reserve = () => fetch(`${runner.baseUrl}/test/reserve?device=${encodeURIComponent(device)}`).then(r => r.json());
  expect(await reserve()).toMatchObject({ allowed: true });
  const busy = connect(owner);
  try { expect(await busy.next()).toMatchObject({ type: 'error', code: 'speech_busy' }); }
  finally { busy.socket.terminate(); }
  await new Promise(resolve => setTimeout(resolve, 25100));
  const activation = await fetch(`${runner.baseUrl}/test/activate?device=${encodeURIComponent(device)}`).then(r => r.json());
  expect(activation).toBe(false);
  // Expiry does not remove replay protection or refund charged admission.
  expect(await reserve()).toMatchObject({ allowed: false, reason: 'replay' });
  const replacement = connect(owner);
  try {
    expect(await replacement.next()).toMatchObject({ type: 'ready' });
    await fetch(`${runner.baseUrl}/test/release?device=${encodeURIComponent(device)}`);
    const competitor = connect(owner);
    try { expect(await competitor.next()).toMatchObject({ code: 'speech_busy' }); }
    finally { competitor.socket.terminate(); }
    replacement.socket.send(JSON.stringify({ type: 'finish' }));
    expect(await replacement.next()).toMatchObject({ type: 'transcript' });
    expect(await replacement.next()).toMatchObject({ type: 'result', text: 'synthetic result' });
  } finally { replacement.socket.terminate(); }
  await roundtrip(owner);
});
