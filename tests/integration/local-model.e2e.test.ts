import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import WebSocket from 'ws';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getFreePort } from './harness';
import { CompatWranglerDevProcess, WebSocketInbox } from '../compat/live-harness';
import { buildPairingSessionDraft, securePairingCodeKeyHex, createSecurePairingClientProof, createSecurePairingBridgeProof } from '../../packages/bridge-core/src/index';
import { LocalModelConversation, LocalModelRelay, LocalModelService } from '../../packages/bridge-runtime/src/index';

let registry: CompatWranglerDevProcess;
let worker: CompatWranglerDevProcess;
let directory = '';
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawket-local-model-e2e-'));
  const port = await getFreePort();
  const secret = randomBytes(32).toString('hex');
  const relayUrl = `ws://127.0.0.1:${port}/ws`;
  registry = await CompatWranglerDevProcess.start({ cwd: process.cwd(), configPath: 'apps/relay-registry/wrangler.toml',
    port: await getFreePort(), inspectorPort: await getFreePort(), persistencePath: directory,
    envVars: { RELAY_BACKEND: 'local-model', PAIRING_TICKET_SECRET: secret, RELAY_REGION_MAP: JSON.stringify({ cn: relayUrl, sg: relayUrl, us: relayUrl, eu: relayUrl }) } });
  worker = await CompatWranglerDevProcess.start({ cwd: process.cwd(), configPath: 'apps/relay-worker/wrangler.local-model.preview.example.toml',
    port, inspectorPort: await getFreePort(), persistencePath: directory,
    envVars: { PAIRING_TICKET_SECRET: secret, REGISTRY_VERIFY_URL: registry.baseUrl } });
}, 60_000);
afterAll(async () => {
  await Promise.allSettled([registry?.stop(), worker?.stop()]);
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

async function post(path: string, body: object) {
  const response = await fetch(registry.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  expect(response.status).toBe(200);
  return response.json() as Promise<any>;
}
async function socket(url: string) {
  const ws = new WebSocket(url);
  const inbox = new WebSocketInbox(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, inbox };
}
function clientUrl(relayUrl: string, gatewayId: string, token: string) {
  const url = new URL(relayUrl);
  for (const [key,value] of Object.entries({ gatewayId, token, role: 'client', clientId: randomUUID() })) url.searchParams.set(key,value);
  return url.href;
}

it('pairs using the six-digit proof, streams chat, restores history and switches endpoints through real Workers', async () => {
  const registration = await post('/v1/pair/register', { displayName: 'Local model test' });
  const qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'local-model', s: registry.baseUrl, g: registration.gatewayId, a: registration.accessCode });
  const draft = buildPairingSessionDraft({ ...registration, qrPayload });
  const invitation = await post('/v1/pair/session', draft.request);
  expect(invitation.capabilities).toContain('pairing.secure-short-code.v2');
  const codeKeyHex = securePairingCodeKeyHex(draft.shortPairingCode);
  let calls = 0;
  const fakeModel: typeof fetch = async (url) => {
    if (String(url).endsWith('/v1/models')) return Response.json({ data: [{ id: 'test-model' }] });
    calls++;
    return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  };
  const conversation = new LocalModelConversation(['first','second'].map(id => ({ id, name: id, baseUrl: 'http://localhost:1', contextWindow: 8192 })), join(directory, 'conversation.json'), fakeModel);
  const bridge = new LocalModelRelay(new LocalModelService(conversation), { ...registration, invitation: { ...invitation, codeKeyHex, qrPayload, attempts: 0 } }, () => {});
  const sockets: WebSocket[] = [];
  try {
    bridge.start(); await bridge.waitUntilReady();
    const resolution = await post('/v2/pair/session/resolve', { codeHash: codeKeyHex });
    const pairing = await socket(clientUrl(resolution.relayUrl, resolution.gatewayId, resolution.relayTicket)); sockets.push(pairing.ws);
    const keys = nacl.box.keyPair();
    const clientPublicKey = Buffer.from(keys.publicKey).toString('base64url');
    const requestId = randomUUID();
    const clientProof = createSecurePairingClientProof({ codeKeyHex, sessionId: resolution.sessionId, requestId, clientPublicKey });
    const prefix = '__clawket_relay_control__:';
    pairing.ws.send(prefix + JSON.stringify({ type: 'control', event: 'pairing.secure.start', requestId, payload: { protocol: 2, sessionId: resolution.sessionId, clientPublicKey, clientProof } }));
    const resultFrame = JSON.parse((await pairing.inbox.nextText(t => t.startsWith(prefix) && t.includes('pairing.secure.result'))).slice(prefix.length));
    const result = resultFrame.payload;
    expect(result.bridgeProof).toBe(createSecurePairingBridgeProof({ ...result, codeKeyHex, requestId, clientPublicKey }));
    expect(Buffer.from(nacl.box.open(Buffer.from(result.ciphertext,'base64url'), Buffer.from(result.nonce,'base64url'), Buffer.from(result.bridgePublicKey,'base64url'), keys.secretKey)!).toString()).toBe(qrPayload);
    pairing.ws.close();
    const claimed = await post('/v1/pair/claim', { gatewayId: registration.gatewayId, accessCode: registration.accessCode, clientLabel: 'test phone' });
    const client = await socket(clientUrl(claimed.relayUrl, claimed.gatewayId, claimed.clientToken)); sockets.push(client.ws);
    const rpc = async (method: string, params = {}) => {
      const id = randomUUID(); client.ws.send(JSON.stringify({ type: 'req', id, method, params }));
      const frame = await client.inbox.nextJson(f => f.id === id); expect(frame.ok).toBe(true); return frame.payload as any;
    };
    expect((await rpc('connect')).backend).toBe('local-model');
    const observer = await socket(clientUrl(claimed.relayUrl, claimed.gatewayId, claimed.clientToken)); sockets.push(observer.ws);
    const params = { sessionKey: 'main', text: 'Hello', idempotencyKey: randomUUID() };
    const sent = await rpc('chat.send', params);
    await client.inbox.nextJson(f => f.event === 'local-model.update' && (f.payload as any)?.type === 'run_finished');
    await observer.inbox.nextJson(f => f.event === 'local-model.update' && (f.payload as any)?.type === 'run_finished');
    expect((await rpc('chat.history')).messages.map((m: any) => m.text)).toEqual(['Hello','你好']);
    expect((await rpc('chat.send', params)).runId).toBe(sent.runId);
    expect(calls).toBe(1);
    expect((await rpc('models.select', { model: 'second' })).currentModel).toBe('second');
    const reconnect = await socket(clientUrl(claimed.relayUrl, claimed.gatewayId, claimed.clientToken)); sockets.push(reconnect.ws);
    reconnect.ws.send(JSON.stringify({ type: 'req', id: 'reconnect-history', method: 'chat.history' }));
    expect(((await reconnect.inbox.nextJson(f => f.id === 'reconnect-history')).payload as any).messages).toHaveLength(2);
  } finally { for (const ws of sockets) ws.terminate(); bridge.stop(); await conversation.stop(); }
}, 60_000);
