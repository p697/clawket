import { randomBytes, randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import { buildPairingSessionDraft, securePairingCodeKeyHex, createSecurePairingClientProof, createSecurePairingBridgeProof } from '../../packages/bridge-core/src/index';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { PiRelay } from '../../packages/bridge-runtime/src/pi/relay';
import type { PiService } from '../../packages/bridge-runtime/src/pi/service';
import { getFreePort } from '../integration/harness';
import { CompatWranglerDevProcess, WebSocketInbox, openWebSocket } from '../compat/live-harness';

it('pairs an isolated Pi deployment and routes requests, streams, offline errors and reconnects without an OpenClaw challenge', async () => {
  const state = await mkdtemp(join(tmpdir(), 'clawket-pi-relay-'));
  const [registryPort, relayPort, inspector1, inspector2] = await Promise.all([getFreePort(), getFreePort(), getFreePort(), getFreePort()]);
  const secret = randomBytes(32).toString('hex');
  const relayUrl = `ws://127.0.0.1:${relayPort}/ws`;
  let registry: CompatWranglerDevProcess | undefined, relay: CompatWranglerDevProcess | undefined, owner: PiRelay | undefined;
  const sockets: WebSocket[] = [];
  try {
    registry = await CompatWranglerDevProcess.start({ cwd: process.cwd(), configPath: 'apps/relay-registry/wrangler.pi.example.toml', port: registryPort, inspectorPort: inspector1, persistencePath: state,
      envVars: { PAIRING_TICKET_SECRET: secret, RELAY_REGION_MAP: JSON.stringify({ cn: relayUrl, us: relayUrl, sg: relayUrl, eu: relayUrl }), PAIR_PUBLIC_BASE_URL: `http://127.0.0.1:${registryPort}` } });
    relay = await CompatWranglerDevProcess.start({ cwd: process.cwd(), configPath: 'apps/relay-worker/wrangler.pi.example.toml', port: relayPort, inspectorPort: inspector2, persistencePath: state,
      envVars: { PAIRING_TICKET_SECRET: secret, REGISTRY_VERIFY_URL: registry.baseUrl } });
    const post = async (path: string, body: object): Promise<any> => {
      const response = await fetch(registry!.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.status).toBe(200); return response.json();
    };
    const pair = await post('/v1/pair/register', { displayName: 'Pi fixture', preferredRegion: 'us' });
    const qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'pi', s: registry.baseUrl, g: pair.gatewayId, a: pair.accessCode });
    const draft = buildPairingSessionDraft({ ...pair, qrPayload });
    let invitation: any;
    await expect.poll(async () => { invitation = await post('/v1/pair/session', draft.request); return invitation.capabilities; }, { timeout: 15000, interval: 500 }).toContain('pairing.secure-short-code.v2');
    const codeKeyHex = securePairingCodeKeyHex(draft.shortPairingCode);
    expect(invitation.capabilities).toContain('pairing.secure-short-code.v2');
    class Service extends EventEmitter {
      conversation = this;
      async request(frame: any) { return frame.method === 'health' ? { backend: 'pi', protocol: 1 } : { marker: frame.params?.marker }; }
    }
    const service = new Service();
    owner = new PiRelay(service as unknown as PiService, { relayUrl, gatewayId: pair.gatewayId, relaySecret: pair.relaySecret, invitation: { ...invitation, codeKeyHex, qrPayload, attempts: 0 } }, () => {});
    owner.start(); await owner.waitUntilReady();
    const resolution = await post('/v2/pair/session/resolve', { codeHash: codeKeyHex });
    const pairingUrl = new URL(relayUrl);
    for (const [name, value] of Object.entries({ gatewayId: pair.gatewayId, role: 'client', clientId: 'pairing', token: resolution.relayTicket })) pairingUrl.searchParams.set(name, value);
    const pairing = await openWebSocket(pairingUrl.href); sockets.push(pairing.socket);
    const keys = nacl.box.keyPair(), clientPublicKey = Buffer.from(keys.publicKey).toString('base64url'), requestId = randomUUID();
    const prefix = '__clawket_relay_control__:';
    const control = (proof: string) => prefix + JSON.stringify({ type: 'control', event: 'pairing.secure.start', requestId, payload: { protocol: 2, sessionId: invitation.sessionId, clientPublicKey, clientProof: proof } });
    pairing.socket.send(control('invalid'));
    expect(await pairing.nextText(text => text.includes('pairing.secure.error'))).toContain('invalid_code');
    pairing.socket.send(control(createSecurePairingClientProof({ codeKeyHex, sessionId: invitation.sessionId, requestId, clientPublicKey })));
    const result = JSON.parse((await pairing.nextText(text => text.includes('pairing.secure.result'))).slice(prefix.length)).payload;
    expect(result.bridgeProof).toBe(createSecurePairingBridgeProof({ ...result, codeKeyHex, requestId, clientPublicKey }));
    expect(Buffer.from(nacl.box.open(Buffer.from(result.ciphertext, 'base64url'), Buffer.from(result.nonce, 'base64url'), Buffer.from(result.bridgePublicKey, 'base64url'), keys.secretKey)!).toString()).toBe(qrPayload);
    const claim = await post('/v1/pair/claim', { gatewayId: pair.gatewayId, accessCode: pair.accessCode, clientLabel: 'Pi phone' });
    pairing.socket.close();
    const connect = async (clientId: string) => {
      const url = new URL(relayUrl); Object.entries({ gatewayId: pair.gatewayId, role: 'client', clientId, token: claim.clientToken }).forEach(([key, value]) => url.searchParams.set(key, value));
      const inbox = await openWebSocket(url.toString()); sockets.push(inbox.socket); return inbox;
    };
    const first = await connect('phone-one'), second = await connect('phone-two');
    first.socket.send(JSON.stringify({ type: 'req', id: 'one', method: 'health' }));
    expect(await first.nextJson(frame => frame.id === 'one')).toMatchObject({ ok: true, payload: { backend: 'pi' } });
    second.socket.send(JSON.stringify({ type: 'req', id: 'two', method: 'sessions.list', params: { marker: 'second' } }));
    expect(await second.nextJson(frame => frame.id === 'two')).toMatchObject({ payload: { marker: 'second' } });
    expect(first.received.some(frame => frame.includes('second'))).toBe(false);
    service.emit('update', { type: 'agent_message_chunk', sessionKey: 's', runId: 'r', text: 'verbatim \n' });
    for (const inbox of [first, second]) expect(await inbox.nextJson(frame => frame.event === 'pi.update')).toMatchObject({ payload: { text: 'verbatim \n' } });
    first.socket.terminate(); const restored = await connect('phone-one-restored');
    restored.socket.send(JSON.stringify({ type: 'req', id: 'restore', method: 'health' }));
    expect(await restored.nextJson(frame => frame.id === 'restore')).toMatchObject({ ok: true });
    owner.stop();
    await new Promise(r => setTimeout(r, 100));
    const offline = await connect('offline-phone');
    offline.socket.send(JSON.stringify({ type: 'req', id: 'offline', method: 'health' }));
    expect(await offline.nextJson(frame => frame.id === 'offline')).toMatchObject({ ok: false, error: { code: 'BRIDGE_UNAVAILABLE' } });
  } finally {
    sockets.forEach(socket => socket.terminate()); owner?.stop(); await relay?.stop(); await registry?.stop(); await rm(state, { recursive: true, force: true });
  }
});
