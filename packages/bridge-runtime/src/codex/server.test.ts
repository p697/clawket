import { afterEach, beforeEach, expect, it } from 'vitest';
import { EventEmitter, once } from 'node:events';
import WebSocket from 'ws';
import { CodexServer } from './server.js';
import type { CodexService } from './service.js';
let server: CodexServer, service: EventEmitter, url: string;
const sockets: WebSocket[] = [];
const token = 'test-token-'.repeat(4);
beforeEach(async () => {
  service = Object.assign(new EventEmitter(), { health: async () => ({ backend: 'codex' }), request: async (f: any) => f.method === 'health' ? { backend: 'codex' } : { method: f.method }, stop: async () => {} });
  server = new CodexServer(service as CodexService, token);
  url = `ws://127.0.0.1:${await server.start(0)}/v1/codex/ws`;
});
afterEach(async () => { sockets.splice(0).forEach(s => s.terminate()); await server.stop(); });
async function open() { const s = new WebSocket(url); sockets.push(s); await once(s, 'open'); return s; }
async function call(s: WebSocket, frame: unknown) { const reply = once(s, 'message'); s.send(JSON.stringify(frame)); return JSON.parse((await reply)[0].toString()); }
it('rejects unauthenticated requests before routing or broadcasting', async () => {
  const s = await open(), closed = once(s, 'close');
  s.send(JSON.stringify({ type: 'req', id: '1', method: 'sessions.list' }));
  expect((await closed)[0]).toBe(1008);
});
it('authenticates the native health handshake and preserves request IDs', async () => {
  const s = await open();
  expect(await call(s, { type: 'req', id: 'auth', method: 'connect', params: { token } })).toMatchObject({ id: 'auth', ok: true, payload: { backend: 'codex' } });
  expect(await call(s, { type: 'req', id: 'sessions', method: 'sessions.list' })).toMatchObject({ id: 'sessions', ok: true });
  const event = once(s, 'message'); service.emit('update', { type: 'agent_message_chunk', text: 'hello' });
  expect(JSON.parse((await event)[0].toString())).toMatchObject({ event: 'codex.update', payload: { text: 'hello' } });
});
it('contains malformed JSON without crashing or authenticating the socket', async () => {
  const s = await open();
  expect(await call(s, null)).toMatchObject({ ok: false });
  const closed = once(s, 'close');
  s.send(JSON.stringify({ type: 'req', id: 'bad', method: 'connect', params: { token: 'wrong' } }));
  expect((await closed)[0]).toBe(1008);
  const next = await open();
  expect(await call(next, { type: 'req', id: 'good', method: 'connect', params: { token } })).toMatchObject({ ok: true });
});
